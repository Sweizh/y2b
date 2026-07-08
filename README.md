# YT2BILI

YouTube 到 Bilibili 自动化搬运系统的 Web 管理后台。基于 Cloudflare Workers + KV + Hono 框架实现，单仓库前后端一体。

## 功能

- **登录鉴权**：bcrypt 密码哈希 + HttpOnly Cookie Session
- **凭证管理**：B 站 / YouTube / GitHub / ASR / 翻译 API 密钥，AES-GCM 加密存储，前端脱敏回显
- **频道管理**：搜索 YouTube 频道 → 关注 → 配置合集/分区/标签/字幕模式(4 选项:翻译字幕/原语言字幕/双语字幕/不上传)
- **运行状态**：上次运行时间、累计处理数、处理记录表(含状态色标)、立即触发流水线、**已处理视频列表**(含删除触发重新处理)、**失败通知配置**(Webhook URL + 启用开关)
- **手动队列**：多行 URL 批量添加(支持完整 URL / 短链接 / 纯视频 ID)、删除二次确认、**可选 B 站合集**(优先级:手动指定 > 频道默认 > 不进合集)
- **Pipeline API**：供 GitHub Actions Runner 调用，Bearer Token 鉴权
- **GitHub Actions 流水线**：Worker `/api/status/trigger` 触发 `repository_dispatch` 事件,启动 `process.yml` 运行 Python Runner
- **Python Runner**：yt-dlp 下载 → ffmpeg 提取音频 → ASR 转写 → 翻译字幕 → bilibili-api-python 上传 → 追加合集
- **标题翻译模板**：全局配置 `title_template`,支持变量 `{channel}`(频道名)、`{title}`(翻译后标题),通过翻译 API prompt 注入实现;留空则不翻译不套模板(向后兼容)
- **Cookie 过期告警**：检测 ac_time_value 距过期 < 1 小时通过 Webhook 告警(续期需人工在控制台重新扫码登录,Runner 无法自动完成)
- **失败通知**：单次运行失败率 ≥ 50%(且至少 2 个视频)调用 Webhook(支持企业微信/钉钉/Server酱)
- **结构化日志**：Worker 关键路径输出 JSON 日志(requestId/event/status/duration),`wrangler tail` 可按字段过滤
- **明暗主题**：跟随系统 / 记忆偏好

## 技术栈

| 组件 | 选型 |
|---|---|
| 运行时 | Cloudflare Workers |
| 数据存储 | Cloudflare KV |
| Web 框架 | Hono |
| 密码哈希 | bcryptjs |
| 加密 | Web Crypto API (AES-GCM, SHA-256 派生密钥) |
| 前端 | 原生 HTML + Tailwind CSS v4 (CDN) + Lucide Icons |
| CI/CD | GitHub Actions (`repository_dispatch` 触发) |
| Runner | Python 3.11 + yt-dlp + ffmpeg + bilibili-api-python |
| 部署 | wrangler / Cloudflare Dashboard Git 集成 |

## 项目结构

```
.
├── src/
│   ├── index.ts              # Worker 入口，路由组装 + 鉴权中间件 + 结构化日志
│   ├── env.d.ts              # Cloudflare Worker 环境类型
│   ├── auth.ts               # Session / bcrypt / pipeline token
│   ├── crypto.ts             # AES-GCM 加密
│   ├── kv.ts                 # KV 读写封装 + 数据类型
│   └── routes/
│       ├── auth.ts           # /api/init-status /api/login /api/logout /api/config/init
│       ├── config.ts         # GET/PUT /api/config + /api/config/pipeline-token
│       ├── channels.ts       # CRUD /api/channels
│       ├── bili.ts           # /api/seasons /api/tids /api/test/bili
│       ├── youtube.ts        # /api/youtube/search
│       ├── status.ts         # GET /api/status + POST /api/status/trigger
│       ├── processed.ts      # GET/DELETE /api/processed
│       ├── manual.ts         # CRUD /api/manual-queue
│       ├── tests.ts          # /api/test/{asr,translate,github}
│       └── pipeline.ts       # /api/pipeline/{config,processed,status,cookies}（Bearer Token）
├── public/
│   ├── index.html            # 入口，自动跳转登录页或控制台
│   ├── login.html            # 登录页
│   └── console.html          # 控制台（含已处理视频列表 + 失败通知配置）
├── scripts/
│   ├── main.py               # Python Runner 主流程(下载→转写→翻译→上传→回写)
│   ├── setup.mjs             # 从 .dev.vars/环境变量生成本地 wrangler.toml
│   └── requirements.txt      # yt-dlp / bilibili-api-python / requests
├── .github/
│   └── workflows/
│       └── process.yml       # GitHub Actions workflow(repository_dispatch 触发)
├── wrangler.toml.example      # wrangler 配置模板(入库,含 ${VAR} 占位符)
├── wrangler.toml              # 本地 wrangler 配置(不入库,由 setup.mjs 生成)
├── package.json
├── tsconfig.json
├── .dev.vars.example          # 本地开发环境变量模板(入库)
└── .dev.vars                  # 本地开发环境变量（不入库）
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动本地 Worker（默认端口 8787）
npm run dev
# 访问 http://localhost:8787
# 首次访问会进入初始化页面，设置管理密码

# 实时查看生产日志（部署后）
npm run tail
```

