variable "aws_region" {
  description = "Región de AWS donde se crean el bucket de estado y los recursos de la cuenta."
  type        = string
  default     = "us-east-2"
}

variable "project_name" {
  description = "Prefijo de nombres de recursos (solo minúsculas, números y guiones)."
  type        = string
  default     = "agilia"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.project_name))
    error_message = "project_name debe empezar con una letra y contener solo minúsculas, números y guiones (2-21 caracteres)."
  }
}

variable "environments" {
  description = "Entornos para los que se genera el archivo envs/<entorno>/backend.hcl."
  type        = list(string)
  default     = ["dev"]

  validation {
    condition     = alltrue([for e in var.environments : contains(["dev", "staging", "prod"], e)])
    error_message = "Cada entorno debe ser dev, staging o prod."
  }
}

variable "enable_budget" {
  description = "Crear el presupuesto mensual de AWS Budgets con alertas por correo."
  type        = bool
  default     = true
}

variable "budget_alert_email" {
  description = "Correo que recibe las alertas del presupuesto (obligatorio)."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email debe ser una dirección de correo válida."
  }
}

variable "budget_limit_usd" {
  description = "Límite mensual del presupuesto en USD."
  type        = number
  default     = 100

  validation {
    condition     = var.budget_limit_usd > 0
    error_message = "budget_limit_usd debe ser mayor que 0."
  }
}

variable "budget_thresholds_usd" {
  description = "Umbrales en USD (costo real) que disparan una alerta por correo."
  type        = list(number)
  default     = [20, 50, 80]

  validation {
    condition     = length(var.budget_thresholds_usd) > 0 && alltrue([for t in var.budget_thresholds_usd : t > 0])
    error_message = "budget_thresholds_usd debe tener al menos un valor y todos mayores que 0."
  }
}
