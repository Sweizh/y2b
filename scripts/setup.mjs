#!/usr/bin/env node
/**
 * 从 wrangler.toml.example 模板 + 环境变量生成本地 wrangler.toml
 *
 * 优先级(从高到低):
 *   1. 进程环境变量 process.env.CLOUDFLARE_KV_ID
 *   2. .dev.vars 文件中的 CLOUDFLARE_KV_ID
 *   3. 默认占位符 local-dev-simulation(wrangler dev 会用本地 KV 模拟)
 *
 * 触发场景:
 *   - 本地: `npm install`(postinstall 自动运行)或 `npm run setup`
 *   - Cloudflare Dashboard Git 部署: Build command 运行 `npm install` 时触发
 *     (此时 CLOUDFLARE_KV_ID 从 Worker → Settings → Variables 读取)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// 手动解析 .dev.vars(不依赖 dotenv,避免额外依赖)
function loadDevVars() {
  if (!existsSync('.dev.vars')) return {};
  const content = readFileSync('.dev.vars', 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    // 去除首尾引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

// 合并环境变量:.dev.vars 优先级低于 process.env
const devVars = loadDevVars();
const env = { ...devVars, ...process.env };

// 读取 KV id
// 生产环境(Cloudflare Git 部署或 CI):必须显式配置 CLOUDFLARE_KV_ID,未配置则报错退出
// 本地开发:未配置时用 local-dev-simulation,wrangler dev 会用本地 KV 模拟
const isCI = !!env.CI || !!env.CLOUDFLARE_BUILD_ID;
const kvId = env.CLOUDFLARE_KV_ID || (isCI ? '' : 'local-dev-simulation');
const kvPreviewId = env.CLOUDFLARE_KV_PREVIEW_ID || kvId;

if (!kvId) {
  console.error('');
  console.error('✗ 生产部署环境未配置 CLOUDFLARE_KV_ID,无法生成有效的 wrangler.toml');
  console.error('');
  console.error('  请在 Cloudflare Dashboard 配置该环境变量:');
  console.error('    Worker → Settings → Variables → Add variable');
  console.error('    名称: CLOUDFLARE_KV_ID');
  console.error('    值:   你的 KV 命名空间 ID(Workers & Pages → KV → 复制 ID)');
  console.error('    类型: Plaintext(明文,构建时读取)');
  console.error('');
  console.error('  同时建议配置 CLOUDFLARE_KV_PREVIEW_ID(可与上面相同)');
  console.error('');
  process.exit(1);
}

// 如果 wrangler.toml 已存在,不覆盖(避免用户手动修改丢失)
if (existsSync('wrangler.toml')) {
  console.log('✓ wrangler.toml 已存在,跳过生成(如需重新生成请先删除它)');
  process.exit(0);
}

// 检查模板文件
if (!existsSync('wrangler.toml.example')) {
  console.error('✗ wrangler.toml.example 模板文件不存在');
  process.exit(1);
}

// 从模板生成 wrangler.toml
let template = readFileSync('wrangler.toml.example', 'utf8');
// 兼容两种占位符语法:${VAR} 和 __VAR__
template = template.replaceAll('${CLOUDFLARE_KV_ID}', kvId);
template = template.replaceAll('${CLOUDFLARE_KV_PREVIEW_ID}', kvPreviewId);
template = template.replaceAll('__CLOUDFLARE_KV_ID__', kvId);
template = template.replaceAll('__CLOUDFLARE_KV_PREVIEW_ID__', kvPreviewId);

writeFileSync('wrangler.toml', template);

if (kvId === 'local-dev-simulation') {
  console.log('✓ 已生成 wrangler.toml (本地开发模式,使用 KV 模拟)');
  console.log('  生产部署前请在 .dev.vars 填入真实 CLOUDFLARE_KV_ID,然后重新运行 npm run setup');
} else {
  console.log(`✓ 已生成 wrangler.toml (KV_ID=${kvId.slice(0, 8)}...)`);
}
