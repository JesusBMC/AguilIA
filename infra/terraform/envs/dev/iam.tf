# Least-privilege policies for the two Lambda roles (the template had one
# shared LambdaExecutionRole). Logs and X-Ray are added by
# modules/lambda_function. Each statement has its own Sid.
#
# The institutional-rules secret (modules/storage) is deliberately NOT granted
# to any role: no code reads it yet.

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "PutUploads"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${module.storage.documents_bucket_arn}/uploads/*"]
  }

  statement {
    sid       = "GetDrafts"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${module.storage.documents_bucket_arn}/drafts/*"]
  }

  # Without s3:ListBucket, S3 answers 403 AccessDenied (not 404 NoSuchKey) for
  # a missing key, so AwsStorage.get could not return null. Scoped to drafts/.
  statement {
    sid       = "ListDrafts"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [module.storage.documents_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["drafts/*"]
    }
  }

  statement {
    sid       = "TraceabilityReadWrite"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
    resources = [module.storage.traceability_table_arn]
  }

  statement {
    sid       = "FindingsScan"
    effect    = "Allow"
    actions   = ["dynamodb:Scan"]
    resources = [module.storage.findings_table_arn]
  }

  statement {
    sid       = "SendProcessingMessage"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [module.messaging.queue_arn]
  }

  statement {
    sid       = "PutDocumentEvents"
    effect    = "Allow"
    actions   = ["events:PutEvents"]
    resources = [module.messaging.event_bus_arn]
  }

  dynamic "statement" {
    for_each = var.enable_opensearch ? [1] : []

    content {
      sid       = "SearchRead"
      effect    = "Allow"
      actions   = ["es:ESHttpGet", "es:ESHttpPost"]
      resources = ["${local.search_domain_arn}/*"]
    }
  }
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid       = "GetUploads"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${module.storage.documents_bucket_arn}/uploads/*"]
  }

  # Lets S3 answer 404 NoSuchKey (not 403) for a missing upload input, so the
  # worker reports it as "upload input not found". Scoped to uploads/.
  statement {
    sid       = "ListUploads"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [module.storage.documents_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["uploads/*"]
    }
  }

  statement {
    sid     = "PutPipelineOutputs"
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "${module.storage.documents_bucket_arn}/nlp/*",
      "${module.storage.documents_bucket_arn}/drafts/*",
    ]
  }

  statement {
    sid       = "TraceabilityReadWrite"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
    resources = [module.storage.traceability_table_arn]
  }

  statement {
    sid       = "FindingsWrite"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [module.storage.findings_table_arn]
  }

  statement {
    sid    = "ConsumeProcessingQueue"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [module.messaging.queue_arn]
  }

  statement {
    sid       = "PutDocumentEvents"
    effect    = "Allow"
    actions   = ["events:PutEvents"]
    resources = [module.messaging.event_bus_arn]
  }

  # Textract AnalyzeDocument has no resource-level permissions: "*" is required.
  statement {
    sid       = "TextractAnalyze"
    effect    = "Allow"
    actions   = ["textract:AnalyzeDocument"]
    resources = ["*"]
  }

  # Comprehend Detect* APIs have no resource-level permissions: "*" is required.
  statement {
    sid       = "ComprehendDetect"
    effect    = "Allow"
    actions   = ["comprehend:DetectEntities", "comprehend:DetectKeyPhrases"]
    resources = ["*"]
  }

  # Only the configured inference profile and its base model (plan D9).
  statement {
    sid       = "BedrockInvoke"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = local.bedrock_resource_arns
  }

  dynamic "statement" {
    for_each = var.enable_opensearch ? [1] : []

    content {
      sid       = "SearchReadWrite"
      effect    = "Allow"
      actions   = ["es:ESHttpGet", "es:ESHttpPost", "es:ESHttpPut", "es:ESHttpHead"]
      resources = ["${local.search_domain_arn}/*"]
    }
  }
}
