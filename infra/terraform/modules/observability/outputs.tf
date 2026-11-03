output "alerts_topic_arn" {
  description = "ARN del tema SNS de alertas."
  value       = aws_sns_topic.alerts.arn
}

output "dashboard_name" {
  description = "Nombre del dashboard de CloudWatch."
  value       = aws_cloudwatch_dashboard.processing.dashboard_name
}

output "audit_bucket_name" {
  description = "Bucket de auditoría de CloudTrail (null si está desactivado)."
  value       = var.enable_cloudtrail ? aws_s3_bucket.audit[0].bucket : null
}

output "trail_name" {
  description = "Nombre del trail (null si está desactivado)."
  value       = var.enable_cloudtrail ? aws_cloudtrail.this[0].name : null
}
