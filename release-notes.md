## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新
- 桌面端默认使用独立工作区，避免误扫描 Electron 运行缓存。
- 修复资源变更审核中缓存文件误显示的问题。
- 修复技能、频道、工作区和提供商切换后的页面刷新问题。
- 移除 `BOOTSTRAP.md` 工作区初始化提示逻辑。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
- AnyBot 会以内嵌桌面窗口运行，不再额外打开浏览器；Codex/Gemini/Claude/Cursor/Qoder 等 Provider CLI 仍需用户自行安装并登录。
