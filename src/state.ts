// 全局可变状态（从 main.ts 抽出）。
// ES module 的 let 导出不能跨模块重新赋值，故所有可变状态收进一个 state 对象：
// render 读 state.x，事件/异步逻辑写 state.x = v。
import type {
  ViewName,
  ClientTab,
  ThemeName,
  ThemeMode,
  ScanRoot,
  ProjectEntry,
  WslDistro,
  GitInstallDialogState,
  SkillGroup,
  SkillGroupDialogState,
  DetectionSnapshot,
  SkillContextMenuState,
  RuleContextMenuState,
  ConfirmDialogState,
  ImportSkillDialogState,
  MarketInstallDialogState,
  McpInstallDialogState,
  AppUpdateCheckResult,
  HotState
} from "./types";
import { resolveTheme } from "./dom";

export const themeStorageKey = "smrmanager-theme";
export const dismissedUpdateStorageKey = "smrmanager-update-dismissed-version";
const skillGroupsStorageKey = "smrmanager-skill-groups";
const scanRootsStorageKey = "smrmanager-scan-roots";
const clientOrderStorageKey = "smrmanager-client-order";
const projectsStorageKey = "smrmanager-projects";

export function readStoredThemeMode(): ThemeMode {
  const stored = localStorage.getItem(themeStorageKey);
  if (stored === "dark" || stored === "light" || stored === "system") return stored;
  return "system";
}

export function loadSkillGroups(): SkillGroup[] {
  try {
    const raw = localStorage.getItem(skillGroupsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SkillGroup =>
          Boolean(item) &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          Array.isArray(item.memberKeys)
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        memberKeys: item.memberKeys.filter((key: unknown): key is string => typeof key === "string")
      }));
  } catch {
    return [];
  }
}

export function loadScanRoots(): ScanRoot[] {
  try {
    const raw = localStorage.getItem(scanRootsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ScanRoot =>
          Boolean(item) &&
          typeof item.tag === "string" &&
          typeof item.label === "string" &&
          typeof item.path === "string"
      )
      .map((item) => ({
        tag: item.tag,
        label: item.label,
        path: item.path,
        kind: item.kind === "wsl" ? "wsl" : "custom"
      }));
  } catch {
    return [];
  }
}

