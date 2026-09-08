[English](./README.md) | **中文**

<div align="center">
  <img src="assets/logo.png" alt="AnyBot logo" width="120">
  <h1>AnyBot</h1>
  <p>本机 AI Coding Agent 控制台，桌面端、网页和聊天频道一个入口。</p>

  <p>
    <a href="https://github.com/1935417243/AnyBot/actions/workflows/build-portable.yml"><img src="https://github.com/1935417243/AnyBot/actions/workflows/build-portable.yml/badge.svg" alt="Build"></a>
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT">
    <img src="https://img.shields.io/github/stars/1935417243/AnyBot" alt="Stars">
    <img src="https://img.shields.io/github/v/release/1935417243/AnyBot" alt="Release">
    <img src="https://img.shields.io/github/downloads/1935417243/AnyBot/total" alt="Downloads">
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform">
  </p>
</div>

AnyBot 是一个本机 AI Coding Agent 控制台与远程入口，可以让你通过桌面 App、Web UI、微信、QQ、Telegram、飞书、钉钉等渠道控制和管理电脑上的 AI Coding Agent。

AnyBot 支持 **Codex、Claude Code 和 CodeBuddy**，通过各自的 SDK 调用本机 Agent。桌面安装包中的 CLI 组件按需下载，可在设置页选择 Provider 后点击“立即下载”，不要求全局安装 CLI；源码开发也可使用 SDK 随附的运行组件。需要时可指定外部 CLI。

如果不想使用本机全局模型配置，可以在 AnyBot 内为 Codex / Claude Code 单独配置上游接口和模型映射，接入 DeepSeek、Kimi、MiniMax、阿里 Token Plan、VibeAPI、Ollama（本地）、llama（本地）等服务。Codex 支持 Responses 直连或 Anthropic 适配，Claude Code 支持 Anthropic 兼容接口；CodeBuddy 使用官方服务，可填写 API Key 或沿用 CLI 已登录凭据。这些模型设置只在 AnyBot 内生效。

桌面 App 支持 **macOS** 和 **Windows**；源码运行支持 **macOS**、**Linux** 和 **Windows**。

---

## 特性

- **多 Provider**：支持 Codex、Claude Code 和 CodeBuddy，可在 Web UI 或频道命令中切换 Provider 和模型，运行组件支持按需下载。
- **兼容模型接入**：Codex 支持自定义 Responses / Anthropic 上游，Claude Code 支持 Anthropic 兼容接口，可配置 Base URL、API Key 和模型映射；Claude Code 连接 Ollama / llama 本地模型时支持温度调节。
- **MCP 服务器**：在插件页添加、启用、禁用、检查和查看 MCP Server 日志，同一份配置可供三个 Provider 使用。
- **Agent Web UI**：本地聊天界面，支持 Markdown、代码高亮、流式 Agent 事件、停止响应、上下文压缩和会话历史。
- **代码与图表预览**：HTML、Mermaid、SVG 代码块可直接预览，支持查看和复制代码、下载 HTML / SVG、将 Mermaid 图表保存为高清 PNG。
- **项目工作区**：在侧边栏管理项目，支持从 Git 仓库克隆项目、查看和切换分支、清空工作区；项目会话会把项目目录作为 Provider 工作目录，也支持在单轮消息中额外选择项目。
- **技能与插件页**：集中管理技能和 MCP 服务器；技能按 Provider 隔离，可浏览、启用、禁用、删除，Codex / Claude Code 还支持选装官方技能。输入框 `/` 菜单按当前 Provider 展示可用技能和命令。
- **附件上传**：Web UI 支持按钮、粘贴图片和拖拽上传，单文件上限 50MB；图片能力取决于当前 Provider。
- **变更审核**：Agent 修改文件后生成变更快照，可在 Web UI 中查看 diff、通过或撤销。
- **多频道接入**：支持飞书长连接、钉钉 Stream、QQ Bot WebSocket、Telegram 长轮询和个人微信通道。
- **主动推送**：通过 `/api/send` 向已配置 Owner 的频道发送通知。
- **自动化任务**：在本机按分钟、每天、每周或 Cron 触发 Agent 任务；过程在 Web UI 展示，结果可保存到本地或交付到已启用频道。
- **桌面体验**：侧边栏折叠、首页打开文件夹、窗口拖拽、托盘和开机启动；Windows 安装版支持应用内下载更新，其它平台可在关于页检查 GitHub 最新版本并手动下载。

