/**
 * 内置 CLI 组件的安装器：下载 → 校验 → 解压 → 原子安装到 userData/cli-runtime。
 *
 * 复用语义：install.json 里记录的版本与代码锁定的版本（CLI_RUNTIME_VERSIONS）不一致
 * 即视为未安装——App 更新但 CLI 版本没变时不会重复下载，版本变了自动要求重下。
 *
 * 失败恢复：不做断点续传。单 tarball + integrity 校验 + 原子 rename 的前提下，
 * 中断直接重下即可，staging 残留由下次启动或下次下载前清理。
 */

import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { accessSync, constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { x as extractTar } from "tar";
import { getDataDir } from "../app-settings.js";
import { emitCliRuntimeChanged } from "../web/events.js";
import { CLI_RUNTIME_VERSIONS, getCliTarget, type CliRuntimeProvider, type CliTargetSpec } from "./manifest.js";
import { downloadTarball, MIRROR_REGISTRY, OFFICIAL_REGISTRY, type CliDownloadSource } from "./registry.js";

/** 安装状态机 */
export type CliRuntimePhase = "not-installed" | "downloading" | "verifying" | "ready" | "error";

/** 对前端暴露的组件状态 */
export interface CliRuntimeStatus {
  provider: CliRuntimeProvider;
  phase: CliRuntimePhase;
  /** 下载进度 0-100；非下载阶段或无 content-length 时为 null */
  percent: number | null;
  /** 锁定的组件版本 */
  version: string;
  /** tarball 字节数（用于"约 xx MB"展示）；平台不支持时为 0 */
  sizeBytes: number;
  /** 当前/最近使用的下载源名称（"国内镜像" / "官方源"） */
  source: string | null;
  /** 阶段说明或错误文案（中文，直接展示） */
  message: string | null;
  /** 当前平台是否支持自动下载 */
  supported: boolean;
}

/** 进度事件（NDJSON 下载流与 SSE 共用形状） */
export interface CliRuntimeEvent extends CliRuntimeStatus {}

interface InstallManifest {
  version: string;
  integrity: string;
  installedAt: string;
}

interface InflightInstall {
  promise: Promise<string>;
  listeners: Set<(event: CliRuntimeEvent) => void>;
}

const PROVIDERS: CliRuntimeProvider[] = ["codex", "claude-code"];
const runtimeStates = new Map<CliRuntimeProvider, CliRuntimeStatus>();
const inflightInstalls = new Map<CliRuntimeProvider, InflightInstall>();

/** cli-runtime 根目录：<userData>/cli-runtime（DATA_DIR 的上一级，随 App 更新保留） */
export function getCliRuntimeRootDir(): string {
  return path.join(path.dirname(path.resolve(getDataDir())), "cli-runtime");
}

function getProviderDir(provider: CliRuntimeProvider): string {
  return path.join(getCliRuntimeRootDir(), provider);
}

/** 当前锁定版本的安装目录（按版本分目录，旧版本在升级后清理） */
function getVersionDir(provider: CliRuntimeProvider): string {
  return path.join(getProviderDir(provider), CLI_RUNTIME_VERSIONS[provider]);
}

function getStagingRootDir(): string {
  return path.join(getCliRuntimeRootDir(), ".staging");
}

function getInstallManifestPath(provider: CliRuntimeProvider): string {
  return path.join(getVersionDir(provider), "install.json");
}

function canRun(filePath: string): boolean {
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readInstallManifest(provider: CliRuntimeProvider): InstallManifest | null {
  try {
    const raw = JSON.parse(readFileSync(getInstallManifestPath(provider), "utf-8")) as InstallManifest;
    if (typeof raw.version !== "string" || typeof raw.integrity !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

/** 已安装且版本匹配时返回二进制绝对路径，否则返回 null */
export function getCliExecutablePath(provider: CliRuntimeProvider): string | null {
  const spec = getCliTarget(provider);
  if (!spec) return null;
  const manifest = readInstallManifest(provider);
  if (!manifest || manifest.version !== CLI_RUNTIME_VERSIONS[provider]) return null;
  const binaryPath = path.join(getVersionDir(provider), spec.binRelPath);
  return canRun(binaryPath) ? binaryPath : null;
}

export function isCliRuntimeReady(provider: CliRuntimeProvider): boolean {
  return getCliExecutablePath(provider) !== null;
}

function registryDisplayName(registryBase: string): string {
  if (registryBase === MIRROR_REGISTRY) return "国内镜像";
  if (registryBase === OFFICIAL_REGISTRY) return "官方源";
  return registryBase;
}

function buildStatus(provider: CliRuntimeProvider): CliRuntimeStatus {
  const spec = getCliTarget(provider);
  const base: CliRuntimeStatus = {
    provider,
    phase: "not-installed",
    percent: null,
    version: CLI_RUNTIME_VERSIONS[provider],
    sizeBytes: spec?.sizeBytes ?? 0,
    source: null,
    message: null,
    supported: spec !== null,
  };
  const runtime = runtimeStates.get(provider);
  if (runtime && (runtime.phase === "downloading" || runtime.phase === "verifying" || runtime.phase === "error")) {
    return { ...base, ...runtime, version: base.version, sizeBytes: base.sizeBytes, supported: base.supported };
  }
  if (isCliRuntimeReady(provider)) {
    return { ...base, phase: "ready", percent: 100 };
  }
  return base;
}

/** 取组件当前状态（前端初始化与轮询用） */
export function getCliRuntimeStatus(provider: CliRuntimeProvider): CliRuntimeStatus {
  return buildStatus(provider);
}

/** 全部组件状态 */
export function listCliRuntimeStatus(): CliRuntimeStatus[] {
  return PROVIDERS.map((provider) => buildStatus(provider));
}

function updateState(provider: CliRuntimeProvider, patch: Partial<CliRuntimeStatus>): CliRuntimeStatus {
  const next = { ...buildStatus(provider), ...patch, provider };
  runtimeStates.set(provider, next);
  return next;
}

async function verifyIntegrity(filePath: string, integrity: string): Promise<boolean> {
  const expected = integrity.startsWith("sha512-") ? integrity.slice("sha512-".length) : integrity;
  const hash = createHash("sha512");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return hash.digest("base64") === expected;
}

/** 磁盘预检：剩余空间不足 tarball 两倍（压缩包 + 解压产物）时抛错 */
function ensureDiskSpace(spec: CliTargetSpec): void {
  try {
    // cli-runtime 根目录可能尚未创建，检查其父目录（userData/项目根，始终存在）
    const stats = statfsSync(path.dirname(getCliRuntimeRootDir()));
    const available = stats.bavail * stats.bsize;
    if (available < spec.sizeBytes * 2) {
      throw new Error(`磁盘空间不足（约需 ${Math.ceil((spec.sizeBytes * 2) / 1024 / 1024)} MB）`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("磁盘空间不足")) throw error;
    // statfsSync 不可用时跳过预检，不阻塞下载
  }
}

/** 安装成功后清理同组件的旧版本目录，避免多次升级后堆积 */
function cleanupOldVersions(provider: CliRuntimeProvider): void {
  const currentVersion = CLI_RUNTIME_VERSIONS[provider];
  try {
    for (const entry of readdirSync(getProviderDir(provider), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === currentVersion) continue;
      rmSync(path.join(getProviderDir(provider), entry.name), { recursive: true, force: true });
    }
  } catch {
    // 清理失败不影响安装结果
  }
}

/** 清理中断残留的 staging 目录（启动时与每次下载前调用） */
export function cleanupStaleStaging(): void {
  try {
    rmSync(getStagingRootDir(), { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

async function runInstall(
  provider: CliRuntimeProvider,
  spec: CliTargetSpec,
  source: CliDownloadSource,
  report: (event: CliRuntimeEvent) => void,
): Promise<string> {
  const emit = (patch: Partial<CliRuntimeStatus>) => {
    const status = updateState(provider, patch);
    report(status);
  };

  cleanupStaleStaging();
  ensureDiskSpace(spec);

  // mkdtempSync 不会创建父目录，需先确保 staging 根目录存在
  mkdirSync(getStagingRootDir(), { recursive: true });
  const stagingDir = mkdtempSync(path.join(getStagingRootDir(), `${provider}-`));
  try {
    const tarballPath = path.join(stagingDir, "pkg.tgz");
    let lastLoaded = 0;
    emit({ phase: "downloading", percent: 0, message: "开始下载", source: null });
    await downloadTarball(
      spec,
      source,
      tarballPath,
      ({ loadedBytes, totalBytes }) => {
        // 进度事件节流：每 512KB 或完成时上报一次
        if (loadedBytes - lastLoaded < 512 * 1024 && loadedBytes !== totalBytes) return;
        lastLoaded = loadedBytes;
        const total = totalBytes ?? spec.sizeBytes;
        emit({
          phase: "downloading",
          percent: total > 0 ? Math.min(99, Math.floor((loadedBytes / total) * 100)) : null,
          message: null,
        });
      },
      (registryBase) => emit({ source: registryDisplayName(registryBase) }),
    );

    emit({ phase: "verifying", percent: null, message: "校验安装包" });
    if (!(await verifyIntegrity(tarballPath, spec.integrity))) {
      throw new Error("安装包校验失败，请重试");
    }

    const extractDir = path.join(stagingDir, "extract");
    mkdirSync(extractDir, { recursive: true });
    await extractTar({ file: tarballPath, cwd: extractDir });

    // npm tarball 统一带 package/ 前缀
    const packageDir = path.join(extractDir, "package");
    const binaryPath = path.join(packageDir, spec.binRelPath);
    if (!existsSync(binaryPath)) {
      throw new Error("安装包内容异常，请重试");
    }
    if (process.platform !== "win32") {
      chmodSync(binaryPath, 0o755);
    }

    // 原子安装：staging 与目标目录同卷，rename 是原子操作
    const versionDir = getVersionDir(provider);
    mkdirSync(getProviderDir(provider), { recursive: true });
    rmSync(versionDir, { recursive: true, force: true });
    renameSync(packageDir, versionDir);

    const installManifest: InstallManifest = {
      version: CLI_RUNTIME_VERSIONS[provider],
      integrity: spec.integrity,
      installedAt: new Date().toISOString(),
    };
    writeFileSync(getInstallManifestPath(provider), JSON.stringify(installManifest, null, 2), "utf-8");

    cleanupOldVersions(provider);

    const executablePath = path.join(versionDir, spec.binRelPath);
    emit({ phase: "ready", percent: 100, message: null });
    return executablePath;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

/**
 * 确保组件可用：已安装直接返回路径；否则触发下载安装。
 * 并发调用共享同一次安装（后到调用者的 report 挂入同一事件流）。
 */
export function ensureCliRuntime(
  provider: CliRuntimeProvider,
  source: CliDownloadSource,
  report: (event: CliRuntimeEvent) => void,
): Promise<string> {
  const spec = getCliTarget(provider);
  if (!spec) {
    const status = updateState(provider, { phase: "error", message: "当前平台暂不支持自动下载" });
    report(status);
    return Promise.reject(new Error("当前平台暂不支持自动下载"));
  }

  const existing = getCliExecutablePath(provider);
  if (existing) {
    report(buildStatus(provider));
    return Promise.resolve(existing);
  }

  const inflight = inflightInstalls.get(provider);
  if (inflight) {
    inflight.listeners.add(report);
    report(buildStatus(provider));
    return inflight.promise;
  }

  const listeners = new Set<(event: CliRuntimeEvent) => void>([report]);
  const broadcastEvent = (event: CliRuntimeEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // 某个订阅者（如下载中途关闭的 HTTP 连接）写失败不影响其他订阅者
      }
    }
  };

  const promise = runInstall(provider, spec, source, broadcastEvent)
    .then((executablePath) => {
      emitCliRuntimeChanged(provider);
      return executablePath;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "下载失败，请重试";
      const status = updateState(provider, { phase: "error", percent: null, message });
      broadcastEvent(status);
      emitCliRuntimeChanged(provider);
      throw error;
    })
    .finally(() => {
      inflightInstalls.delete(provider);
    });

  inflightInstalls.set(provider, { promise, listeners });
  return promise;
}
