#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const platform = process.platform;
const arch = process.arch;

const platformName =
  platform === "win32" ? "win" :
  platform === "darwin" ? "mac" :
  platform;

const packageName = `AnyBot-${platformName}-${arch}`;
const packagingDir = path.join(root, ".packaging");
const releaseDir = path.join(packagingDir, packageName);

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

// 内置 CLI 的平台二进制包改为按需下载，打包时一律剔除（与 package.json build.files 黑名单保持一致）
const EXCLUDED_PLATFORM_PACKAGE_PATTERN =
  /^node_modules[/\\]@(openai[/\\]codex-(darwin|linux|win32)-|anthropic-ai[/\\]claude-agent-sdk-(darwin|linux|win32)-)/;

function copyNodeModules(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    filter: (src) => !EXCLUDED_PLATFORM_PACKAGE_PATTERN.test(path.relative(root, src)),
  });
}

function copyFileIfExists(source, target) {
  if (fs.existsSync(source)) copy(source, target);
}

function writeFile(target, content, mode) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  if (mode !== undefined) fs.chmodSync(target, mode);
}

function ensureBuilt() {
  const required = [
    path.join(root, "dist", "index.js"),
    path.join(root, "dist", "web", "public", "index.html"),
    path.join(root, "node_modules"),
  ];

  for (const item of required) {
    if (!fs.existsSync(item)) {
      throw new Error(`Missing release input: ${item}`);
    }
  }
}

function copyNodeRuntime() {
  const nodeDir = path.join(releaseDir, "node");
  fs.mkdirSync(nodeDir, { recursive: true });

  if (platform === "win32") {
    copy(process.execPath, path.join(nodeDir, "node.exe"));
  } else {
    const target = path.join(nodeDir, "node");
    copy(process.execPath, target);
    fs.chmodSync(target, 0o755);
  }
}

function writeWindowsLaunchers() {
  writeFile(path.join(releaseDir, "start-anybot.cmd"), `@echo off
setlocal
cd /d "%~dp0"

if not exist ".data" mkdir ".data"
if not exist ".run" mkdir ".run"

if exist "resources\\md_files" (
  for %%F in (AGENTS.md MEMORY.md PROFILE.md BOOTSTRAP.md) do (
    if not exist "%%F" copy "resources\\md_files\\%%F" "%%F" >nul
  )
)

echo AnyBot Web UI: http://localhost:19981
echo.
"%~dp0node\\node.exe" "%~dp0dist\\index.js"
pause
`, 0o755);

  writeFile(path.join(releaseDir, "start-anybot.vbs"), `Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & dir & "\\start-anybot-background.ps1" & Chr(34), 0, False
`, 0o755);

  writeFile(path.join(releaseDir, "start-anybot-background.ps1"), `$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Add-PathEntry {
  param([string]$PathEntry)
  if ([string]::IsNullOrWhiteSpace($PathEntry)) {
    return
  }
  $expanded = [Environment]::ExpandEnvironmentVariables($PathEntry)
  if ((Test-Path $expanded) -and (($env:Path -split ';') -notcontains $expanded)) {
    $env:Path = "$expanded;$env:Path"
  }
}

foreach ($entry in ([Environment]::GetEnvironmentVariable("Path", "Machine") -split ';')) {
  Add-PathEntry $entry
}
foreach ($entry in ([Environment]::GetEnvironmentVariable("Path", "User") -split ';')) {
  Add-PathEntry $entry
}
Add-PathEntry "$env:APPDATA\\npm"
Add-PathEntry "$env:LOCALAPPDATA\\Programs\\nodejs"
Add-PathEntry "$env:ProgramFiles\\nodejs"
Add-PathEntry "\${env:ProgramFiles(x86)}\\nodejs"

function Open-AnyBotWindow {
  $url = "http://localhost:19981"
  $browser = Get-Command "msedge.exe" -ErrorAction SilentlyContinue
  if (-not $browser) {
    $browser = Get-Command "chrome.exe" -ErrorAction SilentlyContinue
  }

  if ($browser) {
    Start-Process -FilePath $browser.Source -ArgumentList "--app=$url"
  } else {
    Start-Process $url
  }
}

New-Item -ItemType Directory -Force -Path ".data", ".run" | Out-Null

if (Test-Path "resources\\md_files") {
  foreach ($file in "AGENTS.md", "MEMORY.md", "PROFILE.md", "BOOTSTRAP.md") {
    if (-not (Test-Path $file)) {
      Copy-Item (Join-Path "resources\\md_files" $file) $file
    }
  }
}

$pidFile = Join-Path ".run" "anybot.pid"
$logFile = Join-Path ".run" "anybot.log"
$errFile = Join-Path ".run" "anybot.err.log"

if (Test-Path $pidFile) {
  $oldPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Open-AnyBotWindow
    exit 0
  }
}

$process = Start-Process \`
  -FilePath (Join-Path $PSScriptRoot "node\\node.exe") \`
  -ArgumentList (Join-Path $PSScriptRoot "dist\\index.js") \`
  -WorkingDirectory $PSScriptRoot \`
  -WindowStyle Hidden \`
  -RedirectStandardOutput $logFile \`
  -RedirectStandardError $errFile \`
  -PassThru

Set-Content -Path $pidFile -Value $process.Id
Start-Sleep -Seconds 2
Open-AnyBotWindow
`, 0o755);

  writeFile(path.join(releaseDir, "start-anybot.ps1"), `$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Add-PathEntry {
  param([string]$PathEntry)
  if ([string]::IsNullOrWhiteSpace($PathEntry)) {
    return
  }
  $expanded = [Environment]::ExpandEnvironmentVariables($PathEntry)
  if ((Test-Path $expanded) -and (($env:Path -split ';') -notcontains $expanded)) {
    $env:Path = "$expanded;$env:Path"
  }
}

foreach ($entry in ([Environment]::GetEnvironmentVariable("Path", "Machine") -split ';')) {
  Add-PathEntry $entry
}
foreach ($entry in ([Environment]::GetEnvironmentVariable("Path", "User") -split ';')) {
  Add-PathEntry $entry
}
Add-PathEntry "$env:APPDATA\\npm"
Add-PathEntry "$env:LOCALAPPDATA\\Programs\\nodejs"
Add-PathEntry "$env:ProgramFiles\\nodejs"
Add-PathEntry "\${env:ProgramFiles(x86)}\\nodejs"

New-Item -ItemType Directory -Force -Path ".data", ".run" | Out-Null

if (Test-Path "resources\\md_files") {
  foreach ($file in "AGENTS.md", "MEMORY.md", "PROFILE.md", "BOOTSTRAP.md") {
    if (-not (Test-Path $file)) {
      Copy-Item (Join-Path "resources\\md_files" $file) $file
    }
  }
}

Write-Host "AnyBot Web UI: http://localhost:19981"
& "$PSScriptRoot\\node\\node.exe" "$PSScriptRoot\\dist\\index.js"
`, 0o755);

  writeFile(path.join(releaseDir, "stop-anybot.ps1"), `$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$pidFile = Join-Path ".run" "anybot.pid"
if (-not (Test-Path $pidFile)) {
  Write-Host "AnyBot is not running."
  exit 0
}

$targetPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($targetPid -and (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $targetPid -Force
  Write-Host "AnyBot stopped."
} else {
  Write-Host "AnyBot is not running."
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
`, 0o755);

  writeFile(path.join(releaseDir, "stop-anybot.cmd"), `@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-anybot.ps1"
pause
`, 0o755);
}

