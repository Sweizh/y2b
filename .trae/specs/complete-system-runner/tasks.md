# Tasks

> 实施约定:
> - 工作目录 `/workspace/y2b`(已含 Worker 后端 + 前端原型)
> - 后端改动需保持 `npx tsc --noEmit` 通过
> - Python Runner 跑在 GitHub Actions ubuntu-latest,本地不强制实测,但语法必须正确
> - 部署文档写在 README.md,不创建新文档

- [x] Task 1: 补齐频道卡片字幕模式选项
  - [x] SubTask 1.1: 在 `public/控制台.html` 找到第 2 张频道配置卡片的字幕模式 select
  - [x] SubTask 1.2: 补齐为 4 选项:上传翻译字幕 / 上传原语言字幕 / 双语字幕 / 不上传字幕,与卡片 1 一致
- [x] Task 2: 已处理视频列表 UI + 删除交互
  - [x] SubTask 2.1: 在运行状态区块(`#section-status`)底部新增「已处理视频列表」子区块,含表头(B 站标题 / BV 号 / 频道 / 状态 / 处理时间 / 操作)
  - [x] SubTask 2.2: 启动时调用 `GET /api/processed` 渲染列表;`loadStatus()` 后自动刷新
  - [x] SubTask 2.3: 每行末尾「删除」按钮:Modal 二次确认 → `DELETE /api/processed/:videoId` → 移除行 + Toast
- [x] Task 3: 失败通知配置 UI + 后端字段
  - [x] SubTask 3.1: 在运行状态区块底部新增「失败通知」配置卡片:开关 + Webhook URL 输入框 + 保存按钮
  - [x] SubTask 3.2: 保存按钮调用 `PUT /api/config` 写入 `notify_webhook` 字段(开关关闭时传空字符串)
  - [x] SubTask 3.3: 启动时调用 `GET /api/config` 读取 `notify_webhook` 回显到表单
- [x] Task 4: GitHub Actions workflow
  - [x] SubTask 4.1: 新建 `.github/workflows/process.yml`
  - [x] SubTask 4.2: 触发条件 `repository_dispatch`,event_type=`pipeline_dispatch`
  - [x] SubTask 4.3: 单 job `pipeline`,runs-on `ubuntu-latest`
  - [x] SubTask 4.4: 步骤:checkout → setup-python 3.11 → apt 安装 ffmpeg → pip install -r scripts/requirements.txt → python scripts/main.py
  - [x] SubTask 4.5: 通过 env 注入 `WORKER_URL` 和 `PIPELINE_TOKEN`(均来自 GitHub Secrets)
- [x] Task 5: Python Runner 依赖清单
  - [x] SubTask 5.1: 新建 `scripts/requirements.txt`:`yt-dlp`、`bilibili-api-python`、`requests`
- [x] Task 6: Python Runner 主流程
  - [x] SubTask 6.1: 新建 `scripts/main.py`,实现 `GET /api/pipeline/config` 拉取
  - [x] SubTask 6.2: 对每个启用频道,用 yt-dlp 拉取最新视频列表(默认取最新 5 条)
  - [x] SubTask 6.3: 过滤已在 processed 去重表中的 video_id
  - [x] SubTask 6.4: 对每个待处理视频依次执行:yt-dlp 下载 → ffmpeg 提取音频 → ASR 转写 → 翻译字幕 → bilibili-api-python 上传 → 追加合集(若配置)
  - [x] SubTask 6.5: 处理 manual_queue 中的视频(同上流程)
  - [x] SubTask 6.6: 每步 try/except 记录 stage + message,可重试失败保留 manual_queue
  - [x] SubTask 6.7: 全部完成后 `POST /api/pipeline/processed` 批量回写结果
- [x] Task 7: Cookie 自动续期
  - [x] SubTask 7.1: 在 main.py 中检测 ac_time_value 距过期时间,<1 小时触发续期
  - [x] SubTask 7.2: 使用现有凭证调用 B 站刷新接口,新 Cookie 通过 `POST /api/pipeline/cookies` 回写
- [x] Task 8: 失败通知发送
  - [x] SubTask 8.1: 在 main.py 末尾统计连续失败次数
  - [x] SubTask 8.2: 若 `notify_webhook` 已配置且连续失败 ≥ 3 次,调用 Webhook 发送告警
- [x] Task 9: Worker 结构化日志
  - [x] SubTask 9.1: 在 `src/index.ts` 顶层中间件生成 `requestId` 并注入到 `c.req.raw` 的 header
  - [x] SubTask 9.2: 在关键路由(auth/config/init/login/trigger/test/pipeline/*)增加 `console.log(JSON.stringify({requestId, event, status, duration}))`
  - [x] SubTask 9.3: 全局错误处理 `app.onError` 输出结构化错误日志
- [x] Task 10: README 全自动部署 + 日志查看章节
  - [x] SubTask 10.1: 补充「全自动部署」章节:Cloudflare Dashboard 连接 GitHub 仓库 → 选主分支 → 推送自动部署
  - [x] SubTask 10.2: 补充「日志查看」章节:`wrangler tail` 实时日志 / Cloudflare Dashboard Logs / GitHub Actions 日志三种方式
  - [x] SubTask 10.3: 补充 GitHub Secrets 清单:`WORKER_URL` / `PIPELINE_TOKEN`
  - [x] SubTask 10.4: 补充首次使用快速开始流程

# Task Dependencies
- [Task 1]、[Task 2]、[Task 3] 相互独立,可并行
- [Task 4] 独立,可并行
- [Task 5] 独立,可并行
- [Task 6] 依赖 [Task 5]
- [Task 7] 依赖 [Task 6]
- [Task 8] 依赖 [Task 6]
- [Task 9] 独立,可并行
- [Task 10] 依赖 [Task 4]、[Task 6] 完成后写最终文档
