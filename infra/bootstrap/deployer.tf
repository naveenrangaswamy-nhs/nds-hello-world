# The role that deploys the main stack (../), in place of an admin user.
#
# - naveenrcli may only assume this role (aws_iam_user_policy below), using
#   the helloworld-deployer profile in ~/.aws/config.
# - GitHub Actions on main may assume it too, once OIDC is allowed (github.tf).
# - It can touch only this project's resources. Roles it creates must carry
#   the permissions boundary below, so it cannot hand a Lambda more access
#   than the boundary allows, and it cannot change its own permissions: this
#   stack is applied by an administrator.

locals {
  name           = "helloworld-dev"
  account        = var.aws_account_id
  region         = var.aws_region
  deployer_name  = "helloworld-deployer"
  boundary_arn   = "arn:aws:iam::${local.account}:policy/${local.name}-boundary"
  project_roles  = "arn:aws:iam::${local.account}:role/${local.name}-*"
  state_bucket   = aws_s3_bucket.state.arn
  adot_layers    = "arn:aws:lambda:${local.region}:615299751070:layer:*"
  audit_objects  = "arn:aws:s3:::${local.name}-audit-${local.account}/*"
  project_secret = "arn:aws:secretsmanager:${local.region}:${local.account}:secret:helloworld/dev/*"
}

variable "deployer_users" {
  description = "IAM users allowed to assume the deploy role."
  type        = list(string)
  default     = ["naveenrcli"]
}

# ------------------------------------------------------- boundary

# The most any role made by the main stack can ever do.
data "aws_iam_policy_document" "boundary" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:${local.account}:log-group:*"]
  }

  statement {
    sid = "Tracing"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:PutSpans",
      "xray:PutSpansForIndexing",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
      "xray:GetSamplingStatisticSummaries",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ProjectSecrets"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecretVersionStage",
    ]
    resources = [local.project_secret]
  }

  statement {
    sid       = "RandomPassword"
    actions   = ["secretsmanager:GetRandomPassword"]
    resources = ["*"]
  }

  statement {
    sid       = "OriginSecretRotation"
    actions   = ["cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution"]
    resources = ["arn:aws:cloudfront::${local.account}:distribution/*"]
  }

  statement {
    sid = "AuditDelivery"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:PutObject",
    ]
    resources = ["arn:aws:s3:::${local.name}-audit-${local.account}", local.audit_objects]
  }
}

resource "aws_iam_policy" "boundary" {
  name        = "${local.name}-boundary"
  description = "Permissions boundary for every role the helloworld-dev stack creates."
  policy      = data.aws_iam_policy_document.boundary.json
}

# ------------------------------------------------------- deploy role

data "aws_iam_policy_document" "deployer_trust" {
  statement {
    sid     = "Workstation"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "AWS"
      identifiers = [for u in var.deployer_users : "arn:aws:iam::${local.account}:user/${u}"]
    }
  }

  dynamic "statement" {
    for_each = var.enable_github_oidc ? [1] : []

    content {
      sid     = "GitHubMain"
      actions = ["sts:AssumeRoleWithWebIdentity"]

      principals {
        type        = "Federated"
        identifiers = [aws_iam_openid_connect_provider.github[0].arn]
      }

      condition {
        test     = "StringEquals"
        variable = "token.actions.githubusercontent.com:aud"
        values   = ["sts.amazonaws.com"]
      }

      condition {
        test     = "StringEquals"
        variable = "token.actions.githubusercontent.com:sub"
        values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
      }
    }
  }
}

resource "aws_iam_role" "deployer" {
  name                 = local.deployer_name
  description          = "Deploys the helloworld-dev stack."
  assume_role_policy   = data.aws_iam_policy_document.deployer_trust.json
  max_session_duration = 3600
}

