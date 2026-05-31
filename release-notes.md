## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（0.1.23）
- 优化 Codex 流式回答完成后的落库和收尾逻辑，减少 Windows 下最终回答渲染慢、等待时间长的问题。
- 改进聊天滚动体验：流式输出时不再强制把已上滑查看历史的页面拉回底部，并提供“回到底部”按钮。
- 优化对话过程展示，区分处理过程、思考内容和最终回答，降低过程文本混入最终回复的概率。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
- AnyBot 会以内嵌桌面窗口运行，不再额外打开浏览器；Codex/Gemini/Claude/Cursor/Qoder 等 Provider CLI 仍需用户自行安装并登录。
