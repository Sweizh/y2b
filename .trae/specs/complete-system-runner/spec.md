# 完整系统:补齐原型缺口 + GitHub Actions + Python Runner + 全自动部署

## Why

当前 `/workspace/y2b` 仓库已交付 Cloudflare Worker 后端 + 前端原型,但:
1. 文档对照报告中发现 3 处缺口未补齐(字幕选项/已处理视频删除/失败通知开关)
2. 没有 GitHub Actions workflow,Worker 的 `/api/trigger` 端点无法真正触发流水线
3. 没有 Python Runner,实际下载/转译/投稿流程无法执行
4. 用户希望最终支持「关联 GitHub 仓库→填写必要信息→自动部署→日志查看」的全自动闭环

补齐这四块后,系统将真正端到端可跑通。

## What Changes

### A. 补齐原型 3 处缺口(前端 + 后端 API)
- 频道管理区块卡片 2 的字幕模式 select 补齐为 4 选项(上传翻译字幕 / 上传原语言字幕 / 双语字幕 / 不上传字幕),与卡片 1 一致
- 运行状态区块新增「已处理视频列表」子区块:表格展示已处理视频(B 站标题 / BV 号 / 频道 / 状态 / 处理时间),每行末尾有「删除」按钮,删除后该视频可被流水线重新处理(对应 `DELETE /api/processed/:videoId`)
- 运行状态区块新增「失败通知」配置开关:启用后输入 Webhook/Server酱 URL,保存到 `/api/config`(新增字段 `notify_webhook`),Cookie 失效或连续失败时由 Pipeline 在回写状态时触发告警

### B. GitHub Actions Workflow
- 新增 `.github/workflows/process.yml`:
  - 触发条件:`repository_dispatch` 事件,event_type=`pipeline_dispatch`
  - 单 job `pipeline`,runs-on `ubuntu-latest`
  - 步骤:checkout → 装 Python → 装 ffmpeg/yt-dlp → `pip install -r scripts/requirements.txt` → `python scripts/main.py`
  - 通过环境变量注入 `WORKER_URL` 和 `PIPELINE_TOKEN`(GitHub Secrets)
  - Runner 完成后由 Python 脚本本身回写 `/api/pipeline/processed`

### C. Python Runner(`scripts/main.py` + `scripts/requirements.txt`)
- `main.py` 主流程(参考博客文档 §4):
  1. `GET /api/pipeline/config` 拉取全部配置 + 频道 + 去重表 + 手动队列
  2. 对每个启用的频道,用 YouTube RSS/API 拉取最新视频列表
  3. 过滤已在去重表中的 video_id
  4. 对每个待处理视频:
     a. yt-dlp 下载视频 + 缩略图 + 字幕(如有)
     b. ffmpeg 提取音频
     c. 调用 ASR API 转写音频 → 字幕文件
     d. 调用翻译 API 翻译字幕
     e. 调用 bilibili-api-python 上传视频(带封面/标题/描述/标签/分区)
     f. 如配置了合集则追加到合集
     g. 调用 `POST /api/pipeline/processed` 回写结果
  5. 处理 manual_queue 中的视频(同上流程)
  6. 全部完成后 `POST /api/pipeline/status` 回写最终状态
- `requirements.txt`:`yt-dlp`、`bilibili-api-python`、`requests`
- 失败处理:单视频失败记录 `stage` 和 `message`;可重试失败(网络/限流)保留在 manual_queue;不可重试(永久失败)直接清理
- Cookie 续期:若发现 ac_time_value 即将过期(<1 小时),用现有凭证调用 B 站刷新接口,新 Cookie 通过 `POST /api/pipeline/cookies` 回写
- 失败通知:若 `notify_webhook` 已配置,连续失败 ≥ 3 次时调用 Webhook 告警

### D. 全自动部署 + 日志查看
- README 补充「全自动部署」章节:
  - Cloudflare Dashboard → Workers → 连接 GitHub 仓库 → 选 `Sweizh/y2b` → 主分支推送自动部署
  - 部署后自动创建 KV 命名空间(若未配置)
- 部署后日志查看方式:
  - `wrangler tail` 实时流式日志(已支持,在 README 说明)
  - Cloudflare Dashboard → Workers → Logs(实时日志流,免费版保留 3 小时,Workers Logs 付费版长期)
  - GitHub Actions 日志(每次流水线触发的运行记录,免费)
- 在 Worker 中增加结构化日志输出(`console.log` JSON),便于 tail 时过滤
- Worker 在关键路径(初始化/登录/触发/测试/Pipeline 回写)输出结构化日志,带 `requestId`、`event`、`status` 字段

## Impact

- Affected specs: `enhance-dashboard-interactions`(前端原型 spec,部分 checkpoint 需回标为已验证)
- Affected code:
  - `public/控制台.html`(前端 3 处缺口)
  - `src/routes/config.ts`(新增 `notify_webhook` 字段处理)
  - `src/routes/processed.ts`(已存在 DELETE 端点,前端补 UI 即可)
  - `src/kv.ts`(`Config.notify_webhook` 已在接口里,无需改)
  - `src/index.ts`(增加结构化日志中间件)
  - 新增 `.github/workflows/process.yml`
  - 新增 `scripts/main.py` + `scripts/requirements.txt`
  - 更新 `README.md`(全自动部署 + 日志查看章节)

