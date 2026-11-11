const $ = selector => document.querySelector(selector);
let toastTimer;
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || '扩展后台连接失败');
  return result;
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').hidden = true, 5500);
}
async function action(button, task) {
  button.disabled = true;
  try { await task(); } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
async function save() {
  const settings = Object.fromEntries(['apiKey', 'model', 'target'].map(key => [key, $('#' + key).value]));
  await send({ type: 'SAVE', settings });
  $('#connectionState').textContent = '配置已保存 · 尚未测试';
}
$('#settingsForm').onsubmit = event => {
  event.preventDefault();
  action(event.submitter, async () => { await save(); toast('配置已保存'); });
};
$('#showKey').onclick = () => {
  const input = $('#apiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#showKey').textContent = input.type === 'password' ? '显示' : '隐藏';
};
for (const key of ['apiKey', 'model', 'target']) $('#' + key).addEventListener('input', () => {
  $('#connectionState').textContent = '配置已修改 · 尚未测试';
});
$('#test').onclick = event => action(event.currentTarget, async () => {
  await save();
  $('#connectionState').textContent = '测试中…';
  try { await send({ type: 'TEST' }); $('#connectionState').textContent = '连接测试通过'; toast('连接成功，可以开始翻译。'); }
  catch (error) { $('#connectionState').textContent = '连接测试失败'; throw error; }
});
$('#translate').onclick = event => action(event.currentTarget, async () => {
  $('#resultSource').textContent = '翻译中…';
  try {
    const result = await send({ type: 'TRANSLATE', text: $('#source').value.trim() });
    $('#result').value = result.translation;
    $('#resultSource').textContent = '翻译完成';
  } catch (error) { $('#resultSource').textContent = '翻译失败'; throw error; }
});
function nav() {
  document.querySelectorAll('nav a').forEach(link => link.classList.toggle('active', link.hash === (location.hash || '#overview')));
}
window.addEventListener('hashchange', nav);
nav();
const controls = [...document.querySelectorAll('form button, #translate')];
controls.forEach(button => button.disabled = true);
send({ type: 'STATE' }).then(data => {
  for (const key of ['apiKey', 'model', 'target']) $('#' + key).value = data.settings[key];
}).catch(error => toast(error.message)).finally(() => controls.forEach(button => button.disabled = false));
