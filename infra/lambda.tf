locals {
  name = "${var.project}-${var.environment}"

  # `npm run build:lambda` writes the server function here.
  server_dir = "${path.module}/../.open-next/server-functions/default"

  # Every role this stack creates must carry the boundary made by
  # infra/bootstrap; the deploy role cannot create or change roles without it.
  permissions_boundary = "arn:aws:iam::${var.aws_account_id}:policy/${local.name}-boundary"
}

data "archive_file" "server" {
  type        = "zip"
  source_dir  = local.server_dir
  output_path = "${path.module}/.build/server.zip"
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/aws/lambda/${local.name}-server"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "server" {
  name                 = "${local.name}-server"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume.json
  permissions_boundary = local.permissions_boundary
}

data "aws_iam_policy_document" "server_logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.server.arn}:*"]
  }

  # lib/secrets.ts reads these at runtime.
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [aws_secretsmanager_secret.origin_verify.arn],
      [for s in aws_secretsmanager_secret.hmac : s.arn],
    )
  }
}

resource "aws_iam_role_policy" "server_logs" {
  name   = "logs"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server_logs.json
}

# Lets active tracing send segments to X-Ray.
resource "aws_iam_role_policy_attachment" "server_xray" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# Lets the ADOT layer send traces and Application Signals metrics.
resource "aws_iam_role_policy_attachment" "server_app_signals" {
  count      = var.adot_layer_arn == null ? 0 : 1
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy"
}

resource "aws_lambda_function" "server" {
  function_name = "${local.name}-server"
  role          = aws_iam_role.server.arn

  filename         = data.archive_file.server.output_path
  source_code_hash = data.archive_file.server.output_base64sha256

  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = var.lambda_memory_mb
  timeout       = var.lambda_timeout_s

  # OpenTelemetry auto-instrumentation. With it, lib/telemetry.ts runs in
  # "layer" mode and Next.js spans go to X-Ray / Application Signals.
  layers = var.adot_layer_arn == null ? [] : [var.adot_layer_arn]

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.server.name
  }

  environment {
    variables = merge({
      NODE_ENV     = "production"
      SERVICE_NAME = "nhs-helloworld"
      APP_ENV      = var.environment
      APP_VERSION  = var.app_version
      LOG_LEVEL    = var.log_level

      ORIGIN_VERIFY_SECRET_SECRET_ARN = aws_secretsmanager_secret.origin_verify.arn
      JOURNEY_HMAC_KEY_SECRET_ARN     = aws_secretsmanager_secret.hmac["journey-hmac-key"].arn
      USER_REF_HMAC_KEY_SECRET_ARN    = aws_secretsmanager_secret.hmac["user-ref-hmac-key"].arn
      }, var.adot_layer_arn == null ? {} : {
      AWS_LAMBDA_EXEC_WRAPPER = "/opt/otel-instrument"
      OTEL_SERVICE_NAME       = "nhs-helloworld"
    })
  }

  # New code reads the secrets at start-up and refuses requests without them.
  depends_on = [
    aws_iam_role_policy.server_logs,
    aws_secretsmanager_secret_version.origin_verify,
    aws_secretsmanager_secret_version.hmac,
  ]
}

# CloudFront reaches the function through this URL. It is public at the
# network level: IAM auth (OAC) would reject browser POSTs, because they do
# not carry an x-amz-content-sha256 header. Instead the app only serves
# requests carrying the CloudFront origin secret.
resource "aws_lambda_function_url" "server" {
  function_name      = aws_lambda_function.server.function_name
  authorization_type = "NONE"
  invoke_mode        = "BUFFERED"
}

# Public Function URLs need both permissions.
resource "aws_lambda_permission" "public_invoke_url" {
  statement_id           = "AllowPublicInvokeFunctionUrl"
  function_name          = aws_lambda_function.server.function_name
  action                 = "lambda:InvokeFunctionUrl"
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "public_invoke_function" {
  statement_id             = "AllowPublicInvokeFunctionViaUrl"
  function_name            = aws_lambda_function.server.function_name
  action                   = "lambda:InvokeFunction"
  principal                = "*"
  invoked_via_function_url = true
}
