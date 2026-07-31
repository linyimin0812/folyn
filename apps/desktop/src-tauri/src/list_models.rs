//! Model list fetcher — per-provider raw HTTP. Each provider has its own
//! path, auth header style, and response parser. Returns `Vec<ModelDto>` to
//! the frontend.
//!
//! ponytail: replaced the rig_core dispatch (7 providers + OpenAICompat +
//! Azure) with raw HTTP for all 14 providers — matches the user's curl
//! specs exactly, drops one moving part. rig_core is still used by chat.rs.

use serde::{Deserialize, Serialize};

use crate::errors::AppError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListModelsParams {
    pub provider: String,
    pub api_key: String,
    pub base_url: Option<String>,
    // ponytail: azure_api_version dropped — list_models uses Bearer +
    // /openai/v1/models per the user's curl, no api-version query param.
    // Frontend still passes azureApiVersion; serde ignores unknown fields.
    /// Phase 3: bundled adapter family id when `custom_provider=true`.
    /// Same value space as `provider` for bundled entries; absent → fall
    /// back to `provider.as_str()`. Replaces the old endpoint-key enum.
    /// Frontend's `customProvider` flag is silently ignored by serde —
    /// routing collapses to this one field.
    #[serde(default)]
    pub adapter_family: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ModelDto {
    pub id: String,
}

#[tauri::command]
pub async fn list_models(params: ListModelsParams) -> Result<Vec<ModelDto>, AppError> {
    // Phase 3: collapse the enum indirection — custom providers declare
    // their adapter family directly. Same line as chat.rs.
    let resolved: &str = params.adapter_family.as_deref().unwrap_or(params.provider.as_str());
    let ids = match resolved {
        "anthropic" | "anthropic-compatible" => list_anthropic(&params).await?,
        "azure-openai" => list_azure(&params).await?,
        "cohere" => list_cohere(&params).await?,
        "deepseek" => list_openai_shape(&params, "v1/models").await?,
        "gemini" | "google" => list_google(&params).await?,
        "groq" => list_openai_shape(&params, "v1/models").await?,
        "huggingface" => list_openai_shape(&params, "models").await?,
        "moonshot" | "moonshotai" => list_openai_shape(&params, "v1/models").await?,
        "ollama" => list_ollama(&params).await?,
        "openai" => list_openai_shape(&params, "v1/models").await?,
        "openrouter" => list_openai_shape(&params, "models").await?,
        "perplexity" => list_openai_shape(&params, "v1/models").await?,
        "together" | "togetherai" => list_together(&params).await?,
        "xai" => list_openai_shape(&params, "models").await?,
        // new-api, openai-compatible, future unknown — try OpenAI shape.
        _ => list_openai_shape(&params, "v1/models").await?,
    };
    Ok(ids.into_iter().map(|id| ModelDto { id }).collect())
}

/// Concatenate base + path, trimming trailing slash on base. Per-provider
/// path is chosen so it correctly extends the providers.json baseUrl —
/// e.g. huggingface/openrouter/xai have `/v1` in the base, so their path
/// is just `models`; openai/groq/deepseek base has no `/v1`, so path is
/// `v1/models`.
fn join_url(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path)
}

/// GET url with headers, parse JSON. Errors surface HTTP status + URL.
async fn http_get_json<T, F>(url: &str, apply_headers: F) -> Result<T, AppError>
where
    T: serde::de::DeserializeOwned,
    F: FnOnce(reqwest::RequestBuilder) -> reqwest::RequestBuilder,
{
    let resp = apply_headers(reqwest::Client::new().get(url))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), url).into());
    }
    resp.json().await.map_err(|e| e.to_string().into())
}

// Response shapes — four total across all providers.
#[derive(Deserialize)]
struct IdList {
    data: Vec<IdItem>,
}
#[derive(Deserialize)]
struct IdItem {
    id: String,
}
#[derive(Deserialize)]
struct NameList {
    models: Vec<NameItem>,
}
#[derive(Deserialize)]
struct NameItem {
    name: String,
}

fn bearer(key: &str) -> String {
    format!("Bearer {}", key)
}

// anthropic: GET {base}/v1/models?limit=1000 with x-api-key + anthropic-version.
async fn list_anthropic(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.anthropic.com".to_string());
    let url = join_url(&base, "v1/models?limit=1000");
    let key = p.api_key.clone();
    let body: IdList = http_get_json(&url, |r| {
        r.header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
    })
    .await?;
    Ok(body.data.into_iter().map(|m| m.id).collect())
}

// azure: GET {base}/openai/v1/models with Authorization: Bearer.
// ponytail: strip trailing `/openai` from base — users paste Azure portal
// endpoint URLs that already include `/openai`, which would otherwise
// double to `/openai/openai/v1/models`.
async fn list_azure(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .ok_or_else(|| "base_url (Azure endpoint) required".to_string())?;
    let url = azure_models_url(&base);
    let auth = bearer(&p.api_key);
    let body: IdList = http_get_json(&url, |r| r.header("Authorization", &auth)).await?;
    Ok(body.data.into_iter().map(|m| m.id).collect())
}

fn azure_models_url(base: &str) -> String {
    let stripped = base.trim_end_matches('/').trim_end_matches("/openai");
    format!("{}/openai/v1/models", stripped)
}

// cohere: GET {base}/v1/models with Bearer, parse {models:[{name}]}.
async fn list_cohere(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.cohere.com".to_string());
    let url = join_url(&base, "v1/models");
    let auth = bearer(&p.api_key);
    let body: NameList = http_get_json(&url, |r| r.header("Authorization", &auth)).await?;
    Ok(body.models.into_iter().map(|m| m.name).collect())
}

