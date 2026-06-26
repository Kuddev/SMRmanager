import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import "./day-night-toggle";
import "./styles.css";

import type {
  ViewName,
  ClientTab,
  ThemeName,
  ThemeMode,
  InstallMethodId,
  SkillTransferAction,
  Client,
  RuntimeClient,
  ScanRoot,
  WslDistro,
  GitInspectResult,
  GitApplyResult,
  GitInstallDialogState,
  RuntimeMcpServer,
  RuntimeSkill,
  SkillGroup,
  SkillGroupDialogState,
  RuntimeRule,
  DetectionSnapshot,
  InstallMethod,
  MarketSkill,
  MarketMcp,
  InstallResult,
  DeleteSkillsResult,
  TransferSkillsResult,
  ImportSkillResult,
  ImportSkillDialogState,
  MarketInstallDialogState,
  McpInstallDialogState,
  SkillContextMenuState,
  RuleContextMenuState,
  ConfirmDialogState,
  AppUpdateCheckResult,
  HotState
} from "./types";


import { navItems, clients, availableMcps, marketSkills, marketMcps } from "./catalog";
import { api } from "./core/api";
import {
  runtime,
  clientMcps,
  clientSkills,
  clientRules,
  installedClients,
  extraRuntimeClients,
  orderedBaseClients,
  displayClients,
  extraClientIdSet,
  isExtraSourceSkill,
  skillTargetClients,
  skillByPath,
  selectedPathsFromKeys,
  transferPathsForContext,
  preferredSkillTargetId,
  clientNameById,
  marketSkillTargets,
  mcpTargetClients,
  skillWritableClientIds,
  mcpWritableClientIds
} from "./core/data";
import { setSkillActionMessage } from "./core/toast";
import {
  systemPrefersDark,
  resolveTheme,
  html,
  iconPath,
  img,
  svgIcon,
  distroIcon,
  skillKey,
  epoch,
  updateTimestamp
} from "./dom";

import { renderSettingsView } from "./views/settings";

import {
  state,
  saveSkillGroups,
  saveScanRoots,
  saveClientOrder,
  saveProjects,
  themeStorageKey,
  dismissedUpdateStorageKey
} from "./state";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("App root element not found.");
const appRoot: HTMLDivElement = appElement;

function addScanRoot(root: ScanRoot): void {
  const path = root.path.trim();
  if (!path) return;
  if (state.scanRoots.some((item) => item.path.toLowerCase() === path.toLowerCase())) {
    setSkillActionMessage("该扫描目录已添加", 2600);
    return;
  }
  state.scanRoots = [...state.scanRoots, { ...root, path }];
  saveScanRoots();
  void loadEnvironment(true);
}

function removeScanRoot(tag: string): void {
  state.scanRoots = state.scanRoots.filter((item) => item.tag !== tag);
  saveScanRoots();
  void loadEnvironment(true);
}

async function detectWslDistros(): Promise<void> {
  if (state.wslDetecting) return;
  state.wslDetecting = true;
  state.wslDetectError = null;
  renderApp(true);
  try {
    state.wslDistros = await api.listWslDistros();
    if (state.wslDistros.length === 0) state.wslDetectError = "未检测到 WSL 发行版";
  } catch (error) {
    state.wslDistros = [];
    state.wslDetectError = error instanceof Error ? error.message : String(error);
  } finally {
    state.wslDetecting = false;
    renderApp(true);
  }
}

function addWslDistroAsRoot(distro: WslDistro): void {
  addScanRoot({
    tag: `wsl-${distro.distro}`,
    label: `WSL: ${distro.distro}`,
    path: distro.homeUnc,
    kind: "wsl"
  });
}


// —— 数据访问 / Model 层（runtime / displayClients / clientSkills 等）已抽到 core/data.ts ——

function isUpdateDismissed(): boolean {
  const version = state.updateInfo?.latestVersion;
  return Boolean(version && localStorage.getItem(dismissedUpdateStorageKey) === version);
}

function visibleUpdateAvailable(): boolean {
  return Boolean(state.updateInfo?.available && state.updateInfo.latestVersion && !isUpdateDismissed());
}

// 已注册项目转成 kind:"project" 的扫描根；后端据此用项目级布局（.claude/skills、AGENTS.md…）扫描。
function projectRoots(): ScanRoot[] {
  return state.projects.map((p): ScanRoot => ({ tag: `proj-${p.id}`, label: p.label, path: p.path, kind: "project" }));
}

// 传给后端 detect_environment / transfer 的全部扩展根：WSL/自定义 + 项目。
function allExtraRoots(): ScanRoot[] {
  return [...state.scanRoots, ...projectRoots()];
}

async function loadEnvironment(force = false): Promise<void> {
  if (state.detectionLoading && !force) return;
  state.detectionLoading = true;
  renderApp(true);
  try {
    state.environment = await api.detectEnvironment(allExtraRoots());
    state.detectionError = null;
    const list = displayClients();
    const selected = list[state.activeClientIndex] ?? list[0];
    const firstInstalled = list.findIndex((item) => runtime(item)?.installed);
    if (!runtime(selected)?.installed && firstInstalled >= 0) state.activeClientIndex = firstInstalled;
  } catch (error) {
    state.detectionError = error instanceof Error ? error.message : String(error);
  } finally {
    state.detectionLoading = false;
    renderApp(true);
  }
}

async function checkUpdates(manual = false): Promise<void> {
  if (state.updateChecking) return;
  state.updateChecking = true;
  if (manual) state.updateError = null;
  renderApp();
  try {
    state.updateInfo = await api.checkAppUpdate(null);
    state.updateError = null;
  } catch (error) {
    state.updateError = error instanceof Error ? error.message : String(error);
    if (manual) state.updateInfo = null;
  } finally {
    state.updateChecking = false;
    renderApp();
  }
}

// —— Toast 反馈层（setSkillActionMessage 等）已抽到 core/toast.ts ——

