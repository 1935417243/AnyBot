**English** | [中文](./README_CN.md)

<div align="center">
  <img src="assets/logo.png" alt="AnyBot logo" width="120">
  <h1>AnyBot</h1>
  <p>Your local AI Coding Agent console — one entry point for desktop, web, and chat channels.</p>

  <p>
    <a href="https://github.com/1935417243/AnyBot/actions/workflows/build-portable.yml"><img src="https://github.com/1935417243/AnyBot/actions/workflows/build-portable.yml/badge.svg" alt="Build"></a>
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT">
    <img src="https://img.shields.io/github/stars/1935417243/AnyBot" alt="Stars">
    <img src="https://img.shields.io/github/v/release/1935417243/AnyBot" alt="Release">
    <img src="https://img.shields.io/github/downloads/1935417243/AnyBot/total" alt="Downloads">
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform">
  </p>
</div>

AnyBot is a local AI Coding Agent console and remote entry point that lets you control and manage AI Coding Agents on your computer through the desktop app, Web UI, Weixin, QQ, Telegram, Feishu, DingTalk, and other channels.

AnyBot supports **Codex, Claude Code, and CodeBuddy** through their respective SDKs. Desktop builds download CLI components on demand: select a Provider in settings and click “立即下载” (Download now). A global CLI installation is not required. Source development can also use runtime components shipped with the SDKs, and external CLI paths can be configured when needed.

You can configure separate upstream endpoints and model mappings for Codex / Claude Code inside AnyBot, connecting services such as DeepSeek, Kimi, MiniMax, Aliyun Token Plan, VibeAPI, Ollama (local), and llama (local). Codex supports direct Responses connections or Anthropic adaptation; Claude Code supports Anthropic-compatible endpoints. CodeBuddy uses its official service with an API Key or existing CLI login credentials. These model settings only take effect inside AnyBot.

The desktop app supports **macOS** and **Windows**; running from source supports **macOS**, **Linux**, and **Windows**.

---

## Features

- **Multiple Providers**: switch between Codex, Claude Code, and CodeBuddy from the Web UI or channel commands, with runtime components downloaded on demand.
- **Compatible model access**: configure custom Responses / Anthropic upstreams for Codex and Anthropic-compatible endpoints for Claude Code, including Base URL, API Key, and model mappings. Claude Code also supports temperature adjustment for local Ollama / llama models.
- **MCP servers**: add, enable, disable, check, and inspect MCP Server logs from the Plugins page; one configuration serves all three Providers.
- **Agent Web UI**: local chat UI with Markdown, code highlighting, streamed Agent events, cancellation, context compaction, and persistent history.
- **Code and diagram previews**: preview HTML, Mermaid, and SVG code blocks; view or copy source, download HTML / SVG files, and save Mermaid diagrams as high-resolution PNG images.
- **Project workspaces**: manage projects in the sidebar, including cloning from Git repositories, viewing and switching branches, and clearing the workspace; project sessions use the project path as the Provider working directory.
- **Skills and Plugins page**: manage skills and MCP servers together. Skills are isolated per Provider and can be browsed, enabled, disabled, and deleted; Codex / Claude Code also support downloading selected official skills. The `/` picker shows skills and commands for the current Provider.
- **Attachments**: upload by button, pasted images, or drag and drop. The upload limit is 50MB per file. Image support depends on the current Provider.
- **Change review**: after Agent edits, inspect diffs and approve or revert changes from the Web UI.
- **Channel integrations**: Feishu long connection, DingTalk Stream, QQ Bot WebSocket, Telegram long polling, and personal Weixin.
- **Proactive messaging**: send notifications to configured channel owners through `/api/send`.
- **Automations**: run local Agent tasks on minute, daily, weekly, or Cron schedules; activity stays visible in the Web UI, and final results can be saved locally or delivered to enabled channels.
- **Desktop app**: collapsible sidebar, an Open Folder shortcut on the home page, window dragging, tray and login item support, in-app updates for Windows installer builds, and GitHub latest-release checks on other platforms.

---

## Screenshots

