## AnyBot Packages

| 平台 | 文件 |
|------|------|
| macOS | `AnyBot-*.dmg` |
| Windows | `AnyBot-Setup-*.exe` |

### 本次更新
- 新增 Codex Responses 适配层，可在 AnyBot 内将 Codex 映射到 DeepSeek 等 Anthropic 兼容服务，不影响全局 Codex 配置。
- 优化 Codex 适配层流式输出，WebUI 可继续展示回答增量和思考过程。
- 修复 Codex 适配层初始化 `CODEX_HOME`、工具 schema 转换和工具参数流式拼接问题。
- 收敛 Codex 适配模型为 `gpt-5.5`、`gpt-mini`、`gpt-codex`，并在设置页配置对应上游模型映射。

### 使用说明
- **macOS**：打开 `.dmg` 后将 `AnyBot.app` 拖到 Applications，再双击启动。
- **Windows**：运行 `AnyBot-Setup-*.exe` 安装，安装后从开始菜单或桌面快捷方式启动。
- **Windows 自动更新**：Release 中的 `latest.yml` 和 `.exe.blockmap` 是应用内更新所需文件，请勿删除或重命名。
- AnyBot 会以内嵌桌面窗口运行，不再额外打开浏览器；Codex/Gemini/Claude/Cursor/Qoder 等 Provider CLI 仍需用户自行安装并登录。