async function deleteSkills(paths: string[]): Promise<void> {
  const uniquePaths = [...new Set(paths)].filter(Boolean);
  if (uniquePaths.length === 0 || state.deleteBusy) return;
  state.deleteBusy = true;
  setSkillActionMessage(`正在删除 ${uniquePaths.length} 个 Skill...`, 0);
  try {
    const result = await api.deleteSkills(uniquePaths);
    const removedPaths = new Set(uniquePaths);
    for (const key of [...state.selectedSkillKeys]) {
      if (removedPaths.has(key.slice(key.indexOf("::") + 2))) state.selectedSkillKeys.delete(key);
    }
    const failedText = result.failed.length ? `；失败 ${result.failed.length} 个：${result.failed.join(" / ")}` : "";
    state.deleteBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`${result.message}${failedText}`, result.failed.length ? 5200 : 2600);
  } catch (error) {
    state.deleteBusy = false;
    setSkillActionMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

function generateGroupId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function findSkillGroup(id: string): SkillGroup | undefined {
  return state.skillGroups.find((group) => group.id === id);
}

// 分组中在当前检测环境里真实存在的成员数量。
function groupMemberCount(group: SkillGroup): number {
  const keys = new Set((state.environment?.skills ?? []).map((skill) => skillKey(skill)));
  return group.memberKeys.filter((key) => keys.has(key)).length;
}

// 把分组成员解析成去重后的实际 Skill 路径（已失效的成员自动丢弃）。
function groupMemberPaths(group: SkillGroup): string[] {
  const members = new Set(group.memberKeys);
  const paths = new Set<string>();
  for (const skill of state.environment?.skills ?? []) {
    if (members.has(skillKey(skill))) paths.add(skill.path);
  }
  return [...paths];
}

function createSkillGroup(name: string, memberKeys: string[] = []): SkillGroup {
  const group: SkillGroup = {
    id: generateGroupId(),
    name: name.trim() || "未命名分组",
    memberKeys: [...new Set(memberKeys)]
  };
  state.skillGroups = [...state.skillGroups, group];
  saveSkillGroups();
  return group;
}

function renameSkillGroup(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  state.skillGroups = state.skillGroups.map((group) => (group.id === id ? { ...group, name: trimmed } : group));
  saveSkillGroups();
}

function deleteSkillGroup(id: string): void {
  const group = findSkillGroup(id);
  state.skillGroups = state.skillGroups.filter((item) => item.id !== id);
  if (state.activeSkillGroupId === id) state.activeSkillGroupId = "";
  saveSkillGroups();
  if (group) setSkillActionMessage(`已删除分组「${group.name}」（Skill 文件未改动）`, 2600);
}

function addSelectedToGroup(id: string): void {
  const group = findSkillGroup(id);
  if (!group || state.selectedSkillKeys.size === 0) return;
  const keys = new Set(group.memberKeys);
  let added = 0;
  for (const key of state.selectedSkillKeys) {
    if (!keys.has(key)) {
      keys.add(key);
      added += 1;
    }
  }
  group.memberKeys = [...keys];
  saveSkillGroups();
  setSkillActionMessage(
    added > 0 ? `已加入 ${added} 个 Skill 到分组「${group.name}」` : `选中项已全部在分组「${group.name}」中`,
    2600
  );
}

function removeSelectedFromGroup(id: string): void {
  const group = findSkillGroup(id);
  if (!group || state.selectedSkillKeys.size === 0) return;
  const before = group.memberKeys.length;
  group.memberKeys = group.memberKeys.filter((key) => !state.selectedSkillKeys.has(key));
  saveSkillGroups();
  setSkillActionMessage(`已从分组「${group.name}」移除 ${before - group.memberKeys.length} 个 Skill`, 2600);
}

// 一键把整组复制到目标客户端（复用批量赋予后端，自带校验/去重/失败收集）。
function assignGroupToClient(id: string, targetClientId: string): void {
  const group = findSkillGroup(id);
  if (!group || !targetClientId) return;
  const paths = groupMemberPaths(group);
  if (paths.length === 0) {
    setSkillActionMessage(`分组「${group.name}」没有可赋予的 Skill`, 3200);
    return;
  }
  void transferSkills(paths, targetClientId, "copy");
}

function openCreateGroupDialog(addSelected = false): void {
  state.skillGroupDialog = { mode: "create", name: "", addSelected };
  renderApp(true);
}

function openRenameGroupDialog(id: string): void {
  const group = findSkillGroup(id);
  if (!group) return;
  state.skillGroupDialog = { mode: "rename", id, name: group.name };
  renderApp(true);
}

function confirmSkillGroupDialog(name: string): void {
  const dialog = state.skillGroupDialog;
  if (!dialog) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  if (dialog.mode === "create") {
    const group = createSkillGroup(trimmed, dialog.addSelected ? [...state.selectedSkillKeys] : []);
    state.activeSkillGroupId = group.id;
    setSkillActionMessage(
      dialog.addSelected ? `已新建分组「${group.name}」并加入 ${group.memberKeys.length} 个 Skill` : `已新建分组「${group.name}」`,
      2600
    );
  } else if (dialog.id) {
    renameSkillGroup(dialog.id, trimmed);
  }
  state.skillGroupDialog = null;
  renderApp(true);
}

function openGitInstall(): void {
  state.gitInstallDialog = { url: "", subdir: "", loading: false, inspected: null, error: null };
  renderApp(true);
}

async function gitInspect(): Promise<void> {
  if (!state.gitInstallDialog || state.gitInstallDialog.loading) return;
  const url = state.gitInstallDialog.url.trim();
  if (!url) {
    state.gitInstallDialog.error = "请填写 Git 仓库地址";
    renderApp(true);
    return;
  }
  state.gitInstallDialog.loading = true;
  state.gitInstallDialog.error = null;
  state.gitInstallDialog.inspected = null;
  renderApp(true);
  try {
    const res = await api.gitInspect(url, state.gitInstallDialog.subdir.trim() || null);
    if (!state.gitInstallDialog) return;
    state.gitInstallDialog.inspected = res;
    state.gitInstallDialog.loading = false;
    if (res.skills.length === 0 && res.mcpServers.length === 0) state.gitInstallDialog.error = "未在该仓库发现 Skill 或 MCP 声明";
    renderApp(true);
  } catch (e) {
    if (!state.gitInstallDialog) return;
    state.gitInstallDialog.loading = false;
    state.gitInstallDialog.inspected = null;
    state.gitInstallDialog.error = e instanceof Error ? e.message : String(e);
    renderApp(true);
  }
}

async function gitApply(): Promise<void> {
  if (!state.gitInstallDialog?.inspected || state.gitInstallDialog.loading) return;
  const insp = state.gitInstallDialog.inspected;
  const skillRelPaths = [...document.querySelectorAll<HTMLInputElement>(".git-skill-check")]
    .filter((c) => c.checked)
    .map((c) => c.dataset.relPath ?? "")
    .filter(Boolean);
  const skillTarget = document.querySelector<HTMLSelectElement>("#git-skill-target")?.value ?? "";
  const checkedMcp = new Set(
    [...document.querySelectorAll<HTMLInputElement>(".git-mcp-check")].filter((c) => c.checked).map((c) => c.dataset.mcpName ?? "")
  );
  const mcpServers = insp.mcpServers.filter((s) => checkedMcp.has(s.name));
  const mcpClientId = document.querySelector<HTMLSelectElement>("#git-mcp-client")?.value ?? "";
  if (skillRelPaths.length === 0 && mcpServers.length === 0) {
    setSkillActionMessage("请至少勾选一个 Skill 或 MCP", 2600);
    return;
  }
  if (skillRelPaths.length > 0 && !skillTarget) {
    setSkillActionMessage("请为 Skill 选择安装目标", 2600);
    return;
  }
  if (mcpServers.length > 0 && !mcpClientId) {
    setSkillActionMessage("请为 MCP 选择目标客户端", 2600);
    return;
  }
  state.gitInstallDialog.loading = true;
  renderApp(true);
  try {
    const res = await api.gitApply({
      cachePath: insp.cachePath,
      skillRelPaths,
      skillTarget,
      mcpServers,
      mcpClientId
    });
    state.gitInstallDialog = null;
    await loadEnvironment(true);
    const failedText = res.failed.length ? `；失败：${res.failed.join(" / ")}` : "";
    setSkillActionMessage(`${res.message}${failedText}`, res.failed.length ? 6000 : 3000);
  } catch (e) {
    if (state.gitInstallDialog) state.gitInstallDialog.loading = false;
    setSkillActionMessage(`安装失败：${e instanceof Error ? e.message : String(e)}`, 5200);
    renderApp(true);
  }
}

async function adoptToLibrary(paths: string[]): Promise<void> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0 || state.skillTransferBusy) return;
  state.skillTransferBusy = true;
  setSkillActionMessage(`正在收编 ${unique.length} 个 Skill 进中心库...`, 0);
  try {
    const result = await api.adoptSkillsToLibrary(unique, allExtraRoots());
    state.skillTransferBusy = false;
    state.selectedSkillKeys.clear();
    await loadEnvironment(true);
    const failedText = result.failed.length ? `；失败 ${result.failed.length}：${result.failed.join(" / ")}` : "";
    setSkillActionMessage(`${result.message}${failedText}`, result.failed.length ? 5200 : 2800);
  } catch (error) {
    state.skillTransferBusy = false;
    setSkillActionMessage(`收编失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function linkSkillToClients(skillPath: string, clientIds: string[]): Promise<void> {
  if (clientIds.length === 0 || state.skillTransferBusy) return;
  state.skillTransferBusy = true;
  setSkillActionMessage("正在链接到客户端...", 0);
  try {
    const result = await api.linkSkillToClients(skillPath, clientIds);
    state.skillTransferBusy = false;
    state.skillLinkDialog = null;
    await loadEnvironment(true);
    const failedText = result.failed.length ? `；失败：${result.failed.join(" / ")}` : "";
    setSkillActionMessage(`${result.message}${failedText}`, result.failed.length ? 5200 : 2800);
  } catch (error) {
    state.skillTransferBusy = false;
    setSkillActionMessage(`链接失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function unlinkSkillFromClients(skillPath: string, clientIds: string[]): Promise<void> {
  if (clientIds.length === 0 || state.skillTransferBusy) return;
  state.skillTransferBusy = true;
  setSkillActionMessage("正在移除链接...", 0);
  try {
    const result = await api.unlinkSkillFromClients(skillPath, clientIds);
    state.skillTransferBusy = false;
    await loadEnvironment(true);
    const failedText = result.failed.length ? `；失败：${result.failed.join(" / ")}` : "";
    setSkillActionMessage(`${result.message}${failedText}`, result.failed.length ? 5200 : 2800);
  } catch (error) {
    state.skillTransferBusy = false;
    setSkillActionMessage(`移除链接失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function transferSkills(paths: string[], targetClientId: string, action: SkillTransferAction): Promise<void> {
  const uniquePaths = [...new Set(paths)].filter(Boolean);
  if (uniquePaths.length === 0 || !targetClientId || state.skillTransferBusy) return;
  state.skillTransferBusy = true;
  state.skillContextMenu = null;
  const verb = action === "move" ? "移动" : "复制";
  setSkillActionMessage(`正在${verb} ${uniquePaths.length} 个 Skill...`, 0);
  try {
    const result = await api.transferSkills(uniquePaths, targetClientId, action, allExtraRoots());
    const done = action === "move" ? result.moved : result.copied;
    const failedText = result.failed.length ? `；失败 ${result.failed.length} 个：${result.failed.join(" / ")}` : "";
    const targetText = result.targetRoot ? `\n目标目录：${result.targetRoot}` : "";
    if (action === "move") {
      const removedPaths = new Set(uniquePaths);
      for (const key of [...state.selectedSkillKeys]) {
        if (removedPaths.has(key.slice(key.indexOf("::") + 2))) state.selectedSkillKeys.delete(key);
      }
    }
    state.skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(
      `${action === "move" ? "移动" : "复制"}完成：成功 ${done} 个，目标客户端 ${result.targetClientName}${failedText}${targetText}`,
      result.failed.length ? 5200 : 2800
    );
  } catch (error) {
    state.skillTransferBusy = false;
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
  state.importSkillDialog = { sourceDir: selected, targetClientId: preferredSkillTargetId(targets) };
  renderApp(true);
}

async function importSkill(sourceDir: string, targetClientId: string): Promise<void> {
  if (!sourceDir || !targetClientId || state.skillTransferBusy) return;
  state.skillTransferBusy = true;
  state.importSkillDialog = null;
  renderApp(true);
  setSkillActionMessage("正在导入 Skill...", 0);
  try {
    const result = await api.importSkill(sourceDir, targetClientId);
    state.skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`${result.message}`, 3200);
  } catch (error) {
    state.skillTransferBusy = false;
    setSkillActionMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function installMarketSkill(skill: MarketSkill, method: InstallMethod, targetClientId: string): Promise<void> {
  state.installingKey = `${skill.id}:${method.id}`;
  state.installLogs[skill.id] = `正在执行：${method.detail}`;
  renderApp();
  try {
    const result = await api.installMarketSkill({
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
    });
    state.installLogs[skill.id] = `${result.message}${result.installedPath ? `\n路径：${result.installedPath}` : ""}${result.log ? `\n${result.log.slice(-1200)}` : ""}`;
    void loadEnvironment(true);
    void refreshInstalledMarketSkills();
    setSkillActionMessage(`${skill.name} 已安装到 ${clientNameById(targetClientId)}`, 3200);
  } catch (error) {
    state.installLogs[skill.id] = `安装失败：${error instanceof Error ? error.message : String(error)}`;
    setSkillActionMessage(`安装失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  } finally {
    state.installingKey = null;
    renderApp();
  }
}

async function installMcpServer(mcp: MarketMcp, targetClientId: string): Promise<void> {
  if (!targetClientId || state.skillTransferBusy) return;
  state.skillTransferBusy = true;
  state.mcpInstallDialog = null;
  renderApp();
  setSkillActionMessage(`正在写入 MCP「${mcp.name}」...`, 0);
  try {
    await api.installMcpServer(targetClientId, {
      name: mcp.id,
      transport: mcp.transport,
      command: mcp.command ?? null,
      args: mcp.args ?? null,
      url: mcp.url ?? null
    });
    state.skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`MCP「${mcp.name}」已写入 ${clientNameById(targetClientId)}`, 3200);
  } catch (error) {
    state.skillTransferBusy = false;
    setSkillActionMessage(`MCP 写入失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function toggleMcpEnabled(clientId: string, name: string, enabled: boolean): Promise<void> {
  if (state.skillTransferBusy) return;
  state.skillTransferBusy = true;
  setSkillActionMessage(`正在${enabled ? "启用" : "禁用"} ${name}...`, 0);
  try {
    await api.setMcpEnabled(clientId, name, enabled);
    state.skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`已${enabled ? "启用" : "禁用"} ${name}`, 2400);
  } catch (error) {
    state.skillTransferBusy = false;
    setSkillActionMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function setAllMcpEnabled(enabled: boolean): Promise<void> {
  if (state.skillTransferBusy) return;
  state.skillTransferBusy = true;
  setSkillActionMessage(`正在${enabled ? "启用" : "禁用"}全部 MCP...`, 0);
  try {
    const message = await api.setAllMcpEnabled(enabled);
    state.skillTransferBusy = false;
    await loadEnvironment(true);
    setSkillActionMessage(`${message}`, 2800);
  } catch (error) {
    state.skillTransferBusy = false;
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
    const installed = await api.checkGlobalPackages(packages);
    const installedSet = new Set(installed);
    const ids = new Set<string>();
    for (const skill of marketSkills) {
      if (skill.methods.some((method) => method.packageName && installedSet.has(method.packageName))) {
        ids.add(skill.id);
      }
    }
    state.installedMarketSkillIds = ids;
    if (state.currentView === "market") renderApp(true);
  } catch {
    // 静默失败：未安装 npm 不影响其它功能
  }
}

async function exportClientConfig(clientId: string): Promise<void> {
  state.clientMenuOpen = false;
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
    const message = await api.exportClientConfig(clientId, dir);
    setSkillActionMessage(message, 3200);
  } catch (error) {
    setSkillActionMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function importClientConfig(clientId: string): Promise<void> {
  state.clientMenuOpen = false;
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
    const message = await api.importClientConfig(clientId, file);
    await loadEnvironment(true);
    setSkillActionMessage(message, 3200);
  } catch (error) {
    setSkillActionMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

async function deleteClientConfig(clientId: string): Promise<void> {
  setSkillActionMessage("正在删除客户端配置...", 0);
  try {
    const message = await api.deleteClientConfig(clientId);
    await loadEnvironment(true);
    setSkillActionMessage(message, 3600);
  } catch (error) {
    setSkillActionMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`, 5200);
  }
}

function navIcon(name: string): string {
  const map: Record<string, string> = { client: "▣", project: "❏", skills: "✦", wsl: "🐧", mcp: "◎", rules: "♙", market: "⌂", settings: "⚙" };
  return map[name] ?? "▣";
}

function renderThemeSwitch(id: string, extraClass = ""): string {
  // size 会被组件换算成 --smr-toggle-width（width = round(size*64)）；侧栏用 1.375≈88px，与 CSS 盒子一致，避免内部按钮溢出。
  const size = extraClass.includes("settings") ? "1.95" : "1.375";
  return `<smr-theme-button id="${id}" class="${extraClass}" value="${state.currentTheme}" size="${size}" data-theme-toggle></smr-theme-button>`;
}

function renderSidebar(): string {
  const nav = navItems
    .map(([label, icon, view]) => `
      <button class="nav-item ${view === state.currentView ? "is-active" : ""}" data-view="${view}" type="button">
        <span class="nav-icon">${navIcon(icon)}</span><span>${label}</span>${view === "wsl" || view === "project" ? `<span class="nav-beta">Beta</span>` : ""}
      </button>`)
    .join("");
  const updateReminder = visibleUpdateAvailable()
    ? `<div class="sidebar-update-card"><button id="sidebar-update-open" type="button"><span>↑</span><strong>发现新版本</strong><small>v${html(state.updateInfo?.latestVersion ?? "")}</small></button><button id="sidebar-update-dismiss" type="button" title="忽略本版本">×</button></div>`
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
  const list = displayClients();
  const rows = list
    .map((client, index) => {
      const rt = runtime(client);
      const installed = rt?.installed ?? false;
      const isWsl = rt?.source === "wsl";
      const draggable = clients.some((base) => base.id === client.id);
      const badge = rt && rt.source && rt.source !== "windows"
        ? `<span class="client-source-badge ${isWsl ? "wsl" : "custom"}">${isWsl ? "WSL" : "扩展"}</span>`
        : "";
      return `
        <button class="client-row ${index === state.activeClientIndex ? "is-selected" : ""} ${installed ? "is-installed" : "is-missing"}" data-client-index="${index}" data-client-id="${html(client.id)}" type="button" draggable="${draggable ? "true" : "false"}">
          <span class="client-drag-handle ${draggable ? "" : "is-placeholder"}" aria-hidden="true">${draggable ? svgIcon("grip", 16) : ""}</span>
          <span class="avatar mini image">${img(client.iconFile, client.name)}</span>
          <span class="client-row-copy"><strong>${html(client.name)}${badge}</strong><small>${installed ? `${rt?.mcpCount ?? 0} MCP / ${rt?.skillsCount ?? 0} Skills` : "未安装"}</small></span>
          <span class="client-status-dot ${installed ? "installed" : "missing"}"></span>
        </button>`;
    })
    .join("");
  return `
    <section class="client-list-card">
      <div class="list-heading"><strong>全部客户端</strong><span>${list.length}</span></div>
      ${state.detectionError ? `<div class="status-banner danger">检测失败：${html(state.detectionError)}</div>` : ""}
      <div class="client-list">${rows}</div>
      <button id="refresh-detection" class="text-action" type="button"><span>${svgIcon("refresh", 15)}</span>${state.detectionLoading ? "检测中..." : "重新检测"}</button>
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
        <button class="external-install-link" data-open-path="${html(rt?.installUrl ?? client.installUrl)}" type="button">前往安装</button>
      </div>
    </div>`;
}

function renderClientTabButton(tab: ClientTab, label: string, count?: number): string {
  const suffix = typeof count === "number" ? `<span>${count}</span>` : "";
  return `<button class="tab ${state.activeClientTab === tab ? "is-active" : ""}" data-client-tab="${tab}" type="button">${label}${suffix}</button>`;
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
    <article class="client-rule-row" data-rule-path="${html(rule.path)}" data-rule-client="${html(rule.clientId)}">
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
  // 扩展/WSL 客户端（id 含 @tag）后端无法按原 id 启动/导出/导入/删除配置，隐藏三点菜单避免误触报错。
  const isExtra = client.id.includes("@");
  const clientMenuHtml = isExtra
    ? ""
    : `<div class="client-menu-wrap"><button id="client-actions-toggle" class="ghost-dots ${state.clientMenuOpen ? "is-open" : ""}" type="button">${svgIcon("more", 18)}</button>${state.clientMenuOpen ? `<div class="client-menu" role="menu"><button class="client-menu-item" data-client-action="export" data-client-id="${html(client.id)}" type="button" ${installed ? "" : "disabled"}>导出配置</button><button class="client-menu-item" data-client-action="import" data-client-id="${html(client.id)}" type="button" ${installed ? "" : "disabled"}>导入配置</button><button class="client-menu-item danger" data-client-action="delete" data-client-id="${html(client.id)}" type="button" ${installed ? "" : "disabled"}>删除客户端</button></div>` : ""}</div>`;
  const mcps = clientMcps(client.id);
  const skills = clientSkills(client.id);
  const rules = clientRules(client.id);
  const isProject = client.id.includes("@proj-");
  const tabContent =
    state.activeClientTab === "skills"
      ? isProject
        ? renderProjectSkillsPanel(client, skills)
        : renderClientSkillsPanel(client, skills)
      : state.activeClientTab === "mcp"
        ? renderClientMcpPanel(mcps)
        : state.activeClientTab === "rules"
          ? renderClientRulesPanel(client, rules)
          : renderClientSettingsPanel(client, rt);
  const projectPath = isProject
    ? state.projects.find((p) => client.id.endsWith(`@proj-${p.id}`))?.path ?? ""
    : "";
  const heroButton = isProject
    ? `<button class="primary-button" data-launch-project="${html(client.id)}" data-project-path="${html(projectPath)}" type="button">▶ 启动</button><button class="secondary-button" data-open-terminal="${html(projectPath)}" type="button">⌘ 终端</button>`
    : `<button class="primary-button launch-client-button" data-client-id="${html(client.id)}" type="button" ${canLaunch ? "" : "disabled"}>${canLaunch ? "▶ 启动客户端" : installed ? "未找到启动程序" : "需要安装客户端"}</button>`;
  return `
    <section class="client-main-card">
      <div class="client-hero">
        <div class="hero-left">
          <span class="avatar large image">${img(client.iconFile, client.name)}</span>
          <div><h2>${html(isProject ? baseClientName(client) : client.name)}</h2></div>
        </div>
        <div class="hero-actions">${heroButton}${clientMenuHtml}</div>
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
  const client = displayClients()[state.activeClientIndex] ?? clients[0];
  return `<main class="workspace"><div class="dashboard-grid">${renderClientsList()}${renderClientMain(client)}${renderInspector(client)}</div></main>`;
}

// —— WSL 独立管理页 ——
function wslTag(distro: string): string {
  return `wsl-${distro}`;
}

async function loadWslInstances(): Promise<void> {
  if (state.wslDetecting) return;
  state.wslDetecting = true;
  state.wslDetectError = null;
  renderApp(true);
  try {
    state.wslDistros = await api.listWslDistros();
    state.wslInstancesLoaded = true;
    if (state.wslDistros.length === 0) state.wslDetectError = "未检测到 WSL 发行版（需安装 WSL）";
    if (state.activeWslDistro && !state.wslDistros.some((d) => d.distro === state.activeWslDistro)) {
      state.activeWslDistro = "";
    }
    if (state.activeWslDistro) ensureWslScanned();
  } catch (error) {
    state.wslDistros = [];
    state.wslInstancesLoaded = true;
    state.wslDetectError = error instanceof Error ? error.message : String(error);
  } finally {
    state.wslDetecting = false;
    renderApp(true);
  }
}

// 确保当前选中的运行中实例已纳入扫描根，使 state.environment 含其 Skills/MCP/Rules。
function ensureWslScanned(): void {
  const inst = state.wslDistros.find((d) => d.distro === state.activeWslDistro);
  if (!inst || !inst.running || !inst.homeUnc) return;
  const tag = wslTag(inst.distro);
  if (!state.scanRoots.some((r) => r.tag === tag)) {
    state.scanRoots = [...state.scanRoots, { tag, label: `WSL: ${inst.distro}`, path: inst.homeUnc, kind: "wsl" }];
    saveScanRoots();
    void loadEnvironment(true);
  }
}

function selectWslDistro(name: string): void {
  state.activeWslDistro = name;
  state.activeClientTab = "skills";
  ensureWslScanned();
  state.wslActiveClientId = wslInstanceClients(name)[0]?.id ?? "";
  renderApp(true);
}

const WSL_ACTIONS: Record<string, (distro: string) => Promise<void>> = {
  wsl_set_default: api.wslSetDefault,
  wsl_start: api.wslStart,
  wsl_terminate: api.wslTerminate
};

async function wslControl(command: string, distro: string, okMsg: string): Promise<void> {
  try {
    await WSL_ACTIONS[command](distro);
    setSkillActionMessage(okMsg, 2400);
    await loadWslInstances();
  } catch (error) {
    setSkillActionMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`, 5000);
  }
}

