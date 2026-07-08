# 代码质量审查报告 — YT2BILI

> 审查范围：代码质量 + Bug + 架构（不含安全审查，安全另见 `security_best_practices_report.md`；不含 UI 审查）
> 审查日期：2026-07-08
> 审查方式：逐文件 Read + Grep 核对前后端/Runner/文档契约，未修改任何代码

---

## 审查结论概览

- **API 路径一致性**：重点核对了 `console.html`（33 处 fetch）、`login.html`（3 处）、`main.py`（3 处 worker_get/post）、`README.md` API 表 与 `src/index.ts` 的 `app.route()` 挂载 + 各路由文件相对路径。**已知 `/api/trigger → /api/status/trigger` 的 bug 已修复**，未发现新的同类路径不匹配 bug。
- **最严重的功能 Bug**：失败的 manual_queue 视频被无条件写入 `processed` 去重表，导致 Runner 下次运行直接跳过，retry_count 永远无法自增——手动队列的重试机制实际失效。
- **最严重的文档问题**：README 宣称「Cookie 自动续期」，但 Runner 实际只发 Webhook 告警、从不刷新 Cookie，`/api/pipeline/cookies` 端点定义后从未被调用。
- 共发现 **2 个 Bug / 7 个 Code Smell / 4 个 Architecture / 4 个 Documentation**。

---

## 一、Bug（会导致功能错误）

### CODE-01｜失败视频被无条件写入 processed 表，使 manual_queue 重试机制失效

