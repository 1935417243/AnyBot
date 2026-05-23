import type { Response } from "express";
import { fetch as undiciFetch } from "undici";
import { logger } from "../../logger.js";
import { asRecord, getObjectStringValue } from "./object-utils.js";

const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/1935417243/AnyBot/releases/latest";
const GITHUB_LATEST_RELEASE_URL = "https://github.com/1935417243/AnyBot/releases/latest";

let manualDesktopUpdateStatus: Record<string, unknown> | null = null;

function getDesktopUpdateCurrentVersion(): string {
  return process.env.ANYBOT_DESKTOP_APP_VERSION || process.env.npm_package_version || "0.0.0";
}

function normalizeReleaseVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function compareVersionStrings(left: string, right: string): number {
  const leftParts = normalizeReleaseVersion(left).split(/[^\d]+/).filter(Boolean).map((part) => Number.parseInt(part, 10));
  const rightParts = normalizeReleaseVersion(right).split(/[^\d]+/).filter(Boolean).map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const leftPart = Number.isFinite(leftParts[i]) ? leftParts[i] : 0;
    const rightPart = Number.isFinite(rightParts[i]) ? rightParts[i] : 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

function normalizeManualDesktopUpdateStatus(payload: Record<string, unknown>): Record<string, unknown> {
  const state = typeof payload.state === "string" ? payload.state : "idle";
  const isBlockedState = state === "unsupported" || state === "unavailable";
  return {
    ...payload,
    platform: typeof payload.platform === "string" ? payload.platform : process.platform,
    supported: false,
    packaged: Boolean(payload.packaged),
    currentVersion: typeof payload.currentVersion === "string" ? payload.currentVersion : getDesktopUpdateCurrentVersion(),
    state: isBlockedState ? "idle" : state,
    message: isBlockedState ? "准备检查更新。" : (typeof payload.message === "string" ? payload.message : ""),
    latestVersion: typeof payload.latestVersion === "string" ? payload.latestVersion : null,
    updateInfo: payload.updateInfo && typeof payload.updateInfo === "object" ? payload.updateInfo : null,
    progress: null,
    error: typeof payload.error === "string" ? payload.error : null,
    checkedAt: typeof payload.checkedAt === "number" ? payload.checkedAt : null,
    releaseUrl: typeof payload.releaseUrl === "string" ? payload.releaseUrl : GITHUB_LATEST_RELEASE_URL,
    downloadUrl: typeof payload.downloadUrl === "string" ? payload.downloadUrl : GITHUB_LATEST_RELEASE_URL,
    manualDownload: true,
  };
}

function shouldUseManualReleaseCheck(payload: Record<string, unknown>): boolean {
  return payload.supported === false || payload.state === "unsupported" || payload.state === "unavailable";
}

function rememberManualDesktopUpdateStatus(status: Record<string, unknown>): Record<string, unknown> {
  manualDesktopUpdateStatus = normalizeManualDesktopUpdateStatus(status);
  return manualDesktopUpdateStatus;
}

function getManualDesktopUpdateStatus(baseStatus: Record<string, unknown>): Record<string, unknown> {
  const normalizedBase = normalizeManualDesktopUpdateStatus(baseStatus);
  if (!manualDesktopUpdateStatus) return normalizedBase;
  return normalizeManualDesktopUpdateStatus({
    ...normalizedBase,
    ...manualDesktopUpdateStatus,
    platform: normalizedBase.platform,
    packaged: normalizedBase.packaged,
    currentVersion: normalizedBase.currentVersion,
  });
}

async function checkLatestGitHubReleaseStatus(baseStatus: Record<string, unknown>): Promise<Record<string, unknown>> {
  const checkedAt = Date.now();
  const currentVersion = typeof baseStatus.currentVersion === "string"
    ? baseStatus.currentVersion
    : getDesktopUpdateCurrentVersion();
  const lastCheckedAt = typeof manualDesktopUpdateStatus?.checkedAt === "number"
    ? manualDesktopUpdateStatus.checkedAt
    : null;
  rememberManualDesktopUpdateStatus({
    ...baseStatus,
    state: "checking",
    message: "正在检查更新...",
    progress: null,
    error: null,
    checkedAt: lastCheckedAt,
  });

  try {
    const response = await undiciFetch(GITHUB_LATEST_RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `AnyBot/${currentVersion}`,
      },
    });
    const text = await response.text();
    const release = asRecord(text ? JSON.parse(text) : {});
    if (!response.ok) {
      throw new Error(getObjectStringValue(release, "message") || `GitHub Releases 返回 ${response.status}`);
    }

    const latestVersion = normalizeReleaseVersion(
      getObjectStringValue(release, "tag_name") || getObjectStringValue(release, "name") || "",
    );
    if (!latestVersion) {
      throw new Error("GitHub Release 未包含版本号");
    }

    const releaseUrl = getObjectStringValue(release, "html_url") || GITHUB_LATEST_RELEASE_URL;
    const hasNewVersion = compareVersionStrings(latestVersion, currentVersion) > 0;
    return rememberManualDesktopUpdateStatus({
      ...baseStatus,
      state: hasNewVersion ? "available" : "not-available",
      message: hasNewVersion ? `发现新版本 · ${latestVersion}` : "当前已是最新版本。",
      latestVersion,
      updateInfo: {
        version: latestVersion,
        releaseName: getObjectStringValue(release, "name"),
        releaseDate: getObjectStringValue(release, "published_at") || getObjectStringValue(release, "created_at"),
      },
      progress: null,
      error: null,
      checkedAt,
      releaseUrl,
      downloadUrl: releaseUrl,
    });
  } catch (error) {
    return rememberManualDesktopUpdateStatus({
      ...baseStatus,
      state: "error",
      message: "检查更新失败。",
      progress: null,
      error: error instanceof Error ? error.message : String(error),
      checkedAt,
    });
  }
}