// 某 WSL 实例内检测到的 CLI 客户端（id 形如 claude@wsl-Ubuntu）。
function wslInstanceClients(distro: string): Client[] {
  const suffix = `@${wslTag(distro)}`;
  return displayClients().filter((client) => client.id.endsWith(suffix));
}

function backToWslInstances(): void {
  state.activeWslDistro = "";
  state.wslActiveClientId = "";
  renderApp(true);
}

function renderWslView(): string {
  if (!state.wslInstancesLoaded && !state.wslDetecting) {
    void loadWslInstances();
  }
  // L1：未进入实例时显示虚拟机列表；L2：进入实例后按 CLI 客户端分类（复用主页客户端布局）。
  if (!state.activeWslDistro) {
    return `<main class="workspace single-column-workspace">${renderWslInstanceLanding()}</main>`;
  }
  return `<main class="workspace"><div class="dashboard-grid">${renderWslClientColumn()}${renderWslClientMain()}${renderWslClientInspector()}</div></main>`;
}

// L1：虚拟机（WSL 实例）落地页 —— 只列实例，点击进入，不直接显示 skill。
function renderWslInstanceLanding(): string {
  const cards = state.wslDistros
    .map((d) => {
      const clientCount = wslInstanceClients(d.distro).length;
      return `<button class="wsl-instance-card" data-wsl-distro="${html(d.distro)}" type="button">
        <span class="wsl-instance-icon">${distroIcon(d.distro)}</span>
        <div class="wsl-instance-meta">
          <strong>${html(d.distro)}${d.isDefault ? `<span class="wsl-default-tag">默认</span>` : ""}</strong>
          <small><span class="wsl-status-dot ${d.running ? "running" : "stopped"}"></span>${d.running ? "运行中" : "已停止"}${clientCount ? ` · ${clientCount} 个 CLI` : ""}</small>
        </div>
        <span class="wsl-enter-arrow">${svgIcon("chevron-right", 18)}</span>
      </button>`;
    })
    .join("");
  return `<section class="client-main-card management-card skills-page-card">
    <div class="skills-page-hero">
      <div class="hero-left"><span class="avatar large wsl-avatar">🐧</span><div><h2>WSL 管理</h2><p>选择一个虚拟机进入，按 CLI 客户端分类管理其中的 Skills / MCP / Rules。</p></div></div>
      <div class="skills-hero-actions"><button id="refresh-wsl" class="secondary-button" type="button">${state.wslDetecting ? "检测中..." : "刷新实例"}</button></div>
    </div>
    ${state.wslDetectError ? `<div class="status-banner danger">${html(state.wslDetectError)}</div>` : ""}
    <div class="wsl-instance-grid">${cards || `<div class="empty-config-panel">${state.wslDetecting ? "检测中..." : "未检测到 WSL 发行版（需安装 WSL）"}</div>`}</div>
  </section>`;
}

// L2 左栏：进入的实例 + 其 CLI 客户端列表（点击选中，复用主页 client-row 样式）。
function renderWslClientColumn(): string {
  const distro = state.activeWslDistro;
  const inst = state.wslDistros.find((d) => d.distro === distro);
  const list = wslInstanceClients(distro);
  if (!list.some((client) => client.id === state.wslActiveClientId)) {
    state.wslActiveClientId = list[0]?.id ?? "";
  }
  const running = inst?.running ?? false;
  const rows = list
    .map((client) => {
      const rt = runtime(client);
      const installed = rt?.installed ?? false;
      const active = client.id === state.wslActiveClientId;
      return `<button class="client-row ${active ? "is-selected" : ""} ${installed ? "is-installed" : "is-missing"}" data-wsl-client="${html(client.id)}" type="button">
        <span class="avatar mini image">${img(client.iconFile, client.name)}</span>
        <span class="client-row-copy"><strong>${html(client.name)}</strong><small>${installed ? `${rt?.mcpCount ?? 0} MCP / ${rt?.skillsCount ?? 0} Skills` : "未检测"}</small></span>
        <span class="client-status-dot ${installed ? "installed" : "missing"}"></span>
      </button>`;
    })
    .join("");
  return `<section class="client-list-card">
    <button class="wsl-back-button" data-wsl-back="1" type="button">${svgIcon("chevron-left", 15)}<span>全部实例</span></button>
    <div class="list-heading wsl-instance-heading"><strong>${distroIcon(distro, "distro-icon-img sm")} ${html(distro)}</strong><span class="wsl-status-dot ${running ? "running" : "stopped"}"></span></div>
    <div class="wsl-instance-controls">
      ${running
        ? `<button class="ghost-mini-button" data-wsl-stop="${html(distro)}" type="button">停止</button>`
        : `<button class="ghost-mini-button" data-wsl-start="${html(distro)}" type="button">启动</button>`}
      <button class="ghost-mini-button" data-wsl-terminal="${html(distro)}" type="button">终端</button>
      <button class="ghost-mini-button" data-wsl-default="${html(distro)}" type="button" ${inst?.isDefault ? "disabled" : ""}>${inst?.isDefault ? "默认" : "设默认"}</button>
    </div>
    <div class="client-list">${rows || `<div class="empty-config-panel">${running ? "该实例未检测到 CLI 客户端。" : "实例未运行，启动后才能读取内容。"}</div>`}</div>
    <button id="refresh-detection" class="text-action" type="button"><span>${svgIcon("refresh", 15)}</span>重新检测</button>
  </section>`;
}

// L2 中栏：选中 CLI 客户端的详情，直接复用主页 renderClientMain。
function renderWslClientMain(): string {
  const client = wslInstanceClients(state.activeWslDistro).find((c) => c.id === state.wslActiveClientId);
  if (!client) {
    return `<section class="client-main-card"><div class="client-hero"><div class="hero-left"><span class="avatar large image distro-avatar">${distroIcon(state.activeWslDistro)}</span><div><h2>${html(state.activeWslDistro)}</h2></div></div></div><div class="empty-config-panel">该实例暂无可管理的 CLI 客户端，或尚未启动。</div></section>`;
  }
  return renderClientMain(client);
}

// L2 右栏：复用主页 renderInspector。
function renderWslClientInspector(): string {
  const client = wslInstanceClients(state.activeWslDistro).find((c) => c.id === state.wslActiveClientId);
  if (!client) {
    return `<aside class="inspector"><section class="info-card"><h3>客户端信息</h3><p class="placeholder-copy">选择左侧的 CLI 客户端查看详情。</p></section></aside>`;
  }
  return renderInspector(client);
}

// —— 项目独立管理页（项目作用域；结构同 WSL：项目列表 → 进入后按客户端管理）——
function projectIdFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const base =
    (trimmed.split(/[\\/]/).pop() || "project").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  let hash = 0;
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) >>> 0;
  return `${base}-${hash.toString(36)}`;
}

function projectLabelFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed || "项目";
}

// 某项目下检测到的客户端（id 形如 claude@proj-<id>）。
function projectClients(projectId: string): Client[] {
  const suffix = `@proj-${projectId}`;
  return displayClients().filter((client) => client.id.endsWith(suffix));
}

// 去掉项目客户端名里的「（项目名）」后缀，列表只显示纯客户端名。
function baseClientName(client: Client): string {
  const baseId = client.id.split("@")[0];
  return clients.find((b) => b.id === baseId)?.name ?? client.name;
}

async function addProject(): Promise<void> {
  const picked = await openDialog({ directory: true, multiple: false, title: "选择项目目录" });
  if (typeof picked !== "string" || !picked.trim()) return;
  const path = picked.trim();
  if (state.projects.some((p) => p.path.toLowerCase() === path.toLowerCase())) {
    setSkillActionMessage("该项目已添加", 2400);
    return;
  }
  const id = projectIdFromPath(path);
  state.projects = [...state.projects, { id, label: projectLabelFromPath(path), path }];
  saveProjects();
  state.activeProjectId = id;
  state.activeProjectClientId = "";
  await loadEnvironment(true);
  renderApp(true);
}

function removeProject(id: string): void {
  state.projects = state.projects.filter((p) => p.id !== id);
  saveProjects();
  if (state.activeProjectId === id) {
    state.activeProjectId = "";
    state.activeProjectClientId = "";
  }
  void loadEnvironment(true);
  renderApp(true);
}

function selectProject(id: string): void {
  state.activeProjectId = id;
  state.activeClientTab = "skills";
  state.activeProjectClientId = projectClients(id)[0]?.id ?? "";
  renderApp(true);
}

function backToProjects(): void {
  state.activeProjectId = "";
  state.activeProjectClientId = "";
  renderApp(true);
}

// 仅就地更新被点 skill 的 toggle 按钮 + 行状态 + 筛选计数（不 renderApp，彻底消除整页抖动）。
function applyProjectSkillToggleDom(clientId: string, skillDir: string, enabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>("[data-skill-toggle]").forEach((btn) => {
    if (btn.dataset.skillToggle !== skillDir || btn.dataset.skillClient !== clientId) return;
    const row = btn.closest<HTMLElement>(".project-skill-row");
    // 非「全部」筛选下，状态变得不符合当前筛选 → 移除该行
    if (state.projectSkillFilter !== "all") {
      const keep = state.projectSkillFilter === "enabled" ? enabled : !enabled;
      if (!keep) {
        row?.remove();
        return;
      }
    }
    btn.classList.toggle("is-on", enabled);
    btn.classList.toggle("is-off", !enabled);
    btn.textContent = enabled ? "已启用" : "已禁用";
    btn.dataset.skillEnabled = enabled ? "1" : "0";
    row?.classList.toggle("is-disabled", !enabled);
  });
  // 局部刷新筛选计数 chip（state.environment 已乐观更新，clientSkills 重算即为最新）。
  const skills = clientSkills(clientId);
  const en = skills.filter((s) => s.enabled !== false).length;
  const setText = (key: string, label: string): void => {
    const chip = document.querySelector(`[data-project-skill-filter="${key}"]`);
    if (chip) chip.textContent = label;
  };
  setText("all", `全部 ${skills.length}`);
  setText("enabled", `已启用 ${en}`);
  setText("disabled", `已禁用 ${skills.length - en}`);
}

