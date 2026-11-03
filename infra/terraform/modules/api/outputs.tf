output "rest_api_id" {
  description = "ID de la REST API."
  value       = aws_api_gateway_rest_api.this.id
}

output "rest_api_name" {
  description = "Nombre de la REST API (dimensión ApiName de las métricas)."
  value       = aws_api_gateway_rest_api.this.name
}

output "stage_name" {
  description = "Nombre del stage."
  value       = aws_api_gateway_stage.this.stage_name
}

output "invoke_url" {
  description = "URL de invocación del stage, sin barra final."
  value       = trimsuffix(aws_api_gateway_stage.this.invoke_url, "/")
}

output "execution_arn" {
  description = "ARN de ejecución de la API."
  value       = aws_api_gateway_rest_api.this.execution_arn
}

output "api_origin_domain" {
  description = "Dominio execute-api usado como origen de CloudFront."
  value       = "${aws_api_gateway_rest_api.this.id}.execute-api.${var.region}.amazonaws.com"
}
