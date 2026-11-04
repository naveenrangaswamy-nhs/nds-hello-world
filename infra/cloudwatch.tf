# Monitoring built on the structured JSON logs the app already writes
# (see lib/logger.ts and proxy.ts). Metrics come from log metric filters, so
# there is no extra code or agent in the function.

locals {
  metric_namespace = "${var.project}/${var.environment}"
  log_group        = aws_cloudwatch_log_group.server.name
}

# ---------------------------------------------------------------- metrics

resource "aws_cloudwatch_log_metric_filter" "app_errors" {
  name           = "app-errors"
  log_group_name = local.log_group
  pattern        = "{ $.level = \"error\" || $.level = \"fatal\" }"

  metric_transformation {
    name          = "AppErrors"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "app_warnings" {
  name           = "app-warnings"
  log_group_name = local.log_group
  pattern        = "{ $.level = \"warn\" }"

  metric_transformation {
    name          = "AppWarnings"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "requests" {
  name           = "http-requests"
  log_group_name = local.log_group
  pattern        = "{ $.event = \"http.request\" }"

  metric_transformation {
    name          = "PageRequests"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "cold_starts" {
  name           = "cold-starts"
  log_group_name = local.log_group
  pattern        = "{ $.event = \"lambda.cold_start\" }"

  metric_transformation {
    name          = "ColdStarts"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "render_time" {
  name           = "render-time"
  log_group_name = local.log_group
  pattern        = "{ $.event = \"page.render\" }"

  metric_transformation {
    name      = "RenderTimeMs"
    namespace = local.metric_namespace
    value     = "$.elapsedMs"
    unit      = "Milliseconds"
  }
}

# ----------------------------------------------------------------- alarms

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${local.name}-lambda-errors"
  alarm_description   = "The function failed to handle a request (unhandled error, timeout or crash)."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.server.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name          = "${local.name}-lambda-throttles"
  alarm_description   = "Requests were rejected because the account concurrency limit was reached."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = aws_lambda_function.server.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_slow" {
  alarm_name          = "${local.name}-lambda-slow"
  alarm_description   = "p95 invocation duration has been high for 15 minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  dimensions          = { FunctionName = aws_lambda_function.server.function_name }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.slow_duration_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "app_errors" {
  alarm_name          = "${local.name}-app-errors"
  alarm_description   = "The app wrote error-level log lines (handled errors, failed renders)."
  namespace           = local.metric_namespace
  metric_name         = "AppErrors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.app_errors]
}

# -------------------------------------------------------------- dashboard

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 8, height = 6
        properties = {
          title  = "Page requests and cold starts"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
          metrics = [
            [local.metric_namespace, "PageRequests"],
            [local.metric_namespace, "ColdStarts"],
          ]
        }
      },
      {
        type = "metric", x = 8, y = 0, width = 8, height = 6
        properties = {
          title  = "Errors, warnings and throttles"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
          metrics = [
            [local.metric_namespace, "AppErrors"],
            [local.metric_namespace, "AppWarnings"],
            ["AWS/Lambda", "Errors", "FunctionName", aws_lambda_function.server.function_name],
            ["AWS/Lambda", "Throttles", "FunctionName", aws_lambda_function.server.function_name],
          ]
        }
      },
      {
        type = "metric", x = 16, y = 0, width = 8, height = 6
        properties = {
          title  = "Page render time (ms)"
          region = var.aws_region
          view   = "timeSeries"
          period = 300
          metrics = [
            [local.metric_namespace, "RenderTimeMs", { stat = "p50", label = "p50" }],
            [local.metric_namespace, "RenderTimeMs", { stat = "p95", label = "p95" }],
            [local.metric_namespace, "RenderTimeMs", { stat = "Maximum", label = "max" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 8, height = 6
        properties = {
          title  = "Lambda duration (ms)"
          region = var.aws_region
          view   = "timeSeries"
          period = 300
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.server.function_name, { stat = "p50", label = "p50" }],
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.server.function_name, { stat = "p95", label = "p95" }],
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.server.function_name, { stat = "p99", label = "p99" }],
          ]
        }
      },
      {
        type = "metric", x = 8, y = 6, width = 8, height = 6
        properties = {
          title  = "Concurrent executions"
          region = var.aws_region
          view   = "timeSeries"
          period = 60
          metrics = [
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", aws_lambda_function.server.function_name, { stat = "Maximum" }],
          ]
        }
      },
      {
        type = "alarm", x = 16, y = 6, width = 8, height = 6
        properties = {
          title = "Alarms"
          alarms = [
            aws_cloudwatch_metric_alarm.lambda_errors.arn,
            aws_cloudwatch_metric_alarm.lambda_throttles.arn,
            aws_cloudwatch_metric_alarm.lambda_slow.arn,
            aws_cloudwatch_metric_alarm.app_errors.arn,
          ]
        }
      },
      {
        type = "log", x = 0, y = 12, width = 24, height = 8
        properties = {
          title  = "Recent errors and warnings"
          region = var.aws_region
          view   = "table"
          query  = "SOURCE '${local.log_group}' | fields @timestamp, level, event, path, requestId, error.message | filter level in [\"error\", \"fatal\", \"warn\"] | sort @timestamp desc | limit 50"
        }
      },
    ]
  })
}

# ------------------------------------------------------ saved Logs Insights

resource "aws_cloudwatch_query_definition" "errors" {
  name            = "${var.project}/${var.environment}/errors"
  log_group_names = [local.log_group]
  query_string    = <<-EOT
    fields @timestamp, level, event, path, requestId, error.name, error.message
    | filter level in ["error", "fatal"]
    | sort @timestamp desc
    | limit 100
  EOT
}

resource "aws_cloudwatch_query_definition" "slow_renders" {
  name            = "${var.project}/${var.environment}/slow-renders"
  log_group_names = [local.log_group]
  query_string    = <<-EOT
    fields @timestamp, path, elapsedMs, requestId
    | filter event = "page.render" and elapsedMs > 1000
    | sort elapsedMs desc
    | limit 50
  EOT
}

resource "aws_cloudwatch_query_definition" "trace_request" {
  name            = "${var.project}/${var.environment}/trace-one-request"
  log_group_names = [local.log_group]
  query_string    = <<-EOT
    # Replace the value with the x-request-id response header from the page.
    fields @timestamp, level, event, path, message, elapsedMs
    | filter requestId = "PASTE-REQUEST-ID-HERE"
    | sort @timestamp asc
  EOT
}

resource "aws_cloudwatch_query_definition" "traffic_by_path" {
  name            = "${var.project}/${var.environment}/traffic-by-path"
  log_group_names = [local.log_group]
  query_string    = <<-EOT
    filter event = "http.request"
    | stats count(*) as requests by path, bin(1h)
    | sort requests desc
  EOT
}
