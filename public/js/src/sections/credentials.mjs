// credentials.mjs — 账号凭证 section (migrated from console.html)
//
// Migrated source ranges:
//   helpTexts / helpFieldMap + label help-button injection  (lines 1048-1094)
//   loadConfigToForm() — credential fields + login-status echo (lines 1227-1288)
//   setupSave() for the credentials section                  (lines 1332-1453)
//   bindTestButtons() — credentials test endpoints           (lines 1457-1510)
//
// Public API:
//   loadConfig()      → GET /api/config ONCE, cache & return the parsed config.
//                       Shared with ai-services.mjs (and any other section that
//                       needs the same payload) so /api/config is fetched a single
//                       time per page load. On failure the cache slot is cleared so
//                       a later caller can retry.
//   getHelpText(key)  → look up {title, html} help content by config field key
//                       (covers both credential AND AI-service keys, since the
//                       original helpTexts map is shared between the two sections).
//   initCredentials() → wire up #section-credentials: inject "获取方式" help
//                       buttons, bind save (dirty-check + PUT /api/config), bind
//                       test buttons, then loadConfig → populate fields + status
//                       echoes → resnapshot the dirty-check.
//
// Preserved selectors / data-dom-id:
//   #section-credentials, [data-dom-id="credentials-save-btn"],
//   [data-dom-id="admin-password-status"], [data-dom-id="bili-login-status"],
//   [data-dom-id="yt-login-status"], [data-field="..."] (not used here, AI only),
//   label text → config key via credFieldMap (same strings as original).
//
// Preserved API contract:
//   GET  /api/config         — fetch (server-side desensitization; client displays
//                              masked values as-is and skips '****' values on save)
//   PUT  /api/config         — save credentials body (overriding apiPost's default
//                              POST, matching the backend route in src/routes/config.ts)
//   POST /api/test/bili      — test B站 SESSDATA
//   POST /api/test/github    — test GitHub Token
//
// Deviation notes:
//   - HTTP method: the task brief says "POST /api/config" but the backend route is
//     PUT (src/routes/config.ts app.put('/')) and the original inline code uses
//     method:'PUT'. Using POST would 404 the endpoint, so PUT is preserved via
//     apiPost(url, body, { method:'PUT' }) — the same override status.mjs uses.
//   - Desensitization: the client does NOT mask values itself. The backend
//     maskConfig() returns masked values (containing '****') for sensitive fields.
//     The client (a) displays them verbatim, (b) on save skips any value still
//     containing '****', and (c) select()s the whole masked value on focus so the
//     user can type to replace it. This triple behavior is preserved verbatim.
//   - Test-button lookup: the original used div.querySelector('button') (first
//     button). After help-button injection the first button in a field row is the
//     "获取方式" help button, so that approach would bind test handlers to the wrong
//     element. We instead locate the button whose text is '测试', which is what the
//     brief describes and avoids the help-button collision.

import { apiGet, apiPost, apiFetch } from '../api.mjs';
import { showToast } from '../components/toast.mjs';
import { setBtnLoading } from '../components/button.mjs';
import { setupDirtyCheck } from '../utils.mjs';
import { showModal } from '../components/modal.mjs';

// label text → config key (config key doubles as the help-text key)
const credFieldMap = {
  'B站 SESSDATA': 'bili_sessdata',
  'B站 bili_jct': 'bili_jct',
  'B站 buvid3': 'bili_buvid3',
  'B站 ac_time_value': 'ac_time_value',
  'YouTube API Key': 'yt_api_key',
  'YouTube Cookie': 'yt_cookies',
  'YouTube OAuth Client ID': 'yt_client_id',
  'YouTube OAuth Client Secret': 'yt_client_secret',
  'YouTube OAuth Redirect URI': 'yt_redirect_uri',
  'GitHub Token': 'gh_token',
  'GitHub 仓库': 'gh_repo',
};

