// Rotates the CloudFront origin secret (helloworld/<env>/origin-verify).
//
// Secrets Manager calls this four times per rotation:
//   createSecret  store a new random value as AWSPENDING
//   setSecret     put the pending value in CloudFront's x-origin-verify header
//   testSecret    nothing to test beyond setSecret succeeding
//   finishSecret  make the pending value AWSCURRENT (the old one becomes AWSPREVIOUS)
//
// The app accepts the current, pending and previous values (lib/origin-verify.ts),
// so requests keep working while CloudFront edges switch from old to new.
// The AWS SDK v3 is part of the Lambda Node.js runtime, so nothing is bundled.
import {
  DescribeSecretCommand,
  GetRandomPasswordCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretVersionStageCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
} from "@aws-sdk/client-cloudfront";

const sm = new SecretsManagerClient({});
const cf = new CloudFrontClient({});

const { DISTRIBUTION_ID, ORIGIN_ID, HEADER_NAME } = process.env;

export const handler = async ({ SecretId, ClientRequestToken: token, Step }) => {
  const meta = await sm.send(new DescribeSecretCommand({ SecretId }));
  if (!meta.RotationEnabled) throw new Error(`Rotation is not enabled for ${SecretId}`);
  const stages = meta.VersionIdsToStages?.[token];
  if (!stages) throw new Error(`Version ${token} is not part of ${SecretId}`);
  if (stages.includes("AWSCURRENT")) return; // already finished
  if (!stages.includes("AWSPENDING")) throw new Error(`Version ${token} is not pending`);

  console.log(JSON.stringify({ event: "rotation.step", step: Step, secret: meta.Name }));
  if (Step === "createSecret") return createSecret(SecretId, token);
  if (Step === "setSecret") return setSecret(SecretId, token);
  if (Step === "testSecret") return;
  if (Step === "finishSecret") return finishSecret(SecretId, token, meta.VersionIdsToStages);
  throw new Error(`Unknown rotation step ${Step}`);
};

async function createSecret(SecretId, token) {
  try {
    await sm.send(new GetSecretValueCommand({ SecretId, VersionId: token, VersionStage: "AWSPENDING" }));
    return; // created by an earlier attempt
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
  }
  const { RandomPassword } = await sm.send(
    new GetRandomPasswordCommand({ PasswordLength: 48, ExcludePunctuation: true }),
  );
  await sm.send(
    new PutSecretValueCommand({
      SecretId,
      ClientRequestToken: token,
      SecretString: RandomPassword,
      VersionStages: ["AWSPENDING"],
    }),
  );
}

async function setSecret(SecretId, token) {
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId, VersionId: token, VersionStage: "AWSPENDING" }),
  );
  const { DistributionConfig, ETag } = await cf.send(new GetDistributionConfigCommand({ Id: DISTRIBUTION_ID }));
  const origin = DistributionConfig.Origins.Items.find((o) => o.Id === ORIGIN_ID);
  if (!origin) throw new Error(`Origin ${ORIGIN_ID} not found on ${DISTRIBUTION_ID}`);

  const headers = origin.CustomHeaders?.Items ?? [];
  const header = headers.find((h) => h.HeaderName.toLowerCase() === HEADER_NAME);
  if (header?.HeaderValue === SecretString) return; // set by an earlier attempt
  if (header) header.HeaderValue = SecretString;
  else headers.push({ HeaderName: HEADER_NAME, HeaderValue: SecretString });
  origin.CustomHeaders = { Quantity: headers.length, Items: headers };

  await cf.send(new UpdateDistributionCommand({ Id: DISTRIBUTION_ID, IfMatch: ETag, DistributionConfig }));
}

async function finishSecret(SecretId, token, versions) {
  const current = Object.entries(versions).find(([, s]) => s.includes("AWSCURRENT"))?.[0];
  await sm.send(
    new UpdateSecretVersionStageCommand({
      SecretId,
      VersionStage: "AWSCURRENT",
      MoveToVersionId: token,
      RemoveFromVersionId: current,
    }),
  );
}
