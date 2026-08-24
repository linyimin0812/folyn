use crate::errors::AppError;

/// Removes the target directory first if it already exists (for re-cloning).
/// Includes network resilience configs for unstable connections.
#[tauri::command]
pub async fn git_clone(url: String, target_dir: String) -> Result<String, AppError> {
    // Remove existing target directory for clean re-clone
    let _ = std::fs::remove_dir_all(&target_dir);

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&target_dir).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let output = std::process::Command::new("git")
        .args([
            "-c", "http.version=HTTP/1.1",
            "-c", "http.userAgent=Folyn-Desktop/1.0",
            "-c", "http.lowSpeedLimit=1000",
            "-c", "http.lowSpeedTime=30",
            "clone", "--depth", "1", "--single-branch",
            &url, &target_dir,
        ])
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Cleanup failed clone attempt
        let _ = std::fs::remove_dir_all(&target_dir);
        return Err(format!("克隆仓库失败: {}", stderr.trim()).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}

/// Remove a directory and all its contents recursively.
/// Used to clean up cloned repos after analysis.
#[tauri::command]
pub async fn remove_dir(path: String) -> Result<(), AppError> {
    std::fs::remove_dir_all(&path).map_err(AppError::from)
}

/// Get a text overview of a project directory (file tree + basic stats).
/// Excludes common noise directories (.git, node_modules, target, etc.).
/// Limits output to 500 lines for manageable AI context.
#[tauri::command]
pub async fn get_project_overview(dir: String) -> Result<String, AppError> {
    let mut lines: Vec<String> = Vec::new();
    walk_dir(std::path::Path::new(&dir), 0, 3, &mut lines);

    let total_lines = lines.len();
    let truncated = if total_lines > 500 {
        let head: Vec<&str> = lines.iter().take(500).map(String::as_str).collect();
        format!(
            "{}\n... ({} more files)",
            head.join("\n"),
            total_lines - 500
        )
    } else {
        lines.join("\n")
    };

    // Strip the base dir prefix for readability
    let prefix = format!("{}/", dir.trim_end_matches('/'));
    let cleaned = truncated
        .replace(&prefix, "")
        .replace(dir.trim_end_matches('/'), ".");

    Ok(cleaned)
}

// ponytail: replaces `find -maxdepth 3 -not -path '*/.git/*' ...` — that shell
// command is macOS/Linux only. A 20-line std::fs recursion covers the same
// contract (maxdepth + skip-list) without a dep. Skip-list matches the prior
// `-not -path` filters verbatim. Upgrade to walkdir if/when symlink or
// permission-edge handling is needed.
const PROJECT_OVERVIEW_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "__pycache__",
    ".next",
    "dist",
    "build",
];

fn walk_dir(root: &std::path::Path, depth: u32, max_depth: u32, out: &mut Vec<String>) {
    if depth > max_depth {
        return;
    }
    let mut entries: Vec<_> = match std::fs::read_dir(root) {
        Ok(it) => it.filter_map(|e| e.ok()).collect(),
        Err(_) => return,
    };
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if PROJECT_OVERVIEW_SKIP_DIRS.contains(&name_str.as_ref()) {
            continue;
        }
        // Normalize to '/' so the prefix-strip logic below works on Windows too.
        out.push(path.to_string_lossy().replace('\\', "/"));
        if path.is_dir() {
            walk_dir(&path, depth + 1, max_depth, out);
        }
    }
}
