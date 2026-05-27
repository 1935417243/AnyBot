## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（0.1.20）
- WebUI 新增 `@` 文件引用：在输入框输入 `@` 搜索当前会话项目文件，选中文件后随本轮消息作为引用上下文发送。
- `/compact` 增加防呆：当前上下文为空时会禁用压缩命令，并提示暂无需压缩。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
- AnyBot 会以内嵌桌面窗口运行，不再额外打开浏览器；Codex/Gemini/Claude/Cursor/Qoder 等 Provider CLI 仍需用户自行安装并登录。
