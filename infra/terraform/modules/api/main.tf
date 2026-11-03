# API Gateway REST API in front of the api Lambda alias "live".
# Parity with the removed CloudFormation template: ApiGateway, ApiGatewayAuthorizer, *Resource,
# *Method, ApiGatewayDeployment, ApiGatewayStage, *ApiPermission (plan D10).

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

locals {
  # Every route is AWS_PROXY to the same Lambda alias; auth is COGNITO or NONE.
  routes    = jsondecode(file("${path.module}/routes.json"))
  route_map = { for r in local.routes : "${r.method} ${r.path}" => r }

  # Static path tree (path => parent path + path part), one map per depth so
  # each level can reference the ids of the level above.
  level1_resources = {
    "/documents" = "documents"
    "/search"    = "search"
    "/health"    = "health"
  }
  level2_resources = {
    "/documents/upload"       = { parent = "/documents", part = "upload" }
    "/documents/{documentId}" = { parent = "/documents", part = "{documentId}" }
  }
  level3_resources = {
    "/documents/{documentId}/decision" = { parent = "/documents/{documentId}", part = "decision" }
    "/documents/{documentId}/draft"    = { parent = "/documents/{documentId}", part = "draft" }
  }

  resource_ids = merge(
    { for p, r in aws_api_gateway_resource.level1 : p => r.id },
    { for p, r in aws_api_gateway_resource.level2 : p => r.id },
    { for p, r in aws_api_gateway_resource.level3 : p => r.id },
  )
}

resource "aws_api_gateway_rest_api" "this" {
  name        = var.api_name
  description = "API para plataforma AgilIA de procesamiento de documentos de adquisicion"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_authorizer" "cognito" {
  name            = "CognitoAuthorizer"
  rest_api_id     = aws_api_gateway_rest_api.this.id
  type            = "COGNITO_USER_POOLS"
  identity_source = "method.request.header.Authorization"
  provider_arns   = [var.user_pool_arn]
}

resource "aws_api_gateway_resource" "level1" {
  for_each = local.level1_resources

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = each.value
}

resource "aws_api_gateway_resource" "level2" {
  for_each = local.level2_resources

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.level1[each.value.parent].id
  path_part   = each.value.part
}

resource "aws_api_gateway_resource" "level3" {
  for_each = local.level3_resources

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.level2[each.value.parent].id
  path_part   = each.value.part
}

resource "aws_api_gateway_method" "this" {
  for_each = local.route_map

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = local.resource_ids[each.value.path]
  http_method   = each.value.method
  authorization = each.value.auth == "COGNITO" ? "COGNITO_USER_POOLS" : "NONE"
  authorizer_id = each.value.auth == "COGNITO" ? aws_api_gateway_authorizer.cognito.id : null
}

resource "aws_api_gateway_integration" "this" {
  for_each = local.route_map

  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_method.this[each.key].resource_id
  http_method             = aws_api_gateway_method.this[each.key].http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = var.lambda_alias_invoke_arn
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  # A new deployment is created whenever routes, resources, methods or
  # integrations change; otherwise the stage would keep serving the old API.
  triggers = {
    redeployment = sha1(jsonencode([
      local.routes,
      local.resource_ids,
      [for k, m in aws_api_gateway_method.this : [k, m.id, m.authorization]],
      [for k, i in aws_api_gateway_integration.this : [k, i.id, i.uri]],
      aws_api_gateway_authorizer.cognito.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_api_gateway_method.this, aws_api_gateway_integration.this]
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id          = aws_api_gateway_rest_api.this.id
  deployment_id        = aws_api_gateway_deployment.this.id
  stage_name           = var.stage_name
  xray_tracing_enabled = var.xray_tracing_enabled
}

# Deviation from the template (plan D10): execution logging OFF and data trace
# off, so request bodies (document text, PII) never reach CloudWatch and no
# account-level CloudWatch role is needed. Metrics stay on.
resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  method_path = "*/*"

  settings {
    metrics_enabled        = true
    logging_level          = "OFF"
    data_trace_enabled     = false
    throttling_rate_limit  = var.throttle_rate_limit
    throttling_burst_limit = var.throttle_burst_limit
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  qualifier     = var.lambda_alias_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}
