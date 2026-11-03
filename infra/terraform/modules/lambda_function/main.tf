# Reusable Lambda: log group, own least-privilege role, published version and
# a "live" alias (rollback = re-point the alias, plan D11).

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "assume" {
  statement {
    sid     = "LambdaAssumeRole"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "${var.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Logs only on the function's own log group (no AWSLambdaBasicExecutionRole,
# which allows logs:* on every group).
data "aws_iam_policy_document" "runtime" {
  statement {
    sid       = "WriteOwnLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }

  dynamic "statement" {
    for_each = var.tracing_enabled ? [1] : []

    content {
      sid = "XRayTracing"
      # X-Ray segment APIs have no resource-level permissions.
      effect    = "Allow"
      actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
      resources = ["*"]
    }
  }
}

data "aws_iam_policy_document" "combined" {
  source_policy_documents = [data.aws_iam_policy_document.runtime.json, var.policy_json]
}

resource "aws_iam_role_policy" "this" {
  name   = "${var.function_name}-policy"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.combined.json
}

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  description      = var.description
  role             = aws_iam_role.this.arn
  filename         = var.zip_path
  source_code_hash = var.zip_hash
  handler          = var.handler
  runtime          = var.runtime
  memory_size      = var.memory_size
  timeout          = var.timeout
  publish          = true
  # arm64 (Graviton) costs less per GB-second than x86_64; the bundle is pure JS.
  architectures = ["arm64"]

  environment {
    variables = var.environment
  }

  tracing_config {
    mode = var.tracing_enabled ? "Active" : "PassThrough"
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.this.name
  }

  depends_on = [aws_cloudwatch_log_group.this, aws_iam_role_policy.this]
}

resource "aws_lambda_alias" "live" {
  name             = "live"
  description      = "Version publicada que reciben API Gateway y SQS."
  function_name    = aws_lambda_function.this.function_name
  function_version = aws_lambda_function.this.version
}
