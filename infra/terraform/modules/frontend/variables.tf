variable "bucket_name" {
  description = "Nombre del bucket privado de la SPA."
  type        = string
}

variable "web_dir" {
  description = "Carpeta local con los archivos de la SPA (web/)."
  type        = string
}

variable "config_js_content" {
  description = "Contenido de config.js generado por Terraform (valores de Cognito)."
  type        = string
}

variable "api_origin_domain" {
  description = "Dominio execute-api de la REST API (<id>.execute-api.<región>.amazonaws.com)."
  type        = string
}

variable "api_stage_name" {
  description = "Stage de la API; CloudFront lo antepone como origin_path."
  type        = string
}

variable "price_class" {
  description = "Clase de precio de CloudFront."
  type        = string
  default     = "PriceClass_100"
}

variable "force_destroy" {
  description = "Permitir borrar el bucket aunque tenga objetos."
  type        = bool
  default     = false
}
