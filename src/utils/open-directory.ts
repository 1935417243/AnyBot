import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";

export function openDirectory(dir: string): void {
  const platform = os.platform();
  if (platform === "darwin") {
    spawn("open", [dir], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "win32") {
    spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("sh", [
      "-c",
      "nautilus \"$1\" 2>/dev/null || thunar \"$1\" 2>/dev/null || dolphin \"$1\" 2>/dev/null || xdg-open \"$1\"",
      "sh",
      dir,
    ], { detached: true, stdio: "ignore" }).unref();
  }
}

function spawnAndWait(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} 退出码 ${code ?? "unknown"}`));
    });
  });
}

function openPathAndWait(targetPath: string): Promise<void> {
  const platform = os.platform();
  if (platform === "darwin") {
    return spawnAndWait("open", [targetPath]);
  }
  if (platform === "win32") {
    return spawnAndWait("explorer.exe", [targetPath]);
  }
  return spawnAndWait("sh", [
    "-c",
    "xdg-open \"$1\" 2>/dev/null || gio open \"$1\" 2>/dev/null || nautilus \"$1\" 2>/dev/null || thunar \"$1\" 2>/dev/null || dolphin \"$1\"",
    "sh",
    targetPath,
  ]);
}

export function openFile(filePath: string): Promise<void> {
  return openPathAndWait(filePath);
}

export function revealFileInFolder(filePath: string): Promise<void> {
  return openPathAndWait(path.dirname(filePath));
}
