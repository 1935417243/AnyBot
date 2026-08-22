## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.4）
- Agent CLI 改为按需下载，安装包体积减少约 55%
- Codex 自定义上游新增 OpenAI Responses 直连格式支持
- 优化微信、QQ 和钉钉频道，完善钉钉机器人群聊回复
- 修复多会话切换异常和流式渲染计时器残留问题
- 优化图片预览弹窗、权限模式展示及部分页面请求失败提示

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
