# Secrets the app reads at runtime (lib/secrets.ts). The Lambda gets each
# one's ARN, never its value, in an environment variable.

locals {
  secret_prefix = "${var.project}/${var.environment}"
  origin_header = "x-origin-verify"
}

# ------------------------------------------------------- origin secret

# The CloudFront origin secret (lib/origin-verify.ts). Terraform only seeds
# the first value; after that the rotation Lambda owns it.
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "origin_verify" {
  name                    = "${local.secret_prefix}/origin-verify"
  description             = "Shared secret CloudFront sends in ${local.origin_header}; rotated every ${var.origin_secret_rotation_days} days."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "origin_verify" {
  secret_id     = aws_secretsmanager_secret.origin_verify.id
  secret_string = random_password.origin_verify.result

  # Rotation replaces the value and moves the stage labels.
  lifecycle {
    ignore_changes = [secret_string, version_stages]
  }
}

# What CloudFront sends. Read from the secret, so after a rotation (which
# updates CloudFront itself) Terraform sees no difference.
data "aws_secretsmanager_secret_version" "origin_verify" {
  secret_id     = aws_secretsmanager_secret.origin_verify.id
  version_stage = "AWSCURRENT"

  depends_on = [aws_secretsmanager_secret_version.origin_verify]
}

# ------------------------------------------------------- HMAC keys

# Keys for the pseudonyms in lib/journey.ts and lib/audit.ts. Not rotated:
# a new key would give everyone a new userRef and break the audit trail's
# continuity. Rotating them is a deliberate, planned change.
resource "random_password" "hmac" {
  for_each = toset(["journey-hmac-key", "user-ref-hmac-key"])
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "hmac" {
  for_each                = random_password.hmac
  name                    = "${local.secret_prefix}/${each.key}"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "hmac" {
  for_each      = random_password.hmac
  secret_id     = aws_secretsmanager_secret.hmac[each.key].id
  secret_string = each.value.result
}

# ------------------------------------------------------- rotation

data "archive_file" "rotation" {
  type        = "zip"
  source_file = "${path.module}/rotation/index.mjs"
  output_path = "${path.module}/.build/rotation.zip"
}

resource "aws_cloudwatch_log_group" "rotation" {
  name              = "/aws/lambda/${local.name}-origin-secret-rotation"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "rotation" {
  name                 = "${local.name}-origin-secret-rotation"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume.json
  permissions_boundary = local.permissions_boundary
}

data "aws_iam_policy_document" "rotation" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.rotation.arn}:*"]
  }

  statement {
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecretVersionStage",
    ]
    resources = [aws_secretsmanager_secret.origin_verify.arn]
  }

  statement {
    actions   = ["secretsmanager:GetRandomPassword"]
    resources = ["*"]
  }

  statement {
    actions   = ["cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution"]
    resources = [aws_cloudfront_distribution.main.arn]
  }
}

resource "aws_iam_role_policy" "rotation" {
  name   = "rotate-origin-secret"
  role   = aws_iam_role.rotation.id
  policy = data.aws_iam_policy_document.rotation.json
}

resource "aws_lambda_function" "rotation" {
  function_name = "${local.name}-origin-secret-rotation"
  role          = aws_iam_role.rotation.arn

  filename         = data.archive_file.rotation.output_path
  source_code_hash = data.archive_file.rotation.output_base64sha256

  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  timeout       = 60

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.rotation.name
  }

  environment {
    variables = {
      DISTRIBUTION_ID = aws_cloudfront_distribution.main.id
      ORIGIN_ID       = "server"
      HEADER_NAME     = local.origin_header
    }
  }

  depends_on = [aws_iam_role_policy.rotation]
}

resource "aws_lambda_permission" "rotation" {
  statement_id   = "AllowSecretsManagerRotation"
  function_name  = aws_lambda_function.rotation.function_name
  action         = "lambda:InvokeFunction"
  principal      = "secretsmanager.amazonaws.com"
  source_arn     = aws_secretsmanager_secret.origin_verify.arn
  source_account = var.aws_account_id
}

resource "aws_secretsmanager_secret_rotation" "origin_verify" {
  secret_id           = aws_secretsmanager_secret.origin_verify.id
  rotation_lambda_arn = aws_lambda_function.rotation.arn

  # The first rotation is run by hand after deploying, to watch it work.
  rotate_immediately = false

  rotation_rules {
    automatically_after_days = var.origin_secret_rotation_days
  }

  depends_on = [aws_lambda_permission.rotation]
}
