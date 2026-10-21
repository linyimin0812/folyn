//! Isolated, bounded browser fallback for public subscription pages.
use crate::subscriptions::{authorize, public_addresses, validate_url, SubscriptionResponse};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{webview::NewWindowResponse, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::{mpsc, oneshot, Semaphore};

pub(crate) const RENDER_PREFIX: &str = "subscription-render-";
pub(crate) fn is_acquisition_webview(label: &str) -> bool {
    label.starts_with(RENDER_PREFIX)
}
const MAX_HTML: usize = 8 * 1024 * 1024;
const MAX_IMAGE: usize = 20 * 1024 * 1024;
#[derive(Clone, Copy, PartialEq)]
enum AcquisitionKind {
    Page,
    Image,
}
const RENDER_SECONDS: u64 = 28;
static RENDER_LIMIT: Semaphore = Semaphore::const_new(1);
#[derive(Default)]
struct Jobs {
    active: HashMap<String, (String, Arc<AtomicBool>)>,
    cancelled: HashSet<(String, String)>,
}
fn jobs() -> &'static Mutex<Jobs> {
    static JOBS: OnceLock<Mutex<Jobs>> = OnceLock::new();
    JOBS.get_or_init(Mutex::default)
}
fn valid_job_id(id: &str) -> bool {
    (16..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

struct RenderLease {
    app: tauri::AppHandle,
    label: String,
    request_id: String,
    profile: PathBuf,
    cancelled: Arc<AtomicBool>,
}
impl Drop for RenderLease {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        if let Ok(mut state) = jobs().lock() {
            state.active.remove(&self.request_id);
        }
        let app = self.app.clone();
        let label = self.label.clone();
        let profile = self.profile.clone();
        let _ = self.app.run_on_main_thread(move || {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.clear_all_browsing_data();
                let _ = window.destroy();
            }
            // WebView2 may release the isolated profile handles asynchronously.
            tauri::async_runtime::spawn(async move {
                for _ in 0..3 {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    let path = profile.clone();
                    if tauri::async_runtime::spawn_blocking(move || fs::remove_dir_all(path))
                        .await
                        .is_ok_and(|v| v.is_ok())
                    {
                        break;
                    }
                }
            });
        });
    }
}

/// Cancellation is accepted after disable/uninstall so activation teardown can
/// always destroy its own outstanding isolated windows. No file/network access.
#[tauri::command]
pub async fn subscription_cancel_renders(
    app: tauri::AppHandle,
    extension_id: String,
    request_ids: Vec<String>,
) -> Result<(), String> {
    if !crate::extension_commands::is_valid_extension_id(&extension_id)
        || request_ids.len() > 32
        || request_ids.iter().any(|id| !valid_job_id(id))
    {
        return Err("invalid render cancellation".into());
    }
    let mut state = jobs().lock().map_err(|_| "render registry unavailable")?;
    for id in request_ids {
        if let Some((owner, cancelled)) = state.active.get(&id) {
            if owner != &extension_id {
                continue;
            }
            cancelled.store(true, Ordering::Release);
        } else {
            if state.cancelled.len() < 128 {
                state.cancelled.insert((extension_id.clone(), id.clone()));
            }
            continue;
        }
        if let Some(window) = app.get_webview_window(&format!("{RENDER_PREFIX}{id}")) {
            let _ = window.destroy();
        }
    }
    Ok(())
}

