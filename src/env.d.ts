// Cloudflare Worker 环境变量类型定义
// 实际由 wrangler.toml 中的 [[kv_namespaces]] 和 `wrangler secret put` 注入

export {};
declare global {
  interface Env {
    // 业务数据 KV 命名空间
    YT2BILI_KV: KVNamespace;
    // 静态资源 KV 命名空间（[site] 配置自动注入）
    __STATIC_CONTENT: KVNamespace;
    // 加密主密钥（wrangler secret put ENCRYPTION_KEY，32 字节随机字符串）
    ENCRYPTION_KEY: string;
    // 可选:CORS 白名单,逗号分隔,如 "https://y2b.sweizh.top,https://yt2bili.xxx.workers.dev"
    // 不配置时禁用跨域(同源访问)
    ALLOWED_ORIGINS?: string;
    // 可选:B 站扫码登录中转代理 URL(绕过 CF IP 风控)
    // 配置后扫码登录走代理:Worker 调 ${BILI_PROXY_URL}/qrcode 等,代理经 Clash 出口调 B 站
    // 不配置则直连 B 站 passport(会被风控返回 -412,扫码登录不可用,只能用弹窗登录)
    // 同时需配 BILI_PROXY_TOKEN(代理鉴权,与反代脚本 PROXY_TOKEN 同值)
    BILI_PROXY_URL?: string;
    BILI_PROXY_TOKEN?: string;
  }
}