export function loadClientOrder(): string[] {
  try {
    const raw = localStorage.getItem(clientOrderStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function loadProjects(): ProjectEntry[] {
  try {
    const raw = localStorage.getItem(projectsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ProjectEntry =>
          Boolean(item) &&
          typeof item.id === "string" &&
          typeof item.label === "string" &&
          typeof item.path === "string"
      )
      .map((item) => ({ id: item.id, label: item.label, path: item.path }));
  } catch {
    return [];
  }
}

export const hotState = import.meta.hot?.data as HotState | undefined;
const hotView = hotState?.currentView as ViewName | "roles" | undefined;
const initialThemeMode: ThemeMode = hotState?.themeMode ?? readStoredThemeMode();

export type AppState = {
  activeClientIndex: number;
  activeClientTab: ClientTab;
  currentView: ViewName;
  themeMode: ThemeMode;
  currentTheme: ThemeName;
  environment: DetectionSnapshot | null;
  detectionLoading: boolean;
  detectionError: string | null;
  installingKey: string | null;
  installLogs: Record<string, string>;
  installedMarketSkillIds: Set<string>;
  selectedSkillKeys: Set<string>;
  skillBulkTargetId: string;
  skillContextMenu: SkillContextMenuState | null;
  ruleContextMenu: RuleContextMenuState | null;
  clientMenuOpen: boolean;
  confirmDialog: ConfirmDialogState | null;
  importSkillDialog: ImportSkillDialogState | null;
  marketInstallDialog: MarketInstallDialogState | null;
  marketTab: "skill" | "mcp";
  mcpQuery: string;
  mcpSort: "name" | "transport";
  marketSkillQuery: string;
  marketSkillSort: "name" | "rating";
  marketSkillCategory: string;
  mcpInstallDialog: McpInstallDialogState | null;
  skillTransferBusy: boolean;
  skillQuery: string;
  skillClientFilter: string;
  skillStatusFilter: string;
  skillTagFilter: string;
  activeSkillGroupId: string;
  skillGroups: SkillGroup[];
  scanRoots: ScanRoot[];
  clientOrder: string[];
  projects: ProjectEntry[];
  activeProjectId: string;
  activeProjectClientId: string;
  projectSkillFilter: "all" | "enabled" | "disabled";
  projectAddSkillDialog: { clientId: string } | null;
  projectAddSkillQuery: string;
  wslDistros: WslDistro[];
  wslDetecting: boolean;
  wslDetectError: string | null;
  activeWslDistro: string;
  activeWslTab: "overview" | "skills" | "mcp" | "rules" | "settings";
  selectedWslSkillPath: string;
  wslActiveClientId: string;
  wslInstancesLoaded: boolean;
  skillGroupDialog: SkillGroupDialogState | null;
  skillLinkDialog: { skillPath: string; skillName: string } | null;
  gitInstallDialog: GitInstallDialogState | null;
  skillGridView: boolean;
  skillPage: number;
  rulePage: number;
  listPageSize: number;
  skillActionMessageTimer: number | null;
  deleteBusy: boolean;
  updateInfo: AppUpdateCheckResult | null;
  updateError: string | null;
  updateChecking: boolean;
  activeToast: HTMLElement | null;
};

export const state: AppState = {
  activeClientIndex: hotState?.activeClientIndex ?? 0,
  activeClientTab: hotState?.activeClientTab ?? "skills",
  currentView: hotView === "roles" ? "rules" : hotView ?? "clients",
  themeMode: initialThemeMode,
  currentTheme: resolveTheme(initialThemeMode),
  environment: hotState?.environment ?? null,
  detectionLoading: false,
  detectionError: hotState?.detectionError ?? null,
  installingKey: null,
  installLogs: hotState?.installLogs ?? {},
  installedMarketSkillIds: new Set<string>(),
  selectedSkillKeys: new Set<string>(hotState?.selectedSkillKeys ?? []),
  skillBulkTargetId: hotState?.skillBulkTargetId ?? "",
  skillContextMenu: null,
  ruleContextMenu: null,
  clientMenuOpen: false,
  confirmDialog: null,
  importSkillDialog: null,
  marketInstallDialog: null,
  marketTab: "skill",
  mcpQuery: "",
  mcpSort: "name",
  marketSkillQuery: "",
  marketSkillSort: "name",
  marketSkillCategory: "全部",
  mcpInstallDialog: null,
  skillTransferBusy: false,
  skillQuery: hotState?.skillQuery ?? "",
  skillClientFilter: hotState?.skillClientFilter ?? "all",
  skillStatusFilter: hotState?.skillStatusFilter ?? "all",
  skillTagFilter: hotState?.skillTagFilter ?? "all",
  activeSkillGroupId: hotState?.activeSkillGroupId ?? "",
  skillGroups: loadSkillGroups(),
  scanRoots: loadScanRoots(),
  clientOrder: loadClientOrder(),
  projects: loadProjects(),
  activeProjectId: "",
  activeProjectClientId: "",
  projectSkillFilter: "all",
  projectAddSkillDialog: null,
  projectAddSkillQuery: "",
  wslDistros: [],
  wslDetecting: false,
  wslDetectError: null,
  activeWslDistro: "",
  activeWslTab: "skills",
  selectedWslSkillPath: "",
  wslActiveClientId: "",
  wslInstancesLoaded: false,
  skillGroupDialog: null,
  skillLinkDialog: null,
  gitInstallDialog: null,
  skillGridView: false,
  skillPage: 1,
  rulePage: 1,
  listPageSize: 10,
  skillActionMessageTimer: null,
  deleteBusy: false,
  updateInfo: hotState?.updateInfo ?? null,
  updateError: hotState?.updateError ?? null,
  updateChecking: hotState?.updateChecking ?? false,
  activeToast: null
};

export function saveSkillGroups(): void {
  try {
    localStorage.setItem(skillGroupsStorageKey, JSON.stringify(state.skillGroups));
  } catch {
    // 持久化失败（如隐私模式/配额）忽略，不影响本会话内的分组使用。
  }
}

export function saveScanRoots(): void {
  try {
    localStorage.setItem(scanRootsStorageKey, JSON.stringify(state.scanRoots));
  } catch {
    // 持久化失败忽略。
  }
}

export function saveClientOrder(): void {
  try {
    localStorage.setItem(clientOrderStorageKey, JSON.stringify(state.clientOrder));
  } catch {
    // 持久化失败忽略。
  }
}

export function saveProjects(): void {
  try {
    localStorage.setItem(projectsStorageKey, JSON.stringify(state.projects));
  } catch {
    // 持久化失败忽略。
  }
}