// google: GET {base}/v1beta/models?key=<key>&pageSize=1000, strip "models/".
async fn list_google(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "https://generativelanguage.googleapis.com".to_string());
    let url = join_url(&base, &format!("v1beta/models?key={}&pageSize=1000", p.api_key));
    let body: NameList = http_get_json(&url, |r| r).await?;
    Ok(body
        .models
        .into_iter()
        .map(|m| m.name.strip_prefix("models/").map(|s| s.to_string()).unwrap_or(m.name))
        .collect())
}

// ollama: GET {base}/api/tags, no auth, parse {models:[{name}]}.
async fn list_ollama(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "http://localhost:11434".to_string());
    let url = join_url(&base, "api/tags");
    let body: NameList = http_get_json(&url, |r| r).await?;
    Ok(body.models.into_iter().map(|m| m.name).collect())
}

// togetherai: GET {base}/v1/models with Bearer, parse [{id}] (array directly).
async fn list_together(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.together.ai".to_string());
    let url = join_url(&base, "v1/models");
    let auth = bearer(&p.api_key);
    let body: Vec<IdItem> = http_get_json(&url, |r| r.header("Authorization", &auth)).await?;
    Ok(body.into_iter().map(|m| m.id).collect())
}

// OpenAI-shaped: GET {base}/<path> with Bearer, parse {data:[{id}]}.
async fn list_openai_shape(p: &ListModelsParams, path: &str) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .ok_or_else(|| "base_url required".to_string())?;
    let url = openai_shape_url(&base, path);
    let auth = bearer(&p.api_key);
    let body: IdList = http_get_json(&url, |r| r.header("Authorization", &auth)).await?;
    Ok(body.data.into_iter().map(|m| m.id).collect())
}

/// Build the OpenAI-shape models URL, deduping `/v1` when the user's base
/// already ends with a version segment. Mirrors chat.rs's openai arm
/// (`normalizeOpenAIBase` in the TS side). Bundled callers pass either
/// `v1/models` (base has no /v1) or `models` (base has /v1); custom
/// providers' user-supplied base is unpredictable, so strip the `v1/`
/// prefix from path when base already ends with `/v\d+`.
/// ponytail: pure — unit tested below.
fn openai_shape_url(base: &str, path: &str) -> String {
    let trimmed = base.trim_end_matches('/');
    let last_seg = trimmed.rsplit('/').next().unwrap_or("");
    let base_has_version = last_seg.starts_with('v')
        && last_seg.len() > 1
        && last_seg.as_bytes()[1].is_ascii_digit();
    let path_stripped = if base_has_version && path.starts_with("v1/") {
        &path[3..]
    } else {
        path
    };
    format!("{}/{}", trimmed, path_stripped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_url_trims_trailing_slash() {
        assert_eq!(
            join_url("https://router.huggingface.co/v1/", "models"),
            "https://router.huggingface.co/v1/models"
        );
        assert_eq!(
            join_url("https://api.openai.com", "v1/models"),
            "https://api.openai.com/v1/models"
        );
        // xai base already has /v1 — per-provider path is just `models`.
        assert_eq!(join_url("https://api.x.ai/v1", "models"), "https://api.x.ai/v1/models");
    }

    #[test]
    fn openai_shape_url_dedupes_v1_when_base_already_has_version() {
        // Custom provider: user pasted base with /v1 — strip path's `v1/`
        // prefix so we hit /v1/models, not /v1/v1/models.
        assert_eq!(
            openai_shape_url("https://api.vveai.com/v1", "v1/models"),
            "https://api.vveai.com/v1/models"
        );
        assert_eq!(
            openai_shape_url("https://api.vveai.com/v1/", "v1/models"),
            "https://api.vveai.com/v1/models"
        );
        // Bundled: base without /v1, path `v1/models` → append /v1/models.
        assert_eq!(
            openai_shape_url("https://api.openai.com", "v1/models"),
            "https://api.openai.com/v1/models"
        );
        // Bundled: base already has /v1, path is just `models` → no dedup
        // needed, pass through.
        assert_eq!(
            openai_shape_url("https://api.x.ai/v1", "models"),
            "https://api.x.ai/v1/models"
        );
        // Edge: base with /v2 should also dedup (some gateways use v2).
        assert_eq!(
            openai_shape_url("https://example.com/v2", "v1/models"),
            "https://example.com/v2/models"
        );
    }

    #[test]
    fn azure_url_strips_existing_openai_suffix() {
        // User pasted Azure portal endpoint that already includes `/openai`.
        let url = azure_models_url("https://linyimin-dev.openai.azure.com/openai");
        assert_eq!(url, "https://linyimin-dev.openai.azure.com/openai/v1/models");
        // Bare endpoint — `/openai` gets prepended.
        let url = azure_models_url("https://linyimin-dev.openai.azure.com");
        assert_eq!(url, "https://linyimin-dev.openai.azure.com/openai/v1/models");
        // Trailing slash trimmed.
        let url = azure_models_url("https://linyimin-dev.openai.azure.com/openai/");
        assert_eq!(url, "https://linyimin-dev.openai.azure.com/openai/v1/models");
    }

    #[test]
    fn parsers_cover_all_response_shapes() {
        let openai_shape = serde_json::from_str::<IdList>(r#"{"data":[{"id":"gpt-4"}]}"#).unwrap();
        assert_eq!(openai_shape.data[0].id, "gpt-4");

        let cohere_shape = serde_json::from_str::<NameList>(r#"{"models":[{"name":"command-r"}]}"#).unwrap();
        assert_eq!(cohere_shape.models[0].name, "command-r");

        // togetherai returns an array directly.
        let together_shape = serde_json::from_str::<Vec<IdItem>>(r#"[{"id":"meta.llama"}]"#).unwrap();
        assert_eq!(together_shape[0].id, "meta.llama");
    }
}
