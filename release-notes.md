## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（0.1.22）
- Web UI 样式完成模块化拆分，聊天、侧边栏、设置、频道、自动化、技能和附件样式分文件维护。
- 前端 Markdown 渲染、代码高亮和内容净化依赖改为本地资源，减少外部加载依赖，提升启动与加载稳定性。
- Markdown 消息中的本地文件/目录链接支持直接跳转打开。
- 项目列表支持删除项目，补齐项目管理闭环。
- Web 服务默认收紧为本机监听，降低局域网暴露风险。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
- AnyBot 会以内嵌桌面窗口运行，不再额外打开浏览器；Codex/Gemini/Claude/Cursor/Qoder 等 Provider CLI 仍需用户自行安装并登录。
