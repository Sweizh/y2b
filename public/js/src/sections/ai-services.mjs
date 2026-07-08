// ai-services.mjs — AI 服务接口 section (migrated from console.html)
//
// Migrated source ranges:
//   helpTexts label help-button injection (AI entries)   (lines 1076-1094)
//   loadConfigToForm() — AI service fields + title echo  (lines 1289-1307)
//   setupSave() for the AI services section               (lines 1406-1423 + shared save plumbing)
//   bindTestButtons() — AI test endpoints                 (lines 1511-1538)
//
// Public API:
//   initAiServices() → wire up #section-ai-services: inject "获取方式" help
//                      buttons, bind save (dirty-check + PUT /api/config), bind
//                      test buttons, then loadConfig (shared/cached, imported from
//                      credentials.mjs) → populate fields → resnapshot the dirty-check.
//
// Preserved selectors / data-dom-id:
//   #section-ai-services, [data-dom-id="ai-save-btn"],
//   [data-field="title_template"], label text → config key via aiFieldMap.
//
// Preserved API contract:
//   PUT  /api/config         — save AI services body (PUT via apiPost override;
//                              backend route is PUT in src/routes/config.ts)
//   POST /api/test/asr       — test 语音识别 endpoint
//   POST /api/test/translate — test 翻译 endpoint
//
// Deviation notes:
//   - Shares a single /api/config fetch with credentials.mjs via the cached
//     loadConfig() export, so the page only hits /api/config once.
//   - HTTP method preserved as PUT (same reasoning + override as credentials.mjs).
//   - Test-button lookup matches on text '测试' (see credentials.mjs deviation
//     note re: help-button collision).
//   - Help text lives in credentials.mjs (single source of truth); this module
//     reads AI entries through the imported getHelpText(key).

import { apiPost, apiFetch } from '../api.mjs';
import { showToast } from '../components/toast.mjs';
import { setBtnLoading } from '../components/button.mjs';
import { setupDirtyCheck } from '../utils.mjs';
import { showModal } from '../components/modal.mjs';
import { loadConfig, getHelpText } from './credentials.mjs';

// label text → config key (config key doubles as the help-text key)
const aiFieldMap = {
  '语音识别 API 地址': 'asr_api',
  '语音识别 API 密钥': 'asr_key',
  '翻译 API 地址': 'translate_api',
  '翻译 API 密钥': 'translate_key',
};

/**
 * Inject a "获取方式" help button next to each AI-service label. Reads help
 * content through getHelpText() (shared with credentials.mjs). Idempotent.
 * Faithful to console.html lines 1076-1094 (AI labels branch).
 * @param {HTMLElement} section
 */
