#!/usr/bin/env bash
# Build the app for Lambda, apply the infrastructure, then publish static files.
#
#   AWS_PROFILE=default ./infra/deploy.sh
#
# Terraform asks for confirmation before it changes anything.
set -euo pipefail

cd "$(dirname "$0")/.."

export AWS_PROFILE="${AWS_PROFILE:-default}"
export TF_VAR_app_version="${TF_VAR_app_version:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"

npm run build:lambda

terraform -chdir=infra init -input=false
terraform -chdir=infra apply

bucket=$(terraform -chdir=infra output -raw assets_bucket)
distribution=$(terraform -chdir=infra output -raw distribution_id)

# Hashed files never change under the same name, so cache them for a year.
aws s3 sync .open-next/assets "s3://${bucket}/_assets" \
  --exclude "_next/static/*" --exclude BUILD_ID --delete \
  --cache-control "public, max-age=3600"
aws s3 sync .open-next/assets/_next/static "s3://${bucket}/_assets/_next/static" \
  --cache-control "public, max-age=31536000, immutable" --delete
aws s3 cp .open-next/assets/BUILD_ID "s3://${bucket}/_assets/BUILD_ID" \
  --cache-control "no-cache"

# /assets/* is not content-hashed, so make sure edge copies are refreshed.
aws cloudfront create-invalidation --distribution-id "$distribution" --paths "/assets/*" >/dev/null

echo "Deployed ${TF_VAR_app_version}: $(terraform -chdir=infra output -raw url)"
