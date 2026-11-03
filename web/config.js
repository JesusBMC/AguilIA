/*
 * AgilIA runtime configuration (local copy).
 *
 * On AWS this file is NOT taken from the repo: Terraform generates it from
 * infra/terraform/envs/dev/templates/config.js.tftpl with the Cognito values
 * and uploads it to the web bucket. This local copy disables authentication
 * and lets app.js pick the API origin (same origin, or localhost:8787 for file://).
 */
window.AGILIA_CONFIG = { authMode: "none", apiBaseUrl: null };