- **位置**：
  - [src/routes/pipeline.ts#L106-L123](file:///workspace/src/routes/pipeline.ts#L106)（`processed[r.video_id] = item` 无条件写入，含 status='failed'）
  - [scripts/main.py#L784](file:///workspace/scripts/main.py#L784) 与 [scripts/main.py#L807](file:///workspace/scripts/main.py#L807)（`if video_id in processed: continue`）
- **问题描述**：
  Worker 的 `/api/pipeline/processed` 在回写时，对**每条**结果（无论 success 还是 failed）都执行 `processed[r.video_id] = item`，即失败视频也进入去重表。
  Runner 在每次运行开头从 `/api/pipeline/config` 拉取 `processed`，随后对频道视频和 manual_queue 视频都用 `if video_id in processed: continue` 跳过，**且未检查该条目的 `status` 字段**。
  
  这导致一条 manual_queue 视频首次失败后：
  1. Worker 把它写入 `processed`（status='failed'）；
  2. 下次运行 Runner 拉到 `processed` 含该 video_id → 直接 `continue` 跳过；
  3. 因此 `writeback_single` 不再被调用 → `retry_count` 永远停在 1，永远到不了 3（移除阈值）；
  4. 该视频**永久卡在 manual_queue 中**：既不会被重试，也不会被清理。

  pipeline.ts 中明确存在 `retry_count`/`status='retry'`/`last_error_at` 冷却等重试逻辑（[pipeline.ts#L129-L141](file:///workspace/src/routes/pipeline.ts#L129)），说明重试是被设计出来的功能，但被去重逻辑抵消。
- **建议**（二选一）：
  - **方案 A（改 Runner，推荐）**：Runner 跳过条件改为「仅当 `processed[video_id].status == 'success'` 时跳过」，对 manual_queue 尤其必要。对频道视频可保留现状（避免对永久失败视频无限重试）。
  - **方案 B（改 Worker）**：`/processed` 仅在 `r.status === 'success'` 时写入 `processed`，失败项不进去重表。需评估频道视频失败后被反复拉取的风险（可依赖 MAX_VIDEOS_PER_CHANNEL 与 feed 滚动缓解）。

### CODE-02｜`last_error_at` 冷却字段被写入但全项目从未被读取

- **位置**：
  - 写入：[src/routes/pipeline.ts#L136](file:///workspace/src/routes/pipeline.ts#L136)（`cleanedManualQueue[idx].last_error_at = now`，注释「冷却:下次拉取时 Worker 据此跳过近期失败项」）
  - 定义：[src/kv.ts#L87](file:///workspace/src/kv.ts#L87)
- **问题描述**：Grep 全仓库确认 `last_error_at` / `last_error` 只在 pipeline.ts 写入、kv.ts 定义，**Runner（main.py）与所有路由均未读取**该字段做冷却判断。注释承诺的「下次拉取跳过近期失败项」并未实现。
  当前因为 CODE-01 的存在该字段形同虚设；一旦 CODE-01 被修复（Runner 改为按 status 跳过），缺失的冷却逻辑会立刻暴露——近期失败的视频会立即被重试，可能触发 B 站/YouTube 限流。
- **建议**：在 Runner 处理 manual_queue 前，对 `last_error_at` 做冷却窗口过滤（如距上次失败 < 10 分钟则跳过），或在 Worker `/api/pipeline/config` 返回时即过滤掉近期失败项。

---

## 二、Code Smell（代码质量）

### CODE-03｜`manual.ts` 存在未使用变量 `seasonId` / `sectionId`

- **位置**：[src/routes/manual.ts#L19-L20](file:///workspace/src/routes/manual.ts#L19)
- **问题描述**：
  ```ts
  const seasonId = body.season_id;     // 赋值后未使用
  const sectionId = body.section_id;  // 赋值后未使用
  ```
  紧接着的 `newItems.push({...})` 里直接用了 `body.season_id || ''` 与 `body.section_id || ''`（[manual.ts#L36-L37](file:///workspace/src/routes/manual.ts#L36)），这两个局部变量是死代码。
- **建议**：删除这两个未使用变量，或改为引用它们以保持一致。

### CODE-04｜`/api/pipeline/status` 未校验 `cookie_status` 取值合法性

- **位置**：[src/routes/pipeline.ts#L229-L237](file:///workspace/src/routes/pipeline.ts#L229)
- **问题描述**：Runner 上报 `cookie_status` 时，Worker 用 `severity[incoming] ?? 0` 查严重度。当 `incoming` 是非法字符串（如 `'foo'`）时 `severity['foo']` 为 `undefined`，`?? 0` 得 0；若当前 `cookie_status` 恰为 `'unknown'`（严重度也是 0），则 `0 >= 0` 成立，会把非法值 `'foo'` 直接写入 `updated.cookie_status`，污染状态。
  Runner 当前只传 `'expiring'`/`'ok'`，故未触发，但缺少输入校验是隐患。
- **建议**：在白名单 `['ok','expired','expiring','unknown']` 之外的值直接忽略（`continue`），不写入。

### CODE-05｜入口与 pipeline 路由各自计算 requestId，日志难以关联

- **位置**：[src/index.ts#L48](file:///workspace/src/index.ts#L48)（全局中间件注入 `c.var.requestId`）与 [src/routes/pipeline.ts#L20](file:///workspace/src/routes/pipeline.ts#L20)（pipeline 中间件自行 `c.req.header('x-request-id') || crypto.randomUUID()`）
- **问题描述**：当客户端未传 `x-request-id` 头时，入口生成一个 UUID 存入 `c.var`，但 pipeline 路由不读 `c.var` 而是重新生成一个 UUID，导致**同一请求的访问日志（入口）与 pipeline_auth/pipeline_pull 日志（pipeline）requestId 不一致**，排障时无法串联。
- **建议**：pipeline 中间件改为 `c.get('requestId') || c.req.header('x-request-id') || crypto.randomUUID()`，复用入口已生成的 ID。

### CODE-06｜`crypto.ts` 加密用字符串拼接构造 base64，O(n²)

- **位置**：[src/crypto.ts#L46-L48](file:///workspace/src/crypto.ts#L46)
  ```ts
  let binStr = '';
  for (let i = 0; i < combined.length; i++) binStr += String.fromCharCode(combined[i]);
  return ENC_PREFIX + btoa(binStr);
  ```
- **问题描述**：逐字符 `+=` 拼接字符串在大数据量时为 O(n²)。当前敏感字段多为短凭证（影响可忽略），但 `yt_cookies`（Netscape cookies.txt）可达数 KB，且每次 OAuth 回调与 config 保存都触发。
- **建议**：改用 `btoa(String.fromCharCode(...combined))`（注意 spread 栈溢出上限）或分块拼接，或直接对 Uint8Array 用 `reduce`。

### CODE-07｜多处对外部 API 的 `fetch` 未设置超时/AbortController

- **位置**：
  - [src/routes/status.ts#L55](file:///workspace/src/routes/status.ts#L55)（触发 GitHub dispatches）
  - [src/routes/bili.ts#L72](file:///workspace/src/routes/bili.ts#L72)、[bili.ts#L101](file:///workspace/src/routes/bili.ts#L101)
  - [src/routes/youtube.ts#L51](file:///workspace/src/routes/youtube.ts#L51)、[youtube.ts#L69](file:///workspace/src/routes/youtube.ts#L69)
  - [src/routes/youtube_oauth.ts#L107](file:///workspace/src/routes/youtube_oauth.ts#L107)、[youtube_oauth.ts#L218](file:///workspace/src/routes/youtube_oauth.ts#L218)
- **问题描述**：这些 `fetch` 调用均无 `AbortController` 超时控制。若上游（GitHub/B 站/Google）响应缓慢，Worker 请求会一直挂起直到平台级超时，占用连接并影响用户体验。Worker 侧 `fetch` 的 subrequest 不计入 CPU 时间，wall-clock 可挂较久。
- **建议**：为每处外部 `fetch` 加 `AbortSignal.timeout(ms)`（如 10–15s），超时返回明确错误。

### CODE-08｜`main.py` 在函数内部 `import yt_dlp`，依赖缺失时延迟暴露

- **位置**：[scripts/main.py#L443](file:///workspace/scripts/main.py#L443)、[scripts/main.py#L774](file:///workspace/scripts/main.py#L774)
- **问题描述**：`import yt_dlp` 写在 `process_video` / 频道扫描循环内部。若 yt-dlp 未安装（如 requirements.txt 解析失败），错误要到运行中才抛出，前面已执行的步骤（拉配置等）白做。相比之下 `import requests` 在模块顶部，能即时失败。
- **建议**：将 `import yt_dlp` 提到模块顶部（或 `main()` 入口处提前 import 探测），使依赖缺失时快速失败并给出清晰错误。

### CODE-09｜`requirements.txt` 锁定 yt-dlp==2024.12.6，距今约 19 个月

- **位置**：[scripts/requirements.txt#L2](file:///workspace/scripts/requirements.txt#L2)
- **问题描述**：yt-dlp 需高频迭代以跟进 YouTube 站点变更。固定到 2024 年 12 月的版本在 2026 年 7 月极可能对当前 YouTube 失效（下载/解析报错），属于会直接导致流水线功能失败的依赖陈旧问题。`bilibili-api-python==16.2.0` 同理偏旧但 B 站 API 相对稳定，风险较低。
- **建议**：将 yt-dlp 放宽为 `yt-dlp>=2024.12.6`（或定期升级到近期稳定版），并在 CI 中加一个 yt-dlp 可用性冒烟测试。

---

## 三、Architecture（架构改进）

### CODE-10｜YouTube OAuth 刷新链路断裂：端点存在但 Runner 从不调用，且刷新不重铸 cookies

- **位置**：
  - 端点：[src/routes/pipeline.ts#L268](file:///workspace/src/routes/pipeline.ts#L268)（`/api/pipeline/yt-oauth-refresh`）
  - 刷新函数：[src/routes/youtube_oauth.ts#L197](file:///workspace/src/routes/youtube_oauth.ts#L197)（`refreshYouTubeAccessToken`，只刷新 access_token，不重铸 SAPISID cookies）
  - Runner：`scripts/main.py` 全文无对该端点的调用
- **问题描述**：
  1. `/api/pipeline/yt-oauth-refresh` 已实现并被 pipeline 路由挂载，但 Runner（main.py）从未调用它。导致 `yt_access_token` 过期后，控制台的 `/api/youtube/search`（[youtube.ts#L25-L31](file:///workspace/src/routes/youtube.ts#L25)）会直接返回 401「token 已过期」。
  2. 即便调用，`refreshYouTubeAccessToken` 只更新 `yt_access_token`/`yt_token_expires_at`，**不会重新调用 `forgeYtCookies` 重铸下载用 cookies**。而 yt-dlp 下载依赖的是 `yt_cookies`（SAPISID/HSID 等），这些 cookie 同样会过期，过期后下载高清/会员视频会失败。
  这是一个端到端链路缺失：OAuth 凭证的全生命周期（刷新 token → 刷新 access_token → 重铸下载 cookies）在 Runner 侧没有闭环。
- **建议**：在 Runner 下载前调用 `/api/pipeline/yt-oauth-refresh`；并在 `refreshYouTubeAccessToken` 成功刷新后判断是否需要重铸 cookies（如距上次铸造超过阈值），把 cookies 一并更新。

### CODE-11｜KV 多处 read-modify-write 无锁，存在 TOCTOU 竞态

- **位置**：
  - [src/routes/manual.ts#L24-L47](file:///workspace/src/routes/manual.ts#L24)（getManualQueue → push → putManualQueue）
  - [src/routes/channels.ts#L40-L57](file:///workspace/src/routes/channels.ts#L40)、[channels.ts#L64-L75](file:///workspace/src/routes/channels.ts#L64)、[channels.ts#L80-L87](file:///workspace/src/routes/channels.ts#L80)
  - [src/routes/pipeline.ts#L97-L194](file:///workspace/src/routes/pipeline.ts#L97)（processed/manual_queue/status 三表读改写）
  - [src/routes/youtube_oauth.ts#L99-L178](file:///workspace/src/routes/youtube_oauth.ts#L99)（OAuth 回调 getRawConfig→putConfig）
  - [src/routes/bili_login.ts#L264-L273](file:///workspace/src/routes/bili_login.ts#L264)（cookie 登录 getRawConfig→putConfig）
- **问题描述**：所有这些「读 KV → 改内存 → 写回 KV」均无 CAS/乐观锁。两个并发请求各自读到旧值，后写的覆盖先写的，导致数据丢失。
  目前风险被以下因素缓解：CI `concurrency.group: pipeline` 保证单条流水线串行；管理操作（增删频道/手动队列）频率低且通常单用户。但 OAuth 回调与用户改配置若并发，用户改动可能被回调覆盖。
- **建议**：短期可接受现状；中期对 config 写入引入版本号（读时带 version，写时校验）或对关键写操作串行化。

### CODE-12｜单个敏感字段解密失败会清空整个 Config

- **位置**：[src/kv.ts#L146-L162](file:///workspace/src/kv.ts#L146)
- **问题描述**：`getRawConfig` 在循环里对每个 SENSITIVE_FIELDS 调 `decrypt`，任一字段解密抛错都会被外层 `catch` 捕获，返回 `{ initialized: true }`。即**一个损坏的凭证字段会让全部配置（其他凭证、频道无关配置等）一并丢失**，前端看到的是「已初始化但所有字段空」。
  该行为是出于安全考虑（避免攻击者借损坏数据重置接管），注释已说明，但代价是可用性差：单个字段损坏即全量重配。
- **建议**：可改为「单字段解密失败则该字段置空并告警，其余字段照常返回」，并在日志中标记损坏字段名，便于定位。

### CODE-13｜增量回写每次全量读写整张 processed 表，O(n²)

- **位置**：[scripts/main.py#L697-L716](file:///workspace/scripts/main.py#L697)（`writeback_single` 每个视频调一次）+ [src/routes/pipeline.ts#L91-L209](file:///workspace/src/routes/pipeline.ts#L91)（每次 `/processed` 都 `getProcessed` 全表 + `putProcessed` 全表）
- **问题描述**：Runner 对每个视频成功后立即单条回写（设计目的是防批量回写失败丢数据），但 Worker 端每次都读/写**整张 processed 表**（最多 500 条）。N 个视频 = N 次全表读改写，O(n×500)。同时 `status.recent_records` 与 `total_processed` 也被反复全量读改写。
  数据量当前不大（500 上限），性能可接受，但属于架构层面的低效模式。
- **建议**：可接受现状；若后续视频量增大，可让 `/processed` 支持「仅追加单条」语义（不重读整表），或改为末尾批量回写（牺牲增量安全性换性能）。

---

## 四、Documentation（文档）

### CODE-14｜README 宣称「Cookie 自动续期」，实际 Runner 只发告警从不刷新

- **位置**：
  - README 声明：[README.md#L16](file:///workspace/README.md#L16)（「Cookie 自动续期…新 Cookie 回写 Worker」）、[README.md#L366](file:///workspace/README.md#L366)、[README.md#L393-L396](file:///workspace/README.md#L393)
  - 实际实现：[scripts/main.py#L649-L673](file:///workspace/scripts/main.py#L649)（`notify_cookie_expiry` 仅 `send_notify`，不调 `/api/pipeline/cookies`）
- **问题描述**：README 多处描述「检测 ac_time_value 距过期 < 1 小时 → 调 B 站 nav 接口刷新 → POST /api/pipeline/cookies 回写新 Cookie」。但 `main.py` 的 `notify_cookie_expiry` docstring 明确写道「续期必须走二次登录(QR Code),Runner 无法自动完成。仅发告警」，且函数体只调 `send_notify`，从不调用 `/api/pipeline/cookies`。
  即 `/api/pipeline/cookies` 端点虽已实现（[pipeline.ts#L249-L264](file:///workspace/src/routes/pipeline.ts#L249)），却无任何调用方。文档与实现严重不符，会误导用户以为 Cookie 能自动续期。
- **建议**：更正 README，说明 Cookie 过期需人工重新扫码登录（Runner 仅发 Webhook 告警）；或如确需自动续期，实现相应逻辑（注意 B 站 SESSDATA 续期需二次登录，技术上不可在 Runner 自动完成——故建议改文档）。

### CODE-15｜README 宣称「连续失败 ≥ 3 次触发告警」，实际为「失败率 ≥ 50% 且 ≥ 2 个视频」

- **位置**：
  - README 声明：[README.md#L17](file:///workspace/README.md#L17)、[README.md#L300](file:///workspace/README.md#L300)、[README.md#L384](file:///workspace/README.md#L384)
  - 实际实现：[scripts/main.py#L840](file:///workspace/scripts/main.py#L840)（`if notify_webhook and total >= 2 and fail_count / total >= 0.5:`）
- **问题描述**：README 说「连续失败 ≥ 3 次」，但代码是「本次运行处理 ≥ 2 个视频且失败率 ≥ 50%」，且代码注释（[main.py#L835](file:///workspace/scripts/main.py#L835)）明确「删除跨运行『连续』概念」。文档与实现不符。
- **建议**：将 README 改为「单次运行失败率 ≥ 50%（且至少 2 个视频）时发送告警」。

### CODE-16｜README API 端点表缺失 7 个已实现端点

- **位置**：[README.md#L308-L340](file:///workspace/README.md#L308)（「API 端点一览」表）
- **问题描述**：以下端点在 Worker 中已实现且部分被前端实际调用，但未列入 README API 表：
  | 缺失端点 | 实现位置 | 前端是否调用 |
  |---|---|---|
  | `POST /api/auth/change-password` | auth.ts | 是（console.html#L2698） |
  | `GET /api/bili/login/qrcode` | bili_login.ts | 是（console.html#L2378） |
  | `GET /api/bili/login/qrcode/status` | bili_login.ts | 是（console.html#L2443） |
  | `POST /api/bili/login/logout` | bili_login.ts | 否（前端走 /api/logout） |
  | `GET /api/youtube/oauth/start` | youtube_oauth.ts | 是（弹窗） |
  | `GET /api/youtube/oauth/callback` | youtube_oauth.ts | 是（OAuth 回调） |
  | `POST /api/pipeline/yt-oauth-refresh` | pipeline.ts | 否（见 CODE-10） |
- **建议**：补全 API 表，便于维护与对接。

### CODE-17｜`youtube.ts` 注释引用了不存在的 `/api/youtube/oauth/refresh` 端点

- **位置**：[src/routes/youtube.ts#L29](file:///workspace/src/routes/youtube.ts#L29)
  ```ts
  // 过期但已配置 OAuth,提示用户刷新(或调 /api/youtube/oauth/refresh,但本端点无 Pipeline Token,这里仅提示)
  ```
- **问题描述**：`/api/youtube/oauth/refresh` 并无对应路由实现（youtube_oauth.ts 只定义了 `/start`、`/callback`，刷新逻辑在 `refreshYouTubeAccessToken`，对外暴露为 `/api/pipeline/yt-oauth-refresh`）。注释指向错误路径，易误导维护者。
- **建议**：将注释中的路径改为 `/api/pipeline/yt-oauth-refresh`。

---

## 附录：API 路径一致性核对结果（重点项）

按要求逐一核对了前端 fetch、Runner 调用、README 文档与 Worker 路由挂载：

| 调用方 → 端点 | Worker 挂载 | 结果 |
|---|---|---|
| console.html `/api/status/trigger` | `app.route('/api/status', statusRoutes)` + `/trigger` | ✅ 一致（原 bug 已修复） |
| console.html 其余 32 处 fetch | 各 routes/*.ts | ✅ 全部一致 |
| login.html `/api/config/init`、`/api/login`、`/api/init-status` | auth.ts | ✅ 一致 |
| index.html `/api/init-status` | auth.ts | ✅ 一致 |
| main.py `/api/pipeline/config` | pipeline.ts `/config` | ✅ 一致 |
| main.py `/api/pipeline/processed` | pipeline.ts `/processed` | ✅ 一致 |
| main.py `/api/pipeline/status` | pipeline.ts `/status` | ✅ 一致 |
| main.py 字段名（video_id/bvid/title/channel/channel_id/status/stage/message/retryable/subtitle_error/season_error/channel_config_id/season_id/section_id） | pipeline.ts / manual.ts / kv.ts | ✅ 一致 |

**结论：未发现新的 `/api/trigger` 类路径不匹配 bug。** 已知修复点（`/api/trigger → /api/status/trigger`）在前端（console.html#L1977）、Worker（status.ts#L41 挂载于 `/api/status`）、README（#L324）三处均已对齐为 `/api/status/trigger`。

> 注：`/api/pipeline/cookies` 与 `/api/pipeline/yt-oauth-refresh` 虽路径正确，但无调用方（见 CODE-10、CODE-14），属于「契约存在但链路断裂」，非路径不匹配。
