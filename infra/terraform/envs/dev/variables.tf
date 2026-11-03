variable "aws_region" {
  description = "Región de AWS del entorno."
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

variable "environment" {
  description = "Nombre del entorno de despliegue."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment debe ser dev, staging o prod."
  }
}

variable "bedrock_model_id" {
  description = "ID del perfil de inferencia de Bedrock (Claude Haiku 4.5, perfil geográfico US). Confirme el acceso en la consola de Bedrock (us-east-2)."
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

  validation {
    condition     = length(trimspace(var.bedrock_model_id)) > 0
    error_message = "bedrock_model_id no puede estar vacío."
  }
}

variable "bedrock_destination_regions" {
  description = "Regiones a las que el perfil de inferencia puede enrutar las llamadas (para el permiso IAM del modelo base)."
  type        = list(string)
  default     = ["us-east-1", "us-east-2", "us-west-2"]
}

variable "lambda_runtime" {
  description = "Runtime de Node.js de las Lambdas."
  type        = string
  default     = "nodejs24.x"

  validation {
    condition     = contains(["nodejs22.x", "nodejs24.x"], var.lambda_runtime)
    error_message = "lambda_runtime debe ser nodejs22.x o nodejs24.x."
  }
}

variable "lambda_dist_dir" {
  description = "Carpeta con los bundles de Lambda (bun run build:lambda). Vacío = <repo>/dist/lambda."
  type        = string
  default     = ""
}

variable "web_dir" {
  description = "Carpeta con la SPA. Vacío = <repo>/web."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "Días de retención de los logs de las Lambdas."
  type        = number
  default     = 14

  validation {
    condition = contains([
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731,
      1096, 1827, 2192, 2557, 2922, 3288, 3653,
    ], var.log_retention_days)
    error_message = "log_retention_days debe ser un valor permitido por CloudWatch Logs (1, 3, 5, 7, 14, 30, 60, 90, ...)."
  }
}

variable "enable_opensearch" {
  description = "Crear el dominio de OpenSearch (costo mensual fijo). false = búsqueda sobre la tabla de hallazgos de DynamoDB."
  type        = bool
  default     = false
}

variable "opensearch_instance_type" {
  description = "Tipo de instancia de OpenSearch."
  type        = string
  default     = "t3.small.search"
}

variable "opensearch_engine_version" {
  description = "Versión de OpenSearch (por confirmar con aws opensearch list-versions --region us-east-2)."
  type        = string
  default     = "OpenSearch_2.19"
}

variable "opensearch_volume_size_gb" {
  description = "Tamaño del volumen gp3 de OpenSearch en GB."
  type        = number
  default     = 10
}

variable "enable_cloudtrail" {
  description = "Crear el trail de CloudTrail y su bucket de auditoría."
  type        = bool
  default     = true
}

variable "enable_xray_tracing" {
  description = "Activar trazas de X-Ray en las Lambdas y en API Gateway."
  type        = bool
  default     = true
}

variable "enable_pitr" {
  description = "Activar point-in-time recovery en las tablas DynamoDB."
  type        = bool
  default     = true
}

variable "enable_rules_secret" {
  description = "Crear el secreto de reglas institucionales en Secrets Manager."
  type        = bool
  default     = true
}

variable "force_destroy_buckets" {
  description = "Permitir que terraform destroy borre buckets con objetos (pérdida de datos)."
  type        = bool
  default     = false
}

variable "alert_email" {
  description = "Correo para las alarmas de CloudWatch (\"\" = sin suscripción)."
  type        = string
  default     = ""

  validation {
    condition     = var.alert_email == "" || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email debe estar vacío o ser una dirección de correo válida."
  }
}

variable "api_throttle_rate_limit" {
  description = "Solicitudes por segundo permitidas en el stage de API Gateway."
  type        = number
  default     = 10
}

variable "api_throttle_burst_limit" {
  description = "Ráfaga máxima de solicitudes en el stage de API Gateway."
  type        = number
  default     = 20
}

variable "worker_max_concurrency" {
  description = "Máximo de ejecuciones concurrentes de la Lambda worker desde SQS (mínimo 2)."
  type        = number
  default     = 2

  validation {
    condition     = var.worker_max_concurrency >= 2
    error_message = "worker_max_concurrency debe ser 2 o más (mínimo de SQS)."
  }
}

variable "cognito_extra_callback_urls" {
  description = "URLs adicionales de callback/logout de Cognito (por ejemplo http://localhost:8787/)."
  type        = list(string)
  default     = []
}

variable "cloudfront_price_class" {
  description = "Clase de precio de CloudFront."
  type        = string
  default     = "PriceClass_100"
}
