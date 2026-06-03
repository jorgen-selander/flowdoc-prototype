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

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const fs = require("fs");
const https = require("https");
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
  setupMenu();

  if (app.isPackaged) {
    setupAutoUpdate();
  }
}

// ---------------------------------------------------------------------------
// Auto-update UX
//
// Replaces the previous silent checkForUpdatesAndNotify(). When a new release
// is detected, show a native macOS dialog with release notes (fetched from the
// GitHub release body) and explicit Install / Later / Skip buttons. Also adds
// a "Check for Updates…" menu item under the FlowDoc app menu for manual checks.
// ---------------------------------------------------------------------------

let manualCheck = false;
const skipPath = () => path.join(app.getPath("userData"), "skipped-update.json");

function getSkippedVersion() {
  try {
    return JSON.parse(fs.readFileSync(skipPath(), "utf-8")).version;
  } catch {
    return null;
  }
}

function setSkippedVersion(version) {
  try {
    fs.writeFileSync(skipPath(), JSON.stringify({ version }));
  } catch (err) {
    console.error("could not persist skipped version:", err.message);
  }
}

function fetchReleaseNotes(tag) {
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.github.com/repos/jorgen-selander/flowdoc-prototype/releases/tags/${tag}`,
      { headers: { "User-Agent": "FlowDoc", Accept: "application/vnd.github+json" } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve((data.body || "").trim());
          } catch {
            resolve("");
          }
        });
      },
    );
    req.on("error", () => resolve(""));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve("");
    });
  });
}

async function showUpdateDialog(info) {
  // Honor a previous "Skip This Version" choice — unless this was a manual check.
  const wasManual = manualCheck;
  manualCheck = false;
  if (!wasManual && info.version === getSkippedVersion()) return;

  const notes = (await fetchReleaseNotes(`v${info.version}`)).slice(0, 800);
  const detail = notes
    ? `Release notes:\n\n${notes}`
    : `Version ${info.version} is available.`;
  const result = await dialog.showMessageBox({
    type: "info",
    title: "Update Available",
    message: `FlowDoc ${info.version} is available — you have ${app.getVersion()}.`,
    detail,
    buttons: ["Install and Restart", "Later", "Skip This Version"],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response === 0) {
    // Restart immediately — but only after the download finishes.
    // electron-updater downloads automatically; quitAndInstall blocks until ready.
    const { autoUpdater } = require("electron-updater");
    autoUpdater.once("update-downloaded", () => autoUpdater.quitAndInstall());
    // If the update was already downloaded when the dialog showed, this fires now;
    // otherwise it'll trigger when download finishes.
  } else if (result.response === 2) {
    setSkippedVersion(info.version);
  }
  // response === 1 (Later) → next launch will see it again.
}

function setupAutoUpdate() {
  let autoUpdater;
  try {
    autoUpdater = require("electron-updater").autoUpdater;
  } catch (err) {
    console.error("electron-updater not available:", err.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.on("update-available", (info) => {
    showUpdateDialog(info).catch((err) => console.error("update dialog failed:", err));
  });
  autoUpdater.on("update-not-available", () => {
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox({
        type: "info",
        title: "FlowDoc",
        message: "FlowDoc is up to date.",
        detail: `You're on version ${app.getVersion()}.`,
        buttons: ["OK"],
      });
    }
  });
  autoUpdater.on("error", (err) => {
    console.error("[auto-updater]", err.message);
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox({
        type: "warning",
        title: "Update Check Failed",
        message: "Could not check for updates.",
        detail: err.message,
        buttons: ["OK"],
      });
    }
  });

  // Background check on launch.
  autoUpdater.checkForUpdates().catch((err) => console.error("update check failed:", err.message));
}

function setupMenu() {
  // macOS replaces the first menu's label with the app name, so this becomes "FlowDoc".
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates…",
          enabled: app.isPackaged,
          click: () => {
            try {
              const { autoUpdater } = require("electron-updater");
              manualCheck = true;
              autoUpdater.checkForUpdates().catch(() => {});
            } catch {
              // electron-updater missing — nothing to do.
            }
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
