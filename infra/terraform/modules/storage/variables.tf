variable "documents_bucket_name" {
  description = "Nombre del bucket S3 de documentos."
  type        = string
}

variable "traceability_table_name" {
  description = "Nombre de la tabla DynamoDB de trazabilidad."
  type        = string
}

variable "findings_table_name" {
  description = "Nombre de la tabla DynamoDB de hallazgos."
  type        = string
}

variable "rules_secret_name" {
  description = "Nombre del secreto de reglas institucionales."
  type        = string
}

variable "enable_rules_secret" {
  description = "Crear el secreto de reglas institucionales."
  type        = bool
  default     = true
}

variable "enable_pitr" {
  description = "Activar point-in-time recovery en las tablas DynamoDB."
  type        = bool
  default     = true
}

variable "force_destroy" {
  description = "Permitir borrar el bucket aunque tenga objetos (solo para entornos desechables)."
  type        = bool
  default     = false
}