<table>
  <tr>
    <td><img src="assets/主页.png" alt="New Chat"></td>
    <td><img src="assets/流式过程.png" alt="Streamed Agent Activity"></td>
  </tr>
  <tr>
    <td><img src="assets/变更审核.png" alt="Change Review"></td>
    <td><img src="assets/自动化.png" alt="Automations"></td>
  </tr>
  <tr>
    <td><img src="assets/频道页.png" alt="Channels"></td>
    <td><img src="assets/设置页.png" alt="Settings"></td>
  </tr>
  <tr>
    <td><img src="assets/插件页.png" alt="Plugins"></td>
    <td></td>
  </tr>
</table>

---

## Architecture

```mermaid
flowchart LR
    User[User] --> WebUI[Web UI]
    User --> Channels[Feishu / DingTalk / QQ / Telegram / Weixin]
    WebUI --> Runner[ChatRunner]
    Channels --> Runner
    Automation[Local Automation Scheduler] --> Runner
    Runner --> Providers[Provider Layer]
    Providers --> Codex[Codex CLI]
    Providers --> Claude[Claude Code]
    Providers --> CodeBuddy[CodeBuddy]
    Codex --> ThirdParty[Custom Model Services]
    Claude --> ThirdParty
    Providers --> MCP[MCP Servers]
    Runner --> Workspace[Project Workspaces]
    Runner --> Skills[Skills]
    Runner --> Review[Change Review]
```

---

## Quick Start

### 1. Install the Desktop App

