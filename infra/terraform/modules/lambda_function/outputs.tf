output "function_name" {
  description = "Nombre de la función."
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "ARN de la función (sin calificador)."
  value       = aws_lambda_function.this.arn
}

output "alias_name" {
  description = "Nombre del alias live (crea la dependencia con el alias en quien lo use)."
  value       = aws_lambda_alias.live.name
}

output "alias_arn" {
  description = "ARN del alias live."
  value       = aws_lambda_alias.live.arn
}

output "alias_invoke_arn" {
  description = "ARN de invocación del alias live (para API Gateway)."
  value       = aws_lambda_alias.live.invoke_arn
}

output "role_arn" {
  description = "ARN del rol de ejecución."
  value       = aws_iam_role.this.arn
}

output "role_name" {
  description = "Nombre del rol de ejecución."
  value       = aws_iam_role.this.name
}

output "log_group_name" {
  description = "Nombre del log group de la función."
  value       = aws_cloudwatch_log_group.this.name
}
