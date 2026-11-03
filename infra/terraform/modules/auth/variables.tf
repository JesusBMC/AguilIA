variable "user_pool_name" {
  description = "Nombre del user pool de Cognito."
  type        = string
}

variable "client_name" {
  description = "Nombre del cliente de la SPA."
  type        = string
}

variable "domain_prefix" {
  description = "Prefijo del dominio de Cognito (https://<prefijo>.auth.<región>.amazoncognito.com)."
  type        = string
}

variable "region" {
  description = "Región de AWS (para construir la URL del dominio de Cognito)."
  type        = string
}

variable "app_url" {
  description = "URL pública de la SPA sin barra final (CloudFront). Se registra como callback y logout con '/'."
  type        = string
}

variable "extra_callback_urls" {
  description = "URLs adicionales de callback/logout (por ejemplo http://localhost:8787/)."
  type        = list(string)
  default     = []
}
