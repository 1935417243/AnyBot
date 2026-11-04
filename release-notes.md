## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.11）

- Codex 运行组件升级到 0.166.0。自定义上游改为通过环境变量读取密钥，兼容新版 CLI 不再读取 `CODEX_API_KEY` 的行为。
- 上下文占用改为按最近一次请求统计，不再把整段对话的累计用量当成当前占用；Anthropic 的缓存读写 token 会计入输入 token。
- CodeBuddy 会回传本轮上下文占用。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
