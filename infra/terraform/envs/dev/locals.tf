data "aws_caller_identity" "current" {}

locals {
  name       = "${var.project_name}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  region     = var.aws_region

  lambda_dist_dir = var.lambda_dist_dir != "" ? var.lambda_dist_dir : "${path.module}/../../../../dist/lambda"
  web_dir         = var.web_dir != "" ? var.web_dir : "${path.module}/../../../../web"

  api_function_name    = "${var.project_name}-api-${var.environment}"
  worker_function_name = "${var.project_name}-worker-${var.environment}"
  search_domain_name   = "${var.project_name}-search-${var.environment}"
  search_domain_arn    = "arn:aws:es:${local.region}:${local.account_id}:domain/${local.search_domain_name}"

  # Bedrock (plan D9): the id is a geo inference profile ("us.<model>").
  # InvokeModel needs the profile ARN plus the base model in every region the
  # profile can route to.
  bedrock_base_model_id = replace(var.bedrock_model_id, "/^(us|eu|apac|au|jp|ca|global)\\./", "")
  bedrock_resource_arns = concat(
    ["arn:aws:bedrock:${local.region}:${local.account_id}:inference-profile/${var.bedrock_model_id}"],
    [for r in var.bedrock_destination_regions : "arn:aws:bedrock:${r}::foundation-model/${local.bedrock_base_model_id}"],
    startswith(var.bedrock_model_id, "global.") ? ["arn:aws:bedrock:::foundation-model/${local.bedrock_base_model_id}"] : [],
  )

  # Shared Lambda environment (names read by src/config.ts and
  # src/providers/aws). Never AWS_REGION: Lambda reserves it.
  lambda_common_env = merge(
    {
      AIDLC_PROVIDER                  = "aws"
      AWS_S3_BUCKET                   = module.storage.documents_bucket_name
      AWS_DYNAMODB_TRACEABILITY_TABLE = module.storage.traceability_table_name
      AWS_DYNAMODB_FINDINGS_TABLE     = module.storage.findings_table_name
      AWS_BEDROCK_RULE_MODEL_ID       = var.bedrock_model_id
      AWS_BEDROCK_DRAFT_MODEL_ID      = var.bedrock_model_id
      AWS_COMPREHEND_LANGUAGE         = "es"
      AWS_SEARCH_BACKEND              = var.enable_opensearch ? "opensearch" : "dynamodb"
      AGILIA_QUEUE_URL                = module.messaging.queue_url
      AGILIA_EVENT_BUS_NAME           = module.messaging.event_bus_name
    },
    var.enable_opensearch ? { AWS_OPENSEARCH_ENDPOINT = module.search[0].endpoint } : {},
  )
}
