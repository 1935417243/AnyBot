/**
 * 内置 CLI 组件（Claude Code / Codex）的按需下载清单。
 *
 * 版本与哈希完全锁死：只下载本表写死的版本，下载后用 integrity（sha512）校验。
 * 表中的 integrity 来自 registry 的 dist.integrity（官方源与 npmmirror 一致，已实测）。
 *
 * 升级 @anthropic-ai/claude-agent-sdk 或 @openai/codex-sdk 依赖时，必须同步更新本表：
 *   npm view <包名>@<版本> dist.integrity        # 取 sha512
 *   curl -sIL <registry>/<包名>/-/<tarball 名>.tgz # 跟随重定向取 content-length 作 sizeBytes
 * 注意 Codex 的平台包是 npm alias，真实包名固定为 @openai/codex，版本号带平台后缀
 * （如 0.148.0-darwin-arm64），tarball URL 形如 <registry>/@openai/codex/-/codex-<版本>.tgz。
 */

/** 支持按需下载的内置 CLI 组件标识 */
export type CliRuntimeProvider = "codex" | "claude-code";

/** 单个平台目标的下载描述 */
export interface CliTargetSpec {
  /** npm registry 上的真实包名 */
  registryPackage: string;
  /** npm registry 上的包版本（Codex 带平台后缀） */
  registryVersion: string;
  /**  tarball 的 sha512 integrity（sha512-<base64>），两个下载源一致 */
  integrity: string;
  /** tarball 字节数，用于进度展示与磁盘预检 */
  sizeBytes: number;
  /** 解压后（去掉 npm tarball 的 package/ 前缀）二进制的相对路径 */
  binRelPath: string;
}

const CODEX_CLI_VERSION = "0.148.0";
const CLAUDE_CODE_PACKAGE_VERSION = "0.3.237";

/** Codex 各 target triple 对应的平台版本后缀（与 @openai/codex 主包 optionalDependencies 的 alias 对齐） */
const CODEX_PLATFORM_SUFFIX_BY_TRIPLE: Record<string, string> = {
  "x86_64-unknown-linux-musl": "linux-x64",
  "aarch64-unknown-linux-musl": "linux-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-pc-windows-msvc": "win32-x64",
  "aarch64-pc-windows-msvc": "win32-arm64",
};

const CODEX_INTEGRITY_BY_SUFFIX: Record<string, string> = {
  "darwin-arm64": "sha512-xgBPFiF1fHUlRS7HE6wGB56LjBJh16kGD7b4TTbwdVBZNB4QDkTok+vdkAGrfpVkfKcwGNhPSKDgCw+KMZOVug==",
  "darwin-x64": "sha512-qepQolhJutfOp+e9i7L3xsi8aoWeCUiiRq274WMWqRj50rKTrXxsuAgkAwDbqEfT3G5VynhYZuQvDsW37JgdNQ==",
  "linux-x64": "sha512-uDT9s7AfMr9xLuJX3ZLVWHgHkUpCnZ33CZjZEdVQhrYCIErkDHsCW5TG290nNjaKngK0WxGt5uCcxeUHv9MWWA==",
  "linux-arm64": "sha512-51DCd+izzk6n4mMh4w2utWj3lTLhSTnCOEJQfRh0LS9nBDkcYZcK3iSKOST6fByRIlLSXuLO33LlYYA1VPot6A==",
  "win32-x64": "sha512-/Jg8eYw0BqTGNUpnrzzWlK2kbu29NWg7t6pnUDEfxqpTUf+mK8r3okXQn60Zjbk9InYZ4d8SwSjrtOa+i5hSPw==",
  "win32-arm64": "sha512-a8iOwLzs8UdnlWDHjgK3W/YSBBsUImG8X5XLBjengp3XGJRruhiIsQtUDUOYimCmotKPM4aX7Ub6zjl/KPxMQQ==",
};

const CODEX_SIZE_BY_SUFFIX: Record<string, number> = {
  "darwin-arm64": 109_621_985,
  "darwin-x64": 117_035_333,
  "linux-x64": 120_485_045,
  "linux-arm64": 113_658_035,
  "win32-x64": 130_052_468,
  "win32-arm64": 121_817_787,
};

