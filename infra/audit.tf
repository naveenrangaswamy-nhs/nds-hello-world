# The audit trail (lib/audit.ts). Audit lines are copied out of the app log
# group by a subscription filter into an S3 bucket with Object Lock, so they
# outlive the 30-day app logs and cannot be changed or deleted while their
# retention runs.
#
#   app log group --{ $.log_type = "audit" }--> archiver Lambda --> S3 (Object Lock)
#
# (Firehose would be the usual middle step, but an org policy denies it in
# this account, so a small Lambda does the same job.)
#
# GOVERNANCE mode: in dev, someone with s3:BypassGovernanceRetention can still
# remove records (the deploy role is denied it). Use COMPLIANCE for live data;
# it cannot be undone or shortened, even by the account root.

resource "aws_s3_bucket" "audit" {
  bucket              = "${local.name}-audit-${data.aws_caller_identity.current.account_id}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    default_retention {
      mode = var.audit_lock_mode
      days = var.audit_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.audit]
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Records are removed once their lock has run out.
resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    id     = "expire-after-retention"
    status = "Enabled"

    filter {}

    expiration {
      days = var.audit_retention_days + 1
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.audit]
}

# ------------------------------------------------------- archiver

data "archive_file" "audit_archiver" {
  type        = "zip"
  source_file = "${path.module}/audit-archiver/index.mjs"
  output_path = "${path.module}/.build/audit-archiver.zip"
}

resource "aws_cloudwatch_log_group" "audit_archiver" {
  name              = "/aws/lambda/${local.name}-audit-archiver"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "audit_archiver" {
  name                 = "${local.name}-audit-archiver"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume.json
  permissions_boundary = local.permissions_boundary
}

data "aws_iam_policy_document" "audit_archiver" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.audit_archiver.arn}:*"]
  }

  # Write only: the archiver cannot read, overwrite retention or delete.
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/audit/*"]
  }
}

resource "aws_iam_role_policy" "audit_archiver" {
  name   = "archive-audit"
  role   = aws_iam_role.audit_archiver.id
  policy = data.aws_iam_policy_document.audit_archiver.json
}

resource "aws_lambda_function" "audit_archiver" {
  function_name = "${local.name}-audit-archiver"
  role          = aws_iam_role.audit_archiver.arn

  filename         = data.archive_file.audit_archiver.output_path
  source_code_hash = data.archive_file.audit_archiver.output_base64sha256

  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  timeout       = 30

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.audit_archiver.name
  }

  environment {
    variables = {
      BUCKET = aws_s3_bucket.audit.bucket
    }
  }

  depends_on = [aws_iam_role_policy.audit_archiver]
}

# ------------------------------------------------------- subscription

resource "aws_lambda_permission" "audit_archiver" {
  statement_id   = "AllowLogsToInvokeArchiver"
  function_name  = aws_lambda_function.audit_archiver.function_name
  action         = "lambda:InvokeFunction"
  principal      = "logs.amazonaws.com"
  source_arn     = "${aws_cloudwatch_log_group.server.arn}:*"
  source_account = var.aws_account_id
}

resource "aws_cloudwatch_log_subscription_filter" "audit" {
  name            = "audit-to-s3"
  log_group_name  = aws_cloudwatch_log_group.server.name
  filter_pattern  = "{ $.log_type = \"audit\" }"
  destination_arn = aws_lambda_function.audit_archiver.arn

  depends_on = [aws_lambda_permission.audit_archiver]
}

# If the archiver fails, the audit lines are still in the app log group for
# 30 days and can be replayed; this alarm is how anyone finds out.
resource "aws_cloudwatch_metric_alarm" "audit_archiver_errors" {
  alarm_name          = "${local.name}-audit-archiver-errors"
  alarm_description   = "Audit records failed to reach the Object Lock bucket. Replay them from the app log group within 30 days."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.audit_archiver.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
