use serde::{Serialize, Serializer};
use serde::ser::SerializeMap;

/// User-visible error category. The frontend maps `category` to an i18n key
/// under the `rustErrors` namespace; `detail` (optional) carries dynamic
/// context that becomes an interpolation param.
///
/// ponytail: only four broad categories — variant-per-site would be 1:1 with
/// each error site and defeat the point of category-based translation. Add a
/// new variant only when a category is missing, not when a new call site
/// appears. Internal logs and OS-level strings stay raw (out of scope).
#[derive(Debug, Clone)]
pub enum AppError {
    Io { detail: String },
    NotFound { detail: String },
    Permission { detail: String },
    Internal { detail: String },
}

impl AppError {
    pub fn category(&self) -> &'static str {
        match self {
            AppError::Io { .. } => "io",
            AppError::NotFound { .. } => "notFound",
            AppError::Permission { .. } => "permission",
            AppError::Internal { .. } => "internal",
        }
    }

    pub fn detail(&self) -> &str {
        match self {
            AppError::Io { detail }
            | AppError::NotFound { detail }
            | AppError::Permission { detail }
            | AppError::Internal { detail } => detail,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(Some(2))?;
        map.serialize_entry("category", self.category())?;
        map.serialize_entry("detail", self.detail())?;
        map.end()
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.category(), self.detail())
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound { detail: e.to_string() },
            std::io::ErrorKind::PermissionDenied => AppError::Permission { detail: e.to_string() },
            _ => AppError::Io { detail: e.to_string() },
        }
    }
}

// ponytail: From<String>/From<&str> collapse every legacy `.map_err(|e| e.to_string())`
// helper site into `Internal` without touching the helper. Specific sites that
// need a sharper category (NotFound/Permission) call `AppError::from(io_err)` or
// construct the variant directly at the boundary; the broad impl keeps the
// `?`-based propagation working while the command signature flips to AppError.
impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Internal { detail: s }
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Internal { detail: s.to_string() }
    }
}
