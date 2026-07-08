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

// 100ms 静音 WAV(8kHz mono 16-bit)的 base64,用于 ASR 测试音频输入。
// ASR 模型期望 input_audio 内容,纯文本会返回 400 "requires input_audio content"。
// 生成方式:Python wave + base64,见 commit 历史。
const SILENCE_WAV_BASE64 =
  'UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// 通用 fetch 请求头。某些 API 网关(如 api.sweizh.top)对缺 Accept/User-Agent 的
// 请求会返回 301 重定向到登录页,补齐后行为正常。
function apiHeaders(authKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${authKey}`,
    'User-Agent': 'yt2bili-worker/1.0',
  };
}

// 处理 3xx 重定向:manual 模式下 fetch 不自动 follow,我们手动判断一次。
// 若 Location 与请求 URL 相同(或为空),视为死循环;否则把 Location 回报给用户诊断。
function redirectError(prefix: string, status: number, endpoint: string, location: string | null): { success: false; message: string } {
  if (!location) {
    return { success: false, message: `${prefix} 返回 ${status} 重定向但无 Location 头,请检查 API 地址是否正确:${endpoint}` };
  }
  // 解析为绝对 URL 比较
  let absLoc = location;
  try { absLoc = new URL(location, endpoint).toString(); } catch {}
  if (absLoc === endpoint || location === endpoint) {
    return { success: false, message: `${prefix} 返回 ${status} 重定向到自身(死循环),请检查 API 地址是否正确:${endpoint}` };
  }
  return { success: false, message: `${prefix} 返回 ${status} 重定向到 ${absLoc},请检查 API 地址是否正确:${endpoint}` };
}

// 测试 ASR API 连通性
// 发送一段静音音频(input_audio),ASR 模型应返回转录结果(可能为空字符串)
app.post('/asr', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.asr_api || !cfg.asr_key) {
    return c.json({ success: false, message: '请先配置 ASR API 地址和密钥' }, 400);
  }
  try {
    const endpoint = buildChatCompletionsUrl(cfg.asr_api);
    const resp = await fetch(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: apiHeaders(cfg.asr_key),
      body: JSON.stringify({
        model: cfg.asr_model || 'mimo-asr',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请转录以下音频' },
            { type: 'input_audio', input_audio: { data: SILENCE_WAV_BASE64, format: 'wav' } },
          ],
        }],
        max_tokens: 64,
      }),
    });
    if (resp.status === 0 || (resp.status >= 300 && resp.status < 400)) {
      return c.json(redirectError('ASR 端点', resp.status || 301, endpoint, resp.headers.get('location')));
    }
    if (!resp.ok) {
      const text = await resp.text();
      return c.json({ success: false, message: `ASR API 返回 ${resp.status}：${text.slice(0, 200)}` });
    }
    const data = await resp.json() as any;
    // 提取转录文本用于回显
    const transcript = data?.choices?.[0]?.message?.content;
    return c.json({
      success: true,
      message: 'ASR API 连通正常' + (transcript ? `(转录:${typeof transcript === 'string' ? transcript.slice(0, 30) : '(非文本)'})` : ''),
      raw_model: data.model,
    });
  } catch (e: any) {
    return c.json({ success: false, message: '请求失败：' + (e.message || e) });
  }
});

// 测试翻译 API 连通性
// 发送一条翻译请求,收到回复即视为连通正常
app.post('/translate', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.translate_api || !cfg.translate_key) {
    return c.json({ success: false, message: '请先配置翻译 API 地址和密钥' }, 400);
  }
  try {
    const endpoint = buildChatCompletionsUrl(cfg.translate_api);
    const resp = await fetch(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: apiHeaders(cfg.translate_key),
      body: JSON.stringify({
        model: cfg.translate_model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Translate "hello" to Chinese, reply only with the translation.' }],
        max_tokens: 16,
      }),
    });
    if (resp.status === 0 || (resp.status >= 300 && resp.status < 400)) {
      return c.json(redirectError('翻译端点', resp.status || 301, endpoint, resp.headers.get('location')));
    }
    if (!resp.ok) {
      const text = await resp.text();
      return c.json({ success: false, message: `翻译 API 返回 ${resp.status}：${text.slice(0, 200)}` });
    }
    const data = await resp.json() as any;
    const reply = data?.choices?.[0]?.message?.content;
    return c.json({
      success: true,
      message: '翻译 API 连通正常' + (reply ? `(回复:${typeof reply === 'string' ? reply.slice(0, 30) : '(非文本)'})` : ''),
    });
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
