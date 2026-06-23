import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import "./day-night-toggle";
import "./styles.css";

type ViewName = "clients" | "skills" | "mcp" | "rules" | "market" | "settings";
type ClientTab = "skills" | "mcp" | "rules" | "settings";
type ThemeName = "light" | "dark";
type ThemeMode = "light" | "dark" | "system";
type InstallMethodId = "npm" | "npx" | "pnpm" | "github" | "json";
type SkillTransferAction = "copy" | "move";

type Client = {
  id: string;
  name: string;
  type: string;
  fallbackPath: string;
  description: string;
  iconFile: string;
  installUrl: string;
};

type RuntimeClient = {
  id: string;
  name: string;
  product: string;
  type: string;
  description: string;
  installed: boolean;
  executablePath?: string | null;
  configPaths: string[];
  detectedConfigPaths: string[];
  installUrl: string;
  mcpCount: number;
  skillsCount: number;
  rolesCount: number;
  updatedAt?: string | null;
  statusMessage: string;
};

type RuntimeMcpServer = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  sourcePath: string;
  transport: string;
  command?: string | null;
  url?: string | null;
  enabled: boolean;
};

type RuntimeSkill = {
  directory: string;
  name: string;
  description?: string | null;
  clientId: string;
  clientName: string;
  path: string;
  managed: boolean;
  updatedAt?: string | null;
};

type RuntimeRule = {
  name: string;
  clientId: string;
  clientName: string;
  path: string;
  kind: string;
  source: string;
  preview?: string | null;
  managed: boolean;
  updatedAt?: string | null;
};

type DetectionSnapshot = {
  clients: RuntimeClient[];
  mcpServers: RuntimeMcpServer[];
  skills: RuntimeSkill[];
  rules: RuntimeRule[];
  scannedAt: string;
};

type InstallMethod = {
  id: InstallMethodId;
  label: string;
  detail: string;
  packageName?: string;
  args?: string[];
  repository?: string;
  subdir?: string;
  registryUrl?: string;
  manifestUrl?: string;
};

type MarketSkill = {
  id: string;
  name: string;
  description: string;
  category: string;
  tone: string;
  rating: string;
  installs: string;
  repo: string;
  iconFile: string;
  supportedClients: string[];
  methods: InstallMethod[];
};

type MarketMcp = {
  id: string;
  name: string;
  description: string;
  iconFile: string;
  tone: string;
  transport: string;
  command?: string;
  args?: string[];
  url?: string;
};

type InstallResult = {
  success: boolean;
  message: string;
  log: string;
  installedPath?: string | null;
};

type DeleteSkillsResult = {
  deleted: number;
  movedToTrash: string[];
  failed: string[];
  message: string;
};

type TransferSkillsResult = {
  copied: number;
  moved: number;
  targetClientId: string;
  targetClientName: string;
  targetRoot: string;
  writtenPaths: string[];
  failed: string[];
  message: string;
};

type ImportSkillResult = {
  imported: boolean;
  targetClientId: string;
  targetClientName: string;
  targetPath: string;
  message: string;
};

type ImportSkillDialogState = {
  sourceDir: string;
  targetClientId: string;
};

type MarketInstallDialogState = {
  skillId: string;
  methodId: string;
  targetClientId: string;
};

type McpInstallDialogState = {
  mcpId: string;
  targetClientId: string;
};

type SkillContextMenuState = {
  key: string;
  path: string;
  x: number;
  y: number;
};

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  paths: string[];
  kind?: "skills" | "client";
  clientId?: string;
};

type AppUpdateCheckResult = {
  currentVersion: string;
  latestVersion?: string | null;
  available: boolean;
  notes?: string | null;
  pubDate?: string | null;
  releaseUrl?: string | null;
  downloadUrl?: string | null;
  sourceUrl: string;
  checkedAt: string;
};

type HotState = {
  activeClientIndex?: number;
  activeClientTab?: ClientTab;
  currentView?: ViewName;
  themeMode?: ThemeMode;
  environment?: DetectionSnapshot | null;
  detectionError?: string | null;
  installLogs?: Record<string, string>;
  selectedSkillKeys?: string[];
  skillBulkTargetId?: string;
  skillQuery?: string;
  skillClientFilter?: string;
  skillStatusFilter?: string;
  updateInfo?: AppUpdateCheckResult | null;
  updateError?: string | null;
  updateChecking?: boolean;
};

const navItems = [
  ["客户端", "client", "clients"],
  ["Skills 管理", "skills", "skills"],
  ["MCP 管理", "mcp", "mcp"],
  ["Rules 管理", "rules", "rules"],
  ["市场", "market", "market"],
  ["设置", "settings", "settings"]
] as const;

const clients: Client[] = [
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
    installUrl: "https://github.com/ShareAI-Lab/openclaw"
  },
  {
    id: "hermes",
    name: "Hermes",
    type: "CLI 工具",
    fallbackPath: "%USERPROFILE%\\.hermes\\config.yaml",
    description: "Hermes Agent，读取 ~/.hermes/config.yaml 与 ~/.hermes/skills",
    iconFile: "/client-icons/hermes.png",
    installUrl: "https://github.com/Experience-Monks/hermes"
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
  }
];

const availableMcps = [
  ["Database", "数据库查询与管理", "openai.svg", "slate"],
  ["Brave Search", "Brave 搜索集成", "openrouter.svg", "slate"],
  ["Time", "时间和时区操作", "gemini.svg", "slate"],
  ["Memory", "持久化记忆存储", "anthropic.svg", "slate"]
] as const;

const marketSkills: MarketSkill[] = [
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
  },
  /* 市场暂时只保留前两个 Skill（Trellis / OpenSpec），其余先注释掉：
  {
    id: "grill-me",
    supportedClients: ["claude", "codex", "cursor"],
    name: "Grill Me",
    description: "让 Agent 在动手前持续追问，压实需求、边界和风险。",
    category: "生产力",
    tone: "pink",
    rating: "4.8",
    installs: "3.1k",
    repo: "mattpocock/skills",
    iconFile: "github-mattpocock.png",
    methods: [
      { id: "npx", label: "npx", detail: "npx -y skills@latest add mattpocock/skills --skill grill-me --agent codex --global --yes", packageName: "skills@latest", args: ["add", "mattpocock/skills", "--skill", "grill-me", "--agent", "codex", "--global", "--yes"] }
    ]
  },
  {
    id: "grill-with-docs",
    supportedClients: ["claude", "codex", "cursor"],
    name: "Grill With Docs",
    description: "需求拷问同时沉淀领域模型、术语、CONTEXT 和 ADR。",
    category: "文档知识",
    tone: "green",
    rating: "4.7",
    installs: "1.2k",
    repo: "mattpocock/skills",
    iconFile: "github-mattpocock.png",
    methods: [{ id: "npx", label: "npx", detail: "npx -y skills@latest add mattpocock/skills --skill grill-with-docs --agent codex --global --yes", packageName: "skills@latest", args: ["add", "mattpocock/skills", "--skill", "grill-with-docs", "--agent", "codex", "--global", "--yes"] }]
  },
  {
    id: "tdd",
    supportedClients: ["claude", "codex", "cursor"],
    name: "TDD",
    description: "红绿重构循环，让功能修复以可验证纵向切片交付。",
    category: "调试测试",
    tone: "teal",
    rating: "4.6",
    installs: "856",
    repo: "mattpocock/skills",
    iconFile: "github-mattpocock.png",
    methods: [{ id: "npx", label: "npx", detail: "npx -y skills@latest add mattpocock/skills --skill tdd --agent codex --global --yes", packageName: "skills@latest", args: ["add", "mattpocock/skills", "--skill", "tdd", "--agent", "codex", "--global", "--yes"] }]
  },
  {
    id: "diagnosing-bugs",
    supportedClients: ["claude", "codex", "cursor"],
    name: "Diagnosing Bugs",
    description: "复杂 Bug 的复现、最小化、假设、插桩和回归闭环。",
    category: "调试测试",
    tone: "red",
    rating: "4.5",
    installs: "1.5k",
    repo: "mattpocock/skills",
    iconFile: "github-mattpocock.png",
    methods: [{ id: "npx", label: "npx", detail: "npx -y skills@latest add mattpocock/skills --skill diagnosing-bugs --agent codex --global --yes", packageName: "skills@latest", args: ["add", "mattpocock/skills", "--skill", "diagnosing-bugs", "--agent", "codex", "--global", "--yes"] }]
  }
  */
];

