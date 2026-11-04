## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.12）

- Codex 原生模式下，模型列表改为按当前登录账号实时获取，不再只显示内置的几个固定模型。获取结果会缓存到本地并定期在后台刷新；获取失败时仍使用内置列表。
- 修复 Codex 会话回复完成后不显示变更审核的问题。
- 变更审核性能优化：非 git 项目扫描时跳过 `.venv`、`dist`、`build`、`target` 等依赖、构建和缓存目录，并限制单次扫描的文件数和读取总量；文件特别多的项目会改为只审核 Agent 工具实际改动的文件，避免每轮对话前长时间卡顿。
- 变更审核改为摘要和完整内容分开存储，打开会话时只读取摘要，历史会话加载更快；旧版审核文件会在首次打开时自动迁移。
- 删除对话、删除项目或清空历史记录时，会一并清理对应的变更审核文件，不再残留占用磁盘。
- 侧边栏删除对话前增加确认弹窗，避免误删。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
