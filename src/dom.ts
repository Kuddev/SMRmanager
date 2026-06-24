// 纯助手函数（无任何模块状态依赖）：HTML 转义、图标、格式化、主题判定等。
import type { ThemeMode, ThemeName, RuntimeSkill, RuntimeRule } from "./types";

export function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function resolveTheme(mode: ThemeMode): ThemeName {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

export function html(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function iconPath(file: string, folder: "vendor-icons" | "skill-icons"): string {
  if (file.startsWith("/")) return file;
  if (file.includes("/")) return `/${file.replace(/^\/+/, "")}`;
  return `/${folder}/${file}`;
}

export function img(file: string, alt: string, folder: "vendor-icons" | "skill-icons" = "vendor-icons"): string {
  return `<img src="${html(iconPath(file, folder))}" alt="${html(alt)}" />`;
}

// 统一的描边 SVG 图标（替换难看的文本符号箭头）。
export function svgIcon(name: string, size = 16): string {
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

export function skillKey(skill: RuntimeSkill): string {
  return `${skill.clientId}::${skill.path}`;
}

export function epoch(value?: string | null): string {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toLocaleString() : "—";
}

export function updateTimestamp(value?: string | null): string {
  if (!value) return "—";
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toLocaleString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

export function navIcon(name: string): string {
  const map: Record<string, string> = { client: "▣", skills: "✦", wsl: "🐧", mcp: "◎", rules: "♙", market: "⌂", settings: "⚙" };
  return map[name] ?? "▣";
}

export function skillInitials(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9一-龥]/g, " ").trim();
  if (!clean) return "SK";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

export function skillTone(skill: RuntimeSkill): string {
  const tones = ["green", "blue", "purple", "orange", "red", "cyan", "slate"];
  const seed = `${skill.clientId}:${skill.directory}`.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return tones[seed % tones.length];
}

export function formatUpdated(value?: string | null): string {
  return epoch(value);
}

export function skillDescription(skill: RuntimeSkill): string {
  const value = (skill.description ?? "").trim();
  if (!value || value === "|" || value === ">") return "暂无描述";
  return value;
}

export function ruleTone(rule: RuntimeRule): string {
  const tones = ["green", "blue", "purple", "orange", "red", "cyan", "slate"];
  const seed = `${rule.clientId}:${rule.path}`.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return tones[seed % tones.length];
}
