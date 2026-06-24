use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallRequest {
    pub skill_id: String,
    pub name: String,
    pub method: String,
    pub package_name: Option<String>,
    pub args: Option<Vec<String>>,
    pub repository: Option<String>,
    pub subdir: Option<String>,
    pub registry_url: Option<String>,
    pub manifest_url: Option<String>,
    pub target_client_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallResult {
    pub success: bool,
    pub message: String,
    pub log: String,
    pub installed_path: Option<String>,
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

fn home_dir() -> PathBuf {
    env_path("USERPROFILE")
        .or_else(|| env_path("HOME"))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn safe_segment(input: &str) -> String {
    let normalized = input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    normalized.trim_matches('-').to_string()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn shared_skills_dir() -> PathBuf {
    home_dir().join(".agents").join("skills")
}

/// 复制型 skill 的落点：指定了目标客户端则用其 Skills 目录，否则回退到共享目录。
fn install_root(request: &SkillInstallRequest) -> PathBuf {
    request
        .target_client_id
        .as_ref()
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| crate::detection::client_skill_root(id))
        .unwrap_or_else(shared_skills_dir)
}

fn cache_dir() -> PathBuf {
    home_dir().join(".smrmanager").join("cache")
}

fn registry_dir() -> PathBuf {
    home_dir().join(".smrmanager").join("registries")
}

fn find_tool(candidates: &[&str]) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in candidates {
            // Windows 上优先 .cmd/.exe（无扩展的 npm/pnpm/npx 是 bash 脚本，CreateProcess/cmd 都跑不了）。
            #[cfg(windows)]
            {
                let cmd = dir.join(format!("{name}.cmd"));
                if cmd.is_file() {
                    return Some(cmd);
                }
                let exe = dir.join(format!("{name}.exe"));
                if exe.is_file() {
                    return Some(exe);
                }
                let bat = dir.join(format!("{name}.bat"));
                if bat.is_file() {
                    return Some(bat);
                }
            }
            let direct = dir.join(name);
            if direct.is_file() {
                return Some(direct);
            }
        }
    }
    None
}

fn run_tool(program: &Path, args: &[String], cwd: Option<&Path>) -> Result<(bool, String), String> {
    let prog = path_to_string(program);
    // Windows 上 npm/pnpm/npx 是 .cmd 或无扩展脚本，CreateProcess 不能直接执行，需走 cmd /C。
    #[cfg(windows)]
    let needs_cmd = !prog.to_ascii_lowercase().ends_with(".exe");
    #[cfg(not(windows))]
    let needs_cmd = false;

    let mut command = if needs_cmd {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(program).args(args);
        c
    } else {
        let mut c = Command::new(program);
        c.args(args);
        c
    };
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command
        .output()
        .map_err(|e| format!("执行 {} 失败: {e}", prog))?;

    let mut log = String::new();
    log.push_str(&format!("$ {} {}\n", prog, args.join(" ")));
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok((output.status.success(), log))
}

fn require_package(request: &SkillInstallRequest) -> Result<String, String> {
    request
        .package_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "缺少 packageName".to_string())
}

fn install_npm_like(request: &SkillInstallRequest, tool_name: &str) -> Result<SkillInstallResult, String> {
    let package = require_package(request)?;
    let (candidates, args): (&[&str], Vec<String>) = match tool_name {
        "npm" => (&["npm"], vec!["install".into(), "-g".into(), package]),
        "pnpm" => (&["pnpm"], vec!["add".into(), "-g".into(), package]),
        "npx" => {
            let mut args = vec!["-y".into(), package];
            args.extend(request.args.clone().unwrap_or_default());
            (&["npx"], args)
        }
        _ => return Err(format!("不支持的安装器: {tool_name}")),
    };
    let tool = find_tool(candidates).ok_or_else(|| format!("未找到 {tool_name}，请先安装 Node.js/{tool_name}"))?;
    let (success, log) = run_tool(&tool, &args, None)?;
    if !success {
        return Err(log);
    }
    Ok(SkillInstallResult {
        success,
        message: format!("{} 已通过 {} 安装/执行完成", request.name, tool_name),
        log,
        installed_path: None,
    })
}

fn github_url(repository: &str) -> String {
    if repository.starts_with("http://") || repository.starts_with("https://") {
        repository.to_string()
    } else {
        format!("https://github.com/{repository}.git")
    }
}

fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut out = base.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return Err(format!("拒绝不安全路径: {relative}")),
        }
    }
    Ok(out)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Err(format!("源目录不存在: {}", path_to_string(src)));
    }
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}: {e}", path_to_string(dst)))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {e}", path_to_string(src)))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录失败 {}: {e}", path_to_string(parent)))?;
            }
            std::fs::copy(&from, &to).map_err(|e| {
                format!(
                    "复制文件失败 {} -> {}: {e}",
                    path_to_string(&from),
                    path_to_string(&to)
                )
            })?;
        }
    }
    Ok(())
}

