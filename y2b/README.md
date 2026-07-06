# YT2BILI

YouTube 到 Bilibili 自动化搬运系统的 Web 管理后台。基于 Cloudflare Workers + KV + Hono 框架实现，单仓库前后端一体。

## 功能

- **登录鉴权**：bcrypt 密码哈希 + HttpOnly Cookie Session
- **凭证管理**：B 站 / YouTube / GitHub / ASR / 翻译 API 密钥，AES-GCM 加密存储，前端脱敏回显
- **频道管理**：搜索 YouTube 频道 → 关注 → 配置合集/分区/标签/字幕模式
- **运行状态**：上次运行时间、累计处理数、处理记录表（含状态色标）、立即触发流水线
- **手动队列**：多行 URL 批量添加（支持完整 URL / 短链接 / 纯视频 ID）、删除二次确认
- **Pipeline API**：供 GitHub Actions Runner 调用，Bearer Token 鉴权
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
| 部署 | wrangler |

## 项目结构

```
y2b/
├── src/
│   ├── index.ts              # Worker 入口，路由组装 + 鉴权中间件
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
│       ├── status.ts         # GET /api/status + POST /api/trigger
│       ├── processed.ts      # GET/DELETE /api/processed
│       ├── manual.ts         # CRUD /api/manual-queue
│       ├── tests.ts          # /api/test/{asr,translate,github}
│       └── pipeline.ts       # /api/pipeline/{config,processed,status,cookies}（Bearer Token）
├── public/
│   ├── index.html            # 入口，自动跳转登录页或控制台
│   ├── 登录.html
│   └── 控制台.html
├── wrangler.toml
├── package.json
├── tsconfig.json
└── .dev.vars                # 本地开发环境变量（不入库）
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

`.dev.vars` 文件示例：

```
ENCRYPTION_KEY="任意长度的字符串，会自动经 SHA-256 派生为 32 字节 AES 密钥"
```

## 部署指南

### 步骤 1：准备 Cloudflare 资源

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → KV → 创建命名空间 `YT2BILI_KV`
3. 复制命名空间 ID，填入 `wrangler.toml` 的 `id` 字段

### 步骤 2：配置 wrangler.toml

```toml
[[kv_namespaces]]
binding = "YT2BILI_KV"
id = "你的KV命名空间ID"
preview_id = "你的KV预览ID"  # 可与 id 相同
```

### 步骤 3：设置加密密钥

```bash
npx wrangler secret put ENCRYPTION_KEY
# 输入任意长度的随机字符串，建议使用：
# openssl rand -base64 32
```

### 步骤 4：部署

```bash
npm run deploy
# 部署完成后获得 Worker 域名，如 https://yt2bili.<你的子域>.workers.dev
```

或连接 GitHub 仓库自动部署：Dashboard → Workers → 连接 GitHub 仓库 → 主分支推送后自动部署。

### 步骤 5：初始化后台

1. 访问 Worker 域名
2. 设置管理密码（首次初始化）
3. 记录控制台显示的 `pipeline_token`（仅显示一次，后续可在 `/api/config/pipeline-token` 查询或重置）

### 步骤 6：回填 GitHub Secrets

```
WORKER_URL    = https://yt2bili.xxx.workers.dev
PIPELINE_TOKEN = 步骤 5 中复制的 pipeline_token
```

### 步骤 7：填写配置

1. 后台填写 B 站 Cookie（4 个字段：SESSDATA / bili_jct / buvid3 / ac_time_value）
2. 填写 YouTube API Key（用于频道搜索，可选）
3. 填写 ASR API + 翻译 API
4. 填写 GitHub Token + 仓库
5. 每项填完点「测试」按钮验证连通性

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
| POST | `/api/trigger` | 触发 GitHub Actions |
| GET/DELETE | `/api/processed[/:videoId]` | 已处理视频 |
| GET/POST/DELETE | `/api/manual-queue[/:videoId]` | 手动视频队列 |
| POST | `/api/test/bili` | 测试 B 站 Cookie |
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

## 参考文档

- [设计稿来源](https://blog.sweizh.top/post/y2b)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare KV 文档](https://developers.cloudflare.com/kv/)
- [Hono 框架](https://hono.dev/)
- [GitHub REST API - Workflow Dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [bilibili-API-collect](https://sessionhu.github.io/bilibili-API-collect/)
- [YouTube Data API v3](https://developers.google.com/youtube/v3/docs)

## 安全说明

- 管理密码 bcrypt 哈希存储
- 敏感字段（Cookie / API Key）AES-GCM 加密存储
- 管理接口使用 HttpOnly + Secure + SameSite=Strict Cookie
- Pipeline 接口使用 Bearer Token（不通过 URL Query 传输）
- 前端展示敏感字段时脱敏（`xxxx****xxxx` 格式）
- 未配置 `ENCRYPTION_KEY` 时退化为明文存储（仅开发环境，生产环境务必配置）

## License

MIT
