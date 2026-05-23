[中文](./README.md) | **English**

# AnyBot

Turn AI CLI tools into remotely accessible AI assistants — chat through the built-in **Web UI** in your browser, or message the AI running on your machine anytime via **Feishu Bot** / **QQ Bot** / **Telegram Bot** / **personal Weixin** on mobile or desktop.

Currently supports [OpenAI Codex CLI](https://github.com/openai/codex) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as Providers.

Supports **macOS**, **Linux**, and **Windows**.

---

## Features

- **Multi-Provider Architecture** — Pluggable AI backends; currently supports Codex CLI and Claude Code
- **Web UI** — Built-in local chat interface with Markdown rendering, code highlighting, and session management
- **Attachment Support** — Send files via the 📎 button, paste images, or drag-and-drop files in the Web UI (images + any file type, 50MB limit)
- **Multi-Platform Integration** — Feishu (long connection), QQ Bot (WebSocket), Telegram, and personal Weixin simultaneously — works on mobile too
- **Proactive Messaging** — Push messages to channel owners via API, ideal for automation and notifications
- **Skill Management** — Browse, enable/disable, and delete skills from the Web UI
- **Proxy Configuration** — Configure HTTP / SOCKS5 proxies in the Web UI, with save and connectivity testing
- **Session Continuity** — Reuses Provider's native sessions to preserve context; type `/new` to start fresh
- **Image Understanding** — Send images for multimodal conversations
- **File Delivery** — Generated images and files are automatically sent back to the chat
- **Model Switching** — Switch Provider and model anytime via `/provider` and `/model` commands in Web UI or chat
- **Chat Commands** — Unified `/help`, `/new`, `/provider`, `/model` commands across all channels
- **Background Mode** — Daemon mode support, ready on boot
- **Desktop Packages** — Electron packaging support; users install and configure everything from the Web UI

---

## Screenshots

| Chat Interface | Model Switching |
|:---:|:---:|
| ![Chat Interface](assets/webUI聊天展示.png) | ![Model Switching](assets/模型切换.png) |

| Provider Switching | Channel Management |
|:---:|:---:|
| ![Provider Switching](assets/提供商切换.png) | ![Channel Management](assets/频道管理.png) |

| Skill Management | Proxy Settings |
|:---:|:---:|
| ![Skill Management](assets/技能管理.png) | ![Proxy Settings](assets/代理.png) |

| Mobile Usage |
|:---:|
| ![Mobile Usage](assets/手机端演示.png) |

---

## Quick Start

### 1. Prerequisites

| Dependency | Minimum Version | Note |
|------------|----------------|------|
| [Node.js](https://nodejs.org/) | 18+ | Runtime |
| npm | Bundled with Node.js | Package manager |

Plus at least one configured Provider:

| Provider | Installation | Note |
|----------|-------------|------|
| [Codex CLI](https://github.com/openai/codex) | Installed through the `@openai/codex-sdk` dependency; local Codex login/configuration is still required | OpenAI's CLI tool |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Uses your locally logged-in `claude` command; the SDK is included as a project dependency | Anthropic's CLI tool |

<details>
<summary><b>Windows Installation</b></summary>

1. Download and install the LTS version from [nodejs.org](https://nodejs.org/).
2. Install Git for Windows, or use your existing Git environment.
3. Run the following commands in PowerShell / Windows Terminal.

</details>

<details>
<summary><b>Linux Installation</b></summary>

**Ubuntu / Debian:**

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**CentOS / RHEL / Fedora:**

```bash
curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
sudo yum install -y nodejs   # Use dnf for Fedora
```

**Using nvm (recommended, no sudo needed):**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc   # or source ~/.zshrc
nvm install --lts
```

</details>

<details>
<summary><b>macOS Installation</b></summary>

```bash
brew install node
```

</details>

### 2. Run From Source

```bash
git clone https://github.com/1935417243/AnyBot.git
cd AnyBot
npm install
npm start
```

Once started, open `http://localhost:19981` to use the Web UI. Provider, model, permissions, proxy, and channel settings are configured in the Web UI.

### 3. Background Mode

```bash
# Background (daemon)
npm run bot:start

# Check status
npm run bot:status

# Stop
npm run bot:stop
```

---

## Provider Architecture

AnyBot uses a pluggable Provider architecture where each AI CLI tool maps to a Provider implementation:

| Provider | Status | CLI Tool | Note |
|----------|--------|----------|------|
| `codex` | ✅ Available | [Codex CLI](https://github.com/openai/codex) | OpenAI's CLI, supports Sandbox mode |
| `claude-code` | ✅ Available | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Anthropic's CLI, supports session continuity and Sandbox mapping |

Switch the default Provider via the `PROVIDER=codex` or `PROVIDER=claude-code` environment variable, or switch anytime in the Web UI.

---

## Web UI

Built-in web chat interface, no extra deployment needed:

- Multi-session management with persistent history (SQLite)
- Markdown rendering + syntax highlighting + one-click copy
- Attachment support: upload files via 📎 button, paste images, or drag-and-drop files into the chat area (50MB limit)
  - Image attachments are automatically passed to the Provider for multimodal understanding
  - Non-image file paths are injected as context for the Provider to read and process
- Provider and model switching
- Channel configuration management (Feishu, QQ Bot, Telegram, Weixin)
- Skill management (browse, enable/disable, delete)
- Proxy settings (HTTP / SOCKS5, auth, connectivity testing)
- Dark theme

---

## Feishu Integration

Connected via Feishu's long connection mode — **no public callback URL required**.

### Feishu Setup

After creating an app on the [Feishu Open Platform](https://open.feishu.cn/):

1. Enable the **Bot** capability
2. Enable **Long Connection** event subscription
3. Subscribe to the `im.message.receive_v1` event
4. Grant **Send Message** permission
5. For image messages, also grant **Read Message Resource** permissions
6. Publish the app

### Connection Configuration

Channel configs are stored in `.data/channels.json`. Three ways to manage:

| Method | Description |
|--------|-------------|
| **Web UI** | Configure each channel in the settings page after starting the service |
| **REST API** | `GET /api/channels` to view, `PUT /api/channels/:type` to update |
| **Manual Edit** | Edit `.data/channels.json` directly |

<details>
<summary><b>channels.json Full Field Reference</b></summary>

```jsonc
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxxx",
    "appSecret": "xxxx",
    "groupChatMode": "mention",   // "mention" (reply only when @bot) or "all" (reply to all messages)
    "botOpenId": "ou_xxxx",       // Optional; used in mention mode to detect @bot precisely
    "ackReaction": "OK",          // Reaction emoji on message receipt; leave empty to disable
    "ownerChatId": "oc_xxxx"      // Optional; target chat ID for /api/send proactive messaging
  },
  "qqbot": {
    "enabled": true,
    "appId": "your_app_id",
    "appSecret": "your_app_secret",
    "ownerChatId": ""             // Optional; target chat ID for proactive messaging
  },
  "telegram": {
    "enabled": true,
    "token": "1234567890:AA...",
    "ownerChatId": ""             // Optional; target chat ID for proactive messaging
  },
  "weixin": {
    "enabled": true,
    "accountId": "",              // Auto-filled after QR login
    "token": "",                  // Auto-filled after QR login
    "baseUrl": "https://ilinkai.weixin.qq.com",
    "botType": "3",
    "botAgent": "AnyBot/0.1.0",
    "ownerChatId": ""             // Auto-filled from QR user or first inbound message
  }
}
```

</details>

### Usage

- **Direct Message** — Message the bot directly
- **Group Chat** — By default, replies only when @mentioned (configurable to reply to all)
- Send images — Automatically downloaded and forwarded to the Provider
- Images/files in replies are automatically uploaded back to Feishu (max 30MB per file)
- All chat commands supported (see [Chat Commands](#chat-commands) below)

---

## QQ Bot Integration

Connected via the QQ Open Platform WebSocket gateway, supporting channels, group chats, and direct messages.

### QQ Setup

After creating a bot app on the [QQ Open Platform](https://q.qq.com/):

1. Obtain the **App ID** and **App Secret**
2. Configure the bot's message receiving permissions

### Connection Configuration

Same as Feishu — configure via Web UI, REST API, or the `qqbot` field in `.data/channels.json` with App ID / App Secret.

### Usage

- **Channel Messages** — @mention the bot in QQ channels
- **Group Chat** — @mention the bot in groups
- **Direct Message** — Message the bot directly
- All chat commands supported (see [Chat Commands](#chat-commands) below)

---

## Telegram Integration

Connected through the Telegram Bot API using long polling — **no webhook or public callback URL required**.

### Telegram Setup

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Run `/newbot` to create a bot
3. Save the generated **Bot Token**
4. If you want to use it in groups, add the bot to the group and @mention it in messages

### Connection Configuration

Like other channels, configure `telegram.token` through one of these methods:

| Method | Description |
|--------|-------------|
| **Web UI** | Open the "Channels" page, choose Telegram, and enter the Bot Token |
| **REST API** | `GET /api/channels` to view, `PUT /api/channels/telegram` to update |
| **Manual Edit** | Edit the `telegram` field in `.data/channels.json` directly |

### Usage

- **Direct Message** — Message the bot directly
- **Group Chat** — @mention the bot in a group before sending a message
- **Image Messages** — Images are downloaded and passed to the Provider; captions are included as context
- **Long Replies** — Replies longer than Telegram's message limit are automatically split into multiple messages
- All chat commands supported (see [Chat Commands](#chat-commands) below)

---

## Weixin Integration

Connected through Tencent's Weixin channel protocol. AnyBot handles QR login, long-poll inbound messages, and outbound replies directly; OpenClaw is not required.

### Connection Configuration

1. Enable "Weixin" in the Web UI Channels page, or set `weixin.enabled` to `true` in `.data/channels.json`
2. Restart AnyBot
3. Scan the QR code printed in the terminal with personal Weixin
4. After login, `weixin.accountId`, `weixin.token`, and `ownerChatId` are saved automatically

If the login session expires, clear `weixin.token` and restart the service to scan again.

### Usage

- **Direct Message** — Send text, image, and file messages through the bound personal Weixin account
- **Proactive Messaging** — `/api/send` supports `{ "channel": "weixin", "message": "..." }`
- Images are downloaded and passed to the Provider for multimodal understanding; local image paths and `FILE:` replies are encrypted, uploaded to Weixin CDN, and sent back
- All chat commands supported (see [Chat Commands](#chat-commands) below)

---

## Chat Commands

All channels (Feishu, QQ, Telegram, Weixin) support the following commands:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/new` | Start a new session, reset current context |
| `provider` or `/provider` | View available providers and current selection, listed as `1`, `2`, etc. |
| `provider <number>` | Switch provider, e.g. `provider 1` |
| `model` or `/model` | View available models for the current provider, listed as `1`, `2`, etc. |
| `model <number>` | Switch model, e.g. `model 1` |
| `workspace` or `/workspace` | View workspaces; item 1 is the default workdir, followed by the project list |
| `workspace <number>` | Switch workspace and start a new conversation, e.g. `workspace 1` |

When switching providers, the last-used model for each provider is remembered and automatically restored when switching back.

---

## Skill Management

Manage skills via the Web UI (reads `SKILL.md` files from the Provider's skill directory):

- Browse all installed skills with names and descriptions
- Enable/disable specific skills
- Delete unwanted skills
- Quickly open the skill folder in your file manager

After switching Providers, the skill list automatically switches to the corresponding directory:

| Provider | Skill Directory |
|----------|----------------|
| `codex` | `$CODEX_HOME/skills/`, or `~/.codex/skills/` when unset |
| `claude-code` | `$CLAUDE_CONFIG_DIR/skills/`, or `~/.claude/skills/` when unset |

---

## Proxy Configuration

Proxy support is currently disabled. Existing settings remain in `.data/proxy.json`, but startup, saving settings, and importing settings no longer inject `HTTP_PROXY` / `HTTPS_PROXY` into Provider processes.

### Supported Capabilities

- `HTTP` / `SOCKS5` proxying is not active for now
- The Web UI shows that proxy support is temporarily disabled
- Old proxy settings are preserved for possible migration or restore after the proxy design is revisited

### Configuration Methods

| Method | Description |
|--------|-------------|
| **Web UI** | Proxy controls are disabled |
| **REST API** | `GET /api/proxy` returns `featureEnabled: false`; `PUT /api/proxy` does not enable proxying; `POST /api/proxy/test` reports that the feature is disabled |
| **Manual Edit** | `.data/proxy.json` can keep old settings, but they are inactive |

---

## Environment Variables

AnyBot no longer reads `.env` files. Common settings such as provider, model, and permissions are stored in `.data/*.json` and can be changed in the Web UI. The variables below remain as compatible system environment variable overrides; pass them in your launch command or service configuration when needed.

### General

| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER` | `codex` | Provider to use: `codex`, `claude-code` |
| `WEB_PORT` | `19981` | Web UI port |
| `LOG_LEVEL` | `info` | Log level: `debug` / `info` / `warn` / `error` |
| `LOG_INCLUDE_CONTENT` | `false` | Include message content in logs (for debugging) |
| `LOG_INCLUDE_PROMPT` | `false` | Include full prompt in logs (for debugging) |
| `LOG_RETENTION_DAYS` | `3` | Log retention in days; older logs are deleted automatically |

### Codex CLI

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_BIN` | Bundled Codex CLI | Optional external Codex CLI executable path. Empty or `codex` prefers the bundled native binary |
| `CODEX_MODEL` | — | Override the model used |
| `CODEX_SANDBOX` | `workspace-write` | Safety mode: `read-only` / `workspace-write` / `danger-full-access` |
| `CODEX_SYSTEM_PROMPT` | — | Custom system prompt appended to the built-in prompt |
| `CODEX_WORKDIR` | Current directory | Working directory |

### Claude Code

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_CODE_BIN` | — | Optional; leave empty to use the Claude Code native binary installed with the SDK. Set a full executable path only when using an external CLI |
| `ANTHROPIC_API_KEY` | — | Optional; only enable this if you want API key authentication |
| `CLAUDE_AGENT_MODEL` | — | Override the model used |
| `CLAUDE_AGENT_PERMISSION_MODE` | — | Override permission mode: `default` / `acceptEdits` / `bypassPermissions` / `plan` / `dontAsk` / `auto` |
| `CLAUDE_AGENT_MAX_TURNS` | — | Maximum agent loop cycles |

Note: when `CLAUDE_CODE_BIN` is set, the SDK executes that file directly; it does not read shell functions or aliases. If your `claude` command is a shell function wrapper, save equivalent logic as a script and point `CLAUDE_CODE_BIN` to that script.

---

## REST API

The Web UI communicates with the backend through these APIs, which can also be called directly:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List sessions |
| `POST` | `/api/sessions` | Create a new session |
| `GET` | `/api/sessions/:id` | Get session details (with messages) |
| `DELETE` | `/api/sessions/:id` | Delete a session |
| `POST` | `/api/sessions/:id/messages` | Send a message with optional attachments `{ "content": "...", "attachments": [...] }` |
| `POST` | `/api/upload` | Upload a file (50MB limit), returns file path and type |
| `POST` | `/api/send` | Push a message via channel bot `{ "channel": "feishu", "message": "..." }` |
| `GET` | `/api/model-config` | Get current model config (with Provider info) |
| `PUT` | `/api/model-config` | Switch model `{ "modelId": "..." }` |
| `GET` | `/api/providers` | List available Providers |
| `PUT` | `/api/providers/current` | Switch Provider `{ "provider": "codex" }` |
| `GET` | `/api/channels` | Get channel configuration |
| `PUT` | `/api/channels/:type` | Update channel configuration |
| `GET` | `/api/proxy` | Get proxy configuration |
| `PUT` | `/api/proxy` | Update proxy configuration |
| `POST` | `/api/proxy/test` | Test proxy connectivity |
| `GET` | `/api/skills` | List skills |
| `PUT` | `/api/skills/:id/toggle` | Enable/disable a skill `{ "enabled": true }` |
| `DELETE` | `/api/skills/:id` | Delete a skill |
| `POST` | `/api/skills/open-folder` | Open the skill directory in file manager |

---

## Proactive Messaging

Use the `/api/send` endpoint to have channel bots proactively send messages to the owner, useful for automation, alerts, and notifications:

```bash
curl -X POST http://localhost:19981/api/send \
  -H "Content-Type: application/json" \
  -d '{"channel": "telegram", "message": "Deployment complete ✅"}'
```

`channel` can be `feishu`, `qqbot`, `telegram`, or `weixin`. You need to set `ownerChatId` in the corresponding channel configuration.

---

## How It Works

- Each chat (Web session / Feishu chat / QQ chat) is bound to a Provider session; subsequent messages maintain context through session continuity
- Session bindings are stored in SQLite; channel bindings are automatically rebuilt after process restart
- Feishu messages receive a reaction (default ✅) to acknowledge receipt, then wait for the full Provider reply
- QQ Bot receives messages via WebSocket gateway with automatic OAuth2 token management
- When proxy is enabled, Provider and Telegram outbound requests go through the global proxy; Feishu, QQ, Weixin, and local addresses bypass it by default
- Text, image, and attachment messages are supported; other message types receive a prompt
- Web UI attachments are uploaded via multer middleware to `tmp/uploads/` under the working directory
- `/new` resets the current session, `/provider` and `/model` switch provider and model, `/help` shows command help
- Image messages are downloaded to a temp directory and passed to the Provider
- Local image paths in replies (`![alt](/path.png)` or bare paths) are automatically uploaded
- `FILE: /path/to/file.ext` in replies is sent as a file
- Logs are single-line JSON, written to the `.run/` directory, rotated every 10 minutes

---

## Project Structure

```
AnyBot/
├── src/
│   ├── index.ts                    # Process entry: starts Providers, Web server, and channels
│   ├── chat-runner.ts              # Chat orchestration: Provider calls, stream events, change review, persistence
│   ├── app-settings.ts             # App settings storage and environment compatibility layer
│   ├── sandbox-config.ts           # Provider sandbox / permission mode configuration
│   ├── prompt.ts                   # Shared system prompt construction
│   ├── shared.ts                   # Shared runtime config, IDs, and path helpers
│   ├── logger.ts                   # Structured logging
│   ├── lark.ts                     # Feishu API (messages, files, images)
│   ├── message.ts                  # Message parsing (input/output)
│   ├── proxy.ts                    # Proxy compatibility logic
│   ├── types.ts                    # Common type definitions
│   ├── utils/                      # Common utilities
│   ├── providers/                  # Provider abstraction layer
│   │   ├── types.ts                # IProvider interface definition
│   │   ├── index.ts                # ProviderManager (factory + registry)
│   │   ├── codex.ts                # Codex CLI Provider implementation
│   │   ├── claude-code.ts          # Claude Code Provider implementation
│   │   └── claude-code-agent-events.ts # Claude Code Agent event conversion
│   ├── channels/                   # Weixin, Telegram, Feishu, QQ, and other channel integrations
│   │   ├── index.ts                # ChannelManager
│   │   ├── commands.ts             # Channel chat commands (/help, /provider, /model, etc.)
│   │   ├── config.ts               # channels.json read/write
│   │   ├── feishu.ts               # Feishu channel implementation
│   │   ├── qqbot.ts                # QQ Bot channel implementation
│   │   ├── telegram.ts             # Telegram channel implementation
│   │   ├── weixin.ts               # Weixin channel implementation
│   │   └── types.ts                # Channel interface definitions (incl. sendToOwner)
│   ├── web/                        # Express API, SQLite storage, and Web UI static resources
│   │   ├── server.ts               # Static file server and /api mounting
│   │   ├── api.ts                  # Lightweight API composition entry
│   │   ├── db.ts                   # SQLite sessions, messages, and project storage
│   │   ├── model-config.ts         # Provider + model configuration
│   │   ├── proxy-config.ts         # proxy.json read/write
│   │   ├── skills.ts               # Provider-isolated skill scanning and state management
│   │   ├── slash-items.ts          # Web UI slash picker data source
│   │   ├── agent-stream.ts         # Agent stream event shaping
│   │   ├── change-review.ts        # Change review snapshots and state
│   │   ├── events.ts               # Web event broadcasting
│   │   ├── routes/                 # Domain routes for request/response, validation, and status codes
│   │   │   ├── sessions.ts         # Session list, creation, details, and deletion
│   │   │   ├── messages.ts         # Web chat send, streaming response, and cancellation
│   │   │   ├── send.ts             # Proactive channel messaging
│   │   │   ├── providers.ts        # Provider list and switching
│   │   │   ├── settings.ts         # Model and app settings
│   │   │   ├── channels.ts         # Channel configuration
│   │   │   ├── skills.ts           # Skills and slash items
│   │   │   ├── projects.ts         # Project list and directory tree
│   │   │   ├── files.ts            # File upload and access
│   │   │   ├── proxy.ts            # Proxy configuration API
│   │   │   ├── data.ts             # Local data import/export
│   │   │   ├── events.ts           # SSE / event API
│   │   │   ├── change-reviews.ts   # Change review API
│   │   │   └── desktop-update.ts   # Desktop update checks
│   │   ├── services/               # Reusable route business logic and pure helpers
│   │   └── public/                 # No-build browser HTML / CSS / ES modules
│   │       ├── index.html
│   │       ├── styles/
│   │       └── scripts/
│   │           └── app/            # app, chat, sidebar, settings, channels, skills, ui, utils layers
│   └── agent/                      # Agent prompt templates
│       └── md_files/
│           ├── AGENTS.md           # Agent behavior rules
│           ├── BOOTSTRAP.md        # First-run bootstrap
│           ├── MEMORY.md           # Long-term memory template
│           └── PROFILE.md          # Agent identity & user profile
├── electron/                       # Electron desktop entry and after-pack handling
├── scripts/                        # Build, release asset copy, and daemon helper scripts
├── installer/windows/              # Windows installer configuration
├── build/icons/                    # Desktop app icons
├── assets/                         # README screenshots and showcase assets
└── package.json
```

---

## Adding a New Provider

AnyBot's Provider architecture is extensible. Adding a new CLI tool takes just three steps:

1. **Implement the `IProvider` interface** — Create a new file under `src/providers/`, implementing `listModels()` and `run()`
2. **Register with the factory** — Add a new entry to `providerFactories` in `src/providers/index.ts`
3. **Add environment variables** — Read the corresponding env vars in `getProviderConfig()` in `src/index.ts`

Refer to `src/providers/codex.ts` and `src/providers/claude-code.ts` as implementation templates.

---

## License

MIT