function injectAiHelpButtons(section) {
  section.querySelectorAll('label').forEach(function (lbl) {
    var text = lbl.textContent.trim();
    var key = aiFieldMap[text];
    if (!key) return;
    if (lbl.dataset.helpInjected) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '获取方式';
    btn.style.cssText = 'font-size:10px;font-weight:500;color:var(--brand-500);background:none;border:none;cursor:pointer;padding:0;margin-left:6px;line-height:1';
    btn.addEventListener('click', function () {
      var h = getHelpText(key);
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
 * Populate AI service form fields from a config object.
 * Faithful to console.html lines 1289-1307. label-text mapping for asr/translate
 * fields; title_template is matched by its [data-field] attribute (no label map).
 * @param {object} cfg
 */
function populateAiServices(cfg) {
  var aiSection = document.getElementById('section-ai-services');
  if (!aiSection) return;
  aiSection.querySelectorAll('.flex.flex-col').forEach(function (div) {
    var lbl = div.querySelector('label');
    if (!lbl) return;
    var key = aiFieldMap[lbl.textContent.trim()];
    var inp = div.querySelector('input,textarea');
    if (key && inp && cfg[key] !== undefined) {
      inp.value = cfg[key];
    }
  });
  // 标题翻译模板回显(用 data-field 标识,不走 label 映射)
  var titleTplInput = aiSection.querySelector('[data-field="title_template"]');
  if (titleTplInput) {
    titleTplInput.value = cfg.title_template || '';
  }
}

/**
 * Locate the "测试" button inside a field row (see credentials.mjs note).
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
 * Wire up the AI services save button: make readonly fields editable, enable
 * focus-select on masked values, attach dirty-check, and PUT the (non-masked)
 * field values + title_template to /api/config on click.
 * Faithful to console.html setupSave() (lines 1406-1423) for the AI branch.
 * @returns {{refresh:Function, resnapshot:Function}|null}
 */
function setupAiSave() {
  var aiSection = document.getElementById('section-ai-services');
  if (!aiSection) return null;
  var save = aiSection.querySelector('[data-dom-id="ai-save-btn"]');
  if (!save) {
    aiSection.querySelectorAll('button').forEach(function (b) {
      if (b.textContent.trim() === '保存') save = b;
    });
  }
  if (!save) return null;
  aiSection.querySelectorAll('input[readonly],textarea[readonly]').forEach(function (inp) {
    inp.removeAttribute('readonly');
    inp.addEventListener('focus', function () {
      if (this.value && this.value.indexOf('****') >= 0) this.select();
    });
  });
  var fields = Array.from(aiSection.querySelectorAll('input,textarea'));
  var dirty = setupDirtyCheck(fields, save);
  save.addEventListener('click', function () {
    if (save.disabled) return;
    setBtnLoading(save, true, '保存中…');
    var body = {};
    aiSection.querySelectorAll('.flex.flex-col').forEach(function (div) {
      var lbl = div.querySelector('label');
      if (!lbl) return;
      var inp = div.querySelector('input,textarea');
      if (!inp) return;
      var key = aiFieldMap[lbl.textContent.trim()];
      if (key && inp.value && !inp.value.includes('****')) {
        body[key] = inp.value;
      }
    });
    // 标题翻译模板(用 data-field 标识,留空亦需提交以清空配置)
    var titleTplInput = aiSection.querySelector('[data-field="title_template"]');
    if (titleTplInput) {
      body.title_template = titleTplInput.value;
    }
    apiPost('/api/config', body, { method: 'PUT' })
      .then(function (d) {
        setBtnLoading(save, false);
        if (d.error) {
          showToast(d.error, 'error');
        } else {
          showToast('AI 服务接口已保存', 'success');
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
 * Bind test buttons in the AI services section. 语音识别 → /api/test/asr,
 * 翻译 → /api/test/translate. Faithful to console.html lines 1511-1538.
 */
function bindAiTestButtons() {
  var aiSection = document.getElementById('section-ai-services');
  if (!aiSection) return;
  aiSection.querySelectorAll('.flex.flex-col').forEach(function (div) {
    var lbl = div.querySelector('label');
    if (!lbl) return;
    var btn = findTestButton(div);
    if (!btn) return;
    var lblText = lbl.textContent.trim();
    var mainText = lblText.split('获取方式')[0].trim();
    var endpoint = '';
    if (mainText.indexOf('语音识别') >= 0) endpoint = '/api/test/asr';
    else if (mainText.indexOf('翻译') >= 0) endpoint = '/api/test/translate';
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
    }
  });
}

/**
 * Initialize the AI services section. No-op if #section-ai-services is absent.
 * Order matches the original: help-button injection → save setup (snapshot on
 * empty fields) → test-button binding → async config load → populate → resnapshot.
 */
export function initAiServices() {
  var aiSection = document.getElementById('section-ai-services');
  if (!aiSection) return;
  injectAiHelpButtons(aiSection);
  var saveCtx = setupAiSave();
  bindAiTestButtons();
  loadConfig()
    .then(function (cfg) {
      populateAiServices(cfg);
      if (saveCtx && saveCtx.resnapshot) saveCtx.resnapshot();
    })
    .catch(function (e) {
      console.warn('[loadConfig]', e);
    });
}