`.dev.vars` 文件示例（首次使用 `cp .dev.vars.example .dev.vars` 创建）：

```
# KV 命名空间 ID（从 Cloudflare Dashboard → KV → 你的命名空间 复制）
# 本地开发不设置也能用,wrangler dev 会用本地 KV 模拟(数据不持久)
CLOUDFLARE_KV_ID="your-kv-namespace-id"
CLOUDFLARE_KV_PREVIEW_ID="your-kv-preview-id"

# 加密主密钥(任意长度字符串,经 SHA-256 派生为 32 字节 AES 密钥)
ENCRYPTION_KEY="任意长度的字符串，会自动经 SHA-256 派生为 32 字节 AES 密钥"
```

> **fork 友好**:`wrangler.toml` 不入库(在 `.gitignore` 中),由 `scripts/setup.mjs` 在 `npm install` 时从 `.dev.vars` 或环境变量自动生成。sync fork 不会覆盖你的 KV id。

## 部署指南

### 步骤 1：准备 Cloudflare 资源

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → KV → 创建命名空间 `YT2BILI_KV`
3. 复制命名空间 ID（后面要用）

### 步骤 2：本地配置（wrangler 命令行部署用）

```bash
# 复制环境变量模板并填入你的 KV id
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars,填入 CLOUDFLARE_KV_ID 和 CLOUDFLARE_KV_PREVIEW_ID

# 生成 wrangler.toml（也可在 npm install 时自动生成）
npm run setup
```

`wrangler.toml` 由 `scripts/setup.mjs` 从 `wrangler.toml.example` + `.dev.vars` 自动生成,**不入库**（避免 fork sync 覆盖）。

### 步骤 3：设置加密密钥

```bash
npx wrangler secret put ENCRYPTION_KEY
# 输入任意长度的随机字符串，建议使用：
# openssl rand -base64 32
```

### 步骤 4：部署

**方式 A:wrangler 命令行(首次部署)**

```bash
npm run deploy
# 部署完成后获得 Worker 域名，如 https://yt2bili.<你的子域>.workers.dev
```

**方式 B:全自动部署(推荐,关联 GitHub 仓库)**

1. Cloudflare Dashboard → Workers & Pages → Create application → Create Worker
2. 填写 Worker 名称(如 `yt2bili`)→ Deploy
3. 创建后进入 Worker 详情页 → Settings → Builds → Connect Git
4. 授权并选择 GitHub 仓库 `Sweizh/y2b`
5. 配置:
   - Production branch: `main`
   - Build command: `npm install`
   - Deploy command: `npx wrangler deploy`
6. 保存后,每次 push 到 `main` 分支自动部署
7. 在 Worker → Settings → Variables 中配置以下变量(构建时 + 运行时都会用到):
   - `CLOUDFLARE_KV_ID` = 你的 KV 命名空间 ID(明文,构建时供 setup.mjs 读取)
   - `CLOUDFLARE_KV_PREVIEW_ID` = 你的 KV 预览 ID(可与上面相同)
   - `ENCRYPTION_KEY` = 加密密钥(选 Encrypt,运行时供 Worker 读取)
8. 在 Worker → Settings → KV Namespace Bindings 中绑定 `YT2BILI_KV`(指向同一命名空间)

> **fork 友好**:每个 fork 用户在自己的 Worker → Settings → Variables 中配置自己的 `CLOUDFLARE_KV_ID`,互不影响。sync 上游不会覆盖,因为 `wrangler.toml` 不入库。

### 步骤 5：初始化后台

1. 访问 Worker 域名
2. 设置管理密码（首次初始化）
3. 记录控制台显示的 `pipeline_token`（仅显示一次，后续可在 `/api/config/pipeline-token` 查询或重置）