# State, project buckets, Lambda and IAM: the parts with real blast radius,
# scoped by name and guarded by the boundary.
data "aws_iam_policy_document" "deployer_core" {
  statement {
    sid       = "StateList"
    actions   = ["s3:ListBucket"]
    resources = [local.state_bucket]
  }

  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.state_bucket}/dev/*"]
  }

  statement {
    sid     = "ProjectBuckets"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${local.name}-*",
      "arn:aws:s3:::${local.name}-*/*",
    ]
  }

  statement {
    sid    = "KeepAuditRecords"
    effect = "Deny"
    actions = [
      "s3:BypassGovernanceRetention",
      "s3:DeleteObjectVersion",
      "s3:PutObjectRetention",
    ]
    resources = [local.audit_objects]
  }

  statement {
    sid       = "ProjectFunctions"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${local.region}:${local.account}:function:${local.name}-*"]
  }

  statement {
    sid       = "TracingLayer"
    actions   = ["lambda:GetLayerVersion"]
    resources = [local.adot_layers]
  }

  statement {
    sid = "ProjectRolesRead"
    actions = [
      "iam:GetRole",
      "iam:ListRolePolicies",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRoleTags",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
      "iam:UpdateAssumeRolePolicy",
      "iam:DeleteRole",
    ]
    resources = [local.project_roles]
  }

  # Creating or changing what a project role may do needs the boundary on it.
  statement {
    sid = "ProjectRolesWithBoundary"
    actions = [
      "iam:CreateRole",
      "iam:PutRolePermissionsBoundary",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
    ]
    resources = [local.project_roles]

    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [local.boundary_arn]
    }
  }

  statement {
    sid       = "NoBoundaryRemoval"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary"]
    resources = ["*"]
  }

  statement {
    sid       = "PassProjectRoles"
    actions   = ["iam:PassRole"]
    resources = [local.project_roles]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  statement {
    sid       = "ReadPolicies"
    actions   = ["iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions"]
    resources = ["arn:aws:iam::aws:policy/*", local.boundary_arn]
  }
}

resource "aws_iam_policy" "deployer_core" {
  name   = "${local.deployer_name}-core"
  policy = data.aws_iam_policy_document.deployer_core.json
}

# Edge, monitoring and secrets. CloudFront, WAF and ACM IDs are generated,
# so those three are granted service-wide; this account holds only this app.
data "aws_iam_policy_document" "deployer_services" {
  statement {
    sid       = "Edge"
    actions   = ["cloudfront:*", "wafv2:*", "acm:*"]
    resources = ["*"]
  }

  statement {
    sid     = "ProjectLogGroups"
    actions = ["logs:*"]
    resources = [
      "arn:aws:logs:*:${local.account}:log-group:/aws/lambda/${local.name}-*",
      "arn:aws:logs:*:${local.account}:log-group:aws-waf-logs-${local.name}*",
    ]
  }

  statement {
    sid = "LogsAccountLevel"
    actions = [
      "logs:DescribeLogGroups",
      "logs:DescribeResourcePolicies",
      "logs:PutResourcePolicy",
      "logs:DeleteResourcePolicy",
      "logs:DescribeQueryDefinitions",
      "logs:PutQueryDefinition",
      "logs:DeleteQueryDefinition",
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:StartQuery",
      "logs:GetQueryResults",
    ]
    resources = ["*"]
  }

  statement {
    sid     = "ProjectAlarmsAndDashboard"
    actions = ["cloudwatch:*"]
    resources = [
      "arn:aws:cloudwatch:*:${local.account}:alarm:${local.name}-*",
      "arn:aws:cloudwatch::${local.account}:dashboard/${local.name}",
    ]
  }

  statement {
    sid       = "CloudWatchRead"
    actions   = ["cloudwatch:Describe*", "cloudwatch:Get*", "cloudwatch:List*"]
    resources = ["*"]
  }

  statement {
    sid       = "ProjectTopics"
    actions   = ["sns:*"]
    resources = ["arn:aws:sns:*:${local.account}:${local.name}-*"]
  }

  statement {
    sid       = "ProjectSecrets"
    actions   = ["secretsmanager:*"]
    resources = [local.project_secret]
  }

  statement {
    sid       = "SecretsAccountLevel"
    actions   = ["secretsmanager:GetRandomPassword", "secretsmanager:ListSecrets"]
    resources = ["*"]
  }

  statement {
    sid       = "TraceRead"
    actions   = ["xray:GetTraceSummaries", "xray:BatchGetTraces"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "deployer_services" {
  name   = "${local.deployer_name}-services"
  policy = data.aws_iam_policy_document.deployer_services.json
}

resource "aws_iam_role_policy_attachment" "deployer" {
  for_each = {
    core     = aws_iam_policy.deployer_core.arn
    services = aws_iam_policy.deployer_services.arn
  }
  role       = aws_iam_role.deployer.name
  policy_arn = each.value
}

# What the workstation user is left with once AdministratorAccess is removed.
data "aws_iam_policy_document" "assume_deployer" {
  statement {
    actions   = ["sts:AssumeRole", "sts:TagSession"]
    resources = [aws_iam_role.deployer.arn]
  }
}

resource "aws_iam_user_policy" "assume_deployer" {
  for_each = toset(var.deployer_users)
  name     = "assume-${local.deployer_name}"
  user     = each.value
  policy   = data.aws_iam_policy_document.assume_deployer.json
}

output "deployer_role_arn" {
  value = aws_iam_role.deployer.arn
}
