output "aws_region" {
  description = "Región de AWS del entorno."
  value       = local.region
}

output "api_url" {
  description = "URL de invocación del stage de API Gateway (sin barra final)."
  value       = module.api.invoke_url
}

output "frontend_url" {
  description = "URL pública de la aplicación (CloudFront)."
  value       = module.frontend.url
}

output "cloudfront_distribution_id" {
  description = "ID de la distribución de CloudFront (para invalidaciones)."
  value       = module.frontend.distribution_id
}

output "cognito_user_pool_id" {
  description = "ID del user pool de Cognito (para crear usuarios)."
  value       = module.auth.user_pool_id
}

output "cognito_user_pool_client_id" {
  description = "ID del cliente de la SPA en Cognito."
  value       = module.auth.client_id
}

output "cognito_hosted_ui_domain" {
  description = "Dominio de inicio de sesión de Cognito."
  value       = module.auth.hosted_ui_domain
}

output "documents_bucket_name" {
  description = "Bucket S3 de documentos."
  value       = module.storage.documents_bucket_name
}

output "frontend_bucket_name" {
  description = "Bucket S3 de la SPA."
  value       = module.frontend.bucket_name
}

output "audit_bucket_name" {
  description = "Bucket de auditoría de CloudTrail (null si enable_cloudtrail = false)."
  value       = module.observability.audit_bucket_name
}

output "traceability_table_name" {
  description = "Tabla DynamoDB de trazabilidad."
  value       = module.storage.traceability_table_name
}

output "findings_table_name" {
  description = "Tabla DynamoDB de hallazgos."
  value       = module.storage.findings_table_name
}

output "processing_queue_url" {
  description = "URL de la cola SQS de procesamiento."
  value       = module.messaging.queue_url
}

output "dlq_url" {
  description = "URL de la cola de mensajes fallidos (DLQ)."
  value       = module.messaging.dlq_url
}

output "event_bus_name" {
  description = "Bus de eventos de EventBridge."
  value       = module.messaging.event_bus_name
}

output "api_function_name" {
  description = "Nombre de la Lambda de la API."
  value       = module.api_lambda.function_name
}

output "worker_function_name" {
  description = "Nombre de la Lambda worker."
  value       = module.worker_lambda.function_name
}

output "opensearch_endpoint" {
  description = "Endpoint de OpenSearch (null si enable_opensearch = false)."
  value       = var.enable_opensearch ? module.search[0].endpoint : null
}

output "bedrock_model_id" {
  description = "Perfil de inferencia de Bedrock que usan las Lambdas."
  value       = var.bedrock_model_id
}
