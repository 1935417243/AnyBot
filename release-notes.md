## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（0.1.29）
- 优化思考过程的处理与展示，提升对话过程中的连贯性
- 优化对话性能，提升消息处理与连续对话体验

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
