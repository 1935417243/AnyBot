## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新（1.0.9）

- 聊天中的 HTML、Mermaid 和 SVG 代码块支持预览卡片，可查看、复制代码，并下载 HTML / SVG 文件。
- Mermaid 图表支持保存为高清 PNG 图片，优化图表与 HTML 导出文件命名；请求流程图、时序图等图示时，默认引导模型使用 Mermaid 输出。
- 代码块预览支持按需加载、Mermaid 串行渲染和 HTML 预览高度自适应，减少多图表消息的渲染开销。
- 新增侧边栏折叠 / 展开功能，首页项目选择菜单新增“打开文件夹”入口，方便添加项目。
- 优化桌面端首页窗口拖拽体验，修复侧边栏收起后顶部拖拽区域遮挡折叠按钮的问题。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **macOS 提示“应用已损坏，无法打开”**：如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：
  ```bash
  sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
  ```
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
