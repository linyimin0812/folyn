//! Model list fetcher — routes a provider id to the appropriate fetcher
//! (rig `ModelListingClient::list_models()` where supported, raw HTTP
//! `/v1/models` for the OpenAI-compatible family, raw HTTP with `api-key`
//! header for Azure). Returns `Vec<ModelDto>` to the frontend.
//!
//! Routing lives in the `fetcher_kind` pure function so it can be unit-tested
//! without HTTP. The `list_models` Tauri command dispatches by FetcherKind.

use rig_core::client::{ModelListingClient, Nothing};
use rig_core::providers::{anthropic, deepseek, gemini, mira, ollama, openai, openrouter};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetcherKind {
    RigAnthropic,
    RigOpenAI,
    RigGemini,
    RigDeepSeek,
    RigOllama,
    RigOpenRouter,
    RigMira,
    OpenAICompat,
    Azure,
}

/// Pure routing function — no IO, table-testable. Mirrors the TS catalog's
/// `rigClientKind` field. Unknown ids fall through to `OpenAICompat` (raw
/// HTTP `/v1/models` is the safest guess for unknown OpenAI-shaped providers).
pub fn fetcher_kind(provider_id: &str) -> FetcherKind {
    match provider_id {
        "anthropic" | "anthropic-compatible" => FetcherKind::RigAnthropic,
        "openai" => FetcherKind::RigOpenAI,
        "gemini" => FetcherKind::RigGemini,
        "deepseek" => FetcherKind::RigDeepSeek,
        "ollama" => FetcherKind::RigOllama,
        "openrouter" => FetcherKind::RigOpenRouter,
        "mira" => FetcherKind::RigMira,
        "azure-openai" => FetcherKind::Azure,
        // openai-compatible + 11 OpenAI-compat family + any future unknown
        _ => FetcherKind::OpenAICompat,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListModelsParams {
    pub provider: String,
    pub api_key: String,
    pub base_url: Option<String>,
    // ponytail: azure_deployment_id is NOT accepted here — list_models only
    // needs api_version to call /openai/models, not the deployment id.
    // chat.rs keeps its own ChatParams with both Azure fields.
    pub azure_api_version: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ModelDto {
    pub id: String,
}

#[tauri::command]
pub async fn list_models(params: ListModelsParams) -> Result<Vec<ModelDto>, AppError> {
    let kind = fetcher_kind(&params.provider);
    let ids = match kind {
        FetcherKind::RigAnthropic => list_via_rig_anthropic(&params).await?,
        FetcherKind::RigOpenAI => list_via_rig_openai(&params).await?,
        FetcherKind::RigGemini => list_via_rig_gemini(&params).await?,
        FetcherKind::RigDeepSeek => list_via_rig_deepseek(&params).await?,
        FetcherKind::RigOllama => list_via_rig_ollama(&params).await?,
        FetcherKind::RigOpenRouter => list_via_rig_openrouter(&params).await?,
        FetcherKind::RigMira => list_via_rig_mira(&params).await?,
        FetcherKind::OpenAICompat => list_via_openai_compat(&params).await?,
        FetcherKind::Azure => list_via_azure(&params).await?,
    };
    Ok(ids.into_iter().map(|id| ModelDto { id }).collect())
}

// ponytail: 7 separate `list_via_rig_*` helpers instead of one generic
// `list_via_rig<C: ModelListingClient>()` because each rig provider Client
// is a distinct concrete type — the trait's `list_models` returns
// `impl Future<...>` (not dyn-compatible), so we cannot box them uniformly.
// Each helper is ~5 lines; total < 50 lines.

async fn list_via_rig_anthropic(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let mut b = anthropic::Client::builder().api_key(p.api_key.clone());
    if let Some(url) = &p.base_url {
        b = b.base_url(url.clone());
    }
    let client = b.build().map_err(|e| e.to_string())?;
    let list = client.list_models().await.map_err(|e| e.to_string())?;
    Ok(list.data.into_iter().map(|m| m.id).collect())
}

async fn list_via_rig_openai(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let client = openai::Client::builder()
        .api_key(p.api_key.clone())
        .base_url(base)
        .build()
        .map_err(|e| e.to_string())?;
    let list = client.list_models().await.map_err(|e| e.to_string())?;
    Ok(list.data.into_iter().map(|m| m.id).collect())
}

async fn list_via_rig_gemini(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let mut b = gemini::Client::builder().api_key(p.api_key.clone());
    if let Some(url) = &p.base_url {
        b = b.base_url(url.clone());
    }
    let client = b.build().map_err(|e| e.to_string())?;
    let list = client.list_models().await.map_err(|e| e.to_string())?;
    Ok(list.data.into_iter().map(|m| m.id).collect())
}

async fn list_via_rig_deepseek(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.deepseek.com".to_string());
    let client = deepseek::Client::builder()
        .api_key(p.api_key.clone())
        .base_url(base)
        .build()
        .map_err(|e| e.to_string())?;
    let list = client.list_models().await.map_err(|e| e.to_string())?;
    Ok(list.data.into_iter().map(|m| m.id).collect())
}

async fn list_via_rig_ollama(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "http://localhost:11434/v1".to_string());
    let client = ollama::Client::builder()
        .api_key(Nothing)
        .base_url(base)
        .build()
        .map_err(|e| e.to_string())?;
    let list = client.list_models().await.map_err(|e| e.to_string())?;
    Ok(list.data.into_iter().map(|m| m.id).collect())
}

async fn list_via_rig_openrouter(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "https://openrouter.ai/api/v1".to_string());
    let client = openrouter::Client::builder()
        .api_key(p.api_key.clone())
        .base_url(base)
        .build()
        .map_err(|e| e.to_string())?;
    let list = client.list_models().await.map_err(|e| e.to_string())?;
    Ok(list.data.into_iter().map(|m| m.id).collect())
}

async fn list_via_rig_mira(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    // ponytail: mira has its own `list_models` method returning `Vec<String>`
    // directly (not the trait), because its `ModelListing = Nothing` per rig
    // 0.40. Calling the method directly is the simplest path.
    let base = p
        .base_url
        .clone()
        .unwrap_or_else(|| "https://api.mira.network/v1".to_string());
    let client = mira::Client::builder()
        .api_key(p.api_key.clone())
        .base_url(base)
        .build()
        .map_err(|e| e.to_string())?;
    let ids = client.list_models().await.map_err(|e| e.to_string())?;
    Ok(ids)
}

/// OpenAI-compat raw HTTP fetcher — handles 11 OpenAI-compat family +
/// `openai-compatible` escape hatch. GET `<base_url>/models` with
/// `Authorization: Bearer <key>`, parse `{data: [{id: ...}]}`.
///
/// ponytail: does NOT append `/v1` — catalog `defaultBaseUrl` values already
/// include the correct path (e.g. `https://api.groq.com/openai/v1`). The
/// `openai-compatible` escape hatch requires the user to type the full path
/// including `/v1`; if they don't, the request 404s and surfaces that error
/// instead of silently mutating their input.
async fn list_via_openai_compat(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let base = p
        .base_url
        .clone()
        .ok_or_else(|| "base_url required for OpenAI-compatible provider".to_string())?;
    let url = openai_compat_models_url(&base);
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&p.api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), url).into());
    }
    let body: ModelsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body.data.into_iter().map(|m| m.id).collect())
}