const CLAUDE_INTEGRITY_BY_TARGET: Record<string, string> = {
  "darwin-arm64": "sha512-u9r73eYFatAT5h9ntX2Mx6v+4pe3+7mIQYnljf7MyJnitgnWBrexiNMyc2WxKQpkBNyen8m0dgnO0zCjGnfG1g==",
  "darwin-x64": "sha512-M7gmrWLhTLS4p9jRTXktPwMendILa0zD3CeFa22dpYP35tHZJkwPbB2UbZrnYWHV2ws5pZi5lB1rLOsTInvC+Q==",
  "linux-x64": "sha512-CnJokzNI0TTLX75PjsrJM8vtfp5x1lReB0QLMZbSAjPRbPudeeZr5Gs2rwB9X63CXvHaTKOrt74TUPgMA3na0A==",
  "linux-arm64": "sha512-LTZ1cd1AKDJtNU6tdzYi2UUu8sC9rBfcuL1to1ET92rx8aVzHfF1/f36tkBPqc9PVPVpUhF8nr4Y7F4eild5HQ==",
  "linux-x64-musl": "sha512-EfI/AMf75UEDjIsYAYZj1RHXrFLvJXlCyx8gC4M1u1BG1+Qwdc/r3wz7cGYVknWE+8nu9Q+Ik9RMwPnXBPbqLA==",
  "linux-arm64-musl": "sha512-gOe5H4SsL9KWPRn8YoJ0TcekLHU6XvGxPQ692lPq1ZGueYDsSE6LUeojYy1wQc3R0pwwmz2cJU5DtaM4qPa50A==",
  "win32-x64": "sha512-DvHNDIFgx/jpRuGqKDedeK3zmaBzjmDz7dM1Vh/nzaJYuyLwK7uzh+Lc88o6wfRlRzvH1jOstetqKqol+BxuRw==",
  "win32-arm64": "sha512-5cKVKcjWSJ9iFDDj7UaiJ+N0GC1NGZC0Z3Z1K+wXW8uy4nWSe0bHpo5S95HypOwuHUENSjlmvv++xv9l6nPj3Q==",
};

const CLAUDE_SIZE_BY_TARGET: Record<string, number> = {
  "darwin-arm64": 90_210_796,
  "darwin-x64": 94_584_191,
  "linux-x64": 100_055_196,
  "linux-arm64": 99_664_161,
  "linux-x64-musl": 98_084_827,
  "linux-arm64-musl": 97_364_047,
  "win32-x64": 102_637_313,
  "win32-arm64": 99_047_575,
};

/** 各组件当前锁定的版本号（Codex 为 CLI 主版本，Claude Code 为 npm 平台包版本） */
export const CLI_RUNTIME_VERSIONS: Record<CliRuntimeProvider, string> = {
  codex: CODEX_CLI_VERSION,
  "claude-code": CLAUDE_CODE_PACKAGE_VERSION,
};

/** 当前进程平台对应的 Codex target triple（与 codex.ts 的映射保持一致） */
function getCodexTriple(): string | null {
  switch (process.platform) {
    case "linux":
    case "android":
      if (process.arch === "x64") return "x86_64-unknown-linux-musl";
      if (process.arch === "arm64") return "aarch64-unknown-linux-musl";
      return null;
    case "darwin":
      if (process.arch === "x64") return "x86_64-apple-darwin";
      if (process.arch === "arm64") return "aarch64-apple-darwin";
      return null;
    case "win32":
      if (process.arch === "x64") return "x86_64-pc-windows-msvc";
      if (process.arch === "arm64") return "aarch64-pc-windows-msvc";
      return null;
    default:
      return null;
  }
}

/** 判断当前 Linux 是否为 musl libc（无 glibc 版本信息即为 musl） */
function isMuslLibc(): boolean {
  if (process.platform !== "linux" && process.platform !== "android") return false;
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

/** 当前进程平台对应的 Claude Code 平台目标名（与 npm 平台包包名后缀一致） */
function getClaudeCodeTarget(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  if (arch !== "x64" && arch !== "arm64") return null;
  if (platform === "darwin" || platform === "win32") return `${platform}-${arch}`;
  if (platform === "linux" || platform === "android") {
    return isMuslLibc() ? `linux-${arch}-musl` : `linux-${arch}`;
  }
  return null;
}

/** 取指定组件在当前平台的下载描述；平台未覆盖时返回 null（UI 提示不支持自动下载） */
export function getCliTarget(provider: CliRuntimeProvider): CliTargetSpec | null {
  if (provider === "codex") {
    const triple = getCodexTriple();
    if (!triple) return null;
    const suffix = CODEX_PLATFORM_SUFFIX_BY_TRIPLE[triple];
    const integrity = CODEX_INTEGRITY_BY_SUFFIX[suffix];
    const sizeBytes = CODEX_SIZE_BY_SUFFIX[suffix];
    if (!suffix || !integrity || !sizeBytes) return null;
    const binName = process.platform === "win32" ? "codex.exe" : "codex";
    return {
      registryPackage: "@openai/codex",
      registryVersion: `${CODEX_CLI_VERSION}-${suffix}`,
      integrity,
      sizeBytes,
      binRelPath: `vendor/${triple}/bin/${binName}`,
    };
  }

  const target = getClaudeCodeTarget();
  if (!target) return null;
  const integrity = CLAUDE_INTEGRITY_BY_TARGET[target];
  const sizeBytes = CLAUDE_SIZE_BY_TARGET[target];
  if (!integrity || !sizeBytes) return null;
  const binName = process.platform === "win32" ? "claude.exe" : "claude";
  return {
    registryPackage: `@anthropic-ai/claude-agent-sdk-${target}`,
    registryVersion: CLAUDE_CODE_PACKAGE_VERSION,
    integrity,
    sizeBytes,
    binRelPath: binName,
  };
}