---

## 截图预览

<table>
  <tr>
    <td><img src="assets/主页.png" alt="新对话"></td>
    <td><img src="assets/流式过程.png" alt="流式过程"></td>
  </tr>
  <tr>
    <td><img src="assets/变更审核.png" alt="变更审核"></td>
    <td><img src="assets/自动化.png" alt="自动化"></td>
  </tr>
  <tr>
    <td><img src="assets/频道页.png" alt="频道"></td>
    <td><img src="assets/设置页.png" alt="设置"></td>
  </tr>
  <tr>
    <td><img src="assets/插件页.png" alt="插件"></td>
    <td></td>
  </tr>
</table>

---

## 架构概览

```mermaid
flowchart LR
    User[用户] --> WebUI[Web UI]
    User --> Channels[飞书 / 钉钉 / QQ / Telegram / 微信]
    WebUI --> Runner[ChatRunner]
    Channels --> Runner
    Automation[本地自动化调度器] --> Runner
    Runner --> Providers[Provider 层]
    Providers --> Codex[Codex CLI]
    Providers --> Claude[Claude Code]
    Providers --> CodeBuddy[CodeBuddy]
    Codex --> ThirdParty[自定义模型服务]
    Claude --> ThirdParty
    Providers --> MCP[MCP Servers]
    Runner --> Workspace[项目工作区]
    Runner --> Skills[技能]
    Runner --> Review[变更审核]
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

### 2. 配置 Provider 并开始对话

在 **设置 -> 提供商** 中选择至少一个 Provider。若显示“需下载”，点击“立即下载”并等待组件就绪，再配置对应账号或服务密钥。

| Provider | 运行方式 | 说明 |
|----------|---------|------|
| Codex | 使用已配置的原生 CLI 登录 / 配置，或开启 **自定义上游**，选择 Responses / Anthropic 格式并填写地址、密钥和模型映射 | 支持会话续聊、Sandbox、图片输入、MCP |
| Claude Code | 使用原生 CLI 配置，或开启 **Anthropic 兼容接口** 并填写服务配置；使用说明见 [Claude Code 文档](https://code.claude.com/docs/en/overview) | 支持会话续聊、权限模式、Agent 流式事件、MCP |
| CodeBuddy | 填写官方服务 API Key；留空时使用 CLI 已登录凭据 | 支持会话续聊、权限模式、Agent 流式事件、MCP，模型清单从服务获取 |

回到首页选择项目，或通过“打开文件夹”添加项目，然后发送消息。不需要项目时选择“不在项目中工作”。可在输入框输入 `/` 选择技能或额外项目，也可在插件页管理技能和 MCP 服务器。

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
| `codebuddy` | 可用 | 暂不支持 | 使用 Tencent Agent SDK，支持会话续聊、权限模式、Agent 流式事件、技能和 MCP |

Provider 和模型选择会在 Web UI 中保存；每个 Provider 会记住上次选择的模型。

## 兼容模型支持

在设置页选择与服务实际协议匹配的接入方式：

| Provider 设置 | 接入方式 |
|---------------|----------|
| Codex：自定义上游 → Responses | Codex 直接调用支持 OpenAI Responses API 的上游 |
| Codex：自定义上游 → Anthropic | 经 AnyBot 本地适配层转为 Anthropic Messages API |
| Claude Code：Anthropic 兼容接口 | 调用 Anthropic API 兼容服务 |

Anthropic 格式的 Base URL 建议项包括 DeepSeek、Kimi、MiniMax、阿里 Token Plan、VibeAPI、Ollama（本地）和 llama（本地）；也可手动填写其它服务地址。Codex 开启自定义上游后使用独立 `CODEX_HOME`；Claude Code 开启兼容接口后使用独立 `CLAUDE_CONFIG_DIR`，模型配置与全局配置隔离。

CodeBuddy 目前接入官方服务，仅需配置 API Key 或使用 CLI 登录凭据，不提供自定义兼容接口。

适用场景：

- 使用兼容模型驱动本机 Codex 或 Claude Code Agent。
- 在 Web UI 中选择稳定模型别名。
- 通过飞书、钉钉、QQ、Telegram、个人微信等频道远程调用本机 Agent。
- 配合项目工作区、技能和自动化任务完成代码分析、定时巡检、文档生成等任务。

Codex 开启 **自定义上游** 后，聊天框使用 `gpt-5.6-sol`、`gpt-mini`、`gpt-codex` 三个模型别名，实际上游模型由设置页映射决定。Claude Code 兼容接口按 Auto、Opus、Sonnet、Haiku / Fast、Subagent 等用途维护映射。

### Ollama / llama 本地模型

先启动本地模型服务，再在 Anthropic 接入配置中选择 Ollama 或 llama 并填写模型名。默认建议地址分别为 `http://localhost:11434?anybot=ollama` 和 `http://localhost:8080?anybot=llama`；使用自定义端口时保留 `anybot` 标识，AnyBot 会在发出请求前移除该标识。本地服务可留空 API Key。