// Runs at document start in all frames. The app-level Invoke guard is the
// authoritative boundary; hiding the JS bridge is defense in depth only.
const ISOLATE_SCRIPT: &str = r#"(() => {
  for (const key of ['__TAURI__','__TAURI_INTERNALS__','__TAURI_EVENT_PLUGIN_INTERNALS__']) {
    try { delete window[key]; Object.defineProperty(window,key,{value:undefined,configurable:false}); } catch (_) {}
  }
  try { Object.defineProperty(window,'open',{value:()=>null,configurable:false}); } catch (_) {}
  try { navigator.serviceWorker?.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())); } catch (_) {}
})()"#;
const SNAPSHOT_SCRIPT: &str = r#"(() => { try {
  const root=document.documentElement;
  if(!root) return {ready:false,url:location.href};
  const text=(document.body?.innerText||root.textContent||'').trim();
  const title=document.title||'';
  const lower=(title+' '+text.slice(0,1200)).toLowerCase();
  let blocked='';
  if(/verify (that )?you are human|checking your browser|just a moment\.\.\.|attention required.*cloudflare|captcha verification/.test(lower) || [...document.querySelectorAll('iframe[src*="captcha"],#challenge-running,#cf-challenge-running')].some(el=>el.getBoundingClientRect().width>100&&el.getBoundingClientRect().height>40)) blocked='verification/CAPTCHA page';
  else if([...document.querySelectorAll('input[type="password"]')].some(el=>el.getClientRects().length>0) && /sign in|log in|login|登录|登入/.test(lower)) blocked='login required';
  const xml=!/html/i.test(root.tagName)||/xml/.test(document.contentType||'');
  const clone=root.cloneNode(true);
  if(!xml) {
    clone.querySelectorAll('script').forEach(s=>{if(!/^(application\/(ld\+)?json|text\/json)$/i.test(s.getAttribute('type')||''))s.remove();});
    clone.querySelectorAll('iframe,object,embed').forEach(s=>s.remove());
    [clone,...clone.querySelectorAll('*')].forEach(el=>{for(const a of [...el.attributes])if(/^on/i.test(a.name))el.removeAttribute(a.name);});
  }
  const body=clone.outerHTML;
  if(body.length>8388608 || new TextEncoder().encode(body).length>8388608) return {error:'rendered document exceeds 8 MiB limit'};
  const links=root.querySelectorAll('a[href]').length;
  return {ready:document.readyState==='complete',url:location.href,body,title,blocked,textLength:text.length,links,xml,
    article:!!root.querySelector('article,main,[itemtype*="Article"]'),signature:[body.length,text.length,links,document.body?.scrollHeight||0].join(':')};
} catch(e){return {error:String(e)}} })()"#;