### 步骤 6：回填 GitHub Secrets

GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret:

| Secret 名称 | 值 |
|---|---|
| `WORKER_URL` | `https://yt2bili.xxx.workers.dev`(你的 Worker 域名,无尾斜杠) |
| `PIPELINE_TOKEN` | 步骤 5 中复制的 pipeline_token |

这两个 Secret 被 `.github/workflows/process.yml` 用于让 Python Runner 调用 Worker API。

### 步骤 7：填写配置

1. **B 站登录**: 点击「弹窗登录 B 站」按钮,流程如下:
   - 弹窗打开 `passport.bilibili.com/login`,用户正常登录(账号密码/扫码均可)
   - 登录成功后,在 B 站任意页面按 F12 打开开发者工具
   - 切到 **Network**(网络)标签,刷新页面(F5)
   - 点击任意请求(如 `nav`),在右侧 Headers → Request Headers 中找到 `cookie:` 行
   - 右键复制 cookie 值(整行值,包含 SESSDATA 等所有字段)
   - 回到 YT2BILI 控制台,粘贴到输入框,点「保存 Cookie」
   - 后端解析 SESSDATA/bili_jct/buvid3,加密存入 KV
   - **为什么不直接 Worker 代理登录**: B 站 passport 端点对 Cloudflare Worker IP 严格风控,即使带 buvid3 也返回 `code -412 "request was banned"`
   - **为什么不能从 Console 复制 `document.cookie`**: B 站的 SESSDATA 是 HttpOnly,JS 读不到,只能从 Network 面板的请求头复制完整 cookie
2. 填写 YouTube API Key(用于频道搜索,可选),或点「OAuth 登录 YouTube」用 Google 账号授权
3. 填写 ASR API + 翻译 API
4. 填写 GitHub Token + 仓库
5. (可选)配置「标题翻译模板」:支持变量 `{channel}`(频道名)、`{title}`(翻译后标题),示例 `【{channel}】{title}`。Runner 在上传前调翻译 API,prompt 中注入模板(预先替换 `{channel}`,LLM 只填 `{title}`)。**留空则不翻译不套模板**,沿用 yt-dlp 原始标题(向后兼容)
6. 每项填完点「测试」按钮验证连通性
7. (可选)在运行状态区块底部配置「失败通知」Webhook URL,启用后单次运行失败率 ≥ 50%(且至少 2 个视频)会发送告警

### 手动队列合集选择

在「手动添加视频」区块添加视频 URL 时,可选「B 站合集」select:
- 不选合集(默认):若绑定了频道,则用频道配置的合集;否则不进合集
- 选了合集:该视频投稿后追加到指定合集(优先于频道默认合集)

合集优先级:手动指定 > 频道默认 > 不进合集

## 全自动部署(关联 GitHub)

完成上述步骤 4 方式 B 后,系统进入全自动闭环:

```
push 到 main ──> Cloudflare 自动部署 Worker
                  │
用户点击「立即执行」
        │
        ▼
Worker 调用 GitHub dispatches API
        │
        ▼
GitHub Actions 启动 process.yml
        │
        ▼
Python Runner 拉取配置 → 下载 → 转写 → 上传 → 回写
```

后续只需修改代码并 push,Worker 自动重新部署;控制台点击「立即执行」即可触发流水线。

## 日志查看(调试用)

### 1. Worker 实时日志(wrangler tail)

本地或 CI 中执行:

```bash
npm run tail
# 等价于 wrangler tail,实时输出所有请求日志
```

输出为结构化 JSON,便于过滤:

```
{"timestamp":"2026-07-06T12:00:00Z","event":"request","status":"ok","requestId":"abc-123","method":"POST","path":"/api/login","status":200,"duration":42}
{"timestamp":"2026-07-06T12:00:05Z","event":"login","status":"success","requestId":"abc-123","duration":38}
{"timestamp":"2026-07-06T12:00:10Z","event":"trigger","status":"success","requestId":"def-456","repo":"Sweizh/y2b","duration":120}
{"timestamp":"2026-07-06T12:00:15Z","event":"pipeline_auth","status":"success","requestId":"ghi-789","path":"/api/pipeline/config"}
{"timestamp":"2026-07-06T12:00:16Z","event":"pipeline_pull","status":"success","requestId":"ghi-789","channels":3,"manualQueue":2,"processed":42}
{"timestamp":"2026-07-06T12:00:20Z","event":"pipeline_writeback","status":"success","requestId":"jkl-012","total":5,"success":4,"failed":1}
```

