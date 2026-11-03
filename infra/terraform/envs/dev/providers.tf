# Credentials come from the standard AWS chain. Set AWS_PROFILE before
# `terraform init`: both the S3 backend and this provider read it.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "AgilIA"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
