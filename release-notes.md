## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.0）
- WebUI 界面整体重构，交互与视觉体验全面升级
- 支持会话工作区分支切换，并提供清空工作区入口
- 新增 Ollama 本地模型支持，更新 Kimi 模型列表
- 优化自动化调度器性能与稳定性
- 优化大聊天记录加载、删除会话等场景的健壮性
- 多处细节优化：字体大小调整、提供商交互、退出流程等

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
