use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone)]
struct ClientDefinition {
    id: String,
    name: String,
    product: &'static str,
    kind: &'static str,
    description: &'static str,
    install_url: &'static str,
    exe_names: &'static [&'static str],
    exe_candidates: Vec<PathBuf>,
    config_candidates: Vec<PathBuf>,
    skill_dirs: Vec<PathBuf>,
    rule_paths: Vec<PathBuf>,
    source: String,
    root_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedClient {
    pub id: String,
    pub name: String,
    pub product: String,
    #[serde(rename = "type")]
    pub client_type: String,
    pub description: String,
    pub installed: bool,
    pub executable_path: Option<String>,
    pub config_paths: Vec<String>,
    pub detected_config_paths: Vec<String>,
    pub install_url: String,
    pub mcp_count: usize,
    pub skills_count: usize,
    pub roles_count: usize,
    pub updated_at: Option<String>,
    pub status_message: String,
    pub source: String,
    pub root_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedMcpServer {
    pub id: String,
    pub name: String,
    pub client_id: String,
    pub client_name: String,
    pub source_path: String,
    pub transport: String,
    pub command: Option<String>,
    pub url: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedSkill {
    pub directory: String,
    pub name: String,
    pub description: Option<String>,
    pub client_id: String,
    pub client_name: String,
    pub path: String,
    pub managed: bool,
    pub updated_at: Option<String>,
    pub tags: Vec<String>,
    pub linked: bool,
    pub linked_clients: Vec<String>,
    // 项目级 Skill 的启用/禁用状态；全局/WSL Skill 恒为 true。禁用 = 移入项目私有禁用区。
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedRule {
    pub name: String,
    pub client_id: String,
    pub client_name: String,
    pub path: String,
    pub kind: String,
    pub source: String,
    pub preview: Option<String>,
    pub managed: bool,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSkillsResult {
    pub deleted: usize,
    pub moved_to_trash: Vec<String>,
    pub failed: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSkillsResult {
    pub copied: usize,
    pub moved: usize,
    pub target_client_id: String,
    pub target_client_name: String,
    pub target_root: String,
    pub written_paths: Vec<String>,
    pub failed: Vec<String>,
    pub message: String,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionSnapshot {
    pub clients: Vec<DetectedClient>,
    pub mcp_servers: Vec<DetectedMcpServer>,
    pub skills: Vec<DetectedSkill>,
    pub rules: Vec<DetectedRule>,
    pub scanned_at: String,
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).map(PathBuf::from).filter(|p| !p.as_os_str().is_empty())
}

fn home_dir() -> PathBuf {
    env_path("USERPROFILE")
        .or_else(|| env_path("HOME"))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn appdata_dir() -> PathBuf {
    env_path("APPDATA").unwrap_or_else(|| home_dir().join("AppData").join("Roaming"))
}

fn local_appdata_dir() -> PathBuf {
    env_path("LOCALAPPDATA").unwrap_or_else(|| home_dir().join("AppData").join("Local"))
}

fn program_files_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(p) = env_path("ProgramFiles") {
        dirs.push(p);
    }
    if let Some(p) = env_path("ProgramFiles(x86)") {
        dirs.push(p);
    }
    dirs
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn existing_paths(paths: &[PathBuf]) -> Vec<PathBuf> {
    paths.iter().filter(|p| p.exists()).cloned().collect()
}

fn find_in_path(names: &[&str]) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
            #[cfg(windows)]
            {
                let exe_candidate = dir.join(format!("{name}.exe"));
                if exe_candidate.is_file() {
                    return Some(exe_candidate);
                }
                let cmd_candidate = dir.join(format!("{name}.cmd"));
                if cmd_candidate.is_file() {
                    return Some(cmd_candidate);
                }
            }
        }
    }
    None
}

fn first_existing_executable(definition: &ClientDefinition) -> Option<PathBuf> {
    definition
        .exe_candidates
        .iter()
        .find(|p| p.is_file())
        .cloned()
        .or_else(|| find_in_path(definition.exe_names))
}

fn timestamp_for_paths(paths: &[PathBuf]) -> Option<String> {
    let mut newest: Option<u64> = None;
    for path in paths {
        let Ok(meta) = std::fs::metadata(path) else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        let Ok(secs) = modified.duration_since(UNIX_EPOCH) else {
            continue;
        };
        newest = newest.max(Some(secs.as_secs()));
    }
    newest.map(|secs| secs.to_string())
}

fn vscode_mcp_candidates() -> Vec<PathBuf> {
    let mut paths = vec![
        appdata_dir().join("Code").join("User").join("mcp.json"),
        appdata_dir()
            .join("Code - Insiders")
            .join("User")
            .join("mcp.json"),
    ];

    // VS Code 多 Profile 的用户配置位于 User/profiles/*/mcp.json。
    for base in [
        appdata_dir().join("Code").join("User").join("profiles"),
        appdata_dir()
            .join("Code - Insiders")
            .join("User")
            .join("profiles"),
    ] {
        if let Ok(entries) = std::fs::read_dir(base) {
            for entry in entries.flatten() {
                let path = entry.path().join("mcp.json");
                paths.push(path);
            }
        }
    }

    paths
}

fn build_definitions(home: &Path) -> Vec<ClientDefinition> {
    let appdata = appdata_dir();
    let local = local_appdata_dir();
    let mut program_files = program_files_dirs();
    if program_files.is_empty() {
        program_files.push(PathBuf::from("C:\\Program Files"));
    }

    let mut claude_desktop_exes = Vec::new();
    for pf in &program_files {
        claude_desktop_exes.push(pf.join("Claude").join("Claude.exe"));
        claude_desktop_exes.push(pf.join("Anthropic").join("Claude").join("Claude.exe"));
    }
    claude_desktop_exes.push(local.join("Programs").join("Claude").join("Claude.exe"));
    claude_desktop_exes.push(local.join("Claude").join("Claude.exe"));
    claude_desktop_exes.push(local.join("AnthropicClaude").join("Claude.exe"));

    let mut cursor_exes = Vec::new();
    for pf in &program_files {
        cursor_exes.push(pf.join("Cursor").join("Cursor.exe"));
    }
    cursor_exes.push(local.join("Programs").join("Cursor").join("Cursor.exe"));

    let mut vscode_exes = Vec::new();
    for pf in &program_files {
        vscode_exes.push(pf.join("Microsoft VS Code").join("Code.exe"));
    }
    vscode_exes.push(local.join("Programs").join("Microsoft VS Code").join("Code.exe"));

    let mut trae_exes = Vec::new();
    for pf in &program_files {
        trae_exes.push(pf.join("Trae").join("Trae.exe"));
        trae_exes.push(pf.join("TRAE").join("Trae.exe"));
    }
    trae_exes.push(local.join("Programs").join("Trae").join("Trae.exe"));
    trae_exes.push(local.join("Trae").join("Trae.exe"));

    vec![
        ClientDefinition {
            id: "claude".into(),
            name: "Claude Code".into(),
            product: "Claude Code",
            kind: "CLI 工具",
            description: "Anthropic Claude Code / Claude CLI，使用 ~/.claude.json 与 ~/.claude/skills",
            install_url: "https://docs.anthropic.com/en/docs/claude-code/setup",
            exe_names: &["claude"],
            exe_candidates: vec![],
            config_candidates: vec![home.join(".claude.json"), home.join(".claude").join("settings.json")],
            skill_dirs: vec![home.join(".claude").join("skills")],
            rule_paths: vec![home.join(".claude").join("CLAUDE.md"), home.join(".claude").join("rules")],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "claude-desktop".into(),
            name: "Claude Desktop".into(),
            product: "Claude Desktop",
            kind: "桌面应用",
            description: "Anthropic Claude Desktop，独立于 Claude Code/CLI",
            install_url: "https://claude.ai/download",
            // Desktop 必须按应用安装路径识别，不能用 PATH 中的 claude CLI 冒充。
            exe_names: &[],
            exe_candidates: claude_desktop_exes,
            config_candidates: vec![
                local.join("Claude").join("claude_desktop_config.json"),
                local.join("Claude-3p").join("claude_desktop_config.json"),
                appdata.join("Claude").join("claude_desktop_config.json"),
            ],
            skill_dirs: vec![home.join(".claude-desktop").join("skills")],
            rule_paths: vec![home.join(".claude-desktop").join("rules")],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "codex".into(),
            name: "Codex".into(),
            product: "Codex",
            kind: "CLI 工具",
            description: "OpenAI Codex CLI，使用 ~/.codex/config.toml 与 ~/.codex/skills",
            install_url: "https://developers.openai.com/codex",
            exe_names: &["codex"],
            exe_candidates: vec![],
            config_candidates: vec![home.join(".codex").join("config.toml"), home.join(".codex").join("auth.json")],
            skill_dirs: vec![home.join(".codex").join("skills")],
            rule_paths: vec![home.join(".codex").join("AGENTS.md"), home.join(".codex").join("rules")],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "gemini".into(),
            name: "Gemini CLI".into(),
            product: "Gemini",
            kind: "CLI 工具",
            description: "Google Gemini CLI，使用 ~/.gemini/settings.json 与 ~/.gemini/skills",
            install_url: "https://github.com/google-gemini/gemini-cli",
            exe_names: &["gemini"],
            exe_candidates: vec![],
            config_candidates: vec![home.join(".gemini").join("settings.json"), home.join(".gemini").join(".env")],
            skill_dirs: vec![home.join(".gemini").join("skills")],
            rule_paths: vec![home.join(".gemini").join("GEMINI.md"), home.join(".gemini").join("rules")],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "opencode".into(),
            name: "OpenCode".into(),
            product: "OpenCode",
            kind: "CLI 工具",
            description: "OpenCode CLI，本地 AI 编程 Agent",
            install_url: "https://opencode.ai/",
            exe_names: &["opencode"],
            exe_candidates: vec![],
            config_candidates: vec![home.join(".config").join("opencode").join("opencode.json")],
            skill_dirs: vec![home.join(".config").join("opencode").join("skills")],
            rule_paths: vec![
                home.join(".config").join("opencode").join("AGENTS.md"),
                home.join(".config").join("opencode").join("rules"),
            ],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "openclaw".into(),
            name: "OpenClaw".into(),
            product: "OpenClaw",
            kind: "CLI 工具",
            description: "OpenClaw Agent，使用 ~/.openclaw/openclaw.json 与 ~/.openclaw/skills",
            install_url: "https://github.com/openclaw/openclaw",
            exe_names: &["openclaw", "claw"],
            exe_candidates: vec![],
            config_candidates: vec![home.join(".openclaw").join("openclaw.json")],
            skill_dirs: vec![home.join(".openclaw").join("skills")],
            rule_paths: vec![
                home.join(".openclaw").join("AGENTS.md"),
                home.join(".openclaw").join("SOUL.md"),
                home.join(".openclaw").join("rules"),
            ],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "hermes".into(),
            name: "Hermes".into(),
            product: "Hermes",
            kind: "CLI 工具",
            description: "Hermes Agent，使用 ~/.hermes/config.yaml 与 ~/.hermes/skills",
            install_url: "https://github.com/NousResearch/hermes-agent",
            exe_names: &["hermes"],
            exe_candidates: vec![],
            config_candidates: vec![home.join(".hermes").join("config.yaml")],
            skill_dirs: vec![home.join(".hermes").join("skills")],
            rule_paths: vec![home.join(".hermes").join("AGENTS.md"), home.join(".hermes").join("rules")],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "cursor".into(),
            name: "Cursor".into(),
            product: "Cursor",
            kind: "开发工具",
            description: "面向开发者的 AI 代码编辑器",
            install_url: "https://cursor.com/downloads",
            exe_names: &["Cursor", "cursor"],
            exe_candidates: cursor_exes,
            config_candidates: vec![home.join(".cursor").join("mcp.json")],
            skill_dirs: vec![home.join(".cursor").join("skills")],
            rule_paths: vec![home.join(".cursor").join("rules"), home.join(".cursorrules")],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "vscode".into(),
            name: "VS Code".into(),
            product: "VS Code",
            kind: "开发工具",
            description: "Visual Studio Code 扩展集成",
            install_url: "https://code.visualstudio.com/download",
            exe_names: &["Code", "code"],
            exe_candidates: vscode_exes,
            config_candidates: vscode_mcp_candidates(),
            skill_dirs: vec![],
            rule_paths: vec![home.join(".vscode").join("rules")],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "trae".into(),
            name: "Trae".into(),
            product: "Trae",
            kind: "开发工具",
            description: "Trae AI IDE，支持 MCP 与 Skills 扩展",
            install_url: "https://www.trae.ai/download",
            exe_names: &["Trae", "trae"],
            exe_candidates: trae_exes,
            config_candidates: vec![
                home.join(".trae").join("mcp.json"),
                appdata.join("Trae").join("mcp.json"),
                appdata.join("Trae").join("User").join("mcp.json"),
            ],
            skill_dirs: vec![home.join(".trae").join("skills")],
            rule_paths: vec![home.join(".trae").join("AGENTS.md"), home.join(".trae").join("rules")],
            source: "windows".into(),
            root_label: None,
        },
        // 以下为「纯 rules」客户端（无 exe/config，靠 rule_paths 存在即判定检测到）。
        ClientDefinition {
            id: "qoderworkcn".into(),
            name: "QoderWork CN".into(),
            product: "QoderWork",
            kind: "AI 工作台",
            description: "阿里 QoderWork 国内版 AI 桌面助手，管理 ~/.qoderworkcn/awareness/main 下的 AGENTS/SOUL/USER",
            install_url: "https://qoder.com.cn/qoderwork",
            exe_names: &[],
            exe_candidates: vec![],
            config_candidates: vec![],
            skill_dirs: vec![],
            rule_paths: vec![
                home.join(".qoderworkcn").join("awareness").join("main").join("AGENTS.md"),
                home.join(".qoderworkcn").join("awareness").join("main").join("SOUL.md"),
                home.join(".qoderworkcn").join("awareness").join("main").join("USER.md"),
            ],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "zcode".into(),
            name: "Z Code".into(),
            product: "Z Code",
            kind: "AI 代码编辑器",
            description: "智谱 Z Code 轻量级 AI 代码编辑器，管理 ~/.zcode/AGENTS.md",
            install_url: "https://zcode-ai.com",
            exe_names: &["zcode"],
            exe_candidates: vec![],
            config_candidates: vec![],
            skill_dirs: vec![],
            rule_paths: vec![home.join(".zcode").join("AGENTS.md")],
            source: "windows".into(),
            root_label: None,
        },
        ClientDefinition {
            id: "workbuddy".into(),
            name: "WorkBuddy".into(),
            product: "WorkBuddy",
            kind: "AI 工作台",
            description: "腾讯 CodeBuddy 旗下 WorkBuddy AI Agent 工作台，管理 ~/.workbuddy 下的 IDENTITY/SOUL/USER",
            install_url: "https://www.codebuddy.cn/work/",
            exe_names: &[],
            exe_candidates: vec![],
            config_candidates: vec![],
            skill_dirs: vec![],
            rule_paths: vec![
                home.join(".workbuddy").join("IDENTITY.md"),
                home.join(".workbuddy").join("SOUL.md"),
                home.join(".workbuddy").join("USER.md"),
            ],
            source: "windows".into(),
            root_label: None,
        },
    ]
}

fn client_definitions() -> Vec<ClientDefinition> {
    build_definitions(&home_dir())
}

/// 项目级路径布局：返回某客户端在「项目根目录」下的 (skill_dirs, rule_paths, config_candidates)。
/// 与 home 布局（~/.claude/skills）不同——项目级是 <proj>/.claude/skills、<proj>/AGENTS.md、<proj>/.mcp.json 等。
/// 没有项目级约定的客户端（claude-desktop / zcode / workbuddy / qoderworkcn）返回空，计数为 0。
fn project_layout(id: &str, root: &Path) -> (Vec<PathBuf>, Vec<PathBuf>, Vec<PathBuf>) {
    let agents = root.join("AGENTS.md");
    match id {
        "claude" => (
            vec![root.join(".claude").join("skills")],
            vec![
                root.join("CLAUDE.md"),
                root.join(".claude").join("CLAUDE.md"),
                root.join(".claude").join("rules"),
            ],
            vec![
                root.join(".mcp.json"),
                root.join(".claude").join("settings.json"),
                root.join(".claude").join("settings.local.json"),
            ],
        ),
        "codex" => (
            vec![root.join(".codex").join("skills")],
            vec![agents.clone(), root.join(".codex").join("AGENTS.md")],
            vec![root.join(".codex").join("config.toml")],
        ),
        "gemini" => (
            vec![root.join(".gemini").join("skills")],
            vec![root.join("GEMINI.md"), root.join(".gemini").join("rules")],
            vec![root.join(".gemini").join("settings.json")],
        ),
        "cursor" => (
            vec![root.join(".cursor").join("skills")],
            vec![root.join(".cursor").join("rules"), root.join(".cursorrules")],
            vec![root.join(".cursor").join("mcp.json")],
        ),
        "vscode" => (
            vec![],
            vec![root.join(".github").join("copilot-instructions.md")],
            vec![root.join(".vscode").join("mcp.json")],
        ),
        "opencode" => (
            vec![root.join(".opencode").join("skills")],
            vec![agents.clone(), root.join(".opencode").join("rules")],
            vec![root.join("opencode.json"), root.join(".opencode").join("opencode.json")],
        ),
        "openclaw" => (
            vec![root.join(".openclaw").join("skills")],
            vec![agents.clone(), root.join(".openclaw").join("rules")],
            vec![root.join(".openclaw").join("openclaw.json")],
        ),
        "hermes" => (
            vec![root.join(".hermes").join("skills")],
            vec![agents.clone(), root.join(".hermes").join("rules")],
            vec![root.join(".hermes").join("config.yaml")],
        ),
        "trae" => (
            vec![root.join(".trae").join("skills")],
            vec![agents, root.join(".trae").join("rules")],
            vec![root.join(".trae").join("mcp.json")],
        ),
        _ => (vec![], vec![], vec![]),
    }
}

/// 把全部客户端定义重写为「项目级」布局（exe 不参与项目级检测）。
fn build_project_definitions(root: &Path) -> Vec<ClientDefinition> {
    build_definitions(root)
        .into_iter()
        .map(|mut def| {
            let (skills, rules, configs) = project_layout(&def.id, root);
            def.skill_dirs = skills;
            def.rule_paths = rules;
            def.config_candidates = configs;
            def.exe_names = &[];
            def.exe_candidates = vec![];
            def.source = "project".into();
            def
        })
        .collect()
}

/// 为单个项目根生成带 @tag 的项目级客户端定义（id 形如 claude@proj-xxx）。
fn definitions_for_project_root(root: &ExtraRoot) -> Vec<ClientDefinition> {
    build_project_definitions(Path::new(&root.path))
        .into_iter()
        .map(|mut def| {
            def.id = format!("{}@{}", def.id, root.tag);
            def.name = format!("{}（{}）", def.name, root.label);
            def.root_label = Some(root.label.clone());
            def
        })
        .collect()
}

/// 扩展扫描根（如 WSL 的 UNC 路径或任意自定义 home 目录）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtraRoot {
    pub tag: String,
    pub label: String,
    pub path: String,
    pub kind: String,
}

// 仅这些“纯 home 相对”的 CLI 客户端在扩展根（WSL）下有意义；
// 桌面/IDE 客户端依赖 Windows 的 appdata/安装路径，扩展根下跳过。
const EXTRA_ROOT_CLIENT_IDS: &[&str] = &["claude", "codex", "gemini", "opencode", "openclaw", "hermes"];

fn definitions_for_extra_root(root: &ExtraRoot) -> Vec<ClientDefinition> {
    build_definitions(Path::new(&root.path))
        .into_iter()
        .filter(|def| EXTRA_ROOT_CLIENT_IDS.contains(&def.id.as_str()))
        .map(|mut def| {
            def.id = format!("{}@{}", def.id, root.tag);
            def.name = format!("{}（{}）", def.name, root.label);
            def.exe_names = &[];
            def.exe_candidates = vec![];
            def.source = if root.kind.is_empty() { "custom".into() } else { root.kind.clone() };
            def.root_label = Some(root.label.clone());
            def
        })
        .collect()
}

fn definitions_with_extra_roots(extra_roots: &[ExtraRoot]) -> Vec<ClientDefinition> {
    let mut defs = client_definitions();
    for root in extra_roots {
        // 项目根用项目级布局（.claude/skills、AGENTS.md…）；WSL/自定义根复用 home 布局（换 root）。
        if root.kind == "project" {
            defs.extend(definitions_for_project_root(root));
        } else {
            defs.extend(definitions_for_extra_root(root));
        }
    }
    defs
}

/// 返回某客户端可写入的 Skills 根目录（skill_dirs 的第一个）；用于市场安装“复制型”skill 落点。
pub fn client_skill_root(client_id: &str) -> Option<PathBuf> {
    client_definitions()
        .into_iter()
        .find(|item| item.id == client_id)
        .and_then(|item| item.skill_dirs.into_iter().next())
}

fn parse_config_file(path: &Path) -> Option<Value> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&content)
        .ok()
        .or_else(|| json5::from_str::<Value>(&content).ok())
}