// Help-text content for every credential + AI-service field. Kept local to this
// module (the brief explicitly asks for helpTexts to stay local); ai-services.mjs
// reads AI entries through getHelpText(). Verbatim from console.html lines 1049-1063.
const helpTexts = {
  bili_sessdata: { title: 'B站 SESSDATA · 获取方式', html: '1. 在浏览器登录 <a href="https://www.bilibili.com">bilibili.com</a><br>2. 按 F12 打开开发者工具 → Application（应用程序）标签<br>3. 左侧 Storage → Cookies → <code>https://www.bilibili.com</code><br>4. 找到名为 <code>SESSDATA</code> 的 Cookie，复制 Value 列的值<br><br>注意：SESSDATA 有有效期，过期后需重新获取。系统检测到过期会自动尝试续期。<br><br>也可点击上方「扫码登录 B 站」按钮自动获取。' },
  bili_jct: { title: 'B站 bili_jct · 获取方式', html: '同 SESSDATA 的获取方式，Cookie 名为 <code>bili_jct</code>（即 CSRF Token）。<br><br>1. 在 bilibili.com 登录<br>2. F12 → Application → Cookies → <code>https://www.bilibili.com</code><br>3. 找到 <code>bili_jct</code>，复制 Value' },
  bili_buvid3: { title: 'B站 buvid3 · 获取方式', html: '同 SESSDATA 的获取方式，Cookie 名为 <code>buvid3</code>。<br><br>1. 在 bilibili.com 登录<br>2. F12 → Application → Cookies → <code>https://www.bilibili.com</code><br>3. 找到 <code>buvid3</code>，复制 Value' },
  ac_time_value: { title: 'B站 ac_time_value · 获取方式', html: '用于 Cookie 自动续期。<br><br>1. 在 bilibili.com 登录后，访问 <a href="https://api.bilibili.com/x/web-interface/nav">nav 接口</a><br>2. 返回的 JSON 中找到 <code>data.wbi_img.img_url</code> 和 <code>data.wbi_img.sub_url</code><br>3. URL 路径中包含 <code>ac_time_value</code> 参数（形如 <code>ac_time_value=xxxxx</code>）<br>4. 复制该参数的值<br><br>系统会定期检查并自动续期，距过期不足 1 小时时触发刷新。' },
  yt_api_key: { title: 'YouTube API Key · 获取方式', html: '1. 访问 <a href="https://console.cloud.google.com/">Google Cloud Console</a>，登录 Google 账号<br>2. 点击顶栏项目下拉 → 新建项目（或选择已有项目）<br>3. 左侧菜单 → APIs &amp; Services → Library → 搜索 <code>YouTube Data API v3</code> → 点击 Enable<br>4. 左侧菜单 → APIs &amp; Services → Credentials → Create Credentials → API Key<br>5. 复制生成的 API Key（以 <code>AIza</code> 开头）<br><br>用于频道搜索功能。不配置时频道搜索不可用，但不影响已关注频道的自动投稿。' },
  yt_cookies: { title: 'YouTube Cookie · 获取方式', html: '用于 yt-dlp 绕过年龄限制等。<br><br>1. 在浏览器登录 <a href="https://www.youtube.com">youtube.com</a><br>2. F12 → Application → Cookies → <code>https://www.youtube.com</code><br>3. 复制以下字段的值，拼接成 <code>key=value; key=value</code> 格式：<br>　• <code>VISITOR_INFO1_LIVE</code><br>　• <code>HSID</code><br>　• <code>SSID</code><br>　• <code>SID</code>（可选）<br><br>示例：<code>VISITOR_INFO1_LIVE=xxx; HSID=xxx; SSID=xxx</code><br><br>也可点击上方「OAuth 登录 YouTube」自动获取（OAuth 成功后由后端铸造 SAPISID Cookie）。' },
  yt_client_id: { title: 'YouTube OAuth Client ID · 获取方式', html: '1. 访问 <a href="https://console.cloud.google.com/">Google Cloud Console</a><br>2. APIs &amp; Services → Credentials → Create Credentials → OAuth client ID<br>3. Application type 选 Web application<br>4. Authorized redirect URIs 添加 <code>&lt;Worker 域名&gt;/api/youtube/oauth/callback</code><br>5. 创建后复制 Client ID<br><br>启用 YouTube Data API v3 后,OAuth 登录可替代 API Key 用于频道搜索,并自动获取 yt_cookies 用于下载高清视频。' },
  yt_client_secret: { title: 'YouTube OAuth Client Secret · 获取方式', html: '与 Client ID 同时创建。在 Credentials 页面点击对应 OAuth 客户端,复制 Client Secret。<br><br>注意: Secret 只在创建时显示,请妥善保存。如丢失需重新创建 OAuth 客户端。' },
  yt_redirect_uri: { title: 'YouTube OAuth Redirect URI · 获取方式', html: '格式:<code>&lt;Worker 域名&gt;/api/youtube/oauth/callback</code><br><br>必须与 Google Cloud Console 中 OAuth 客户端的 Authorized redirect URIs 完全一致(包括协议 https:// 和路径)。' },
  gh_token: { title: 'GitHub Token · 获取方式', html: '1. 访问 <a href="https://github.com/settings/tokens">GitHub Settings → Tokens</a><br>2. 点击 Generate new token → Generate new token (classic)<br>3. Note 填写用途（如 <code>yt2bili-trigger</code>），Expiration 选择有效期<br>4. 勾选 <code>repo</code> 权限（用于触发 workflow_dispatch 事件）<br>5. 点击 Generate token<br>6. 复制生成的 token（以 <code>ghp_</code> 开头）<br><br>注意：token 只在创建时显示一次，请妥善保存。如丢失需重新生成。' },
  gh_repo: { title: 'GitHub 仓库 · 获取方式', html: '格式：<code>用户名/仓库名</code>，如 <code>Sweizh/y2b</code>。<br><br>这是存放 GitHub Actions workflow（<code>.github/workflows/process.yml</code>）的仓库。系统通过该仓库的 <code>repository_dispatch</code> 事件触发流水线运行 Python Runner。<br><br>如果你 fork 了本仓库，填写你 fork 后的仓库地址。' },
  asr_api: { title: '语音识别 API 地址 · 获取方式', html: '支持 OpenAI 兼容的 Chat Completions 格式。用于将视频音频转写为字幕。<br><br>常见服务商端点：<br>• OpenAI：<code>https://api.openai.com/v1/chat/completions</code><br>• Azure OpenAI：<code>https://你的资源名.openai.azure.com/openai/deployments/你的部署名/chat/completions?api-version=2024-02-15-preview</code><br>• 其他兼容服务商：填入对应的 chat completions 端点' },
  asr_key: { title: '语音识别 API 密钥 · 获取方式', html: '对应上方 API 地址的访问密钥（Bearer Token）。<br><br>• OpenAI：在 <a href="https://platform.openai.com/api-keys">platform.openai.com/api-keys</a> 创建，以 <code>sk-</code> 开头<br>• Azure OpenAI：在 Azure Portal → 你的 OpenAI 资源 → Keys and Endpoint 中复制 Key<br>• 其他服务商：对应控制台获取的 API Key<br><br>请求时作为 <code>Authorization: Bearer &lt;密钥&gt;</code> 头发送。' },
  translate_api: { title: '翻译 API 地址 · 获取方式', html: '支持 OpenAI 兼容的 Chat Completions 格式，用于翻译字幕。<br><br>常见服务商端点：<br>• OpenAI：<code>https://api.openai.com/v1/chat/completions</code><br>• 其他兼容服务商：填入对应的 chat completions 端点<br><br>可与语音识别 API 使用同一服务商，也可分别配置。' },
  translate_key: { title: '翻译 API 密钥 · 获取方式', html: '对应上方翻译 API 地址的访问密钥（Bearer Token）。<br><br>• OpenAI：在 <a href="https://platform.openai.com/api-keys">platform.openai.com/api-keys</a> 创建，以 <code>sk-</code> 开头<br>• 其他服务商：对应控制台获取的 API Key<br><br>请求时作为 <code>Authorization: Bearer &lt;密钥&gt;</code> 头发送。' },
};

