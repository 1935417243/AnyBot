## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（0.1.24）
- 优化 Codex 技能路径传递：WebUI 会同时识别 Codex 用户技能和配置技能，并在兼容模式的隔离运行目录中自动映射可用技能。
- 优化 Claude Code 技能路径传递：Anthropic 兼容配置下会把用户的 Claude Code 技能目录映射到运行配置目录，确保技能在会话中可用。
- 调整官方技能安装位置和扫描逻辑，减少不同 Provider、不同配置目录之间的技能路径混用问题。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