// 项目级 Skill 启停：乐观更新——本地翻转 enabled 后只就地更新那一行（零 renderApp、零抖动），再后台落盘；失败回滚。
async function setProjectSkillEnabled(clientId: string, skillDir: string, enabled: boolean): Promise<void> {
  const projectId = clientId.split("@proj-")[1] ?? "";
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) {
    setSkillActionMessage("未找到对应项目", 3000);
    return;
  }
  const skill = state.environment?.skills.find((s) => s.clientId === clientId && s.directory === skillDir);
  if (skill) skill.enabled = enabled;
  applyProjectSkillToggleDom(clientId, skillDir, enabled);
  try {
    const msg = await api.setProjectSkillEnabled(project.path, clientId, skillDir, enabled);
    setSkillActionMessage(msg, 2000);
  } catch (error) {
    if (skill) skill.enabled = !enabled;
    renderApp(true);
    setSkillActionMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`, 4200);
  }
}

function renderProjectView(): string {
  // L1：未进入项目时显示项目列表；L2：进入后按客户端分类（复用主页客户端三栏布局）。
  if (!state.activeProjectId) {
    return `<main class="workspace single-column-workspace">${renderProjectLanding()}</main>`;
  }
  return `<main class="workspace"><div class="dashboard-grid">${renderProjectClientColumn()}${renderProjectClientMain()}${renderProjectClientInspector()}</div></main>`;
}

function renderProjectLanding(): string {
  const cards = state.projects
    .map((p) => {
      const list = projectClients(p.id);
      const installed = list.filter((c) => runtime(c)?.installed).length;
      const skillCount = list.reduce((sum, c) => sum + (runtime(c)?.skillsCount ?? 0), 0);
      return `<button class="wsl-instance-card project-card" data-project-id="${html(p.id)}" type="button">
        <span class="wsl-instance-icon">❏</span>
        <div class="wsl-instance-meta">
          <strong>${html(p.label)}</strong>
          <small class="project-card-path">${html(p.path)}</small>
          <small>${installed} 个客户端 · ${skillCount} Skills</small>
        </div>
        <span class="project-card-remove" data-remove-project="${html(p.id)}" role="button" title="移除项目">×</span>
        <span class="wsl-enter-arrow">${svgIcon("chevron-right", 18)}</span>
      </button>`;
    })
    .join("");
  return `<section class="client-main-card management-card skills-page-card">
    <div class="skills-page-hero">
      <div class="hero-left"><span class="avatar large project-avatar">❏</span><div><h2>项目管理</h2><p>注册项目目录，按客户端管理每个项目下的 Skills / MCP / Rules（项目级配置，仅对该项目生效）。</p></div></div>
      <div class="skills-hero-actions"><button class="primary-button" data-add-project="1" type="button">+ 添加项目</button></div>
    </div>
    <div class="wsl-instance-grid">${cards || `<div class="empty-config-panel">尚未添加项目。点击「添加项目」选择一个项目目录开始管理。</div>`}</div>
  </section>`;
}

function renderProjectClientColumn(): string {
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  const list = projectClients(state.activeProjectId);
  if (!list.some((client) => client.id === state.activeProjectClientId)) {
    state.activeProjectClientId = list[0]?.id ?? "";
  }
  const rows = list
    .map((client) => {
      const rt = runtime(client);
      const installed = rt?.installed ?? false;
      const active = client.id === state.activeProjectClientId;
      return `<button class="client-row ${active ? "is-selected" : ""} ${installed ? "is-installed" : "is-missing"}" data-project-client="${html(client.id)}" type="button">
        <span class="avatar mini image">${img(client.iconFile, client.name)}</span>
        <span class="client-row-copy"><strong>${html(baseClientName(client))}</strong><small>${installed ? `${rt?.mcpCount ?? 0} MCP / ${rt?.skillsCount ?? 0} Skills` : "未安装"}</small></span>
        <span class="client-status-dot ${installed ? "installed" : "missing"}"></span>
      </button>`;
    })
    .join("");
  return `<section class="client-list-card">
    <button class="wsl-back-button" data-project-back="1" type="button">${svgIcon("chevron-left", 15)}<span>全部项目</span></button>
    <div class="list-heading"><strong>全部客户端</strong><span>${list.length}</span></div>
    ${project ? `<div class="project-current-path"><code>${html(project.path)}</code></div>` : ""}
    <div class="client-list">${rows || `<div class="empty-config-panel">检测中…或该项目无可管理客户端。</div>`}</div>
    <button id="refresh-detection" class="text-action" type="button"><span>${svgIcon("refresh", 15)}</span>重新检测</button>
  </section>`;
}

function renderProjectClientMain(): string {
  const client = projectClients(state.activeProjectId).find((c) => c.id === state.activeProjectClientId);
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  if (!client) {
    return `<section class="client-main-card"><div class="client-hero"><div class="hero-left"><span class="avatar large project-avatar">❏</span><div><h2>${html(project?.label ?? "项目")}</h2></div></div></div><div class="empty-config-panel">该项目暂无可管理的客户端，或正在检测。</div></section>`;
  }
  return renderClientMain(client);
}

function renderProjectClientInspector(): string {
  const client = projectClients(state.activeProjectId).find((c) => c.id === state.activeProjectClientId);
  if (!client) {
    return `<aside class="inspector"><section class="info-card"><h3>客户端信息</h3><p class="placeholder-copy">选择左侧客户端查看其在本项目下的配置。</p></section></aside>`;
  }
  return renderInspector(client);
}

// 项目级 Skills 面板：启用/禁用 toggle + 全部/已启用/已禁用筛选 + 添加 Skill（区别于全局只读的 renderClientSkillsPanel）。
function renderProjectSkillsPanel(client: Client, skills: RuntimeSkill[]): string {
  // 按目录名稳定排序：启停只改开关状态、不改条目位置，避免点击后跳动。
  const ordered = [...skills].sort((a, b) => (a.directory || a.name).localeCompare(b.directory || b.name));
  const enabledCount = ordered.filter((s) => s.enabled !== false).length;
  const disabledCount = ordered.length - enabledCount;
  const filter = state.projectSkillFilter;
  const filtered = ordered.filter((s) =>
    filter === "all" ? true : filter === "enabled" ? s.enabled !== false : s.enabled === false
  );
  const chip = (key: "all" | "enabled" | "disabled", label: string): string =>
    `<button class="proj-filter-chip ${filter === key ? "is-active" : ""}" data-project-skill-filter="${key}" type="button">${label}</button>`;
  return `
    <div class="tool-section client-tab-panel">
      <div class="section-heading-row">
        <div><h3>项目级 Skills</h3><p class="panel-subtle">管理当前项目下可用的 Skills，配置后仅对本项目生效。</p></div>
        <button class="primary-button" data-add-project-skill="${html(client.id)}" type="button">+ 添加 Skill</button>
      </div>
      <div class="proj-filter-row">
        ${chip("all", `全部 ${ordered.length}`)}
        ${chip("enabled", `已启用 ${enabledCount}`)}
        ${chip("disabled", `已禁用 ${disabledCount}`)}
      </div>
      <div class="client-skill-stack">
        ${
          filtered.map(renderProjectSkillRow).join("") ||
          `<div class="empty-config-panel">${
            ordered.length
              ? "没有符合筛选条件的 Skill。"
              : `当前项目下未检测到 ${html(baseClientName(client))} 的 Skills。可点击「添加 Skill」从全局或中心库下发。`
          }</div>`
        }
      </div>
    </div>`;
}

function renderProjectSkillRow(skill: RuntimeSkill): string {
  const enabled = skill.enabled !== false;
  return `
    <article class="client-skill-row project-skill-row ${enabled ? "" : "is-disabled"}" data-skill-key="${html(skillKey(skill))}" data-skill-path="${html(skill.path)}">
      <div class="skill-row-icon ${skillTone(skill)}">${html(skillInitials(skill.name))}</div>
      <div class="client-skill-copy">
        <div class="skill-row-title"><strong>${html(skill.name)}</strong><span class="rule-source-pill">本地</span></div>
        <p>${html(skillDescription(skill))}</p>
        <div class="skill-chip-row">${skillTags(skill)
          .map((tag) => `<span>${html(tag)}</span>`)
          .join("")}<span class="skill-updated">更新于 ${formatUpdated(skill.updatedAt)}</span></div>
        <code>${html(skill.path)}</code>
      </div>
      <button class="status-pill skill-toggle ${enabled ? "is-on" : "is-off"}" data-skill-toggle="${html(skill.directory)}" data-skill-client="${html(skill.clientId)}" data-skill-enabled="${enabled ? "1" : "0"}" type="button">${enabled ? "已启用" : "已禁用"}</button>
    </article>`;
}

// 可下发到项目的候选 Skill：全局/中心库/共享中已检测、已启用、去重的 skill（排除项目级自身）。
function projectAddSkillCandidates(): RuntimeSkill[] {
  const seen = new Set<string>();
  const out: RuntimeSkill[] = [];
  for (const s of state.environment?.skills ?? []) {
    if (s.clientId.includes("@proj-")) continue;
    if (s.enabled === false) continue;
    const key = s.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// 仅渲染候选行（供搜索时局部更新 .add-skill-list，避免整页 renderApp 抖动）。搜索只匹配名称/客户端。
function projectAddSkillRows(): string {
  const all = projectAddSkillCandidates();
  const query = state.projectAddSkillQuery.trim().toLowerCase();
  const candidates = query
    ? all.filter((s) => s.name.toLowerCase().includes(query) || s.clientName.toLowerCase().includes(query))
    : all;
  return candidates.length
    ? candidates
        .map(
          (s) => `
        <div class="context-target-row">
          <span><strong>${html(s.name)}</strong><small>${html(s.clientName)}</small></span>
          <button class="skill-context-action" data-add-skill-path="${html(s.path)}" type="button" ${state.skillTransferBusy ? "disabled" : ""}>添加</button>
        </div>`
        )
        .join("")
    : `<div class="context-empty">${
        all.length ? "没有匹配的 Skill。" : "没有可下发的 Skill。请先在「全局」页或中心库准备 Skill。"
      }</div>`;
}

function renderProjectAddSkillDialog(): string {
  const dlg = state.projectAddSkillDialog;
  if (!dlg) return "";
  return `
    <div class="alert-dialog-backdrop" role="presentation" data-add-skill-backdrop="1">
      <section class="alert-dialog project-add-skill-dialog" role="dialog" aria-modal="true">
        <div class="alert-dialog-copy">
          <h2>添加 Skill 到项目</h2>
          <p>从全局 / 中心库已检测的 Skill 中选择，复制到当前项目客户端（仅对本项目生效）。</p>
          <label class="skills-search-box add-skill-search-box"><span>${svgIcon("search", 16)}</span><input id="add-skill-search" value="${html(state.projectAddSkillQuery)}" placeholder="搜索 Skill 名称 / 客户端..." /></label>
          <div class="context-target-list add-skill-list">${projectAddSkillRows()}</div>
        </div>
        <div class="alert-dialog-actions">
          <button class="secondary-button" data-close-add-skill="1" type="button">关闭</button>
        </div>
      </section>
    </div>`;
}

function renderMcpView(): string {
  const rows = (state.environment?.mcpServers ?? []).map(renderDetectedMcp).join("");
  return `
    <main class="workspace single-column-workspace"><section class="client-main-card management-card">
      <div class="client-hero"><div class="hero-left"><span class="avatar large">M</span><div><h2>MCP 管理</h2><p>从已安装客户端配置中读取真实 MCP 服务。可点击状态切换启用/禁用。</p></div></div><div class="mcp-hero-actions"><button id="disable-all-mcp" class="secondary-button" type="button">一键禁用所有 MCP</button><button id="enable-all-mcp" class="secondary-button" type="button">全部启用</button><button id="refresh-detection" class="secondary-button" type="button">重新检测</button></div></div>
      <div class="tool-section"><h3>全部检测结果</h3><div class="tool-stack">${rows || `<div class="empty-config-panel">未检测到 MCP。需要先安装客户端，并在客户端中配置 MCP。</div>`}</div></div>
    </section></main>`;
}

function renderRuleListRow(rule: RuntimeRule): string {
  return `
    <article class="rule-list-row" data-rule-path="${html(rule.path)}" data-rule-client="${html(rule.clientId)}">
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
  const rules = state.environment?.rules ?? [];
  const clientsWithRules = [...new Map(rules.map((rule) => [rule.clientId, rule.clientName])).entries()];
  const workspaceRules = rules.filter((rule) => rule.managed).length;
  const recent = rules
    .map((rule) => Number(rule.updatedAt ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)[0];
  const sortedRules = rules
    .slice()
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
  const ruleTotalPages = Math.max(1, Math.ceil(sortedRules.length / state.listPageSize));
  const rulePageNum = Math.min(Math.max(state.rulePage, 1), ruleTotalPages);
  const rows = sortedRules
    .slice((rulePageNum - 1) * state.listPageSize, rulePageNum * state.listPageSize)
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
  // 优先展示来自 SKILL.md frontmatter 的真实标签。
  if (skill.tags && skill.tags.length > 0) return skill.tags.slice(0, 6);
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
      ${[10, 20, 50].map((n) => `<option value="${n}" ${state.listPageSize === n ? "selected" : ""}>${n} 条/页</option>`).join("")}
    </select>
  </div>`;
}

function renderSkillsView(): string {
  const skills = state.environment?.skills ?? [];
  const installed = installedClients();
  const sharedSkillCount = skills.filter((skill) => skill.managed).length;
  const query = state.skillQuery.trim().toLowerCase();
  const clientsWithSkills = [...new Map(skills.map((skill) => [skill.clientId, skill.clientName])).entries()];
  const allTags = [...new Set(skills.flatMap((skill) => skill.tags ?? []))].sort((a, b) => a.localeCompare(b, "zh"));
  if (state.skillTagFilter !== "all" && !allTags.includes(state.skillTagFilter)) state.skillTagFilter = "all";
  const activeGroup = state.activeSkillGroupId ? findSkillGroup(state.activeSkillGroupId) : undefined;
  if (state.activeSkillGroupId && !activeGroup) state.activeSkillGroupId = "";
  const activeGroupKeys = activeGroup ? new Set(activeGroup.memberKeys) : null;
  const filteredSkills = skills
    .filter((skill) => {
      const haystack = `${skill.name} ${skill.description ?? ""} ${skill.clientName} ${skill.directory} ${skill.path}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesClient = state.skillClientFilter === "all" || skill.clientId === state.skillClientFilter;
      const matchesStatus =
        state.skillStatusFilter === "all" ||
        (state.skillStatusFilter === "library" && skill.clientId === "library") ||
        (state.skillStatusFilter === "shared" && skill.managed && skill.clientId !== "library") ||
        (state.skillStatusFilter === "client" && !skill.managed);
      const matchesTag = state.skillTagFilter === "all" || (skill.tags ?? []).includes(state.skillTagFilter);
      const matchesGroup = !activeGroupKeys || activeGroupKeys.has(skillKey(skill));
      return matchesQuery && matchesClient && matchesStatus && matchesTag && matchesGroup;
    })
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / state.listPageSize));
  const skillPageNum = Math.min(Math.max(state.skillPage, 1), totalPages);
  const pageSkills = filteredSkills.slice((skillPageNum - 1) * state.listPageSize, skillPageNum * state.listPageSize);
  const selectedVisibleCount = pageSkills.filter((skill) => state.selectedSkillKeys.has(skillKey(skill))).length;
  const allVisibleSelected = pageSkills.length > 0 && selectedVisibleCount === pageSkills.length;
  const bulkTargets = skillTargetClients();
  const bulkTargetId = preferredSkillTargetId(bulkTargets);
  if (bulkTargetId && state.skillBulkTargetId !== bulkTargetId && !bulkTargets.some((client) => client.id === state.skillBulkTargetId)) {
    state.skillBulkTargetId = bulkTargetId;
  }
  // WSL/扩展根来源的 skill 只读：禁止删除/移动（=从 WSL 删源），仅允许复制到 Windows。
  const wslSkillKeys = new Set((state.environment?.skills ?? []).filter(isExtraSourceSkill).map(skillKey));
  const selectionHasExtra = [...state.selectedSkillKeys].some((key) => wslSkillKeys.has(key));
  const rows = pageSkills
    .map(
      (skill) => {
        const key = skillKey(skill);
        const selected = state.selectedSkillKeys.has(key);
        const isExtra = isExtraSourceSkill(skill);
        const isLibrary = skill.clientId === "library";
        const linkedBadges =
          isLibrary && skill.linkedClients && skill.linkedClients.length > 0
            ? `<div class="skill-linked-badges"><span class="skill-linked-label">已链接</span>${skill.linkedClients
                .map((cid) => `<span class="skill-linked-chip">${html(clientNameById(cid))}</span>`)
                .join("")}</div>`
            : isLibrary
              ? `<div class="skill-linked-badges"><span class="skill-linked-empty">未链接到任何客户端</span></div>`
              : "";
        const pill = isLibrary
          ? `<span class="skill-lib-pill">中心库</span>`
          : isExtra
            ? `<span class="skill-readonly-pill">${html(skill.clientName.includes("WSL") ? "WSL · 只读" : "只读")}</span>`
            : "";
        const rowActions = `<div class="skill-row-actions">${
          isLibrary
            ? `<button class="ghost-mini-button" data-link-skill-path="${html(skill.path)}" data-skill-name="${html(skill.name)}" type="button">链接到客户端…</button>`
            : ""
        }${
          !isLibrary && !isExtra
            ? `<button class="ghost-mini-button" data-adopt-skill-path="${html(skill.path)}" type="button" ${state.skillTransferBusy ? "disabled" : ""}>收编进库</button>`
            : ""
        }</div>`;
        return `
      <article class="skill-list-row ${selected ? "is-selected" : ""}" data-skill-key="${html(key)}" data-skill-path="${html(skill.path)}">
        <label class="skill-check" title="选择 ${html(skill.name)}">
          <input class="skill-checkbox" data-skill-key="${html(key)}" type="checkbox" ${selected ? "checked" : ""} />
        </label>
        <div class="skill-row-icon ${skillTone(skill)}">${html(skillInitials(skill.name))}</div>
        <div class="skill-row-main">
          <div class="skill-row-title"><strong>${html(skill.name)}</strong>${pill}</div>
          <p>${html(skillDescription(skill))}</p>
          <div class="skill-chip-row">${skillTags(skill).map((tag) => `<span>${html(tag)}</span>`).join("")}</div>
          <code>${html(skill.path)}</code>
          ${linkedBadges}${rowActions}
        </div>
        <div class="skill-row-meta source"><span>客户端</span><strong>${html(skill.clientName)}</strong></div>
        <div class="skill-row-meta updated"><span>更新时间</span><strong>${formatUpdated(skill.updatedAt)}</strong></div>
        <button class="skill-delete-button" data-delete-skill-path="${html(skill.path)}" data-skill-name="${html(skill.name)}" type="button" ${state.deleteBusy || isExtra ? "disabled" : ""} ${isExtra ? 'title="WSL/扩展来源只读，不能删除"' : ""}>删除</button>
      </article>`;
      }
    )
    .join("");
  return `
    <main class="workspace single-column-workspace"><section class="client-main-card management-card skills-page-card">
      <div class="skills-page-hero">
        <div class="hero-left"><span class="avatar large skills-avatar">S</span><div><h2>Skills 管理</h2><p>管理和组织所有客户端的 Skills，支持单个删除、多选删除和批量删除。</p></div></div>
        <div class="skills-hero-actions"><button id="git-install-button" class="secondary-button" type="button">⬇ 从 Git 安装</button><button id="import-skill-button" class="secondary-button" type="button">${svgIcon("download", 15)} 导入 Skill</button><button id="refresh-detection" class="secondary-button" type="button">重新检测</button></div>
      </div>
      ${installed.length === 0 ? `<div class="install-required inline"><div class="install-required-icon">!</div><div><h3>需要先安装客户端</h3><p>未检测到可管理客户端。安装 Claude、Cursor、OpenCode、Trae 或 Codex 后，Skills 才会在这里显示。</p></div></div>` : ""}
      <div class="skills-stat-grid">
        <article><strong>技能总数</strong><b>${skills.length}</b><span>来自 ${clientsWithSkills.length} 个来源</span><i>⬢</i></article>
        <article><strong>共享目录</strong><b>${sharedSkillCount}</b><span>${skills.length - sharedSkillCount} 个客户端目录</span><i>✓</i></article>
        <article><strong>被引用</strong><b>${installed.reduce((sum, client) => sum + client.skillsCount, 0)}</b><span>按 Clients 引用统计</span><i>♙</i></article>
        <article><strong>按来源</strong><b>${clientsWithSkills.length}</b><span>客户端 / 共享目录</span><i>▦</i></article>
      </div>
      <div class="skills-toolbar">
        <label class="skills-search-box"><span>${svgIcon("search", 16)}</span><input id="skill-search-input" value="${html(state.skillQuery)}" placeholder="搜索 Skills..." /></label>
        <select id="skill-client-filter" class="skills-select">
          <option value="all" ${state.skillClientFilter === "all" ? "selected" : ""}>全部客户端</option>
          ${clientsWithSkills.map(([id, name]) => `<option value="${html(id)}" ${state.skillClientFilter === id ? "selected" : ""}>${html(name)}</option>`).join("")}
        </select>
        <select id="skill-status-filter" class="skills-select">
          <option value="all" ${state.skillStatusFilter === "all" ? "selected" : ""}>全部状态</option>
          <option value="library" ${state.skillStatusFilter === "library" ? "selected" : ""}>中心库</option>
          <option value="client" ${state.skillStatusFilter === "client" ? "selected" : ""}>客户端目录</option>
          <option value="shared" ${state.skillStatusFilter === "shared" ? "selected" : ""}>共享目录</option>
        </select>
        ${
          allTags.length > 0
            ? `<select id="skill-tag-filter" class="skills-select" title="按标签筛选（来自 SKILL.md）">
          <option value="all" ${state.skillTagFilter === "all" ? "selected" : ""}>全部标签</option>
          ${allTags.map((tag) => `<option value="${html(tag)}" ${state.skillTagFilter === tag ? "selected" : ""}>${html(tag)}</option>`).join("")}
        </select>`
            : ""
        }
        <button class="skills-view-button ${!state.skillGridView ? "is-active" : ""}" data-skill-view="list" type="button">☷</button><button class="skills-view-button ${state.skillGridView ? "is-active" : ""}" data-skill-view="grid" type="button">▦</button>
      </div>
      <div class="skills-groups-bar">
        <span class="skills-groups-label">分组</span>
        <button class="skill-group-chip ${state.activeSkillGroupId === "" ? "is-active" : ""}" data-group-select="" type="button">全部 (${skills.length})</button>
        ${state.skillGroups
          .map(
            (group) => `<span class="skill-group-chip-wrap ${state.activeSkillGroupId === group.id ? "is-active" : ""}">
          <button class="skill-group-chip ${state.activeSkillGroupId === group.id ? "is-active" : ""}" data-group-select="${html(group.id)}" type="button" title="筛选分组「${html(group.name)}」">${html(group.name)} (${groupMemberCount(group)})</button>
          <button class="skill-group-mini" data-group-rename="${html(group.id)}" type="button" title="重命名">✎</button>
          <button class="skill-group-mini" data-group-delete="${html(group.id)}" type="button" title="删除分组">✕</button>
        </span>`
          )
          .join("")}
        <button class="skill-group-new" id="new-skill-group" type="button">＋ 新建分组</button>
      </div>
      <div class="skills-bulk-bar">
        <label><input id="select-all-skills" type="checkbox" ${allVisibleSelected ? "checked" : ""} ${filteredSkills.length === 0 ? "disabled" : ""} /> 全选当前列表</label>
        <span>已选 ${state.selectedSkillKeys.size} 项</span>
        <select id="add-to-group-select" class="skills-mini-select" title="把选中的 Skill 加入分组" ${state.selectedSkillKeys.size === 0 ? "disabled" : ""}>
          <option value="">加入分组…</option>
          ${state.skillGroups.map((group) => `<option value="${html(group.id)}">＋ ${html(group.name)}</option>`).join("")}
          <option value="__new__">＋ 新建分组并加入</option>
        </select>
        ${activeGroup ? `<button id="remove-from-group" class="ghost-mini-button" type="button" ${state.selectedSkillKeys.size === 0 ? "disabled" : ""}>从「${html(activeGroup.name)}」移除</button>` : ""}
        <span class="bulk-target-label">复制/移动到</span>
        <select id="bulk-skill-target" class="skills-mini-select" title="批量复制/移动的目标客户端（这不是筛选；筛选在上方工具栏）" ${bulkTargets.length === 0 ? "disabled" : ""}>
          ${bulkTargets.map((client) => `<option value="${html(client.id)}" ${bulkTargetId === client.id ? "selected" : ""}>${html(client.name)}</option>`).join("")}
        </select>
        ${activeGroup ? `<button id="assign-group" class="transfer-mini-button assign-group-button" type="button" title="把分组「${html(activeGroup.name)}」全部复制到目标客户端" ${groupMemberCount(activeGroup) === 0 || state.skillTransferBusy || !bulkTargetId ? "disabled" : ""}>一键赋予整组到目标</button>` : ""}
        <button id="copy-selected-skills" class="ghost-mini-button transfer-mini-button" type="button" ${state.selectedSkillKeys.size === 0 || state.skillTransferBusy || !bulkTargetId ? "disabled" : ""}>批量复制到</button>
        <button id="move-selected-skills" class="ghost-mini-button transfer-mini-button" type="button" ${state.selectedSkillKeys.size === 0 || state.skillTransferBusy || !bulkTargetId || selectionHasExtra ? "disabled" : ""} ${selectionHasExtra ? 'title="WSL/扩展来源只读，不能移动；可用“批量复制到”"' : ""}>批量移动到</button>
        <button id="delete-selected-skills" class="danger-mini-button" type="button" ${state.selectedSkillKeys.size === 0 || state.deleteBusy || selectionHasExtra ? "disabled" : ""} ${selectionHasExtra ? 'title="WSL/扩展来源只读，不能删除"' : ""}>${state.deleteBusy ? "删除中..." : "批量删除"}</button>
        <button id="clear-skill-selection" class="ghost-mini-button" type="button" ${state.selectedSkillKeys.size === 0 ? "disabled" : ""}>清空选择</button>
      </div>
      <div class="skill-list-table ${state.skillGridView ? "is-grid" : ""}">${rows || `<div class="empty-config-panel">未检测到已安装 Skills。可以去市场用 npm / npx / pnpm / GitHub / JSON 安装。</div>`}</div>
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
  const installed = state.installedMarketSkillIds.has(skill.id);
  const noTarget = targets.length === 0;
  const installDisabled = !recommended || state.installingKey === key || noTarget;
  const installLabel = state.installingKey === key ? "安装中" : noTarget ? "无支持客户端" : installed ? "重新安装" : "安装";
  return `
    <article class="catalog-card">
      <div class="catalog-card-main">${renderSkillIcon(skill.iconFile, skill.name)}<div><h3>${html(skill.name)}</h3><p>${html(skill.description)}</p></div></div>
      <div class="catalog-tags"><span class="catalog-category ${skill.tone}">${html(skill.category)}</span><span class="catalog-method-tag">${html(methodTags)}</span>${installed ? `<span class="catalog-installed-pill">已安装</span>` : ""}</div>
      <div class="catalog-support">支持客户端：${html(supportNames)}</div>
      <div class="catalog-footer"><span class="stars">★ ${skill.rating}</span><span>♙ ${skill.installs} 安装</span><button class="install-method-button primary-install" data-skill-id="${html(skill.id)}" data-method-id="${recommended?.id ?? ""}" title="${html(recommended?.detail ?? "暂无安装方式")}" type="button" ${installDisabled ? "disabled" : ""}>${installLabel}</button></div>
      <small class="catalog-repo">${html(skill.repo)}</small>
      ${state.installLogs[skill.id] ? `<pre class="install-log">${html(state.installLogs[skill.id])}</pre>` : ""}
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
  const isMcp = state.marketTab === "mcp";
  const tabs = `<section class="market-tabs-line"><button class="market-page-tab ${isMcp ? "" : "is-active"}" data-market-tab="skill" type="button">Skill 市场</button><button class="market-page-tab ${isMcp ? "is-active" : ""}" data-market-tab="mcp" type="button">MCP 专栏</button></section>`;
  if (isMcp) {
    const q = state.mcpQuery.trim().toLowerCase();
    const mcps = marketMcps
      .filter((m) => !q || `${m.name} ${m.description} ${m.id}`.toLowerCase().includes(q))
      .sort((a, b) =>
        state.mcpSort === "transport"
          ? a.transport.localeCompare(b.transport) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name)
      );
    return `
    <main class="market-workspace">
      <header class="market-page-header"><div><h1>市场</h1><p>内置常用 MCP 服务，一键写入所选客户端的配置文件。</p></div><button id="git-install-button" class="secondary-button" type="button">⬇ 从 Git 安装</button></header>
      ${tabs}
      <section class="market-toolbar mcp-market-toolbar"><label class="market-search-box"><span>${svgIcon("search", 16)}</span><input id="mcp-search-input" value="${html(state.mcpQuery)}" placeholder="搜索 MCP..." /></label><select id="mcp-sort-select" class="skills-select"><option value="name" ${state.mcpSort === "name" ? "selected" : ""}>按名称排序</option><option value="transport" ${state.mcpSort === "transport" ? "selected" : ""}>按传输方式排序</option></select><button id="refresh-detection" class="refresh-button" type="button">${svgIcon("refresh", 16)}</button></section>
      <section class="install-route-panel"><strong>MCP 写入</strong><span>选择目标客户端后会把 MCP 配置写入其配置文件（claude / claude-desktop / gemini / cursor / trae 用 JSON，codex 用 TOML）。写入后请重新检测。</span></section>
      <section class="skill-catalog-grid">${mcps.map(renderMcpCard).join("") || `<div class="empty-config-panel">没有匹配的 MCP。</div>`}</section>
    </main>`;
  }
  const sq = state.marketSkillQuery.trim().toLowerCase();
  const categories = ["全部", ...Array.from(new Set(marketSkills.map((item) => item.category)))];
  const skillList = marketSkills
    .filter((item) => state.marketSkillCategory === "全部" || item.category === state.marketSkillCategory)
    .filter((item) => !sq || `${item.name} ${item.description} ${item.id} ${item.repo}`.toLowerCase().includes(sq))
    .sort((a, b) => (state.marketSkillSort === "rating" ? parseFloat(b.rating) - parseFloat(a.rating) : a.name.localeCompare(b.name)));
  return `
    <main class="market-workspace">
      <header class="market-page-header"><div><h1>市场</h1><p>支持 npm、npx、pnpm、GitHub 和静态 JSON 注册表安装 Skills。</p></div><button id="git-install-button" class="secondary-button" type="button">⬇ 从 Git 安装</button></header>
      ${tabs}
      <section class="market-toolbar mcp-market-toolbar"><label class="market-search-box"><span>${svgIcon("search", 16)}</span><input id="market-skill-search" value="${html(state.marketSkillQuery)}" placeholder="搜索 Skills..." /></label><select id="market-skill-sort" class="skills-select"><option value="name" ${state.marketSkillSort === "name" ? "selected" : ""}>按名称排序</option><option value="rating" ${state.marketSkillSort === "rating" ? "selected" : ""}>按评分排序</option></select><button id="refresh-detection" class="refresh-button" type="button">${svgIcon("refresh", 16)}</button></section>
      <section class="install-route-panel"><strong>安装路线</strong><span>CLI 包走 npm/pnpm；一次性初始化走 npx；仓库型 Skill 走 GitHub clone；无后端市场走 JSON manifest/registry。</span></section>
      <section class="category-row">${categories.map((category) => `<button class="category-pill ${state.marketSkillCategory === category ? "is-active" : ""}" data-category="${html(category)}" type="button">${html(category)}</button>`).join("")}</section>
      <section class="skill-catalog-grid">${skillList.map(renderSkillCard).join("") || `<div class="empty-config-panel">没有匹配的 Skill。</div>`}</section>
    </main>`;
}


