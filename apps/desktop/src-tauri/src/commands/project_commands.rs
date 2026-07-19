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
            "-c", "http.userAgent=Quill-Desktop/1.0",
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
    let tree_output = std::process::Command::new("find")
        .args([
            &dir,
            "-maxdepth", "3",
            "-not", "-path", "*/.git/*",
            "-not", "-path", "*/.git",
            "-not", "-path", "*/node_modules/*",
            "-not", "-path", "*/target/*",
            "-not", "-path", "*/__pycache__/*",
            "-not", "-path", "*/.next/*",
            "-not", "-path", "*/dist/*",
            "-not", "-path", "*/build/*",
        ])
        .output()
        .map_err(|e| format!("Failed to list files: {}", e))?;
    let tree = String::from_utf8_lossy(&tree_output.stdout);

    let total_lines = tree.lines().count();
    let lines: Vec<&str> = tree.lines().take(500).collect();
    let truncated = if total_lines > 500 {
        format!(
            "{}\n... ({} more files)",
            lines.join("\n"),
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
