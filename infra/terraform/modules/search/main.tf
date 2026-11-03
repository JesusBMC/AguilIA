# OPTIONAL OpenSearch managed domain (the root sets count = var.enable_opensearch).
# Parity with the removed CloudFormation template: OpenSearchDomain, with two deliberate changes
# (plan D4): no VPC (it would need a NAT Gateway) and no master user (no
# password parameter). Access is IAM-only: every request must be SigV4-signed
# by one of var.allowed_role_arns. The endpoint is public but useless without
# those credentials; data is encrypted in transit and at rest.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

locals {
  domain_arn = "arn:aws:es:${var.region}:${var.account_id}:domain/${var.domain_name}"
}

data "aws_iam_policy_document" "access" {
  statement {
    sid       = "AllowLambdaRolesHttp"
    effect    = "Allow"
    actions   = ["es:ESHttp*"]
    resources = ["${local.domain_arn}/*"]

    principals {
      type        = "AWS"
      identifiers = var.allowed_role_arns
    }
  }
}

resource "aws_opensearch_domain" "this" {
  domain_name = var.domain_name
  # Por confirmar: aws opensearch list-versions --region us-east-2
  engine_version = var.engine_version

  cluster_config {
    instance_type            = var.instance_type
    instance_count           = 1
    dedicated_master_enabled = false
    zone_awareness_enabled   = false
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.volume_size_gb
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  access_policies = data.aws_iam_policy_document.access.json
}