Claude Code 连接上述本地后端时，聊天输入区的强度滑块会切换为 **0.0～1.0 的温度调节**，并自动处理本地模型不兼容的对话中间 system 消息。

---

## Web UI

Web UI 是当前推荐入口，主要能力包括：

- 多会话历史和 SQLite 持久化。
- 项目管理、项目会话、目录树、Git 仓库克隆与分支切换、默认工作目录设置。
- Markdown 渲染、代码复制、长消息折叠、上下文用量展示。
- HTML / Mermaid / SVG 预览卡片按需加载；HTML 预览高度自适应，Mermaid 图表串行渲染，减少多图表消息的渲染开销。
- 卡片菜单支持查看、复制代码，下载 HTML / SVG，或将 Mermaid 保存为高清 PNG；请求流程图、时序图等图示时默认引导模型输出 Mermaid。
- 侧边栏折叠 / 展开，首页项目菜单直接打开文件夹。
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

`weixin.botAgent` 留空时默认按当前应用版本生成，格式为 `AnyBot/<版本号>`。

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
| `codex` | 扫描 `~/.agents/skills/` 和 `$CODEX_HOME/skills/`（默认 `~/.codex/skills/`）；自定义上游模式将后者映射到运行数据目录下的 `codex/skills/` |
| `claude-code` | 用户技能位于 `$CLAUDE_CONFIG_DIR/skills/`，默认 `~/.claude/skills/`；兼容接口模式会将用户技能映射到运行数据目录下的 `claude-code/skills/` |
| `codebuddy` | `~/.codebuddy/skills/` |

插件页支持为 Codex / Claude Code 浏览和选择下载官方技能，来源分别为 `openai/skills` 和 `anthropics/skills`；Codex 官方技能安装到 `~/.agents/skills/`。技能启用 / 禁用会切换目录中的 `SKILL.md` 与 `SKILL.md.disabled`，因此也会影响使用同一技能目录的外部 CLI。

Web UI 的 `/` 入口按当前 Provider 展示技能和已实现的原生命令，项目则为全局可选。技能只注入本轮选择的技能名，不注入描述或文件内容；项目选择按项目名和绝对路径写入本轮提示词。项目会话中不重复展示当前项目，额外选择的项目才写入本轮提示词。频道命令与此菜单分开维护。

---

## MCP 服务器