// Fetch only the currently validated image document, with no credentials or
// fetch redirects. Keep original bytes (including animated GIFs), never canvas.
const IMAGE_SCRIPT: &str = r#"(() => {
  const key='__folynImageAcquisition';
  if(window[key]) return window[key];
  if(document.readyState!=='complete') return {ready:false};
  if(!/^image\//i.test(document.contentType||'')) return {error:'browser image acquisition requires an image response'};
  const state={ready:false};Object.defineProperty(window,key,{value:state});
  (async()=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(location.href,{credentials:'omit',redirect:'error',signal:controller.signal});
      const type=response.headers.get('content-type')||'';
      if(!response.ok) throw new Error('image HTTP '+response.status);
      if(!/^image\//i.test(type)) throw new Error('browser image response is not an image');
      const limit=20971520;
      if(Number(response.headers.get('content-length')||0)>limit) throw new Error('image exceeds 20 MiB limit');
      const reader=response.body?.getReader();if(!reader) throw new Error('image response stream unavailable');
      const chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('image exceeds 20 MiB limit')}chunks.push(value)}
      if(!size) throw new Error('image response is empty');
      let encoded='';for(const chunk of chunks)for(let i=0;i<chunk.length;i+=8192)encoded+=String.fromCharCode(...chunk.subarray(i,i+8192));
      Object.assign(state,{ready:true,url:response.url,body:btoa(encoded),contentType:type,status:response.status,byteLength:size});
    }catch(error){state.error=String(error)}finally{clearTimeout(timer)}
  })();return state;
})()"#;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    #[serde(default)]
    ready: bool,
    #[serde(default)]
    url: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    blocked: String,
    #[serde(default)]
    text_length: usize,
    #[serde(default)]
    links: usize,
    #[serde(default)]
    xml: bool,
    #[serde(default)]
    article: bool,
    #[serde(default)]
    signature: String,
    #[serde(default)]
    error: String,
    #[serde(default)]
    content_type: String,
    #[serde(default)]
    status: u16,
    #[serde(default)]
    byte_length: usize,
}
fn parse_snapshot(raw: &str) -> Result<Snapshot, String> {
    // eval_with_callback serializes the result itself. Native backends may
    // wrap a JSON string result once more; accept either explicit shape.
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("invalid render callback: {e}"))?;
    match value {
        serde_json::Value::String(s) => serde_json::from_str(&s),
        v => serde_json::from_value(v),
    }
    .map_err(|e| format!("invalid render snapshot: {e}"))
}
async fn snapshot(
    window: &tauri::WebviewWindow,
    kind: AcquisitionKind,
) -> Result<Snapshot, String> {
    let (tx, mut rx) = mpsc::channel(1);
    window
        .eval_with_callback(
            if kind == AcquisitionKind::Image {
                IMAGE_SCRIPT
            } else {
                SNAPSHOT_SCRIPT
            },
            move |value| {
                let _ = tx.try_send(value);
            },
        )
        .map_err(|e| format!("render evaluation failed: {e}"))?;
    let raw = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .map_err(|_| "render evaluation timed out")?
        .ok_or("render evaluation closed")?;
    parse_snapshot(&raw)
}
fn snapshot_ready(value: &Snapshot, elapsed: Duration, stable: Duration) -> bool {
    if !value.ready || value.body.is_empty() || !value.blocked.is_empty() || !value.error.is_empty()
    {
        return false;
    }
    let useful = value.xml
        || (value.article && value.text_length >= 40)
        || value.text_length >= 120
        || value.links >= 2;
    elapsed >= Duration::from_secs(3)
        && stable >= Duration::from_millis(1500)
        && (useful || (elapsed >= Duration::from_secs(12) && value.text_length > 0))
}
fn image_response(value: Snapshot) -> Result<SubscriptionResponse, String> {
    if !(200..300).contains(&value.status)
        || !value
            .content_type
            .to_ascii_lowercase()
            .starts_with("image/")
    {
        return Err("browser image response must be a successful image".into());
    }
    if value.byte_length == 0
        || value.byte_length > MAX_IMAGE
        || value.body.len() > MAX_IMAGE.div_ceil(3) * 4
    {
        return Err("browser image response exceeds size limit or is empty".into());
    }
    let bytes = STANDARD
        .decode(&value.body)
        .map_err(|_| "invalid browser image encoding")?;
    if bytes.len() != value.byte_length || bytes.len() > MAX_IMAGE {
        return Err("browser image response byte count mismatch".into());
    }
    Ok(SubscriptionResponse {
        status: value.status,
        headers: HashMap::from([
            ("content-type".into(), value.content_type),
            ("x-folyn-rendered".into(), "true".into()),
        ]),
        body: value.body,
        url: value.url,
    })
}
async fn render_page(
    app: tauri::AppHandle,
    extension_id: String,
    request_id: String,
    url: String,
    kind: AcquisitionKind,
) -> Result<SubscriptionResponse, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut state = jobs().lock().map_err(|_| "render registry unavailable")?;
        if state
            .cancelled
            .remove(&(extension_id.clone(), request_id.clone()))
        {
            return Err("subscription render cancelled".into());
        }
        if state.active.len() >= 8 {
            return Err("subscription renderer queue is full; retry later".into());
        }
        if state.active.contains_key(&request_id) {
            return Err("duplicate render request".into());
        }
        state.active.insert(
            request_id.clone(),
            (extension_id.clone(), cancelled.clone()),
        );
    }
    let label = format!("{RENDER_PREFIX}{request_id}");
    let profile = std::env::temp_dir().join(format!("folyn-{label}"));
    let _lease = RenderLease {
        app: app.clone(),
        label: label.clone(),
        request_id,
        profile: profile.clone(),
        cancelled: cancelled.clone(),
    };
    // Queue both pages and images behind the same bounded renderer. Register
    // first so queued work is cancelled by activation disposal as well.
    let permit = RENDER_LIMIT.acquire();
    tokio::pin!(permit);
    let _permit = loop {
        tokio::select! {
            permit = &mut permit => break permit.map_err(|_| "subscription renderer unavailable")?,
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                if cancelled.load(Ordering::Acquire) { return Err("subscription render cancelled".into()); }
            }
        }
    };
    let gate_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        authorize(&gate_app, &extension_id, "render")?;
        if kind == AcquisitionKind::Image {
            authorize(&gate_app, &extension_id, "network")?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    let initial = validate_url(&url)?;
    public_addresses(&initial).await?;
    if cancelled.load(Ordering::Acquire) {
        return Err("subscription render cancelled".into());
    }
    let expected_url = Arc::new(Mutex::new(initial.to_string()));
    let navigation_loading = Arc::new(AtomicBool::new(true));
    let expected_load = expected_url.clone();
    let loading_callback = navigation_loading.clone();
    let approved = Arc::new(Mutex::new(HashSet::from([initial.to_string()])));
    let blocked = Arc::new(Mutex::new(None::<String>));
    let (nav_tx, mut nav_rx) = mpsc::channel::<String>(8);
    let build_app = app.clone();
    let build_label = label.clone();
    let approved_nav = approved.clone();
    let blocked_nav = blocked.clone();
    let cancelled_build = cancelled.clone();
    let (built_tx, built_rx) = oneshot::channel();
    app.run_on_main_thread(move || {
        if cancelled_build.load(Ordering::Acquire) {
            let _ = built_tx.send(Err("subscription render cancelled".to_string()));
            return;
        }
        let result =
            WebviewWindowBuilder::new(&build_app, &build_label, WebviewUrl::External(initial))
                .title("Subscription page acquisition")
                .visible(false)
                .focused(false)
                .skip_taskbar(true)
                .inner_size(1280.0, 900.0)
                .incognito(true)
                .data_directory(profile)
                .disable_drag_drop_handler()
                .devtools(false)
                .general_autofill_enabled(false)
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                .initialization_script_for_all_frames(ISOLATE_SCRIPT)
                .on_page_load(move |_, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Finished
                        && expected_load
                            .lock()
                            .is_ok_and(|expected| expected.as_str() == payload.url().as_str())
                    {
                        loading_callback.store(false, Ordering::Release);
                    }
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_download(|_, _| false)
                .on_navigation(move |target| {
                    if cancelled_build.load(Ordering::Acquire) {
                        return false;
                    }
                    if target.as_str() == "about:blank" {
                        return true;
                    }
                    let target = match validate_url(target.as_str()) {
                        Ok(v) => v,
                        Err(e) => {
                            if let Ok(mut blocked) = blocked_nav.lock() {
                                *blocked = Some(format!("render navigation blocked: {e}"));
                            }
                            return false;
                        }
                    };
                    if approved_nav
                        .lock()
                        .is_ok_and(|a| a.contains(target.as_str()))
                    {
                        return true;
                    }
                    let _ = nav_tx.try_send(target.to_string());
                    false
                })
                .build()
                .map(|_| ())
                .map_err(|e| format!("isolated render webview unavailable: {e}"));
        let _ = built_tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), built_rx)
        .await
        .map_err(|_| "render window creation timed out")?
        .map_err(|_| "render window creation closed")??;
    let started = Instant::now();
    let mut signature = String::new();
    let mut stable_since = Instant::now();
    let mut steps = 0u32;
    let mut nav_count = 0u32;
    let mut last = Snapshot::default();
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err("subscription render cancelled".into());
        }
        if let Some(error) = blocked
            .lock()
            .map_err(|_| "render navigation state unavailable")?
            .clone()
        {
            return Err(error);
        }
        while let Ok(candidate) = nav_rx.try_recv() {
            nav_count += 1;
            if nav_count > 12 {
                return Err("render navigation limit exceeded".into());
            }
            let candidate = validate_url(&candidate)?;
            public_addresses(&candidate)
                .await
                .map_err(|e| format!("render navigation blocked: {e}"))?;
            approved
                .lock()
                .map_err(|_| "render navigation state unavailable")?
                .insert(candidate.to_string());
            if cancelled.load(Ordering::Acquire) {
                return Err("subscription render cancelled".into());
            }
            *expected_url
                .lock()
                .map_err(|_| "render navigation state unavailable")? = candidate.to_string();
            navigation_loading.store(true, Ordering::Release);
            app.get_webview_window(&label)
                .ok_or("render window closed")?
                .navigate(candidate)
                .map_err(|e| e.to_string())?;
            signature.clear();
            steps = 0;
            stable_since = Instant::now();
        }
        let window = app
            .get_webview_window(&label)
            .ok_or("render window closed")?;
        match snapshot(&window, kind).await {
            Ok(value) => {
                if !value.error.is_empty() {
                    return Err(value.error);
                }
                if !value.blocked.is_empty() {
                    return Err(format!(
                        "subscription render blocked: {} ({})",
                        value.blocked, value.title
                    ));
                }
                if kind == AcquisitionKind::Image {
                    if value.ready && !navigation_loading.load(Ordering::Acquire) {
                        let final_url = validate_url(&value.url)?;
                        public_addresses(&final_url).await?;
                        return image_response(value);
                    }
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    continue;
                }
                if value.body.len() > MAX_HTML {
                    return Err("rendered document exceeds 8 MiB limit".into());
                }
                if value.signature != signature {
                    signature = value.signature.clone();
                    stable_since = Instant::now();
                }
                let elapsed = started.elapsed();
                if value.ready
                    && steps < 4
                    && elapsed >= Duration::from_millis(1000 + steps as u64 * 700)
                {
                    window.eval(format!("window.scrollTo(0, Math.min(document.documentElement.scrollHeight, {} * window.innerHeight));",steps+1)).map_err(|e|e.to_string())?;
                    steps += 1;
                    stable_since = Instant::now();
                }
                if !navigation_loading.load(Ordering::Acquire)
                    && steps >= 4
                    && snapshot_ready(&value, elapsed, stable_since.elapsed())
                {
                    let final_url = validate_url(&value.url)?;
                    public_addresses(&final_url).await?;
                    return Ok(SubscriptionResponse {
                        status: 200,
                        headers: HashMap::from([
                            (
                                "content-type".into(),
                                if value.xml {
                                    "application/xml; charset=utf-8".into()
                                } else {
                                    "text/html; charset=utf-8".into()
                                },
                            ),
                            ("x-folyn-rendered".into(), "true".into()),
                            ("x-folyn-status-unavailable".into(), "true".into()),
                        ]),
                        body: value.body,
                        url: final_url.to_string(),
                    });
                }
                last = value;
            }
            Err(e) => {
                if started.elapsed() > Duration::from_secs(10) {
                    return Err(e);
                }
            }
        }
        if started.elapsed() >= Duration::from_secs(24) {
            return Err(format!(
                "subscription render timed out: {}",
                if last.body.is_empty() {
                    "page did not load"
                } else if last.text_length == 0 && last.links == 0 {
                    "empty document"
                } else {
                    "page content did not settle"
                }
            ));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
#[tauri::command]
pub async fn subscription_render(
    app: tauri::AppHandle,
    extension_id: String,
    request_id: String,
    url: String,
) -> Result<SubscriptionResponse, String> {
    if !valid_job_id(&request_id) {
        return Err("invalid render request id".into());
    }
    tokio::time::timeout(
        Duration::from_secs(RENDER_SECONDS),
        render_page(app, extension_id, request_id, url, AcquisitionKind::Page),
    )
    .await
    .map_err(|_| format!("subscription render timed out after {RENDER_SECONDS} seconds"))?
}
/// Internal image-only fallback. Not a general browser fetch API: it shares
/// isolation, main-navigation checks, lifecycle registry and deadline with pages.
pub(crate) async fn render_image(
    app: tauri::AppHandle,
    extension_id: String,
    request_id: String,
    url: String,
) -> Result<SubscriptionResponse, String> {
    if !valid_job_id(&request_id) {
        return Err("invalid image request id".into());
    }
    tokio::time::timeout(
        Duration::from_secs(RENDER_SECONDS),
        render_page(app, extension_id, request_id, url, AcquisitionKind::Image),
    )
    .await
    .map_err(|_| {
        format!("subscription image acquisition timed out after {RENDER_SECONDS} seconds")
    })?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_bytes_and_mime_are_preserved_and_invalid_payloads_reject() {
        let bytes = b"GIF89a\x01\x00\x01\x00animated-original-payload";
        let make = || Snapshot {
            ready: true,
            url: "https://example.com/animation.gif".into(),
            body: STANDARD.encode(bytes),
            content_type: "image/gif".into(),
            status: 200,
            byte_length: bytes.len(),
            ..Default::default()
        };
        let response = image_response(make()).unwrap();
        assert_eq!(response.headers["content-type"], "image/gif");
        assert_eq!(STANDARD.decode(response.body).unwrap(), bytes);
        let mut value = make();
        value.content_type = "text/html".into();
        assert!(image_response(value).is_err());
        let mut value = make();
        value.status = 403;
        assert!(image_response(value).is_err());
        let mut value = make();
        value.byte_length = MAX_IMAGE + 1;
        assert!(image_response(value).is_err());
        let mut value = make();
        value.body = "invalid-base64".into();
        assert!(image_response(value).is_err());
        let mut value = make();
        value.byte_length += 1;
        assert!(image_response(value).is_err());
        let mut value = make();
        value.byte_length = 0;
        assert!(image_response(value).is_err());
    }
    #[test]
    fn short_pages_are_allowed_after_settling() {
        let page = Snapshot {
            ready: true,
            body: "<html>tiny</html>".into(),
            text_length: 4,
            ..Default::default()
        };
        assert!(!snapshot_ready(
            &page,
            Duration::from_secs(3),
            Duration::from_secs(2)
        ));
        assert!(snapshot_ready(
            &page,
            Duration::from_secs(12),
            Duration::from_secs(2)
        ));
    }
    #[test]
    fn challenge_or_loading_pages_are_not_ready() {
        let page = Snapshot {
            ready: true,
            body: "<html/>".into(),
            blocked: "CAPTCHA".into(),
            article: true,
            ..Default::default()
        };
        assert!(!snapshot_ready(
            &page,
            Duration::from_secs(20),
            Duration::from_secs(2)
        ));
    }
    #[test]
    fn callback_json_shapes_and_job_ids() {
        assert!(
            parse_snapshot(r#"{"ready":true,"textLength":8}"#)
                .unwrap()
                .ready
        );
        assert!(parse_snapshot(r#""{\"ready\":true}""#).unwrap().ready);
        assert!(!valid_job_id("../main"));
        assert!(is_acquisition_webview("subscription-render-aabbccdd"));
        assert!(!is_acquisition_webview("main"));
        assert!(valid_job_id("aabbccdd-0011-2233-4455-667788990011"));
    }
}
