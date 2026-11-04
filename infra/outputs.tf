output "url" {
  description = "Public URL of the site."
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "assets_bucket" {
  value = aws_s3_bucket.assets.bucket
}

output "function_name" {
  value = aws_lambda_function.server.function_name
}

output "log_group" {
  value = aws_cloudwatch_log_group.server.name
}

output "dashboard_url" {
  value = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards/dashboard/${aws_cloudwatch_dashboard.main.dashboard_name}"
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}

output "dns_records" {
  description = "Records to create at the DNS provider."
  value = {
    certificate_validation = [
      for o in aws_acm_certificate.site.domain_validation_options : {
        type  = o.resource_record_type
        name  = o.resource_record_name
        value = o.resource_record_value
      }
    ]
    site = {
      type  = "CNAME"
      name  = var.domain_name
      value = aws_cloudfront_distribution.main.domain_name
    }
  }
}

output "audit_bucket" {
  value = aws_s3_bucket.audit.bucket
}

output "origin_secret_arn" {
  value = aws_secretsmanager_secret.origin_verify.arn
}