fn ensure_not_existing(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err(format!("目标已存在，为避免覆盖请先备份或删除: {}", path_to_string(path)));
    }
    Ok(())
}

fn install_github(request: &SkillInstallRequest) -> Result<SkillInstallResult, String> {
    let repository = request
        .repository
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "缺少 repository".to_string())?;
    let git = find_tool(&["git"]).ok_or_else(|| "未找到 git，请先安装 Git".to_string())?;
    let root = install_root(request);
    let target = root.join(safe_segment(&request.skill_id));
    ensure_not_existing(&target)?;
    std::fs::create_dir_all(&root).map_err(|e| format!("创建 Skills 目录失败: {e}"))?;

    let mut log = String::new();
    if let Some(subdir) = &request.subdir {
        let clone_dir = cache_dir().join(format!("{}-{}", safe_segment(&request.skill_id), now_secs()));
        std::fs::create_dir_all(cache_dir()).map_err(|e| format!("创建缓存目录失败: {e}"))?;
        let args = vec![
            "clone".into(),
            "--depth".into(),
            "1".into(),
            github_url(&repository),
            path_to_string(&clone_dir),
        ];
        let (success, clone_log) = run_tool(&git, &args, None)?;
        log.push_str(&clone_log);
        if !success {
            return Err(log);
        }
        let src = safe_join(&clone_dir, subdir)?;
        copy_dir_recursive(&src, &target)?;
    } else {
        let args = vec![
            "clone".into(),
            "--depth".into(),
            "1".into(),
            github_url(&repository),
            path_to_string(&target),
        ];
        let (success, clone_log) = run_tool(&git, &args, None)?;
        log.push_str(&clone_log);
        if !success {
            return Err(log);
        }
    }

    Ok(SkillInstallResult {
        success: true,
        message: format!("{} 已从 GitHub 安装", request.name),
        log,
        installed_path: Some(path_to_string(&target)),
    })
}

fn fetch_text(url: &str) -> Result<String, String> {
    let response = ureq::get(url)
        .call()
        .map_err(|e| format!("下载 JSON 失败 {url}: {e}"))?;
    response
        .into_string()
        .map_err(|e| format!("读取响应失败 {url}: {e}"))
}

fn write_manifest_files(request: &SkillInstallRequest, manifest: &Value) -> Result<Option<String>, String> {
    let files = manifest.get("files").and_then(Value::as_array);
    let Some(files) = files else {
        return Ok(None);
    };
    let target = install_root(request).join(safe_segment(&request.skill_id));
    if target.exists() {
        let backup = home_dir()
            .join(".smrmanager")
            .join("backups")
            .join(format!("{}-{}", safe_segment(&request.skill_id), now_secs()));
        if let Some(parent) = backup.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建备份目录失败: {e}"))?;
        }
        copy_dir_recursive(&target, &backup)?;
    }
    std::fs::create_dir_all(&target).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;

    for file in files {
        let path = file
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "manifest files[] 缺少 path".to_string())?;
        let content = file
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("manifest 文件 {path} 缺少 content"))?;
        let out = safe_join(&target, path)?;
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        std::fs::write(&out, content).map_err(|e| format!("写入 {} 失败: {e}", path_to_string(&out)))?;
    }
    Ok(Some(path_to_string(&target)))
}

fn install_json(request: &SkillInstallRequest) -> Result<SkillInstallResult, String> {
    let url = request
        .manifest_url
        .clone()
        .or_else(|| request.registry_url.clone())
        .ok_or_else(|| "缺少 registryUrl/manifestUrl".to_string())?;
    let text = fetch_text(&url)?;
    std::fs::create_dir_all(registry_dir()).map_err(|e| format!("创建注册表目录失败: {e}"))?;
    let json_path = registry_dir().join(format!("{}.json", safe_segment(&request.skill_id)));
    std::fs::write(&json_path, &text).map_err(|e| format!("保存 JSON 失败: {e}"))?;

    let manifest = serde_json::from_str::<Value>(&text).ok();
    let installed_path = match manifest.as_ref() {
        Some(value) => write_manifest_files(request, value)?,
        None => None,
    };

    Ok(SkillInstallResult {
        success: true,
        message: if installed_path.is_some() {
            format!("{} 已从 JSON manifest 安装", request.name)
        } else {
            format!("{} 的 JSON 注册表已下载", request.name)
        },
        log: format!("saved: {}", path_to_string(&json_path)),
        installed_path,
    })
}

