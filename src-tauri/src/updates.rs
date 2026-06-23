use serde::Serialize;
use serde_json::Value;
use std::time::UNIX_EPOCH;

const DEFAULT_UPDATE_ENDPOINTS: [&str; 2] = [
    "https://github.com/Kuddev/SMRmanager/releases/latest/download/latest.json",
    "https://api.github.com/repos/Kuddev/SMRmanager/releases/latest",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheckResult {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub available: bool,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub release_url: Option<String>,
    pub download_url: Option<String>,
    pub source_url: String,
    pub checked_at: String,
}

fn normalize_version(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn is_remote_newer(current: &str, remote: &str) -> bool {
    let current = normalize_version(current);
    let remote = normalize_version(remote);
    let len = current.len().max(remote.len()).max(1);
    for index in 0..len {
        let left = *remote.get(index).unwrap_or(&0);
        let right = *current.get(index).unwrap_or(&0);
        if left > right {
            return true;
        }
        if left < right {
            return false;
        }
    }
    false
}

fn checked_at() -> String {
    UNIX_EPOCH
        .elapsed()
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn parse_tauri_latest_json(root: &Value) -> Option<(String, Option<String>, Option<String>, Option<String>, Option<String>)> {
    let version = root.get("version").and_then(Value::as_str)?.to_string();
    let notes = root.get("notes").and_then(Value::as_str).map(ToString::to_string);
    let pub_date = root
        .get("pub_date")
        .or_else(|| root.get("pubDate"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let release_url = root
        .get("url")
        .or_else(|| root.get("releaseUrl"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let download_url = root
        .get("platforms")
        .and_then(Value::as_object)
        .and_then(|platforms| platforms.values().find_map(|platform| platform.get("url")))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    Some((version, notes, pub_date, release_url, download_url))
}

fn parse_github_release_json(root: &Value) -> Option<(String, Option<String>, Option<String>, Option<String>, Option<String>)> {
    let version = root
        .get("tag_name")
        .or_else(|| root.get("name"))
        .and_then(Value::as_str)?
        .to_string();
    let notes = root.get("body").and_then(Value::as_str).map(ToString::to_string);
    let pub_date = root
        .get("published_at")
        .or_else(|| root.get("created_at"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let release_url = root.get("html_url").and_then(Value::as_str).map(ToString::to_string);
    let download_url = root
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets
                .iter()
                .find_map(|asset| asset.get("browser_download_url").and_then(Value::as_str))
        })
        .map(ToString::to_string);
    Some((version, notes, pub_date, release_url, download_url))
}

fn fetch_update_info(endpoint: &str) -> Result<(String, Option<String>, Option<String>, Option<String>, Option<String>), String> {
    let response = ureq::get(endpoint)
        .set("User-Agent", "SMRmanager-Updater")
        .timeout(std::time::Duration::from_secs(12))
        .call()
        .map_err(|e| format!("请求更新源失败: {e}"))?;
    let body = response
        .into_string()
        .map_err(|e| format!("读取更新源响应失败: {e}"))?;
    let root: Value =
        serde_json::from_str(&body).map_err(|e| format!("解析更新源 JSON 失败: {e}"))?;
    parse_tauri_latest_json(&root)
        .or_else(|| parse_github_release_json(&root))
        .ok_or_else(|| "更新源格式不兼容，未找到 version/tag_name".to_string())
}

#[tauri::command]
pub fn check_app_update(endpoint: Option<String>) -> Result<AppUpdateCheckResult, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let endpoints = endpoint
        .filter(|value| !value.trim().is_empty())
        .map(|value| vec![value])
        .unwrap_or_else(|| DEFAULT_UPDATE_ENDPOINTS.iter().map(|value| value.to_string()).collect());

    let mut last_error = String::new();
    for source_url in endpoints {
        match fetch_update_info(&source_url) {
            Ok((latest_version, notes, pub_date, release_url, download_url)) => {
                let available = is_remote_newer(&current_version, &latest_version);
                return Ok(AppUpdateCheckResult {
                    current_version,
                    latest_version: Some(latest_version),
                    available,
                    notes,
                    pub_date,
                    release_url,
                    download_url,
                    source_url,
                    checked_at: checked_at(),
                });
            }
            Err(error) => last_error = format!("{source_url}: {error}"),
        }
    }

    Err(if last_error.is_empty() {
        "没有可用更新源".to_string()
    } else {
        last_error
    })
}
