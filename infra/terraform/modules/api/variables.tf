variable "api_name" {
  description = "Nombre de la REST API."
  type        = string
}

variable "stage_name" {
  description = "Nombre del stage (igual al entorno)."
  type        = string
}

variable "region" {
  description = "Región de AWS (para el dominio execute-api)."
  type        = string
}

variable "user_pool_arn" {
  description = "ARN del user pool de Cognito para el autorizador."
  type        = string
}

variable "lambda_function_name" {
  description = "Nombre de la función Lambda de la API."
  type        = string
}

variable "lambda_alias_name" {
  description = "Alias de la función que invoca API Gateway."
  type        = string
  default     = "live"
}

variable "lambda_alias_invoke_arn" {
  description = "ARN de invocación del alias de la función de la API."
  type        = string
}

variable "xray_tracing_enabled" {
  description = "Activar X-Ray en el stage."
  type        = bool
  default     = true
}

variable "throttle_rate_limit" {
  description = "Solicitudes por segundo permitidas en el stage."
  type        = number
  default     = 10
}

variable "throttle_burst_limit" {
  description = "Ráfaga máxima de solicitudes en el stage."
  type        = number
  default     = 20
}
