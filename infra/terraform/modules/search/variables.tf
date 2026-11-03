variable "domain_name" {
  description = "Nombre del dominio de OpenSearch."
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

variable "engine_version" {
  description = "Versión del motor (por confirmar con aws opensearch list-versions)."
  type        = string
  default     = "OpenSearch_2.19"
}

variable "instance_type" {
  description = "Tipo de instancia del nodo único."
  type        = string
  default     = "t3.small.search"
}

variable "volume_size_gb" {
  description = "Tamaño del volumen gp3 en GB."
  type        = number
  default     = 10
}

variable "allowed_role_arns" {
  description = "ARNs de los roles IAM (Lambdas) que pueden llamar al dominio."
  type        = list(string)
}
