variable "project" {
  type    = string
  default = "helloworld"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-2"
}

variable "aws_account_id" {
  type    = string
  default = "740314716605"
}

variable "app_version" {
  description = "Reported in logs and traces as `version`. deploy.sh sets it to the git SHA."
  type        = string
  default     = "dev"
}

variable "lambda_memory_mb" {
  type    = number
  default = 1024
}

variable "lambda_timeout_s" {
  type    = number
  default = 30
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "log_level" {
  type    = string
  default = "info"
}

variable "alarm_email" {
  description = "Address that receives alarm notifications. Leave null to create the topic without a subscriber."
  type        = string
  default     = null
}

variable "slow_duration_ms" {
  description = "p95 Lambda duration above which the slow-function alarm fires."
  type        = number
  default     = 10000
}

variable "domain_name" {
  description = "Custom domain served by CloudFront."
  type        = string
  default     = "hw.nhs-demo.com"
}

variable "attach_domain" {
  description = "Two-step switch. false: only request the certificate. true: wait for DNS validation, then serve the domain."
  type        = bool
  default     = false
}

variable "adot_layer_arn" {
  description = "ADOT Lambda layer for Node.js (Application Signals). Set to null to turn tracing instrumentation off."
  type        = string
  default     = "arn:aws:lambda:ap-southeast-2:615299751070:layer:AWSOpenTelemetryDistroJs:16"
}

variable "waf_rate_limit" {
  description = "Requests per IP per 5 minutes before WAF blocks the IP."
  type        = number
  default     = 1000
}
