// 静态目录数据（从 main.ts 抽出）：导航项、客户端清单、市场内置项。
import type { Client, MarketSkill, MarketMcp } from "./types";

export const navItems = [
  ["全局", "client", "clients"],
  ["项目", "project", "project"],
  ["Skills 管理", "skills", "skills"],
  ["WSL 管理", "wsl", "wsl"],
  ["MCP 管理", "mcp", "mcp"],
  ["Rules 管理", "rules", "rules"],
  ["市场", "market", "market"],
  ["设置", "settings", "settings"]
] as const;

export const clients: Client[] = [
  {
    id: "claude",
    name: "Claude Code",
    type: "CLI 工具",
    fallbackPath: "PATH: claude / ~/.claude.json",
    description: "Anthropic Claude Code / Claude CLI，独立于 Claude Desktop",
    iconFile: "/client-icons/claude.svg",
    installUrl: "https://docs.anthropic.com/en/docs/claude-code/setup"
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    type: "桌面应用",
    fallbackPath: "%LOCALAPPDATA%\\Claude\\claude_desktop_config.json",
    description: "Anthropic Claude Desktop，和 Claude Code/CLI 分开检测",
    iconFile: "/client-icons/claude.svg",
    installUrl: "https://claude.ai/download"
  },
  {
    id: "codex",
    name: "Codex",
    type: "CLI 工具",
    fallbackPath: "%USERPROFILE%\\.codex\\config.toml",
    description: "OpenAI Codex CLI，读取 ~/.codex/config.toml 与 ~/.codex/skills",
    iconFile: "/client-icons/openai.svg",
    installUrl: "https://developers.openai.com/codex"
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    type: "CLI 工具",
    fallbackPath: "%USERPROFILE%\\.gemini\\settings.json",
    description: "Google Gemini CLI，读取 ~/.gemini/settings.json 与 ~/.gemini/skills",
    iconFile: "/client-icons/gemini.svg",
    installUrl: "https://github.com/google-gemini/gemini-cli"
  },
  {
    id: "opencode",
    name: "OpenCode",
    type: "CLI 工具",
    fallbackPath: "%USERPROFILE%\\.config\\opencode\\opencode.json",
    description: "OpenCode CLI，本地 AI 编程 Agent",
    iconFile: "/client-icons/opencode-logo-light.svg",
    installUrl: "https://opencode.ai/"
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    type: "CLI 工具",
    fallbackPath: "%USERPROFILE%\\.openclaw\\openclaw.json",
    description: "OpenClaw Agent，读取 ~/.openclaw/openclaw.json 与 ~/.openclaw/skills",
    iconFile: "/client-icons/claw.svg",
    installUrl: "https://github.com/openclaw/openclaw"
  },
  {
    id: "hermes",
    name: "Hermes",
    type: "CLI 工具",
    fallbackPath: "%USERPROFILE%\\.hermes\\config.yaml",
    description: "Hermes Agent，读取 ~/.hermes/config.yaml 与 ~/.hermes/skills",
    iconFile: "/client-icons/hermes.png",
    installUrl: "https://github.com/NousResearch/hermes-agent"
  },
  {
    id: "cursor",
    name: "Cursor",
    type: "开发工具",
    fallbackPath: "%LOCALAPPDATA%\\Programs\\Cursor\\Cursor.exe",
    description: "面向开发者的 AI 代码编辑器",
    iconFile: "/client-icons/cursor.svg",
    installUrl: "https://cursor.com/downloads"
  },
  {
    id: "vscode",
    name: "VS Code",
    type: "开发工具",
    fallbackPath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
    description: "Visual Studio Code 扩展集成",
    iconFile: "/client-icons/vscode.svg",
    installUrl: "https://code.visualstudio.com/download"
  },
  {
    id: "trae",
    name: "Trae",
    type: "开发工具",
    fallbackPath: "%LOCALAPPDATA%\\Programs\\Trae\\Trae.exe",
    description: "Trae AI IDE，支持 MCP 与 Skills 扩展",
    iconFile: "/client-icons/trae.png",
    installUrl: "https://www.trae.ai/download"
  },
  {
    id: "qoderworkcn",
    name: "QoderWork CN",
    type: "AI 工作台",
    fallbackPath: "%USERPROFILE%\\.qoderworkcn\\awareness\\main",
    description: "阿里 QoderWork 国内版，管理 ~/.qoderworkcn/awareness/main 下的 AGENTS/SOUL/USER",
    iconFile: "/client-icons/qoderwork.svg",
    installUrl: "https://qoder.com.cn/qoderwork"
  },
  {
    id: "zcode",
    name: "Z Code",
    type: "AI 代码编辑器",
    fallbackPath: "%USERPROFILE%\\.zcode\\AGENTS.md",
    description: "智谱 Z Code 轻量级 AI 代码编辑器，管理 ~/.zcode/AGENTS.md",
    iconFile: "/client-icons/zcode.svg",
    installUrl: "https://zcode-ai.com"
  },
  {
    id: "workbuddy",
    name: "WorkBuddy",
    type: "AI 工作台",
    fallbackPath: "%USERPROFILE%\\.workbuddy",
    description: "腾讯 CodeBuddy 旗下 WorkBuddy，管理 ~/.workbuddy 下的 IDENTITY/SOUL/USER",
    iconFile: "/client-icons/workbuddy.svg",
    installUrl: "https://www.codebuddy.cn/work/"
  }
];