#[tauri::command]
pub fn install_market_skill(request: SkillInstallRequest) -> Result<SkillInstallResult, String> {
    match request.method.as_str() {
        "npm" => install_npm_like(&request, "npm"),
        "pnpm" => install_npm_like(&request, "pnpm"),
        "npx" => install_npm_like(&request, "npx"),
        "github" => install_github(&request),
        "json" => install_json(&request),
        other => Err(format!("不支持的安装方式: {other}")),
    }
}

fn npm_global_root() -> Option<PathBuf> {
    // Windows 上 npm 是 npm.cmd/脚本，必须经 cmd /C 执行；直接 Command::new("npm") 会失败。
    #[cfg(windows)]
    let output = Command::new("cmd").args(["/C", "npm", "root", "-g"]).output().ok()?;
    #[cfg(not(windows))]
    let output = Command::new("npm").args(["root", "-g"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

/// 去掉版本后缀，保留作用域：@scope/name@latest -> @scope/name；name@1.2 -> name。
fn package_base_name(pkg: &str) -> String {
    let s = pkg.trim();
    if let Some(rest) = s.strip_prefix('@') {
        match rest.find('@') {
            Some(idx) => format!("@{}", &rest[..idx]),
            None => s.to_string(),
        }
    } else {
        match s.find('@') {
            Some(idx) => s[..idx].to_string(),
            None => s.to_string(),
        }
    }
}

/// 返回这些 npm 包中已在全局安装的（用于市场识别 npm 安装的 skill，如 trellis）。
#[tauri::command]
pub fn check_global_packages(packages: Vec<String>) -> Vec<String> {
    let Some(root) = npm_global_root() else {
        return Vec::new();
    };
    let mut installed = Vec::new();
    for pkg in packages {
        let name = package_base_name(&pkg);
        if name.is_empty() {
            continue;
        }
        let path = name.split('/').fold(root.clone(), |acc, seg| acc.join(seg));
        if path.exists() {
            installed.push(pkg);
        }
    }
    installed
}

// ===== 从 Git 安装 Skill / MCP =====

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSkillEntry {
    pub rel_path: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMcpEntry {
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInspectResult {
    pub cache_path: String,
    pub skills: Vec<GitSkillEntry>,
    pub mcp_servers: Vec<GitMcpEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitApplyResult {
    pub skills_installed: usize,
    pub mcp_installed: usize,
    pub failed: Vec<String>,
    pub message: String,
}

fn parse_skill_md(skill_md: &Path, fallback: &str) -> (String, String) {
    let content = std::fs::read_to_string(skill_md).unwrap_or_default();
    let trimmed = content.trim_start_matches('\u{feff}');
    let mut name = fallback.to_string();
    let mut description = String::new();
    if trimmed.starts_with("---") {
        let mut parts = trimmed.splitn(3, "---");
        let _ = parts.next();
        if let Some(front) = parts.next() {
            for line in front.lines() {
                if let Some((k, v)) = line.split_once(':') {
                    let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    match k.trim() {
                        "name" if !v.is_empty() => name = v,
                        "description" if !v.is_empty() => description = v,
                        _ => {}
                    }
                }
            }
        }
    }
    (name, description)
}

fn scan_git_skills(dir: &Path, base: &Path, depth: usize, out: &mut Vec<GitSkillEntry>) {
    if depth > 3 || out.len() > 200 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if skill_md.is_file() {
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let (n, d) = parse_skill_md(&skill_md, &name);
            out.push(GitSkillEntry { rel_path: rel, name: n, description: d });
            continue; // 不深入 skill 内部
        }
        scan_git_skills(&path, base, depth + 1, out);
    }
}

fn scan_git_mcp(root: &Path) -> Vec<GitMcpEntry> {
    let candidates = [
        root.join("mcp.json"),
        root.join(".mcp.json"),
        root.join("server.json"),
        root.join(".vscode").join("mcp.json"),
        root.join(".cursor").join("mcp.json"),
        root.join("package.json"),
    ];
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for file in candidates {
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let servers = json
            .get("mcpServers")
            .or_else(|| json.get("mcp").and_then(|m| m.get("servers")));
        let Some(obj) = servers.and_then(Value::as_object) else {
            continue;
        };
        for (name, spec) in obj {
            if !seen.insert(name.clone()) {
                continue;
            }
            let command = spec.get("command").and_then(Value::as_str).map(String::from);
            let url = spec.get("url").and_then(Value::as_str).map(String::from);
            let args = spec.get("args").and_then(Value::as_array).map(|a| {
                a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<String>>()
            });
            let transport = if url.is_some() { "http".to_string() } else { "stdio".to_string() };
            out.push(GitMcpEntry { name: name.clone(), transport, command, args, url });
        }
    }
    out
}

#[tauri::command(rename_all = "camelCase")]
pub fn git_inspect(url: String, subdir: Option<String>) -> Result<GitInspectResult, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("请填写 Git 仓库地址".to_string());
    }
    let git = find_tool(&["git"]).ok_or_else(|| "未找到 git，请先安装 Git".to_string())?;
    let clone_dir = cache_dir().join(format!("git-{}", safe_segment(&url)));
    if clone_dir.exists() {
        let _ = std::fs::remove_dir_all(&clone_dir);
    }
    std::fs::create_dir_all(cache_dir()).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    let args = vec![
        "clone".into(),
        "--depth".into(),
        "1".into(),
        github_url(&url),
        path_to_string(&clone_dir),
    ];
    let (ok, log) = run_tool(&git, &args, None)?;
    if !ok {
        return Err(format!("克隆失败:\n{log}"));
    }
    let root = match &subdir {
        Some(s) if !s.trim().is_empty() => safe_join(&clone_dir, s.trim())?,
        _ => clone_dir.clone(),
    };
    if !root.is_dir() {
        return Err("指定的子目录不存在".to_string());
    }
    let mut skills = Vec::new();
    scan_git_skills(&root, &root, 0, &mut skills);
    let mcp_servers = scan_git_mcp(&root);
    Ok(GitInspectResult {
        cache_path: path_to_string(&root),
        skills,
        mcp_servers,
    })
}

fn git_library_skills_dir() -> PathBuf {
    home_dir().join(".smrmanager").join("library").join("skills")
}

fn unique_dest(root: &Path, name: &str) -> PathBuf {
    let base = if name.trim().is_empty() { "skill" } else { name };
    let mut target = root.join(base);
    if !target.exists() {
        return target;
    }
    let mut idx = 2usize;
    loop {
        target = root.join(format!("{base}-{idx}"));
        if !target.exists() {
            return target;
        }
        idx += 1;
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn git_apply(
    cache_path: String,
    skill_rel_paths: Vec<String>,
    skill_target: String,
    mcp_servers: Vec<GitMcpEntry>,
    mcp_client_id: String,
) -> Result<GitApplyResult, String> {
    let root = PathBuf::from(&cache_path);
    let mut failed = Vec::new();
    let mut skills_installed = 0usize;

    if !skill_rel_paths.is_empty() {
        let dest_root = if skill_target == "library" {
            git_library_skills_dir()
        } else {
            crate::detection::client_skill_root(&skill_target)
                .ok_or_else(|| "目标客户端不支持写入 Skills".to_string())?
        };
        std::fs::create_dir_all(&dest_root).map_err(|e| format!("创建目标目录失败: {e}"))?;
        for rel in &skill_rel_paths {
            let src = match safe_join(&root, rel) {
                Ok(p) => p,
                Err(e) => {
                    failed.push(e);
                    continue;
                }
            };
            if !src.is_dir() {
                failed.push(format!("{rel}: 源不存在"));
                continue;
            }
            let leaf = Path::new(rel).file_name().and_then(|n| n.to_str()).unwrap_or("skill");
            let dest = unique_dest(&dest_root, leaf);
            match copy_dir_recursive(&src, &dest) {
                Ok(_) => skills_installed += 1,
                Err(e) => failed.push(format!("{rel}: {e}")),
            }
        }
    }

    let mut mcp_installed = 0usize;
    if !mcp_servers.is_empty() && !mcp_client_id.trim().is_empty() {
        // 持久化 clone 源，命令里的相对路径据此解析为绝对路径。
        let persist = home_dir()
            .join(".smrmanager")
            .join("mcp-sources")
            .join(safe_segment(root.file_name().and_then(|n| n.to_str()).unwrap_or("src")));
        if !persist.exists() {
            let _ = copy_dir_recursive(&root, &persist);
        }
        for entry in mcp_servers {
            let args = entry.args.map(|list| {
                list.into_iter()
                    .map(|a| {
                        let resolved = persist.join(&a);
                        if PathBuf::from(&a).is_relative() && resolved.exists() {
                            path_to_string(&resolved)
                        } else {
                            a
                        }
                    })
                    .collect::<Vec<String>>()
            });
            let spec = crate::detection::McpServerSpec {
                name: entry.name.clone(),
                transport: entry.transport,
                command: entry.command,
                args,
                url: entry.url,
            };
            match crate::detection::install_mcp_server(mcp_client_id.clone(), spec) {
                Ok(_) => mcp_installed += 1,
                Err(e) => failed.push(format!("MCP {}: {e}", entry.name)),
            }
        }
    }

    Ok(GitApplyResult {
        message: format!("已安装 {skills_installed} 个 Skill、{mcp_installed} 个 MCP"),
        skills_installed,
        mcp_installed,
        failed,
    })
}
