## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.15）

- 修复同时打开多个 WebUI 标签页后页面请求一直卡住、无法加载的问题：同一浏览器的多个标签页现在共享一条实时事件连接，主标签页关闭后由其它标签页自动接管。
- 修复 Agent 回复中包含未标注语言的代码块时页面卡顿的问题。
- 消息保存性能优化：消息写入与会话更新合并为一次数据库事务，减少长对话和频道高频消息时的磁盘写入。
- 只读权限模式下不再为每轮对话生成变更审核快照，大项目中发送消息更快。
- 变更审核通过/撤销响应更快；审核卡片中的文件 diff 改为展开时才渲染，操作后只更新对应卡片，改动文件较多时不再卡顿。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
