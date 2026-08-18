## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.1）
- 分支切换器新增搜索过滤（分支超过 8 个时自动显示搜索框）
- 修复新建对话后分支显示仍停留在旧项目分支的问题
- 修复分支列表并发刷新时旧数据覆盖新数据的问题
- 分支排序支持数字自然排序（如 v2 正确排在 v10 之前）
- 修复关闭窗口/退出应用时进行中的回复未正确中断的问题

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
