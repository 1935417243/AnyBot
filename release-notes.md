## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.14）

- 在对话里直接让 Agent 管理自动化：Codex、Claude Code、CodeBuddy 会话中说“每天 9 点帮我总结 GitHub Trending”“明天下午 3 点提醒我开会”等，Agent 会在 AnyBot 中创建、修改、停用或删除自动化，并告知触发方式、下次执行时间和交付方式。从微信、Telegram 等频道发起的对话，结果默认推回该频道；WebUI 发起的默认只保存在本地。自动化执行时不会再创建新的自动化。
- Claude Code / CodeBuddy 会话中不再使用自带的会话级定时工具（对话结束后基本不会触发），定时需求统一创建为 AnyBot 自动化。
- 自动化新增「仅一次」触发：到点执行一次后自动停用；应用重启时如果错过执行时间不超过 5 分钟，会补跑一次。
- 自动化支持 Cron 表达式触发（分 时 日 月 周，本机时区），支持 `*`、数字、`a-b` 范围、逗号列表和 `/步长`，编辑时实时显示下次执行时间；日和周同时填写时需同时满足。格式不正确的表达式会直接提示，不再静默保存。
- 进入自动化页面时会自动刷新列表，及时显示对话中新建或修改的任务。
- 非 git 项目也支持 `@` 引用文件：会读取各级 `.gitignore` 并跳过依赖、构建产物等目录；文件很多或目录很大时限制扫描范围并提示列表已截断。
- 修复 `@` 文件选择器加载时列表闪烁、无匹配时弹窗被关闭的问题。
- `/` 选择器没有匹配项时，提示未识别的命令不会发送给模型。
- 窗口左上角标题条按钮改用自定义悬停提示，显示功能名和快捷键。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
