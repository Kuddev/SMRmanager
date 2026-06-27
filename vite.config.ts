import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const appVersion = JSON.parse(readFileSync(path.resolve(projectRoot, "package.json"), "utf-8")).version as string;

function reloadPublicAssets(): Plugin {
  return {
    name: "smrmanager-reload-public-assets",
    configureServer(server) {
      const publicDir = path.resolve(projectRoot, "public");

      // Vite 默认会处理 src 内模块的 HMR；这里额外监听 public 静态资源，
      // 避免替换图标/注册表 JSON 后 WebView 仍然显示旧资源。
      server.watcher.add(publicDir);
      server.watcher.on("change", (changedPath) => {
        const normalizedPath = changedPath.replaceAll("\\", "/");
        if (normalizedPath.includes("/public/")) {
          server.ws.send({ type: "full-reload", path: "*" });
        }
      });
    }
  };
}

export default defineConfig({
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [tailwindcss(), reloadPublicAssets()],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
      port: 1420,
      clientPort: 1420
    },
    watch: {
      ignored: ["**/src-tauri/target/**"],
      usePolling: process.env.VITE_USE_POLLING === "1",
      interval: 100
    }
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false
  }
});
