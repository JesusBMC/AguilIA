# Documents bucket, DynamoDB tables and the optional institutional-rules secret.
# Parity with the removed CloudFormation template: DocumentsBucket, TraceabilityTable, FindingsTable,
# InstitutionalRulesSecret.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# ---------------------------------------------------------------------------
# S3: documents (uploads/, nlp/, drafts/ prefixes)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "documents" {
  bucket        = var.documents_bucket_name
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  # GLACIER_IR instead of the template's GLACIER: old drafts stay readable
  # with a plain GetObject (no restore), so GET /documents/{id}/draft works.
  rule {
    id     = "archive-old-drafts"
    status = "Enabled"

    filter {
      prefix = "drafts/"
    }

    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }
  }

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.documents]
}

data "aws_iam_policy_document" "documents" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id
  policy = data.aws_iam_policy_document.documents.json

  depends_on = [aws_s3_bucket_public_access_block.documents]
}

# ---------------------------------------------------------------------------
# DynamoDB
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "traceability" {
  name                        = var.traceability_table_name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "PK"
  range_key                   = "SK"
  deletion_protection_enabled = false

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    projection_type = "ALL"

    key_schema {
      attribute_name = "GSI1PK"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "GSI1SK"
      key_type       = "RANGE"
    }
  }

  point_in_time_recovery {
    enabled = var.enable_pitr
  }

  server_side_encryption {
    enabled = true
  }
}

resource "aws_dynamodb_table" "findings" {
  name                        = var.findings_table_name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "documentId"
  range_key                   = "findingId"
  deletion_protection_enabled = false

  attribute {
    name = "documentId"
    type = "S"
  }

  attribute {
    name = "findingId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.enable_pitr
  }

  server_side_encryption {
    enabled = true
  }
}

# ---------------------------------------------------------------------------
# Secrets Manager: institutional rules placeholder (no code reads it yet,
# so no IAM role is granted access to it).
# ---------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "rules" {
  count = var.enable_rules_secret ? 1 : 0

  name                    = var.rules_secret_name
  description             = "Reglas institucionales y formatos de validacion para documentos de adquisicion"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "rules" {
  count = var.enable_rules_secret ? 1 : 0

  secret_id = aws_secretsmanager_secret.rules[0].id
  # Same non-sensitive placeholder as the removed CloudFormation template.
  secret_string = "{\"version\": \"1.0\", \"rules\": [], \"formats\": []}"
}