按 event 过滤:`wrangler tail | jq 'select(.event=="login")'`

### 2. Cloudflare Dashboard Logs

Worker 详情页 → Logs 标签:
- 免费版:实时日志流,保留 3 小时
- Workers Logs 付费版:长期保留,可搜索过滤

### 3. GitHub Actions 日志

仓库 → Actions 标签 → 点击某次 `YT2BILI Pipeline` 运行:
- 每个 step 输出完整可见(checkout / setup-python / install ffmpeg / install deps / run pipeline)
- Python Runner 输出结构化日志,与 Worker 日志格式一致
- 失败时可直接定位到具体视频和失败阶段(download / asr / translate / upload)

## 快速开始(首次使用)

```bash
# 1. 克隆仓库
git clone https://github.com/Sweizh/y2b.git
cd y2b

# 2. 安装依赖(自动生成 wrangler.toml,本地用 KV 模拟)
npm install

# 3. 配置本地环境变量
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars,填入 CLOUDFLARE_KV_ID(可选,本地不填用模拟)和 ENCRYPTION_KEY
npm run setup                    # 重新生成 wrangler.toml(读取 .dev.vars)

# 4. 本地启动
npm run dev                      # http://localhost:8787

# 5. 首次访问设置管理密码,记录 pipeline_token

# 6. 部署到 Cloudflare
npx wrangler secret put ENCRYPTION_KEY  # 输入 openssl rand -base64 32 生成的密钥
npm run deploy

# 7. 在 GitHub 仓库 Settings → Secrets 配置 WORKER_URL 和 PIPELINE_TOKEN

# 8. 后台填配置 + 点测试 → 完成
```

## 失败通知字段说明

`Config.notify_webhook` 字段用于配置失败通知 Webhook URL:

- **企业微信群机器人**:`https://qyapi.weixin.com/cgi-bin/webhook/send?key=xxx`
- **钉钉群机器人**:`https://oapi.dingtalk.com/robot/send?access_token=xxx`
- **Server 酱**:`https://sctapi.ftqq.com/SCTxxxxx.send`

启用后,Python Runner 在单次运行失败率 ≥ 50%(且至少 2 个视频)时调用该 Webhook 发送告警,内容包括失败次数、Worker URL、时间。

## API 端点一览

完整文档见 `https://blog.sweizh.top/post/y2b` §10。

### 管理接口（Cookie Session 鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/init-status` | 是否已初始化 |
| POST | `/api/config/init` | 首次初始化 |
| POST | `/api/login` | 登录 |
| POST | `/api/logout` | 登出 |
| GET | `/api/config` | 获取配置（脱敏） |
| PUT | `/api/config` | 更新配置 |
| GET | `/api/config/pipeline-token` | 获取 pipeline_token |
| POST | `/api/config/pipeline-token/reset` | 重置 pipeline_token |
| GET/POST/PUT/DELETE | `/api/channels[/:id]` | 频道 CRUD |
| GET | `/api/seasons` | 代理拉取 B 站合集列表 |
| GET | `/api/tids` | 投稿分区列表（静态表） |
| GET | `/api/youtube/search?q=` | 代理搜索 YouTube 频道 |
| GET | `/api/status` | 运行状态 |
| POST | `/api/status/trigger` | 触发 GitHub Actions |
| GET/DELETE | `/api/processed[/:videoId]` | 已处理视频 |
| GET/POST/DELETE | `/api/manual-queue[/:videoId]` | 手动视频队列 |
| POST | `/api/test/bili` | 测试 B 站 Cookie |
| POST | `/api/bili/login/cookie` | 提交 B 站 cookie 字符串(弹窗登录方案) |
| POST | `/api/test/asr` | 测试 ASR API |
| POST | `/api/test/translate` | 测试翻译 API |
| POST | `/api/test/github` | 测试 GitHub Token |

### Pipeline 接口（Bearer Token 鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pipeline/config` | 拉取全部配置 + 频道 + 去重表 + 手动队列 |
| POST | `/api/pipeline/processed` | 回写处理结果（批量），自动清理 manual_queue |
| POST | `/api/pipeline/status` | 回写运行状态 |
| POST | `/api/pipeline/cookies` | 回写刷新后的 Cookie |

## 数据存储

KV Key 设计：

