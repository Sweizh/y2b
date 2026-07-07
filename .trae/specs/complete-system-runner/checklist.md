# Verification Checklist

## A. 原型 3 处缺口补齐

### 频道卡片字幕模式选项
- [x] 控制台「频道管理」区块所有频道配置卡片的字幕模式 select 均含 4 选项:上传翻译字幕 / 上传原语言字幕 / 双语字幕 / 不上传字幕
- [x] 卡片 1 与卡片 2(及任何新增卡片)字幕模式选项完全一致

### 已处理视频列表
- [x] 运行状态区块底部存在「已处理视频列表」子区块
- [x] 列表表头含:B 站标题 / BV 号 / 频道 / 状态 / 处理时间 / 操作
- [x] 启动时调用 `GET /api/processed` 渲染列表
- [x] `loadStatus()` 完成后自动刷新已处理视频列表
- [x] 每行末尾「删除」按钮点击弹出 Modal 二次确认
- [x] 确认后调用 `DELETE /api/processed/:videoId` 删除并刷新列表
- [x] 删除成功显示 Toast「已删除,该视频可在下次运行时重新处理」

### 失败通知配置
- [x] 运行状态区块底部存在「失败通知」配置卡片
- [x] 含启用开关 + Webhook URL 输入框 + 保存按钮
- [x] 开关关闭时 Webhook URL 输入框禁用或隐藏
- [x] 保存按钮调用 `PUT /api/config` 写入 `notify_webhook` 字段
- [x] 启动时调用 `GET /api/config` 读取 `notify_webhook` 回显
- [x] 后端 `Config.notify_webhook` 字段已存在于 `src/kv.ts`

## B. GitHub Actions Workflow

- [x] 存在 `.github/workflows/process.yml`
- [x] 触发条件包含 `repository_dispatch` 且 event_type 为 `pipeline_dispatch`
- [x] 单 job `pipeline`,runs-on `ubuntu-latest`
- [x] 步骤顺序:checkout → setup-python → apt install ffmpeg → pip install → python main.py
- [x] 通过 env 注入 `WORKER_URL` 和 `PIPELINE_TOKEN`
- [x] 两个 Secret 均在 README 的 Secrets 清单中说明

## C. Python Runner

### 依赖
- [x] 存在 `scripts/requirements.txt`
- [x] 包含 `yt-dlp`、`bilibili-api-python`、`requests`

### 主流程(`scripts/main.py`)
- [x] 通过 `GET /api/pipeline/config` 拉取全部配置(带 Bearer Token)
- [x] 对每个 `enabled=true` 的频道,使用 yt-dlp 拉取最新视频列表
- [x] 过滤已在 processed 去重表中的 video_id
- [x] 单视频处理流程:下载 → 提取音频 → ASR 转写 → 翻译字幕 → 上传 B 站 → 追加合集(若配置)
- [x] 处理 manual_queue 中的视频(同上流程)
- [x] 每步 try/except,记录 stage 和 message
- [x] 全部完成后批量调用 `POST /api/pipeline/processed` 回写结果
- [x] 可重试失败(网络/限流)保留在 manual_queue
- [x] 不可重试失败(永久失败)直接清理 manual_queue

### Cookie 续期
- [x] 检测 ac_time_value 距过期时间
- [x] < 1 小时触发续期流程
- [x] 续期成功后调用 `POST /api/pipeline/cookies` 回写新 Cookie

### 失败通知
- [x] 末尾统计连续失败次数
- [x] `notify_webhook` 已配置且连续失败 ≥ 3 次时调用 Webhook
- [x] Webhook 调用失败不影响主流程

## D. Worker 结构化日志

- [x] 顶层中间件生成 `requestId` 注入到请求头
- [x] 关键路由输出结构化 JSON 日志,含 `requestId`/`event`/`status`/`duration`
- [x] 全局 `app.onError` 输出结构化错误日志
- [x] `npx tsc --noEmit` 仍通过

## E. README 文档

- [x] 含「全自动部署」章节:Cloudflare Dashboard 连接 GitHub 仓库 → 选主分支 → 推送自动部署
- [x] 含「日志查看」章节:三种方式(wrangler tail / Cloudflare Logs / GitHub Actions 日志)
- [x] 含 GitHub Secrets 清单:`WORKER_URL` / `PIPELINE_TOKEN`
- [x] 含首次使用快速开始流程
- [x] 说明 `notify_webhook` 字段用途

## F. 端到端可运行性

- [x] 本地 `wrangler dev` 启动后,所有新增 API(`/api/processed` DELETE、`notify_webhook` 读写)工作正常
- [x] 前端 3 处缺口补齐后视觉与设计稿一致
- [x] GitHub Actions workflow YAML 语法正确(可用 `actionlint` 或 GitHub 界面校验)
- [x] Python Runner 语法正确(`python -m py_compile scripts/main.py` 通过)
- [x] 端到端链路:Worker `/api/trigger` → GitHub Actions 启动 → Python Runner 拉配置 → 处理视频 → 回写 Worker,各环节均有日志可查
