import {
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

/**
 * Secrets the app needs at runtime.
 *
 * On Lambda each one lives in AWS Secrets Manager and the function is given
 * its ARN in `<NAME>_SECRET_ARN` (see infra/secrets.tf). Locally the value can
 * be set directly in `<NAME>` instead (see .env.example).
 *
 * Values are cached for five minutes, so a rotated secret is picked up
 * without a cold start. `refresh` forces a re-read, at most once every 30
 * seconds per secret, for the moment a caller sees a value it does not know.
 */

export type SecretName = "ORIGIN_VERIFY_SECRET" | "JOURNEY_HMAC_KEY" | "USER_REF_HMAC_KEY";

/** Version stages read for a rotating secret: the new value, the live one and the one before. */
export const ROTATION_STAGES = ["AWSCURRENT", "AWSPENDING", "AWSPREVIOUS"] as const;
export type Stage = (typeof ROTATION_STAGES)[number];

/** Reads one stage of a secret; undefined when that stage does not exist. */
export type StageReader = (secretId: string, stage: Stage) => Promise<string | undefined>;

const TTL_MS = 5 * 60_000;
const REFRESH_THROTTLE_MS = 30_000;

type Entry = { values: string[]; fetchedAt: number };

export type SecretStore = {
  /** Every known value of a secret, current first. Empty when it is not configured. */
  values(name: SecretName, options?: { stages?: readonly Stage[]; refresh?: boolean }): Promise<string[]>;
  /** The current value of a secret, or undefined when it is not configured. */
  current(name: SecretName): Promise<string | undefined>;
};

export function createSecretStore(
  readStage: StageReader,
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): SecretStore {
  const cache = new Map<string, Entry>();

  async function values(
    name: SecretName,
    { stages = ["AWSCURRENT"], refresh = false }: { stages?: readonly Stage[]; refresh?: boolean } = {},
  ): Promise<string[]> {
    const direct = env[name];
    if (direct) return [direct];
    const arn = env[`${name}_SECRET_ARN`];
    if (!arn) return [];

    const key = `${name}:${stages.join(",")}`;
    const cached = cache.get(key);
    const age = cached ? now() - cached.fetchedAt : Infinity;
    if (cached && age < (refresh ? REFRESH_THROTTLE_MS : TTL_MS)) return cached.values;

    const read = await Promise.all(stages.map((stage) => readStage(arn, stage)));
    const unique = [...new Set(read.filter((v): v is string => Boolean(v)))];
    cache.set(key, { values: unique, fetchedAt: now() });
    return unique;
  }

  return {
    values,
    current: async (name) => (await values(name))[0],
  };
}

let client: SecretsManagerClient | undefined;

const readFromSecretsManager: StageReader = async (secretId, stage) => {
  client ??= new SecretsManagerClient({});
  try {
    const out = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: stage }));
    return out.SecretString;
  } catch (err) {
    // A stage only exists during or after a rotation.
    if (err instanceof ResourceNotFoundException) return undefined;
    throw err;
  }
};

const globalForSecrets = globalThis as unknown as { __nhsSecrets?: SecretStore };

/** The process-wide store, backed by Secrets Manager. */
export const secrets: SecretStore = (globalForSecrets.__nhsSecrets ??=
  createSecretStore(readFromSecretsManager));
