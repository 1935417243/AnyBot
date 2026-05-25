const { app, BrowserWindow, Menu, Tray, dialog, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

let mainWindow = null;
let tray = null;
let backendProcess = null;
let logStream = null;
let logFilePath = null;
let desktopUpdateServer = null;
let desktopUpdateUrl = "";
let desktopUpdateToken = "";
let autoUpdaterInstance = undefined;
let autoUpdaterLoadError = null;
let autoUpdaterConfigured = false;
let updateCheckPromise = null;
let updateDownloadPromise = null;
let updateDownloadedDialogOpen = false;
let isQuitting = false;
let backendReady = false;
let pendingShowHomeWindow = false;

const DEFAULT_WEB_PORT = 19981;
const DEFAULT_DESKTOP_SETTINGS = {
  openAtLogin: false,
  openWindowOnStart: true,
};
const DESKTOP_UPDATE_PLATFORM = "win32";
const desktopUpdateState = {
  state: "idle",
  message: "",
  latestVersion: null,
  updateInfo: null,
  progress: null,
  error: null,
  checkedAt: null,
};

function getAppRoot() {
  return path.resolve(__dirname, "..");
}

function getAppUrl() {
  return `http://127.0.0.1:${resolveWebPort()}`;
}

function resolveAppIconPath() {
  const iconName = process.platform === "darwin" ? "icon.icns" : "icon.ico";
  const candidates = [
    path.join(getAppRoot(), "build", "icons", iconName),
    path.join(process.resourcesPath || "", "app", "build", "icons", iconName),
    path.join(process.resourcesPath || "", "build", "icons", iconName),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function initLog() {
  const runDir = path.join(app.getPath("userData"), ".run");
  ensureDir(runDir);

  const logFile = path.join(runDir, "desktop.log");
  logFilePath = logFile;
  logStream = fs.createWriteStream(logFile, { flags: "a" });
  writeLog("main", `AnyBot desktop starting (${process.platform} ${process.arch})`);
}

function writeLog(tag, message) {
  const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
  if (logStream) {
    logStream.write(`${line}\n`);
  }
  console.log(line);
}

function copyIfMissing(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) {
    return;
  }

  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function prepareUserData() {
  const userData = app.getPath("userData");

  ensureDir(userData);
  ensureDir(path.join(userData, ".data"));
  ensureDir(path.join(userData, ".run"));
  ensureDir(path.join(userData, "tmp", "uploads"));

  const appRoot = getAppRoot();
  const mdSource = path.join(appRoot, "dist", "agent", "md_files");
  for (const file of ["AGENTS.md", "MEMORY.md", "PROFILE.md", "BOOTSTRAP.md"]) {
    copyIfMissing(path.join(mdSource, file), path.join(userData, file));
  }
}

function resolveWebPort() {
  const raw = process.env.WEB_PORT || readConfiguredWebPort() || String(DEFAULT_WEB_PORT);
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_WEB_PORT;
}

function readConfiguredWebPort() {
  const settingsPath = path.join(app.getPath("userData"), ".data", "app-settings.json");
  if (!fs.existsSync(settingsPath)) {
    return null;
  }
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return settings?.general?.webPort ? String(settings.general.webPort) : null;
  } catch {
    return null;
  }
}

function readDesktopSettings() {
  const settingsPath = path.join(app.getPath("userData"), ".data", "app-settings.json");
  if (!fs.existsSync(settingsPath)) {
    return DEFAULT_DESKTOP_SETTINGS;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return {
      openAtLogin:
        typeof settings?.general?.openAtLogin === "boolean"
          ? settings.general.openAtLogin
          : DEFAULT_DESKTOP_SETTINGS.openAtLogin,
      openWindowOnStart:
        typeof settings?.general?.openWindowOnStart === "boolean"
          ? settings.general.openWindowOnStart
          : DEFAULT_DESKTOP_SETTINGS.openWindowOnStart,
    };
  } catch {
    return DEFAULT_DESKTOP_SETTINGS;
  }
}

function applyDesktopSettings() {
  const settings = readDesktopSettings();
  const canSetLoginItem = app.isPackaged && (process.platform === "darwin" || process.platform === "win32");

  if (canSetLoginItem) {
    app.setLoginItemSettings({
      openAtLogin: settings.openAtLogin,
      openAsHidden: !settings.openWindowOnStart,
    });
  }

  return settings;
}

function getAutoUpdater() {
  if (autoUpdaterInstance !== undefined) {
    return autoUpdaterInstance;
  }

  try {
    autoUpdaterInstance = require("electron-updater").autoUpdater;
  } catch (error) {
    autoUpdaterLoadError = error;
    autoUpdaterInstance = null;
  }

  return autoUpdaterInstance;
}

function summarizeUpdateInfo(info) {
  if (!info) {
    return null;
  }

  return {
    version: info.version || null,
    releaseName: info.releaseName || null,
    releaseDate: info.releaseDate || null,
  };
}

function serializeUpdateError(error) {
  if (!error) {
    return null;
  }
  return error.stack || error.message || String(error);
}

function getDesktopUpdateAvailability() {
  if (process.platform !== DESKTOP_UPDATE_PLATFORM) {
    const platformName = process.platform === "darwin" ? "macOS" : process.platform;
    return {
      ok: false,
      state: "unsupported",
      message: `${platformName} 暂不支持应用内自动更新，请手动下载安装包覆盖安装。`,
    };
  }

  if (!app.isPackaged) {
    return {
      ok: false,
      state: "unavailable",
      message: "开发模式不能检查更新，请在 Windows 安装版中使用。",
    };
  }

  const updater = getAutoUpdater();
  if (!updater) {
    return {
      ok: false,
      state: "unavailable",
      message: `更新组件不可用：${serializeUpdateError(autoUpdaterLoadError) || "electron-updater 未加载"}`,
    };
  }

  return { ok: true, updater };
}

function getDesktopUpdateStatus() {
  const availability = getDesktopUpdateAvailability();
  const state = availability.ok ? desktopUpdateState.state : availability.state;
  const message = availability.ok ? desktopUpdateState.message : availability.message;

  return {
    platform: process.platform,
    supported: availability.ok,
    packaged: app.isPackaged,
    currentVersion: app.getVersion(),
    state,
    message,
    latestVersion: desktopUpdateState.latestVersion,
    updateInfo: desktopUpdateState.updateInfo,
    progress: desktopUpdateState.progress,
    error: desktopUpdateState.error,
    checkedAt: desktopUpdateState.checkedAt,
  };
}

function setDesktopUpdateState(nextState) {
  Object.assign(desktopUpdateState, nextState);
}

function showUpdateDownloadedDialog() {
  if (updateDownloadedDialogOpen) {
    return;
  }

  updateDownloadedDialogOpen = true;
  const options = {
    type: "info",
    buttons: ["立即重启更新", "稍后"],
    defaultId: 0,
    cancelId: 1,
    message: "AnyBot 新版本已下载完成",
    detail: "重启后会安装更新。",
  };
  const messageBoxPromise = mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);

  messageBoxPromise
    .then(({ response }) => {
      if (response === 0) {
        const updater = getAutoUpdater();
        if (updater) {
          setDesktopUpdateState({ state: "restarting", message: "正在重启并安装更新..." });
          updater.quitAndInstall(false, true);
        }
      }
    })
    .catch((error) => {
      writeLog("update:dialog", serializeUpdateError(error));
    })
    .finally(() => {
      updateDownloadedDialogOpen = false;
    });
}

function ensureAutoUpdaterConfigured(updater) {
  if (autoUpdaterConfigured) {
    return;
  }

  autoUpdaterConfigured = true;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  updater.on("checking-for-update", () => {
    setDesktopUpdateState({
      state: "checking",
      message: "正在检测更新...",
      error: null,
      progress: null,
    });
    writeLog("update", "checking for update");
  });

  updater.on("update-available", (info) => {
    const updateInfo = summarizeUpdateInfo(info);
    setDesktopUpdateState({
      state: "available",
      message: `发现新版本 ${updateInfo?.version || ""}`.trim(),
      latestVersion: updateInfo?.version || null,
      updateInfo,
      progress: null,
      error: null,
      checkedAt: Date.now(),
    });
    writeLog("update", `available ${updateInfo?.version || "unknown"}`);
  });

  updater.on("update-not-available", (info) => {
    const updateInfo = summarizeUpdateInfo(info);
    setDesktopUpdateState({
      state: "not-available",
      message: "当前已是最新版本。",
      latestVersion: updateInfo?.version || null,
      updateInfo,
      progress: null,
      error: null,
      checkedAt: Date.now(),
    });
    writeLog("update", "not available");
  });

  updater.on("download-progress", (progress) => {
    setDesktopUpdateState({
      state: "downloading",
      message: "正在下载更新...",
      progress: {
        percent: Number.isFinite(progress.percent) ? progress.percent : 0,
        transferred: progress.transferred || 0,
        total: progress.total || 0,
        bytesPerSecond: progress.bytesPerSecond || 0,
      },
      error: null,
    });
  });

  updater.on("update-downloaded", (info) => {
    const updateInfo = summarizeUpdateInfo(info);
    setDesktopUpdateState({
      state: "downloaded",
      message: "更新已下载，重启后安装。",
      latestVersion: updateInfo?.version || desktopUpdateState.latestVersion,
      updateInfo: updateInfo || desktopUpdateState.updateInfo,
      progress: null,
      error: null,
    });
    writeLog("update", `downloaded ${updateInfo?.version || "unknown"}`);
    showUpdateDownloadedDialog();
  });

  updater.on("error", (error) => {
    const message = serializeUpdateError(error);
    setDesktopUpdateState({
      state: "error",
      message: "更新失败。",
      error: message,
      progress: null,
      checkedAt: Date.now(),
    });
    writeLog("update:error", message);
  });
}

async function checkDesktopUpdate() {
  const availability = getDesktopUpdateAvailability();
  if (!availability.ok) {
    return getDesktopUpdateStatus();
  }

  const updater = availability.updater;
  ensureAutoUpdaterConfigured(updater);

  if (updateCheckPromise) {
    return updateCheckPromise;
  }

  updateCheckPromise = (async () => {
    setDesktopUpdateState({
      state: "checking",
      message: "正在检测更新...",
      error: null,
      progress: null,
    });

    try {
      const result = await updater.checkForUpdates();
      if (desktopUpdateState.state === "checking") {
        const updateInfo = summarizeUpdateInfo(result?.updateInfo);
        setDesktopUpdateState({
          state: "not-available",
          message: "当前已是最新版本。",
          latestVersion: updateInfo?.version || null,
          updateInfo,
          progress: null,
          error: null,
          checkedAt: Date.now(),
        });
      }
    } catch (error) {
      const message = serializeUpdateError(error);
      setDesktopUpdateState({
        state: "error",
        message: "检测更新失败。",
        error: message,
        progress: null,
        checkedAt: Date.now(),
      });
      writeLog("update:error", message);
    } finally {
      updateCheckPromise = null;
    }

    return getDesktopUpdateStatus();
  })();

  return updateCheckPromise;
}

function downloadDesktopUpdate() {
  const availability = getDesktopUpdateAvailability();
  if (!availability.ok) {
    return getDesktopUpdateStatus();
  }

  const updater = availability.updater;
  ensureAutoUpdaterConfigured(updater);

  if (desktopUpdateState.state === "downloaded" || desktopUpdateState.state === "restarting") {
    return getDesktopUpdateStatus();
  }

  if (desktopUpdateState.state !== "available") {
    setDesktopUpdateState({
      state: "error",
      message: "请先检测到可用的新版本。",
      error: "No available update is ready to download.",
      progress: null,
    });
    return getDesktopUpdateStatus();
  }

  if (!desktopUpdateState.updateInfo) {
    setDesktopUpdateState({
      state: "error",
      message: "请先检测更新。",
      error: "No update info is available. Check for updates before downloading.",
      progress: null,
    });
    return getDesktopUpdateStatus();
  }

  if (updateDownloadPromise) {
    return getDesktopUpdateStatus();
  }

  setDesktopUpdateState({
    state: "downloading",
    message: "正在下载更新...",
    progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
    error: null,
  });

  updateDownloadPromise = updater
    .downloadUpdate()
    .catch((error) => {
      const message = serializeUpdateError(error);
      setDesktopUpdateState({
        state: "error",
        message: "下载更新失败。",
        error: message,
        progress: null,
      });
      writeLog("update:error", message);
    })
    .finally(() => {
      updateDownloadPromise = null;
    });

  return getDesktopUpdateStatus();
}

function restartToInstallDesktopUpdate() {
  const availability = getDesktopUpdateAvailability();
  if (!availability.ok) {
    return getDesktopUpdateStatus();
  }

  if (desktopUpdateState.state !== "downloaded") {
    setDesktopUpdateState({
      state: "error",
      message: "更新还没有下载完成。",
      error: "No downloaded update is ready to install.",
      progress: null,
    });
    return getDesktopUpdateStatus();
  }

  setDesktopUpdateState({
    state: "restarting",
    message: "正在重启并安装更新...",
    error: null,
    progress: null,
  });

  setImmediate(() => {
    availability.updater.quitAndInstall(false, true);
  });

  return getDesktopUpdateStatus();
}

function writeJsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleDesktopUpdateRequest(req, res) {
  req.resume();

  if (req.headers.authorization !== `Bearer ${desktopUpdateToken}`) {
    writeJsonResponse(res, 401, { error: "Unauthorized" });
    return;
  }

  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const route = `${req.method || "GET"} ${requestUrl.pathname}`;

  if (route === "GET /status") {
    writeJsonResponse(res, 200, getDesktopUpdateStatus());
    return;
  }

  if (route === "POST /check") {
    writeJsonResponse(res, 200, await checkDesktopUpdate());
    return;
  }

  if (route === "POST /download") {
    writeJsonResponse(res, 200, downloadDesktopUpdate());
    return;
  }

  if (route === "POST /restart") {
    writeJsonResponse(res, 200, restartToInstallDesktopUpdate());
    return;
  }

  writeJsonResponse(res, 404, { error: "Not found" });
}

function startDesktopUpdateServer() {
  if (desktopUpdateServer) {
    return Promise.resolve();
  }

  desktopUpdateToken = crypto.randomBytes(24).toString("hex");
  desktopUpdateServer = http.createServer((req, res) => {
    handleDesktopUpdateRequest(req, res).catch((error) => {
      writeLog("update:server", serializeUpdateError(error));
      writeJsonResponse(res, 500, { error: "Desktop update request failed" });
    });
  });

  return new Promise((resolve, reject) => {
    desktopUpdateServer.once("error", reject);
    desktopUpdateServer.listen(0, "127.0.0.1", () => {
      const address = desktopUpdateServer.address();
      if (!address || typeof address === "string") {
        reject(new Error("Desktop update server did not expose a TCP port"));
        return;
      }
      desktopUpdateUrl = `http://127.0.0.1:${address.port}`;
      desktopUpdateServer.off("error", reject);
      writeLog("update:server", `listening on ${desktopUpdateUrl}`);
      resolve();
    });
  });
}

function stopDesktopUpdateServer() {
  if (!desktopUpdateServer) {
    return;
  }

  desktopUpdateServer.close();
  desktopUpdateServer = null;
}

function shouldOpenOutsideApp(url, appOrigin) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:" || parsed.protocol === "tel:") {
      return true;
    }
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin !== appOrigin;
  } catch {
    return false;
  }
}

