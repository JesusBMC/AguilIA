output "endpoint" {
  description = "Endpoint HTTPS del dominio."
  value       = "https://${aws_opensearch_domain.this.endpoint}"
}

output "arn" {
  description = "ARN del dominio."
  value       = aws_opensearch_domain.this.arn
}

output "domain_name" {
  description = "Nombre del dominio."
  value       = aws_opensearch_domain.this.domain_name
}
