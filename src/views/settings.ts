import { state } from "../state";
import { html, updateTimestamp } from "../dom";

// 由 vite.config.ts 的 define 注入（来自 package.json version）。
declare const __APP_VERSION__: string;

export function renderSettingsView(): string {
  const hasUpdate = Boolean(state.updateInfo?.available && state.updateInfo.latestVersion);
  const updateStatus = state.updateChecking
    ? "正在检查更新..."
    : state.updateError
      ? `检查失败：${state.updateError}`
      : state.updateInfo
        ? hasUpdate
          ? `发现新版本 ${state.updateInfo.latestVersion}`
          : "当前已是最新版本"
        : "尚未检查";
  const notes = state.updateInfo?.notes ? state.updateInfo.notes.slice(0, 420) : "";
  return `
    <main class="workspace single-column-workspace">
      <section class="client-main-card management-card settings-page-card">
        <div class="settings-page-hero">
          <div class="hero-left"><span class="avatar large settings-avatar">⚙</span><div><h2>设置</h2><p>管理主题、更新和应用基础配置。</p></div></div>
          <button id="refresh-detection" class="secondary-button" type="button">重新检测客户端</button>
        </div>

        <section class="settings-section">
          <div class="settings-section-title"><div><h3>应用更新</h3><p>内置 GitHub Releases 更新检查，优先读取 Release 附带的 latest.json。</p></div><span class="settings-version-pill">当前 v${html(state.updateInfo?.currentVersion ?? __APP_VERSION__)}</span></div>
          <div class="update-panel ${hasUpdate ? "has-update" : ""}">
            <div class="update-panel-main">
              <div class="update-icon">${hasUpdate ? "↑" : "✓"}</div>
              <div>
                <strong>${html(updateStatus)}</strong>
                <p>${state.updateInfo ? `更新源：${html(state.updateInfo.sourceUrl)}` : "默认更新源：GitHub Releases latest.json / releases/latest"}</p>
                <dl>
                  <div><dt>最新版本</dt><dd>${html(state.updateInfo?.latestVersion ?? "—")}</dd></div>
                  <div><dt>发布时间</dt><dd>${html(updateTimestamp(state.updateInfo?.pubDate))}</dd></div>
                  <div><dt>检查时间</dt><dd>${html(updateTimestamp(state.updateInfo?.checkedAt))}</dd></div>
                </dl>
              </div>
            </div>
            <div class="update-panel-actions">
              <button id="check-app-update" class="primary-button" type="button" ${state.updateChecking ? "disabled" : ""}>${state.updateChecking ? "检查中..." : "检查更新"}</button>
              <button id="open-release-page" class="secondary-button" type="button" ${state.updateInfo?.releaseUrl ? "" : "disabled"}>打开发布页</button>
              <button id="dismiss-update-version" class="secondary-button" type="button" ${hasUpdate ? "" : "disabled"}>忽略本版本</button>
            </div>
          </div>
          ${notes ? `<pre class="update-notes">${html(notes)}${state.updateInfo?.notes && state.updateInfo.notes.length > notes.length ? "\n..." : ""}</pre>` : ""}
        </section>

        <section class="settings-section">
          <div class="settings-section-title"><div><h3>界面</h3><p>主题模式会保存到本机；选择“跟随系统”时随系统日夜自动切换。</p></div></div>
          <div class="settings-row theme-settings-row">
            <span>主题模式</span>
            <div class="theme-segmented" role="group" aria-label="主题模式">
              <button class="theme-seg ${state.themeMode === "light" ? "is-active" : ""}" data-theme-mode="light" type="button">日间</button>
              <button class="theme-seg ${state.themeMode === "dark" ? "is-active" : ""}" data-theme-mode="dark" type="button">夜间</button>
              <button class="theme-seg ${state.themeMode === "system" ? "is-active" : ""}" data-theme-mode="system" type="button">跟随系统</button>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <div class="settings-section-title"><div><h3>扩展扫描目录 / WSL</h3><p>把 WSL 或任意自定义 home 目录加入检测，读取其中的 Skills / MCP / Rules（只读，可复制到 Windows 客户端）。</p></div></div>
          <div class="scan-roots-actions">
            <button id="detect-wsl" class="secondary-button" type="button" ${state.wslDetecting ? "disabled" : ""}>${state.wslDetecting ? "检测中..." : "检测 WSL 发行版"}</button>
          </div>
          ${state.wslDetectError ? `<div class="status-banner danger">${html(state.wslDetectError)}</div>` : ""}
          ${
            state.wslDistros.length > 0
              ? `<div class="wsl-distro-list">${state.wslDistros
                  .map((d) => {
                    const added = state.scanRoots.some((r) => r.path.toLowerCase() === d.homeUnc.toLowerCase());
                    return `<div class="wsl-distro-row"><div><strong>${html(d.distro)}</strong><code>${html(d.homeUnc)}</code></div><button class="ghost-mini-button" data-add-wsl="${html(d.distro)}" type="button" ${added ? "disabled" : ""}>${added ? "已添加" : "添加"}</button></div>`;
                  })
                  .join("")}</div>`
              : ""
          }
          <div class="scan-roots-manual">
            <input id="scan-root-label" class="group-name-input" type="text" maxlength="40" placeholder="标签（如 WSL: Ubuntu）" />
            <input id="scan-root-path" class="group-name-input" type="text" placeholder="路径（如 \\\\wsl.localhost\\Ubuntu\\home\\you）" />
            <button id="add-scan-root" class="secondary-button" type="button">添加目录</button>
          </div>
          ${
            state.scanRoots.length > 0
              ? `<div class="scan-roots-list">${state.scanRoots
                  .map(
                    (r) =>
                      `<div class="scan-root-row"><span class="client-source-badge ${r.kind === "wsl" ? "wsl" : "custom"}">${r.kind === "wsl" ? "WSL" : "扩展"}</span><div><strong>${html(r.label)}</strong><code>${html(r.path)}</code></div><button class="ghost-mini-button" data-remove-root="${html(r.tag)}" type="button">移除</button></div>`
                  )
                  .join("")}</div>`
              : `<p class="scan-roots-empty">尚未添加扩展扫描目录。</p>`
          }
        </section>

        <section class="settings-section">
          <div class="settings-section-title"><div><h3>WebDAV 备份</h3><p>把备注与应用配置（分组 / 项目 / 扫描根 / 客户端顺序 / 主题）备份到 WebDAV，可在其它设备恢复。账号密码仅保存在本机。</p></div></div>
          <div class="scan-roots-manual">
            <input id="webdav-url" class="group-name-input" type="text" value="${html(state.webdavConfig.url)}" placeholder="WebDAV 目录地址，如 https://dav.jianguoyun.com/dav/smr/" />
          </div>
          <div class="scan-roots-manual">
            <input id="webdav-user" class="group-name-input" type="text" value="${html(state.webdavConfig.username)}" placeholder="账号" />
            <input id="webdav-pass" class="group-name-input" type="password" value="${html(state.webdavConfig.password)}" placeholder="密码 / 应用密码" />
          </div>
          <div class="scan-roots-actions">
            <button id="webdav-backup" class="primary-button" type="button" ${state.webdavBusy ? "disabled" : ""}>${state.webdavBusy ? "处理中…" : "备份到 WebDAV"}</button>
            <button id="webdav-restore" class="secondary-button" type="button" ${state.webdavBusy ? "disabled" : ""}>从 WebDAV 恢复</button>
          </div>
        </section>
      </section>
    </main>`;
}
