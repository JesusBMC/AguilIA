variable "project_name" {
  description = "Prefijo de nombres de recursos."
  type        = string
}

variable "environment" {
  description = "Entorno (dev, staging, prod)."
  type        = string
}

variable "region" {
  description = "Región de AWS."
  type        = string
}

variable "account_id" {
  description = "ID de la cuenta de AWS."
  type        = string
}

variable "api_function_name" {
  description = "Nombre de la Lambda de la API."
  type        = string
}

variable "worker_function_name" {
  description = "Nombre de la Lambda worker."
  type        = string
}

variable "api_name" {
  description = "Nombre de la REST API (dimensión ApiName)."
  type        = string
}

variable "api_stage_name" {
  description = "Stage de la REST API (dimensión Stage)."
  type        = string
}

variable "queue_name" {
  description = "Nombre de la cola de procesamiento."
  type        = string
}

variable "dlq_name" {
  description = "Nombre de la DLQ."
  type        = string
}

variable "alert_email" {
  description = "Correo para las alarmas (\"\" = sin suscripción)."
  type        = string
  default     = ""
}

variable "enable_cloudtrail" {
  description = "Crear el trail de CloudTrail y su bucket de auditoría."
  type        = bool
  default     = true
}

variable "force_destroy" {
  description = "Permitir borrar el bucket de auditoría aunque tenga objetos."
  type        = bool
  default     = false
}