fn toml_value_to_json(value: &toml::Value) -> Option<Value> {
    match value {
        toml::Value::String(s) => Some(Value::String(s.clone())),
        toml::Value::Integer(i) => Some(Value::Number((*i).into())),
        toml::Value::Float(f) => serde_json::Number::from_f64(*f).map(Value::Number),
        toml::Value::Boolean(b) => Some(Value::Bool(*b)),
        toml::Value::Array(arr) => Some(Value::Array(
            arr.iter().filter_map(toml_value_to_json).collect::<Vec<_>>(),
        )),
        toml::Value::Table(tbl) => {
            let mut map = serde_json::Map::new();
            for (key, val) in tbl {
                if let Some(json) = toml_value_to_json(val) {
                    map.insert(key.clone(), json);
                }
            }
            Some(Value::Object(map))
        }
        toml::Value::Datetime(dt) => Some(Value::String(dt.to_string())),
    }
}

fn append_codex_toml_servers(
    servers: &mut Vec<DetectedMcpServer>,
    client_id: &str,
    client_name: &str,
    source_path: &Path,
    root: &toml::Value,
) {
    let mut append_table = |table: &toml::value::Table| {
        for (id, entry) in table {
            let Some(json) = toml_value_to_json(entry) else {
                continue;
            };
            if !json.is_object() {
                continue;
            }
            servers.push(summarize_mcp_server(id, client_id, client_name, source_path, &json));
        }
    };

    if let Some(table) = root.get("mcp_servers").and_then(toml::Value::as_table) {
        append_table(table);
    }
    if let Some(table) = root.get("mcp_servers_disabled").and_then(toml::Value::as_table) {
        append_table(table);
    }
    if let Some(table) = root
        .get("mcp")
        .and_then(toml::Value::as_table)
        .and_then(|mcp| mcp.get("servers"))
        .and_then(toml::Value::as_table)
    {
        append_table(table);
    }
}

