# Bootstrap root: run ONCE per AWS account, before any environment.
# It keeps its own state LOCALLY (terraform.tfstate here, gitignored) because
# the S3 state bucket it creates cannot store its own state before it exists.
terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.9"
    }
  }
}