function renderPlaceholder(title: string): string {
  return `<main class="workspace"><section class="client-main-card placeholder-card"><div class="client-hero"><div class="hero-left"><span class="avatar large">SM</span><h2>${html(title)}</h2></div></div><div class="tool-section"><h3>设计占位</h3><p class="placeholder-copy">该模块后续接入真实配置。</p></div></section></main>`;
}

function renderContent(): string {
  if (state.currentView === "clients") return renderClientView();
  if (state.currentView === "project") return renderProjectView();
  if (state.currentView === "wsl") return renderWslView();
  if (state.currentView === "mcp") return renderMcpView();
  if (state.currentView === "skills") return renderSkillsView();
  if (state.currentView === "rules") return renderRulesView();
  if (state.currentView === "market") return renderMarketView();
  if (state.currentView === "settings") return renderSettingsView();
  return renderPlaceholder(navItems.find(([, , view]) => view === state.currentView)?.[0] ?? "模块");
}

function renderSkillContextMenu(): string {
  const ctx = state.skillContextMenu;
  if (!ctx) return "";
  const skill = state.environment?.skills.find((item) => skillKey(item) === ctx.key) ?? skillByPath(ctx.path);
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
              <button class="skill-context-action" data-action="copy" data-target-client-id="${html(target.id)}" type="button" ${state.skillTransferBusy ? "disabled" : ""}>复制</button>
              <button class="skill-context-action move" data-action="move" data-target-client-id="${html(target.id)}" type="button" ${state.skillTransferBusy ? "disabled" : ""}>移动</button>
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
  state.confirmDialog = {
    title: isBatch ? "批量删除 Skills" : "删除 Skill",
    message: isBatch
      ? `确认删除选中的 ${uniquePaths.length} 个 Skills？会先移动到 SMRmanager 回收目录，便于恢复。`
      : `确认删除 ${label ?? "该 Skill"}？会先移动到 SMRmanager 回收目录，便于恢复。`,
    confirmLabel: isBatch ? `删除 ${uniquePaths.length} 个` : "删除",
    cancelLabel: "取消",
    paths: uniquePaths
  };
  state.skillContextMenu = null;
  renderApp(true);
}

