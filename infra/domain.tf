# Custom domain. DNS is hosted outside AWS (BigRock), so the records below are
# added by hand. Two steps:
#   1. attach_domain = false: request the certificate and print the DNS records.
#   2. attach_domain = true:  once the validation record is in DNS, wait for the
#      certificate to issue and serve the domain from CloudFront.

resource "aws_acm_certificate" "site" {
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "site" {
  count    = var.attach_domain ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for o in aws_acm_certificate.site.domain_validation_options : o.resource_record_name]
}