fn parse_yaml_file_as_json(path: &Path) -> Option<Value> {
    let content = std::fs::read_to_string(path).ok()?;
    let yaml = serde_yaml::from_str::<serde_yaml::Value>(&content).ok()?;
    serde_json::to_value(yaml).ok()
}

fn append_servers_from_map(
    servers: &mut Vec<DetectedMcpServer>,
    client_id: &str,
    client_name: &str,
    source_path: &Path,
    map: &serde_json::Map<String, Value>,
) {
    for (id, spec) in map {
        if !spec.is_object() {
            continue;
        }
        servers.push(summarize_mcp_server(
            id,
            client_id,
            client_name,
            source_path,
            spec,
        ));
    }
}

fn collect_mcp_servers(definition: &ClientDefinition) -> Vec<DetectedMcpServer> {
    let mut servers = Vec::new();

    for path in existing_paths(&definition.config_candidates) {
        if definition.id == "codex" {
            if path.file_name().and_then(|name| name.to_str()) == Some("config.toml") {
                if let Ok(text) = std::fs::read_to_string(&path) {
                    if let Ok(root) = toml::from_str::<toml::Value>(&text) {
                        append_codex_toml_servers(
                            &mut servers,
                            &definition.id,
                            &definition.name,
                            &path,
                            &root,
                        );
                    }
                }
            }
            continue;
        }

        if definition.id == "opencode" {
            if let Some(root) = parse_config_file(&path) {
                if let Some(map) = root.get("mcp").and_then(Value::as_object) {
                    append_servers_from_map(&mut servers, &definition.id, &definition.name, &path, map);
                }
            }
            continue;
        }

        if definition.id == "gemini" {
            if let Some(root) = parse_config_file(&path) {
                if let Some(map) = root.get("mcpServers").and_then(Value::as_object) {
                    append_servers_from_map(&mut servers, &definition.id, &definition.name, &path, map);
                }
                if let Some(map) = root.get("mcpServersDisabled").and_then(Value::as_object) {
                    append_servers_from_map(&mut servers, &definition.id, &definition.name, &path, map);
                }
            }
            continue;
        }

        if definition.id == "hermes" {
            if let Some(root) = parse_yaml_file_as_json(&path) {
                if let Some(map) = root.get("mcp_servers").and_then(Value::as_object) {
                    append_servers_from_map(&mut servers, &definition.id, &definition.name, &path, map);
                }
            }
            continue;
        }

        if definition.id == "openclaw" {
            // OpenClaw MCP 结构尚未稳定，这里只检测客户端与 Skills，不主动臆测 MCP 结构。
            continue;
        }

        if definition.id == "vscode" {
            if let Some(root) = parse_config_file(&path) {
                if let Some(map) = root.get("servers").and_then(Value::as_object) {
                    append_servers_from_map(&mut servers, &definition.id, &definition.name, &path, map);
                }
                if let Some(mcp) = root.get("mcp").and_then(Value::as_object) {
                    if let Some(map) = mcp.get("servers").and_then(Value::as_object) {
                        append_servers_from_map(&mut servers, &definition.id, &definition.name, &path, map);
                    }
                }
            }
            continue;
        }

        if let Some(root) = parse_config_file(&path) {
            if let Some(map) = root.get("mcpServers").and_then(Value::as_object) {
                append_servers_from_map(&mut servers, &definition.id, &definition.name, &path, map);
            } else if let Some(map) = root.get("servers").and_then(Value::as_object) {
                append_servers_from_map(&mut servers, &definition.id, &definition.name, &path, map);
            }
            if let Some(map) = root.get("mcpServersDisabled").and_then(Value::as_object) {
                append_servers_from_map(&mut servers, &definition.id, &definition.name, &path, map);
            }
        }
    }

    servers
}

fn summarize_mcp_server(
    id: &str,
    client_id: &str,
    client_name: &str,
    source_path: &Path,
    spec: &Value,
) -> DetectedMcpServer {
    let obj = spec.as_object();
    let mut transport = obj
        .and_then(|o| o.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("stdio")
        .to_string();

    let enabled = obj
        .and_then(|o| o.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let command = obj.and_then(|o| {
        if let Some(s) = o.get("command").and_then(Value::as_str) {
            let mut parts = vec![s.to_string()];
            if let Some(args) = o.get("args").and_then(Value::as_array) {
                parts.extend(args.iter().filter_map(Value::as_str).map(ToString::to_string));
            }
            return Some(parts.join(" "));
        }
        if let Some(arr) = o.get("command").and_then(Value::as_array) {
            let parts = arr
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            if !parts.is_empty() {
                return Some(parts.join(" "));
            }
        }
        None
    });

    let url = obj
        .and_then(|o| o.get("url").or_else(|| o.get("httpUrl")))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    if transport == "local" {
        transport = "stdio".to_string();
    } else if transport == "remote" {
        transport = "http".to_string();
    } else if obj
        .and_then(|o| o.get("httpUrl"))
        .and_then(Value::as_str)
        .is_some()
    {
        transport = "http".to_string();
    } else if transport == "stdio" && command.is_none() && url.is_some() {
        transport = "sse".to_string();
    }

    DetectedMcpServer {
        id: id.to_string(),
        name: id.to_string(),
        client_id: client_id.to_string(),
        client_name: client_name.to_string(),
        source_path: path_to_string(source_path),
        transport,
        command,
        url,
        enabled,
    }
}

fn extra_skill_roots() -> Vec<PathBuf> {
    let home = home_dir();
    // 仅收录“非客户端目录”的通用 skill 位置；.codex/.gemini 已是客户端目录，不再当共享。
    vec![home.join(".agents").join("skills")]
}

#[derive(Debug, Default, Deserialize)]
struct SkillFrontMatter {
    name: Option<String>,
    description: Option<String>,
    tags: Option<TagsField>,
    category: Option<TagsField>,
}

// tags / category 既可能是 YAML 数组/块状列表，也可能是单个字符串（含逗号分隔）。
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TagsField {
    List(Vec<String>),
    One(String),
}

impl TagsField {
    fn into_vec(self) -> Vec<String> {
        match self {
            TagsField::List(items) => items,
            TagsField::One(value) => value.split(',').map(|s| s.to_string()).collect(),
        }
    }
}

// 去空格、去空、忽略大小写去重，保留首次出现顺序。
fn normalize_tags(raw: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in raw {
        let tag = tag.trim().to_string();
        if tag.is_empty() {
            continue;
        }
        if !out.iter().any(|existing| existing.eq_ignore_ascii_case(&tag)) {
            out.push(tag);
        }
    }
    out
}

fn parse_skill_meta(skill_md: &Path, fallback: &str) -> (String, Option<String>, Vec<String>) {
    let Ok(content) = std::fs::read_to_string(skill_md) else {
        return (fallback.to_string(), None, Vec::new());
    };
    let trimmed = content.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        return (fallback.to_string(), None, Vec::new());
    }

    let mut parts = trimmed.splitn(3, "---");
    let _ = parts.next();
    let Some(front_matter) = parts.next() else {
        return (fallback.to_string(), None, Vec::new());
    };

    // 优先用 YAML 解析：稳妥支持 tags 的数组 / 块状列表 / 逗号 / 单值，以及 category。
    if let Ok(meta) = serde_yaml::from_str::<SkillFrontMatter>(front_matter) {
        let mut raw_tags = Vec::new();
        if let Some(tags) = meta.tags {
            raw_tags.extend(tags.into_vec());
        }
        if let Some(category) = meta.category {
            raw_tags.extend(category.into_vec());
        }
        let name = meta
            .name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| fallback.to_string());
        let description = meta
            .description
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        return (name, description, normalize_tags(raw_tags));
    }

    // YAML 解析失败时回落到逐行解析，仅取 name/description，确保不回归。
    let mut name = None;
    let mut description = None;
    for line in front_matter.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
        match key.trim() {
            "name" if !value.is_empty() => name = Some(value),
            "description" if !value.is_empty() => description = Some(value),
            _ => {}
        }
    }

    (
        name.unwrap_or_else(|| fallback.to_string()),
        description,
        Vec::new(),
    )
}

fn extract_skill(
    path: &Path,
    dir_name: String,
    client_id: &str,
    client_name: &str,
    managed: bool,
    enabled: bool,
) -> Option<DetectedSkill> {
    let skill_md = path.join("SKILL.md");
    if !skill_md.is_file() {
        return None;
    }
    let (name, description, tags) = parse_skill_meta(&skill_md, &dir_name);
    let updated_at = timestamp_for_paths(&[skill_md.clone(), path.to_path_buf()]);
    Some(DetectedSkill {
        directory: dir_name,
        name,
        description,
        client_id: client_id.to_string(),
        client_name: client_name.to_string(),
        path: path_to_string(path),
        managed,
        updated_at,
        tags,
        linked: false,
        linked_clients: Vec::new(),
        enabled,
    })
}

