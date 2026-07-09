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
  // VideoCaptioner 集成新增字段(spec integrate-videocaptioner Task 8)
  'ASR 后端': 'asr_provider',
  '字幕翻译服务': 'subtitle_translator',
  '目标语言': 'subtitle_target_language',
  '字幕优化': 'subtitle_optimize',
  '字幕断句': 'subtitle_split',
  '反思翻译': 'subtitle_reflect',
  '文稿提示': 'subtitle_prompt',
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
    // 仅当存在帮助文本时才注入按钮(新字段 asr_provider/subtitle_* 无帮助文本,跳过)
    if (!getHelpText(key)) return;
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
 * ASR 后端联动:provider=bijian/jianying 时禁用 asr_api/asr_key(及未来 asr_model)
 * 三字段并加灰显样式;provider=whisper-api 时恢复。值不清空,仅切换 disabled + 灰显。
 * @param {string} provider  bijian | jianying | whisper-api
 */
function syncAsrProviderFields(provider) {
  var disabled = provider !== 'whisper-api';
  // 当前 UI 仅暴露 asr_api/asr_key 两字段(asr_model 暂无 UI 输入);
  // 列表预留 'fld-asr-api-model' 以便未来加入时自动联动。
  var ids = ['fld-asr-api-url', 'fld-asr-api-key', 'fld-asr-api-model'];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.disabled = disabled;
    el.style.opacity = disabled ? '0.5' : '';
    el.style.cursor = disabled ? 'not-allowed' : '';
  });
}

/**
 * 字幕翻译服务联动:translator=bing/google 时禁用 translate_api/translate_key
 * (及未来 translate_model);translator=llm 时恢复。值不清空。
 * @param {string} translator  llm | bing | google
 */