| Key | 内容 | 写入频率 |
|---|---|---|
| `config` | 全局配置 JSON（敏感字段加密） | 低（用户修改 + Cookie 刷新） |
| `channels` | 频道列表 JSON 数组 | 低（用户增删） |
| `manual_queue` | 手动视频队列 | 中（用户添加 + 处理完成） |
| `processed` | 已处理视频去重表（保留最近 500 条） | 中（每次执行批量写 1 次） |
| `status` | 运行状态（保留最近 100 条记录） | 中（每次执行 1 次） |
| `session:*` | Session 记录（7 天 TTL） | 中（每次登录 + 校验） |

## Python Runner 流程

`scripts/main.py` 在 GitHub Actions 中运行,完整端到端流水线:

```
1. 拉取配置(GET /api/pipeline/config)
   ├─ 全局配置(B 站凭证 / YouTube / ASR / 翻译 / GitHub / notify_webhook)
   ├─ 启用的频道列表
   ├─ 已处理视频去重表(processed)
   └─ 手动队列(manual_queue)
2. 凭证检查与刷新
   ├─ B 站 Cookie:ac_time_value 距过期 < 1 小时 → Webhook 告警(续期需人工在控制台重新扫码登录,Runner 无法自动完成)
   └─ YouTube OAuth:access_token 剩余 ≤ 5 分钟 → POST /api/pipeline/yt-oauth-refresh 刷新(不重铸 cookies)
3. 遍历启用频道
   ├─ yt-dlp 拉取频道最新 5 条视频
   ├─ 过滤已在 processed 去重表中的 video_id
   └─ 逐个处理(见下)
4. 处理 manual_queue 中的视频(同上流程)
5. 单视频处理流程
   ├─ yt-dlp 下载视频 + 封面 + 字幕
   ├─ ffmpeg 提取音频(mp3)
   ├─ 调用 ASR API 转写音频 → SRT 字幕
   ├─ 调用翻译 API 翻译字幕(按字幕模式:翻译/原语言/双语/不上传)
   ├─ bilibili-api-python 上传视频(封面/标题/描述/标签/分区/字幕)
   └─ 如配置了合集则追加到合集(season_id/section_id)
6. 批量回写(POST /api/pipeline/processed)
   ├─ 成功:从 manual_queue 移除
   ├─ 可重试失败(网络/限流):保留 manual_queue,retry_count + 1,超过 3 次移除
   └─ 不可重试失败:从 manual_queue 移除
7. 失败通知
   └─ 单次失败率 ≥ 50%(且至少 2 个视频)且 notify_webhook 已配置 → 调用 Webhook(企业微信/钉钉/Server酱)
```

**单视频处理失败处理**:
- 每步 try/except,记录 `stage`(download/asr/translate/upload)和 `message`
- 可重试失败(网络/限流)保留在 manual_queue 等待下次运行
- 不可重试失败(永久失败)直接清理 manual_queue

**Cookie 过期处理**:
- 检测 ac_time_value 距过期时间
- < 1 小时通过 Webhook 发送告警,提示人工重新扫码登录
- B 站 SESSDATA 续期需二次登录(QR Code),Runner 无法自动完成
- 告警不影响主流程,继续使用现有 Cookie 处理(可能失败,由各步骤 try/except 捕获)

**日志输出**:
- Python Runner 输出结构化 JSON 日志,与 Worker 日志格式一致
- 含 `timestamp`/`event`/`status`/`video_id`/`stage`/`duration` 字段
- GitHub Actions 页面可查看完整运行记录

## 参考文档

- [设计稿来源](https://blog.sweizh.top/post/y2b)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare KV 文档](https://developers.cloudflare.com/kv/)
- [Hono 框架](https://hono.dev/)
- [GitHub REST API - Workflow Dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [GitHub Actions - repository_dispatch](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch)
- [bilibili-API-collect](https://sessionhu.github.io/bilibili-API-collect/)
- [YouTube Data API v3](https://developers.google.com/youtube/v3/docs)
- [yt-dlp 文档](https://github.com/yt-dlp/yt-dlp)
- [bilibili-api-python](https://github.com/Nemo2011/bilibili-api-python)

## 安全说明

- 管理密码 bcrypt 哈希存储
- 敏感字段（Cookie / API Key）AES-GCM 加密存储
- 管理接口使用 HttpOnly + Secure + SameSite=Strict Cookie
- Pipeline 接口使用 Bearer Token（不通过 URL Query 传输）
- 前端展示敏感字段时脱敏（`xxxx****xxxx` 格式）
- 未配置 `ENCRYPTION_KEY` 时退化为明文存储（仅开发环境，生产环境务必配置）

## License

MIT