## ADDED Requirements

### Requirement: 频道卡片字幕模式选项完整
系统 SHALL 在所有频道配置卡片中提供 4 种字幕模式选项,与文档要求一致。

#### Scenario: 卡片 2 字幕模式选项完整
- **WHEN** 用户查看任意频道配置卡片的字幕模式下拉框
- **THEN** 下拉框包含 4 个选项:上传翻译字幕 / 上传原语言字幕 / 双语字幕 / 不上传字幕

### Requirement: 已处理视频列表与删除触发重新处理
系统 SHALL 在运行状态区块提供已处理视频列表,每条记录可删除以触发重新处理。

#### Scenario: 删除已处理视频触发重新处理
- **WHEN** 用户在已处理视频列表点击某条记录的「删除」按钮并确认
- **THEN** 调用 `DELETE /api/processed/:videoId` 删除该条记录
- **AND** 后续流水线运行时该视频将重新被处理

### Requirement: 失败通知配置
系统 SHALL 允许配置失败通知 Webhook URL,在流水线连续失败时触发告警。

#### Scenario: 配置失败通知
- **WHEN** 用户在运行状态区块启用「失败通知」开关并填写 Webhook URL
- **AND** 点击保存
- **THEN** 配置通过 `PUT /api/config` 写入 `notify_webhook` 字段
- **AND** 后续流水线连续失败 ≥ 3 次时调用该 Webhook 发送告警

### Requirement: GitHub Actions Workflow 触发流水线
系统 SHALL 通过 GitHub Actions workflow 接收 Worker 触发的 `pipeline_dispatch` 事件并运行 Python Runner。

#### Scenario: Worker 触发流水线
- **WHEN** 用户在控制台点击「立即执行」
- **THEN** Worker 调用 `POST /repos/{owner}/{repo}/dispatches` 触发 GitHub Actions
- **AND** Workflow 接收 `repository_dispatch` 事件后启动 Runner

### Requirement: Python Runner 端到端处理
系统 SHALL 通过 Python Runner 完成从 YouTube 下载到 B 站投稿的完整流程。

#### Scenario: 单视频处理成功
- **WHEN** Runner 拉取到待处理视频
- **THEN** 依次执行:下载 → 提取音频 → ASR 转写 → 翻译字幕 → 上传 B 站 → 追加合集(若配置)
- **AND** 每步成功后记录 stage
- **AND** 全部完成后回写 `POST /api/pipeline/processed` 标记成功

#### Scenario: 单视频处理失败
- **WHEN** Runner 处理过程中某步骤抛出异常
- **THEN** 记录失败 stage 和 message
- **AND** 回写 `POST /api/pipeline/processed` 标记失败并附 stage/message
- **AND** 若失败可重试(网络/限流),保留在 manual_queue 等待下次运行

### Requirement: Cookie 自动续期
系统 SHALL 在 Cookie 即将过期时自动续期并回写 Worker。

#### Scenario: ac_time_value 即将过期
- **WHEN** Runner 检测到 ac_time_value 距过期 < 1 小时
- **THEN** 使用现有凭证调用 B 站刷新接口获取新 Cookie
- **AND** 通过 `POST /api/pipeline/cookies` 回写新凭证

### Requirement: 全自动部署
系统 SHALL 支持通过 Cloudflare Dashboard 关联 GitHub 仓库实现全自动部署。

#### Scenario: 关联仓库自动部署
- **WHEN** 用户在 Cloudflare Dashboard 连接 GitHub 仓库 `Sweizh/y2b` 并选择主分支
- **THEN** 每次 push 到主分支自动触发 Worker 部署
- **AND** 部署后访问 Worker 域名即可使用

### Requirement: 部署后日志查看
系统 SHALL 提供多种日志查看方式便于调试。

#### Scenario: 实时查看 Worker 日志
- **WHEN** 用户执行 `wrangler tail`
- **THEN** 实时输出 Worker 所有请求日志,含结构化字段(requestId/event/status)

#### Scenario: 查看 GitHub Actions 日志
- **WHEN** 用户在 GitHub Actions 页面查看某次流水线运行
- **THEN** 可看到 Runner 每一步输出(下载/ASR/翻译/上传等)

### Requirement: 结构化日志输出
系统 SHALL 在 Worker 关键路径输出结构化日志。

#### Scenario: 关键路径日志
- **WHEN** Worker 处理初始化/登录/触发/测试/Pipeline 回写请求
- **THEN** 输出 JSON 格式日志,包含 `requestId`、`event`、`status`、`duration` 字段
- **AND** `wrangler tail` 可按字段过滤

## MODIFIED Requirements

### Requirement: 控制台运行状态区块
原有:展示上次运行时间、累计处理数、处理记录表、「立即执行」按钮
修改为:在原有基础上新增「已处理视频列表」子区块(含删除按钮)和「失败通知」配置开关
