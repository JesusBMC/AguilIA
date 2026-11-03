output "user_pool_id" {
  description = "ID del user pool."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "ARN del user pool (para el autorizador de API Gateway)."
  value       = aws_cognito_user_pool.this.arn
}

output "client_id" {
  description = "ID del cliente de la SPA (sin secreto)."
  value       = aws_cognito_user_pool_client.spa.id
}

output "hosted_ui_domain" {
  description = "Origen del dominio de Cognito, con esquema y sin barra final."
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${var.region}.amazoncognito.com"
}