function openOutsideApp(url) {
  shell.openExternal(url).catch((error) => {
    writeLog("main:openExternal", `${url}: ${error.stack || error.message || error}`);
  });
}

function buildPathEnv(existingPath) {
  const entries = [];

  if (process.platform === "darwin") {
    entries.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  } else if (process.platform === "win32") {
    entries.push(
      path.join(os.homedir(), "AppData", "Roaming", "npm"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "nodejs"),
      "C:\\Program Files\\nodejs",
      "C:\\Program Files (x86)\\nodejs",
    );
  }

  if (existingPath) {
    entries.push(...existingPath.split(path.delimiter));
  }

  return [...new Set(entries.filter(Boolean))].join(path.delimiter);
}

function waitForServer(port, timeoutMs = 15000, getAbortMessage = () => null) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const check = () => {
      const abortMessage = getAbortMessage();
      if (abortMessage) {
        reject(new Error(abortMessage));
        return;
      }

      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", (error) => {
        if (Date.now() >= deadline) {
          reject(error);
          return;
        }
        setTimeout(check, 300);
      });

      req.setTimeout(1000, () => {
        req.destroy(new Error("Timed out waiting for AnyBot server"));
      });
    };

    check();
  });
}

function resolveNodeRuntime() {
  const bundledName = process.platform === "win32" ? "node.exe" : "node";
  const bundledNode = path.join(process.resourcesPath, "node", bundledName);

  if (app.isPackaged && fs.existsSync(bundledNode)) {
    return {
      execPath: bundledNode,
      runAsElectronNode: false,
    };
  }

  const devNode = process.env.ANYBOT_NODE_BIN || process.env.npm_node_execpath;
  if (devNode) {
    return {
      execPath: devNode,
      runAsElectronNode: false,
    };
  }

  return {
    execPath: process.execPath,
    runAsElectronNode: true,
  };
}

