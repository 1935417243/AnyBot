## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.10）

- 默认工作目录被删除时会自动重建，并补齐缺失的记忆模板；外接磁盘等父目录不存在时不会误创建目录。工作目录或项目路径不可用时，会给出明确提示。
- 长期记忆统一写入 `MEMORY.md`，合并原 `PROFILE.md` 的身份与用户资料，并补充 Agent 的性格与协作方式。已有工作区中的 `PROFILE.md` 仍会读取；尚未填写的记忆模板不再注入对话。
- CodeBuddy 运行组件升级到 2.179.2。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
