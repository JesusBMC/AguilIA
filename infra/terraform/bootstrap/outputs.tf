output "state_bucket_name" {
  description = "Bucket S3 que guarda el estado remoto de Terraform de cada entorno."
  value       = aws_s3_bucket.state.bucket
}

output "backend_config_files" {
  description = "Archivos backend.hcl generados, por entorno (entorno => ruta)."
  value       = { for env, f in local_file.backend_config : env => f.filename }
}

output "backend_hcl" {
  description = "Contenido de backend.hcl para el entorno dev (null si dev no está en environments)."
  value       = contains(var.environments, "dev") ? local_file.backend_config["dev"].content : null
}

output "budget_name" {
  description = "Nombre del presupuesto mensual de AWS Budgets (null si enable_budget = false)."
  value       = var.enable_budget ? aws_budgets_budget.monthly[0].name : null
}
