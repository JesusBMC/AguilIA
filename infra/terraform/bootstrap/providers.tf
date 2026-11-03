# Credentials come from the standard AWS chain (AWS_PROFILE, env vars, SSO).
# No profile is hardcoded so the same code works on any machine.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "AgilIA"
      Environment = "shared"
      ManagedBy   = "terraform"
    }
  }
}
