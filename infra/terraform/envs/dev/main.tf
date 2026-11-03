# AgilIA dev environment (us-east-2). Module graph (no resource-level cycle):
#   api_lambda -> api -> frontend (CloudFront) -> auth client (callback URL)
#   -> config.js object in the frontend bucket.

module "storage" {
  source = "../../modules/storage"

  documents_bucket_name   = "${local.name}-documents-${local.account_id}-${local.region}"
  traceability_table_name = "${var.project_name}-traceability-${var.environment}"
  findings_table_name     = "${var.project_name}-findings-${var.environment}"
  rules_secret_name       = "${var.project_name}/institutional-rules/${var.environment}"
  enable_rules_secret     = var.enable_rules_secret
  enable_pitr             = var.enable_pitr
  force_destroy           = var.force_destroy_buckets
}

module "messaging" {
  source = "../../modules/messaging"

  queue_name        = "${var.project_name}-document-processing-${var.environment}"
  dlq_name          = "${var.project_name}-document-processing-dlq-${var.environment}"
  event_bus_name    = "${var.project_name}-events-${var.environment}"
  max_receive_count = 3
}

module "auth" {
  source = "../../modules/auth"

  user_pool_name      = "${var.project_name}-users-${var.environment}"
  client_name         = "${var.project_name}-web-client-${var.environment}"
  domain_prefix       = "${local.name}-${local.account_id}"
  region              = local.region
  app_url             = module.frontend.url
  extra_callback_urls = var.cognito_extra_callback_urls
}

module "search" {
  source = "../../modules/search"
  count  = var.enable_opensearch ? 1 : 0

  domain_name       = local.search_domain_name
  region            = local.region
  account_id        = local.account_id
  engine_version    = var.opensearch_engine_version
  instance_type     = var.opensearch_instance_type
  volume_size_gb    = var.opensearch_volume_size_gb
  allowed_role_arns = [module.api_lambda.role_arn, module.worker_lambda.role_arn]
}

module "api" {
  source = "../../modules/api"

  api_name                = "${var.project_name}-api-${var.environment}"
  stage_name              = var.environment
  region                  = local.region
  user_pool_arn           = module.auth.user_pool_arn
  lambda_function_name    = module.api_lambda.function_name
  lambda_alias_name       = module.api_lambda.alias_name
  lambda_alias_invoke_arn = module.api_lambda.alias_invoke_arn
  xray_tracing_enabled    = var.enable_xray_tracing
  throttle_rate_limit     = var.api_throttle_rate_limit
  throttle_burst_limit    = var.api_throttle_burst_limit
}

module "frontend" {
  source = "../../modules/frontend"

  bucket_name       = "${local.name}-web-${local.account_id}-${local.region}"
  web_dir           = local.web_dir
  api_origin_domain = module.api.api_origin_domain
  api_stage_name    = module.api.stage_name
  price_class       = var.cloudfront_price_class
  force_destroy     = var.force_destroy_buckets

  config_js_content = templatefile("${path.module}/templates/config.js.tftpl", {
    region         = local.region
    user_pool_id   = module.auth.user_pool_id
    client_id      = module.auth.client_id
    cognito_domain = module.auth.hosted_ui_domain
    redirect_uri   = "${module.frontend.url}/"
  })
}

module "observability" {
  source = "../../modules/observability"

  project_name         = var.project_name
  environment          = var.environment
  region               = local.region
  account_id           = local.account_id
  api_function_name    = module.api_lambda.function_name
  worker_function_name = module.worker_lambda.function_name
  api_name             = module.api.rest_api_name
  api_stage_name       = module.api.stage_name
  queue_name           = module.messaging.queue_name
  dlq_name             = module.messaging.dlq_name
  alert_email          = var.alert_email
  enable_cloudtrail    = var.enable_cloudtrail
  force_destroy        = var.force_destroy_buckets
}
