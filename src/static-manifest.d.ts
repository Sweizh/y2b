// wrangler 在构建时注入的静态资源 manifest 模块（[site] 配置）
// 内容是 JSON 字符串: { "index.html": "index.375bd5c05f.html", ... }
// 该模块由 wrangler 在构建时虚拟注入,tsc 需要手动声明类型
declare module '__STATIC_CONTENT_MANIFEST' {
  const manifest: string;
  export default manifest;
}
