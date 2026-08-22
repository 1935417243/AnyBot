/**
 * 内置 CLI 组件 tarball 的 registry 下载逻辑。
 *
 * 下载源策略：
 * - auto（默认，面向国内用户）：优先淘宝镜像，失败回退官方源；
 * - mirror / official：用户显式选择时严格单源，不兜底（避免"选了官方却走镜像"的困惑）。
 */

import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { fetch } from "undici";
import type { CliTargetSpec } from "./manifest.js";

/** 组件下载源：auto = 镜像优先自动回退；mirror = 仅国内镜像；official = 仅官方源 */
export type CliDownloadSource = "auto" | "mirror" | "official";

export const MIRROR_REGISTRY = "https://registry.npmmirror.com";
export const OFFICIAL_REGISTRY = "https://registry.npmjs.org";

/** 首字节超时：connect + 响应头超过该时间视为当前源不可用 */
const FIRST_BYTE_TIMEOUT_MS = 15_000;
/** body 流空闲超时：大文件下载不用总超时，只在流停滞时判失败 */
const IDLE_TIMEOUT_MS = 30_000;

export class RegistryDownloadError extends Error {
  constructor(
    message: string,
    /** 失败时使用的 registry 基地址，便于上层判断是否继续回退 */
    readonly registry: string,
  ) {
    super(message);
    this.name = "RegistryDownloadError";
  }
}

/** 按下载源配置返回依次尝试的 registry 基地址列表 */
export function resolveRegistryOrder(source: CliDownloadSource): string[] {
  switch (source) {
    case "mirror":
      return [MIRROR_REGISTRY];
    case "official":
      return [OFFICIAL_REGISTRY];
    default:
      return [MIRROR_REGISTRY, OFFICIAL_REGISTRY];
  }
}

/** 拼接 npm tarball 下载地址：<registry>/<包名>/-/<包名去 scope>-<版本>.tgz */
export function buildTarballUrl(registryBase: string, spec: CliTargetSpec): string {
  const basename = spec.registryPackage.split("/").pop() as string;
  return `${registryBase}/${spec.registryPackage}/-/${basename}-${spec.registryVersion}.tgz`;
}

export interface TarballDownloadProgress {
  /** 已下载字节数 */
  loadedBytes: number;
  /** 总字节数（响应无 content-length 时为 null，前端显示不定态） */
  totalBytes: number | null;
}

async function downloadFromRegistry(
  registryBase: string,
  spec: CliTargetSpec,
  destFile: string,
  onProgress: (progress: TarballDownloadProgress) => void,
): Promise<void> {
  const url = buildTarballUrl(registryBase, spec);
  const controller = new AbortController();
  let idleTimer: NodeJS.Timeout | null = null;

  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };

  // 首字节超时（connect + 响应头）
  const firstByteTimer = setTimeout(() => controller.abort(), FIRST_BYTE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal, redirect: "follow" });
  } catch (error) {
    const reason = controller.signal.aborted ? "连接超时" : (error instanceof Error ? error.message : "网络错误");
    throw new RegistryDownloadError(`下载失败（${reason}）`, registryBase);
  } finally {
    clearTimeout(firstByteTimer);
  }

  if (response.status !== 200 || !response.body) {
    throw new RegistryDownloadError(`下载失败（HTTP ${response.status}）`, registryBase);
  }

  const contentLength = Number(response.headers.get("content-length"));
  const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;

  let out: WriteStream | null = null;
  try {
    armIdleTimer();
    out = createWriteStream(destFile);
    let loadedBytes = 0;
    const reader = response.body.getReader();
    while (true) {
      armIdleTimer();
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        loadedBytes += value.byteLength;
        if (!out.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => (out as WriteStream).once("drain", resolve));
        }
        onProgress({ loadedBytes, totalBytes });
      }
    }
    await new Promise<void>((resolve, reject) => {
      (out as WriteStream).end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  } catch (error) {
    out?.destroy();
    if (controller.signal.aborted) {
      throw new RegistryDownloadError("下载超时（网络停滞）", registryBase);
    }
    throw error instanceof RegistryDownloadError
      ? error
      : new RegistryDownloadError(
          `下载失败（${error instanceof Error ? error.message : "写入磁盘失败"}）`,
          registryBase,
        );
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

/**
 * 按源顺序下载 tarball 到 destFile；每个源只尝试一次（重试交给用户触发）。
 * 所有源都失败时抛最后一次的 RegistryDownloadError。
 */
export async function downloadTarball(
  spec: CliTargetSpec,
  source: CliDownloadSource,
  destFile: string,
  onProgress: (progress: TarballDownloadProgress) => void,
  /** 切换下载源时回调（auto 回退场景，供 UI 展示当前使用的源） */
  onSourceChange?: (registryBase: string) => void,
): Promise<void> {
  const registries = resolveRegistryOrder(source);
  let lastError: RegistryDownloadError | null = null;
  for (const registryBase of registries) {
    onSourceChange?.(registryBase);
    try {
      await downloadFromRegistry(registryBase, spec, destFile, onProgress);
      return;
    } catch (error) {
      lastError = error instanceof RegistryDownloadError
        ? error
        : new RegistryDownloadError(error instanceof Error ? error.message : "下载失败", registryBase);
    }
  }
  throw lastError ?? new RegistryDownloadError("下载失败", "");
}
