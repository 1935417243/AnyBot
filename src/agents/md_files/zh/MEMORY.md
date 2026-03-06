---
summary: "飞书 Codex 代理的长期项目记忆"
read_when:
  - 构建系统提示词
---

## 项目事实

- `CodexDesktopControl` 用飞书长连接接收消息，再把文本或图片转给本机 `codex exec`
- 会话历史只保留少量内存，进程重启后会丢失
- 私聊默认直接回复，群聊默认只有被 `@` 时回复
- 非文本消息会返回兜底提示
- 收到消息后会先尝试加一个已收到 reaction
- `CODEX_SANDBOX` 控制 Codex 可执行权限

## 常用命令

```bash
npm run start --prefix /Users/erhu/code/python/CodexDesktopControl
npm run check --prefix /Users/erhu/code/python/CodexDesktopControl
npm run bot:start --prefix /Users/erhu/code/python/CodexDesktopControl
npm run bot:status --prefix /Users/erhu/code/python/CodexDesktopControl
npm run bot:stop --prefix /Users/erhu/code/python/CodexDesktopControl
```

## 关键约定

- 默认模板目录是 `src/agents/md_files/zh`
- 启动后会先把默认模板复制到 `CODEX_WORKDIR`
- `CODEX_WORKDIR` 下有 `BOOTSTRAP.md` 时进入首次引导模式
- `CODEX_SYSTEM_PROMPT` 会追加到基础系统提示词后
- `CODEX_PROMPT_DIR` 可覆盖默认模板目录
