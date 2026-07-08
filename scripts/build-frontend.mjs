#!/usr/bin/env node
/**
 * build-frontend.mjs — 前端构建入口
 *
 * 职责:
 *   1. 调用 @tailwindcss/cli 编译 public/css/src/app.css → public/css/dist/app.css
 *   2. 调用 esbuild 打包 public/js/src/console.mjs → public/js/dist/console.js
 *      (target ES2020, format esm, minify)
 *   3. 调用 esbuild 打包 public/js/src/login.mjs  → public/js/dist/login.js (同上)
 *
 * 说明:
 *   - CSS 构建总会执行(app.css 是本任务产出的真实源文件,替换 console.html 里的
 *     CDN 运行时编译,消除首屏 FOUC)。
 *   - JS 源文件由后续 Task 2/3/4 创建;在它们出现前,JS 构建会优雅跳过(仅警告,
 *     不失败),这样 `npm run deploy` 在仅有 CSS 源文件时仍可正常工作。一旦源文件
 *     落位,构建会自动产出 bundle。
 *   - 任一已执行的构建步骤失败,进程以非 0 退出。
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const cssSrc = resolve(root, 'public/css/src/app.css');
const cssOut = resolve(root, 'public/css/dist/app.css');
const cssOutDir = dirname(cssOut);

const jsEntries = [
  { src: resolve(root, 'public/js/src/console.mjs'), out: resolve(root, 'public/js/dist/console.js'), label: 'console' },
  { src: resolve(root, 'public/js/src/login.mjs'),   out: resolve(root, 'public/js/dist/login.js'),   label: 'login'   },
];
const jsOutDir = resolve(root, 'public/js/dist');

function log(...args) { console.log('[build:frontend]', ...args); }
function warn(...args) { console.warn('[build:frontend] WARN:', ...args); }

// 构建产物目录在 .gitignore 中,运行时确保存在
mkdirSync(cssOutDir, { recursive: true });
mkdirSync(jsOutDir, { recursive: true });

function buildCss() {
  const bin = resolve(root, 'node_modules/.bin/tailwindcss');
  if (!existsSync(bin)) {
    throw new Error(`tailwindcss CLI not found at ${bin}. Run \`npm install\` first.`);
  }
  log('tailwindcss: compiling CSS');
  log(`  input:  ${cssSrc}`);
  log(`  output: ${cssOut}`);
  execFileSync(bin, ['-i', cssSrc, '-o', cssOut, '--minify'], { cwd: root, stdio: 'inherit' });
  log('tailwindcss: done ✓');
}

async function buildJs({ src, out, label }) {
  if (!existsSync(src)) {
    warn(`esbuild[${label}]: source not found, skipping (${src})`);
    return;
  }
  log(`esbuild[${label}]: bundling`);
  log(`  input:  ${src}`);
  log(`  output: ${out}`);
  await build({
    entryPoints: [src],
    outfile: out,
    bundle: true,
    target: 'es2020',
    format: 'esm',
    minify: true,
    sourcemap: false,
    logLevel: 'warning',
  });
  log(`esbuild[${label}]: done ✓`);
}

async function main() {
  // 1. CSS 构建(tailwindcss CLI,同步执行)
  buildCss();
  // 2. JS bundle 构建(esbuild JS API,并行执行)
  await Promise.all(jsEntries.map(buildJs));
  log('all build steps completed ✓');
}

main().catch((err) => {
  console.error('');
  console.error('✗ build:frontend failed:');
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
