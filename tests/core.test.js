import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, prompt, safeTranslation } from '../core.js';

test('翻译提示使用目标语言，不依赖个人记忆', () => {
  assert.match(prompt({ ...DEFAULTS, target: '日本語' }), /日本語/);
  assert.equal(safeTranslation({ choices: [{ message: { content: '  译文  ' }, finish_reason: 'stop' }] }), '译文');
});
test('拒绝空输出及截断结果', () => {
  assert.throws(() => safeTranslation({}));
  assert.throws(() => safeTranslation({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }));
});
let listener;
let store = { terms: [{ source: 'agent', target: '旧术语' }], cache: { old: { translation: '旧译文' } }, stats: { requests: 42 } };
let calls = 0, status = 200;
globalThis.chrome = {
  runtime: { getURL: p => 'chrome-extension://test/' + p, onMessage: { addListener: fn => listener = fn } },
  storage: { local: {
    setAccessLevel: async () => {},
    get: async key => ({ [key]: structuredClone(store[key]) }),
    set: async data => Object.assign(store, structuredClone(data))
  } }
};
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  const body = JSON.parse(options.body);
  assert.equal(typeof body.messages[1].content, 'string');
  assert.ok(!JSON.stringify(body).includes('旧术语'));
  return { ok: status === 200, status, json: async () => ({ choices: [{ message: { content: '测试译文' }, finish_reason: 'stop' }] }) };
};
await import('../background.js');
const trusted = { url: 'chrome-extension://test/dashboard.html', tab: { id: 2 } };
const page = { url: 'https://example.com/article', tab: { id: 1 } };
const send = (message, sender = trusted) => new Promise(resolve => listener(message, sender, resolve));
test('基础翻译消息流程', async t => {
  await t.test('网页不能读取 Key 或修改配置', async () => {
    assert.equal((await send({ type: 'STATE' }, page)).ok, false);
    assert.equal((await send({ type: 'SAVE', settings: DEFAULTS }, page)).ok, false);
  });
  await t.test('缺少 Key 时显示明确错误', async () => {
    assert.match((await send({ type: 'TRANSLATE', text: 'A test paragraph' }, page)).error, /Key/);
  });
  await t.test('配置持久化且状态不暴露旧功能数据', async () => {
    assert.equal((await send({ type: 'SAVE', settings: { ...DEFAULTS, apiKey: 'test-only' } })).ok, true);
    const state = await send({ type: 'STATE' });
    assert.deepEqual(Object.keys(state).sort(), ['ok', 'settings']);
  });
  await t.test('重复翻译每次都调用 API，不读写缓存和统计', async () => {
    for (let i = 0; i < 2; i++) assert.equal((await send({ type: 'TRANSLATE', text: 'A test paragraph' }, page)).translation, '测试译文');
    assert.equal(calls, 2);
    assert.deepEqual(store.cache, { old: { translation: '旧译文' } });
    assert.equal(store.stats.requests, 42);
  });
  await t.test('非法输入和旧术语操作被拒绝', async () => {
    assert.equal((await send({ type: 'TRANSLATE', text: '' }, page)).ok, false);
    assert.equal((await send({ type: 'TRANSLATE', text: 'x'.repeat(5001) }, page)).ok, false);
    assert.equal((await send({ type: 'ADD_TERM', source: 'agent', target: '智能体' })).ok, false);
  });
  await t.test('接口错误返回可读提示', async () => {
    status = 401;
    assert.match((await send({ type: 'TEST' })).error, /Key/);
    status = 200;
  });
});