const marketMcps: MarketMcp[] = [
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

const themeStorageKey = "smrmanager-theme";
const dismissedUpdateStorageKey = "smrmanager-update-dismissed-version";
const hotState = import.meta.hot?.data as HotState | undefined;
const hotView = hotState?.currentView as ViewName | "roles" | undefined;
let activeClientIndex = hotState?.activeClientIndex ?? 0;
let activeClientTab: ClientTab = hotState?.activeClientTab ?? "skills";
let currentView: ViewName = hotView === "roles" ? "rules" : hotView ?? "clients";
let themeMode: ThemeMode = hotState?.themeMode ?? readStoredThemeMode();
let currentTheme: ThemeName = resolveTheme(themeMode);
let environment: DetectionSnapshot | null = hotState?.environment ?? null;
let detectionLoading = false;
let detectionError: string | null = hotState?.detectionError ?? null;
let installingKey: string | null = null;
let installLogs: Record<string, string> = hotState?.installLogs ?? {};
let installedMarketSkillIds = new Set<string>();
let selectedSkillKeys = new Set<string>(hotState?.selectedSkillKeys ?? []);
let skillBulkTargetId = hotState?.skillBulkTargetId ?? "";
let skillContextMenu: SkillContextMenuState | null = null;
let clientMenuOpen = false;
let confirmDialog: ConfirmDialogState | null = null;
let importSkillDialog: ImportSkillDialogState | null = null;
let marketInstallDialog: MarketInstallDialogState | null = null;
let marketTab: "skill" | "mcp" = "skill";
let mcpQuery = "";
let mcpSort: "name" | "transport" = "name";
let marketSkillQuery = "";
let marketSkillSort: "name" | "rating" = "name";
let marketSkillCategory = "全部";
let mcpInstallDialog: McpInstallDialogState | null = null;
let skillTransferBusy = false;
let skillQuery = hotState?.skillQuery ?? "";
let skillClientFilter = hotState?.skillClientFilter ?? "all";
let skillStatusFilter = hotState?.skillStatusFilter ?? "all";
let skillGridView = false;
let skillPage = 1;
let rulePage = 1;
let listPageSize = 10;
let skillActionMessageTimer: number | null = null;
let deleteBusy = false;
let updateInfo: AppUpdateCheckResult | null = hotState?.updateInfo ?? null;
let updateError: string | null = hotState?.updateError ?? null;
let updateChecking = hotState?.updateChecking ?? false;

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("App root element not found.");
const appRoot: HTMLDivElement = appElement;

function readStoredThemeMode(): ThemeMode {
  const stored = localStorage.getItem(themeStorageKey);
  if (stored === "dark" || stored === "light" || stored === "system") return stored;
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function resolveTheme(mode: ThemeMode): ThemeName {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

function html(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function iconPath(file: string, folder: "vendor-icons" | "skill-icons"): string {
  if (file.startsWith("/")) return file;
  if (file.includes("/")) return `/${file.replace(/^\/+/, "")}`;
  return `/${folder}/${file}`;
}

function img(file: string, alt: string, folder: "vendor-icons" | "skill-icons" = "vendor-icons"): string {
  return `<img src="${html(iconPath(file, folder))}" alt="${html(alt)}" />`;
}

// 统一的描边 SVG 图标（替换难看的文本符号箭头）。
function svgIcon(name: string, size = 16): string {
  const paths: Record<string, string> = {
    "chevron-down": `<path d="m6 9 6 6 6-6"/>`,
    "chevron-left": `<path d="m15 18-6-6 6-6"/>`,
    "chevron-right": `<path d="m9 18 6-6-6-6"/>`,
    refresh: `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`,
    search: `<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>`,
    plus: `<path d="M12 5v14M5 12h14"/>`,
    download: `<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>`,
    more: `<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>`
  };
  return `<svg class="svg-icon" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ""}</svg>`;
}

function runtime(client: Client): RuntimeClient | undefined {
  return environment?.clients.find((item) => item.id === client.id);
}

function clientMcps(clientId: string): RuntimeMcpServer[] {
  return environment?.mcpServers.filter((item) => item.clientId === clientId) ?? [];
}

function clientSkills(clientId: string): RuntimeSkill[] {
  return (environment?.skills ?? [])
    .filter((item) => item.clientId === clientId)
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
}

function clientRules(clientId: string): RuntimeRule[] {
  return (environment?.rules ?? [])
    .filter((item) => item.clientId === clientId)
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
}

function installedClients(): RuntimeClient[] {
  return environment?.clients.filter((item) => item.installed) ?? [];
}

const skillWritableClientIds = new Set(["claude", "claude-desktop", "codex", "gemini", "opencode", "openclaw", "hermes", "cursor", "trae"]);

function skillTargetClients(sourceClientId?: string): RuntimeClient[] {
  const configuredOrder = new Map(clients.map((client, index) => [client.id, index]));
  return installedClients()
    .filter(
      (client) =>
        skillWritableClientIds.has(client.id) &&
        client.id !== sourceClientId &&
        Boolean(client.executablePath || client.detectedConfigPaths.length > 0 || client.skillsCount > 0)
    )
    .sort((a, b) => (configuredOrder.get(a.id) ?? 999) - (configuredOrder.get(b.id) ?? 999));
}

function skillByPath(path: string): RuntimeSkill | undefined {
  return environment?.skills.find((skill) => skill.path === path);
}

function skillKey(skill: RuntimeSkill): string {
  return `${skill.clientId}::${skill.path}`;
}

function selectedPathsFromKeys(): string[] {
  const paths = new Set<string>();
  for (const skill of environment?.skills ?? []) {
    if (selectedSkillKeys.has(skillKey(skill))) paths.add(skill.path);
  }
  return [...paths];
}

function transferPathsForContext(key: string, path: string): string[] {
  if (currentView === "skills" && selectedSkillKeys.has(key) && selectedSkillKeys.size > 1) {
    return selectedPathsFromKeys();
  }
  return [path];
}

function preferredSkillTargetId(targets: RuntimeClient[]): string {
  if (targets.some((client) => client.id === skillBulkTargetId)) return skillBulkTargetId;
  return targets[0]?.id ?? "";
}

function clientNameById(id: string): string {
  return clients.find((client) => client.id === id)?.name ?? id;
}

// 市场 skill 的可安装目标：该 skill 支持 ∩ 已安装且可写入 Skills 的客户端。
function marketSkillTargets(skill: MarketSkill): RuntimeClient[] {
  const supported = new Set(skill.supportedClients);
  return skillTargetClients().filter((client) => supported.has(client.id));
}

// 可写入 MCP 配置的已安装客户端（与后端 mcp_write_target 对齐）。
const mcpWritableClientIds = new Set(["claude", "claude-desktop", "gemini", "cursor", "trae", "codex"]);

function mcpTargetClients(): RuntimeClient[] {
  const order = new Map(clients.map((client, index) => [client.id, index]));
  return installedClients()
    .filter((client) => mcpWritableClientIds.has(client.id))
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}

function epoch(value?: string | null): string {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toLocaleString() : "—";
}

function updateTimestamp(value?: string | null): string {
  if (!value) return "—";
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toLocaleString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function isUpdateDismissed(): boolean {
  const version = updateInfo?.latestVersion;
  return Boolean(version && localStorage.getItem(dismissedUpdateStorageKey) === version);
}

function visibleUpdateAvailable(): boolean {
  return Boolean(updateInfo?.available && updateInfo.latestVersion && !isUpdateDismissed());
}

async function loadEnvironment(force = false): Promise<void> {
  if (detectionLoading && !force) return;
  detectionLoading = true;
  renderApp();
  try {
    environment = await invoke<DetectionSnapshot>("detect_environment");
    detectionError = null;
    const selected = clients[activeClientIndex] ?? clients[0];
    const firstInstalled = clients.findIndex((item) => runtime(item)?.installed);
    if (!runtime(selected)?.installed && firstInstalled >= 0) activeClientIndex = firstInstalled;
  } catch (error) {
    detectionError = error instanceof Error ? error.message : String(error);
  } finally {
    detectionLoading = false;
    renderApp();
  }
}

async function checkUpdates(manual = false): Promise<void> {
  if (updateChecking) return;
  updateChecking = true;
  if (manual) updateError = null;
  renderApp();
  try {
    updateInfo = await invoke<AppUpdateCheckResult>("check_app_update", { endpoint: null });
    updateError = null;
  } catch (error) {
    updateError = error instanceof Error ? error.message : String(error);
    if (manual) updateInfo = null;
  } finally {
    updateChecking = false;
    renderApp();
  }
}

type ToastType = "info" | "success" | "error";
let activeToast: HTMLElement | null = null;

function ensureToastStack(): HTMLElement {
  let stack = document.getElementById("toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

function createToast(message: string, type: ToastType): HTMLElement {
  const stack = ensureToastStack();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const iconEl = document.createElement("span");
  iconEl.className = "toast-icon";
  iconEl.textContent = type === "success" ? "✓" : type === "error" ? "!" : "↻";
  const textEl = document.createElement("span");
  textEl.className = "toast-text";
  textEl.textContent = message;
  toast.append(iconEl, textEl);
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  return toast;
}

function dismissToast(toast: HTMLElement): void {
  toast.classList.remove("is-visible");
  window.setTimeout(() => toast.remove(), 220);
}

function toastTypeForMessage(message: string): ToastType {
  if (/失败|错误|拒绝/.test(message)) return "error";
  if (/完成|成功|已复制|已删除|已移动|已启用|已禁用|已写入|已导入|已安装/.test(message)) return "success";
  return "info";
}

// 浮层 toast：独立于 renderApp，避免反馈时触发整页重建/列表抖动。
// 始终只保留一个 toast，新消息替换旧的，避免连续操作时多个 toast 叠加。
function setSkillActionMessage(message: string | null, timeoutMs = 2600): void {
  if (skillActionMessageTimer !== null) {
    window.clearTimeout(skillActionMessageTimer);
    skillActionMessageTimer = null;
  }
  if (activeToast) {
    dismissToast(activeToast);
    activeToast = null;
  }
  if (!message) return;
  const toast = createToast(message, toastTypeForMessage(message));
  activeToast = toast;
  if (timeoutMs > 0) {
    skillActionMessageTimer = window.setTimeout(() => {
      dismissToast(toast);
      if (activeToast === toast) activeToast = null;
      skillActionMessageTimer = null;
    }, timeoutMs);
  }
}

async function deleteSkills(paths: string[]): Promise<void> {
  const uniquePaths = [...new Set(paths)].filter(Boolean);
  if (uniquePaths.length === 0 || deleteBusy) return;
  deleteBusy = true;
  setSkillActionMessage(`正在删除 ${uniquePaths.length} 个 Skill...`, 0);
  try {
    const result = await invoke<DeleteSkillsResult>("delete_skills", { paths: uniquePaths });
    const removedPaths = new Set(uniquePaths);
    for (const key of [...selectedSkillKeys]) {
      if (removedPaths.has(key.slice(key.indexOf("::") + 2))) selectedSkillKeys.delete(key);
    }
    const failedText = result.failed.length ? `；失败 ${result.failed.length} 个：${result.failed.join(" / ")}` : "";
    deleteBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`${result.message}${failedText}`, result.failed.length ? 5200 : 2600);
  } catch (error) {
    deleteBusy = false;
    setSkillActionMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function transferSkills(paths: string[], targetClientId: string, action: SkillTransferAction): Promise<void> {
  const uniquePaths = [...new Set(paths)].filter(Boolean);
  if (uniquePaths.length === 0 || !targetClientId || skillTransferBusy) return;
  skillTransferBusy = true;
  skillContextMenu = null;
  const verb = action === "move" ? "移动" : "复制";
  setSkillActionMessage(`正在${verb} ${uniquePaths.length} 个 Skill...`, 0);
  try {
    const result = await invoke<TransferSkillsResult>("transfer_skills", {
      paths: uniquePaths,
      targetClientId,
      action
    });
    const done = action === "move" ? result.moved : result.copied;
    const failedText = result.failed.length ? `；失败 ${result.failed.length} 个：${result.failed.join(" / ")}` : "";
    const targetText = result.targetRoot ? `\n目标目录：${result.targetRoot}` : "";
    if (action === "move") {
      const removedPaths = new Set(uniquePaths);
      for (const key of [...selectedSkillKeys]) {
        if (removedPaths.has(key.slice(key.indexOf("::") + 2))) selectedSkillKeys.delete(key);
      }
    }
    skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(
      `${action === "move" ? "移动" : "复制"}完成：成功 ${done} 个，目标客户端 ${result.targetClientName}${failedText}${targetText}`,
      result.failed.length ? 5200 : 2800
    );
  } catch (error) {
    skillTransferBusy = false;
    setSkillActionMessage(`${verb}失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function startSkillImport(): Promise<void> {
  const targets = skillTargetClients();
  if (targets.length === 0) {
    setSkillActionMessage("没有可写入 Skills 的已安装客户端", 4000);
    return;
  }
  let selected: string | string[] | null = null;
  try {
    selected = await openDialog({ directory: true, multiple: false, title: "选择要导入的 Skill 目录" });
  } catch (error) {
    setSkillActionMessage(`打开选择框失败：${error instanceof Error ? error.message : String(error)}`, 5200);
    return;
  }
  if (!selected || Array.isArray(selected)) return;
  importSkillDialog = { sourceDir: selected, targetClientId: preferredSkillTargetId(targets) };
  renderApp(true);
}

async function importSkill(sourceDir: string, targetClientId: string): Promise<void> {
  if (!sourceDir || !targetClientId || skillTransferBusy) return;
  skillTransferBusy = true;
  importSkillDialog = null;
  renderApp(true);
  setSkillActionMessage("正在导入 Skill...", 0);
  try {
    const result = await invoke<ImportSkillResult>("import_skill", { sourceDir, targetClientId });
    skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`${result.message}`, 3200);
  } catch (error) {
    skillTransferBusy = false;
    setSkillActionMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function installMarketSkill(skill: MarketSkill, method: InstallMethod, targetClientId: string): Promise<void> {
  installingKey = `${skill.id}:${method.id}`;
  installLogs[skill.id] = `正在执行：${method.detail}`;
  renderApp();
  try {
    const result = await invoke<InstallResult>("install_market_skill", {
      request: {
        skillId: skill.id,
        name: skill.name,
        method: method.id,
        packageName: method.packageName,
        args: method.args,
        repository: method.repository,
        subdir: method.subdir,
        registryUrl: method.registryUrl,
        manifestUrl: method.manifestUrl,
        targetClientId
      }
    });
    installLogs[skill.id] = `${result.message}${result.installedPath ? `\n路径：${result.installedPath}` : ""}${result.log ? `\n${result.log.slice(-1200)}` : ""}`;
    void loadEnvironment(true);
    void refreshInstalledMarketSkills();
    setSkillActionMessage(`${skill.name} 已安装到 ${clientNameById(targetClientId)}`, 3200);
  } catch (error) {
    installLogs[skill.id] = `安装失败：${error instanceof Error ? error.message : String(error)}`;
    setSkillActionMessage(`安装失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  } finally {
    installingKey = null;
    renderApp();
  }
}

async function installMcpServer(mcp: MarketMcp, targetClientId: string): Promise<void> {
  if (!targetClientId || skillTransferBusy) return;
  skillTransferBusy = true;
  mcpInstallDialog = null;
  renderApp();
  setSkillActionMessage(`正在写入 MCP「${mcp.name}」...`, 0);
  try {
    await invoke<string>("install_mcp_server", {
      clientId: targetClientId,
      server: {
        name: mcp.id,
        transport: mcp.transport,
        command: mcp.command ?? null,
        args: mcp.args ?? null,
        url: mcp.url ?? null
      }
    });
    skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`MCP「${mcp.name}」已写入 ${clientNameById(targetClientId)}`, 3200);
  } catch (error) {
    skillTransferBusy = false;
    setSkillActionMessage(`MCP 写入失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function toggleMcpEnabled(clientId: string, name: string, enabled: boolean): Promise<void> {
  if (skillTransferBusy) return;
  skillTransferBusy = true;
  setSkillActionMessage(`正在${enabled ? "启用" : "禁用"} ${name}...`, 0);
  try {
    await invoke<string>("set_mcp_enabled", { clientId, name, enabled });
    skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`已${enabled ? "启用" : "禁用"} ${name}`, 2400);
  } catch (error) {
    skillTransferBusy = false;
    setSkillActionMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function setAllMcpEnabled(enabled: boolean): Promise<void> {
  if (skillTransferBusy) return;
  skillTransferBusy = true;
  setSkillActionMessage(`正在${enabled ? "启用" : "禁用"}全部 MCP...`, 0);
  try {
    const message = await invoke<string>("set_all_mcp_enabled", { enabled });
    skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`${message}`, 2800);
  } catch (error) {
    skillTransferBusy = false;
    setSkillActionMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

// 识别通过 npm/pnpm 全局安装的市场 skill（如 trellis），在市场标注“已安装”。
async function refreshInstalledMarketSkills(): Promise<void> {
  const packages = [
    ...new Set(
      marketSkills.flatMap((skill) =>
        skill.methods
          .filter((method) => method.id === "npm" || method.id === "pnpm")
          .map((method) => method.packageName)
          .filter((name): name is string => Boolean(name))
      )
    )
  ];
  if (packages.length === 0) return;
  try {
    const installed = await invoke<string[]>("check_global_packages", { packages });
    const installedSet = new Set(installed);
    const ids = new Set<string>();
    for (const skill of marketSkills) {
      if (skill.methods.some((method) => method.packageName && installedSet.has(method.packageName))) {
        ids.add(skill.id);
      }
    }
    installedMarketSkillIds = ids;
    if (currentView === "market") renderApp(true);
  } catch {
    // 静默失败：未安装 npm 不影响其它功能
  }
}

async function exportClientConfig(clientId: string): Promise<void> {
  clientMenuOpen = false;
  renderApp();
  let dir: string | string[] | null = null;
  try {
    dir = await openDialog({ directory: true, title: "选择配置导出目录" });
  } catch (error) {
    setSkillActionMessage(`打开选择框失败：${error instanceof Error ? error.message : String(error)}`, 5000);
    return;
  }
  if (!dir || Array.isArray(dir)) return;
  setSkillActionMessage("正在导出配置...", 0);
  try {
    const message = await invoke<string>("export_client_config", { clientId, targetDir: dir });
    setSkillActionMessage(message, 3200);
  } catch (error) {
    setSkillActionMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function importClientConfig(clientId: string): Promise<void> {
  clientMenuOpen = false;
  renderApp();
  let file: string | string[] | null = null;
  try {
    file = await openDialog({ directory: false, multiple: false, title: "选择要导入的配置文件" });
  } catch (error) {
    setSkillActionMessage(`打开选择框失败：${error instanceof Error ? error.message : String(error)}`, 5000);
    return;
  }
  if (!file || Array.isArray(file)) return;
  setSkillActionMessage("正在导入配置...", 0);
  try {
    const message = await invoke<string>("import_client_config", { clientId, sourceFile: file });
    await loadEnvironment(true);
    setSkillActionMessage(message, 3200);
  } catch (error) {
    setSkillActionMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function deleteClientConfig(clientId: string): Promise<void> {
  setSkillActionMessage("正在删除客户端配置...", 0);
  try {
    const message = await invoke<string>("delete_client_config", { clientId });
    await loadEnvironment(true);
    setSkillActionMessage(message, 3600);
  } catch (error) {
    setSkillActionMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

function navIcon(name: string): string {
  const map: Record<string, string> = { client: "▣", skills: "✦", mcp: "◎", rules: "♙", market: "⌂", settings: "⚙" };
  return map[name] ?? "▣";
}

function renderThemeSwitch(id: string, extraClass = ""): string {
  // size 会被组件换算成 --smr-toggle-width（width = round(size*64)）；侧栏用 1.375≈88px，与 CSS 盒子一致，避免内部按钮溢出。
  const size = extraClass.includes("settings") ? "1.95" : "1.375";
  return `<smr-theme-button id="${id}" class="${extraClass}" value="${currentTheme}" size="${size}" data-theme-toggle></smr-theme-button>`;
}

function renderSidebar(): string {
  const nav = navItems
    .map(([label, icon, view]) => `
      <button class="nav-item ${view === currentView ? "is-active" : ""}" data-view="${view}" type="button">
        <span class="nav-icon">${navIcon(icon)}</span><span>${label}</span>
      </button>`)
    .join("");
  const updateReminder = visibleUpdateAvailable()
    ? `<div class="sidebar-update-card"><button id="sidebar-update-open" type="button"><span>↑</span><strong>发现新版本</strong><small>v${html(updateInfo?.latestVersion ?? "")}</small></button><button id="sidebar-update-dismiss" type="button" title="忽略本版本">×</button></div>`
    : "";
  return `
    <aside class="sidebar">
      <div class="brand-row" data-tauri-drag-region><div class="brand-mark">S</div><strong>SMRmanager</strong></div>
      <nav class="nav-list" aria-label="主导航">${nav}</nav>
      <div class="sidebar-spacer"></div>
      ${updateReminder}
      ${renderThemeSwitch("theme-toggle", "sidebar-theme-switch")}
    </aside>`;
}

function renderClientsList(): string {
  const rows = clients
    .map((client, index) => {
      const rt = runtime(client);
      const installed = rt?.installed ?? false;
      return `
        <button class="client-row ${index === activeClientIndex ? "is-selected" : ""} ${installed ? "is-installed" : "is-missing"}" data-client-index="${index}" type="button">
          <span class="avatar mini image">${img(client.iconFile, client.name)}</span>
          <span class="client-row-copy"><strong>${html(client.name)}</strong><small>${installed ? `${rt?.mcpCount ?? 0} MCP / ${rt?.skillsCount ?? 0} Skills` : "未安装"}</small></span>
          <span class="client-status-dot ${installed ? "installed" : "missing"}"></span>
        </button>`;
    })
    .join("");
  return `
    <section class="client-list-card">
      <div class="list-heading"><strong>全部客户端</strong><span>${clients.length}</span></div>
      ${detectionError ? `<div class="status-banner danger">检测失败：${html(detectionError)}</div>` : ""}
      <div class="client-list">${rows}</div>
      <button id="refresh-detection" class="text-action" type="button"><span>${svgIcon("refresh", 15)}</span>${detectionLoading ? "检测中..." : "重新检测"}</button>
    </section>`;
}

function renderDetectedMcp(item: RuntimeMcpServer): string {
  const detail = item.command || item.url || item.sourcePath;
  const togglable = mcpWritableClientIds.has(item.clientId);
  const status = togglable
    ? `<button class="status-pill mcp-toggle ${item.enabled ? "is-on" : "is-off"}" data-client-id="${html(item.clientId)}" data-mcp-name="${html(item.name)}" data-enabled="${item.enabled ? "1" : "0"}" type="button">${item.enabled ? "已启用" : "已禁用"}</button>`
    : `<span class="status-pill ${item.enabled ? "is-on" : "is-off"}">${item.enabled ? "已启用" : "已禁用"}</span>`;
  return `
    <article class="mcp-row detected">
      <div class="tool-icon ${item.transport === "stdio" ? "teal" : "slate"}">${item.transport === "stdio" ? "⌘" : "↗"}</div>
      <div class="tool-copy"><strong>${html(item.name)}</strong><span>${html(detail)}</span><small>${html(item.sourcePath)}</small></div>
      <div class="row-actions">${status}<button class="square-button" data-open-path="${html(item.sourcePath)}" type="button" title="打开配置文件所在位置">⚙</button></div>
    </article>`;
}

function renderAvailableMcp(): string {
  return "";
}

function renderInstallRequired(client: Client, rt?: RuntimeClient): string {
  const paths = (rt?.configPaths?.length ? rt.configPaths : [client.fallbackPath]).slice(0, 4);
  return `
    <div class="install-required">
      <div class="install-required-icon">!</div>
      <div>
        <h3>需要先安装 ${html(client.name)}</h3>
        <p>未检测到客户端，因此不会显示 MCP 插件和 Skills 配置。安装客户端后点击“重新检测”即可加载对应内容。</p>
        <div class="path-list">${paths.map((path) => `<code>${html(path)}</code>`).join("")}</div>
        <a class="external-install-link" href="${html(rt?.installUrl ?? client.installUrl)}" target="_blank" rel="noreferrer">前往安装</a>
      </div>
    </div>`;
}

function renderClientTabButton(tab: ClientTab, label: string, count?: number): string {
  const suffix = typeof count === "number" ? `<span>${count}</span>` : "";
  return `<button class="tab ${activeClientTab === tab ? "is-active" : ""}" data-client-tab="${tab}" type="button">${label}${suffix}</button>`;
}

function renderClientSkillRow(skill: RuntimeSkill): string {
  return `
    <article class="client-skill-row" data-skill-key="${html(skillKey(skill))}" data-skill-path="${html(skill.path)}">
      <div class="skill-row-icon ${skillTone(skill)}">${html(skillInitials(skill.name))}</div>
      <div class="client-skill-copy">
        <div class="skill-row-title"><strong>${html(skill.name)}</strong></div>
        <p>${html(skillDescription(skill))}</p>
        <div class="skill-chip-row">${skillTags(skill).map((tag) => `<span>${html(tag)}</span>`).join("")}</div>
        <code>${html(skill.path)}</code>
      </div>
    </article>`;
}

function renderClientSkillsPanel(client: Client, skills: RuntimeSkill[]): string {
  return `
    <div class="tool-section client-tab-panel">
      <div class="section-heading-row">
        <h3>已检测到的 Skills</h3>
        <span class="client-status installed">${skills.length} 个</span>
      </div>
      <div class="client-skill-stack">
        ${
          skills.map(renderClientSkillRow).join("") ||
          `<div class="empty-config-panel">当前没有检测到 ${html(client.name)} 的 Skills。请确认客户端 Skill 目录存在，并点击“重新检测”。</div>`
        }
      </div>
    </div>`;
}

function renderClientMcpPanel(mcps: RuntimeMcpServer[]): string {
  return `
    <div class="tool-section client-tab-panel">
      <h3>已检测到的 MCP</h3>
      <div class="tool-stack">${mcps.map(renderDetectedMcp).join("") || `<div class="empty-config-panel">当前没有检测到 MCP 配置。可在「市场 · MCP 专栏」安装，或在客户端配置文件中添加后重新检测。</div>`}</div>
    </div>`;
}

function ruleTone(rule: RuntimeRule): string {
  const tones = ["green", "blue", "purple", "orange", "red", "cyan", "slate"];
  const seed = `${rule.clientId}:${rule.path}`.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return tones[seed % tones.length];
}

function rulePreview(rule: RuntimeRule): string {
  const preview = (rule.preview ?? "").trim();
  return preview || "暂无描述";
}

function renderClientRuleRow(rule: RuntimeRule): string {
  return `
    <article class="client-rule-row">
      <div class="skill-row-icon ${ruleTone(rule)}">${html(skillInitials(rule.name))}</div>
      <div class="client-skill-copy">
        <div class="skill-row-title"><strong>${html(rule.name)}</strong><span class="rule-source-pill">${html(rule.kind)}</span></div>
        <p>${html(rulePreview(rule))}</p>
        <div class="skill-chip-row"><span>${html(rule.clientName)}</span><span>${html(rule.source)}</span>${rule.managed ? "<span>工作区</span>" : "<span>客户端目录</span>"}</div>
        <code>${html(rule.path)}</code>
      </div>
      <div class="client-skill-meta"><span>更新时间</span><strong>${formatUpdated(rule.updatedAt)}</strong></div>
    </article>`;
}

function renderClientRulesPanel(client: Client, rules: RuntimeRule[]): string {
  return `
    <div class="tool-section client-tab-panel">
      <div class="section-heading-row">
        <h3>已检测到的 Rules</h3>
        <span class="client-status installed">${rules.length} 个</span>
      </div>
      <div class="client-skill-stack">
        ${
          rules.map(renderClientRuleRow).join("") ||
          `<div class="empty-config-panel">当前没有检测到 ${html(client.name)} 的 Rules。可在 AGENTS.md / CLAUDE.md / GEMINI.md 或客户端 rules 目录中添加后重新检测。</div>`
        }
      </div>
    </div>`;
}

function renderClientSettingsPanel(client: Client, rt?: RuntimeClient): string {
  const paths = rt?.detectedConfigPaths?.length ? rt.detectedConfigPaths : rt?.configPaths ?? [client.fallbackPath];
  return `
    <div class="tool-section client-tab-panel">
      <h3>客户端设置</h3>
      <div class="client-settings-stack">
        <article><span class="settings-mini-icon blue">⌘</span><div><strong>启动路径</strong><p>${html(rt?.executablePath ?? "未找到可启动程序")}</p></div></article>
        <article><span class="settings-mini-icon green">{} </span><div><strong>配置路径</strong><p>${paths.map((path) => `<code>${html(path)}</code>`).join("<br>") || "—"}</p></div></article>
        <article><span class="settings-mini-icon amber">↻</span><div><strong>检测状态</strong><p>${html(rt?.installed ? "已检测，可管理本地配置" : "未安装，安装后重新检测")}</p></div></article>
      </div>
    </div>`;
}

function renderClientMain(client: Client): string {
  const rt = runtime(client);
  const installed = rt?.installed ?? false;
  const canLaunch = Boolean(rt?.executablePath);
  const mcps = clientMcps(client.id);
  const skills = clientSkills(client.id);
  const rules = clientRules(client.id);
  const tabContent =
    activeClientTab === "skills"
      ? renderClientSkillsPanel(client, skills)
      : activeClientTab === "mcp"
        ? renderClientMcpPanel(mcps)
        : activeClientTab === "rules"
          ? renderClientRulesPanel(client, rules)
          : renderClientSettingsPanel(client, rt);
  return `
    <section class="client-main-card">
      <div class="client-hero">
        <div class="hero-left">
          <span class="avatar large image">${img(client.iconFile, client.name)}</span>
          <div><h2>${html(client.name)}</h2></div>
        </div>
        <div class="hero-actions"><button class="primary-button launch-client-button" data-client-id="${html(client.id)}" type="button" ${canLaunch ? "" : "disabled"}>${canLaunch ? "▶ 启动客户端" : installed ? "未找到启动程序" : "需要安装客户端"}</button><div class="client-menu-wrap"><button id="client-actions-toggle" class="ghost-dots ${clientMenuOpen ? "is-open" : ""}" type="button">${svgIcon("more", 18)}</button>${clientMenuOpen ? `<div class="client-menu" role="menu"><button class="client-menu-item" data-client-action="export" data-client-id="${html(client.id)}" type="button" ${installed ? "" : "disabled"}>导出配置</button><button class="client-menu-item" data-client-action="import" data-client-id="${html(client.id)}" type="button" ${installed ? "" : "disabled"}>导入配置</button><button class="client-menu-item danger" data-client-action="delete" data-client-id="${html(client.id)}" type="button" ${installed ? "" : "disabled"}>删除客户端</button></div>` : ""}</div></div>
      </div>
      ${
        !installed
          ? renderInstallRequired(client, rt)
          : `
        <div class="tabs">
          ${renderClientTabButton("skills", "Skills", skills.length)}
          ${renderClientTabButton("mcp", "MCP", mcps.length)}
          ${renderClientTabButton("rules", "Rules", rules.length)}
          ${renderClientTabButton("settings", "设置")}
        </div>
        <div class="client-tab-scroll">${tabContent}</div>`
      }
    </section>`;
}

function renderInspector(client: Client): string {
  const rt = runtime(client);
  const installed = rt?.installed ?? false;
  const paths = rt?.detectedConfigPaths?.length ? rt.detectedConfigPaths : rt?.configPaths?.slice(0, 3) ?? [];
  const rules = clientRules(client.id);
  return `
    <aside class="inspector">
      <section class="info-card"><h3>客户端信息</h3><dl>
        <dt>名称</dt><dd>${html(client.name)}</dd>
        <dt>检测状态</dt><dd><span class="client-status ${installed ? "installed" : "missing"}">${installed ? "已检测" : "未安装"}</span></dd>
        <dt>类型</dt><dd>${html(rt?.type ?? client.type)}</dd>
        <dt>启动路径</dt><dd>${html(rt?.executablePath ?? "未找到")}</dd>
        <dt>配置路径</dt><dd>${paths.map((path) => `<code>${html(path)}</code>`).join("<br>") || "—"}</dd>
        <dt>描述</dt><dd>${html(rt?.description ?? client.description)}</dd>
      </dl></section>
      <section class="info-card compact"><h3>概览</h3>
        <div class="metric-row"><span>已启用 MCP</span><strong>${rt?.mcpCount ?? 0}</strong></div>
        <div class="metric-row"><span>已分配 Skills</span><strong>${rt?.skillsCount ?? 0}</strong></div>
        <div class="metric-row"><span>已分配 Rules</span><strong>${rules.length}</strong></div>
        <div class="metric-row"><span>配置更新时间</span><strong>${epoch(rt?.updatedAt)}</strong></div>
      </section>
    </aside>`;
}

function renderClientView(): string {
  const client = clients[activeClientIndex] ?? clients[0];
  return `<main class="workspace"><div class="dashboard-grid">${renderClientsList()}${renderClientMain(client)}${renderInspector(client)}</div></main>`;
}

function renderMcpView(): string {
  const rows = (environment?.mcpServers ?? []).map(renderDetectedMcp).join("");
  return `
    <main class="workspace single-column-workspace"><section class="client-main-card management-card">
      <div class="client-hero"><div class="hero-left"><span class="avatar large">M</span><div><h2>MCP 管理</h2><p>从已安装客户端配置中读取真实 MCP 服务。可点击状态切换启用/禁用。</p></div></div><div class="mcp-hero-actions"><button id="disable-all-mcp" class="secondary-button" type="button">一键禁用所有 MCP</button><button id="enable-all-mcp" class="secondary-button" type="button">全部启用</button><button id="refresh-detection" class="secondary-button" type="button">重新检测</button></div></div>
      <div class="tool-section"><h3>全部检测结果</h3><div class="tool-stack">${rows || `<div class="empty-config-panel">未检测到 MCP。需要先安装客户端，并在客户端中配置 MCP。</div>`}</div></div>
    </section></main>`;
}

function renderRuleListRow(rule: RuntimeRule): string {
  return `
    <article class="rule-list-row">
      <div class="skill-row-icon ${ruleTone(rule)}">${html(skillInitials(rule.name))}</div>
      <div class="skill-row-main">
        <div class="skill-row-title"><strong>${html(rule.name)}</strong><span class="rule-source-pill">${html(rule.kind)}</span></div>
        <p>${html(rulePreview(rule))}</p>
        <div class="skill-chip-row"><span>${html(rule.clientName)}</span><span>${html(rule.source)}</span>${rule.managed ? "<span>工作区</span>" : "<span>客户端目录</span>"}</div>
        <code>${html(rule.path)}</code>
      </div>
      <div class="skill-row-meta source"><span>来源</span><strong>${html(rule.clientName)}</strong></div>
      <div class="skill-row-meta updated"><span>更新时间</span><strong>${formatUpdated(rule.updatedAt)}</strong></div>
    </article>`;
}

function renderRulesView(): string {
  const rules = environment?.rules ?? [];
  const clientsWithRules = [...new Map(rules.map((rule) => [rule.clientId, rule.clientName])).entries()];
  const workspaceRules = rules.filter((rule) => rule.managed).length;
  const recent = rules
    .map((rule) => Number(rule.updatedAt ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)[0];
  const sortedRules = rules
    .slice()
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
  const ruleTotalPages = Math.max(1, Math.ceil(sortedRules.length / listPageSize));
  const rulePageNum = Math.min(Math.max(rulePage, 1), ruleTotalPages);
  const rows = sortedRules
    .slice((rulePageNum - 1) * listPageSize, rulePageNum * listPageSize)
    .map(renderRuleListRow)
    .join("");
  return `
    <main class="workspace single-column-workspace"><section class="client-main-card management-card skills-page-card rules-page-card">
      <div class="skills-page-hero">
        <div class="hero-left"><span class="avatar large rules-avatar">R</span><div><h2>Rules 管理</h2><p>识别 Claude / Codex / Gemini / OpenCode 等客户端的 AGENTS.md、CLAUDE.md、GEMINI.md 与 rules 目录。</p></div></div>
        <div class="skills-hero-actions"><button id="refresh-detection" class="secondary-button" type="button">重新检测</button></div>
      </div>
      <div class="skills-stat-grid">
        <article><strong>Rules 总数</strong><b>${rules.length}</b><span>来自 ${clientsWithRules.length} 个来源</span><i>R</i></article>
        <article><strong>客户端来源</strong><b>${Math.max(clientsWithRules.length - (workspaceRules ? 1 : 0), 0)}</b><span>CLI / IDE 规则文件</span><i>◇</i></article>
        <article><strong>工作区规则</strong><b>${workspaceRules}</b><span>当前项目 AGENTS / Cursor Rules</span><i>⌂</i></article>
        <article><strong>最近更新</strong><b>${recent ? formatUpdated(String(recent)).split(" ")[0] : "—"}</b><span>${recent ? formatUpdated(String(recent)) : "暂无更新时间"}</span><i>↻</i></article>
      </div>
      <div class="skill-list-table rule-list-table">${rows || `<div class="empty-config-panel">未检测到 Rules。可在 ~/.codex/AGENTS.md、~/.claude/CLAUDE.md、~/.gemini/GEMINI.md 或客户端 rules 目录中添加。</div>`}</div>
      <div class="skills-footer"><span>共 ${rules.length} 条 Rules</span>${renderPager("rule", rulePageNum, ruleTotalPages)}</div>
    </section></main>`;
}

function skillInitials(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, " ").trim();
  if (!clean) return "SK";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function skillTone(skill: RuntimeSkill): string {
  const tones = ["green", "blue", "purple", "orange", "red", "cyan", "slate"];
  const seed = `${skill.clientId}:${skill.directory}`.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return tones[seed % tones.length];
}

function formatUpdated(value?: string | null): string {
  return epoch(value);
}

function skillDescription(skill: RuntimeSkill): string {
  const value = (skill.description ?? "").trim();
  if (!value || value === "|" || value === ">") return "暂无描述";
  return value;
}

function skillTags(skill: RuntimeSkill): string[] {
  const base = [skill.clientName, skill.managed ? "共享目录" : "客户端目录", skill.directory];
  const desc = skillDescription(skill).toLowerCase();
  if (desc.includes("test") || desc.includes("测试")) base.push("测试");
  if (desc.includes("doc") || desc.includes("文档")) base.push("文档");
  if (desc.includes("security") || desc.includes("安全")) base.push("安全");
  return [...new Set(base)].slice(0, 4);
}

function renderPager(scope: "skill" | "rule", page: number, totalPages: number): string {
  return `<div class="pager">
    <button class="pager-btn" data-pager="${scope}" data-page="prev" type="button" ${page <= 1 ? "disabled" : ""}>${svgIcon("chevron-left", 15)}</button>
    <button class="pager-btn is-active" type="button" disabled>${page} / ${totalPages}</button>
    <button class="pager-btn" data-pager="${scope}" data-page="next" type="button" ${page >= totalPages ? "disabled" : ""}>${svgIcon("chevron-right", 15)}</button>
    <select class="skills-mini-select pager-size" data-pager-size="${scope}">
      ${[10, 20, 50].map((n) => `<option value="${n}" ${listPageSize === n ? "selected" : ""}>${n} 条/页</option>`).join("")}
    </select>
  </div>`;
}

function renderSkillsView(): string {
  const skills = environment?.skills ?? [];
  const installed = installedClients();
  const sharedSkillCount = skills.filter((skill) => skill.managed).length;
  const query = skillQuery.trim().toLowerCase();
  const clientsWithSkills = [...new Map(skills.map((skill) => [skill.clientId, skill.clientName])).entries()];
  const filteredSkills = skills
    .filter((skill) => {
      const haystack = `${skill.name} ${skill.description ?? ""} ${skill.clientName} ${skill.directory} ${skill.path}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesClient = skillClientFilter === "all" || skill.clientId === skillClientFilter;
      const matchesStatus =
        skillStatusFilter === "all" ||
        (skillStatusFilter === "shared" && skill.managed) ||
        (skillStatusFilter === "client" && !skill.managed);
      return matchesQuery && matchesClient && matchesStatus;
    })
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / listPageSize));
  const skillPageNum = Math.min(Math.max(skillPage, 1), totalPages);
  const pageSkills = filteredSkills.slice((skillPageNum - 1) * listPageSize, skillPageNum * listPageSize);
  const selectedVisibleCount = pageSkills.filter((skill) => selectedSkillKeys.has(skillKey(skill))).length;
  const allVisibleSelected = pageSkills.length > 0 && selectedVisibleCount === pageSkills.length;
  const bulkTargets = skillTargetClients();
  const bulkTargetId = preferredSkillTargetId(bulkTargets);
  if (bulkTargetId && skillBulkTargetId !== bulkTargetId && !bulkTargets.some((client) => client.id === skillBulkTargetId)) {
    skillBulkTargetId = bulkTargetId;
  }
  const rows = pageSkills
    .map(
      (skill) => {
        const key = skillKey(skill);
        const selected = selectedSkillKeys.has(key);
        return `
      <article class="skill-list-row ${selected ? "is-selected" : ""}" data-skill-key="${html(key)}" data-skill-path="${html(skill.path)}">
        <label class="skill-check" title="选择 ${html(skill.name)}">
          <input class="skill-checkbox" data-skill-key="${html(key)}" type="checkbox" ${selected ? "checked" : ""} />
        </label>
        <div class="skill-row-icon ${skillTone(skill)}">${html(skillInitials(skill.name))}</div>
        <div class="skill-row-main">
          <div class="skill-row-title"><strong>${html(skill.name)}</strong></div>
          <p>${html(skillDescription(skill))}</p>
          <div class="skill-chip-row">${skillTags(skill).map((tag) => `<span>${html(tag)}</span>`).join("")}</div>
          <code>${html(skill.path)}</code>
        </div>
        <div class="skill-row-meta source"><span>客户端</span><strong>${html(skill.clientName)}</strong></div>
        <div class="skill-row-meta updated"><span>更新时间</span><strong>${formatUpdated(skill.updatedAt)}</strong></div>
        <button class="skill-delete-button" data-delete-skill-path="${html(skill.path)}" data-skill-name="${html(skill.name)}" type="button" ${deleteBusy ? "disabled" : ""}>删除</button>
      </article>`;
      }
    )
    .join("");
  return `
    <main class="workspace single-column-workspace"><section class="client-main-card management-card skills-page-card">
      <div class="skills-page-hero">
        <div class="hero-left"><span class="avatar large skills-avatar">S</span><div><h2>Skills 管理</h2><p>管理和组织所有客户端的 Skills，支持单个删除、多选删除和批量删除。</p></div></div>
        <div class="skills-hero-actions"><button id="import-skill-button" class="secondary-button" type="button">${svgIcon("download", 15)} 导入 Skill</button><button id="refresh-detection" class="secondary-button" type="button">重新检测</button></div>
      </div>
      ${installed.length === 0 ? `<div class="install-required inline"><div class="install-required-icon">!</div><div><h3>需要先安装客户端</h3><p>未检测到可管理客户端。安装 Claude、Cursor、OpenCode、Trae 或 Codex 后，Skills 才会在这里显示。</p></div></div>` : ""}
      <div class="skills-stat-grid">
        <article><strong>技能总数</strong><b>${skills.length}</b><span>来自 ${clientsWithSkills.length} 个来源</span><i>⬢</i></article>
        <article><strong>共享目录</strong><b>${sharedSkillCount}</b><span>${skills.length - sharedSkillCount} 个客户端目录</span><i>✓</i></article>
        <article><strong>被引用</strong><b>${installed.reduce((sum, client) => sum + client.skillsCount, 0)}</b><span>按 Clients 引用统计</span><i>♙</i></article>
        <article><strong>按来源</strong><b>${clientsWithSkills.length}</b><span>客户端 / 共享目录</span><i>▦</i></article>
      </div>
      <div class="skills-toolbar">
        <label class="skills-search-box"><span>${svgIcon("search", 16)}</span><input id="skill-search-input" value="${html(skillQuery)}" placeholder="搜索 Skills..." /></label>
        <select id="skill-client-filter" class="skills-select">
          <option value="all" ${skillClientFilter === "all" ? "selected" : ""}>全部客户端</option>
          ${clientsWithSkills.map(([id, name]) => `<option value="${html(id)}" ${skillClientFilter === id ? "selected" : ""}>${html(name)}</option>`).join("")}
        </select>
        <select id="skill-status-filter" class="skills-select">
          <option value="all" ${skillStatusFilter === "all" ? "selected" : ""}>全部状态</option>
          <option value="client" ${skillStatusFilter === "client" ? "selected" : ""}>客户端目录</option>
          <option value="shared" ${skillStatusFilter === "shared" ? "selected" : ""}>共享目录</option>
        </select>
        <button class="skills-view-button ${!skillGridView ? "is-active" : ""}" data-skill-view="list" type="button">☷</button><button class="skills-view-button ${skillGridView ? "is-active" : ""}" data-skill-view="grid" type="button">▦</button>
      </div>
      <div class="skills-bulk-bar">
        <label><input id="select-all-skills" type="checkbox" ${allVisibleSelected ? "checked" : ""} ${filteredSkills.length === 0 ? "disabled" : ""} /> 全选当前列表</label>
        <span>已选 ${selectedSkillKeys.size} 项</span>
        <span class="bulk-target-label">复制/移动到</span>
        <select id="bulk-skill-target" class="skills-mini-select" title="批量复制/移动的目标客户端（这不是筛选；筛选在上方工具栏）" ${bulkTargets.length === 0 ? "disabled" : ""}>
          ${bulkTargets.map((client) => `<option value="${html(client.id)}" ${bulkTargetId === client.id ? "selected" : ""}>${html(client.name)}</option>`).join("")}
        </select>
        <button id="copy-selected-skills" class="ghost-mini-button transfer-mini-button" type="button" ${selectedSkillKeys.size === 0 || skillTransferBusy || !bulkTargetId ? "disabled" : ""}>批量复制到</button>
        <button id="move-selected-skills" class="ghost-mini-button transfer-mini-button" type="button" ${selectedSkillKeys.size === 0 || skillTransferBusy || !bulkTargetId ? "disabled" : ""}>批量移动到</button>
        <button id="delete-selected-skills" class="danger-mini-button" type="button" ${selectedSkillKeys.size === 0 || deleteBusy ? "disabled" : ""}>${deleteBusy ? "删除中..." : "批量删除"}</button>
        <button id="clear-skill-selection" class="ghost-mini-button" type="button" ${selectedSkillKeys.size === 0 ? "disabled" : ""}>清空选择</button>
      </div>
      <div class="skill-list-table ${skillGridView ? "is-grid" : ""}">${rows || `<div class="empty-config-panel">未检测到已安装 Skills。可以去市场用 npm / npx / pnpm / GitHub / JSON 安装。</div>`}</div>
      <div class="skills-footer"><span>共 ${skills.length} 条，当前显示 ${filteredSkills.length} 条</span>${renderPager("skill", skillPageNum, totalPages)}</div>
    </section></main>`;
}

function renderSkillIcon(file: string, alt: string, mini = false): string {
  const cls = `${mini ? "mini-github-skill-icon" : "github-skill-icon"}${file.includes("openspec") ? " openspec-real" : ""}`;
  return `<span class="${cls}">${img(file, alt, "skill-icons")}</span>`;
}

function renderSkillCard(skill: MarketSkill): string {
  const recommended = skill.methods[0];
  const key = recommended ? `${skill.id}:${recommended.id}` : "";
  const methodTags = skill.methods.map((method) => method.label).join(" / ");
  const targets = marketSkillTargets(skill);
  const supportNames = skill.supportedClients.map(clientNameById).join(" / ");
  const installed = installedMarketSkillIds.has(skill.id);
  const noTarget = targets.length === 0;
  const installDisabled = !recommended || installingKey === key || noTarget;
  const installLabel = installingKey === key ? "安装中" : noTarget ? "无支持客户端" : installed ? "重新安装" : "安装";
  return `
    <article class="catalog-card">
      <div class="catalog-card-main">${renderSkillIcon(skill.iconFile, skill.name)}<div><h3>${html(skill.name)}</h3><p>${html(skill.description)}</p></div></div>
      <div class="catalog-tags"><span class="catalog-category ${skill.tone}">${html(skill.category)}</span><span class="catalog-method-tag">${html(methodTags)}</span>${installed ? `<span class="catalog-installed-pill">已安装</span>` : ""}</div>
      <div class="catalog-support">支持客户端：${html(supportNames)}</div>
      <div class="catalog-footer"><span class="stars">★ ${skill.rating}</span><span>♙ ${skill.installs} 安装</span><button class="install-method-button primary-install" data-skill-id="${html(skill.id)}" data-method-id="${recommended?.id ?? ""}" title="${html(recommended?.detail ?? "暂无安装方式")}" type="button" ${installDisabled ? "disabled" : ""}>${installLabel}</button></div>
      <small class="catalog-repo">${html(skill.repo)}</small>
      ${installLogs[skill.id] ? `<pre class="install-log">${html(installLogs[skill.id])}</pre>` : ""}
    </article>`;
}

function renderMcpCard(mcp: MarketMcp): string {
  const targets = mcpTargetClients();
  const detail = mcp.command ? `${mcp.command} ${(mcp.args ?? []).join(" ")}`.trim() : mcp.url ?? "";
  const noTarget = targets.length === 0;
  return `
    <article class="catalog-card">
      <div class="catalog-card-main"><div class="tool-icon ${mcp.tone} image">${img(mcp.iconFile, mcp.name)}</div><div><h3>${html(mcp.name)}</h3><p>${html(mcp.description)}</p></div></div>
      <div class="catalog-tags"><span class="catalog-category slate">${html(mcp.transport)}</span><span class="catalog-method-tag">MCP</span></div>
      <div class="catalog-support">命令：${html(detail)}</div>
      <div class="catalog-footer"><span class="stars">◎ MCP 服务</span><button class="mcp-install-button primary-install" data-mcp-id="${html(mcp.id)}" type="button" ${noTarget ? "disabled" : ""}>${noTarget ? "无可写入客户端" : "安装到…"}</button></div>
    </article>`;
}

function renderMarketView(): string {
  const isMcp = marketTab === "mcp";
  const tabs = `<section class="market-tabs-line"><button class="market-page-tab ${isMcp ? "" : "is-active"}" data-market-tab="skill" type="button">Skill 市场</button><button class="market-page-tab ${isMcp ? "is-active" : ""}" data-market-tab="mcp" type="button">MCP 专栏</button></section>`;
  if (isMcp) {
    const q = mcpQuery.trim().toLowerCase();
    const mcps = marketMcps
      .filter((m) => !q || `${m.name} ${m.description} ${m.id}`.toLowerCase().includes(q))
      .sort((a, b) =>
        mcpSort === "transport"
          ? a.transport.localeCompare(b.transport) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name)
      );
    return `
    <main class="market-workspace">
      <header class="market-page-header"><div><h1>市场</h1><p>内置常用 MCP 服务，一键写入所选客户端的配置文件。</p></div></header>
      ${tabs}
      <section class="market-toolbar mcp-market-toolbar"><label class="market-search-box"><span>${svgIcon("search", 16)}</span><input id="mcp-search-input" value="${html(mcpQuery)}" placeholder="搜索 MCP..." /></label><select id="mcp-sort-select" class="skills-select"><option value="name" ${mcpSort === "name" ? "selected" : ""}>按名称排序</option><option value="transport" ${mcpSort === "transport" ? "selected" : ""}>按传输方式排序</option></select><button id="refresh-detection" class="refresh-button" type="button">${svgIcon("refresh", 16)}</button></section>
      <section class="install-route-panel"><strong>MCP 写入</strong><span>选择目标客户端后会把 MCP 配置写入其配置文件（claude / claude-desktop / gemini / cursor / trae 用 JSON，codex 用 TOML）。写入后请重新检测。</span></section>
      <section class="skill-catalog-grid">${mcps.map(renderMcpCard).join("") || `<div class="empty-config-panel">没有匹配的 MCP。</div>`}</section>
    </main>`;
  }
  const sq = marketSkillQuery.trim().toLowerCase();
  const categories = ["全部", ...Array.from(new Set(marketSkills.map((item) => item.category)))];
  const skillList = marketSkills
    .filter((item) => marketSkillCategory === "全部" || item.category === marketSkillCategory)
    .filter((item) => !sq || `${item.name} ${item.description} ${item.id} ${item.repo}`.toLowerCase().includes(sq))
    .sort((a, b) => (marketSkillSort === "rating" ? parseFloat(b.rating) - parseFloat(a.rating) : a.name.localeCompare(b.name)));
  return `
    <main class="market-workspace">
      <header class="market-page-header"><div><h1>市场</h1><p>支持 npm、npx、pnpm、GitHub 和静态 JSON 注册表安装 Skills。</p></div></header>
      ${tabs}
      <section class="market-toolbar mcp-market-toolbar"><label class="market-search-box"><span>${svgIcon("search", 16)}</span><input id="market-skill-search" value="${html(marketSkillQuery)}" placeholder="搜索 Skills..." /></label><select id="market-skill-sort" class="skills-select"><option value="name" ${marketSkillSort === "name" ? "selected" : ""}>按名称排序</option><option value="rating" ${marketSkillSort === "rating" ? "selected" : ""}>按评分排序</option></select><button id="refresh-detection" class="refresh-button" type="button">${svgIcon("refresh", 16)}</button></section>
      <section class="install-route-panel"><strong>安装路线</strong><span>CLI 包走 npm/pnpm；一次性初始化走 npx；仓库型 Skill 走 GitHub clone；无后端市场走 JSON manifest/registry。</span></section>
      <section class="category-row">${categories.map((category) => `<button class="category-pill ${marketSkillCategory === category ? "is-active" : ""}" data-category="${html(category)}" type="button">${html(category)}</button>`).join("")}</section>
      <section class="skill-catalog-grid">${skillList.map(renderSkillCard).join("") || `<div class="empty-config-panel">没有匹配的 Skill。</div>`}</section>
    </main>`;
}

function renderSettingsView(): string {
  const hasUpdate = Boolean(updateInfo?.available && updateInfo.latestVersion);
  const updateStatus = updateChecking
    ? "正在检查更新..."
    : updateError
      ? `检查失败：${updateError}`
      : updateInfo
        ? hasUpdate
          ? `发现新版本 ${updateInfo.latestVersion}`
          : "当前已是最新版本"
        : "尚未检查";
  const notes = updateInfo?.notes ? updateInfo.notes.slice(0, 420) : "";
  return `
    <main class="workspace single-column-workspace">
      <section class="client-main-card management-card settings-page-card">
        <div class="settings-page-hero">
          <div class="hero-left"><span class="avatar large settings-avatar">⚙</span><div><h2>设置</h2><p>管理主题、更新和应用基础配置。</p></div></div>
          <button id="refresh-detection" class="secondary-button" type="button">重新检测客户端</button>
        </div>

        <section class="settings-section">
          <div class="settings-section-title"><div><h3>应用更新</h3><p>内置 GitHub Releases 更新检查，优先读取 Release 附带的 latest.json。</p></div><span class="settings-version-pill">当前 v${html(updateInfo?.currentVersion ?? "0.1.0")}</span></div>
          <div class="update-panel ${hasUpdate ? "has-update" : ""}">
            <div class="update-panel-main">
              <div class="update-icon">${hasUpdate ? "↑" : "✓"}</div>
              <div>
                <strong>${html(updateStatus)}</strong>
                <p>${updateInfo ? `更新源：${html(updateInfo.sourceUrl)}` : "默认更新源：GitHub Releases latest.json / releases/latest"}</p>
                <dl>
                  <div><dt>最新版本</dt><dd>${html(updateInfo?.latestVersion ?? "—")}</dd></div>
                  <div><dt>发布时间</dt><dd>${html(updateTimestamp(updateInfo?.pubDate))}</dd></div>
                  <div><dt>检查时间</dt><dd>${html(updateTimestamp(updateInfo?.checkedAt))}</dd></div>
                </dl>
              </div>
            </div>
            <div class="update-panel-actions">
              <button id="check-app-update" class="primary-button" type="button" ${updateChecking ? "disabled" : ""}>${updateChecking ? "检查中..." : "检查更新"}</button>
              <button id="open-release-page" class="secondary-button" type="button" ${updateInfo?.releaseUrl ? "" : "disabled"}>打开发布页</button>
              <button id="dismiss-update-version" class="secondary-button" type="button" ${hasUpdate ? "" : "disabled"}>忽略本版本</button>
            </div>
          </div>
          ${notes ? `<pre class="update-notes">${html(notes)}${updateInfo?.notes && updateInfo.notes.length > notes.length ? "\n..." : ""}</pre>` : ""}
        </section>

        <section class="settings-section">
          <div class="settings-section-title"><div><h3>界面</h3><p>主题模式会保存到本机；选择“跟随系统”时随系统日夜自动切换。</p></div></div>
          <div class="settings-row theme-settings-row">
            <span>主题模式</span>
            <div class="theme-segmented" role="group" aria-label="主题模式">
              <button class="theme-seg ${themeMode === "light" ? "is-active" : ""}" data-theme-mode="light" type="button">日间</button>
              <button class="theme-seg ${themeMode === "dark" ? "is-active" : ""}" data-theme-mode="dark" type="button">夜间</button>
              <button class="theme-seg ${themeMode === "system" ? "is-active" : ""}" data-theme-mode="system" type="button">跟随系统</button>
            </div>
          </div>
        </section>
      </section>
    </main>`;
}

function renderPlaceholder(title: string): string {
  return `<main class="workspace"><section class="client-main-card placeholder-card"><div class="client-hero"><div class="hero-left"><span class="avatar large">SM</span><h2>${html(title)}</h2></div></div><div class="tool-section"><h3>设计占位</h3><p class="placeholder-copy">该模块后续接入真实配置。</p></div></section></main>`;
}

function renderContent(): string {
  if (currentView === "clients") return renderClientView();
  if (currentView === "mcp") return renderMcpView();
  if (currentView === "skills") return renderSkillsView();
  if (currentView === "rules") return renderRulesView();
  if (currentView === "market") return renderMarketView();
  if (currentView === "settings") return renderSettingsView();
  return renderPlaceholder(navItems.find(([, , view]) => view === currentView)?.[0] ?? "模块");
}

function renderSkillContextMenu(): string {
  const ctx = skillContextMenu;
  if (!ctx) return "";
  const skill = environment?.skills.find((item) => skillKey(item) === ctx.key) ?? skillByPath(ctx.path);
  if (!skill) return "";
  const paths = transferPathsForContext(ctx.key, skill.path);
  const multi = paths.length > 1;
  const targets = skillTargetClients(multi ? undefined : skill.clientId);
  const title = multi ? `已选择 ${paths.length} 个 Skills` : skill.name;
  const left = Math.max(12, Math.min(ctx.x, window.innerWidth - 330));
  const top = Math.max(12, Math.min(ctx.y, window.innerHeight - 430));
  const targetRows = targets.length
    ? targets
        .map(
          (target) => `
            <div class="context-target-row">
              <span><strong>${html(target.name)}</strong><small>${html(target.type)}</small></span>
              <button class="skill-context-action" data-action="copy" data-target-client-id="${html(target.id)}" type="button" ${skillTransferBusy ? "disabled" : ""}>复制</button>
              <button class="skill-context-action move" data-action="move" data-target-client-id="${html(target.id)}" type="button" ${skillTransferBusy ? "disabled" : ""}>移动</button>
            </div>`
        )
        .join("")
    : `<div class="context-empty">没有可写入 Skills 的已安装客户端。</div>`;
  return `
    <div class="skill-context-menu" style="left:${left}px;top:${top}px" role="menu">
      <div class="context-menu-title"><span>Skill 操作</span><strong>${html(title)}</strong></div>
      <button class="context-menu-line" id="context-copy-path" data-copy-path="${html(skill.path)}" type="button">复制路径</button>
      <div class="context-menu-divider"></div>
      <div class="context-menu-caption">复制 / 移动到已安装客户端</div>
      <div class="context-target-list">${targetRows}</div>
    </div>`;
}

function openDeleteSkillsDialog(paths: string[], label?: string): void {
  const uniquePaths = [...new Set(paths)].filter(Boolean);
  if (uniquePaths.length === 0) return;
  const isBatch = uniquePaths.length > 1;
  confirmDialog = {
    title: isBatch ? "批量删除 Skills" : "删除 Skill",
    message: isBatch
      ? `确认删除选中的 ${uniquePaths.length} 个 Skills？会先移动到 SMRmanager 回收目录，便于恢复。`
      : `确认删除 ${label ?? "该 Skill"}？会先移动到 SMRmanager 回收目录，便于恢复。`,
    confirmLabel: isBatch ? `删除 ${uniquePaths.length} 个` : "删除",
    cancelLabel: "取消",
    paths: uniquePaths
  };
  skillContextMenu = null;
  renderApp(true);
}

function renderConfirmDialog(): string {
  if (!confirmDialog) return "";
  return `
    <div class="alert-dialog-backdrop" role="presentation">
      <section class="alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-desc">
        <div class="alert-dialog-icon">⌫</div>
        <div class="alert-dialog-copy">
          <h2 id="delete-dialog-title">${html(confirmDialog.title)}</h2>
          <p id="delete-dialog-desc">${html(confirmDialog.message)}</p>
          <div class="alert-dialog-paths">
            ${confirmDialog.paths.slice(0, 4).map((path) => `<code>${html(path)}</code>`).join("")}
            ${confirmDialog.paths.length > 4 ? `<span>还有 ${confirmDialog.paths.length - 4} 项...</span>` : ""}
          </div>
        </div>
        <div class="alert-dialog-actions">
          <button id="confirm-dialog-cancel" class="secondary-button" type="button">${html(confirmDialog.cancelLabel)}</button>
          <button id="confirm-dialog-confirm" class="danger-dialog-button" type="button">${html(confirmDialog.confirmLabel)}</button>
        </div>
      </section>
    </div>`;
}

function renderImportDialog(): string {
  if (!importSkillDialog) return "";
  const dialog = importSkillDialog;
  const targets = skillTargetClients();
  const sourceName = dialog.sourceDir.split(/[\\/]/).filter(Boolean).pop() ?? dialog.sourceDir;
  return `
    <div class="alert-dialog-backdrop" role="presentation">
      <section class="alert-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <div class="alert-dialog-icon">⇩</div>
        <div class="alert-dialog-copy">
          <h2 id="import-dialog-title">导入 Skill</h2>
          <p>将「${html(sourceName)}」复制到所选客户端的 Skills 目录。</p>
          <div class="alert-dialog-paths"><code>${html(dialog.sourceDir)}</code></div>
          <label class="import-target-row"><span>导入到</span>
            <select id="import-target-select" class="skills-select" ${targets.length === 0 ? "disabled" : ""}>
              ${targets.map((client) => `<option value="${html(client.id)}" ${dialog.targetClientId === client.id ? "selected" : ""}>${html(client.name)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="alert-dialog-actions">
          <button id="import-dialog-cancel" class="secondary-button" type="button">取消</button>
          <button id="import-dialog-confirm" class="primary-button" type="button" ${targets.length === 0 || skillTransferBusy ? "disabled" : ""}>确认导入</button>
        </div>
      </section>
    </div>`;
}

function renderMarketInstallDialog(): string {
  if (!marketInstallDialog) return "";
  const dialog = marketInstallDialog;
  const skill = marketSkills.find((item) => item.id === dialog.skillId);
  const method = skill?.methods.find((item) => item.id === dialog.methodId);
  if (!skill || !method) return "";
  const targets = marketSkillTargets(skill);
  return `
    <div class="alert-dialog-backdrop" role="presentation">
      <section class="alert-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="market-install-title">
        <div class="alert-dialog-icon">⇩</div>
        <div class="alert-dialog-copy">
          <h2 id="market-install-title">安装 ${html(skill.name)}</h2>
          <p>仅列出该 Skill 支持且已安装的客户端。</p>
          <div class="alert-dialog-paths"><code>${html(method.detail)}</code></div>
          <label class="import-target-row"><span>安装到</span>
            <select id="market-install-target" class="skills-select" ${targets.length === 0 ? "disabled" : ""}>
              ${targets.map((client) => `<option value="${html(client.id)}" ${dialog.targetClientId === client.id ? "selected" : ""}>${html(client.name)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="alert-dialog-actions">
          <button id="market-install-cancel" class="secondary-button" type="button">取消</button>
          <button id="market-install-confirm" class="primary-button" type="button" ${targets.length === 0 ? "disabled" : ""}>确认安装</button>
        </div>
      </section>
    </div>`;
}

function renderMcpInstallDialog(): string {
  if (!mcpInstallDialog) return "";
  const dialog = mcpInstallDialog;
  const mcp = marketMcps.find((item) => item.id === dialog.mcpId);
  if (!mcp) return "";
  const targets = mcpTargetClients();
  const detail = mcp.command ? `${mcp.command} ${(mcp.args ?? []).join(" ")}`.trim() : mcp.url ?? "";
  return `
    <div class="alert-dialog-backdrop" role="presentation">
      <section class="alert-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-install-title">
        <div class="alert-dialog-icon">◎</div>
        <div class="alert-dialog-copy">
          <h2 id="mcp-install-title">安装 MCP · ${html(mcp.name)}</h2>
          <p>把该 MCP 写入所选客户端的配置文件（写入后请重新检测）。</p>
          <div class="alert-dialog-paths"><code>${html(detail)}</code></div>
          <label class="import-target-row"><span>写入到</span>
            <select id="mcp-install-target" class="skills-select" ${targets.length === 0 ? "disabled" : ""}>
              ${targets.map((client) => `<option value="${html(client.id)}" ${dialog.targetClientId === client.id ? "selected" : ""}>${html(client.name)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="alert-dialog-actions">
          <button id="mcp-install-cancel" class="secondary-button" type="button">取消</button>
          <button id="mcp-install-confirm" class="primary-button" type="button" ${targets.length === 0 ? "disabled" : ""}>确认写入</button>
        </div>
      </section>
    </div>`;
}

function renderWindowControls(): string {
  return `<div class="window-bar" data-tauri-drag-region><div class="window-controls"><button id="titlebar-minimize" class="window-button" type="button">−</button><button id="titlebar-maximize" class="window-button" type="button">□</button><button id="titlebar-close" class="window-button close" type="button">×</button></div></div>`;
}

function applyThemeToDocument(): void {
  document.documentElement.dataset.theme = currentTheme;
  document.documentElement.style.colorScheme = currentTheme;
  document.body.setAttribute("data-dark-mode", currentTheme === "dark" ? "true" : "false");
}

function syncThemeControls(): void {
  document.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach((toggle) => {
    toggle.setAttribute("value", currentTheme);
  });
  document.querySelectorAll<HTMLElement>(".theme-seg").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.themeMode === themeMode);
  });
}

function setThemeMode(mode: ThemeMode): void {
  themeMode = mode;
  localStorage.setItem(themeStorageKey, mode);
  currentTheme = resolveTheme(mode);
  // 主题控件本身有完整 CSS 动画；这里不重绘整棵 DOM，避免组件被重建导致动画中断。
  applyThemeToDocument();
  syncThemeControls();
}

// 右键菜单独立浮层：打开/关闭只增量挂载菜单 + 切换目标行高亮，不触发 renderApp 全量重建，从根上消除右键抖动。
function bindSkillContextMenuEvents(): void {
  document.querySelectorAll<HTMLButtonElement>(".skill-context-action").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const context = skillContextMenu;
      if (!context) return;
      const action = button.dataset.action === "move" ? "move" : "copy";
      const targetClientId = button.dataset.targetClientId ?? "";
      void transferSkills(transferPathsForContext(context.key, context.path), targetClientId, action);
    });
  });
  document.querySelector<HTMLButtonElement>("#context-copy-path")?.addEventListener("click", async (event) => {
    event.stopPropagation();
    const path = (event.currentTarget as HTMLButtonElement).dataset.copyPath ?? "";
    closeSkillContextMenu();
    try {
      await navigator.clipboard.writeText(path);
      setSkillActionMessage("已复制 Skill 路径", 1600);
    } catch {
      setSkillActionMessage(path, 5200);
    }
  });
}

function refreshSkillContextMenu(): void {
  document.querySelector(".skill-context-menu")?.remove();
  document.querySelectorAll(".is-context-target").forEach((el) => el.classList.remove("is-context-target"));
  const ctx = skillContextMenu;
  if (!ctx) return;
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  shell.insertAdjacentHTML("beforeend", renderSkillContextMenu());
  document.querySelectorAll<HTMLElement>("[data-skill-key]").forEach((el) => {
    if (el.dataset.skillKey === ctx.key) el.classList.add("is-context-target");
  });
  bindSkillContextMenuEvents();
}

function openSkillContextMenu(state: SkillContextMenuState): void {
  skillContextMenu = state;
  refreshSkillContextMenu();
}

function closeSkillContextMenu(): void {
  if (!skillContextMenu) return;
  skillContextMenu = null;
  refreshSkillContextMenu();
}

function renderApp(preserveScroll = false): void {
  const workspaceScrollTop = preserveScroll ? (document.querySelector<HTMLElement>(".workspace")?.scrollTop ?? 0) : 0;
  const clientTabScrollTop = preserveScroll ? (document.querySelector<HTMLElement>(".client-tab-scroll")?.scrollTop ?? 0) : 0;
  applyThemeToDocument();
  appRoot.innerHTML = `<div class="app-shell ${currentView === "market" ? "market-preview-shell" : ""}">${renderWindowControls()}${renderSidebar()}${renderContent()}${renderConfirmDialog()}${renderImportDialog()}${renderMarketInstallDialog()}${renderMcpInstallDialog()}</div>`;
  bindInteractions();
  refreshSkillContextMenu();
  if (preserveScroll) {
    const workspace = document.querySelector<HTMLElement>(".workspace");
    const clientTab = document.querySelector<HTMLElement>(".client-tab-scroll");
    if (workspace) workspace.scrollTop = workspaceScrollTop;
    if (clientTab) clientTab.scrollTop = clientTabScrollTop;
  }
}

function bindInteractions(): void {
  document.querySelectorAll<HTMLButtonElement>(".client-row").forEach((button) => {
    button.addEventListener("click", () => {
      skillContextMenu = null;
      clientMenuOpen = false;
      activeClientIndex = Number(button.dataset.clientIndex ?? 0);
      activeClientTab = "skills";
      currentView = "clients";
      renderApp();
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      skillContextMenu = null;
      clientMenuOpen = false;
      currentView = (button.dataset.view as ViewName | undefined) ?? "clients";
      renderApp();
    });
  });
  document.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", (event) => {
      const next = (event as CustomEvent<ThemeName>).detail;
      if (next !== "dark" && next !== "light") return;
      setThemeMode(next);
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".theme-seg").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.themeMode;
      if (mode === "light" || mode === "dark" || mode === "system") setThemeMode(mode);
    });
  });
  document.querySelector<HTMLButtonElement>("#confirm-dialog-cancel")?.addEventListener("click", () => {
    confirmDialog = null;
    renderApp(true);
  });
  document.querySelector<HTMLButtonElement>("#confirm-dialog-confirm")?.addEventListener("click", () => {
    const dialog = confirmDialog;
    confirmDialog = null;
    renderApp(true);
    if (!dialog) return;
    if (dialog.kind === "client" && dialog.clientId) {
      void deleteClientConfig(dialog.clientId);
    } else {
      void deleteSkills(dialog.paths);
    }
  });
  document.querySelector<HTMLButtonElement>("#client-actions-toggle")?.addEventListener("click", (event) => {
    event.stopPropagation();
    clientMenuOpen = !clientMenuOpen;
    renderApp();
  });
  document.querySelectorAll<HTMLButtonElement>(".client-menu-item[data-client-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.clientAction;
      const clientId = button.dataset.clientId ?? "";
      if (!clientId) return;
      if (action === "export") {
        void exportClientConfig(clientId);
      } else if (action === "import") {
        void importClientConfig(clientId);
      } else if (action === "delete") {
        clientMenuOpen = false;
        confirmDialog = {
          title: "删除客户端配置",
          message: `确认删除 ${clientNameById(clientId)} 检测到的配置文件？会移动到 SMRmanager 回收目录，可恢复。`,
          confirmLabel: "删除",
          cancelLabel: "取消",
          paths: [],
          kind: "client",
          clientId
        };
        renderApp(true);
      }
    });
  });
  document.querySelector<HTMLButtonElement>("#import-skill-button")?.addEventListener("click", () => void startSkillImport());
  const importTargetSelect = document.querySelector<HTMLSelectElement>("#import-target-select");
  importTargetSelect?.addEventListener("change", () => {
    if (importSkillDialog) importSkillDialog.targetClientId = importTargetSelect.value;
  });
  document.querySelector<HTMLButtonElement>("#import-dialog-cancel")?.addEventListener("click", () => {
    importSkillDialog = null;
    renderApp(true);
  });
  document.querySelector<HTMLButtonElement>("#import-dialog-confirm")?.addEventListener("click", () => {
    const dialog = importSkillDialog;
    if (!dialog) return;
    const target = document.querySelector<HTMLSelectElement>("#import-target-select")?.value || dialog.targetClientId;
    void importSkill(dialog.sourceDir, target);
  });
  const marketInstallSelect = document.querySelector<HTMLSelectElement>("#market-install-target");
  marketInstallSelect?.addEventListener("change", () => {
    if (marketInstallDialog) marketInstallDialog.targetClientId = marketInstallSelect.value;
  });
  document.querySelector<HTMLButtonElement>("#market-install-cancel")?.addEventListener("click", () => {
    marketInstallDialog = null;
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#market-install-confirm")?.addEventListener("click", () => {
    const dialog = marketInstallDialog;
    if (!dialog) return;
    const skill = marketSkills.find((item) => item.id === dialog.skillId);
    const method = skill?.methods.find((item) => item.id === dialog.methodId);
    if (!skill || !method) return;
    const target = document.querySelector<HTMLSelectElement>("#market-install-target")?.value || dialog.targetClientId;
    marketInstallDialog = null;
    void installMarketSkill(skill, method, target);
  });
  const mcpInstallSelect = document.querySelector<HTMLSelectElement>("#mcp-install-target");
  mcpInstallSelect?.addEventListener("change", () => {
    if (mcpInstallDialog) mcpInstallDialog.targetClientId = mcpInstallSelect.value;
  });
  document.querySelector<HTMLButtonElement>("#mcp-install-cancel")?.addEventListener("click", () => {
    mcpInstallDialog = null;
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#mcp-install-confirm")?.addEventListener("click", () => {
    const dialog = mcpInstallDialog;
    if (!dialog) return;
    const mcp = marketMcps.find((item) => item.id === dialog.mcpId);
    if (!mcp) return;
    const target = document.querySelector<HTMLSelectElement>("#mcp-install-target")?.value || dialog.targetClientId;
    mcpInstallDialog = null;
    void installMcpServer(mcp, target);
  });
  document.querySelector<HTMLElement>(".alert-dialog-backdrop")?.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest(".alert-dialog")) return;
    confirmDialog = null;
    importSkillDialog = null;
    marketInstallDialog = null;
    mcpInstallDialog = null;
    renderApp(true);
  });
  document.querySelector<HTMLButtonElement>("#check-app-update")?.addEventListener("click", () => void checkUpdates(true));
  document.querySelector<HTMLButtonElement>("#open-release-page")?.addEventListener("click", () => {
    const url = updateInfo?.releaseUrl || updateInfo?.downloadUrl;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });
  document.querySelector<HTMLButtonElement>("#dismiss-update-version")?.addEventListener("click", () => {
    if (updateInfo?.latestVersion) localStorage.setItem(dismissedUpdateStorageKey, updateInfo.latestVersion);
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#sidebar-update-open")?.addEventListener("click", () => {
    currentView = "settings";
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#sidebar-update-dismiss")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (updateInfo?.latestVersion) localStorage.setItem(dismissedUpdateStorageKey, updateInfo.latestVersion);
    renderApp();
  });
  document.querySelectorAll<HTMLButtonElement>("#refresh-detection").forEach((button) => button.addEventListener("click", () => void loadEnvironment(true)));
  document.querySelectorAll<HTMLButtonElement>(".launch-client-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const clientId = button.dataset.clientId;
      if (!clientId) return;
      button.textContent = "启动中...";
      button.disabled = true;
      try {
        await invoke("launch_client", { clientId });
        button.textContent = "已启动";
      } catch (error) {
        button.textContent = "启动失败";
        installLogs[clientId] = error instanceof Error ? error.message : String(error);
      } finally {
        setTimeout(renderApp, 900);
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".install-button").forEach((button) => {
    button.addEventListener("click", () => {
      button.textContent = "已加入队列";
      button.classList.add("is-installed");
      button.disabled = true;
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".install-method-button").forEach((button) => {
    button.addEventListener("click", () => {
      const skill = marketSkills.find((item) => item.id === button.dataset.skillId);
      const method = skill?.methods.find((item) => item.id === button.dataset.methodId);
      if (!skill || !method) return;
      const targets = marketSkillTargets(skill);
      if (targets.length === 0) {
        setSkillActionMessage(`${skill.name} 不支持任何已安装客户端`, 4000);
        return;
      }
      marketInstallDialog = { skillId: skill.id, methodId: method.id, targetClientId: preferredSkillTargetId(targets) };
      renderApp();
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".market-page-tab[data-market-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      marketTab = button.dataset.marketTab === "mcp" ? "mcp" : "skill";
      renderApp();
    });
  });
  const mcpSearchInput = document.querySelector<HTMLInputElement>("#mcp-search-input");
  mcpSearchInput?.addEventListener("input", () => {
    const cursor = mcpSearchInput.selectionStart ?? mcpSearchInput.value.length;
    mcpQuery = mcpSearchInput.value;
    renderApp();
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLInputElement>("#mcp-search-input");
      next?.focus();
      next?.setSelectionRange(cursor, cursor);
    });
  });
  const mcpSortSelect = document.querySelector<HTMLSelectElement>("#mcp-sort-select");
  mcpSortSelect?.addEventListener("change", () => {
    mcpSort = mcpSortSelect.value === "transport" ? "transport" : "name";
    renderApp();
  });
  const marketSkillSearch = document.querySelector<HTMLInputElement>("#market-skill-search");
  marketSkillSearch?.addEventListener("input", () => {
    const cursor = marketSkillSearch.selectionStart ?? marketSkillSearch.value.length;
    marketSkillQuery = marketSkillSearch.value;
    renderApp();
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLInputElement>("#market-skill-search");
      next?.focus();
      next?.setSelectionRange(cursor, cursor);
    });
  });
  const marketSkillSortSelect = document.querySelector<HTMLSelectElement>("#market-skill-sort");
  marketSkillSortSelect?.addEventListener("change", () => {
    marketSkillSort = marketSkillSortSelect.value === "rating" ? "rating" : "name";
    renderApp();
  });
  document.querySelectorAll<HTMLButtonElement>(".category-pill[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      marketSkillCategory = button.dataset.category ?? "全部";
      renderApp();
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".mcp-install-button").forEach((button) => {
    button.addEventListener("click", () => {
      const mcp = marketMcps.find((item) => item.id === button.dataset.mcpId);
      if (!mcp) return;
      const targets = mcpTargetClients();
      if (targets.length === 0) {
        setSkillActionMessage("没有可写入 MCP 配置的已安装客户端", 4000);
        return;
      }
      mcpInstallDialog = { mcpId: mcp.id, targetClientId: targets[0].id };
      renderApp();
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".mcp-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const clientId = button.dataset.clientId;
      const name = button.dataset.mcpName;
      if (!clientId || !name) return;
      const enabled = button.dataset.enabled !== "1";
      void toggleMcpEnabled(clientId, name, enabled);
    });
  });
  document.querySelector<HTMLButtonElement>("#disable-all-mcp")?.addEventListener("click", () => void setAllMcpEnabled(false));
  document.querySelector<HTMLButtonElement>("#enable-all-mcp")?.addEventListener("click", () => void setAllMcpEnabled(true));
  document.querySelectorAll<HTMLButtonElement>(".square-button[data-open-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = button.dataset.openPath;
      if (!target) return;
      try {
        await invoke("open_path", { target });
      } catch (error) {
        setSkillActionMessage(`打开失败：${error instanceof Error ? error.message : String(error)}`, 4200);
      }
    });
  });
  const skillSearchInput = document.querySelector<HTMLInputElement>("#skill-search-input");
  skillSearchInput?.addEventListener("input", () => {
    const input = skillSearchInput;
    const cursor = input.selectionStart ?? input.value.length;
    skillQuery = input.value;
    renderApp();
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLInputElement>("#skill-search-input");
      next?.focus();
      next?.setSelectionRange(cursor, cursor);
    });
  });
  const skillClientSelect = document.querySelector<HTMLSelectElement>("#skill-client-filter");
  skillClientSelect?.addEventListener("change", () => {
    skillClientFilter = skillClientSelect.value;
    selectedSkillKeys.clear();
    renderApp();
  });
  const skillStatusSelect = document.querySelector<HTMLSelectElement>("#skill-status-filter");
  skillStatusSelect?.addEventListener("change", () => {
    skillStatusFilter = skillStatusSelect.value;
    selectedSkillKeys.clear();
    renderApp();
  });
  const bulkSkillTarget = document.querySelector<HTMLSelectElement>("#bulk-skill-target");
  bulkSkillTarget?.addEventListener("change", () => {
    skillBulkTargetId = bulkSkillTarget.value;
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#copy-selected-skills")?.addEventListener("click", () => {
    const target = document.querySelector<HTMLSelectElement>("#bulk-skill-target")?.value || skillBulkTargetId;
    void transferSkills(selectedPathsFromKeys(), target, "copy");
  });
  document.querySelector<HTMLButtonElement>("#move-selected-skills")?.addEventListener("click", () => {
    const target = document.querySelector<HTMLSelectElement>("#bulk-skill-target")?.value || skillBulkTargetId;
    void transferSkills(selectedPathsFromKeys(), target, "move");
  });
  document.querySelectorAll<HTMLInputElement>(".skill-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const key = checkbox.dataset.skillKey;
      if (!key) return;
      if (checkbox.checked) selectedSkillKeys.add(key);
      else selectedSkillKeys.delete(key);
      renderApp();
    });
  });
  const selectAllSkills = document.querySelector<HTMLInputElement>("#select-all-skills");
  selectAllSkills?.addEventListener("change", () => {
    const checked = selectAllSkills.checked;
    document.querySelectorAll<HTMLInputElement>(".skill-checkbox").forEach((checkbox) => {
      const key = checkbox.dataset.skillKey;
      if (!key) return;
      if (checked) selectedSkillKeys.add(key);
      else selectedSkillKeys.delete(key);
    });
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#clear-skill-selection")?.addEventListener("click", () => {
    selectedSkillKeys.clear();
    renderApp();
  });
  document.querySelectorAll<HTMLButtonElement>(".skills-view-button[data-skill-view]").forEach((button) => {
    button.addEventListener("click", () => {
      skillGridView = button.dataset.skillView === "grid";
      renderApp();
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".pager-btn[data-pager]").forEach((button) => {
    button.addEventListener("click", () => {
      const scope = button.dataset.pager;
      const dir = button.dataset.page === "next" ? 1 : -1;
      if (scope === "skill") skillPage = Math.max(1, skillPage + dir);
      else if (scope === "rule") rulePage = Math.max(1, rulePage + dir);
      renderApp();
    });
  });
  document.querySelectorAll<HTMLSelectElement>(".pager-size[data-pager-size]").forEach((select) => {
    select.addEventListener("change", () => {
      const size = Number(select.value);
      if (Number.isFinite(size) && size > 0) listPageSize = size;
      skillPage = 1;
      rulePage = 1;
      renderApp();
    });
  });
  document.querySelector<HTMLButtonElement>("#delete-selected-skills")?.addEventListener("click", () => {
    const paths = selectedPathsFromKeys();
    if (paths.length === 0) return;
    openDeleteSkillsDialog(paths);
  });
  document.querySelectorAll<HTMLButtonElement>(".skill-delete-button").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.deleteSkillPath;
      if (!path) return;
      const name = button.dataset.skillName ?? "该 Skill";
      openDeleteSkillsDialog([path], name);
    });
  });
  document.querySelectorAll<HTMLElement>(".skill-list-row[data-skill-key], .client-skill-row[data-skill-key]").forEach((row) => {
    row.addEventListener("contextmenu", (event) => {
      const key = row.dataset.skillKey;
      const path = row.dataset.skillPath;
      if (!key || !path) return;
      event.preventDefault();
      openSkillContextMenu({ key, path, x: event.clientX, y: event.clientY });
    });
  });
  document.querySelector<HTMLElement>(".app-shell")?.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (clientMenuOpen && !target?.closest(".client-menu-wrap")) {
      clientMenuOpen = false;
      renderApp();
      return;
    }
    if (!skillContextMenu) return;
    if (target?.closest(".skill-context-menu")) return;
    closeSkillContextMenu();
  });
  document.querySelectorAll<HTMLButtonElement>(".tab[data-client-tab]").forEach((button) => button.addEventListener("click", () => {
    skillContextMenu = null;
    activeClientTab = (button.dataset.clientTab as ClientTab | undefined) ?? "skills";
    renderApp();
  }));
  const currentWindow = getCurrentWindow();
  document.querySelector<HTMLButtonElement>("#titlebar-minimize")?.addEventListener("click", () => void currentWindow.minimize().catch(console.error));
  document.querySelector<HTMLButtonElement>("#titlebar-maximize")?.addEventListener("click", () => void currentWindow.toggleMaximize().catch(console.error));
  document.querySelector<HTMLButtonElement>("#titlebar-close")?.addEventListener("click", () => void currentWindow.close().catch(console.error));
}

if (import.meta.hot) {
  import.meta.hot.dispose((data: HotState) => {
    data.activeClientIndex = activeClientIndex;
    data.activeClientTab = activeClientTab;
    data.currentView = currentView;
    data.themeMode = themeMode;
    data.environment = environment;
    data.detectionError = detectionError;
    data.installLogs = installLogs;
    data.selectedSkillKeys = [...selectedSkillKeys];
    data.skillBulkTargetId = skillBulkTargetId;
    data.skillQuery = skillQuery;
    data.skillClientFilter = skillClientFilter;
    data.skillStatusFilter = skillStatusFilter;
    data.updateInfo = updateInfo;
    data.updateError = updateError;
    data.updateChecking = updateChecking;
    appRoot.innerHTML = "";
  });
  import.meta.hot.accept();
}

// 主题“跟随系统”时，随系统日夜变化自动切换。
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (themeMode !== "system") return;
  currentTheme = resolveTheme(themeMode);
  applyThemeToDocument();
  syncThemeControls();
});

renderApp();
void loadEnvironment();
void refreshInstalledMarketSkills();
