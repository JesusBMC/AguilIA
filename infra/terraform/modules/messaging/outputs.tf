output "queue_url" {
  description = "URL de la cola de procesamiento."
  value       = aws_sqs_queue.processing.id
}

output "queue_arn" {
  description = "ARN de la cola de procesamiento."
  value       = aws_sqs_queue.processing.arn
}

output "queue_name" {
  description = "Nombre de la cola de procesamiento."
  value       = aws_sqs_queue.processing.name
}

output "dlq_url" {
  description = "URL de la DLQ."
  value       = aws_sqs_queue.dlq.id
}

output "dlq_arn" {
  description = "ARN de la DLQ."
  value       = aws_sqs_queue.dlq.arn
}

output "dlq_name" {
  description = "Nombre de la DLQ."
  value       = aws_sqs_queue.dlq.name
}

output "event_bus_name" {
  description = "Nombre del bus de eventos."
  value       = aws_cloudwatch_event_bus.this.name
}

output "event_bus_arn" {
  description = "ARN del bus de eventos."
  value       = aws_cloudwatch_event_bus.this.arn
}