let configCache = null;
let configPromise = null;

/**
 * Fetch /api/config once and cache the result. Subsequent callers (e.g.
 * ai-services.mjs) receive the cached config without a second network request.
 * On failure the cached promise is cleared so a later call may retry.
 * @returns {Promise<object>}
 */
export function loadConfig() {
  if (configCache) return Promise.resolve(configCache);
  if (!configPromise) {
    configPromise = apiGet('/api/config')
      .then(function (cfg) {
        configCache = cfg;
        return cfg;
      })
      .catch(function (e) {
        configPromise = null; // allow retry on failure
        throw e;
      });
  }
  return configPromise;
}

/**
 * Look up help content for a field key.
 * @param {string} key  config field key (e.g. 'bili_sessdata', 'asr_api')
 * @returns {{title:string, html:string}|null}
 */
export function getHelpText(key) {
  return helpTexts[key] || null;
}

/**
 * Inject a "获取方式" help button next to each label whose text is in fieldMap.
 * Faithful to console.html lines 1076-1094 (wraps label + button in a flex div).
 * Idempotent: a label already carrying help is skipped (marked via dataset).
 * @param {HTMLElement} section
 * @param {Object} fieldMap  label text → help key
 */
function injectHelpButtons(section, fieldMap) {
  section.querySelectorAll('label').forEach(function (lbl) {
    var text = lbl.textContent.trim();
    var key = fieldMap[text];
    if (!key) return;
    if (lbl.dataset.helpInjected) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '获取方式';
    btn.style.cssText = 'font-size:10px;font-weight:500;color:var(--brand-500);background:none;border:none;cursor:pointer;padding:0;margin-left:6px;line-height:1';
    btn.addEventListener('click', function () {
      var h = helpTexts[key];
      if (h) showModal({ title: h.title, onHelpBody: h.html });
    });
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:2px';
    lbl.parentNode.insertBefore(wrapper, lbl);
    wrapper.appendChild(lbl);
    wrapper.appendChild(btn);
    lbl.dataset.helpInjected = '1';
  });
}

