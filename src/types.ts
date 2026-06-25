// 全局类型定义（从 main.ts 抽出）。

export type ViewName = "clients" | "skills" | "wsl" | "mcp" | "rules" | "market" | "settings";
export type ClientTab = "skills" | "mcp" | "rules" | "settings";
export type ThemeName = "light" | "dark";
export type ThemeMode = "light" | "dark" | "system";
export type InstallMethodId = "npm" | "npx" | "pnpm" | "github" | "json";
export type SkillTransferAction = "copy" | "move";

export type Client = {
  id: string;
  name: string;
  type: string;
  fallbackPath: string;
  description: string;
  iconFile: string;
  installUrl: string;
};

export type RuntimeClient = {
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
  source?: string;
  rootLabel?: string | null;
};

export type ScanRoot = { tag: string; label: string; path: string; kind: "wsl" | "custom" };
export type WslDistro = { distro: string; user: string; homeUnc: string; running: boolean; isDefault: boolean };
export type GitSkillEntry = { relPath: string; name: string; description: string };
export type GitMcpEntry = { name: string; transport: string; command?: string | null; args?: string[] | null; url?: string | null };
export type GitInspectResult = { cachePath: string; skills: GitSkillEntry[]; mcpServers: GitMcpEntry[] };
export type GitApplyResult = { skillsInstalled: number; mcpInstalled: number; failed: string[]; message: string };
export type GitInstallDialogState = { url: string; subdir: string; loading: boolean; inspected: GitInspectResult | null; error: string | null };

export type RuntimeMcpServer = {
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

export type RuntimeSkill = {
  directory: string;
  name: string;
  description?: string | null;
  clientId: string;
  clientName: string;
  path: string;
  managed: boolean;
  updatedAt?: string | null;
  tags?: string[];
  linked?: boolean;
  linkedClients?: string[];
};

export type SkillGroup = {
  id: string;
  name: string;
  memberKeys: string[];
};

export type SkillGroupDialogState = {
  mode: "create" | "rename";
  id?: string;
  name: string;
  addSelected?: boolean;
};

export type RuntimeRule = {
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

export type DetectionSnapshot = {
  clients: RuntimeClient[];
  mcpServers: RuntimeMcpServer[];
  skills: RuntimeSkill[];
  rules: RuntimeRule[];
  scannedAt: string;
};

export type InstallMethod = {
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

export type MarketSkill = {
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

export type MarketMcp = {
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

export type InstallResult = {
  success: boolean;
  message: string;
  log: string;
  installedPath?: string | null;
};

export type DeleteSkillsResult = {
  deleted: number;
  movedToTrash: string[];
  failed: string[];
  message: string;
};

export type TransferSkillsResult = {
  copied: number;
  moved: number;
  targetClientId: string;
  targetClientName: string;
  targetRoot: string;
  writtenPaths: string[];
  failed: string[];
  message: string;
};

export type ImportSkillResult = {
  imported: boolean;
  targetClientId: string;
  targetClientName: string;
  targetPath: string;
  message: string;
};

export type ImportSkillDialogState = {
  sourceDir: string;
  targetClientId: string;
};

export type MarketInstallDialogState = {
  skillId: string;
  methodId: string;
  targetClientId: string;
};

export type McpInstallDialogState = {
  mcpId: string;
  targetClientId: string;
};

export type SkillContextMenuState = {
  key: string;
  path: string;
  x: number;
  y: number;
};

export type RuleContextMenuState = {
  path: string;
  clientId: string;
  x: number;
  y: number;
};

export type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  paths: string[];
  kind?: "skills" | "client" | "group" | "rules";
  clientId?: string;
  groupId?: string;
};

export type AppUpdateCheckResult = {
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

export type HotState = {
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
  skillTagFilter?: string;
  activeSkillGroupId?: string;
  updateInfo?: AppUpdateCheckResult | null;
  updateError?: string | null;
  updateChecking?: boolean;
};