async function startBackend() {
  const appRoot = getAppRoot();
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, ".data");
  const runDir = path.join(userData, ".run");
  const tmpDir = path.join(userData, "tmp");
  const entry = path.join(appRoot, "dist", "index.js");

  if (!fs.existsSync(entry)) {
    throw new Error(`Missing backend entry: ${entry}`);
  }

  const nodeRuntime = resolveNodeRuntime();
  let backendExitMessage = null;
  const backendEnv = {
    ...process.env,
    ANYBOT_DESKTOP: "1",
    ANYBOT_DESKTOP_PARENT_PID: String(process.pid),
    ANYBOT_DESKTOP_APP_VERSION: app.getVersion(),
    ANYBOT_DESKTOP_UPDATE_URL: desktopUpdateUrl,
    ANYBOT_DESKTOP_UPDATE_TOKEN: desktopUpdateToken,
    DATA_DIR: dataDir,
    CODEX_DATA_DIR: dataDir,
    LOG_DIR: runDir,
    TMPDIR: tmpDir,
    TMP: tmpDir,
    TEMP: tmpDir,
    PATH: buildPathEnv(process.env.PATH),
  };

  if (nodeRuntime.runAsElectronNode) {
    backendEnv.ELECTRON_RUN_AS_NODE = "1";
  }

  backendProcess = spawn(nodeRuntime.execPath, [entry], {
    cwd: userData,
    env: backendEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendProcess.on("error", (error) => {
    backendExitMessage = `Backend failed to launch: ${error.message}`;
    writeLog("backend:error", error.stack || error.message);
  });
  backendProcess.stdout.on("data", (data) => writeLog("backend", data.toString().trim()));
  backendProcess.stderr.on("data", (data) => writeLog("backend:error", data.toString().trim()));
  backendProcess.on("exit", (code, signal) => {
    backendExitMessage = `Backend exited before the web server started (code=${code}, signal=${signal}).`;
    writeLog("backend", `exited code=${code} signal=${signal}`);
    backendProcess = null;
    backendReady = false;
  });

  await waitForServer(resolveWebPort(), 15000, () => {
    if (!backendExitMessage) {
      return null;
    }

    return logFilePath
      ? `${backendExitMessage}\n\nLog file: ${logFilePath}`
      : backendExitMessage;
  });
}

function createMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  if (process.platform !== "win32" || tray) {
    return;
  }

  const iconPath = resolveAppIconPath();
  if (!iconPath) {
    writeLog("tray", "skipped: missing app icon");
    return;
  }

  tray = new Tray(iconPath);
  tray.setToolTip("AnyBot");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "首页",
        click: () => showMainWindow({ home: true }),
      },
      { type: "separator" },
      {
        label: "退出",
        click: quitApp,
      },
    ]),
  );
  tray.on("click", () => showMainWindow({ home: true }));
  tray.on("double-click", () => showMainWindow({ home: true }));
}