function renderConfirmDialog(): string {
  if (!state.confirmDialog) return "";
  return `
    <div class="alert-dialog-backdrop" role="presentation">
      <section class="alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-desc">
        <div class="alert-dialog-icon">⌫</div>
        <div class="alert-dialog-copy">
          <h2 id="delete-dialog-title">${html(state.confirmDialog.title)}</h2>
          <p id="delete-dialog-desc">${html(state.confirmDialog.message)}</p>
          <div class="alert-dialog-paths">
            ${state.confirmDialog.paths.slice(0, 4).map((path) => `<code>${html(path)}</code>`).join("")}
            ${state.confirmDialog.paths.length > 4 ? `<span>还有 ${state.confirmDialog.paths.length - 4} 项...</span>` : ""}
          </div>
        </div>
        <div class="alert-dialog-actions">
          <button id="confirm-dialog-cancel" class="secondary-button" type="button">${html(state.confirmDialog.cancelLabel)}</button>
          <button id="confirm-dialog-confirm" class="danger-dialog-button" type="button">${html(state.confirmDialog.confirmLabel)}</button>
        </div>
      </section>
    </div>`;
}

function renderGitInspected(insp: GitInspectResult, skillTargets: RuntimeClient[], mcpTargets: RuntimeClient[]): string {
  const skillSection = insp.skills.length
    ? `<div class="git-section">
        <div class="git-section-head"><strong>Skills（${insp.skills.length}）</strong>
          <select id="git-skill-target" class="skills-mini-select" title="选中 Skill 的安装目标">
            <option value="">选择目标…</option>
            <option value="library">中心库</option>
            ${skillTargets.map((c) => `<option value="${html(c.id)}">${html(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="git-item-list">${insp.skills
          .map(
            (s) => `<label class="git-item">
          <input type="checkbox" class="git-skill-check" data-rel-path="${html(s.relPath)}" checked />
          <span class="git-item-main"><strong>${html(s.name)}</strong><small>${html(s.description || s.relPath)}</small></span>
        </label>`
          )
          .join("")}</div>
      </div>`
    : `<div class="git-section"><span class="scan-roots-empty">未发现 Skill。</span></div>`;
  const mcpSection = insp.mcpServers.length
    ? `<div class="git-section">
        <div class="git-section-head"><strong>MCP（${insp.mcpServers.length}）</strong>
          <select id="git-mcp-client" class="skills-mini-select" title="选中 MCP 写入的客户端">
            <option value="">选择客户端…</option>
            ${mcpTargets.map((c) => `<option value="${html(c.id)}">${html(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="git-item-list">${insp.mcpServers
          .map(
            (m) => `<label class="git-item">
          <input type="checkbox" class="git-mcp-check" data-mcp-name="${html(m.name)}" checked />
          <span class="git-item-main"><strong>${html(m.name)}</strong><small>${html(m.url || (m.command ? `${m.command} ${(m.args ?? []).join(" ")}` : m.transport))}</small></span>
        </label>`
          )
          .join("")}</div>
      </div>`
    : `<div class="git-section"><span class="scan-roots-empty">未发现 MCP 声明。</span></div>`;
  return skillSection + mcpSection;
}

function renderGitInstallDialog(): string {
  if (!state.gitInstallDialog) return "";
  const d = state.gitInstallDialog;
  return `
    <div class="alert-dialog-backdrop" role="presentation">
      <section class="alert-dialog git-install-dialog" role="dialog" aria-modal="true" aria-labelledby="git-dialog-title">
        <div class="alert-dialog-copy">
          <h2 id="git-dialog-title">从 Git 安装 Skill / MCP</h2>
          <p>粘贴公开 Git 仓库地址，检测其中的 Skills 与 MCP 声明后选择安装。仅克隆、不执行仓库脚本。</p>
          <div class="git-install-form">
            <input id="git-url-input" class="group-name-input" type="text" value="${html(d.url)}" placeholder="https://github.com/owner/repo（或 owner/repo）" />
            <input id="git-subdir-input" class="group-name-input git-subdir" type="text" value="${html(d.subdir)}" placeholder="子目录（可选）" />
            <button id="git-inspect-btn" class="secondary-button" type="button" ${d.loading ? "disabled" : ""}>${d.loading && !d.inspected ? "检测中..." : "检测"}</button>
          </div>
          ${d.error ? `<div class="status-banner danger">${html(d.error)}</div>` : ""}
          ${d.inspected ? renderGitInspected(d.inspected, skillTargetClients(), mcpTargetClients()) : ""}
        </div>
        <div class="alert-dialog-actions">
          <button id="git-dialog-cancel" class="secondary-button" type="button">关闭</button>
          ${d.inspected ? `<button id="git-apply-btn" class="primary-button" type="button" ${d.loading ? "disabled" : ""}>${d.loading ? "安装中..." : "安装选中"}</button>` : ""}
        </div>
      </section>
    </div>`;
}

function renderSkillLinkDialog(): string {
  if (!state.skillLinkDialog) return "";
  const dialog = state.skillLinkDialog;
  const skill = skillByPath(dialog.skillPath);
  const linkedSet = new Set(skill?.linkedClients ?? []);
  const targets = skillTargetClients();
  return `
    <div class="alert-dialog-backdrop" role="presentation">
      <section class="alert-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title">
        <div class="alert-dialog-icon">⛓</div>
        <div class="alert-dialog-copy">
          <h2 id="link-dialog-title">链接「${html(dialog.skillName)}」到客户端</h2>
          <p>勾选要链接的客户端（junction，改库即全部同步）。已链接的可单独移除。</p>
          <div class="link-client-list">
            ${
              targets.length === 0
                ? `<p class="scan-roots-empty">没有可写入的已安装客户端。</p>`
                : targets
                    .map((c) => {
                      const linked = linkedSet.has(c.id);
                      return `<label class="link-client-row">
                <input type="checkbox" class="link-client-check" data-client-id="${html(c.id)}" ${linked ? "checked disabled" : ""} />
                <span class="link-client-name">${html(c.name)}</span>
                ${linked ? `<button class="ghost-mini-button" data-unlink-client="${html(c.id)}" type="button">移除</button>` : `<span class="link-client-hint">未链接</span>`}
              </label>`;
                    })
                    .join("")
            }
          </div>
        </div>
        <div class="alert-dialog-actions">
          <button id="link-dialog-cancel" class="secondary-button" type="button">关闭</button>
          <button id="link-dialog-confirm" class="primary-button" type="button" ${state.skillTransferBusy ? "disabled" : ""}>链接选中</button>
        </div>
      </section>
    </div>`;
}

function renderSkillGroupDialog(): string {
  if (!state.skillGroupDialog) return "";
  const dialog = state.skillGroupDialog;
  const title = dialog.mode === "create" ? "新建分组" : "重命名分组";
  const hint =
    dialog.mode === "create"
      ? dialog.addSelected
        ? `将新建分组，并把当前选中的 ${state.selectedSkillKeys.size} 个 Skill 加入。`
        : "新建一个空分组，之后可把 Skill 加入。"
      : "修改分组名称（不影响 Skill 文件）。";
  return `
    <div class="alert-dialog-backdrop" role="presentation">
      <section class="alert-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="group-dialog-title">
        <div class="alert-dialog-icon">▤</div>
        <div class="alert-dialog-copy">
          <h2 id="group-dialog-title">${title}</h2>
          <p>${html(hint)}</p>
          <label class="import-target-row"><span>名称</span>
            <input id="group-name-input" class="group-name-input" type="text" maxlength="40" value="${html(dialog.name)}" placeholder="例如：前端组 / 调试组" />
          </label>
        </div>
        <div class="alert-dialog-actions">
          <button id="group-dialog-cancel" class="secondary-button" type="button">取消</button>
          <button id="group-dialog-confirm" class="primary-button" type="button">${dialog.mode === "create" ? "创建" : "保存"}</button>
        </div>
      </section>
    </div>`;
}

function renderImportDialog(): string {
  if (!state.importSkillDialog) return "";
  const dialog = state.importSkillDialog;
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
          <button id="import-dialog-confirm" class="primary-button" type="button" ${targets.length === 0 || state.skillTransferBusy ? "disabled" : ""}>确认导入</button>
        </div>
      </section>
    </div>`;
}

function renderMarketInstallDialog(): string {
  if (!state.marketInstallDialog) return "";
  const dialog = state.marketInstallDialog;
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
  if (!state.mcpInstallDialog) return "";
  const dialog = state.mcpInstallDialog;
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
  document.documentElement.dataset.theme = state.currentTheme;
  document.documentElement.style.colorScheme = state.currentTheme;
  document.body.setAttribute("data-dark-mode", state.currentTheme === "dark" ? "true" : "false");
}

function syncThemeControls(): void {
  document.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach((toggle) => {
    toggle.setAttribute("value", state.currentTheme);
  });
  document.querySelectorAll<HTMLElement>(".theme-seg").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.themeMode === state.themeMode);
  });
}

function setThemeMode(mode: ThemeMode): void {
  state.themeMode = mode;
  localStorage.setItem(themeStorageKey, mode);
  state.currentTheme = resolveTheme(mode);
  // 主题控件本身有完整 CSS 动画；这里不重绘整棵 DOM，避免组件被重建导致动画中断。
  applyThemeToDocument();
  syncThemeControls();
}

// 右键菜单独立浮层：打开/关闭只增量挂载菜单 + 切换目标行高亮，不触发 renderApp 全量重建，从根上消除右键抖动。
function bindSkillContextMenuEvents(): void {
  document.querySelectorAll<HTMLButtonElement>(".skill-context-action").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const context = state.skillContextMenu;
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
  document.querySelector(".skill-context-menu:not(.rule-context-menu)")?.remove();
  document.querySelectorAll(".is-context-target").forEach((el) => el.classList.remove("is-context-target"));
  const ctx = state.skillContextMenu;
  if (!ctx) return;
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  shell.insertAdjacentHTML("beforeend", renderSkillContextMenu());
  document.querySelectorAll<HTMLElement>("[data-skill-key]").forEach((el) => {
    if (el.dataset.skillKey === ctx.key) el.classList.add("is-context-target");
  });
  bindSkillContextMenuEvents();
}

function openSkillContextMenu(menu: SkillContextMenuState): void {
  if (state.ruleContextMenu) closeRuleContextMenu();
  state.skillContextMenu = menu;
  refreshSkillContextMenu();
}

function closeSkillContextMenu(): void {
  if (!state.skillContextMenu) return;
  state.skillContextMenu = null;
  refreshSkillContextMenu();
}

// 可接收 Rule 的目标：已安装的 catalog 客户端（排除来源），复制时落到其 rules 目录。
function ruleTargetClients(sourceClientId?: string): RuntimeClient[] {
  const order = new Map(clients.map((client, index) => [client.id, index]));
  return installedClients()
    .filter((client) => order.has(client.id) && client.id !== sourceClientId)
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}

async function copyRuleToClient(rulePath: string, targetClientId: string, action: "copy" | "move" = "copy"): Promise<void> {
  closeRuleContextMenu();
  try {
    const message = await api.copyRuleToClient(rulePath, targetClientId);
    if (action === "move") {
      await api.deleteRules([rulePath]);
      setSkillActionMessage("已移动 Rule 到目标客户端", 2600);
    } else {
      setSkillActionMessage(message, 2600);
    }
    await loadEnvironment(true);
  } catch (error) {
    setSkillActionMessage(`${action === "move" ? "移动" : "复制"}失败：${error instanceof Error ? error.message : String(error)}`, 4200);
  }
}

async function deleteRules(paths: string[]): Promise<void> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return;
  try {
    const result = await api.deleteRules(unique);
    setSkillActionMessage(result.message, 2600);
    await loadEnvironment(true);
  } catch (error) {
    setSkillActionMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`, 4200);
  }
}

function openDeleteRulesDialog(path: string, label?: string): void {
  state.confirmDialog = {
    title: "删除 Rule",
    message: `确认删除 ${label ?? "该 Rule"}？会先移动到 SMRmanager 回收目录，便于恢复。`,
    confirmLabel: "删除",
    cancelLabel: "取消",
    paths: [path],
    kind: "rules"
  };
  state.ruleContextMenu = null;
  renderApp(true);
}

function renderRuleContextMenu(): string {
  const ctx = state.ruleContextMenu;
  if (!ctx) return "";
  const rule = state.environment?.rules.find((item) => item.path === ctx.path);
  if (!rule) return "";
  const targets = ruleTargetClients(ctx.clientId);
  const left = Math.max(12, Math.min(ctx.x, window.innerWidth - 330));
  const top = Math.max(12, Math.min(ctx.y, window.innerHeight - 430));
  const targetRows = targets.length
    ? targets
        .map(
          (target) => `
            <div class="context-target-row">
              <span><strong>${html(target.name)}</strong><small>${html(target.type)}</small></span>
              <button class="rule-context-action" data-action="copy" data-target-client-id="${html(target.id)}" type="button">复制</button>
              <button class="rule-context-action move" data-action="move" data-target-client-id="${html(target.id)}" type="button">移动</button>
            </div>`
        )
        .join("")
    : `<div class="context-empty">没有其他已安装客户端可复制。</div>`;
  return `
    <div class="skill-context-menu rule-context-menu" style="left:${left}px;top:${top}px" role="menu">
      <div class="context-menu-title"><span>Rule 操作</span><strong>${html(rule.name)}</strong></div>
      <button class="context-menu-line" id="rule-context-copy-path" data-copy-path="${html(rule.path)}" type="button">复制路径</button>
      <button class="context-menu-line is-danger" id="rule-context-delete" data-rule-path="${html(rule.path)}" type="button">删除 Rule</button>
      <div class="context-menu-divider"></div>
      <div class="context-menu-caption">复制 / 移动到已安装客户端</div>
      <div class="context-target-list">${targetRows}</div>
    </div>`;
}

function bindRuleContextMenuEvents(): void {
  document.querySelectorAll<HTMLButtonElement>(".rule-context-action").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const ctx = state.ruleContextMenu;
      if (!ctx) return;
      const action = button.dataset.action === "move" ? "move" : "copy";
      void copyRuleToClient(ctx.path, button.dataset.targetClientId ?? "", action);
    });
  });
  document.querySelector<HTMLButtonElement>("#rule-context-copy-path")?.addEventListener("click", async (event) => {
    event.stopPropagation();
    const path = (event.currentTarget as HTMLButtonElement).dataset.copyPath ?? "";
    closeRuleContextMenu();
    try {
      await navigator.clipboard.writeText(path);
      setSkillActionMessage("已复制 Rule 路径", 1600);
    } catch {
      setSkillActionMessage(path, 5200);
    }
  });
  document.querySelector<HTMLButtonElement>("#rule-context-delete")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const ctx = state.ruleContextMenu;
    const rule = ctx ? state.environment?.rules.find((item) => item.path === ctx.path) : undefined;
    const path = (event.currentTarget as HTMLButtonElement).dataset.rulePath ?? "";
    if (!path) return;
    openDeleteRulesDialog(path, rule?.name);
  });
}

