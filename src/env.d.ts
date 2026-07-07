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
  }
}
