// 连通性测试路由：ASR / 翻译 / GitHub

import { Hono } from 'hono';
import { getRawConfig } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 把用户配置的 base URL 补全为 OpenAI 兼容的 /chat/completions 端点
// 兼容两种填法:
//   1. https://api.example.com/v1          → 补成 .../v1/chat/completions
//   2. https://api.example.com/v1/chat/completions → 原样使用
// 与 scripts/main.py 的 buildChatCompletionsUrl 保持一致
function buildChatCompletionsUrl(baseUrl: string): string {
  let url = baseUrl.trim();
  // 去掉尾部斜杠
  while (url.endsWith('/')) url = url.slice(0, -1);
  // 已是完整 chat/completions 端点,原样返回
  if (url.endsWith('/chat/completions')) return url;
  // 否则补 /chat/completions
  return url + '/chat/completions';
}

// 测试 ASR API 连通性
// MiMo ASR 端点:https://api.xiaomimimo.com/v1/chat/completions
// 用户可填 base URL (https://api.xiaomimimo.com/v1) 或完整端点
app.post('/asr', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.asr_api || !cfg.asr_key) {
    return c.json({ success: false, message: '请先配置 ASR API 地址和密钥' }, 400);
  }
  try {
    const endpoint = buildChatCompletionsUrl(cfg.asr_api);
    const resp = await fetch(endpoint, {
      method: 'POST',
      // manual:避免某些 API 网关返回 30x 到自身导致 Worker fetch 死循环
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.asr_key}`,
      },
      body: JSON.stringify({
        model: cfg.asr_model || 'mimo-asr',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 8,
      }),
    });
    // opaqueredirect / 3xx:服务端返回了重定向,manual 模式下无法读 body
    if (resp.type === 'opaqueredirect' || resp.status === 0 || (resp.status >= 300 && resp.status < 400)) {
      return c.json({
        success: false,
        message: `ASR 端点返回 ${resp.status} 重定向(可能死循环),请检查 API 地址是否正确:${endpoint}`,
      });
    }
    if (!resp.ok) {
      const text = await resp.text();
      return c.json({ success: false, message: `ASR API 返回 ${resp.status}：${text.slice(0, 200)}` });
    }
    const data = await resp.json() as any;
    return c.json({
      success: true,
      message: 'ASR API 连通正常',
      raw_model: data.model,
    });
  } catch (e: any) {
    return c.json({ success: false, message: '请求失败：' + (e.message || e) });
  }
});

// 测试翻译 API 连通性
// 用户可填 base URL (https://api.example.com/v1) 或完整端点
app.post('/translate', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.translate_api || !cfg.translate_key) {
    return c.json({ success: false, message: '请先配置翻译 API 地址和密钥' }, 400);
  }
  try {
    const endpoint = buildChatCompletionsUrl(cfg.translate_api);
    const resp = await fetch(endpoint, {
      method: 'POST',
      // manual:避免某些 API 网关返回 30x 到自身导致 Worker fetch 死循环
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.translate_key}`,
      },
      body: JSON.stringify({
        model: cfg.translate_model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Translate "hello" to Chinese, reply only with the translation.' }],
        max_tokens: 16,
      }),
    });
    // opaqueredirect / 3xx:服务端返回了重定向,manual 模式下无法读 body
    if (resp.type === 'opaqueredirect' || resp.status === 0 || (resp.status >= 300 && resp.status < 400)) {
      return c.json({
        success: false,
        message: `翻译端点返回 ${resp.status} 重定向(可能死循环),请检查 API 地址是否正确:${endpoint}`,
      });
    }
    if (!resp.ok) {
      const text = await resp.text();
      return c.json({ success: false, message: `翻译 API 返回 ${resp.status}：${text.slice(0, 200)}` });
    }
    return c.json({ success: true, message: '翻译 API 连通正常' });
  } catch (e: any) {
    return c.json({ success: false, message: '请求失败：' + (e.message || e) });
  }
});

// 测试 GitHub Token 权限
// 参考 GitHub REST API: https://docs.github.com/en/rest/repos/repos#get-a-repository
app.post('/github', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.gh_token || !cfg.gh_repo) {
    return c.json({ success: false, message: '请先配置 GitHub Token 和仓库' }, 400);
  }
  const [owner, repo] = cfg.gh_repo.split('/');
  if (!owner || !repo) {
    return c.json({ success: false, message: 'GitHub 仓库格式不正确' }, 400);
  }
  try {
    // 测试仓库访问 + actions 权限
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${cfg.gh_token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yt2bili-worker',
      },
    });
    if (resp.status === 404) {
      return c.json({ success: false, message: '仓库不存在或 Token 无权访问' });
    }
    if (!resp.ok) {
      const text = await resp.text();
      return c.json({ success: false, message: `GitHub API 返回 ${resp.status}：${text.slice(0, 200)}` });
    }
    const data = await resp.json() as any;
    // 测试 workflow 访问权限
    const workflowsResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows`, {
      headers: {
        'Authorization': `Bearer ${cfg.gh_token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yt2bili-worker',
      },
    });
    const workflowsOk = workflowsResp.ok;
    return c.json({
      success: true,
      message: `GitHub Token 有效，可访问仓库 ${data.full_name}${workflowsOk ? '，Actions 权限正常' : '，但 Actions 权限可能不足'}`,
      repo_info: {
        full_name: data.full_name,
        private: data.private,
        default_branch: data.default_branch,
      },
      actions_readable: workflowsOk,
    });
  } catch (e: any) {
    return c.json({ success: false, message: '请求失败：' + (e.message || e) });
  }
});

export default app;