function refreshRuleContextMenu(): void {
  document.querySelector(".rule-context-menu")?.remove();
  const ctx = state.ruleContextMenu;
  if (!ctx) return;
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  shell.insertAdjacentHTML("beforeend", renderRuleContextMenu());
  bindRuleContextMenuEvents();
}

function openRuleContextMenu(menu: RuleContextMenuState): void {
  if (state.skillContextMenu) closeSkillContextMenu();
  state.ruleContextMenu = menu;
  refreshRuleContextMenu();
}

function closeRuleContextMenu(): void {
  if (!state.ruleContextMenu) return;
  state.ruleContextMenu = null;
  refreshRuleContextMenu();
}

function renderApp(preserveScroll = false): void {
  const workspaceScrollTop = preserveScroll ? (document.querySelector<HTMLElement>(".workspace")?.scrollTop ?? 0) : 0;
  const clientTabScrollTop = preserveScroll ? (document.querySelector<HTMLElement>(".client-tab-scroll")?.scrollTop ?? 0) : 0;
  const clientListScrollTop = preserveScroll ? (document.querySelector<HTMLElement>(".client-list")?.scrollTop ?? 0) : 0;
  applyThemeToDocument();
  appRoot.innerHTML = `<div class="app-shell ${state.currentView === "market" ? "market-preview-shell" : ""}">${renderWindowControls()}${renderSidebar()}${renderContent()}${renderConfirmDialog()}${renderImportDialog()}${renderMarketInstallDialog()}${renderMcpInstallDialog()}${renderSkillGroupDialog()}${renderSkillLinkDialog()}${renderGitInstallDialog()}${renderProjectAddSkillDialog()}</div>`;
  bindInteractions();
  refreshSkillContextMenu();
  refreshRuleContextMenu();
  if (preserveScroll) {
    const workspace = document.querySelector<HTMLElement>(".workspace");
    const clientTab = document.querySelector<HTMLElement>(".client-tab-scroll");
    const clientList = document.querySelector<HTMLElement>(".client-list");
    if (workspace) workspace.scrollTop = workspaceScrollTop;
    if (clientTab) clientTab.scrollTop = clientTabScrollTop;
    if (clientList) clientList.scrollTop = clientListScrollTop;
  }
}

