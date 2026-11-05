## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.13）

- 窗口左上角新增会话搜索（快捷键 macOS `⌘K`，Windows 与网页端 `Ctrl+K`）：可按会话标题和消息内容搜索，标题命中的排在前面，消息命中时显示关键词附近的内容片段；不输入关键词时显示最近会话。
- 窗口左上角新增后退/前进按钮（快捷键 macOS `⌘[` / `⌘]`，Windows 与网页端 `Alt+←` / `Alt+→`，也支持鼠标侧键）：可在看过的会话，以及插件、频道、自动化、设置页之间来回切换。
- CodeBuddy 支持 Agent 向用户提问：WebUI 会话中 Agent 需要你确认时会弹出提问卡片，支持单选、多选、自由填写和跳过，回答后 Agent 继续执行。
- 网页端也可以收起/展开侧边栏。
- 修复 Windows 桌面端收起侧边栏后，会话标题被折叠按钮遮挡的问题。
- 修复当前会话正在输出时，从插件、频道等页面点击该会话无法切回聊天页的问题。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
