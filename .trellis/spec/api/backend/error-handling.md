# Error Handling

> How errors are handled in the Tauri backend.

---

## Command Error Pattern

All Tauri commands return `Result<T, String>` — Rust errors converted to strings:

```rust
#[tauri::command]
pub async fn open_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}
```

---

## Structured Responses

When a command needs to return multiple fields (including error details), use a `#[derive(Serialize)]` struct:

```rust
#[derive(Serialize)]
pub struct UrlCheckResult {
    pub reachable: bool,
    pub error: String,
}

#[tauri::command]
pub async fn check_url(url: String) -> UrlCheckResult {
    let output = std::process::Command::new("curl")
        .args(["-s", "--max-time", "8", "--location", "-o", "/dev/null", "-w", "%{http_code}", &url])
        .output();

    match output {
        Ok(out) => {
            let status: u16 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0);
            if status > 0 {
                UrlCheckResult { reachable: true, error: String::new() }
            } else {
                UrlCheckResult { reachable: false, error: String::from_utf8_lossy(&out.stderr).to_string() }
            }
        }
        Err(e) => UrlCheckResult { reachable: false, error: e.to_string() },
    }
}
```

---

## Frontend Error Handling

On the TypeScript side, errors are caught via `.catch()`:

```ts
// Non-critical — silently ignore
invoke('hide_all_webviews').catch(() => {});

// Critical — surface to user
try {
  const content = await invoke<string>('open_file', { path });
} catch (err) {
  console.error('[Editor] Failed to open file:', err);
}
```

---

## No Custom Error Types

The Rust side does not define custom error enums — string errors are sufficient for the current scope. If error categorization is needed in the future, introduce a serde-serializable error enum.

Reference: `apps/desktop/src-tauri/src/commands.rs`