fn scan_skill_dir(dir: &Path, client_id: &str, client_name: &str, managed: bool, enabled: bool) -> Vec<DetectedSkill> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if dir_name.starts_with('.') {
            continue;
        }
        if let Some(skill) = extract_skill(&path, dir_name, client_id, client_name, managed, enabled) {
            out.push(skill);
        }
    }

    out
}

fn collect_skills(definitions: &[ClientDefinition]) -> Vec<DetectedSkill> {
    // 按规范化路径全局去重：同一目录被多处扫到时只保留一次（优先级 库 > 客户端 > 共享）。
    let mut seen_paths: BTreeSet<PathBuf> = BTreeSet::new();

    // 1. 中心库（单一真相源）
    let mut library_skills = scan_skill_dir(&library_skills_dir(), "library", "中心库", true, true);
    let mut lib_index: BTreeMap<PathBuf, usize> = BTreeMap::new();
    for (idx, skill) in library_skills.iter().enumerate() {
        let canon = canonical_or_original(Path::new(&skill.path));
        lib_index.insert(canon.clone(), idx);
        seen_paths.insert(canon);
    }

    let mut client_skills: Vec<DetectedSkill> = Vec::new();

    // 2. 客户端目录：指向库的 junction → 记为绑定（回填库 skill 的 linked_clients）；其余为普通 skill
    for definition in definitions {
        for dir in &definition.skill_dirs {
            let Ok(entries) = std::fs::read_dir(dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if dir_name.starts_with('.') {
                    continue;
                }
                if is_junction(&path) {
                    if let Some(&idx) = lib_index.get(&canonical_or_original(&path)) {
                        let cid = definition.id.clone();
                        if !library_skills[idx].linked_clients.contains(&cid) {
                            library_skills[idx].linked_clients.push(cid);
                        }
                        continue;
                    }
                }
                if let Some(skill) = extract_skill(&path, dir_name, &definition.id, &definition.name, false, true) {
                    if seen_paths.insert(canonical_or_original(&path)) {
                        client_skills.push(skill);
                    }
                }
            }
        }
    }

    // 3. extra_skill_roots（通用 skill 目录，如 .agents）
    for dir in extra_skill_roots() {
        for skill in scan_skill_dir(&dir, "shared", "共享 Skills", true, true) {
            if seen_paths.insert(canonical_or_original(Path::new(&skill.path))) {
                client_skills.push(skill);
            }
        }
    }

    // 库 skill 置顶，其后是客户端/共享 skill
    let mut skills = library_skills;
    skills.extend(client_skills);
    skills
}

/// 扫描项目私有禁用区 <proj>/.smrmanager/disabled/<baseClientId>/<name>，标 enabled=false。
/// 启用区的项目 Skill 由 collect_skills 正常扫到（enabled=true）。
fn collect_project_disabled_skills(extra_roots: &[ExtraRoot]) -> Vec<DetectedSkill> {
    let mut out = Vec::new();
    for root in extra_roots {
        if root.kind != "project" {
            continue;
        }
        let base = Path::new(&root.path);
        for def in build_project_definitions(base) {
            // 仅对「有项目级 skill 目录」的客户端维护禁用区。
            if def.skill_dirs.is_empty() {
                continue;
            }
            let disabled_dir = base.join(".smrmanager").join("disabled").join(&def.id);
            let tagged_id = format!("{}@{}", def.id, root.tag);
            let tagged_name = format!("{}（{}）", def.name, root.label);
            out.extend(scan_skill_dir(&disabled_dir, &tagged_id, &tagged_name, false, false));
        }
    }
    out
}

fn is_rule_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if matches!(
        file_name.as_str(),
        "agents.md" | "claude.md" | "gemini.md" | "soul.md" | ".cursorrules" | "copilot-instructions.md"
    ) {
        return true;
    }

    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "mdc" | "txt" | "toml" | "yaml" | "yml" | "json")
    )
}

fn rule_name_from_path(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(|name| name.to_str())
        .map(|name| name.trim_matches('.').to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Rule".to_string())
}

fn rule_source(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| "规则文件".to_string())
}

fn rule_kind(path: &Path, managed: bool) -> String {
    if managed {
        return "工作区规则".to_string();
    }

    let source = rule_source(path).to_ascii_lowercase();
    if matches!(
        source.as_str(),
        "agents.md" | "claude.md" | "gemini.md" | "soul.md" | "user.md" | "identity.md"
    ) {
        "系统提示词".to_string()
    } else if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("mdc"))
        .unwrap_or(false)
    {
        "IDE Rule".to_string()
    } else {
        "规则文件".to_string()
    }
}

fn rule_preview(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let trimmed = content.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut preview = String::new();
    for token in trimmed.split_whitespace() {
        if !preview.is_empty() {
            preview.push(' ');
        }
        preview.push_str(token);
        if preview.chars().count() >= 180 {
            break;
        }
    }

    if preview.chars().count() > 180 {
        Some(preview.chars().take(180).collect::<String>())
    } else {
        Some(preview)
    }
}

fn detected_rule_from_file(path: &Path, client_id: &str, client_name: &str, managed: bool) -> DetectedRule {
    DetectedRule {
        name: rule_name_from_path(path),
        client_id: client_id.to_string(),
        client_name: client_name.to_string(),
        path: path_to_string(path),
        kind: rule_kind(path, managed),
        source: rule_source(path),
        preview: rule_preview(path),
        managed,
        updated_at: timestamp_for_paths(&[path.to_path_buf()]),
    }
}

fn scan_rule_dir(
    dir: &Path,
    client_id: &str,
    client_name: &str,
    managed: bool,
    depth: usize,
) -> Vec<DetectedRule> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            // 规则目录可能按项目/语言分组；限制递归深度，避免误扫过大的用户目录。
            if depth < 2 && !file_name.starts_with('.') {
                out.extend(scan_rule_dir(&path, client_id, client_name, managed, depth + 1));
            }
            continue;
        }

        if is_rule_file(&path) {
            out.push(detected_rule_from_file(&path, client_id, client_name, managed));
        }
    }

    out
}

fn scan_rule_path(path: &Path, client_id: &str, client_name: &str, managed: bool) -> Vec<DetectedRule> {
    if is_rule_file(path) {
        vec![detected_rule_from_file(path, client_id, client_name, managed)]
    } else if path.is_dir() {
        scan_rule_dir(path, client_id, client_name, managed, 0)
    } else {
        Vec::new()
    }
}

fn workspace_rule_paths() -> Vec<PathBuf> {
    let Ok(cwd) = std::env::current_dir() else {
        return Vec::new();
    };

    vec![
        cwd.join("AGENTS.md"),
        cwd.join("CLAUDE.md"),
        cwd.join("GEMINI.md"),
        cwd.join(".cursorrules"),
        cwd.join(".cursor").join("rules"),
        cwd.join(".github").join("copilot-instructions.md"),
    ]
}

fn collect_rules(definitions: &[ClientDefinition]) -> Vec<DetectedRule> {
    let mut rules = Vec::new();
    let mut seen = BTreeSet::new();

    for definition in definitions {
        for path in &definition.rule_paths {
            for rule in scan_rule_path(path, &definition.id, &definition.name, false) {
                let key = format!("{}:{}", rule.client_id, rule.path);
                if seen.insert(key) {
                    rules.push(rule);
                }
            }
        }
    }

    for path in workspace_rule_paths() {
        for rule in scan_rule_path(&path, "workspace", "工作区 Rules", true) {
            let key = format!("{}:{}", rule.client_id, rule.path);
            if seen.insert(key) {
                rules.push(rule);
            }
        }
    }

    rules
}

#[tauri::command]
pub fn detect_environment(extra_roots: Vec<ExtraRoot>) -> DetectionSnapshot {
    let definitions = definitions_with_extra_roots(&extra_roots);
    let mut all_mcp = Vec::new();
    let mut all_skills = collect_skills(&definitions);
    // 项目级禁用区里的 Skill（enabled=false），并入以便计数与展示。
    all_skills.extend(collect_project_disabled_skills(&extra_roots));
    let all_rules = collect_rules(&definitions);
    let mut skills_by_client: BTreeMap<String, usize> = BTreeMap::new();
    for skill in &all_skills {
        *skills_by_client.entry(skill.client_id.clone()).or_default() += 1;
    }
    let mut rules_by_client: BTreeMap<String, usize> = BTreeMap::new();
    for rule in &all_rules {
        *rules_by_client.entry(rule.client_id.clone()).or_default() += 1;
    }

    let mut clients = Vec::new();

    for definition in &definitions {
        let detected_config_paths = existing_paths(&definition.config_candidates);
        let executable_path = first_existing_executable(definition);
        let client_mcp = collect_mcp_servers(definition);
        let mcp_count = client_mcp.iter().filter(|server| server.enabled).count();
        all_mcp.extend(client_mcp);

        let has_skill_dir = definition.skill_dirs.iter().any(|dir| dir.exists());
        let has_rule_path = definition.rule_paths.iter().any(|path| path.exists());
        let installed =
            executable_path.is_some() || !detected_config_paths.is_empty() || has_skill_dir || has_rule_path;
        let status_message = if installed {
            if executable_path.is_some() {
                "已检测到客户端，可启动并管理配置".to_string()
            } else {
                "检测到配置目录，但未找到可启动程序".to_string()
            }
        } else {
            "未检测到客户端；安装后才会显示 MCP 和 Skills 配置".to_string()
        };

        let mut timestamp_paths = detected_config_paths.clone();
        timestamp_paths.extend(existing_paths(&definition.rule_paths));
        let updated_at = timestamp_for_paths(&timestamp_paths);

        clients.push(DetectedClient {
            id: definition.id.to_string(),
            name: definition.name.to_string(),
            product: definition.product.to_string(),
            client_type: definition.kind.to_string(),
            description: definition.description.to_string(),
            installed,
            executable_path: executable_path.as_ref().map(|p| path_to_string(p)),
            config_paths: definition
                .config_candidates
                .iter()
                .map(|p| path_to_string(p))
                .collect(),
            detected_config_paths: detected_config_paths.iter().map(|p| path_to_string(p)).collect(),
            install_url: definition.install_url.to_string(),
            mcp_count,
            skills_count: skills_by_client.get(definition.id.as_str()).copied().unwrap_or(0),
            roles_count: rules_by_client.get(definition.id.as_str()).copied().unwrap_or(0),
            updated_at,
            status_message,
            source: definition.source.clone(),
            root_label: definition.root_label.clone(),
        });
    }

    let scanned_at = UNIX_EPOCH
        .elapsed()
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    DetectionSnapshot {
        clients,
        mcp_servers: all_mcp,
        skills: all_skills,
        rules: all_rules,
        scanned_at,
    }
}

fn safe_trash_name(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "skill".to_string()
    } else {
        out
    }
}

const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

fn library_skills_dir() -> PathBuf {
    home_dir().join(".smrmanager").join("library").join("skills")
}