export const availableMcps = [
  ["Database", "数据库查询与管理", "openai.svg", "slate"],
  ["Brave Search", "Brave 搜索集成", "openrouter.svg", "slate"],
  ["Time", "时间和时区操作", "gemini.svg", "slate"],
  ["Memory", "持久化记忆存储", "anthropic.svg", "slate"]
] as const;

export const marketSkills: MarketSkill[] = [
  {
    id: "trellis",
    name: "Trellis",
    description: "多 AI coding 平台的一站式规范、任务、Hook 与 Skill 工作流。",
    category: "规划规范",
    tone: "green",
    rating: "5.0",
    installs: "2.3k",
    repo: "mindfold-ai/Trellis",
    iconFile: "/skill-icons/trellis.svg",
    supportedClients: ["claude", "codex", "cursor", "gemini", "opencode"],
    methods: [
      { id: "npm", label: "npm", detail: "npm install -g @mindfoldhq/trellis@latest", packageName: "@mindfoldhq/trellis@latest" },
      { id: "pnpm", label: "pnpm", detail: "pnpm add -g @mindfoldhq/trellis@latest", packageName: "@mindfoldhq/trellis@latest" }
    ]
  },
  {
    id: "openspec",
    name: "OpenSpec",
    description: "轻量级 SDD 工作流，沉淀 proposal、spec、design 和 tasks。",
    category: "规划规范",
    tone: "purple",
    rating: "5.0",
    installs: "1.8k",
    repo: "Fission-AI/OpenSpec",
    iconFile: "github-openspec.svg",
    supportedClients: ["claude", "codex", "cursor", "gemini"],
    methods: [
      { id: "npm", label: "npm", detail: "npm install -g @fission-ai/openspec@latest", packageName: "@fission-ai/openspec@latest" },
      { id: "pnpm", label: "pnpm", detail: "pnpm add -g @fission-ai/openspec@latest", packageName: "@fission-ai/openspec@latest" }
    ]
  }
];

export const marketMcps: MarketMcp[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "让 AI 安全地读写本地指定目录的文件（默认当前目录，可在配置中调整路径）。",
    iconFile: "anthropic.svg",
    tone: "blue",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "抓取网页内容并转为 Markdown 供 AI 阅读。",
    iconFile: "openai.svg",
    tone: "cyan",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"]
  }
];
