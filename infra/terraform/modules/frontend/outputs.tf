output "bucket_name" {
  description = "Nombre del bucket de la SPA."
  value       = aws_s3_bucket.web.bucket
}

output "distribution_id" {
  description = "ID de la distribución de CloudFront."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  description = "ARN de la distribución de CloudFront."
  value       = aws_cloudfront_distribution.this.arn
}

output "domain_name" {
  description = "Dominio *.cloudfront.net de la distribución."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "url" {
  description = "URL pública de la SPA, sin barra final."
  value       = "https://${aws_cloudfront_distribution.this.domain_name}"
}
