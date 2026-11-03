variable "queue_name" {
  description = "Nombre de la cola SQS de procesamiento de documentos."
  type        = string
}

variable "dlq_name" {
  description = "Nombre de la cola de mensajes fallidos (DLQ)."
  type        = string
}

variable "event_bus_name" {
  description = "Nombre del bus de eventos de EventBridge."
  type        = string
}

variable "max_receive_count" {
  description = "Intentos de entrega antes de enviar el mensaje a la DLQ."
  type        = number
  default     = 3
}