// 是否为 junction / symlink（reparse point）。Rust 的 FileType::is_symlink() 对 junction 返回 false，须查属性位。
fn is_junction(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|meta| meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        .unwrap_or(false)
}

// 创建目录联接（junction，免管理员）；失败回退绝对 symlink。
fn create_junction(link: &Path, source: &Path) -> Result<(), String> {
    if link.exists() || is_junction(link) {
        return Err(format!("目标已存在: {}", path_to_string(link)));
    }
    if let Some(parent) = link.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建父目录失败 {}: {e}", path_to_string(parent)))?;
    }
    let output = Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(link)
        .arg(source)
        .output();
    if let Ok(out) = output {
        if out.status.success() {
            return Ok(());
        }
    }
    // 回退：绝对路径 symlink（需开发者模式/管理员）。
    std::os::windows::fs::symlink_dir(source, link)
        .map_err(|e| format!("创建链接失败（junction 与 symlink 均失败）: {e}"))
}

// 仅移除链接本身。严禁用 remove_dir_all——那会穿透删除库源。
fn remove_link(path: &Path) -> Result<(), String> {
    std::fs::remove_dir(path).map_err(|e| format!("移除链接失败 {}: {e}", path_to_string(path)))
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("创建目录失败 {}: {e}", path_to_string(to)))?;
    for entry in std::fs::read_dir(from).map_err(|e| format!("读取目录失败 {}: {e}", path_to_string(from)))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            copy_dir_recursive(&source, &target)?;
        } else {
            std::fs::copy(&source, &target)
                .map_err(|e| format!("复制文件失败 {}: {e}", path_to_string(&source)))?;
        }
    }
    Ok(())
}

fn unique_skill_destination(root: &Path, directory: &str) -> PathBuf {
    let base = if directory.trim().is_empty() {
        "skill".to_string()
    } else {
        directory.to_string()
    };
    let mut target = root.join(&base);
    if !target.exists() {
        return target;
    }
    target = root.join(format!("{base}-copy"));
    let mut index = 2usize;
    while target.exists() {
        target = root.join(format!("{base}-copy-{index}"));
        index += 1;
    }
    target
}

