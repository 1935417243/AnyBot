# AnyBot

把 AI CLI 工具变成可远程使用的 AI 助手——通过内置 **Web UI** 在浏览器里对话，或通过 **飞书机器人** / **QQ 机器人** / **Telegram 机器人** 在手机 / 桌面端随时向你这台机器上的 AI 发消息。

目前支持 [OpenAI Codex CLI](https://github.com/openai/codex)、[Google Gemini CLI](https://github.com/google-gemini/gemini-cli) 和 [Cursor CLI](https://docs.cursor.com/cli) 作为 Provider，架构已为接入更多 CLI 工具（Claude Code 等）做好准备。

支持 **macOS** 和 **Linux**。

---

## 特性

- **多 Provider 架构** — 可插拔的 AI CLI 后端，当前支持 Codex CLI、Gemini CLI 和 Cursor CLI，未来可扩展更多
- **Web UI** — 开箱即用的本地聊天界面，支持 Markdown 渲染、代码高亮、会话管理
- **多平台集成** — 同时支持飞书（长连接）、QQ 机器人（WebSocket）、Telegram，手机上也能用
- **技能管理** — 在 Web UI 中浏览、启用 / 禁用 / 删除技能
- **会话续聊** — 复用 Provider 原生 session，上下文不丢失；输入 `/new` 开启新会话
- **图片理解** — 发送图片，支持多模态对话
- **文件回传** — 生成的图片、文件自动发送回聊天
- **模型切换** — 在 Web UI 或聊天中通过 `/provider`、`/model` 命令随时切换 Provider 和模型
- **聊天命令** — 所有频道统一支持 `/help`、`/new`、`/provider`、`/model` 命令
- **后台运行** — 支持 daemon 模式，开机即用
- **一键配置** — 交互式 `setup.sh` 引导完成所有配置，自动检测依赖、选择 Provider

---

## 快速开始

### 1. 前置依赖

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| [Node.js](https://nodejs.org/) | 18+ | 运行环境 |
| npm | 随 Node.js 附带 | 包管理 |

以及至少安装一个 Provider CLI：

| Provider | 安装方式 | 说明 |
|----------|---------|------|
| [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` | OpenAI 的 CLI 工具 |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | 参见 [官方文档](https://github.com/google-gemini/gemini-cli) | Google 的 CLI 工具 |
| [Cursor CLI](https://docs.cursor.com/cli) | Cursor 设置中启用 `agent` 命令 | Cursor 编辑器的 Agent CLI |

<details>
<summary><b>Linux 安装指南</b></summary>

**Ubuntu / Debian：**

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**CentOS / RHEL / Fedora：**

```bash
curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
sudo yum install -y nodejs   # Fedora 用 dnf
```

**使用 nvm（推荐，不需要 sudo）：**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc   # 或 source ~/.zshrc
nvm install --lts
```

</details>

<details>
<summary><b>macOS 安装指南</b></summary>

```bash
brew install node
```

</details>

### 2. 克隆与配置

```bash
git clone https://github.com/1935417243/AnyBot.git
cd AnyBot
sh setup.sh
```

`setup.sh` 会引导你完成：
- 检测操作系统与基础依赖（Node.js、npm）
- **选择默认 Provider**（Codex CLI / Gemini CLI / Cursor CLI）
- 检测对应 CLI 是否已安装，并提供安装指引
- 设置工作目录
- 配置安全模式（Codex: Sandbox 模式 / Gemini: Approval Mode）
- 配置 Web UI 端口
- 生成 `.env` 配置文件（包含所有 Provider 的配置）
- 安装 npm 依赖

### 3. 启动

```bash
# 前台运行
npm start

# 后台运行（daemon）
npm run bot:start

# 查看状态
npm run bot:status

# 停止
npm run bot:stop
```

启动后打开 `http://localhost:19981` 即可使用 Web UI。

### 4. 手动配置（可选）

如果不想使用引导脚本：

```bash
cp .env.example .env
# 编辑 .env，设置 PROVIDER 和对应 CLI 的配置
npm install
npm start
```

---

## Provider 架构

AnyBot 使用可插拔的 Provider 架构，每个 AI CLI 工具对应一个 Provider 实现：

| Provider | 状态 | CLI 工具 | 说明 |
|----------|------|---------|------|
| `codex` | ✅ 可用 | [Codex CLI](https://github.com/openai/codex) | OpenAI 的 CLI，支持 Sandbox 模式 |
| `gemini-cli` | ✅ 可用 | [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Google 的 CLI，支持会话续聊 |
| `cursor-cli` | ✅ 可用 | [Cursor CLI](https://docs.cursor.com/cli) | Cursor 的 Agent CLI，支持会话续聊、Sandbox |
| `claude-code` | 🔜 计划中 | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Anthropic 的 CLI |

通过环境变量 `PROVIDER=codex`、`PROVIDER=gemini-cli` 或 `PROVIDER=cursor-cli` 切换默认 Provider，也可在 Web UI 中随时切换。

---

## Web UI

内置的 Web 聊天界面，无需额外部署：

- 多会话管理，历史记录持久化（SQLite）
- Markdown 渲染 + 代码语法高亮 + 一键复制
- Provider 和模型切换
- 频道配置管理（飞书、QQ 机器人、Telegram）
- 技能管理（浏览、启用 / 禁用、删除）
- 深色主题

---

## 飞书集成

通过飞书长连接模式接入，**无需公网回调地址**。

### 飞书侧配置

在 [飞书开放平台](https://open.feishu.cn/) 创建应用后：

1. 开启 **机器人** 能力
2. 开启 **长连接模式** 的事件订阅
3. 订阅事件 `im.message.receive_v1`
4. 授予 **发送消息** 权限
5. 如需处理图片消息，还需授予 **读取消息资源** 相关权限
6. 发布应用

### 连接配置

频道配置保存在 `.data/channels.json`，有三种方式管理：

| 方式 | 说明 |
|------|------|
| **Web UI** | 启动服务后在设置页面中配置 App ID / App Secret |
| **REST API** | `GET /api/channels` 查看、`PUT /api/channels/:type` 更新 |
| **手动编辑** | 直接编辑 `.data/channels.json` |

<details>
<summary><b>channels.json 完整字段说明</b></summary>

```jsonc
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxxx",
    "appSecret": "xxxx",
    "groupChatMode": "mention",   // "mention"（仅 @机器人时回复）或 "all"（所有消息都回复）
    "botOpenId": "ou_xxxx",       // 可选；mention 模式下用于精确判断是否 @了机器人
    "ackReaction": "OK"           // 收到消息后的 reaction 表情，留空可关闭
  },
  "qqbot": {
    "enabled": true,
    "appId": "your_app_id",
    "appSecret": "your_app_secret"
  }
}
```

</details>

### 使用方式

- **私聊** — 直接发消息给机器人
- **群聊** — 默认仅 @ 机器人时回复（可改为回复所有消息）
- 发送图片 — 自动下载并交给 Provider 处理
- 回复中的图片 / 文件会自动上传回飞书（单文件上限 30MB）
- 支持所有聊天命令（见下方[聊天命令](#聊天命令)）

---

## QQ 机器人集成

通过 QQ 开放平台 WebSocket 网关接入，支持频道、群聊和私聊。

### QQ 侧配置

在 [QQ 开放平台](https://q.qq.com/) 创建机器人应用后：

1. 获取 **App ID** 和 **App Secret**
2. 配置机器人的消息接收权限

### 连接配置

与飞书相同，通过 Web UI、REST API 或 `.data/channels.json` 中的 `qqbot` 字段配置 App ID / App Secret。

### 使用方式

- **频道消息** — 在 QQ 频道中 @ 机器人
- **群聊** — 在群中 @ 机器人发送消息
- **私聊** — 直接给机器人发消息
- 支持所有聊天命令（见下方[聊天命令](#聊天命令)）

---

## 聊天命令

所有频道（飞书、QQ、Telegram）统一支持以下 `/` 命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示可用命令列表 |
| `/new` | 开启新窗口，重置当前会话 |
| `/provider` | 查看可用供应商列表及当前选择 |
| `/provider <名称>` | 切换供应商，例如 `/provider gemini-cli` |
| `/model` | 查看当前供应商的可用模型列表 |
| `/model <名称>` | 切换模型，例如 `/model gpt-5.3-codex` |

切换供应商时会自动记住每个供应商上次使用的模型，再次切回时自动恢复。

---

## 技能管理

通过 Web UI 管理技能（读取 Provider 对应的技能目录下的 `SKILL.md` 文件）：

- 浏览所有已安装技能，查看名称与描述
- 启用 / 禁用指定技能
- 删除不需要的技能
- 快速打开技能所在文件夹

切换 Provider 后，技能列表自动切换到对应 Provider 的技能目录：

| Provider | 技能目录 |
|----------|---------|
| `codex` | `~/.codex/skills/` |
| `gemini-cli` | `~/.gemini/` |
| `claude-code` | `~/.claude/` |
| `cursor-cli` | `./.cursor/rules/` |

---

## 常见问题排查

### Cursor CLI 在 Linux 上报 Sandbox 错误

**错误信息：**

```
Sandbox mode is enabled but not available on this system.
Sandbox failed to start, possibly due to AppArmor configuration.
```

**原因：** Cursor CLI 的 Sandbox 模式依赖内核级进程隔离，在 Linux（尤其是 Ubuntu）上需要 AppArmor 正确配置。VPS、Docker 容器或非桌面 Linux 环境通常不满足条件，导致沙盒无法启动。macOS 使用不同的沙盒机制，不受影响。

**解决方法：** 在 Linux 服务器上执行以下命令，关闭 Cursor CLI 的全局沙盒配置：

```bash
agent sandbox disable
```

AnyBot 已在代码层面做了处理——在 Linux 上会自动以 `--sandbox disabled` 运行 Cursor CLI，无需额外配置。如果仍然报错，请确认已执行上述命令。

---

## 环境变量

在 `.env` 文件中配置（通过 `setup.sh` 生成或手动从 `.env.example` 复制）。

### 通用配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROVIDER` | `codex` | 使用的 Provider：`codex`、`gemini-cli`、`cursor-cli` |
| `WEB_PORT` | `19981` | Web UI 端口 |
| `LOG_LEVEL` | `info` | 日志级别：`debug` / `info` / `warn` / `error` |
| `LOG_INCLUDE_CONTENT` | `false` | 日志中包含消息内容（调试用） |
| `LOG_INCLUDE_PROMPT` | `false` | 日志中包含完整 prompt（调试用） |

### Codex CLI 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CODEX_BIN` | `codex` | Codex CLI 可执行文件路径 |
| `CODEX_MODEL` | — | 覆盖使用的模型 |
| `CODEX_SANDBOX` | `read-only` | 安全模式：`read-only` / `workspace-write` / `danger-full-access` |
| `CODEX_SYSTEM_PROMPT` | — | 追加到内置提示词后面的自定义系统提示词 |
| `CODEX_WORKDIR` | 当前目录 | 工作目录 |

### Gemini CLI 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GEMINI_CLI_BIN` | `gemini` | Gemini CLI 可执行文件路径 |
| `GEMINI_CLI_MODEL` | — | 覆盖使用的模型 |
| `GEMINI_CLI_APPROVAL_MODE` | `yolo` | 操作审批模式：`yolo` / `auto-edit` / `confirm` |

### Cursor CLI 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CURSOR_CLI_BIN` | `agent` | Cursor Agent CLI 可执行文件路径 |
| `CURSOR_CLI_WORKSPACE` | — | 工作区路径（可选，默认使用工作目录） |
| `CURSOR_API_KEY` | — | API Key（可选，也可使用已登录的 Cursor 账号） |

---

## REST API

Web UI 通过以下 API 与后端交互，也可以直接调用：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/sessions` | 获取会话列表 |
| `POST` | `/api/sessions` | 创建新会话 |
| `GET` | `/api/sessions/:id` | 获取会话详情（含消息） |
| `DELETE` | `/api/sessions/:id` | 删除会话 |
| `POST` | `/api/sessions/:id/messages` | 发送消息 `{ "content": "..." }` |
| `GET` | `/api/model-config` | 获取当前模型配置（含 Provider 信息） |
| `PUT` | `/api/model-config` | 切换模型 `{ "modelId": "..." }` |
| `GET` | `/api/providers` | 获取可用 Provider 列表 |
| `PUT` | `/api/providers/current` | 切换 Provider `{ "provider": "codex" }` |
| `GET` | `/api/channels` | 获取频道配置 |
| `PUT` | `/api/channels/:type` | 更新频道配置 |
| `GET` | `/api/skills` | 获取技能列表 |
| `PUT` | `/api/skills/:id/toggle` | 启用 / 禁用技能 `{ "enabled": true }` |
| `DELETE` | `/api/skills/:id` | 删除技能 |
| `POST` | `/api/skills/open-folder` | 在文件管理器中打开技能目录 |

---

## 工作原理

- 每个聊天（Web 会话 / 飞书 chat / QQ 聊天）绑定一个 Provider session，后续消息通过续聊机制保持上下文
- 会话绑定关系保存在 SQLite 中；各频道的绑定在进程重启后自动重建
- 飞书消息先加一个 reaction（默认 ✅）表示已收到，再等待 Provider 完整回复
- QQ 机器人通过 WebSocket 网关接收消息，OAuth2 自动管理 Token
- 支持文本和图片消息；其它消息类型会收到提示
- `/new` 重置当前会话，`/provider` 和 `/model` 切换供应商和模型，`/help` 查看命令帮助
- 图片消息先下载到临时目录，通过 Provider 传入
- 回复中的本机图片路径（`![alt](/path.png)` 或纯路径）会自动上传
- 回复中的 `FILE: /path/to/file.ext` 会作为文件发送
- 日志为单行 JSON，写入 `.run/` 目录，按 10 分钟切分

---

## 项目结构

```
AnyBot/
├── src/
│   ├── index.ts            # 主入口，会话状态管理
│   ├── providers/           # Provider 抽象层
│   │   ├── types.ts        # IProvider 接口定义
│   │   ├── index.ts        # ProviderManager（工厂 + 注册）
│   │   ├── codex.ts        # Codex CLI Provider 实现
│   │   ├── gemini-cli.ts   # Gemini CLI Provider 实现
│   │   └── cursor-cli.ts   # Cursor CLI Provider 实现
│   ├── lark.ts             # 飞书 API（消息、文件、图片）
│   ├── logger.ts           # 结构化日志
│   ├── message.ts          # 消息解析（输入输出）
│   ├── prompt.ts           # 系统提示词构建
│   ├── types.ts            # 类型定义
│   ├── channels/           # 频道管理
│   │   ├── index.ts        # ChannelManager
│   │   ├── commands.ts     # 统一聊天命令处理（/help, /provider, /model 等）
│   │   ├── feishu.ts       # 飞书频道实现
│   │   ├── qqbot.ts        # QQ 机器人频道实现
│   │   ├── telegram.ts     # Telegram 频道实现
│   │   ├── config.ts       # channels.json 读写
│   │   └── types.ts        # 频道接口定义
│   ├── web/                # Web 层
│   │   ├── server.ts       # Express 服务
│   │   ├── api.ts          # REST API
│   │   ├── db.ts           # SQLite 持久化
│   │   ├── model-config.ts # Provider + 模型配置
│   │   ├── skills.ts       # 技能管理
│   │   └── public/         # 前端静态文件
│   └── agent/              # Agent 模板文件
│       └── md_files/
│           ├── AGENTS.md   # Agent 行为规则
│           ├── BOOTSTRAP.md # 首次启动引导
│           ├── MEMORY.md   # 长期记忆模板
│           └── PROFILE.md  # Agent 身份与用户档案
├── scripts/                # daemon 控制脚本
│   ├── bot-start.sh
│   ├── bot-stop.sh
│   └── bot-status.sh
├── setup.sh                # 交互式配置引导
├── .env.example            # 环境变量模板
└── package.json
```

---

## 添加新 Provider

AnyBot 的 Provider 架构是可扩展的，添加新 CLI 工具只需三步：

1. **实现 `IProvider` 接口** — 在 `src/providers/` 下创建新文件，实现 `listModels()` 和 `run()` 方法
2. **注册到工厂** — 在 `src/providers/index.ts` 的 `providerFactories` 中添加新条目
3. **添加环境变量** — 在 `src/index.ts` 的 `getProviderConfig()` 中读取对应的环境变量

可参考 `src/providers/codex.ts` 和 `src/providers/gemini-cli.ts` 作为实现模板。

---

## License

MIT
