// API 层：收口所有 Tauri 命令调用为类型安全函数。
// 命令全集与后端签名见 src-tauri/src/lib.rs 的 invoke_handler 及 detection.rs / installer.rs / updates.rs。
import { invoke } from "@tauri-apps/api/core";
import type {
  ScanRoot,
  SkillTransferAction,
  DetectionSnapshot,
  WslDistro,
  DeleteSkillsResult,
  TransferSkillsResult,
  ImportSkillResult,
  InstallResult,
  AppUpdateCheckResult,
  GitInspectResult,
  GitApplyResult,
  GitMcpEntry,
  LibraryOpResult
} from "../types";

export const api = {
  // —— 环境检测 / 更新 ——
  detectEnvironment: (extraRoots: ScanRoot[]) =>
    invoke<DetectionSnapshot>("detect_environment", { extraRoots }),
  checkAppUpdate: (endpoint: string | null = null) =>
    invoke<AppUpdateCheckResult>("check_app_update", { endpoint }),

  // —— WSL ——
  listWslDistros: () => invoke<WslDistro[]>("list_wsl_distros"),
  wslSetDefault: (distro: string) => invoke<void>("wsl_set_default", { distro }),
  wslStart: (distro: string) => invoke<void>("wsl_start", { distro }),
  wslTerminate: (distro: string) => invoke<void>("wsl_terminate", { distro }),
  wslOpenTerminal: (distro: string) => invoke<void>("wsl_open_terminal", { distro }),

  // —— 终端 / 项目内启动 ——
  openTerminalAt: (path: string) => invoke<void>("open_terminal_at", { path }),
  launchClientInProject: (projectPath: string, clientId: string) =>
    invoke<void>("launch_client_in_project", { projectPath, clientId }),
  setProjectSkillEnabled: (projectPath: string, clientId: string, skillDir: string, enabled: boolean) =>
    invoke<string>("set_project_skill_enabled", { projectPath, clientId, skillDir, enabled }),

  // —— Skills ——
  deleteSkills: (paths: string[]) => invoke<DeleteSkillsResult>("delete_skills", { paths }),
  transferSkills: (paths: string[], targetClientId: string, action: SkillTransferAction, extraRoots: ScanRoot[]) =>
    invoke<TransferSkillsResult>("transfer_skills", { paths, targetClientId, action, extraRoots }),
  importSkill: (sourceDir: string, targetClientId: string) =>
    invoke<ImportSkillResult>("import_skill", { sourceDir, targetClientId }),

  // —— 中心库 ——
  adoptSkillsToLibrary: (paths: string[], extraRoots: ScanRoot[]) =>
    invoke<LibraryOpResult>("adopt_skills_to_library", { paths, extraRoots }),
  linkSkillToClients: (librarySkillPath: string, clientIds: string[]) =>
    invoke<LibraryOpResult>("link_skill_to_clients", { librarySkillPath, clientIds }),
  unlinkSkillFromClients: (librarySkillPath: string, clientIds: string[]) =>
    invoke<LibraryOpResult>("unlink_skill_from_clients", { librarySkillPath, clientIds }),

  // —— Rules ——
  copyRuleToClient: (rulePath: string, targetClientId: string) =>
    invoke<string>("copy_rule_to_client", { rulePath, targetClientId }),
  deleteRules: (paths: string[]) => invoke<DeleteSkillsResult>("delete_rules", { paths }),

  // —— MCP ——
  installMcpServer: (
    clientId: string,
    server: { name: string; transport: string; command: string | null; args: string[] | null; url: string | null }
  ) => invoke<string>("install_mcp_server", { clientId, server }),
  setMcpEnabled: (clientId: string, name: string, enabled: boolean) =>
    invoke<string>("set_mcp_enabled", { clientId, name, enabled }),
  setAllMcpEnabled: (enabled: boolean) => invoke<string>("set_all_mcp_enabled", { enabled }),

  // —— 客户端配置 ——
  launchClient: (clientId: string) => invoke<void>("launch_client", { clientId }),
  exportClientConfig: (clientId: string, targetDir: string) =>
    invoke<string>("export_client_config", { clientId, targetDir }),
  importClientConfig: (clientId: string, sourceFile: string) =>
    invoke<string>("import_client_config", { clientId, sourceFile }),
  deleteClientConfig: (clientId: string) => invoke<string>("delete_client_config", { clientId }),
  openPath: (target: string) => invoke<void>("open_path", { target }),

  // —— 用户备注（~/.smrmanager/notes.json）——
  getNotes: () => invoke<Record<string, string>>("get_notes"),
  setNote: (key: string, note: string) => invoke<void>("set_note", { key, note }),
  setAllNotes: (notes: Record<string, string>) => invoke<void>("set_all_notes", { notes }),

  // —— WebDAV 备份 ——
  webdavPut: (url: string, username: string, password: string, content: string) =>
    invoke<void>("webdav_put", { url, username, password, content }),
  webdavGet: (url: string, username: string, password: string) =>
    invoke<string>("webdav_get", { url, username, password }),

  // —— 市场 / Git 安装 ——
  installMarketSkill: (request: {
    skillId: string;
    name: string;
    method: string;
    packageName?: string;
    args?: string[];
    repository?: string;
    subdir?: string;
    registryUrl?: string;
    manifestUrl?: string;
    targetClientId: string;
  }) => invoke<InstallResult>("install_market_skill", { request }),
  checkGlobalPackages: (packages: string[]) => invoke<string[]>("check_global_packages", { packages }),
  gitInspect: (url: string, subdir: string | null) =>
    invoke<GitInspectResult>("git_inspect", { url, subdir }),
  gitApply: (payload: {
    cachePath: string;
    skillRelPaths: string[];
    skillTarget: string | null;
    mcpServers: GitMcpEntry[];
    mcpClientId: string | null;
  }) => invoke<GitApplyResult>("git_apply", payload)
};