/// Azure raw HTTP fetcher. GET `<base_url>/openai/models?api-version=<X>`
/// with `api-key: <key>` header (NOT Bearer — Azure uses a custom header).
async fn list_via_azure(p: &ListModelsParams) -> Result<Vec<String>, AppError> {
    let endpoint = p
        .base_url
        .clone()
        .ok_or_else(|| "base_url (Azure endpoint) required".to_string())?;
    let api_version = p
        .azure_api_version
        .clone()
        .ok_or_else(|| "azure_api_version required".to_string())?;
    let url = azure_models_url(&endpoint, &api_version);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("api-key", p.api_key.clone())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), url).into());
    }
    let body: ModelsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body.data.into_iter().map(|m| m.id).collect())
}

/// Pure URL constructors — extracted so tests can verify the path shape
/// without HTTP. The catalog's `defaultBaseUrl` is treated as authoritative;
/// we trim trailing `/` and append the documented path.
fn openai_compat_models_url(base: &str) -> String {
    format!("{}/models", base.trim_end_matches('/'))
}

fn azure_models_url(endpoint: &str, api_version: &str) -> String {
    format!(
        "{}/openai/models?api-version={}",
        endpoint.trim_end_matches('/'),
        api_version
    )
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelsResponseItem>,
}

#[derive(Deserialize)]
struct ModelsResponseItem {
    id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Table-driven routing test — all 20 catalog ids + 1 unknown.
    #[test]
    fn fetcher_kind_routes_all_catalog_ids() {
        // Native Rig-implementing (7)
        assert_eq!(fetcher_kind("anthropic"), FetcherKind::RigAnthropic);
        assert_eq!(fetcher_kind("openai"), FetcherKind::RigOpenAI);
        assert_eq!(fetcher_kind("gemini"), FetcherKind::RigGemini);
        assert_eq!(fetcher_kind("deepseek"), FetcherKind::RigDeepSeek);
        assert_eq!(fetcher_kind("ollama"), FetcherKind::RigOllama);
        assert_eq!(fetcher_kind("openrouter"), FetcherKind::RigOpenRouter);
        assert_eq!(fetcher_kind("mira"), FetcherKind::RigMira);

        // Azure special
        assert_eq!(fetcher_kind("azure-openai"), FetcherKind::Azure);

        // Compat escape hatches
        assert_eq!(
            fetcher_kind("openai-compatible"),
            FetcherKind::OpenAICompat
        );
        assert_eq!(
            fetcher_kind("anthropic-compatible"),
            FetcherKind::RigAnthropic
        );

        // 11 OpenAI-compat family — all fall through to OpenAICompat
        for id in [
            "eternalai",
            "galadriel",
            "groq",
            "hyperbolic",
            "moonshot",
            "perplexity",
            "together",
            "xai",
        ] {
            assert_eq!(fetcher_kind(id), FetcherKind::OpenAICompat, "id={}", id);
        }
    }