function destroyTray() {
  if (!tray) {
    return;
  }

  tray.destroy();
  tray = null;
}

function showMainWindow(options = {}) {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (options.home) {
    mainWindow.loadURL(getAppUrl());
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindowToTray(event) {
  if (!mainWindow || !tray || process.platform !== "win32" || isQuitting) {
    return;
  }

  event.preventDefault();
  mainWindow.hide();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function createWindow() {
  if (mainWindow) {
    return mainWindow;
  }

  const appUrl = getAppUrl();
  const appOrigin = new URL(appUrl).origin;
  const browserWindowOptions = {
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "AnyBot",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  const iconPath = resolveAppIconPath();
  if (iconPath) {
    browserWindowOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(browserWindowOptions);

  mainWindow.loadURL(appUrl);
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenOutsideApp(url, appOrigin)) {
      openOutsideApp(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!shouldOpenOutsideApp(url, appOrigin)) {
      return;
    }
    event.preventDefault();
    openOutsideApp(url);
  });

  mainWindow.on("close", hideMainWindowToTray);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }

  backendProcess.kill("SIGTERM");
  backendProcess = null;
  backendReady = false;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!backendReady) {
      pendingShowHomeWindow = true;
      return;
    }

    showMainWindow({ home: true });
  });

  app.whenReady().then(async () => {
    try {
      initLog();
      prepareUserData();
      createMenu();
      const desktopSettings = applyDesktopSettings();
      await startDesktopUpdateServer().catch((error) => {
        writeLog("update:server", serializeUpdateError(error));
      });
      await startBackend();
      backendReady = true;
      createTray();
      if (desktopSettings.openWindowOnStart || pendingShowHomeWindow) {
        pendingShowHomeWindow = false;
        createWindow();
      }
    } catch (error) {
      writeLog("main:error", error.stack || error.message);
      dialog.showErrorBox("AnyBot failed to start", error.message || String(error));
      quitApp();
    }
  });

  app.on("window-all-closed", () => {
    if (!isQuitting && (process.platform === "darwin" || (process.platform === "win32" && tray))) {
      return;
    }

    stopBackend();
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && backendProcess) {
      createWindow();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    stopBackend();
    stopDesktopUpdateServer();
    destroyTray();
  });
}