MCP Server 在侧边栏 **插件** 页的「MCP 服务器」tab 中管理，配置保存在 `.data/app-settings.json`。当前支持粘贴 `mcpServers` JSON，或包含 `command` / `url` 的单个 Server 配置；支持 `stdio`、`http` 和 `sse` 类型。

启用的 MCP Server 会在应用启动时校验，也可以在插件页手动刷新、重新检查、查看日志、禁用或删除。同一份 MCP 配置可传给 Codex、Claude Code 和 CodeBuddy；Codex 使用 `mcp_servers` 配置，Claude Code 和 CodeBuddy 使用各自 SDK 的 `mcpServers` 配置。

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

源码运行可通过 `DATA_DIR` 或 `CODEX_DATA_DIR` 修改数据目录。应用不读取 `.env` 文件，常用配置推荐在 Web UI 中管理。数据导出默认对密钥脱敏；需要迁移密钥时，可携带 API token 调用 `/api/data/export?includeSecrets=1` 显式导出。

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
- `.data/codex/`：开启 Codex 自定义上游后的隔离 `CODEX_HOME`，包含 Codex 会话和技能数据。
- `.data/claude-code/`：开启 Claude Code Anthropic 兼容接口后的隔离 `CLAUDE_CONFIG_DIR`。

---

<details>
<summary><b>开发者文档：工作原理、项目结构和开发命令</b></summary>

### 工作原理

- `src/index.ts` 启动 Provider、Web 服务、已启用频道、桌面更新检查和 MCP Server 启动校验。
- `src/chat-runner.ts` 是 Web UI 和频道进入模型调用的统一编排层，负责 Provider session、项目工作目录、prompt、消息落库、流式事件和变更审核。
- `src/automation-scheduler.ts` 是本地自动化调度器，负责跳过重启后错过的任务、触发到期任务、记录运行历史并交付最终结果。
- Web 会话和频道会话都绑定 Provider 原生 session，后续消息通过续聊机制保持上下文。
- 启用的 MCP Server 会进入 Provider 调用配置，供 Codex、Claude Code 和 CodeBuddy 在任务中使用。
- 项目会话会把项目目录作为 Provider 工作目录；普通对话使用默认工作目录。
- Web UI 上传文件保存到工作目录下的 `tmp/uploads/`。
- Agent 回复中的本机图片路径和 `FILE: /path/to/file.ext` 只会在支持附件回传的频道中上传发送。
- 日志为单行 JSON，按日期和时间分片写入 `.run/`，默认保留 3 天。

### 项目结构

```text
AnyBot/
├── src/
│   ├── index.ts                    # 进程入口：启动 Provider、Web 服务、频道、MCP 校验和更新检查
│   ├── chat-runner.ts              # 会话编排：Provider 调用、流式事件、变更审核和消息落库
│   ├── automation-scheduler.ts     # 本地自动化调度、运行记录和结果交付
│   ├── app-settings.ts             # 应用设置读写
│   ├── sandbox-config.ts           # Provider sandbox / 权限模式配置
│   ├── mcp-config.ts               # MCP 配置转换（供三个 Provider 使用）
│   ├── cli-runtime/                # CLI 组件清单、按需下载和完整性校验
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

### 开发命令

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

### 添加新 Provider

1. 在 `src/providers/` 下实现 `IProvider`。
2. 在 `src/providers/index.ts` 中注册 Provider 工厂。
3. 在 `src/app-settings.ts` 和 `src/providers/index.ts` 中接入 Provider 专属运行配置。
4. 如需 Web UI slash 命令，实现 `listSlashCommands()`，并确保后端能可靠处理。

可参考 `src/providers/codex.ts` 和 `src/providers/claude-code.ts`。

</details>

---

## 更新日志

本次更新说明见 [release-notes.md](./release-notes.md)，历史版本记录见 [GitHub Releases](https://github.com/1935417243/AnyBot/releases)。

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交代码前请先运行 `npm run check`。

## License

MIT — 详见 [LICENSE](./LICENSE)。
