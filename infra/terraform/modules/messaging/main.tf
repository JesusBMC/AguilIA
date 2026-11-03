# Processing queue + DLQ and the custom EventBridge bus.
# Parity with the removed CloudFormation template: DocumentProcessingDLQ, DocumentProcessingQueue,
# AgiliaEventBus.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

resource "aws_sqs_queue" "dlq" {
  name                      = var.dlq_name
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

# Visibility (1800 s) is 6x the worker Lambda timeout (300 s), as AWS
# recommends for Lambda + SQS so retries survive throttling.
resource "aws_sqs_queue" "processing" {
  name                       = var.queue_name
  visibility_timeout_seconds = 1800
  message_retention_seconds  = 86400
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# Only the processing queue may use this DLQ.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.processing.arn]
  })
}

# Events: DocumentUploaded, DecisionRecorded, DraftReady, ProcessingFailed
# (source agilia.documents).
resource "aws_cloudwatch_event_bus" "this" {
  name = var.event_bus_name
}