Download the package for your platform from [GitHub Releases](https://github.com/1935417243/AnyBot/releases):

| Platform | Package | Notes |
|----------|---------|-------|
| Windows | `AnyBot-Setup-x.x.x.exe` | Install and launch from Start Menu or desktop shortcut |
| macOS | `AnyBot-x.x.x-*.dmg` | Open the `.dmg`, drag `AnyBot.app` into Applications, then launch |

The desktop app does not require users to install Node.js manually. Providers, models, MCP, permissions, projects, channels, automations, and privacy settings can be configured in the Web UI.

Windows installer builds support checking, downloading, and restarting to install updates from **Settings -> About -> Check for updates**. On macOS, download the new `.dmg` manually and overwrite the existing app. Source builds and platforms without automatic updates can still check the latest GitHub release from the About page.

#### macOS Says the App Is Damaged

If the package came from AnyBot's GitHub Releases, clear the quarantine attribute:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/AnyBot.app"
```

If your app is named `Anybot.app`, adjust the path accordingly.

### 2. Configure a Provider and Start Chatting

Select at least one Provider under **Settings -> Providers**. If it needs a download, click “立即下载” (Download now) and wait for the component to become ready, then configure the corresponding account or service credentials.

| Provider | Runtime | Notes |
|----------|--------------|-------|
| Codex | Use existing native CLI login / configuration, or enable **Custom upstream** (自定义上游), select Responses / Anthropic, and enter the endpoint, key, and model mappings | Session resume, sandbox, image input, MCP |
| Claude Code | Use native CLI configuration, or enable the **Anthropic-compatible interface** and enter service settings. See the [Claude Code docs](https://code.claude.com/docs/en/overview) | Session resume, permission modes, streamed Agent events, MCP |
| CodeBuddy | Enter an official service API Key, or leave it empty to use existing CLI login credentials | Session resume, permission modes, streamed Agent events, MCP, model list retrieved from the service |

Return to the home page, select a project or add one with “打开文件夹” (Open Folder), and send a message. Choose “不在项目中工作” to chat without a project. Type `/` in the input to select skills or additional projects; manage skills and MCP servers from the Plugins page.

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
| `codex` | Available | Supported | Codex SDK/CLI with sandbox, Agent events, context usage, and MCP |
| `claude-code` | Available | Not currently supported | Claude Agent SDK with session resume, permission modes, context compaction, streamed Agent events, and MCP |
| `codebuddy` | Available | Not currently supported | Tencent Agent SDK with session resume, permission modes, streamed Agent events, skills, and MCP |

Provider and model choices are saved from the Web UI. Each Provider remembers its last selected model.

## Compatible Model Support

Choose the connection mode that matches the service's API protocol:

| Provider setting | Connection |
|------------------|------------|
| Codex: Custom upstream → Responses | Codex connects directly to an upstream supporting the OpenAI Responses API |
| Codex: Custom upstream → Anthropic | AnyBot's local adapter translates requests to the Anthropic Messages API |
| Claude Code: Anthropic-compatible interface | Connects to an Anthropic API-compatible service |

Anthropic Base URL suggestions include DeepSeek, Kimi, MiniMax, Aliyun Token Plan, VibeAPI, Ollama (local), and llama (local); you can also enter another service URL. Codex uses an isolated `CODEX_HOME` when a custom upstream is enabled. Claude Code uses an isolated `CLAUDE_CONFIG_DIR` when its compatibility interface is enabled, keeping model configuration separate from global settings.

CodeBuddy currently uses its official service with an API Key or CLI login credentials; it does not expose a custom compatibility endpoint.

Common use cases:

- Use compatible models to drive the local Codex or Claude Code Agent.
- Select stable model aliases from the Web UI.
- Remotely call the local Agent from Feishu, DingTalk, QQ, Telegram, or personal Weixin.
- Combine project workspaces, skills, and automations for code analysis, scheduled checks, document generation, and similar local Agent tasks.

With **Custom upstream** enabled for Codex, the chat box uses the aliases `gpt-5.6-sol`, `gpt-mini`, and `gpt-codex`; the actual upstream models are controlled by the mappings in settings. The Claude Code compatibility interface maintains mappings by purpose: Auto, Opus, Sonnet, Haiku / Fast, and Subagent.

### Local Ollama / llama Models

Start the local model service, then select Ollama or llama in the Anthropic connection settings and enter the model name. Suggested addresses are `http://localhost:11434?anybot=ollama` and `http://localhost:8080?anybot=llama`. Keep the `anybot` marker when using a custom port; AnyBot removes it before sending requests. The API Key can be left empty for these local services.

When Claude Code connects to these local backends, the effort slider becomes a **0.0–1.0 temperature control**. AnyBot also adapts mid-conversation system messages that local model templates cannot handle.

---

## Web UI

The Web UI is the recommended entry point:

- Persistent multi-session history backed by SQLite.
- Project management, project sessions, directory tree browsing, Git repository cloning and branch switching, and default working directory settings.
- Markdown rendering, code copy, long-message folding, and context usage display.
- HTML / Mermaid / SVG preview cards load on demand, with automatic HTML preview height and serialized Mermaid rendering to reduce work in messages containing multiple diagrams.
- Card menus let you view or copy source, download HTML / SVG, and save Mermaid as high-resolution PNG. Diagram requests default to Mermaid output guidance.
- Collapsible sidebar and direct folder opening from the home page project menu.
- Streamed Agent activity, response cancellation, and `/compact` context compaction.
- File uploads, image preview, and local image access.
- Slash picker for Provider-specific skills, projects, and native Provider commands.
- Change review with diff inspection, approve, and revert.
- Provider, model, sandbox/permission, appearance, logs, data import/export, and channel settings.
- Plugins page: unified management of skills (Provider-isolated skill directory scanning with enable, disable, delete, and open-in-folder) and MCP servers.
- Automation task management: configure schedule, Provider, model, project, skills, and delivery method; the local scheduler creates a new session for each run.

---

## Channel Capabilities

Channel support varies by platform protocol:

| Channel | Transport | Input | Output | Notes |
|---------|-----------|-------|--------|-------|
| Feishu | Long connection events | Text, images | Text, images, `FILE:` files | Group chats reply on mention by default |
| DingTalk | Stream robot events | Text, images, files | Markdown, images, `FILE:` files | Direct chats auto-save Owner; attachments are limited to 20MB |
| QQ Bot | WebSocket gateway | Text, images, files | Markdown, images | Supports guild, group, C2C/direct events; non-image files are returned as local paths |
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

When `weixin.botAgent` is left empty, it is generated from the current app version as `AnyBot/<version>`.

### Feishu

Create an app in the Feishu Open Platform, enable bot capability and long connection mode, subscribe to `im.message.receive_v1`, and grant message sending permissions. To handle images, also grant message resource read permissions.

### DingTalk

Create a Stream robot app in the DingTalk Open Platform, then fill in the App Key and App Secret. After the robot receives a message, AnyBot automatically caches `robotCode`; the first direct chat with the robot automatically records `ownerChatId` for proactive messaging and automation delivery.

### QQ Bot

Create a bot app in the QQ Open Platform, get the App ID and App Secret, and configure message receive permissions. The current implementation supports guild/channel messages, group messages, and C2C/direct events.

### Telegram

Create a bot through [@BotFather](https://t.me/BotFather) and get the Bot Token. In groups, mention the bot or use commands with the bot name to trigger replies.

### Personal Weixin

After enabling the Weixin channel, the first startup shows a QR code. Scan it with personal Weixin to bind. After binding, AnyBot writes back `accountId`, `token`, and `ownerChatId`. If the login state expires, clear `weixin.token` and restart to bind again.

---

## Skills and Slash

Skills are isolated by Provider:

| Provider | Skill directory |
|----------|-----------------|
| `codex` | Scans `~/.agents/skills/` and `$CODEX_HOME/skills/` (default `~/.codex/skills/`); custom upstream mode maps the latter into `codex/skills/` under AnyBot's runtime data directory |
| `claude-code` | User skills are in `$CLAUDE_CONFIG_DIR/skills/`, defaulting to `~/.claude/skills/`; compatibility mode maps them into `claude-code/skills/` under AnyBot's runtime data directory |
| `codebuddy` | `~/.codebuddy/skills/` |

The Plugins page can browse and download selected official skills for Codex / Claude Code from `openai/skills` and `anthropics/skills`, respectively. Codex official skills are installed in `~/.agents/skills/`. Enabling or disabling a skill switches its file between `SKILL.md` and `SKILL.md.disabled`, which also affects external CLIs using the same skill directory.

The Web UI `/` picker shows skills and implemented native commands for the current Provider; projects are available globally. Selected skills inject only their names for the current turn, while selected projects inject names and absolute paths. A project session excludes its own project from the picker; only additional projects are included in the prompt. Channel commands are maintained separately from this menu.

---

## MCP Servers

MCP Servers are managed in the **Plugins** page's "MCP Servers" tab, and their configuration is stored in `.data/app-settings.json`. AnyBot currently supports pasting an `mcpServers` JSON object or a single Server config containing `command` / `url`; supported types are `stdio`, `http`, and `sse`.

Enabled MCP Servers are checked on app startup. You can also refresh, recheck, view logs, disable, or delete them from the Plugins page. The same MCP configuration serves Codex, Claude Code, and CodeBuddy: Codex receives `mcp_servers` config, while Claude Code and CodeBuddy receive their SDKs' `mcpServers` config.

---

## Proactive Messaging

AnyBot keeps a lightweight local API so scripts can push notifications to configured channel owners. Common uses include deployment results, scheduled task output, or local automation alerts.

`/api` requires authentication: a random token is generated at startup and written to `.data/api-token` (override with `ANYBOT_API_TOKEN`). Local scripts can read it and pass it via the `Authorization: Bearer` header or the `?token=` query parameter.

```bash
TOKEN=$(cat .data/api-token)
curl -X POST http://localhost:19981/api/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "telegram", "message": "Deploy finished"}'
```

`channel` can be `feishu`, `dingtalk`, `qqbot`, `telegram`, or `weixin`. The target channel needs `ownerChatId`.

---

## Automations

Automations run on the user's own machine and do not depend on a cloud service. After the app starts, it loads enabled tasks, finds the nearest `nextRunAt`, and uses a local timer to trigger due tasks. If the app is closed or the computer is asleep, missed runs are not replayed on restart; AnyBot calculates the next future run instead.

Each automation run creates a new local session and still goes through `ChatRunner`, so Provider selection, model choice, project working directory, skills, streamed Agent activity, message persistence, and change review behave like normal Web UI chats. Delivery only controls the final output: local delivery stores the result in run history, while channel delivery keeps the full process in the app and sends only the final result to the channel.

---

## Runtime Data

Runtime data defaults to `.data/`, and logs default to `.run/`. Desktop builds use Electron's user data directory and keep `.data/`, `.run/`, and uploads there.

Source runs can override the data directory with `DATA_DIR` or `CODEX_DATA_DIR`. The app does not read `.env` files; manage common settings from the Web UI. Data exports mask secrets by default; to migrate credentials, explicitly request `/api/data/export?includeSecrets=1` with an API token.

Common files:

- `.data/chat.db`: sessions, messages, projects, and automations.
- `.data/app-settings.json`: app settings, Provider runtime configuration, and MCP Server configuration.
- `.data/model-config.json`: Provider and model selection.
- `.data/runtime-config.json`: sandbox defaults.
- `.data/channels.json`: channel config.
- `.data/api-token`: local API auth token (mode 0600), used by local scripts calling `/api`.
- `.data/proxy.json`: proxy configuration.
- `.data/disabled-skills.json`: skill enabled state.
- `.data/change-reviews/`: change review snapshots.
- `.data/codex/`: isolated `CODEX_HOME` used by Codex custom upstream mode, including Codex sessions and skills.
- `.data/claude-code/`: isolated `CLAUDE_CONFIG_DIR` used by the Claude Code Anthropic-compatible interface.

---

<details>
<summary><b>Developer documentation: how it works, project structure, and development commands</b></summary>

### How It Works

- `src/index.ts` starts the Provider, Web service, enabled channels, desktop update checks, and MCP Server startup verification.
- `src/chat-runner.ts` is the shared orchestration layer for Web UI and channel messages. It handles Provider sessions, project working directories, prompts, message persistence, streamed events, and change review.
- `src/automation-scheduler.ts` is the local automation scheduler. It skips missed runs after restart, triggers due tasks, records run history, and delivers final results.
- Web sessions and channel sessions bind to native Provider sessions, and follow-up messages use session resume to keep context.
- Enabled MCP Servers are included in Provider call configuration for Codex, Claude Code, and CodeBuddy tasks.
- Project sessions use the project directory as the Provider working directory; normal chats use the default working directory.
- Web UI uploads are saved under `tmp/uploads/` inside the working directory.
- Local image paths and `FILE: /path/to/file.ext` directives in Agent replies are uploaded only for channels that support attachment return.
- Logs are single-line JSON files split by date and time under `.run/`, with a default retention of 3 days.

### Project Structure

```text
AnyBot/
├── src/
│   ├── index.ts                    # Entry: Providers, Web service, channels, MCP checks, updates
│   ├── chat-runner.ts              # Session orchestration, Provider calls, events, persistence
│   ├── automation-scheduler.ts     # Local automation scheduling, run history, delivery
│   ├── app-settings.ts             # App settings
│   ├── sandbox-config.ts           # Provider sandbox / permission settings
│   ├── mcp-config.ts               # MCP config transformation for all three Providers
│   ├── cli-runtime/                # CLI manifests, on-demand downloads, integrity checks
│   ├── prompt.ts                   # Shared system prompt builder
│   ├── shared.ts                   # Runtime config and path helpers
│   ├── logger.ts                   # Structured logging
│   ├── lark.ts                     # Feishu API helpers
│   ├── message.ts                  # Message parsing
│   ├── providers/                  # Provider implementations
│   ├── channels/                   # Weixin, Telegram, Feishu, DingTalk, QQ integrations
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

### Development

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

### Adding a Provider

1. Implement `IProvider` under `src/providers/`.
2. Register the Provider factory in `src/providers/index.ts`.
3. Add runtime config handling in `src/app-settings.ts` and `src/providers/index.ts`.
4. If the Provider exposes Web UI slash commands, implement `listSlashCommands()` and make sure the backend can handle them reliably.

Use `src/providers/codex.ts` and `src/providers/claude-code.ts` as references.

</details>

---

## Release Notes

See [release-notes.md](./release-notes.md) for the current release notes and [GitHub Releases](https://github.com/1935417243/AnyBot/releases) for previous versions.

## Contributing

Issues and pull requests are welcome. Please run `npm run check` before submitting changes.

## License

MIT — see [LICENSE](./LICENSE).