/**
 * Populate credential form fields + login-status echoes from a config object.
 * Faithful to console.html lines 1231-1288. Values are displayed verbatim
 * (the backend already desensitizes sensitive fields with a '****' prefix).
 * @param {object} cfg
 */
function populateCredentials(cfg) {
  var credSection = document.getElementById('section-credentials');
  if (!credSection) return;
  var inputs = credSection.querySelectorAll('input,textarea');
  inputs.forEach(function (inp) {
    var lbl = inp.closest('.flex.flex-col');
    if (!lbl) return;
    var lblText = lbl.querySelector('label');
    if (!lblText) return;
    var key = credFieldMap[lblText.textContent.trim()];
    if (key && cfg[key] !== undefined) {
      inp.value = cfg[key];
    }
  });
  // 管理密码只读状态(用 initialized 作为代理)
  var pwdStatus = credSection.querySelector('[data-dom-id="admin-password-status"]');
  if (pwdStatus) {
    if (cfg.initialized) {
      pwdStatus.textContent = '已设置';
      pwdStatus.style.color = 'var(--state-success)';
    } else {
      pwdStatus.textContent = '未设置';
      pwdStatus.style.color = 'var(--apple-muted-foreground)';
    }
  }
  // B 站扫码登录状态显示
  var biliStatus = credSection.querySelector('[data-dom-id="bili-login-status"]');
  if (biliStatus) {
    if (cfg.bili_login_at && cfg.bili_login_at > 0) {
      var biliDt = new Date(cfg.bili_login_at);
      var biliTs = biliDt.getFullYear() + '-' + String(biliDt.getMonth() + 1).padStart(2, '0') + '-' + String(biliDt.getDate()).padStart(2, '0') + ' ' + String(biliDt.getHours()).padStart(2, '0') + ':' + String(biliDt.getMinutes()).padStart(2, '0');
      biliStatus.textContent = '已登录(账号: ' + (cfg.bili_uname || '(未知)') + ', 时间: ' + biliTs + ')';
      biliStatus.style.color = 'var(--state-success)';
    } else {
      biliStatus.textContent = '未登录';
      biliStatus.style.color = 'var(--apple-muted-foreground)';
    }
  }
  // YouTube OAuth 登录状态显示
  var ytStatus = credSection.querySelector('[data-dom-id="yt-login-status"]');
  if (ytStatus) {
    if (cfg.yt_user_email) {
      ytStatus.textContent = '已登录(email: ' + cfg.yt_user_email + ')';
      ytStatus.style.color = 'var(--state-success)';
    } else {
      ytStatus.textContent = '未登录';
      ytStatus.style.color = 'var(--apple-muted-foreground)';
    }
  }
}

/**
 * Locate the "测试" button inside a field row. The original used the first
 * <button>, but after help injection that is the "获取方式" button — so we match
 * on text content '测试' to bind the correct element.
 * @param {HTMLElement} div
 * @returns {HTMLButtonElement|null}
 */
function findTestButton(div) {
  var buttons = div.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].textContent.trim() === '测试') return buttons[i];
  }
  return null;
}

/**
 * Wire up the credentials save button: make readonly fields editable, enable
 * focus-select on masked values, attach dirty-check, and PUT the (non-masked)
 * field values to /api/config on click.
 * Faithful to console.html setupSave() (lines 1332-1450) for the credentials branch.
 * @returns {{refresh:Function, resnapshot:Function}|null}
 */