function bindInteractions(): void {
  // 仅主页客户端行：WSL/项目 L2 复用 .client-row 但带专属 data-*，由各自 handler 处理，避免切回主页。
  document.querySelectorAll<HTMLButtonElement>(".client-row:not([data-wsl-client]):not([data-project-client])").forEach((button) => {
    button.addEventListener("click", () => {
      state.skillContextMenu = null;
      state.clientMenuOpen = false;
      state.activeClientIndex = Number(button.dataset.clientIndex ?? 0);
      state.activeClientTab = "skills";
      state.currentView = "clients";
      renderApp(true);
    });
  });
  document.querySelectorAll<HTMLElement>(".client-row[draggable='true']").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      row.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.dataset.clientId ?? "");
      }
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      document
        .querySelectorAll(".client-row.is-drop-target")
        .forEach((element) => element.classList.remove("is-drop-target"));
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      row.classList.add("is-drop-target");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("is-drop-target");
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("is-drop-target");
      const sourceId = event.dataTransfer?.getData("text/plain") ?? "";
      const targetId = row.dataset.clientId ?? "";
      if (!sourceId || !targetId || sourceId === targetId) return;
      const selectedId = displayClients()[state.activeClientIndex]?.id;
      const order = orderedBaseClients().map((client) => client.id);
      const from = order.indexOf(sourceId);
      const to = order.indexOf(targetId);
      if (from < 0 || to < 0) return;
      order.splice(from, 1);
      order.splice(to, 0, sourceId);
      state.clientOrder = order;
      saveClientOrder();
      if (selectedId) {
        const newIndex = displayClients().findIndex((client) => client.id === selectedId);
        if (newIndex >= 0) state.activeClientIndex = newIndex;
      }
      renderApp(true);
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.skillContextMenu = null;
      state.clientMenuOpen = false;
      state.currentView = (button.dataset.view as ViewName | undefined) ?? "clients";
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
    state.confirmDialog = null;
    renderApp(true);
  });
  document.querySelector<HTMLButtonElement>("#confirm-dialog-confirm")?.addEventListener("click", () => {
    const dialog = state.confirmDialog;
    state.confirmDialog = null;
    renderApp(true);
    if (!dialog) return;
    if (dialog.kind === "client" && dialog.clientId) {
      void deleteClientConfig(dialog.clientId);
    } else if (dialog.kind === "group" && dialog.groupId) {
      deleteSkillGroup(dialog.groupId);
    } else if (dialog.kind === "rules") {
      void deleteRules(dialog.paths);
    } else {
      void deleteSkills(dialog.paths);
    }
  });
  document.querySelector<HTMLButtonElement>("#client-actions-toggle")?.addEventListener("click", (event) => {
    event.stopPropagation();
    state.clientMenuOpen = !state.clientMenuOpen;
    renderApp();
  });
  // —— WSL 页事件 ——
  document.querySelectorAll<HTMLButtonElement>("[data-wsl-distro]").forEach((button) => {
    button.addEventListener("click", () => selectWslDistro(button.dataset.wslDistro ?? ""));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-wsl-back]").forEach((button) => {
    button.addEventListener("click", () => backToWslInstances());
  });
  document.querySelectorAll<HTMLButtonElement>("[data-wsl-client]").forEach((button) => {
    button.addEventListener("click", () => {
      state.wslActiveClientId = button.dataset.wslClient ?? "";
      state.activeClientTab = "skills";
      renderApp(true);
    });
  });
  // —— 项目页事件 ——
  document.querySelectorAll<HTMLButtonElement>("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => selectProject(button.dataset.projectId ?? ""));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-project-back]").forEach((button) => {
    button.addEventListener("click", () => backToProjects());
  });
  document.querySelectorAll<HTMLButtonElement>("[data-project-client]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeProjectClientId = button.dataset.projectClient ?? "";
      state.activeClientTab = "skills";
      renderApp(true);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-add-project]").forEach((button) => {
    button.addEventListener("click", () => void addProject());
  });
  document.querySelectorAll<HTMLElement>("[data-remove-project]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      removeProject(element.dataset.removeProject ?? "");
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-project-skill-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const f = button.dataset.projectSkillFilter;
      state.projectSkillFilter = f === "enabled" ? "enabled" : f === "disabled" ? "disabled" : "all";
      renderApp(true);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-skill-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const skillDir = button.dataset.skillToggle;
      const clientId = button.dataset.skillClient;
      if (!skillDir || !clientId) return;
      const enabled = button.dataset.skillEnabled !== "1";
      void setProjectSkillEnabled(clientId, skillDir, enabled);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-add-project-skill]").forEach((button) => {
    button.addEventListener("click", () => {
      state.projectAddSkillDialog = { clientId: button.dataset.addProjectSkill ?? "" };
      state.projectAddSkillQuery = "";
      renderApp(true);
    });
  });
  const addSkillSearch = document.querySelector<HTMLInputElement>("#add-skill-search");
  addSkillSearch?.addEventListener("input", () => {
    state.projectAddSkillQuery = addSkillSearch.value;
    // 只局部更新列表，不整页 renderApp（避免抖动；input 不重建、焦点天然保持）。
    const list = document.querySelector<HTMLElement>(".add-skill-list");
    if (list) list.innerHTML = projectAddSkillRows();
  });
  // 列表用事件委托（搜索局部更新 innerHTML 后按钮仍可点）。
  document.querySelector<HTMLElement>(".add-skill-list")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-add-skill-path]");
    if (!button) return;
    const dlg = state.projectAddSkillDialog;
    if (!dlg) return;
    state.projectAddSkillDialog = null;
    renderApp(true);
    void transferSkills([button.dataset.addSkillPath ?? ""], dlg.clientId, "copy");
  });
  document.querySelectorAll<HTMLElement>("[data-close-add-skill], [data-add-skill-backdrop]").forEach((el) => {
    el.addEventListener("click", (event) => {
      if (event.target !== event.currentTarget) return;
      state.projectAddSkillDialog = null;
      renderApp(true);
    });
  });
  document.querySelector<HTMLButtonElement>("#refresh-wsl")?.addEventListener("click", () => void loadWslInstances());
  document.querySelectorAll<HTMLButtonElement>("[data-wsl-terminal]").forEach((button) => {
    button.addEventListener("click", () => {
      void api.wslOpenTerminal(button.dataset.wslTerminal ?? "").catch((e) =>
        setSkillActionMessage(`打开终端失败：${e instanceof Error ? e.message : String(e)}`, 4000)
      );
    });
  });
  document.querySelector<HTMLButtonElement>("#wsl-actions-toggle")?.addEventListener("click", (event) => {
    event.stopPropagation();
    state.clientMenuOpen = !state.clientMenuOpen;
    renderApp(true);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-wsl-default]").forEach((button) => {
    button.addEventListener("click", () => {
      state.clientMenuOpen = false;
      void wslControl("wsl_set_default", button.dataset.wslDefault ?? "", "已设为默认发行版");
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-wsl-start]").forEach((button) => {
    button.addEventListener("click", () => {
      state.clientMenuOpen = false;
      void wslControl("wsl_start", button.dataset.wslStart ?? "", "已启动发行版");
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-wsl-stop]").forEach((button) => {
    button.addEventListener("click", () => {
      state.clientMenuOpen = false;
      void wslControl("wsl_terminate", button.dataset.wslStop ?? "", "已停止发行版");
    });
  });
  // —— 从 Git 安装 ——
  document.querySelectorAll<HTMLButtonElement>("#git-install-button").forEach((button) => {
    button.addEventListener("click", () => openGitInstall());
  });
  const gitUrlInput = document.querySelector<HTMLInputElement>("#git-url-input");
  gitUrlInput?.addEventListener("input", () => {
    if (state.gitInstallDialog) state.gitInstallDialog.url = gitUrlInput.value;
  });
  const gitSubdirInput = document.querySelector<HTMLInputElement>("#git-subdir-input");
  gitSubdirInput?.addEventListener("input", () => {
    if (state.gitInstallDialog) state.gitInstallDialog.subdir = gitSubdirInput.value;
  });
  document.querySelector<HTMLButtonElement>("#git-inspect-btn")?.addEventListener("click", () => void gitInspect());
  document.querySelector<HTMLButtonElement>("#git-apply-btn")?.addEventListener("click", () => void gitApply());
  document.querySelector<HTMLButtonElement>("#git-dialog-cancel")?.addEventListener("click", () => {
    state.gitInstallDialog = null;
    renderApp(true);
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
        state.clientMenuOpen = false;
        state.confirmDialog = {
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
    if (state.importSkillDialog) state.importSkillDialog.targetClientId = importTargetSelect.value;
  });
  document.querySelector<HTMLButtonElement>("#import-dialog-cancel")?.addEventListener("click", () => {
    state.importSkillDialog = null;
    renderApp(true);
  });
  document.querySelector<HTMLButtonElement>("#import-dialog-confirm")?.addEventListener("click", () => {
    const dialog = state.importSkillDialog;
    if (!dialog) return;
    const target = document.querySelector<HTMLSelectElement>("#import-target-select")?.value || dialog.targetClientId;
    void importSkill(dialog.sourceDir, target);
  });
  const marketInstallSelect = document.querySelector<HTMLSelectElement>("#market-install-target");
  marketInstallSelect?.addEventListener("change", () => {
    if (state.marketInstallDialog) state.marketInstallDialog.targetClientId = marketInstallSelect.value;
  });
  document.querySelector<HTMLButtonElement>("#market-install-cancel")?.addEventListener("click", () => {
    state.marketInstallDialog = null;
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#market-install-confirm")?.addEventListener("click", () => {
    const dialog = state.marketInstallDialog;
    if (!dialog) return;
    const skill = marketSkills.find((item) => item.id === dialog.skillId);
    const method = skill?.methods.find((item) => item.id === dialog.methodId);
    if (!skill || !method) return;
    const target = document.querySelector<HTMLSelectElement>("#market-install-target")?.value || dialog.targetClientId;
    state.marketInstallDialog = null;
    void installMarketSkill(skill, method, target);
  });
  const mcpInstallSelect = document.querySelector<HTMLSelectElement>("#mcp-install-target");
  mcpInstallSelect?.addEventListener("change", () => {
    if (state.mcpInstallDialog) state.mcpInstallDialog.targetClientId = mcpInstallSelect.value;
  });
  document.querySelector<HTMLButtonElement>("#mcp-install-cancel")?.addEventListener("click", () => {
    state.mcpInstallDialog = null;
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#mcp-install-confirm")?.addEventListener("click", () => {
    const dialog = state.mcpInstallDialog;
    if (!dialog) return;
    const mcp = marketMcps.find((item) => item.id === dialog.mcpId);
    if (!mcp) return;
    const target = document.querySelector<HTMLSelectElement>("#mcp-install-target")?.value || dialog.targetClientId;
    state.mcpInstallDialog = null;
    void installMcpServer(mcp, target);
  });
  document.querySelector<HTMLElement>(".alert-dialog-backdrop")?.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest(".alert-dialog")) return;
    state.confirmDialog = null;
    state.importSkillDialog = null;
    state.marketInstallDialog = null;
    state.mcpInstallDialog = null;
    renderApp(true);
  });
  document.querySelector<HTMLButtonElement>("#check-app-update")?.addEventListener("click", () => void checkUpdates(true));
  document.querySelector<HTMLButtonElement>("#open-release-page")?.addEventListener("click", () => {
    const url = state.updateInfo?.releaseUrl || state.updateInfo?.downloadUrl;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });
  document.querySelector<HTMLButtonElement>("#dismiss-update-version")?.addEventListener("click", () => {
    if (state.updateInfo?.latestVersion) localStorage.setItem(dismissedUpdateStorageKey, state.updateInfo.latestVersion);
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#detect-wsl")?.addEventListener("click", () => void detectWslDistros());
  document.querySelectorAll<HTMLButtonElement>("[data-add-wsl]").forEach((button) => {
    button.addEventListener("click", () => {
      const distro = state.wslDistros.find((d) => d.distro === button.dataset.addWsl);
      if (distro) addWslDistroAsRoot(distro);
    });
  });
  document.querySelector<HTMLButtonElement>("#add-scan-root")?.addEventListener("click", () => {
    const labelInput = document.querySelector<HTMLInputElement>("#scan-root-label");
    const pathInput = document.querySelector<HTMLInputElement>("#scan-root-path");
    const path = pathInput?.value.trim() ?? "";
    if (!path) {
      setSkillActionMessage("请填写扫描目录路径", 2600);
      return;
    }
    const label = labelInput?.value.trim() || path;
    addScanRoot({ tag: `custom-${Date.now()}`, label, path, kind: "custom" });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-remove-root]").forEach((button) => {
    button.addEventListener("click", () => {
      const tag = button.dataset.removeRoot;
      if (tag) removeScanRoot(tag);
    });
  });
  document.querySelector<HTMLButtonElement>("#sidebar-update-open")?.addEventListener("click", () => {
    state.currentView = "settings";
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#sidebar-update-dismiss")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.updateInfo?.latestVersion) localStorage.setItem(dismissedUpdateStorageKey, state.updateInfo.latestVersion);
    renderApp();
  });
  document.querySelectorAll<HTMLButtonElement>("#refresh-detection").forEach((button) => button.addEventListener("click", () => void loadEnvironment(true)));
  document.querySelectorAll<HTMLButtonElement>("[data-open-terminal]").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.openTerminal;
      if (!path) return;
      void api.openTerminalAt(path).catch((e) =>
        setSkillActionMessage(`打开终端失败：${e instanceof Error ? e.message : String(e)}`, 4000)
      );
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-launch-project]").forEach((button) => {
    button.addEventListener("click", () => {
      const clientId = button.dataset.launchProject;
      const projectPath = button.dataset.projectPath;
      if (!clientId || !projectPath) return;
      void api.launchClientInProject(projectPath, clientId).catch((e) =>
        setSkillActionMessage(`启动失败：${e instanceof Error ? e.message : String(e)}`, 4000)
      );
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".launch-client-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const clientId = button.dataset.clientId;
      if (!clientId) return;
      button.textContent = "启动中...";
      button.disabled = true;
      try {
        await api.launchClient(clientId);
        button.textContent = "已启动";
      } catch (error) {
        button.textContent = "启动失败";
        state.installLogs[clientId] = error instanceof Error ? error.message : String(error);
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
      state.marketInstallDialog = { skillId: skill.id, methodId: method.id, targetClientId: preferredSkillTargetId(targets) };
      renderApp();
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".market-page-tab[data-market-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.marketTab = button.dataset.marketTab === "mcp" ? "mcp" : "skill";
      renderApp();
    });
  });
  const mcpSearchInput = document.querySelector<HTMLInputElement>("#mcp-search-input");
  mcpSearchInput?.addEventListener("input", () => {
    const cursor = mcpSearchInput.selectionStart ?? mcpSearchInput.value.length;
    state.mcpQuery = mcpSearchInput.value;
    renderApp();
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLInputElement>("#mcp-search-input");
      next?.focus();
      next?.setSelectionRange(cursor, cursor);
    });
  });
  const mcpSortSelect = document.querySelector<HTMLSelectElement>("#mcp-sort-select");
  mcpSortSelect?.addEventListener("change", () => {
    state.mcpSort = mcpSortSelect.value === "transport" ? "transport" : "name";
    renderApp();
  });
  const marketSkillSearch = document.querySelector<HTMLInputElement>("#market-skill-search");
  marketSkillSearch?.addEventListener("input", () => {
    const cursor = marketSkillSearch.selectionStart ?? marketSkillSearch.value.length;
    state.marketSkillQuery = marketSkillSearch.value;
    renderApp();
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLInputElement>("#market-skill-search");
      next?.focus();
      next?.setSelectionRange(cursor, cursor);
    });
  });
  const marketSkillSortSelect = document.querySelector<HTMLSelectElement>("#market-skill-sort");
  marketSkillSortSelect?.addEventListener("change", () => {
    state.marketSkillSort = marketSkillSortSelect.value === "rating" ? "rating" : "name";
    renderApp();
  });
  document.querySelectorAll<HTMLButtonElement>(".category-pill[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.marketSkillCategory = button.dataset.category ?? "全部";
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
      state.mcpInstallDialog = { mcpId: mcp.id, targetClientId: targets[0].id };
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
  document.querySelectorAll<HTMLElement>("[data-open-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = button.dataset.openPath;
      if (!target) return;
      try {
        await api.openPath(target);
      } catch (error) {
        setSkillActionMessage(`打开失败：${error instanceof Error ? error.message : String(error)}`, 4200);
      }
    });
  });
  const skillSearchInput = document.querySelector<HTMLInputElement>("#skill-search-input");
  skillSearchInput?.addEventListener("input", () => {
    const input = skillSearchInput;
    const cursor = input.selectionStart ?? input.value.length;
    state.skillQuery = input.value;
    renderApp();
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLInputElement>("#skill-search-input");
      next?.focus();
      next?.setSelectionRange(cursor, cursor);
    });
  });
  const skillClientSelect = document.querySelector<HTMLSelectElement>("#skill-client-filter");
  skillClientSelect?.addEventListener("change", () => {
    state.skillClientFilter = skillClientSelect.value;
    state.selectedSkillKeys.clear();
    renderApp();
  });
  const skillStatusSelect = document.querySelector<HTMLSelectElement>("#skill-status-filter");
  skillStatusSelect?.addEventListener("change", () => {
    state.skillStatusFilter = skillStatusSelect.value;
    state.selectedSkillKeys.clear();
    renderApp();
  });
  const skillTagSelect = document.querySelector<HTMLSelectElement>("#skill-tag-filter");
  skillTagSelect?.addEventListener("change", () => {
    state.skillTagFilter = skillTagSelect.value;
    state.selectedSkillKeys.clear();
    state.skillPage = 1;
    renderApp();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-group-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSkillGroupId = button.dataset.groupSelect ?? "";
      state.selectedSkillKeys.clear();
      state.skillPage = 1;
      renderApp();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-group-rename]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openRenameGroupDialog(button.dataset.groupRename ?? "");
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-group-delete]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = button.dataset.groupDelete ?? "";
      const group = findSkillGroup(id);
      if (!group) return;
      state.confirmDialog = {
        title: "删除分组",
        message: `确认删除分组「${group.name}」？只删除分组本身，不会删除任何 Skill 文件。`,
        confirmLabel: "删除",
        cancelLabel: "取消",
        paths: [],
        kind: "group",
        groupId: id
      };
      renderApp(true);
    });
  });
  document.querySelector<HTMLButtonElement>("#new-skill-group")?.addEventListener("click", () => openCreateGroupDialog(false));
  const addToGroupSelect = document.querySelector<HTMLSelectElement>("#add-to-group-select");
  addToGroupSelect?.addEventListener("change", () => {
    const value = addToGroupSelect.value;
    addToGroupSelect.value = "";
    if (value === "__new__") {
      openCreateGroupDialog(true);
    } else if (value) {
      addSelectedToGroup(value);
      renderApp();
    }
  });
  document.querySelector<HTMLButtonElement>("#remove-from-group")?.addEventListener("click", () => {
    if (!state.activeSkillGroupId) return;
    removeSelectedFromGroup(state.activeSkillGroupId);
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#assign-group")?.addEventListener("click", () => {
    const target = document.querySelector<HTMLSelectElement>("#bulk-skill-target")?.value || state.skillBulkTargetId;
    if (state.activeSkillGroupId) assignGroupToClient(state.activeSkillGroupId, target);
  });
  document.querySelector<HTMLButtonElement>("#group-dialog-cancel")?.addEventListener("click", () => {
    state.skillGroupDialog = null;
    renderApp(true);
  });
  const groupNameInput = document.querySelector<HTMLInputElement>("#group-name-input");
  if (groupNameInput) {
    groupNameInput.addEventListener("input", () => {
      if (state.skillGroupDialog) state.skillGroupDialog.name = groupNameInput.value;
    });
    groupNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmSkillGroupDialog(groupNameInput.value);
      }
    });
    requestAnimationFrame(() => groupNameInput.focus());
  }
  document.querySelector<HTMLButtonElement>("#group-dialog-confirm")?.addEventListener("click", () => {
    const input = document.querySelector<HTMLInputElement>("#group-name-input");
    confirmSkillGroupDialog(input?.value ?? state.skillGroupDialog?.name ?? "");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-adopt-skill-path]").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.adoptSkillPath;
      if (path) void adoptToLibrary([path]);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-link-skill-path]").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.linkSkillPath;
      if (!path) return;
      state.skillLinkDialog = { skillPath: path, skillName: button.dataset.skillName ?? "该 Skill" };
      renderApp(true);
    });
  });
  document.querySelector<HTMLButtonElement>("#link-dialog-cancel")?.addEventListener("click", () => {
    state.skillLinkDialog = null;
    renderApp(true);
  });
  document.querySelector<HTMLButtonElement>("#link-dialog-confirm")?.addEventListener("click", () => {
    if (!state.skillLinkDialog) return;
    const ids = [...document.querySelectorAll<HTMLInputElement>(".link-client-check")]
      .filter((c) => c.checked && !c.disabled)
      .map((c) => c.dataset.clientId ?? "")
      .filter(Boolean);
    if (ids.length === 0) {
      setSkillActionMessage("请勾选要链接的客户端", 2400);
      return;
    }
    void linkSkillToClients(state.skillLinkDialog.skillPath, ids);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-unlink-client]").forEach((button) => {
    button.addEventListener("click", () => {
      const cid = button.dataset.unlinkClient;
      if (cid && state.skillLinkDialog) void unlinkSkillFromClients(state.skillLinkDialog.skillPath, [cid]);
    });
  });
  const bulkSkillTarget = document.querySelector<HTMLSelectElement>("#bulk-skill-target");
  bulkSkillTarget?.addEventListener("change", () => {
    state.skillBulkTargetId = bulkSkillTarget.value;
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#copy-selected-skills")?.addEventListener("click", () => {
    const target = document.querySelector<HTMLSelectElement>("#bulk-skill-target")?.value || state.skillBulkTargetId;
    void transferSkills(selectedPathsFromKeys(), target, "copy");
  });
  document.querySelector<HTMLButtonElement>("#move-selected-skills")?.addEventListener("click", () => {
    const target = document.querySelector<HTMLSelectElement>("#bulk-skill-target")?.value || state.skillBulkTargetId;
    void transferSkills(selectedPathsFromKeys(), target, "move");
  });
  document.querySelectorAll<HTMLInputElement>(".skill-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const key = checkbox.dataset.skillKey;
      if (!key) return;
      if (checkbox.checked) state.selectedSkillKeys.add(key);
      else state.selectedSkillKeys.delete(key);
      renderApp();
    });
  });
  const selectAllSkills = document.querySelector<HTMLInputElement>("#select-all-skills");
  selectAllSkills?.addEventListener("change", () => {
    const checked = selectAllSkills.checked;
    document.querySelectorAll<HTMLInputElement>(".skill-checkbox").forEach((checkbox) => {
      const key = checkbox.dataset.skillKey;
      if (!key) return;
      if (checked) state.selectedSkillKeys.add(key);
      else state.selectedSkillKeys.delete(key);
    });
    renderApp();
  });
  document.querySelector<HTMLButtonElement>("#clear-skill-selection")?.addEventListener("click", () => {
    state.selectedSkillKeys.clear();
    renderApp();
  });
  document.querySelectorAll<HTMLButtonElement>(".skills-view-button[data-skill-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.skillGridView = button.dataset.skillView === "grid";
      renderApp();
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".pager-btn[data-pager]").forEach((button) => {
    button.addEventListener("click", () => {
      const scope = button.dataset.pager;
      const dir = button.dataset.page === "next" ? 1 : -1;
      if (scope === "skill") state.skillPage = Math.max(1, state.skillPage + dir);
      else if (scope === "rule") state.rulePage = Math.max(1, state.rulePage + dir);
      renderApp();
    });
  });
  document.querySelectorAll<HTMLSelectElement>(".pager-size[data-pager-size]").forEach((select) => {
    select.addEventListener("change", () => {
      const size = Number(select.value);
      if (Number.isFinite(size) && size > 0) state.listPageSize = size;
      state.skillPage = 1;
      state.rulePage = 1;
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
  document.querySelectorAll<HTMLElement>(".rule-list-row[data-rule-path], .client-rule-row[data-rule-path]").forEach((row) => {
    row.addEventListener("contextmenu", (event) => {
      const path = row.dataset.rulePath;
      const clientId = row.dataset.ruleClient ?? "";
      if (!path) return;
      event.preventDefault();
      openRuleContextMenu({ path, clientId, x: event.clientX, y: event.clientY });
    });
  });
  document.querySelector<HTMLElement>(".app-shell")?.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (state.clientMenuOpen && !target?.closest(".client-menu-wrap")) {
      state.clientMenuOpen = false;
      renderApp();
      return;
    }
    if (state.ruleContextMenu && !target?.closest(".rule-context-menu")) {
      closeRuleContextMenu();
    }
    if (!state.skillContextMenu) return;
    if (target?.closest(".skill-context-menu")) return;
    closeSkillContextMenu();
  });
  document.querySelectorAll<HTMLButtonElement>(".tab[data-client-tab]").forEach((button) => button.addEventListener("click", () => {
    state.skillContextMenu = null;
    state.activeClientTab = (button.dataset.clientTab as ClientTab | undefined) ?? "skills";
    renderApp();
  }));
  const currentWindow = getCurrentWindow();
  document.querySelector<HTMLButtonElement>("#titlebar-minimize")?.addEventListener("click", () => void currentWindow.minimize().catch(console.error));
  document.querySelector<HTMLButtonElement>("#titlebar-maximize")?.addEventListener("click", () => void currentWindow.toggleMaximize().catch(console.error));
  document.querySelector<HTMLButtonElement>("#titlebar-close")?.addEventListener("click", () => void currentWindow.close().catch(console.error));
}

if (import.meta.hot) {
  import.meta.hot.dispose((data: HotState) => {
    data.activeClientIndex = state.activeClientIndex;
    data.activeClientTab = state.activeClientTab;
    data.currentView = state.currentView;
    data.themeMode = state.themeMode;
    data.environment = state.environment;
    data.detectionError = state.detectionError;
    data.installLogs = state.installLogs;
    data.selectedSkillKeys = [...state.selectedSkillKeys];
    data.skillBulkTargetId = state.skillBulkTargetId;
    data.skillQuery = state.skillQuery;
    data.skillClientFilter = state.skillClientFilter;
    data.skillStatusFilter = state.skillStatusFilter;
    data.skillTagFilter = state.skillTagFilter;
    data.activeSkillGroupId = state.activeSkillGroupId;
    data.updateInfo = state.updateInfo;
    data.updateError = state.updateError;
    data.updateChecking = state.updateChecking;
    appRoot.innerHTML = "";
  });
  import.meta.hot.accept();
}

// 主题“跟随系统”时，随系统日夜变化自动切换。
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (state.themeMode !== "system") return;
  state.currentTheme = resolveTheme(state.themeMode);
  applyThemeToDocument();
  syncThemeControls();
});

renderApp();
void loadEnvironment();
void refreshInstalledMarketSkills();
