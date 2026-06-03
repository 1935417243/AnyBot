## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（0.1.27）
- 新增钉钉机器人渠道，支持消息接入、会话回复和图片/文件回传
- 优化 QQ 渠道消息能力，支持附件解析、图片收发和 Markdown 回复回退
- 优化渠道消息输出规则，减少误发送附件路径，提升微信、飞书、钉钉、QQ 等渠道回复稳定性
- 优化 Web 聊天长消息折叠和本地文件链接展示

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