    #[test]
    fn fetcher_kind_unknown_routes_to_openai_compat() {
        assert_eq!(fetcher_kind("some-new-provider"), FetcherKind::OpenAICompat);
        assert_eq!(fetcher_kind(""), FetcherKind::OpenAICompat);
    }

    #[test]
    fn openai_compat_models_url_appends_models_path() {
        // Catalog defaultBaseUrl already includes /v1 where the provider needs it.
        assert_eq!(
            openai_compat_models_url("https://api.groq.com/openai/v1"),
            "https://api.groq.com/openai/v1/models"
        );
        assert_eq!(
            openai_compat_models_url("https://api.deepseek.com"),
            "https://api.deepseek.com/models"
        );
        // Trailing slash is trimmed.
        assert_eq!(
            openai_compat_models_url("https://api.deepseek.com/"),
            "https://api.deepseek.com/models"
        );
    }

    #[test]
    fn azure_models_url_builds_correct_path() {
        assert_eq!(
            azure_models_url("https://my-resource.openai.azure.com", "2024-10-21"),
            "https://my-resource.openai.azure.com/openai/models?api-version=2024-10-21"
        );
        // Trailing slash is trimmed.
        assert_eq!(
            azure_models_url("https://my-resource.openai.azure.com/", "2024-10-21"),
            "https://my-resource.openai.azure.com/openai/models?api-version=2024-10-21"
        );
    }
}
