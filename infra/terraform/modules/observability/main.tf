# Alerts topic, alarms, dashboard, X-Ray group and the optional CloudTrail.
# Parity with the removed CloudFormation template: ProcessingDashboard, ProcessingErrorAlarm,
# DLQMessagesAlarm, XRayGroup, AuditTrailBucket, AuditTrailBucketPolicy,
# AuditTrail (+ new SNS topic, worker error and API 5XX alarms).

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

locals {
  env               = var.environment
  trail_name        = "${var.project_name}-audit-${local.env}"
  trail_arn         = "arn:aws:cloudtrail:${var.region}:${var.account_id}:trail/${local.trail_name}"
  audit_bucket_name = "${var.project_name}-${local.env}-audit-${var.account_id}-${var.region}"
  alarm_actions     = [aws_sns_topic.alerts.arn]
}

# ---------------------------------------------------------------------------
# SNS alerts topic
# ---------------------------------------------------------------------------
# No kms_master_key_id on purpose: CloudWatch alarms cannot publish to a topic
# encrypted with the AWS managed key alias/aws/sns (its key policy does not
# allow cloudwatch.amazonaws.com), so alarm actions would fail silently. A
# customer managed key would fix that at extra monthly cost; alarm messages
# carry only metric metadata, never document content.
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts-${local.env}"
}

resource "aws_sns_topic_subscription" "email" {
  count = var.alert_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------------------------------------------------------------------------
# Alarms (health + error-rate metrics for every component)
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "AgilIA-ProcessingErrors-${local.env}"
  alarm_description   = "Errores en la Lambda de la API (mas de 5 en 2 periodos de 5 minutos)"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    FunctionName = var.api_function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_errors" {
  alarm_name          = "AgilIA-WorkerErrors-${local.env}"
  alarm_description   = "Errores en la Lambda worker que procesa documentos"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    FunctionName = var.worker_function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "AgilIA-Api5XX-${local.env}"
  alarm_description   = "Respuestas 5XX de API Gateway (mas de 5 en 5 minutos)"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ApiName = var.api_name
    Stage   = var.api_stage_name
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "AgilIA-DLQMessages-${local.env}"
  alarm_description   = "Hay mensajes en la cola de errores (documentos que fallaron 3 veces)"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    QueueName = var.dlq_name
  }
}

# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_dashboard" "processing" {
  dashboard_name = "AgilIA-Processing-${local.env}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Invocaciones Lambda"
          view   = "timeSeries"
          region = var.region
          period = 300
          stat   = "Sum"
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", var.api_function_name],
            ["AWS/Lambda", "Invocations", "FunctionName", var.worker_function_name],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Errores Lambda"
          view   = "timeSeries"
          region = var.region
          period = 300
          stat   = "Sum"
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", var.api_function_name],
            ["AWS/Lambda", "Errors", "FunctionName", var.worker_function_name],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Duracion Lambda (promedio)"
          view   = "timeSeries"
          region = var.region
          period = 300
          stat   = "Average"
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", var.api_function_name],
            ["AWS/Lambda", "Duration", "FunctionName", var.worker_function_name],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Cola de Procesamiento"
          view   = "timeSeries"
          region = var.region
          period = 60
          stat   = "Maximum"
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.queue_name],
            ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", var.queue_name],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.dlq_name],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          title  = "API Gateway: solicitudes y errores"
          view   = "timeSeries"
          region = var.region
          period = 300
          stat   = "Sum"
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiName", var.api_name, "Stage", var.api_stage_name],
            ["AWS/ApiGateway", "4XXError", "ApiName", var.api_name, "Stage", var.api_stage_name],
            ["AWS/ApiGateway", "5XXError", "ApiName", var.api_name, "Stage", var.api_stage_name],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          title  = "API Gateway: latencia (promedio)"
          view   = "timeSeries"
          region = var.region
          period = 300
          stat   = "Average"
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiName", var.api_name, "Stage", var.api_stage_name],
          ]
        }
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# X-Ray
# ---------------------------------------------------------------------------
resource "aws_xray_group" "this" {
  group_name        = "AgilIA-${local.env}"
  filter_expression = "service(id(name: \"${var.api_function_name}\")) OR service(id(name: \"${var.worker_function_name}\"))"
}

# ---------------------------------------------------------------------------
# CloudTrail (optional) + audit bucket
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "audit" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket        = local.audit_bucket_name
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = aws_s3_bucket.audit[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = aws_s3_bucket.audit[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "audit" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = aws_s3_bucket.audit[0].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = aws_s3_bucket.audit[0].id

  rule {
    id     = "retain-audit-logs"
    status = "Enabled"

    filter {}

    transition {
      days          = 365
      storage_class = "GLACIER"
    }
  }
}

data "aws_iam_policy_document" "audit" {
  count = var.enable_cloudtrail ? 1 : 0

  statement {
    sid       = "AWSCloudTrailAclCheck"
    effect    = "Allow"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit[0].arn]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  statement {
    sid       = "AWSCloudTrailWrite"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit[0].arn}/AWSLogs/${var.account_id}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.audit[0].arn, "${aws_s3_bucket.audit[0].arn}/*"]

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

resource "aws_s3_bucket_policy" "audit" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = aws_s3_bucket.audit[0].id
  policy = data.aws_iam_policy_document.audit[0].json

  depends_on = [aws_s3_bucket_public_access_block.audit]
}

resource "aws_cloudtrail" "this" {
  count = var.enable_cloudtrail ? 1 : 0

  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.audit[0].id
  enable_logging                = true
  enable_log_file_validation    = true
  include_global_service_events = true
  is_multi_region_trail         = false

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  depends_on = [aws_s3_bucket_policy.audit]
}
