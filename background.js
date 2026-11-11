import { DEFAULTS, prompt, safeTranslation } from './core.js';

// Only connection settings are persisted. Translation requests are serialized.
let queue = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
async function settings() {
  const data = await chrome.storage.local.get('settings');
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, data.settings?.[key] ?? DEFAULTS[key]]));
}
async function translate(config, text) {
  if (!config.apiKey) throw new Error('请先在 Dashboard 中保存 DeepSeek API Key。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({ model: config.model,
        messages: [{ role: 'system', content: prompt(config) }, { role: 'user', content: text }],
        thinking: { type: 'disabled' }, stream: false, max_tokens: 4096 })
    });
    if (!response.ok) {
      const labels = { 401: 'API Key 无效', 402: '账户余额不足', 429: '请求过于频繁，请稍后重试', 500: 'DeepSeek 服务暂时异常', 503: 'DeepSeek 服务繁忙' };
      throw new Error(labels[response.status] || 'API 请求失败（HTTP ' + response.status + '），请检查模型名称。');
    }
    return { translation: safeTranslation(await response.json()) };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超过 25 秒，已取消。请稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接 DeepSeek，请检查网络。');
    throw error;
  } finally { clearTimeout(timer); }
}
async function dispatch(message, sender) {
  const trusted = sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!trusted && message.type !== 'TRANSLATE') throw new Error('该操作仅允许从扩展管理页面发起。');
  if (message.type === 'STATE') return { settings: await settings() };
  if (message.type === 'SAVE') {
    const value = message.settings;
    if (typeof value?.apiKey !== 'string' || typeof value.model !== 'string' || !value.model.trim() || !['简体中文', '繁體中文', 'English', '日本語'].includes(value.target)) throw new Error('配置格式无效。');
    await chrome.storage.local.set({ settings: { apiKey: value.apiKey.trim(), model: value.model.trim().slice(0, 100), target: value.target } });
    return {};
  }
  if (!['TRANSLATE', 'TEST'].includes(message.type)) throw new Error('未知操作。');
  const text = message.type === 'TEST' ? 'A reliable agent needs clear context.' : String(message.text || '').trim();
  if (!text || text.length > 5000) throw new Error('请输入 1–5000 字符的文本。');
  return translate(await settings(), text);
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const work = queue.then(() => dispatch(message, sender), () => dispatch(message, sender));
  queue = work.catch(() => {});
  work.then(data => reply({ ok: true, ...data }), error => reply({ ok: false, error: error.message }));
  return true;
});