function setupCredentialsSave() {
  var credSection = document.getElementById('section-credentials');
  if (!credSection) return null;
  var save = credSection.querySelector('[data-dom-id="credentials-save-btn"]');
  if (!save) {
    // 回退:查找文本为「保存」的按钮
    credSection.querySelectorAll('button').forEach(function (b) {
      if (b.textContent.trim() === '保存') save = b;
    });
  }
  if (!save) return null;
  // 让 readonly 输入可编辑 + 脱敏字段聚焦时全选
  credSection.querySelectorAll('input[readonly],textarea[readonly]').forEach(function (inp) {
    inp.removeAttribute('readonly');
    inp.addEventListener('focus', function () {
      if (this.value && this.value.indexOf('****') >= 0) this.select();
    });
  });
  var fields = Array.from(credSection.querySelectorAll('input,textarea'));
  var dirty = setupDirtyCheck(fields, save);
  save.addEventListener('click', function () {
    if (save.disabled) return;
    setBtnLoading(save, true, '保存中…');
    var body = {};
    credSection.querySelectorAll('.flex.flex-col').forEach(function (div) {
      var lbl = div.querySelector('label');
      if (!lbl) return;
      var inp = div.querySelector('input,textarea');
      if (!inp) return;
      var key = credFieldMap[lbl.textContent.trim()];
      if (key && inp.value && !inp.value.includes('****')) {
        body[key] = inp.value;
      }
    });
    apiPost('/api/config', body, { method: 'PUT' })
      .then(function (d) {
        setBtnLoading(save, false);
        if (d.error) {
          showToast(d.error, 'error');
        } else {
          showToast('账号凭证已保存', 'success');
          dirty.resnapshot();
        }
      })
      .catch(function (e) {
        setBtnLoading(save, false);
        showToast('网络错误：' + (e.message || e), 'error');
      });
  });
  dirty.refresh();
  return dirty;
}

/**
 * Bind test buttons in the credentials section. Maps field labels to test
 * endpoints; B站 bili_jct/buvid3/ac_time_value become info-only buttons (they
 * are validated together with SESSDATA); YouTube API Key gets an info toast.
 * Faithful to console.html bindTestButtons() (lines 1461-1510).
 */
function bindCredentialsTestButtons() {
  var credSection = document.getElementById('section-credentials');
  if (!credSection) return;
  var biliSessdataFields = ['B站 SESSDATA'];
  var biliInfoFields = ['B站 bili_jct', 'B站 buvid3', 'B站 ac_time_value'];
  var githubFields = ['GitHub Token'];
  credSection.querySelectorAll('.flex.flex-col').forEach(function (div) {
    var lbl = div.querySelector('label');
    if (!lbl) return;
    var btn = findTestButton(div);
    if (!btn) return;
    var lblText = lbl.textContent.trim();
    // label 末尾可能有「获取方式」按钮文本,只取主文本
    var mainText = lblText.split('获取方式')[0].trim();
    var endpoint = '';
    if (biliSessdataFields.indexOf(mainText) >= 0) endpoint = '/api/test/bili';
    else if (githubFields.indexOf(mainText) >= 0) endpoint = '/api/test/github';
    if (endpoint) {
      btn.addEventListener('click', function () {
        setBtnLoading(btn, true, '测试中…');
        apiFetch(endpoint, { method: 'POST' })
          .then(function (d) {
            setBtnLoading(btn, false);
            showToast(d.message || (d.success ? '测试成功' : '测试失败'), d.success ? 'success' : 'error');
          })
          .catch(function (e) {
            setBtnLoading(btn, false);
            showToast('测试失败：' + (e.message || e), 'error');
          });
      });
    } else if (biliInfoFields.indexOf(mainText) >= 0) {
      // B 站其他字段随 SESSDATA 一起校验,改为 info 图标按钮
      btn.textContent = 'info';
      btn.title = '该字段随 SESSDATA 一起校验,无需单独测试';
      btn.addEventListener('click', function () {
        showToast('该字段随 SESSDATA 一起校验,无需单独测试', 'info');
      });
    } else if (mainText.indexOf('YouTube API Key') >= 0) {
      // YouTube API Key 无独立测试端点
      btn.addEventListener('click', function () {
        showToast('该字段无独立测试端点,请保存后在实际运行中验证', 'info');
      });
    }
  });
}

/**
 * Initialize the credentials section. No-op if #section-credentials is absent.
 * Order matches the original: help-button injection → save setup (snapshot on
 * empty fields) → test-button binding → async config load → populate → resnapshot.
 */
export function initCredentials() {
  var credSection = document.getElementById('section-credentials');
  if (!credSection) return;
  injectHelpButtons(credSection, credFieldMap);
  var saveCtx = setupCredentialsSave();
  bindCredentialsTestButtons();
  loadConfig()
    .then(function (cfg) {
      populateCredentials(cfg);
      // 表单异步填充完成后,重新采集脏值检测快照,避免空快照导致按钮永久启用
      if (saveCtx && saveCtx.resnapshot) saveCtx.resnapshot();
    })
    .catch(function (e) {
      console.warn('[loadConfig]', e);
    });
}
