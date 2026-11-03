# The two Lambdas built from this repo (plan D2/D3). Run `bun run build:lambda`
# before plan/apply: archive_file zips dist/lambda/<name>/index.mjs.

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${local.lambda_dist_dir}/api"
  output_path = "${path.module}/build/api.zip"
}

data "archive_file" "worker" {
  type        = "zip"
  source_dir  = "${local.lambda_dist_dir}/worker"
  output_path = "${path.module}/build/worker.zip"
}

module "api_lambda" {
  source = "../../modules/lambda_function"

  function_name      = local.api_function_name
  description        = "AgilIA API (Hono) detras de API Gateway"
  zip_path           = data.archive_file.api.output_path
  zip_hash           = data.archive_file.api.output_base64sha256
  handler            = "index.handler"
  runtime            = var.lambda_runtime
  memory_size        = 512
  timeout            = 29
  policy_json        = data.aws_iam_policy_document.api.json
  log_retention_days = var.log_retention_days
  tracing_enabled    = var.enable_xray_tracing

  environment = merge(local.lambda_common_env, {
    AGILIA_AUTH_MODE = "cognito"
  })
}

module "worker_lambda" {
  source = "../../modules/lambda_function"

  function_name = local.worker_function_name
  description   = "AgilIA worker: pipeline de documentos desde SQS"
  zip_path      = data.archive_file.worker.output_path
  zip_hash      = data.archive_file.worker.output_base64sha256
  handler       = "index.handler"
  runtime       = var.lambda_runtime
  memory_size   = 1024
  # The queue visibility timeout (1800 s) is 6x this value (AWS guidance).
  timeout            = 300
  policy_json        = data.aws_iam_policy_document.worker.json
  log_retention_days = var.log_retention_days
  tracing_enabled    = var.enable_xray_tracing

  environment = merge(local.lambda_common_env, {
    AGILIA_MAX_RECEIVE_COUNT = "3"
  })
}

# One document per invocation; failed records are retried individually and
# reach the DLQ after 3 receives. maximum_concurrency caps Bedrock spend
# (reserved concurrency is avoided: new accounts have a 10-concurrency limit).
resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn        = module.messaging.queue_arn
  function_name           = module.worker_lambda.alias_arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = var.worker_max_concurrency
  }
}