function getDesktopUpdateUnavailableStatus(): Record<string, unknown> {
  return normalizeManualDesktopUpdateStatus({
    platform: process.platform,
    supported: false,
    packaged: false,
    currentVersion: getDesktopUpdateCurrentVersion(),
    state: "idle",
    message: "准备检查更新。",
    latestVersion: null,
    updateInfo: null,
    progress: null,
    error: null,
    checkedAt: null,
  });
}

export async function proxyDesktopUpdate(
  endpoint: "/status" | "/check" | "/download" | "/restart",
  method: "GET" | "POST",
  res: Response,
): Promise<void> {
  const baseUrl = process.env.ANYBOT_DESKTOP_UPDATE_URL;
  const token = process.env.ANYBOT_DESKTOP_UPDATE_TOKEN;

  if (!baseUrl || !token) {
    const status = getDesktopUpdateUnavailableStatus();
    res.json(endpoint === "/check" ? await checkLatestGitHubReleaseStatus(status) : getManualDesktopUpdateStatus(status));
    return;
  }

  try {
    const response = await undiciFetch(new URL(endpoint, baseUrl).toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || "桌面更新服务返回了无效响应" };
    }
    const payloadRecord = asRecord(payload);
    if (response.ok && shouldUseManualReleaseCheck(payloadRecord)) {
      const status = normalizeManualDesktopUpdateStatus(payloadRecord);
      res.status(response.status).json(endpoint === "/check" ? await checkLatestGitHubReleaseStatus(status) : getManualDesktopUpdateStatus(status));
      return;
    }
    res.status(response.status).json(payload);
  } catch (error) {
    logger.warn("desktop_update.proxy_failed", {
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({
      ...normalizeManualDesktopUpdateStatus(getDesktopUpdateUnavailableStatus()),
      state: "error",
      message: "连接桌面更新服务失败。",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function checkDesktopUpdateOnStartup(): Promise<void> {
  const baseUrl = process.env.ANYBOT_DESKTOP_UPDATE_URL;
  const token = process.env.ANYBOT_DESKTOP_UPDATE_TOKEN;

  if (!baseUrl || !token) {
    await checkLatestGitHubReleaseStatus(getDesktopUpdateUnavailableStatus());
    logger.info("desktop_update.startup_checked", { mode: "manual" });
    return;
  }

  try {
    const response = await undiciFetch(new URL("/check", baseUrl).toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || "桌面更新服务返回了无效响应" };
    }

    if (!response.ok) {
      logger.warn("desktop_update.startup_check_failed", {
        status: response.status,
        error: getObjectStringValue(payload, "error") || getObjectStringValue(payload, "message"),
      });
      return;
    }

    const payloadRecord = asRecord(payload);
    if (shouldUseManualReleaseCheck(payloadRecord)) {
      await checkLatestGitHubReleaseStatus(normalizeManualDesktopUpdateStatus(payloadRecord));
      logger.info("desktop_update.startup_checked", { mode: "manual" });
      return;
    }

    logger.info("desktop_update.startup_checked", { mode: "desktop" });
  } catch (error) {
    logger.warn("desktop_update.startup_check_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
