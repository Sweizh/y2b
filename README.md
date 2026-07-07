# y2b

YouTube 到 Bilibili 自动化搬运系统。基于 Cloudflare Workers + GitHub Actions + Python Runner 实现端到端全自动闭环。

## 仓库结构

```
.
├── y2b/                     # 主项目目录
│   ├── src/                 # Cloudflare Worker 后端(Hono + KV)
│   ├── public/              # 前端(登录页 + 控制台)
│   ├── scripts/             # Python Runner(yt-dlp + ffmpeg + bilibili-api-python)
│   ├── .github/workflows/   # GitHub Actions workflow
│   └── README.md            # 详细文档
└── README.md                # 本文件
```

## 功能概览

- **Web 管理后台**:登录鉴权 / 凭证管理(AES-GCM 加密) / 频道管理 / 运行状态
- **GitHub Actions 流水线**:`repository_dispatch` 触发,Python Runner 自动下载→转写→翻译→上传
- **Cookie 自动续期**:ac_time_value 即将过期时自动刷新回写
- **失败通知**:连续失败 ≥ 3 次调用 Webhook(企业微信/钉钉/Server酱)
- **结构化日志**:Worker + Runner 均输出 JSON 日志,支持 `wrangler tail` 实时过滤
- **全自动部署**:Cloudflare Dashboard 关联 GitHub 仓库,push 自动部署

## 快速开始

```bash
git clone https://github.com/Sweizh/y2b.git
cd y2b/y2b
npm install
cp .dev.vars.example .dev.vars  # 编辑加密密钥
npm run dev                      # http://localhost:8787
```

详细部署、配置、API 文档见 [y2b/README.md](./y2b/README.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Cloudflare Workers + Hono + KV |
| 前端 | 原生 HTML + Tailwind CSS v4 + Lucide Icons |
| CI/CD | GitHub Actions (`repository_dispatch`) |
| Runner | Python 3.11 + yt-dlp + ffmpeg + bilibili-api-python |
| 部署 | wrangler / Cloudflare Dashboard Git 集成 |

## License

MIT
