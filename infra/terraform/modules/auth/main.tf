# Cognito user pool, groups, hosted-UI domain and the SPA client.
# Parity with the removed CloudFormation template: UserPool, UserPoolClient, PublicServersGroup,
# BolsaTeamGroup (+ new domain for the hosted-UI login, plan D7).

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

resource "aws_cognito_user_pool" "this" {
  name                     = var.user_pool_name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "INACTIVE"
  user_pool_tier           = "LITE"

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  # Only administrators create users: no self sign-up, which also protects
  # the Bedrock spend.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  schema {
    name                = "role"
    attribute_data_type = "String"
    mutable             = true

    string_attribute_constraints {
      max_length = "50"
    }
  }

  schema {
    name                = "organization"
    attribute_data_type = "String"
    mutable             = true

    string_attribute_constraints {
      max_length = "100"
    }
  }

  lifecycle {
    # Known provider churn on custom attributes; Cognito cannot modify them anyway.
    ignore_changes = [schema]
  }
}

resource "aws_cognito_user_group" "public_servers" {
  name         = "PublicServers"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Servidores publicos que preparan documentacion de adquisiciones"
}

resource "aws_cognito_user_group" "bolsa_team" {
  name         = "BolsaTeam"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Equipos de la Bolsa que revisan y validan documentacion"
}

# Classic hosted UI (managed_login_version = 1).
resource "aws_cognito_user_pool_domain" "this" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.this.id
  managed_login_version = 1
}

resource "aws_cognito_user_pool_client" "spa" {
  name            = var.client_name
  user_pool_id    = aws_cognito_user_pool.this.id
  generate_secret = false

  # ADMIN_USER_PASSWORD_AUTH needs IAM credentials; it enables the CLI smoke test.
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
  ]
  prevent_user_existence_errors = "ENABLED"

  # Authorization-code flow with PKCE from the SPA (web/app.js).
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = concat(["${var.app_url}/"], var.extra_callback_urls)
  logout_urls                          = concat(["${var.app_url}/"], var.extra_callback_urls)

  id_token_validity = 60

  token_validity_units {
    id_token = "minutes"
  }
}