function syncSubtitleTranslatorFields(translator) {
  var disabled = translator !== 'llm';
  var ids = ['fld-translate-api-url', 'fld-translate-api-key', 'fld-translate-api-model'];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.disabled = disabled;
    el.style.opacity = disabled ? '0.5' : '';
    el.style.cursor = disabled ? 'not-allowed' : '';
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
  // 翻译开关回填(switch 用 data-field 标识)
  var subSwitch = aiSection.querySelector('[data-field="translate_subtitle_enabled"]');
  if (subSwitch) {
    subSwitch.setAttribute('data-checked', cfg.translate_subtitle_enabled !== false ? 'true' : 'false');
  }
  var titleSwitch = aiSection.querySelector('[data-field="translate_title_enabled"]');
  if (titleSwitch) {
    titleSwitch.setAttribute('data-checked', cfg.translate_title_enabled === true ? 'true' : 'false');
  }
  // 翻译提示词回填
  var promptInput = aiSection.querySelector('[data-field="translate_prompt"]');
  if (promptInput) {
    promptInput.value = cfg.translate_prompt || '';
  }
  // VideoCaptioner 集成新增字段回填(spec integrate-videocaptioner Task 8)
  // ASR 后端下拉 + 联动禁用 asr_api/asr_key/asr_model
  var asrProviderSel = aiSection.querySelector('[data-field="asr_provider"]');
  var asrProvider = cfg.asr_provider || 'bijian';
  if (asrProviderSel) asrProviderSel.value = asrProvider;
  syncAsrProviderFields(asrProvider);
  // 字幕翻译服务下拉 + 联动禁用 translate_api/translate_key/translate_model
  var subTranslatorSel = aiSection.querySelector('[data-field="subtitle_translator"]');
  var subTranslator = cfg.subtitle_translator || 'llm';
  if (subTranslatorSel) subTranslatorSel.value = subTranslator;
  syncSubtitleTranslatorFields(subTranslator);
  // 字幕选项区:目标语言
  var targetLangInput = aiSection.querySelector('[data-field="subtitle_target_language"]');
  if (targetLangInput) {
    targetLangInput.value = cfg.subtitle_target_language || 'zh-Hans';
  }
  // 字幕选项区:优化/断句/反思开关(switch 用 data-checked 标识,与 translate_*_enabled 同模式)
  var optSw = aiSection.querySelector('[data-field="subtitle_optimize"]');
  if (optSw) {
    optSw.setAttribute('data-checked', cfg.subtitle_optimize !== false ? 'true' : 'false');
  }
  var splitSw = aiSection.querySelector('[data-field="subtitle_split"]');
  if (splitSw) {
    splitSw.setAttribute('data-checked', cfg.subtitle_split !== false ? 'true' : 'false');
  }
  var reflectSw = aiSection.querySelector('[data-field="subtitle_reflect"]');
  if (reflectSw) {
    reflectSw.setAttribute('data-checked', cfg.subtitle_reflect === true ? 'true' : 'false');
  }
  // 字幕选项区:文稿提示 textarea
  var subPromptInput = aiSection.querySelector('[data-field="subtitle_prompt"]');
  if (subPromptInput) {
    subPromptInput.value = cfg.subtitle_prompt || '';
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
  // switch 点击切换(switch 非 input/textarea,不参与 dirty 检测,手动启用保存按钮)
  aiSection.querySelectorAll('.switch[data-field]').forEach(function (sw) {
    sw.addEventListener('click', function () {
      var cur = sw.getAttribute('data-checked') === 'true';
      sw.setAttribute('data-checked', cur ? 'false' : 'true');
      if (save.disabled) {
        save.disabled = false;
        save.style.opacity = '1';
        save.style.cursor = 'pointer';
      }
    });
  });
  // 下拉(select 非 input/textarea,不参与 dirty 检测):change 时触发联动 + 启用保存按钮
  var asrProviderSel = aiSection.querySelector('[data-field="asr_provider"]');
  if (asrProviderSel) {
    asrProviderSel.addEventListener('change', function () {
      syncAsrProviderFields(asrProviderSel.value);
      if (save.disabled) {
        save.disabled = false;
        save.style.opacity = '1';
        save.style.cursor = 'pointer';
      }
    });
  }
  var subTranslatorSel = aiSection.querySelector('[data-field="subtitle_translator"]');
  if (subTranslatorSel) {
    subTranslatorSel.addEventListener('change', function () {
      syncSubtitleTranslatorFields(subTranslatorSel.value);
      if (save.disabled) {
        save.disabled = false;
        save.style.opacity = '1';
        save.style.cursor = 'pointer';
      }
    });
  }
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
    // 翻译开关与提示词
    var subSwitch = aiSection.querySelector('[data-field="translate_subtitle_enabled"]');
    if (subSwitch) {
      body.translate_subtitle_enabled = subSwitch.getAttribute('data-checked') === 'true';
    }
    var titleSwitch = aiSection.querySelector('[data-field="translate_title_enabled"]');
    if (titleSwitch) {
      body.translate_title_enabled = titleSwitch.getAttribute('data-checked') === 'true';
    }
    var promptInput = aiSection.querySelector('[data-field="translate_prompt"]');
    if (promptInput) {
      body.translate_prompt = promptInput.value;
    }
    // VideoCaptioner 集成新增字段收集(spec integrate-videocaptioner Task 8)
    if (asrProviderSel) body.asr_provider = asrProviderSel.value;
    if (subTranslatorSel) body.subtitle_translator = subTranslatorSel.value;
    var targetLangInput = aiSection.querySelector('[data-field="subtitle_target_language"]');
    if (targetLangInput) body.subtitle_target_language = targetLangInput.value;
    var optSw = aiSection.querySelector('[data-field="subtitle_optimize"]');
    if (optSw) body.subtitle_optimize = optSw.getAttribute('data-checked') === 'true';
    var splitSw = aiSection.querySelector('[data-field="subtitle_split"]');
    if (splitSw) body.subtitle_split = splitSw.getAttribute('data-checked') === 'true';
    var reflectSw = aiSection.querySelector('[data-field="subtitle_reflect"]');
    if (reflectSw) body.subtitle_reflect = reflectSw.getAttribute('data-checked') === 'true';
    var subPromptInput = aiSection.querySelector('[data-field="subtitle_prompt"]');
    if (subPromptInput) body.subtitle_prompt = subPromptInput.value;
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
