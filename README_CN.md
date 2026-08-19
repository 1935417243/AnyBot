[English](./README.md) | **中文**

# AnyBot

![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Stars](https://img.shields.io/github/stars/1935417243/AnyBot)
![Release](https://img.shields.io/github/v/release/1935417243/AnyBot)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)

AnyBot 是一个本机 AI Coding Agent 控制台与远程入口，可以让你通过桌面 App、Web UI、微信、QQ、Telegram、飞书、钉钉等渠道控制和管理电脑上的 AI Coding Agent。

AnyBot 默认使用随 `@openai/codex-sdk` 和 `@anthropic-ai/claude-agent-sdk` 提供的平台 native binary，不要求用户额外全局安装 `codex` 或 Claude Code；如果需要，也可以在设置中指定外部 CLI。Provider、模型映射、环境变量和 MCP 配置都保存在 AnyBot 内部。

如果不想使用本机全局模型配置，可以在 AnyBot 内为 Codex / Claude Code 单独配置兼容接口和模型映射，接入阿里 Token Plan、DeepSeek、Kimi、MiniMax、Ollama（本地）、VibeAPI 或其它 Anthropic API 兼容服务。AnyBot 内配置只在 AnyBot 内生效，不会影响本机全局配置。

桌面 App 支持 **macOS** 和 **Windows**；源码运行支持 **macOS**、**Linux** 和 **Windows**。

---

## 特性

- **多 Provider**：支持 Codex SDK/CLI 和 Claude Code，可在 Web UI 或频道命令中切换 Provider 和模型。
- **兼容模型接入**：支持 Codex Responses 适配层和 Claude Code Anthropic 兼容接口，可在 AnyBot 内配置 Base URL、API Key 和模型映射。
- **MCP 服务器**：在插件页手动添加、启用、禁用、检查和查看 MCP Server 日志，校验通过后同一份配置注入 Codex 和 Claude Code。
- **Agent Web UI**：本地聊天界面，支持 Markdown、代码高亮、流式 Agent 事件、停止响应、上下文压缩和会话历史。
- **项目工作区**：在侧边栏管理项目，支持从 Git 仓库克隆项目、查看和切换分支、清空工作区；项目会话会把项目目录作为 Provider 工作目录，也支持在单轮消息中额外选择项目。
- **技能与插件页**：侧边栏「插件」页集中管理技能和 MCP 服务器；技能按 Provider 隔离，可浏览、启用、禁用、删除，并在输入框 `/` 菜单中按当前 Provider 展示可用技能和命令。
- **附件上传**：Web UI 支持按钮、粘贴图片和拖拽上传，单文件上限 50MB；图片能力取决于当前 Provider。
- **变更审核**：Agent 修改文件后生成变更快照，可在 Web UI 中查看 diff、通过或撤销。
- **多频道接入**：支持飞书长连接、钉钉 Stream、QQ Bot WebSocket、Telegram 长轮询和个人微信通道。
- **主动推送**：通过 `/api/send` 向已配置 Owner 的频道发送通知。
- **自动化任务**：在本机按分钟、每天、每周或 Cron 触发 Agent 任务；过程在 Web UI 展示，结果可保存到本地或交付到已启用频道。
- **桌面体验**：Electron 桌面壳、托盘、开机启动、Windows 安装版应用内下载更新，其它平台可在关于页检查 GitHub 最新版本并手动下载。

---

## 截图预览

![新对话](assets/主页.png)

![自动化](assets/自动化.png)

![频道](assets/频道页.png)

![设置](assets/设置页.png)

---

## 架构概览

```mermaid
flowchart LR
    User[用户] --> WebUI[Web UI]
    User --> Channels[飞书 / 钉钉 / QQ / Telegram / 微信]
    WebUI --> Runner[ChatRunner]
    Channels --> Runner
    Runner --> Providers[Provider 层]
    Providers --> Codex[Codex CLI]
    Providers --> Claude[Claude Code]
    Providers --> ThirdParty[第三方模型]
    Providers --> MCP[MCP Servers]
    Runner --> Workspace[项目工作区]
    Runner --> Skills[技能]
    Runner --> Review[变更审核]
    Runner --> Automation[自动化任务]
```

---

## 快速开始

### 1. 安装桌面 App（推荐）

从 [GitHub Releases](https://github.com/1935417243/AnyBot/releases) 下载对应平台安装包：

| 平台 | 安装包 | 说明 |
|------|--------|------|
| Windows | `AnyBot-Setup-x.x.x.exe` | 双击安装后从开始菜单或桌面快捷方式启动 |
| macOS | `AnyBot-x.x.x-*.dmg` | 打开 `.dmg`，将 `AnyBot.app` 拖到 Applications 后启动 |

桌面 App 不要求用户手动安装 Node.js。启动后会自动打开 AnyBot 窗口，Provider、模型、MCP、权限、项目、频道、自动化和隐私设置都可以在 Web UI 中配置。

Windows 安装版支持在 **设置 -> 关于 -> 检测更新** 中检查、下载并重启安装新版本；macOS 暂时需要手动下载新版 `.dmg` 覆盖安装。源码运行或不支持自动更新的平台也可以在关于页检查 GitHub 最新版本。

#### macOS 提示“应用已损坏，无法打开”

如果你确认安装包来自 AnyBot 的 GitHub Releases，可以在终端执行：

```bash
sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
```

如果 Applications 中应用名显示为 `Anybot.app`，请把命令里的路径改成实际名称。

### 2. Provider 前置配置

至少配置一个 Provider：

| Provider | 运行方式 | 说明 |
|----------|---------|------|
| Codex | 默认使用随 `@openai/codex-sdk` 提供的平台 native binary，不要求全局安装 `codex` 命令；启用 **Responses 适配层** 后，只使用 AnyBot 内的兼容服务配置和模型映射 | 支持会话续聊、Sandbox、图片输入、MCP |
| Claude Code | 默认使用随 `@anthropic-ai/claude-agent-sdk` 提供的平台 native binary，不要求全局安装 Claude Code；需要外部 CLI 时可在高级设置中指定，使用说明见 [Claude Code 文档](https://code.claude.com/docs/en/overview) | 支持会话续聊、Sandbox 映射、Agent 流式事件、MCP |

### 3. 源码运行

源码运行和开发建议使用 **Node.js 22**，以贴近 CI 环境。

```bash
git clone https://github.com/1935417243/AnyBot.git
cd AnyBot
npm ci
npm start
```

启动后打开 `http://localhost:19981` 使用 Web UI。

### 4. 后台运行

```bash
npm run bot:start
npm run bot:status
npm run bot:stop
```

---

## Provider 架构

| Provider | 状态 | 图片输入 | 说明 |
|----------|------|----------|------|
| `codex` | 可用 | 支持 | 使用 Codex SDK/CLI，支持 Sandbox、Agent 事件、上下文用量和 MCP |
| `claude-code` | 可用 | 暂不支持 | 使用 Claude Agent SDK，支持会话续聊、权限模式、上下文压缩、Agent 流式事件和 MCP |

Provider 和模型选择会在 Web UI 中保存；每个 Provider 会记住上次选择的模型。

## 兼容模型支持

AnyBot 可以在设置页为 Codex 和 Claude Code 单独配置 Anthropic API 兼容服务。当前内置 Base URL 建议项包括阿里 Token Plan、DeepSeek、Kimi、MiniMax、Ollama（本地）和 VibeAPI；也可以手动填写其它兼容服务地址。

Codex 通过 **Responses 适配层** 接入兼容服务。开启后，Codex Provider 会使用 AnyBot 内置的兼容服务配置和模型映射，并使用独立 `CODEX_HOME`，不影响用户全局 `~/.codex` 配置。

Claude Code 通过 **Anthropic 兼容接口** 接入兼容服务。开启后，Claude Code Provider 会优先使用 AnyBot 内配置的 Base URL、API Key、Auto/Opus/Sonnet/Haiku/Subagent 模型映射和可选外部 CLI 路径。

适用场景：

- 使用兼容模型驱动本机 Codex 或 Claude Code Agent。
- 在 Web UI 中选择稳定模型别名。
- 通过飞书、钉钉、QQ、Telegram、个人微信等频道远程调用本机 Agent。
- 配合项目工作区、技能和自动化任务完成代码分析、定时巡检、文档生成等任务。

在 **设置 -> 提供商 -> Codex** 中开启 **Responses 适配层** 后，聊天框只展示 `gpt-5.5`、`gpt-mini`、`gpt-codex` 三个稳定别名，实际上游模型由设置页映射决定。Claude Code 兼容接口则按 Auto、Opus、Sonnet、Haiku / Fast、Subagent 等用途维护映射。

---

## Web UI

Web UI 是当前推荐入口，主要能力包括：

- 多会话历史和 SQLite 持久化。
- 项目管理、项目会话、目录树、Git 仓库克隆与分支切换、默认工作目录设置。
- Markdown 渲染、代码复制、长消息折叠、上下文用量展示。
- Agent 流式过程展示、取消响应、`/compact` 上下文压缩。
- 文件上传、图片预览、本地图片访问。
- Slash picker：按当前 Provider 展示技能、项目和 Provider 原生命令。
- 变更审核：展示 Agent 改动 diff，支持通过或撤销。
- Provider、模型、Sandbox/权限、应用外观、日志、数据导入导出和频道配置。
- 插件页：集中管理技能（按 Provider 隔离扫描技能目录，支持启用、禁用、删除和打开文件夹）和 MCP 服务器。
- 自动化任务管理：配置触发时间、Provider、模型、项目、技能和交付方式；本地调度器会按配置新建会话并执行任务。

---

## 频道能力

不同频道受平台协议限制，支持范围不同：

| 频道 | 接入方式 | 输入 | 输出 | 备注 |
|------|----------|------|------|------|
| 飞书 | 长连接事件订阅 | 文本、图片 | 文本、图片、`FILE:` 文件 | 群聊默认仅 @ 回复，可配置为全部回复 |
| 钉钉 | Stream 机器人事件 | 文本、图片、文件 | Markdown、图片、`FILE:` 文件 | 单聊会自动记录 Owner；附件上限 20MB |
| QQ Bot | WebSocket 网关 | 文本、图片、文件 | Markdown、图片 | 支持频道、群聊和 C2C/私聊事件；非图片文件会返回本机路径 |
| Telegram | Bot API 长轮询 | 文本、图片 | 文本 | 图片 caption 会作为上下文；长回复自动拆分 |
| 个人微信 | 微信通道协议 | 文本、图片、文件 | 文本、图片、`FILE:` 文件 | 扫码绑定 |

所有频道都支持频道命令：`/help`、`/new`、`/provider`、`/model`、`/workspace`。不带 `/` 的 `provider 1`、`model 1`、`workspace 1` 也可用于按序号切换。

### 频道配置

频道配置保存在 `.data/channels.json`，推荐直接在 Web UI 中管理。

```jsonc
{
  "feishu": {
    "enabled": false,
    "appId": "",
    "appSecret": "",
    "groupChatMode": "mention",
    "botOpenId": "",
    "ackReaction": "OK",
    "ownerChatId": ""
  },
  "qqbot": {
    "enabled": false,
    "appId": "",
    "appSecret": "",
    "ownerChatId": ""
  },
  "dingtalk": {
    "enabled": false,
    "appId": "",
    "appSecret": "",
    "robotCode": "",
    "ownerChatId": ""
  },
  "telegram": {
    "enabled": false,
    "token": "",
    "ownerChatId": ""
  },
  "weixin": {
    "enabled": false,
    "accountId": "",
    "token": "",
    "baseUrl": "https://ilinkai.weixin.qq.com",
    "botType": "3",
    "botAgent": "",
    "ownerChatId": ""
  }
}
```

`weixin.botAgent` 留空时默认按当前应用版本生成（例如 `AnyBot/1.0.0`）。

### 飞书

在飞书开放平台创建应用后，开启机器人能力和长连接模式，订阅 `im.message.receive_v1`，授予发送消息权限；如需处理图片，还需要读取消息资源相关权限。

### 钉钉

在钉钉开放平台创建 Stream 机器人应用，填写 App Key 和 App Secret。机器人收到消息后会自动缓存 `robotCode`；首次单聊机器人时会自动记录 `ownerChatId`，用于主动推送和自动化交付。

### QQ Bot

在 QQ 开放平台创建机器人应用，获取 App ID 和 App Secret，并配置消息接收权限。当前实现接入公域/频道消息、群聊和 C2C/私聊事件。

### Telegram

通过 [@BotFather](https://t.me/BotFather) 创建机器人并获取 Bot Token。群组中需要 @ 机器人或使用带 bot 名称的命令触发回复。

### 个人微信

启用微信频道后，首次启动会生成二维码，用个人微信扫码确认。扫码成功后会写回 `accountId`、`token` 和 `ownerChatId`。如果登录态失效，清空 `weixin.token` 后重启即可重新绑定。

---

## 技能与 Slash

技能目录按 Provider 隔离：

| Provider | 技能目录 |
|----------|---------|
| `codex` | 原生 Codex 模式使用 `$CODEX_HOME/skills/`，未设置时为 `~/.codex/skills/`；开启 Responses 适配层后使用 AnyBot 运行数据目录下的 `codex/skills/` |
| `claude-code` | `$CLAUDE_CONFIG_DIR/skills/`，未设置时为 `~/.claude/skills/` |

Web UI 的 `/` 入口会按当前 Provider 展示可用技能、项目和命令。技能只注入本轮选择的技能名，不注入技能描述或文件内容；项目选择会按项目名和绝对路径写入本轮提示词。

---

## MCP 服务器

MCP Server 在侧边栏 **插件** 页的「MCP 服务器」tab 中管理，配置保存在 `.data/app-settings.json`。当前支持粘贴 `mcpServers` JSON，或包含 `command` / `url` 的单个 Server 配置；支持 `stdio`、`http` 和 `sse` 类型。

启用的 MCP Server 会在应用启动时校验，也可以在插件页手动刷新、重新检查、查看日志、禁用或删除。校验通过后，同一份 MCP 配置会传给 Codex 和 Claude Code；Codex 会转换为 Codex CLI 的 `mcp_servers` 配置，Claude Code 会转换为 Claude Agent SDK 的 `mcpServers` 配置。

---

## 主动推送

AnyBot 保留了轻量本地 API，方便脚本把通知推送到已配置 Owner 的频道。常见用法是发送部署结果、定时任务结果或本机自动化提醒。

`/api` 需要鉴权：启动时生成随机 token 写入 `.data/api-token`（可用 `ANYBOT_API_TOKEN` 覆盖），本机脚本可读取后通过 `Authorization: Bearer` 头或 `?token=` 查询参数携带。

```bash
TOKEN=$(cat .data/api-token)
curl -X POST http://localhost:19981/api/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "telegram", "message": "部署完成"}'
```

`channel` 可选 `feishu`、`dingtalk`、`qqbot`、`telegram`、`weixin`，需要对应频道配置 `ownerChatId`。

---

## 自动化任务

自动化运行在用户本机，不依赖云端服务。应用启动后会加载已启用任务，按 `nextRunAt` 找到最近一次执行时间并使用本地定时器触发；如果应用关闭或电脑睡眠，错过的任务不会在重启后补跑，会直接计算下一次未来执行时间。

每次自动化执行都会创建一个新的本地会话，继续走 `ChatRunner`，因此 Provider、模型、项目目录、技能、Agent 过程展示、消息落库和变更审核都与普通 Web UI 对话保持一致。交付方式只决定结果出口：选择“本地”时结果保存在运行记录中；选择频道时，App 内仍展示完整过程，频道只收到最终结果。

---

## 运行数据

默认运行数据写入 `.data/`，日志写入 `.run/`。桌面 App 会使用 Electron 的用户数据目录，并在其中维护 `.data/`、`.run/` 和上传目录。

常见文件：

- `.data/chat.db`：会话、消息、项目和自动化存储。
- `.data/app-settings.json`：应用设置、Provider 运行配置和 MCP Server 配置。
- `.data/model-config.json`：Provider 与模型选择。
- `.data/runtime-config.json`：Sandbox/权限默认值。
- `.data/channels.json`：频道配置。
- `.data/api-token`：本机 API 鉴权 token（mode 0600），供本机脚本调用 `/api` 使用。
- `.data/proxy.json`：代理配置。
- `.data/disabled-skills.json`：技能启用状态。
- `.data/change-reviews/`：变更审核快照。
- `.data/codex/`：开启 Codex Responses 适配层后的隔离 `CODEX_HOME`，包含 Codex 会话和技能数据。
- `.data/claude-code/`：开启 Claude Code Anthropic 兼容接口后的隔离 `CLAUDE_CONFIG_DIR`。

---

## 工作原理

- `src/index.ts` 启动 Provider、Web 服务、已启用频道、桌面更新检查和 MCP Server 启动校验。
- `src/chat-runner.ts` 是 Web UI 和频道进入模型调用的统一编排层，负责 Provider session、项目工作目录、prompt、消息落库、流式事件和变更审核。
- `src/automation-scheduler.ts` 是本地自动化调度器，负责跳过重启后错过的任务、触发到期任务、记录运行历史并交付最终结果。
- Web 会话和频道会话都绑定 Provider 原生 session，后续消息通过续聊机制保持上下文。
- 启用的 MCP Server 会进入 Provider 调用配置，供 Codex 和 Claude Code 在任务中使用。
- 项目会话会把项目目录作为 Provider 工作目录；普通对话使用默认工作目录。
- Web UI 上传文件保存到工作目录下的 `tmp/uploads/`。
- Agent 回复中的本机图片路径和 `FILE: /path/to/file.ext` 只会在支持附件回传的频道中上传发送。
- 日志为单行 JSON，按日期和时间分片写入 `.run/`，默认保留 3 天。

---

## 项目结构

```text
AnyBot/
├── src/
│   ├── index.ts                    # 进程入口：启动 Provider、Web 服务、频道、MCP 校验和更新检查
│   ├── chat-runner.ts              # 会话编排：Provider 调用、流式事件、变更审核和消息落库
│   ├── automation-scheduler.ts     # 本地自动化调度、运行记录和结果交付
│   ├── app-settings.ts             # 应用设置读写
│   ├── sandbox-config.ts           # Provider sandbox / 权限模式配置
│   ├── mcp-config.ts               # MCP 配置转换（注入 Codex / Claude Code）
│   ├── prompt.ts                   # 共享系统提示词构建
│   ├── shared.ts                   # 共享运行配置、ID 和路径辅助
│   ├── logger.ts                   # 结构化日志
│   ├── lark.ts                     # 飞书 API（消息、文件、图片）
│   ├── message.ts                  # 消息解析（输入输出）
│   ├── providers/                  # Provider 抽象层
│   ├── channels/                   # 微信、Telegram、飞书、钉钉、QQ 等频道集成
│   ├── web/                        # Express API、SQLite 存储和 Web UI 静态资源
│   │   ├── routes/                 # 领域路由
│   │   ├── services/               # 复用业务逻辑和纯辅助函数
│   │   └── public/                 # 无构建流程的 HTML / CSS / ES modules
│   └── agent/md_files/             # Agent 提示词模板
├── electron/                       # Electron 桌面入口与打包后处理
├── scripts/                        # 构建、发布资源复制和 daemon 辅助脚本
├── installer/windows/              # Windows 安装器配置
├── build/icons/                    # 桌面应用图标
├── assets/                         # README 截图和展示素材
└── package.json
```

---

## 开发命令

```bash
npm ci
npm run dev
npm run check
npm run build
npm run build:release
npm run electron:dev
npm run electron:build
```

提交前至少运行 `npm run check`。涉及桌面壳、发布资源或安装包时，运行对应 build/electron 命令。

---

## 添加新 Provider

1. 在 `src/providers/` 下实现 `IProvider`。
2. 在 `src/providers/index.ts` 中注册 Provider 工厂。
3. 在 `src/app-settings.ts` 和 `src/providers/index.ts` 中接入 Provider 专属运行配置。
4. 如需 Web UI slash 命令，实现 `listSlashCommands()`，并确保后端能可靠处理。

可参考 `src/providers/codex.ts` 和 `src/providers/claude-code.ts`。

---

## License

MIT
