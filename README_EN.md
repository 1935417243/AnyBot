[中文](./README.md) | **English**

# AnyBot

![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Stars](https://img.shields.io/github/stars/1935417243/AnyBot)
![Release](https://img.shields.io/github/v/release/1935417243/AnyBot)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)

AnyBot is a simple, ready-to-use local AI Coding Agent console and remote entry point.

Use the macOS/Windows desktop app, or chat bots for Weixin, QQ, Telegram, and Feishu, to call and manage local Agents anytime. Codex CLI and Claude Code are optional: without installing them, you can connect directly to compatible model Providers such as DeepSeek and OpenAI. If they are installed locally, AnyBot can call Codex CLI or Claude Code directly. Compatible models and model mappings configured through AnyBot only take effect inside AnyBot and stay fully isolated from the global configuration of the native Codex CLI and Claude Code.

The desktop app supports **macOS** and **Windows**; running from source supports **macOS**, **Linux**, and **Windows**.

---

## Features

- **Multiple Providers**: switch between Codex CLI and Claude Code from the Web UI or channel commands.
- **Compatible model access**: configure compatible model Providers such as DeepSeek and OpenAI, plus model mappings inside AnyBot. These mappings only take effect inside AnyBot and stay fully isolated from the global configuration of the native Codex CLI and Claude Code.
- **Agent Web UI**: local chat UI with Markdown, code highlighting, streamed Agent events, cancellation, context compaction, and persistent history.
- **Project workspaces**: manage projects in the sidebar; project sessions use the project path as the Provider working directory.
- **Skills and slash menu**: browse, enable, disable, and delete skills; the `/` picker shows Provider-specific skills and commands.
- **Attachments**: upload by button, pasted images, or drag and drop. The upload limit is 50MB per file. Image support depends on the current Provider.
- **Change review**: after Agent edits, inspect diffs and approve or revert changes from the Web UI.
- **Channel integrations**: Feishu long connection, QQ Bot WebSocket, Telegram long polling, and personal Weixin.
- **Proactive messaging**: send notifications to configured channel owners through `/api/send`.
- **Automations**: run local Agent tasks on minute, daily, weekly, or Cron schedules; activity stays visible in the Web UI, and final results can be saved locally or delivered to enabled channels.
- **Desktop app**: Electron shell, tray support, login item support, and in-app updates for Windows installer builds.

---

## Screenshots

| New Chat | Automations |
|:---:|:---:|
| ![New Chat](assets/主页.png) | ![Automations](assets/自动化.png) |

| Skills | Channels |
|:---:|:---:|
| ![Skills](assets/技能页.png) | ![Channels](assets/频道页.png) |

| Settings |
|:---:|
| ![Settings](assets/设置页.png) |

---

## Architecture

```mermaid
flowchart LR
    User[User] --> WebUI[Web UI]
    User --> Channels[Feishu / QQ / Telegram / Weixin]
    WebUI --> Runner[ChatRunner]
    Channels --> Runner
    Runner --> Providers[Provider Layer]
    Providers --> Codex[Codex CLI]
    Providers --> Claude[Claude Code]
    Providers --> ThirdParty[Third-party Models]
    Runner --> Workspace[Project Workspaces]
    Runner --> Skills[Skills]
    Runner --> Review[Change Review]
    Runner --> Automation[Automations]
```

---

## Quick Start

### 1. Install the Desktop App

Download the package for your platform from [GitHub Releases](https://github.com/1935417243/AnyBot/releases):

| Platform | Package | Notes |
|----------|---------|-------|
| Windows | `AnyBot-Setup-x.x.x.exe` | Install and launch from Start Menu or desktop shortcut |
| macOS | `AnyBot-x.x.x-*.dmg` | Open the `.dmg`, drag `AnyBot.app` into Applications, then launch |

The desktop app does not require users to install Node.js manually. Providers, models, permissions, projects, channels, and privacy settings can be configured in the Web UI.

Windows installer builds support **Settings -> About -> Check for updates**. On macOS, download the new `.dmg` manually and overwrite the existing app.

#### macOS Says the App Is Damaged

If the package came from AnyBot's GitHub Releases, clear the quarantine attribute:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
```

If your app is named `Anybot.app`, adjust the path accordingly.

### 2. Configure a Provider

Configure at least one Provider:

| Provider | Runtime | Notes |
|----------|--------------|-------|
| Codex CLI | Uses the platform native binary provided by `@openai/codex-sdk` by default, so a globally installed `codex` command is not required. Native Codex mode still requires Codex login or API configuration; when **Responses compatibility layer** is enabled, Codex uses AnyBot's local compatibility service configuration and model mapping | Session resume, sandbox, image input |
| Claude Code | Uses the platform native binary provided by `@anthropic-ai/claude-agent-sdk` by default, so a global Claude Code install is not required. Configure an external executable from advanced settings only when needed. See the [Claude Code docs](https://code.claude.com/docs/en/overview) | Session resume, sandbox mapping, streamed Agent events |

### 3. Run From Source

Use **Node.js 22** for local development to match CI.

```bash
git clone https://github.com/1935417243/AnyBot.git
cd AnyBot
npm ci
npm start
```

Then open `http://localhost:19981`.

### 4. Background Mode

```bash
npm run bot:start
npm run bot:status
npm run bot:stop
```

---

## Providers

| Provider | Status | Image input | Notes |
|----------|--------|-------------|-------|
| `codex` | Available | Supported | Codex SDK/CLI with sandbox mode and Agent events |
| `claude-code` | Available | Not currently supported | Claude Agent SDK with session resume, permission modes, and context compaction |

Provider and model choices are saved from the Web UI. Each Provider remembers its last selected model.

## DeepSeek Support

AnyBot can connect Codex to DeepSeek-compatible services through the Codex Responses compatibility layer. When enabled, the Codex Provider uses AnyBot's local compatibility service configuration and model mapping with an isolated `CODEX_HOME`, so it does not affect the user's global `~/.codex` configuration.

Common use cases:

- Use DeepSeek-compatible models to drive the local Codex Agent.
- Select stable model aliases from the Web UI.
- Remotely call the local Agent from Feishu, QQ, Telegram, or personal Weixin.
- Combine project workspaces, skills, and automations for code analysis, scheduled checks, document generation, and similar local Agent tasks.

After enabling **Responses compatibility layer** under **Settings -> Providers -> Codex**, the chat box shows only the stable aliases `gpt-5.5`, `gpt-mini`, and `gpt-codex`. The actual upstream models are controlled by the mapping in settings.

---

## Web UI

The Web UI is the recommended entry point:

- Persistent multi-session history backed by SQLite.
- Project management, project sessions, directory tree browsing, and default working directory settings.
- Markdown rendering, code copy, long-message folding, and context usage display.
- Streamed Agent activity, response cancellation, and `/compact` context compaction.
- File uploads, image preview, and local image access.
- Slash picker for Provider-specific skills, projects, and native Provider commands.
- Change review with diff inspection, approve, and revert.
- Provider, model, sandbox/permission, appearance, logs, data import/export, and channel settings.
- Provider-isolated skill management.
- Automation task management: configure schedule, Provider, model, project, skills, and delivery method; the local scheduler creates a new session for each run.

---

## Channel Capabilities

Channel support varies by platform protocol:

| Channel | Transport | Input | Output | Notes |
|---------|-----------|-------|--------|-------|
| Feishu | Long connection events | Text, images | Text, images, `FILE:` files | Group chats reply on mention by default |
| QQ Bot | WebSocket gateway | Text | Text | Supports guild, group, C2C/direct events |
| Telegram | Bot API long polling | Text, images | Text | Captions are included as context; long replies are split |
| Personal Weixin | Weixin channel protocol | Text, images, files | Text, images, `FILE:` files | QR login, no OpenClaw required |

All channels support `/help`, `/new`, `/provider`, `/model`, and `/workspace`. The non-slash forms `provider 1`, `model 1`, and `workspace 1` also work for numbered selections.

### Channel Config

Channel config is stored in `.data/channels.json` and is best managed from the Web UI.

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
    "botAgent": "AnyBot/0.1.0",
    "ownerChatId": ""
  }
}
```

---

## Skills and Slash

Skills are isolated by Provider:

| Provider | Skill directory |
|----------|-----------------|
| `codex` | Native Codex mode uses `$CODEX_HOME/skills/`, defaulting to `~/.codex/skills/`; with Responses compatibility layer enabled, it uses `codex/skills/` under AnyBot's runtime data directory |
| `claude-code` | `$CLAUDE_CONFIG_DIR/skills/`, defaulting to `~/.claude/skills/` |

The Web UI `/` picker shows skills, projects, and commands for the current Provider. Selected skills inject only skill names for the current turn. Selected projects inject project names and absolute paths for the current turn.

---

## Proactive Messaging

AnyBot keeps a lightweight local API so scripts can push notifications to configured channel owners. Common uses include deployment results, scheduled task output, or local automation alerts.

```bash
curl -X POST http://localhost:19981/api/send \
  -H "Content-Type: application/json" \
  -d '{"channel": "telegram", "message": "Deploy finished"}'
```

`channel` can be `feishu`, `qqbot`, `telegram`, or `weixin`. The target channel needs `ownerChatId`.

---

## Automations

Automations run on the user's own machine and do not depend on a cloud service. After the app starts, it loads enabled tasks, finds the nearest `nextRunAt`, and uses a local timer to trigger due tasks. If the app is closed or the computer is asleep, missed runs are not replayed on restart; AnyBot calculates the next future run instead.

Each automation run creates a new local session and still goes through `ChatRunner`, so Provider selection, model choice, project working directory, skills, streamed Agent activity, message persistence, and change review behave like normal Web UI chats. Delivery only controls the final output: local delivery stores the result in run history, while channel delivery keeps the full process in the app and sends only the final result to the channel.

---

## Runtime Data

Runtime data defaults to `.data/`, and logs default to `.run/`. Desktop builds use Electron's user data directory and keep `.data/`, `.run/`, and uploads there.

Common files:

- `.data/chat.db`: sessions, messages, projects, and automations.
- `.data/app-settings.json`: app settings.
- `.data/model-config.json`: Provider and model selection.
- `.data/runtime-config.json`: sandbox defaults.
- `.data/channels.json`: channel config.
- `.data/disabled-skills.json`: skill enabled state.
- `.data/change-reviews/`: change review snapshots.
- `.data/codex/`: isolated `CODEX_HOME` used by the Codex Responses compatibility layer, including Codex sessions and skills.

---

## Project Structure

```text
AnyBot/
├── src/
│   ├── index.ts                    # Entry: Providers, Web service, channels
│   ├── chat-runner.ts              # Session orchestration, Provider calls, events, persistence
│   ├── automation-scheduler.ts     # Local automation scheduling, run history, delivery
│   ├── app-settings.ts             # App settings
│   ├── sandbox-config.ts           # Provider sandbox / permission settings
│   ├── prompt.ts                   # Shared system prompt builder
│   ├── shared.ts                   # Runtime config and path helpers
│   ├── logger.ts                   # Structured logging
│   ├── lark.ts                     # Feishu API helpers
│   ├── message.ts                  # Message parsing
│   ├── providers/                  # Provider implementations
│   ├── channels/                   # Weixin, Telegram, Feishu, QQ integrations
│   ├── web/                        # Express API, SQLite storage, Web UI static files
│   │   ├── routes/                 # Domain route modules
│   │   ├── services/               # Shared service logic
│   │   └── public/                 # Build-free HTML / CSS / ES modules
│   └── agent/md_files/             # Agent prompt templates
├── electron/                       # Electron desktop entry and packaging hooks
├── scripts/                        # Build, release assets, daemon helper
├── installer/windows/              # Windows installer config
├── build/icons/                    # Desktop icons
├── assets/                         # README screenshots and media
└── package.json
```

---

## Development

```bash
npm ci
npm run dev
npm run check
npm run build
npm run build:release
npm run electron:dev
npm run electron:build
```

Run `npm run check` before submitting changes. For desktop shell, release asset, or installer changes, also run the relevant build/electron command.

---

## Adding a Provider

1. Implement `IProvider` under `src/providers/`.
2. Register the Provider factory in `src/providers/index.ts`.
3. Add runtime config handling in `src/app-settings.ts` and `src/providers/index.ts`.
4. If the Provider exposes Web UI slash commands, implement `listSlashCommands()` and make sure the backend can handle them reliably.

Use `src/providers/codex.ts` and `src/providers/claude-code.ts` as references.

---

## License

MIT
