// 数据访问 / Model 层：基于 state 的纯读取与派生（不碰 DOM、不触发渲染）。
import type { Client, RuntimeClient, RuntimeMcpServer, RuntimeSkill, RuntimeRule, MarketSkill } from "../types";
import { state } from "../state";
import { clients } from "../catalog";
import { skillKey } from "../dom";

export function runtime(client: Client): RuntimeClient | undefined {
  return state.environment?.clients.find((item) => item.id === client.id);
}

export function clientMcps(clientId: string): RuntimeMcpServer[] {
  return state.environment?.mcpServers.filter((item) => item.clientId === clientId) ?? [];
}

export function clientSkills(clientId: string): RuntimeSkill[] {
  return (state.environment?.skills ?? [])
    .filter((item) => item.clientId === clientId)
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
}

export function clientRules(clientId: string): RuntimeRule[] {
  return (state.environment?.rules ?? [])
    .filter((item) => item.clientId === clientId)
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
}

export function installedClients(): RuntimeClient[] {
  return state.environment?.clients.filter((item) => item.installed) ?? [];
}

// 扩展根/WSL 检测出的客户端（source 非 windows），合成为 Client 以便在客户端页独立展示。
export function extraRuntimeClients(): RuntimeClient[] {
  return (state.environment?.clients ?? []).filter((item) => item.source && item.source !== "windows");
}

// 按用户自定义顺序排列固定客户端；未在顺序表中的（新客户端）按 catalog 原序追加在后。
export function orderedBaseClients(): Client[] {
  if (state.clientOrder.length === 0) return clients;
  const remaining = new Map(clients.map((client) => [client.id, client]));
  const ordered: Client[] = [];
  for (const id of state.clientOrder) {
    const client = remaining.get(id);
    if (client) {
      ordered.push(client);
      remaining.delete(id);
    }
  }
  for (const client of clients) {
    if (remaining.has(client.id)) ordered.push(client);
  }
  return ordered;
}

export function displayClients(): Client[] {
  const extra = extraRuntimeClients().map((rt): Client => {
    const baseId = rt.id.split("@")[0];
    const base = clients.find((b) => b.id === baseId);
    return {
      id: rt.id,
      name: rt.name,
      type: rt.source === "wsl" ? "WSL 客户端" : rt.source === "project" ? "项目客户端" : "扩展目录",
      fallbackPath: rt.detectedConfigPaths[0] ?? "",
      description: rt.description,
      iconFile: base?.iconFile ?? "/client-icons/claude.svg",
      installUrl: rt.installUrl
    };
  });
  return [...orderedBaseClients(), ...extra];
}

// WSL/扩展根来源的客户端 id 集合；判断某 skill 是否来自 WSL（只读保护用）。
export function extraClientIdSet(): Set<string> {
  return new Set(extraRuntimeClients().map((item) => item.id));
}

export function isExtraSourceSkill(skill: RuntimeSkill): boolean {
  return extraClientIdSet().has(skill.clientId);
}

export const skillWritableClientIds = new Set(["claude", "claude-desktop", "codex", "gemini", "opencode", "openclaw", "hermes", "cursor", "trae"]);

export function skillTargetClients(sourceClientId?: string): RuntimeClient[] {
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

export function skillByPath(path: string): RuntimeSkill | undefined {
  return state.environment?.skills.find((skill) => skill.path === path);
}

export function selectedPathsFromKeys(): string[] {
  const paths = new Set<string>();
  for (const skill of state.environment?.skills ?? []) {
    if (state.selectedSkillKeys.has(skillKey(skill))) paths.add(skill.path);
  }
  return [...paths];
}

export function transferPathsForContext(key: string, path: string): string[] {
  if (state.currentView === "skills" && state.selectedSkillKeys.has(key) && state.selectedSkillKeys.size > 1) {
    return selectedPathsFromKeys();
  }
  return [path];
}

export function preferredSkillTargetId(targets: RuntimeClient[]): string {
  if (targets.some((client) => client.id === state.skillBulkTargetId)) return state.skillBulkTargetId;
  return targets[0]?.id ?? "";
}

export function clientNameById(id: string): string {
  return clients.find((client) => client.id === id)?.name ?? id;
}

// 市场 skill 的可安装目标：该 skill 支持 ∩ 已安装且可写入 Skills 的客户端。
export function marketSkillTargets(skill: MarketSkill): RuntimeClient[] {
  const supported = new Set(skill.supportedClients);
  return skillTargetClients().filter((client) => supported.has(client.id));
}

// 可写入 MCP 配置的已安装客户端（与后端 mcp_write_target 对齐）。
export const mcpWritableClientIds = new Set(["claude", "claude-desktop", "gemini", "cursor", "trae", "codex"]);

export function mcpTargetClients(): RuntimeClient[] {
  const order = new Map(clients.map((client, index) => [client.id, index]));
  return installedClients()
    .filter((client) => mcpWritableClientIds.has(client.id))
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}

// 读取某 key 的用户备注（state.notes 由启动时 api.getNotes 加载）。
export function noteOf(key: string): string {
  return state.notes[key] ?? "";
}
