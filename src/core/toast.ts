// 浮层 toast：独立于 renderApp 的操作反馈（不触发整页重建/列表抖动）。
import { state } from "../state";

type ToastType = "info" | "success" | "error";

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

// 始终只保留一个 toast，新消息替换旧的，避免连续操作时多个 toast 叠加。
export function setSkillActionMessage(message: string | null, timeoutMs = 2600): void {
  if (state.skillActionMessageTimer !== null) {
    window.clearTimeout(state.skillActionMessageTimer);
    state.skillActionMessageTimer = null;
  }
  if (state.activeToast) {
    dismissToast(state.activeToast);
    state.activeToast = null;
  }
  if (!message) return;
  const toast = createToast(message, toastTypeForMessage(message));
  state.activeToast = toast;
  if (timeoutMs > 0) {
    state.skillActionMessageTimer = window.setTimeout(() => {
      dismissToast(toast);
      if (state.activeToast === toast) state.activeToast = null;
      state.skillActionMessageTimer = null;
    }, timeoutMs);
  }
}
