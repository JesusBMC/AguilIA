output "documents_bucket_name" {
  description = "Nombre del bucket de documentos."
  value       = aws_s3_bucket.documents.bucket
}

output "documents_bucket_arn" {
  description = "ARN del bucket de documentos."
  value       = aws_s3_bucket.documents.arn
}

output "traceability_table_name" {
  description = "Nombre de la tabla de trazabilidad."
  value       = aws_dynamodb_table.traceability.name
}

output "traceability_table_arn" {
  description = "ARN de la tabla de trazabilidad."
  value       = aws_dynamodb_table.traceability.arn
}

output "findings_table_name" {
  description = "Nombre de la tabla de hallazgos."
  value       = aws_dynamodb_table.findings.name
}

output "findings_table_arn" {
  description = "ARN de la tabla de hallazgos."
  value       = aws_dynamodb_table.findings.arn
}

output "rules_secret_arn" {
  description = "ARN del secreto de reglas (null si está desactivado)."
  value       = var.enable_rules_secret ? aws_secretsmanager_secret.rules[0].arn : null
}
