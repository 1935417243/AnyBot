## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.7）
- Claude Code 支持接入本地免鉴权模型服务：新增 Ollama / llama.cpp 本地适配层，在设置页选择「Ollama（本地）」或「llama（本地）」Base URL 即可直连本地模型
- 设置页 Base URL 快捷项调整：新增 llama（本地），本地服务地址自动识别并填充占位 API Key，无需手动填写

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
