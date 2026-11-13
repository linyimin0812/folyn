//! `process:exec` on behalf of trusted extensions (`api.process.exec`).
//!
//! The one way an extension runs a local program. Which programs is the
//! extension's own declaration — `permissions.exec.programs` in its manifest,
//! shown in the consent dialog — not a list kept in the host. The JS side
//! fast-fails on an undeclared program; this re-checks the on-disk manifest.

use std::fs;

use serde::Serialize;

use crate::errors::AppError;
use crate::extension_commands::{extensions_dir, is_valid_extension_id};
use crate::extension_security::check_exec_program;

/// Result of `extension_exec` — stdout + stderr + exit code; the extension
/// decides what a non-zero exit means (git returns 128 on a bad repo, etc.).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Run a declared program with separated args (no shell → no injection) and
/// wait for it to exit. Async + spawn_blocking: the child can run for a while,
/// and a blocking wait must not sit on the main thread.
#[tauri::command]
pub async fn extension_exec(
    app: tauri::AppHandle,
    extension_id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<ExecOutput, AppError> {
    // A bare id segment, so the manifest read below cannot leave the
    // extensions dir and borrow another extension's declaration.
    if !is_valid_extension_id(&extension_id) {
        return Err(format!("process:exec denied: invalid extension id: {extension_id}").into());
    }
    let manifest_path = extensions_dir(&app)?
        .join(&extension_id)
        .join("manifest.json");
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read manifest for {extension_id}: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_str).map_err(|e| e.to_string())?;
    check_exec_program(&manifest, &program)?;

    tauri::async_runtime::spawn_blocking(move || run(&program, &args, cwd.as_deref()))
        .await
        .map_err(|e| AppError::Internal {
            detail: format!("exec task join failed: {e}"),
        })?
}

fn run(program: &str, args: &[String], cwd: Option<&str>) -> Result<ExecOutput, AppError> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    let out = command
        .output()
        .map_err(|e| format!("process:exec failed to run {program}: {e}"))?;
    Ok(ExecOutput {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        exit_code: out.status.code().unwrap_or(-1),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn run_captures_output_and_exit_code() {
        let out = run(
            "sh",
            &[
                "-c".to_string(),
                "echo out; echo err >&2; exit 3".to_string(),
            ],
            None,
        )
        .unwrap();
        assert_eq!(out.stdout, "out\n");
        assert_eq!(out.stderr, "err\n");
        assert_eq!(out.exit_code, 3);
    }

    #[cfg(unix)]
    #[test]
    fn run_honors_cwd() {
        let dir = std::env::temp_dir();
        let out = run("pwd", &[], dir.to_str()).unwrap();
        let reported = fs::canonicalize(out.stdout.trim()).unwrap();
        assert_eq!(reported, fs::canonicalize(&dir).unwrap());
    }

    #[test]
    fn run_reports_a_missing_program() {
        assert!(run("folyn-no-such-program", &[], None).is_err());
    }
}