function writeMacLaunchers() {
  writeFile(path.join(releaseDir, "start-anybot.command"), `#!/bin/sh
set -eu
DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
cd "$DIR"

mkdir -p ".data" ".run"

if [ -d "resources/md_files" ]; then
  for f in AGENTS.md MEMORY.md PROFILE.md BOOTSTRAP.md; do
    if [ ! -f "$f" ]; then
      cp "resources/md_files/$f" "$f"
    fi
  done
fi

echo "AnyBot Web UI: http://localhost:19981"
exec "$DIR/node/node" "$DIR/dist/index.js"
`, 0o755);

  writeFile(path.join(releaseDir, "start-anybot.sh"), `#!/bin/sh
exec "$(dirname "$0")/start-anybot.command"
`, 0o755);
}

function writeReadme() {
  const providerNote = [
    "Codex CLI is resolved from the bundled @openai/codex-sdk dependency when available.",
    "If you configure an external Provider CLI override, install and log in to that CLI, then make sure the executable path is available.",
  ].join("\n");

  const startCommand = platform === "win32"
    ? "Double-click start-anybot.cmd"
    : "Double-click start-anybot.command";

  writeFile(path.join(releaseDir, "README-PACKAGE.txt"), `AnyBot Portable Package

Start:
  ${startCommand}
  Open http://localhost:19981

Configure:
  Use the Web UI for provider/model settings.
  Runtime data is stored in .data and logs are stored in .run.
  Optional overrides such as WEB_PORT or CODEX_BIN can be passed as system environment variables before launch.

${providerNote}

Platform:
  ${platform} ${arch}
Node:
  ${process.version}
Host:
  ${os.platform()} ${os.arch()}
`);
}

ensureBuilt();

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

copy(path.join(root, "dist"), path.join(releaseDir, "dist"));
copyNodeModules(path.join(root, "node_modules"), path.join(releaseDir, "node_modules"));
copy(path.join(root, "package.json"), path.join(releaseDir, "package.json"));
copy(path.join(root, "package-lock.json"), path.join(releaseDir, "package-lock.json"));
copyFileIfExists(path.join(root, "README.md"), path.join(releaseDir, "README.md"));
copyFileIfExists(path.join(root, "README_CN.md"), path.join(releaseDir, "README_CN.md"));

copyNodeRuntime();
copy(path.join(root, "dist", "agent", "md_files"), path.join(releaseDir, "resources", "md_files"));

if (platform === "win32") {
  writeWindowsLaunchers();
} else if (platform === "darwin") {
  writeMacLaunchers();
} else {
  writeMacLaunchers();
}

writeReadme();

console.log(releaseDir);
