# GitHub Actions deploys through OIDC: short-lived credentials, no AWS keys
# stored in GitHub.
#
# Off by default. An AWS Organizations SCP currently denies every IAM OIDC
# provider action in this account. Once the org admin grants an exception,
# set enable_github_oidc = true, apply this stack, then set the repository
# variables AWS_DEPLOY_ROLE_ARN and AWS_PLAN_ROLE_ARN to the outputs below;
# .github/workflows/deploy.yml starts running when they exist.
#
# - Pull requests get helloworld-github-plan: read-only, plus the state lock.
#   Pull requests from forks get no OIDC token, so they cannot use it.
# - Pushes to main use helloworld-deployer (deployer.tf).

variable "enable_github_oidc" {
  type    = bool
  default = false
}

variable "github_repository" {
  type    = string
  default = "naveenrangaswamy-nhs/nds-hello-world"
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.enable_github_oidc ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_plan_trust" {
  count = var.enable_github_oidc ? 1 : 0

  statement {
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
      values   = ["repo:${var.github_repository}:pull_request"]
    }
  }
}

resource "aws_iam_role" "github_plan" {
  count                = var.enable_github_oidc ? 1 : 0
  name                 = "helloworld-github-plan"
  description          = "terraform plan for pull requests on ${var.github_repository}."
  assume_role_policy   = data.aws_iam_policy_document.github_plan_trust[0].json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "github_plan_read" {
  count      = var.enable_github_oidc ? 1 : 0
  role       = aws_iam_role.github_plan[0].name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# A plan takes the state lock and refreshes the secret versions.
data "aws_iam_policy_document" "github_plan_extra" {
  statement {
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.state_bucket}/dev/terraform.tfstate.tflock"]
  }

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.project_secret]
  }
}

resource "aws_iam_role_policy" "github_plan_extra" {
  count  = var.enable_github_oidc ? 1 : 0
  name   = "plan-extras"
  role   = aws_iam_role.github_plan[0].id
  policy = data.aws_iam_policy_document.github_plan_extra.json
}

output "github_plan_role_arn" {
  value = var.enable_github_oidc ? aws_iam_role.github_plan[0].arn : null
}