fn canonical_or_original(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn build_allowed_skill_map(definitions: &[ClientDefinition]) -> BTreeMap<PathBuf, DetectedSkill> {
    let mut allowed = BTreeMap::new();
    for skill in collect_skills(definitions) {
        if let Ok(canonical) = PathBuf::from(&skill.path).canonicalize() {
            allowed.insert(canonical, skill);
        }
    }
    allowed
}

fn move_dir_to_trash(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建回收目录失败 {}: {e}", path_to_string(parent)))?;
    }

    match std::fs::rename(from, to) {
        Ok(_) => Ok(()),
        Err(_) => {
            // 不做不可逆删除：跨盘移动失败时先复制到回收目录，成功后再移除原目录。
            copy_dir_recursive(from, to)?;
            std::fs::remove_dir_all(from)
                .map_err(|e| format!("移除原 Skill 目录失败 {}: {e}", path_to_string(from)))
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistro {
    pub distro: String,
    pub user: String,
    pub home_unc: String,
    pub running: bool,
    pub is_default: bool,
}

// wsl.exe 的列表输出是 UTF-16LE，需手动解码。
fn decode_utf16le(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

#[tauri::command]
pub fn list_wsl_distros() -> Result<Vec<WslDistro>, String> {
    let output = Command::new("wsl.exe")
        .args(["-l", "-v"])
        .output()
        .map_err(|e| format!("无法调用 wsl.exe（可能未安装 WSL）：{e}"))?;
    if !output.status.success() {
        return Err("wsl.exe 返回错误，可能未安装 WSL 或没有发行版".to_string());
    }
    let listing = decode_utf16le(&output.stdout);
    let mut distros = Vec::new();
    for raw in listing.lines() {
        // 清掉穿插的 NUL/BOM，再按列解析： [*] NAME STATE VERSION
        let line: String = raw.chars().filter(|c| *c != '\u{0}' && *c != '\u{feff}').collect();
        if line.trim().is_empty() {
            continue;
        }
        let is_default = line.trim_start().starts_with('*');
        let rest = line.trim_start().trim_start_matches('*').trim_start();
        let mut tokens = rest.split_whitespace();
        let Some(name) = tokens.next() else {
            continue;
        };
        if name.eq_ignore_ascii_case("NAME") {
            continue; // 表头
        }
        let state = tokens.next().unwrap_or("");
        let running = state.eq_ignore_ascii_case("Running");

        // 仅对运行中的发行版取 $HOME（避免为读路径而唤醒已停止的发行版）。
        let (user, home_unc) = if running {
            let home = Command::new("wsl.exe")
                .args(["-d", name, "--", "sh", "-c", "echo $HOME"])
                .output()
                .ok()
                .and_then(|out| {
                    if out.status.success() {
                        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
                    } else {
                        None
                    }
                })
                .filter(|h| h.starts_with('/'))
                .unwrap_or_else(|| "/root".to_string());
            let user = home.rsplit('/').next().unwrap_or("").to_string();
            let unc = format!("\\\\wsl.localhost\\{}{}", name, home.replace('/', "\\"));
            (user, unc)
        } else {
            (String::new(), String::new())
        };

        distros.push(WslDistro {
            distro: name.to_string(),
            user,
            home_unc,
            running,
            is_default,
        });
    }
    Ok(distros)
}

fn wsl_command_ok(args: &[&str]) -> Result<(), String> {
    let out = Command::new("wsl.exe")
        .args(args)
        .output()
        .map_err(|e| format!("调用 wsl.exe 失败: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        let msg = decode_utf16le(&out.stderr);
        let msg = msg.trim();
        Err(if msg.is_empty() {
            "wsl.exe 命令失败".to_string()
        } else {
            msg.to_string()
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn wsl_set_default(distro: String) -> Result<(), String> {
    wsl_command_ok(&["--set-default", &distro])
}

#[tauri::command(rename_all = "camelCase")]
pub fn wsl_terminate(distro: String) -> Result<(), String> {
    wsl_command_ok(&["--terminate", &distro])
}

#[tauri::command(rename_all = "camelCase")]
pub fn wsl_start(distro: String) -> Result<(), String> {
    // 运行任意命令即可拉起该发行版。
    Command::new("wsl.exe")
        .args(["-d", &distro, "--", "true"])
        .output()
        .map_err(|e| format!("启动失败: {e}"))?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn wsl_open_terminal(distro: String) -> Result<(), String> {
    // 优先 Windows Terminal，回退 cmd start wsl。
    if Command::new("wt.exe").args(["-d", &distro]).spawn().is_ok() {
        return Ok(());
    }
    Command::new("cmd")
        .args(["/c", "start", "", "wsl.exe", "-d", &distro])
        .spawn()
        .map_err(|e| format!("打开终端失败: {e}"))?;
    Ok(())
}

/// 在项目目录打开「终端」（Windows Terminal 优先），即右键菜单"在终端中打开"的形式。
#[tauri::command(rename_all = "camelCase")]
pub fn open_terminal_at(path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("目录不存在: {path}"));
    }
    // 优先 Windows Terminal（wt -d 直接在指定目录开一个标签）；回退到 cmd start 并 cd 到该目录。
    if Command::new("wt.exe").args(["-d", &path]).spawn().is_ok() {
        return Ok(());
    }
    Command::new("cmd")
        .args(["/c", "start", "", "cmd", "/k", "cd", "/d", &path])
        .spawn()
        .map_err(|e| format!("打开终端失败: {e}"))?;
    Ok(())
}

/// 在项目目录启动客户端 CLI（Windows Terminal 内、以项目目录为工作目录运行 claude/codex/… ）；
/// 非 CLI 客户端回退为仅打开终端。
#[tauri::command(rename_all = "camelCase")]
pub fn launch_client_in_project(project_path: String, client_id: String) -> Result<(), String> {
    let dir = PathBuf::from(&project_path);
    if !dir.is_dir() {
        return Err(format!("目录不存在: {project_path}"));
    }
    let base_id = client_id.split('@').next().unwrap_or(client_id.as_str());
    let cli = match base_id {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "gemini" => Some("gemini"),
        "opencode" => Some("opencode"),
        "openclaw" => Some("openclaw"),
        "hermes" => Some("hermes"),
        _ => None,
    };
    let Some(cmd) = cli else {
        // 非 CLI 客户端（IDE/桌面/工作台）：仅在项目目录打开终端。
        return open_terminal_at(project_path);
    };
    // 优先 Windows Terminal：-d 设工作目录为项目目录，cmd /k 保留窗口便于交互与查看输出。
    if Command::new("wt.exe")
        .args(["-d", project_path.as_str(), "cmd", "/k", cmd])
        .spawn()
        .is_ok()
    {
        return Ok(());
    }
    Command::new("cmd")
        .args(["/c", "start", "", "cmd", "/k", &format!("cd /d \"{project_path}\" && {cmd}")])
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn transfer_skills(
    paths: Vec<String>,
    target_client_id: String,
    action: String,
    extra_roots: Vec<ExtraRoot>,
) -> Result<TransferSkillsResult, String> {
    let definitions = definitions_with_extra_roots(&extra_roots);
    let Some(target_definition) = definitions.iter().find(|item| item.id == target_client_id) else {
        return Err(format!("未知目标客户端: {target_client_id}"));
    };
    let Some(target_root) = target_definition.skill_dirs.first() else {
        return Err(format!("{} 暂未配置可写入的 Skills 目录", target_definition.name));
    };

    let action = action.to_ascii_lowercase();
    if action != "copy" && action != "move" {
        return Err("未知操作，只支持 copy 或 move".to_string());
    }

    std::fs::create_dir_all(target_root)
        .map_err(|e| format!("创建目标 Skills 目录失败 {}: {e}", path_to_string(target_root)))?;

    let target_root_canonical = canonical_or_original(target_root);
    let allowed = build_allowed_skill_map(&definitions);
    let mut seen = BTreeSet::new();
    let mut copied = 0usize;
    let mut moved = 0usize;
    let mut written_paths = Vec::new();
    let mut failed = Vec::new();

    for raw in paths {
        if !seen.insert(raw.clone()) {
            continue;
        }
        let requested = PathBuf::from(&raw);
        let Ok(source) = requested.canonicalize() else {
            failed.push(format!("{raw}：路径不存在"));
            continue;
        };
        let Some(skill) = allowed.get(&source) else {
            failed.push(format!("{raw}：不在已检测 Skill 范围内，已拒绝操作"));
            continue;
        };

        if source.parent().map(canonical_or_original).as_ref() == Some(&target_root_canonical) {
            failed.push(format!("{}：已经位于目标客户端 {}", skill.name, target_definition.name));
            continue;
        }

        let target = unique_skill_destination(target_root, &skill.directory);
        if target.starts_with(&source) {
            failed.push(format!("{}：目标目录位于源目录内部，已拒绝操作", skill.name));
            continue;
        }

        match copy_dir_recursive(&source, &target) {
            Ok(_) if action == "move" => match std::fs::remove_dir_all(&source) {
                Ok(_) => {
                    moved += 1;
                    written_paths.push(path_to_string(&target));
                }
                Err(error) => failed.push(format!(
                    "{}：已复制到目标，但移除源目录失败 {}: {error}",
                    skill.name,
                    path_to_string(&source)
                )),
            },
            Ok(_) => {
                copied += 1;
                written_paths.push(path_to_string(&target));
            }
            Err(error) => failed.push(format!("{}：{}", skill.name, error)),
        }
    }

    let done = if action == "move" { moved } else { copied };
    let verb = if action == "move" { "移动" } else { "复制" };
    Ok(TransferSkillsResult {
        copied,
        moved,
        target_client_id: target_definition.id.to_string(),
        target_client_name: target_definition.name.to_string(),
        target_root: path_to_string(target_root),
        written_paths,
        failed,
        message: format!("已{verb} {done} 个 Skill 到 {}", target_definition.name),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkillResult {
    pub imported: bool,
    pub target_client_id: String,
    pub target_client_name: String,
    pub target_path: String,
    pub message: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn import_skill(source_dir: String, target_client_id: String) -> Result<ImportSkillResult, String> {
    let definitions = client_definitions();
    let Some(target_definition) = definitions.iter().find(|item| item.id == target_client_id) else {
        return Err(format!("未知目标客户端: {target_client_id}"));
    };
    let Some(target_root) = target_definition.skill_dirs.first() else {
        return Err(format!("{} 暂未配置可写入的 Skills 目录", target_definition.name));
    };

    let source = PathBuf::from(&source_dir);
    if !source.is_dir() {
        return Err(format!("源目录不存在: {source_dir}"));
    }
    if !source.join("SKILL.md").is_file() {
        return Err("该目录不是有效的 Skill（缺少 SKILL.md）".to_string());
    }

    let directory = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "skill".to_string());

    std::fs::create_dir_all(target_root)
        .map_err(|e| format!("创建目标 Skills 目录失败 {}: {e}", path_to_string(target_root)))?;

    let source_canonical = canonical_or_original(&source);
    let target_root_canonical = canonical_or_original(target_root);
    if source.parent().map(canonical_or_original).as_ref() == Some(&target_root_canonical) {
        return Err(format!("该 Skill 已经位于 {} 的 Skills 目录中", target_definition.name));
    }

    let target = unique_skill_destination(target_root, &directory);
    if target.starts_with(&source_canonical) {
        return Err("目标目录位于源目录内部，已拒绝操作".to_string());
    }

    copy_dir_recursive(&source, &target)?;

    Ok(ImportSkillResult {
        imported: true,
        target_client_id: target_definition.id.to_string(),
        target_client_name: target_definition.name.to_string(),
        target_path: path_to_string(&target),
        message: format!("已导入 Skill「{directory}」到 {}", target_definition.name),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryOpResult {
    pub ok: usize,
    pub failed: Vec<String>,
    pub message: String,
}

// 移除所有 Windows 客户端里指向某库 skill 的 junction（按 canonical 目标匹配）。
fn unlink_library_skill_links(source_canonical: &Path) {
    for def in client_definitions() {
        for root in &def.skill_dirs {
            let Ok(entries) = std::fs::read_dir(root) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if is_junction(&path) && canonical_or_original(&path) == *source_canonical {
                    let _ = remove_link(&path);
                }
            }
        }
    }
}

// 收编：把客户端现有 skill 移入中心库，并在原位建 junction 指回库（真·单一源）。
#[tauri::command(rename_all = "camelCase")]
pub fn adopt_skills_to_library(
    paths: Vec<String>,
    extra_roots: Vec<ExtraRoot>,
) -> Result<LibraryOpResult, String> {
    let definitions = definitions_with_extra_roots(&extra_roots);
    let allowed = build_allowed_skill_map(&definitions);
    let lib_dir = library_skills_dir();
    std::fs::create_dir_all(&lib_dir).map_err(|e| format!("创建中心库目录失败: {e}"))?;

    let mut ok = 0usize;
    let mut failed = Vec::new();
    for raw in paths {
        let requested = PathBuf::from(&raw);
        if is_junction(&requested) {
            failed.push(format!("{raw}：已是链接，无需收编"));
            continue;
        }
        if raw.starts_with("\\\\") {
            failed.push(format!("{raw}：WSL/UNC 来源暂不支持收编进库"));
            continue;
        }
        let Ok(canonical) = requested.canonicalize() else {
            failed.push(format!("{raw}：路径不存在"));
            continue;
        };
        let Some(skill) = allowed.get(&canonical) else {
            failed.push(format!("{raw}：不在已检测 Skill 范围内"));
            continue;
        };
        if skill.client_id == "library" || skill.managed {
            failed.push(format!("{}：已在中心库/共享目录中", skill.name));
            continue;
        }
        let dest = unique_skill_destination(&lib_dir, &skill.directory);
        // 移动：先 rename，跨卷失败回退 复制+删源。
        let moved = match std::fs::rename(&canonical, &dest) {
            Ok(_) => Ok(()),
            Err(_) => copy_dir_recursive(&canonical, &dest)
                .and_then(|_| std::fs::remove_dir_all(&canonical).map_err(|e| format!("移除源目录失败: {e}"))),
        };
        if let Err(e) = moved {
            failed.push(format!("{}：移动入库失败 {e}", skill.name));
            continue;
        }
        // 原位建 junction 指回库；失败则回滚。
        match create_junction(&requested, &dest) {
            Ok(_) => ok += 1,
            Err(e) => {
                let _ = std::fs::rename(&dest, &canonical);
                failed.push(format!("{}：建链接失败，已回滚 {e}", skill.name));
            }
        }
    }
    Ok(LibraryOpResult {
        ok,
        failed,
        message: format!("已收编 {ok} 个 Skill 进中心库"),
    })
}

// 链接：把库 skill 以 junction 形式链接到指定 Windows 客户端。
#[tauri::command(rename_all = "camelCase")]
pub fn link_skill_to_clients(
    library_skill_path: String,
    client_ids: Vec<String>,
) -> Result<LibraryOpResult, String> {
    let source = PathBuf::from(&library_skill_path);
    let lib_canonical = canonical_or_original(&library_skills_dir());
    let source_canonical = canonical_or_original(&source);
    if !source_canonical.starts_with(&lib_canonical) {
        return Err("只能链接中心库内的 Skill".to_string());
    }
    if !source.is_dir() {
        return Err("库 Skill 不存在".to_string());
    }
    let definitions = client_definitions();
    let dir_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("skill")
        .to_string();
    let mut ok = 0usize;
    let mut failed = Vec::new();
    for cid in client_ids {
        let Some(def) = definitions.iter().find(|d| d.id == cid) else {
            failed.push(format!("{cid}：未知客户端"));
            continue;
        };
        let Some(root) = def.skill_dirs.first() else {
            failed.push(format!("{}：无可写入 Skills 目录", def.name));
            continue;
        };
        let link = root.join(&dir_name);
        if link.exists() || is_junction(&link) {
            if is_junction(&link) && canonical_or_original(&link) == source_canonical {
                ok += 1; // 已链接，幂等
            } else {
                failed.push(format!("{}：已存在同名 {dir_name}", def.name));
            }
            continue;
        }
        match create_junction(&link, &source) {
            Ok(_) => ok += 1,
            Err(e) => failed.push(format!("{}：{e}", def.name)),
        }
    }
    Ok(LibraryOpResult {
        ok,
        failed,
        message: format!("已链接到 {ok} 个客户端"),
    })
}

// 解链：移除指定客户端里指向该库 skill 的 junction（不删库源）。
#[tauri::command(rename_all = "camelCase")]
pub fn unlink_skill_from_clients(
    library_skill_path: String,
    client_ids: Vec<String>,
) -> Result<LibraryOpResult, String> {
    let source_canonical = canonical_or_original(&PathBuf::from(&library_skill_path));
    let definitions = client_definitions();
    let dir_name = PathBuf::from(&library_skill_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("skill")
        .to_string();
    let mut ok = 0usize;
    let mut failed = Vec::new();
    for cid in client_ids {
        let Some(def) = definitions.iter().find(|d| d.id == cid) else {
            failed.push(format!("{cid}：未知客户端"));
            continue;
        };
        let Some(root) = def.skill_dirs.first() else {
            continue;
        };
        let link = root.join(&dir_name);
        if is_junction(&link) && canonical_or_original(&link) == source_canonical {
            match remove_link(&link) {
                Ok(_) => ok += 1,
                Err(e) => failed.push(format!("{}：{e}", def.name)),
            }
        } else {
            failed.push(format!("{}：未找到指向库的链接", def.name));
        }
    }
    Ok(LibraryOpResult {
        ok,
        failed,
        message: format!("已从 {ok} 个客户端移除链接"),
    })
}

#[tauri::command]
pub fn delete_skills(paths: Vec<String>) -> Result<DeleteSkillsResult, String> {
    let definitions = client_definitions();
    let allowed = build_allowed_skill_map(&definitions);

    let ts = UNIX_EPOCH
        .elapsed()
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let trash_root = home_dir().join(".smrmanager").join("trash").join("skills");
    let mut moved_to_trash = Vec::new();
    let mut failed = Vec::new();
    let mut deleted = 0usize;

    for raw in paths {
        let requested = PathBuf::from(&raw);
        // junction：仅移除链接本身，绝不 canonicalize 解析到库源去删（核心安全点）。
        if is_junction(&requested) {
            match remove_link(&requested) {
                Ok(_) => {
                    deleted += 1;
                    moved_to_trash.push(format!("{raw}（已移除链接，未删库源）"));
                }
                Err(error) => failed.push(format!("{raw}：{error}")),
            }
            continue;
        }
        let Ok(canonical) = requested.canonicalize() else {
            failed.push(format!("{raw}：路径不存在"));
            continue;
        };
        let Some(skill) = allowed.get(&canonical) else {
            failed.push(format!("{raw}：不在已检测 Skill 范围内，已拒绝删除"));
            continue;
        };

        // 删库 skill：先移除所有客户端里指向它的 junction，避免悬空链接。
        if skill.client_id == "library" {
            unlink_library_skill_links(&canonical);
        }

        let leaf = format!(
            "{}-{}-{}",
            ts,
            safe_trash_name(&skill.client_id),
            safe_trash_name(&skill.directory)
        );
        let mut target = trash_root.join(&leaf);
        let mut index = 1usize;
        while target.exists() {
            target = trash_root.join(format!("{leaf}-{index}"));
            index += 1;
        }

        match move_dir_to_trash(&canonical, &target) {
            Ok(_) => {
                deleted += 1;
                moved_to_trash.push(path_to_string(&target));
            }
            Err(error) => failed.push(format!("{}：{}", skill.name, error)),
        }
    }

    Ok(DeleteSkillsResult {
        deleted,
        moved_to_trash,
        failed,
        message: format!("已删除 {deleted} 个 Skill（已移动到 SMRmanager 回收目录）"),
    })
}

/// 项目级 Skill 启用/禁用：在启用区 <proj>/<skillRoot>/<name> 与禁用区
/// <proj>/.smrmanager/disabled/<baseClientId>/<name> 之间移动目录（可逆、对客户端透明）。
#[tauri::command(rename_all = "camelCase")]
pub fn set_project_skill_enabled(
    project_path: String,
    client_id: String,
    skill_dir: String,
    enabled: bool,
) -> Result<String, String> {
    let root = PathBuf::from(&project_path);
    if !root.is_dir() {
        return Err("项目目录不存在".to_string());
    }

    let name = skill_dir.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("非法的 Skill 目录名".to_string());
    }

    // client_id 形如 claude@proj-xxx，取 @ 前的基础 id 定位项目级 skill 根。
    let base_id = client_id.split('@').next().unwrap_or(client_id.as_str());
    let def = build_project_definitions(&root)
        .into_iter()
        .find(|d| d.id == base_id)
        .ok_or_else(|| format!("未知客户端: {client_id}"))?;
    let enabled_root = def
        .skill_dirs
        .first()
        .cloned()
        .ok_or_else(|| format!("{} 在项目级没有 Skills 目录", def.name))?;
    let disabled_root = root.join(".smrmanager").join("disabled").join(base_id);

    if enabled {
        let from = disabled_root.join(name);
        let to = enabled_root.join(name);
        if !from.is_dir() {
            return Err("未找到被禁用的 Skill".to_string());
        }
        if to.exists() {
            return Err("启用区已存在同名 Skill".to_string());
        }
        move_dir_to_trash(&from, &to)?;
        Ok(format!("已启用 {name}"))
    } else {
        let from = enabled_root.join(name);
        let to = disabled_root.join(name);
        if !from.is_dir() {
            return Err("未找到该 Skill".to_string());
        }
        if to.exists() {
            return Err("禁用区已存在同名 Skill".to_string());
        }
        move_dir_to_trash(&from, &to)?;
        Ok(format!("已禁用 {name}"))
    }
}

/// 客户端可写入 Rule 的目录：优先 rule_paths 中的目录型（无扩展名），否则取首个路径的父目录。
fn client_rule_dir(client_id: &str) -> Option<PathBuf> {
    let def = client_definitions().into_iter().find(|d| d.id == client_id)?;
    def.rule_paths
        .iter()
        .find(|p| p.extension().is_none())
        .cloned()
        .or_else(|| {
            def.rule_paths
                .first()
                .and_then(|p| p.parent().map(|parent| parent.to_path_buf()))
        })
}

/// 把一个 Rule 文件复制到目标客户端的 rules 落点目录（同名自动加序号，绝不覆盖）。
#[tauri::command(rename_all = "camelCase")]
pub fn copy_rule_to_client(rule_path: String, target_client_id: String) -> Result<String, String> {
    let src = PathBuf::from(&rule_path);
    if !src.is_file() {
        return Err("源 Rule 文件不存在".to_string());
    }
    let dir = client_rule_dir(&target_client_id)
        .ok_or_else(|| "目标客户端没有可写入的 Rules 目录".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目标目录失败: {e}"))?;
    let file_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "rule.md".to_string());
    let mut dest = dir.join(&file_name);
    let mut index = 1usize;
    while dest.exists() {
        let stem = src
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "rule".to_string());
        let ext = src
            .extension()
            .map(|s| format!(".{}", s.to_string_lossy()))
            .unwrap_or_default();
        dest = dir.join(format!("{stem}-{index}{ext}"));
        index += 1;
    }
    std::fs::copy(&src, &dest).map_err(|e| format!("复制失败: {e}"))?;
    Ok(format!("已复制到 {}", path_to_string(&dest)))
}

/// 删除 Rule 文件：移动到 SMRmanager 回收目录（可恢复），不做真删除。
#[tauri::command]
pub fn delete_rules(paths: Vec<String>) -> Result<DeleteSkillsResult, String> {
    let ts = UNIX_EPOCH
        .elapsed()
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let trash_root = home_dir().join(".smrmanager").join("trash").join("rules");
    std::fs::create_dir_all(&trash_root).ok();
    let mut moved_to_trash = Vec::new();
    let mut failed = Vec::new();
    let mut deleted = 0usize;

    for raw in paths {
        let src = PathBuf::from(&raw);
        if !src.is_file() {
            failed.push(format!("{raw}：文件不存在"));
            continue;
        }
        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "rule".to_string());
        let leaf = format!("{ts}-{}", safe_trash_name(&name));
        let mut target = trash_root.join(&leaf);
        let mut index = 1usize;
        while target.exists() {
            target = trash_root.join(format!("{leaf}-{index}"));
            index += 1;
        }
        let result = std::fs::rename(&src, &target).or_else(|_| {
            std::fs::copy(&src, &target)
                .and_then(|_| std::fs::remove_file(&src))
                .map(|_| ())
        });
        match result {
            Ok(_) => {
                deleted += 1;
                moved_to_trash.push(path_to_string(&target));
            }
            Err(error) => failed.push(format!("{raw}：{error}")),
        }
    }

    Ok(DeleteSkillsResult {
        deleted,
        moved_to_trash,
        failed,
        message: format!("已删除 {deleted} 个 Rule（已移动到 SMRmanager 回收目录）"),
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSpec {
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub url: Option<String>,
}

enum McpFormat {
    Json,
    Toml,
}

/// 可写入 MCP 配置的目标客户端：返回（写入文件、格式、顶层键）。
/// 仅覆盖标准 mcpServers(JSON) 与 codex(TOML)，其余客户端暂不支持以免破坏特殊格式。
fn mcp_write_target(client_id: &str) -> Option<(PathBuf, McpFormat, &'static str)> {
    let home = home_dir();
    let local = local_appdata_dir();
    match client_id {
        "claude" => Some((home.join(".claude.json"), McpFormat::Json, "mcpServers")),
        "claude-desktop" => Some((
            local.join("Claude").join("claude_desktop_config.json"),
            McpFormat::Json,
            "mcpServers",
        )),
        "gemini" => Some((home.join(".gemini").join("settings.json"), McpFormat::Json, "mcpServers")),
        "cursor" => Some((home.join(".cursor").join("mcp.json"), McpFormat::Json, "mcpServers")),
        "trae" => Some((home.join(".trae").join("mcp.json"), McpFormat::Json, "mcpServers")),
        "codex" => Some((home.join(".codex").join("config.toml"), McpFormat::Toml, "mcp_servers")),
        _ => None,
    }
}

fn mcp_entry_json(server: &McpServerSpec) -> Value {
    let mut map = serde_json::Map::new();
    if let Some(cmd) = &server.command {
        map.insert("command".into(), Value::String(cmd.clone()));
        if let Some(args) = &server.args {
            map.insert(
                "args".into(),
                Value::Array(args.iter().map(|a| Value::String(a.clone())).collect()),
            );
        }
    }
    if let Some(url) = &server.url {
        map.insert("url".into(), Value::String(url.clone()));
    }
    Value::Object(map)
}

fn install_mcp_json(path: &Path, key: &str, server: &McpServerSpec) -> Result<(), String> {
    let mut root = if path.exists() {
        let text = std::fs::read_to_string(path).map_err(|e| format!("读取配置失败: {e}"))?;
        if text.trim().is_empty() {
            Value::Object(serde_json::Map::new())
        } else {
            serde_json::from_str::<Value>(&text).map_err(|e| format!("解析配置 JSON 失败: {e}"))?
        }
    } else {
        Value::Object(serde_json::Map::new())
    };
    let Some(obj) = root.as_object_mut() else {
        return Err("配置文件根不是 JSON 对象，已中止以免破坏".to_string());
    };
    let servers = obj
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let Some(servers_obj) = servers.as_object_mut() else {
        return Err(format!("配置中的 {key} 不是对象，已中止"));
    };
    servers_obj.insert(server.name.clone(), mcp_entry_json(server));
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| format!("序列化失败: {e}"))?;
    std::fs::write(path, pretty).map_err(|e| format!("写入配置失败: {e}"))
}

fn install_mcp_toml(path: &Path, key: &str, server: &McpServerSpec) -> Result<(), String> {
    let mut root: toml::Value = if path.exists() {
        let text = std::fs::read_to_string(path).map_err(|e| format!("读取配置失败: {e}"))?;
        if text.trim().is_empty() {
            toml::Value::Table(toml::Table::new())
        } else {
            toml::from_str(&text).map_err(|e| format!("解析配置 TOML 失败: {e}"))?
        }
    } else {
        toml::Value::Table(toml::Table::new())
    };
    let toml::Value::Table(root_table) = &mut root else {
        return Err("配置文件根不是 TOML 表，已中止".to_string());
    };
    if !root_table.contains_key(key) {
        root_table.insert(key.to_string(), toml::Value::Table(toml::Table::new()));
    }
    let Some(toml::Value::Table(servers_table)) = root_table.get_mut(key) else {
        return Err(format!("配置中的 {key} 不是表，已中止"));
    };
    let mut entry = toml::Table::new();
    if let Some(cmd) = &server.command {
        entry.insert("command".into(), toml::Value::String(cmd.clone()));
        if let Some(args) = &server.args {
            entry.insert(
                "args".into(),
                toml::Value::Array(args.iter().map(|a| toml::Value::String(a.clone())).collect()),
            );
        }
    }
    if let Some(url) = &server.url {
        entry.insert("url".into(), toml::Value::String(url.clone()));
    }
    servers_table.insert(server.name.clone(), toml::Value::Table(entry));
    let text = toml::to_string_pretty(&root).map_err(|e| format!("序列化 TOML 失败: {e}"))?;
    std::fs::write(path, text).map_err(|e| format!("写入配置失败: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn install_mcp_server(client_id: String, server: McpServerSpec) -> Result<String, String> {
    let Some((path, format, key)) = mcp_write_target(&client_id) else {
        return Err("暂不支持向该客户端写入 MCP 配置".to_string());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    match format {
        McpFormat::Json => install_mcp_json(&path, key, &server)?,
        McpFormat::Toml => install_mcp_toml(&path, key, &server)?,
    }
    Ok(format!("已将 MCP「{}」写入 {}", server.name, path_to_string(&path)))
}

const MCP_WRITABLE_CLIENTS: [&str; 6] = ["claude", "claude-desktop", "gemini", "cursor", "trae", "codex"];

/// 真禁用：在活动键(active_key)与停用键(active_key+Disabled)之间移动 MCP server。
/// 客户端会忽略未知的停用键，从而真正不加载该 server；启用时再移回。only=Some 只动该项，None 动全部。
fn json_toggle_mcp(path: &Path, active_key: &str, only: Option<&str>, enabled: bool) -> Result<usize, String> {
    if !path.exists() {
        return Ok(0);
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("读取配置失败: {e}"))?;
    if text.trim().is_empty() {
        return Ok(0);
    }
    let mut root: Value = serde_json::from_str(&text).map_err(|e| format!("解析配置 JSON 失败: {e}"))?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(0);
    };
    let disabled_key = format!("{active_key}Disabled");
    let src_key = if enabled { disabled_key.clone() } else { active_key.to_string() };
    let dst_key = if enabled { active_key.to_string() } else { disabled_key.clone() };

    let mut moved: Vec<(String, Value)> = Vec::new();
    if let Some(src) = obj.get_mut(&src_key).and_then(|v| v.as_object_mut()) {
        let names: Vec<String> = src
            .keys()
            .filter(|k| only.map(|t| t == k.as_str()).unwrap_or(true))
            .cloned()
            .collect();
        for name in names {
            if let Some(mut value) = src.remove(&name) {
                if let Some(entry) = value.as_object_mut() {
                    entry.insert("enabled".to_string(), Value::Bool(enabled));
                }
                moved.push((name, value));
            }
        }
    }
    let count = moved.len();
    if count == 0 {
        return Ok(0);
    }
    if obj.get(&src_key).and_then(|v| v.as_object()).map(|m| m.is_empty()).unwrap_or(false) {
        obj.remove(&src_key);
    }
    let dst = obj.entry(dst_key).or_insert_with(|| Value::Object(serde_json::Map::new()));
    if let Some(dst_obj) = dst.as_object_mut() {
        for (name, value) in moved {
            dst_obj.insert(name, value);
        }
    }
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| format!("序列化失败: {e}"))?;
    std::fs::write(path, pretty).map_err(|e| format!("写入配置失败: {e}"))?;
    Ok(count)
}

fn toml_toggle_mcp(path: &Path, active_key: &str, only: Option<&str>, enabled: bool) -> Result<usize, String> {
    if !path.exists() {
        return Ok(0);
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("读取配置失败: {e}"))?;
    if text.trim().is_empty() {
        return Ok(0);
    }
    let mut root: toml::Value = toml::from_str(&text).map_err(|e| format!("解析配置 TOML 失败: {e}"))?;
    let toml::Value::Table(root_table) = &mut root else {
        return Ok(0);
    };
    let disabled_key = format!("{active_key}_disabled");
    let src_key = if enabled { disabled_key.clone() } else { active_key.to_string() };
    let dst_key = if enabled { active_key.to_string() } else { disabled_key.clone() };

    let mut moved: Vec<(String, toml::Value)> = Vec::new();
    if let Some(toml::Value::Table(src)) = root_table.get_mut(&src_key) {
        let names: Vec<String> = src
            .keys()
            .filter(|k| only.map(|t| t == k.as_str()).unwrap_or(true))
            .cloned()
            .collect();
        for name in names {
            if let Some(mut value) = src.remove(&name) {
                if let toml::Value::Table(table) = &mut value {
                    table.insert("enabled".to_string(), toml::Value::Boolean(enabled));
                }
                moved.push((name, value));
            }
        }
    }
    let count = moved.len();
    if count == 0 {
        return Ok(0);
    }
    if root_table.get(&src_key).and_then(|v| v.as_table()).map(|t| t.is_empty()).unwrap_or(false) {
        root_table.remove(&src_key);
    }
    if !root_table.contains_key(&dst_key) {
        root_table.insert(dst_key.clone(), toml::Value::Table(toml::Table::new()));
    }
    if let Some(toml::Value::Table(dst_table)) = root_table.get_mut(&dst_key) {
        for (name, value) in moved {
            dst_table.insert(name, value);
        }
    }
    let out = toml::to_string_pretty(&root).map_err(|e| format!("序列化 TOML 失败: {e}"))?;
    std::fs::write(path, out).map_err(|e| format!("写入配置失败: {e}"))?;
    Ok(count)
}

fn set_enabled_in_target(client_id: &str, only: Option<&str>, enabled: bool) -> Result<usize, String> {
    let Some((path, format, key)) = mcp_write_target(client_id) else {
        return Ok(0);
    };
    match format {
        McpFormat::Json => json_toggle_mcp(&path, key, only, enabled),
        McpFormat::Toml => toml_toggle_mcp(&path, key, only, enabled),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_mcp_enabled(client_id: String, name: String, enabled: bool) -> Result<String, String> {
    if mcp_write_target(&client_id).is_none() {
        return Err("暂不支持修改该客户端的 MCP 配置".to_string());
    }
    let changed = set_enabled_in_target(&client_id, Some(&name), enabled)?;
    if changed == 0 {
        return Err(format!("未在配置中找到 MCP「{name}」"));
    }
    Ok(format!("已{}「{name}」", if enabled { "启用" } else { "禁用" }))
}

#[tauri::command]
pub fn set_all_mcp_enabled(enabled: bool) -> Result<String, String> {
    let mut total = 0usize;
    let mut failed = Vec::new();
    for client_id in MCP_WRITABLE_CLIENTS {
        match set_enabled_in_target(client_id, None, enabled) {
            Ok(count) => total += count,
            Err(error) => failed.push(format!("{client_id}: {error}")),
        }
    }
    if !failed.is_empty() {
        return Err(failed.join("；"));
    }
    Ok(format!("已{}全部 {total} 个 MCP", if enabled { "启用" } else { "禁用" }))
}

#[tauri::command(rename_all = "camelCase")]
pub fn launch_client(client_id: String) -> Result<(), String> {
    let definitions = client_definitions();
    let Some(definition) = definitions.into_iter().find(|item| item.id == client_id) else {
        return Err(format!("未知客户端: {client_id}"));
    };
    let Some(executable) = first_existing_executable(&definition) else {
        return Err(format!("未找到可启动程序: {}", definition.name));
    };

    // Windows 下用 start 交给 Shell，避免阻塞并支持 .cmd / GUI exe。
    #[cfg(windows)]
    {
        Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(&executable)
            .spawn()
            .map_err(|e| format!("启动 {} 失败: {e}", definition.name))?;
    }

    #[cfg(not(windows))]
    {
        Command::new(&executable)
            .spawn()
            .map_err(|e| format!("启动 {} 失败: {e}", definition.name))?;
    }

    Ok(())
}

fn now_secs_string() -> String {
    UNIX_EPOCH
        .elapsed()
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

/// 在系统资源管理器/默认程序中打开文件或目录（复用 Shell start，无需额外插件）。
#[tauri::command]
pub fn open_path(target: String) -> Result<(), String> {
    // http(s) 链接交给系统默认浏览器打开（「前往安装」跳转官网用）；其余按本地路径处理。
    let lower = target.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        #[cfg(windows)]
        {
            Command::new("cmd")
                .args(["/C", "start", "", &target])
                .spawn()
                .map_err(|e| format!("打开链接失败: {e}"))?;
        }
        #[cfg(not(windows))]
        {
            Command::new("xdg-open")
                .arg(&target)
                .spawn()
                .map_err(|e| format!("打开链接失败: {e}"))?;
        }
        return Ok(());
    }

    let path = PathBuf::from(&target);
    if !path.exists() {
        return Err(format!("路径不存在: {target}"));
    }
    #[cfg(windows)]
    {
        // explorer 对文件会选中、对目录会打开；用 /select 选中文件更直观。
        if path.is_dir() {
            Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("打开失败: {e}"))?;
        } else {
            Command::new("explorer")
                .arg("/select,")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("打开失败: {e}"))?;
        }
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn export_client_config(client_id: String, target_dir: String) -> Result<String, String> {
    let definitions = client_definitions();
    let Some(definition) = definitions.iter().find(|item| item.id == client_id) else {
        return Err(format!("未知客户端: {client_id}"));
    };
    let target = PathBuf::from(&target_dir);
    std::fs::create_dir_all(&target).map_err(|e| format!("创建导出目录失败: {e}"))?;
    let mut count = 0usize;
    for path in existing_paths(&definition.config_candidates) {
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "config".to_string());
        let dest = target.join(format!("{}-{}", definition.id, name));
        std::fs::copy(&path, &dest).map_err(|e| format!("复制 {} 失败: {e}", path_to_string(&path)))?;
        count += 1;
    }
    if count == 0 {
        return Err("未找到可导出的配置文件".to_string());
    }
    Ok(format!("已导出 {count} 个配置文件到 {}", path_to_string(&target)))
}

#[tauri::command(rename_all = "camelCase")]
pub fn import_client_config(client_id: String, source_file: String) -> Result<String, String> {
    let definitions = client_definitions();
    let Some(definition) = definitions.iter().find(|item| item.id == client_id) else {
        return Err(format!("未知客户端: {client_id}"));
    };
    let source = PathBuf::from(&source_file);
    if !source.is_file() {
        return Err("源配置文件不存在".to_string());
    }
    let Some(dest) = definition.config_candidates.first() else {
        return Err(format!("{} 未配置可写入的配置路径", definition.name));
    };
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    std::fs::copy(&source, dest).map_err(|e| format!("导入失败: {e}"))?;
    Ok(format!("已导入配置到 {}", path_to_string(dest)))
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_client_config(client_id: String) -> Result<String, String> {
    let definitions = client_definitions();
    let Some(definition) = definitions.iter().find(|item| item.id == client_id) else {
        return Err(format!("未知客户端: {client_id}"));
    };
    let files = existing_paths(&definition.config_candidates);
    if files.is_empty() {
        return Err("未找到可删除的配置文件".to_string());
    }
    let trash = home_dir()
        .join(".smrmanager")
        .join("config-trash")
        .join(format!("{}-{}", definition.id, now_secs_string()));
    std::fs::create_dir_all(&trash).map_err(|e| format!("创建回收目录失败: {e}"))?;
    let mut count = 0usize;
    for path in files {
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "config".to_string());
        let dest = trash.join(&name);
        if std::fs::rename(&path, &dest).is_err() {
            std::fs::copy(&path, &dest).map_err(|e| format!("复制 {} 失败: {e}", path_to_string(&path)))?;
            std::fs::remove_file(&path).map_err(|e| format!("移除 {} 失败: {e}", path_to_string(&path)))?;
        }
        count += 1;
    }
    Ok(format!("已删除 {count} 个配置文件（已移到回收目录，可在 {} 恢复）", path_to_string(&trash)))
}
