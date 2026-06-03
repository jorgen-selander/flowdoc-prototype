// FlowDoc desktop shell.
//
// This is intentionally thin glue: it boots the same HTTP+SSE server that powers
// `flowdoc ui` (from the compiled dist/) and points a BrowserWindow at it. The server
// spawns the compiled CLI as a child process for each command, so the desktop app and
// the CLI share one codebase — see src/ui-server.ts.
//
// Two roots matter (see startServer in src/ui-server.ts):
//   appRoot  — where dist/index.js lives (read-only app bundle when packaged)
//   dataRoot — where flows are written/served (Electron userData; survives app updates)

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

// electron/main.js sits one level under the app root in both dev and a packaged
// (asar: false) build, so this resolves correctly in both.
const appRoot = path.join(__dirname, "..");

let mainWindow = null;
let server = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    title: "FlowDoc",
    webPreferences: { contextIsolation: true },
  });

  // Same-origin (the local UI) navigates in-window; external links such as the
  // captured "start URL ↗" open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (server) mainWindow.loadURL(server.url);
}

async function boot() {
  // Bundled ffmpeg: capture/audio code reads FLOWDOC_FFMPEG (src/audio.ts). Falls back
  // to PATH ffmpeg if ffmpeg-static is unavailable.
  try {
    const ffmpegPath = require("ffmpeg-static");
    if (ffmpegPath) process.env.FLOWDOC_FFMPEG = ffmpegPath;
  } catch {
    // ffmpeg-static not installed — leave FLOWDOC_FFMPEG unset.
  }

  // Bundled Chromium: when packaged, the browser ships under Resources/pw-browsers
  // (electron-builder extraResources). In dev, Playwright resolves its own cache.
  if (app.isPackaged) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, "pw-browsers");
  }

  // Bundled whisper.cpp (compiled during npm install). The binary lives inside
  // node_modules/nodejs-whisper, which ships in the .app via electron-builder's normal
  // node_modules sweep. The model is NOT bundled — downloaded to userData on first
  // transcribe so app updates stay small and the model survives auto-updates.
  process.env.FLOWDOC_WHISPER_BIN = path.join(
    appRoot,
    "node_modules",
    "nodejs-whisper",
    "cpp",
    "whisper.cpp",
    "build",
    "bin",
    "whisper-cli",
  );
  process.env.FLOWDOC_WHISPER_MODEL_DIR = path.join(app.getPath("userData"), "whisper-model");

  const { startServer } = require(path.join(appRoot, "dist", "ui-server"));
  server = await startServer({
    appRoot,
    dataRoot: app.getPath("userData"),
  });

  createWindow();

  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      console.error("auto-update check failed:", err);
    }
  }
}

app.whenReady()
  .then(boot)
  .catch((err) => {
    console.error("Failed to start FlowDoc:", err);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (server) server.close();
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
