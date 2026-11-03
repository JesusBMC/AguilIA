variable "function_name" {
  description = "Nombre de la función Lambda."
  type        = string
}

variable "description" {
  description = "Descripción de la función."
  type        = string
  default     = ""
}

variable "zip_path" {
  description = "Ruta del zip con el bundle (dist/lambda/<nombre> comprimido por archive_file)."
  type        = string
}

variable "zip_hash" {
  description = "Hash base64 SHA-256 del zip (output_base64sha256) para detectar cambios de código."
  type        = string
}

variable "handler" {
  description = "Handler de la función."
  type        = string
  default     = "index.handler"
}

variable "runtime" {
  description = "Runtime de Lambda (nodejs24.x o nodejs22.x)."
  type        = string
}

variable "memory_size" {
  description = "Memoria en MB."
  type        = number
}

variable "timeout" {
  description = "Tiempo máximo de ejecución en segundos."
  type        = number
}

variable "environment" {
  description = "Variables de entorno de la función (nunca AWS_REGION: Lambda la reserva)."
  type        = map(string)
  default     = {}
}

variable "policy_json" {
  description = "Documento de política IAM (JSON) con los permisos propios de la función."
  type        = string
}

variable "log_retention_days" {
  description = "Días de retención del log group."
  type        = number
}

variable "tracing_enabled" {
  description = "Activar trazas de X-Ray (Active) o PassThrough."
  type        = bool
  default     = true
}
