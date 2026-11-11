(() => {
  if (globalThis.__zhiyi) { globalThis.__zhiyi.show(); return; }

  const CANDIDATES = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,figcaption,dt,dd,div';
  const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,div,section,article,ul,ol,dl,table';
  const NON_CONTENT = [
    '[data-zhiyi]', '#zhiyi-toolbar', 'script', 'style', 'noscript', 'template',
    'iframe', 'svg', 'math', 'canvas', 'pre', 'code', 'form', 'fieldset', 'label',
    'input', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'button',
    'nav', 'header', 'footer', 'aside', '[hidden]', '[inert]', '[aria-hidden="true"]',
    '[translate="no"]', '.notranslate', '[contenteditable]:not([contenteditable="false"])',
    '[role="navigation"]', '[role="menu"]', '[role="menubar"]', '[role="menuitem"]',
    '[role="listbox"]', '[role="option"]', '[role="combobox"]', '[role="textbox"]',
    '[role="tooltip"]', '[role="dialog"]', '[role="alertdialog"]', '[role="tablist"]',
    '[role="button"]', '[role="switch"]', '[role="checkbox"]', '[role="slider"]'
  ].join(',');
  const CONTROLS = 'form,fieldset,label,input,textarea,select,option,optgroup,datalist,button,[contenteditable]:not([contenteditable="false"]),[role="listbox"],[role="combobox"],[role="button"],[role="checkbox"]';
  // UI text is translated in place; editable values and hidden option lists are never read.
  const UI_NON_CONTENT = '[data-zhiyi],#zhiyi-toolbar,script,style,noscript,template,iframe,svg,math,canvas,pre,code,[hidden],[inert],[aria-hidden="true"],[translate="no"],.notranslate,[contenteditable]:not([contenteditable="false"])';
  const uiEntries = new Map();
  let uiPending = [];
  const host = document.createElement('div');
  host.id = 'zhiyi-toolbar';
  host.dataset.zhiyi = 'toolbar';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial}*{box-sizing:border-box}
    aside{position:fixed;z-index:2147483647;right:22px;bottom:84px;width:290px;max-width:calc(100vw - 24px);background:#122029;color:#edf8f2;border:1px solid #334b43;border-radius:18px;padding:17px;box-shadow:0 16px 60px #0004;font:13px/1.6 system-ui}
    header{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:16px}
    small{color:#a6c6b5}button{font:inherit;cursor:pointer;border:1px solid #4d6b5e;border-radius:8px;background:#213d32;color:white;padding:6px 10px;margin:4px 3px 0 0}
    button:hover{background:#325942}p{margin:10px 0}
    #launcher{position:fixed;z-index:2147483647;right:22px;bottom:22px;width:48px;height:48px;margin:0;padding:0;border-radius:50%;border:1px solid #77aa91;background:#245b44;color:white;box-shadow:0 5px 20px #0003;font:700 19px system-ui;touch-action:none;cursor:grab;user-select:none}
    #launcher:active{cursor:grabbing}#launcher:focus-visible{outline:3px solid #a7d2b9;outline-offset:3px}[hidden]{display:none!important}
  </style><aside><header><span>知译 <small>可见内容翻译</small></span><button id="close" aria-label="关闭控制条">×</button></header><p id="status" role="status">正在查找可见内容…</p><button id="pause">暂停</button><button id="toggle">仅译文</button><button id="restore">恢复原文</button></aside><button id="launcher" aria-label="展开或收起翻译面板" aria-expanded="true" title="点击展开或收起，拖动调整位置">译</button>`;
  document.documentElement.append(host);
  const $ = selector => shadow.querySelector(selector);
  const sheet = document.createElement('style');
  sheet.dataset.zhiyi = 'style';
  // Layout properties are fixed so host-page flex/grid rules cannot stretch the translation.
  sheet.textContent = '[data-zhiyi="translation"]{display:block!important;position:static!important;float:none!important;clear:both!important;width:auto!important;min-width:0!important;max-width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;flex:0 0 auto!important;grid-area:auto!important;margin:8px 0 12px!important;padding:5px 0 5px 12px!important;border:0!important;border-left:2px solid #43a581!important;color:inherit!important;background:transparent!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important;writing-mode:horizontal-tb!important;font:inherit!important;line-height:1.75!important;text-align:start!important}[data-zhiyi-hidden="true"]{display:none!important}';
  document.documentElement.append(sheet);

  let paused = false, stopped = false, only = false, running = false;
  let count = 0, failures = 0, consecutiveErrors = 0, scanTimer;
  const entries = new Map();
  const observed = new Set();
  let pending = [];

  function hiddenByPage(element, ui = false) {
    for (let current = element; current; current = current.parentElement) {
      if (current.matches(ui ? UI_NON_CONTENT : NON_CONTENT)) return true;
      const css = getComputedStyle(current);
      const ownHidden = current.dataset.zhiyiHidden === 'true';
      if ((!ownHidden && css.display === 'none') || css.contentVisibility === 'hidden' ||
          css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) return true;
    }
    return false;
  }

  function intersect(a, b, x = true, y = true) {
    return { left: x ? Math.max(a.left, b.left) : a.left,
      right: x ? Math.min(a.right, b.right) : a.right,
      top: y ? Math.max(a.top, b.top) : a.top,
      bottom: y ? Math.min(a.bottom, b.bottom) : a.bottom };
  }

  function clippedRect(rect, element, viewport) {
    let result = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    if (viewport) result = intersect(result, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    for (let parent = element; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      const clipX = /hidden|clip|scroll|auto/.test(css.overflowX);
      const clipY = /hidden|clip|scroll|auto/.test(css.overflowY);
      if (clipX || clipY) result = intersect(result, parent.getBoundingClientRect(), clipX, clipY);
    }
    return result;
  }
  const hasArea = rect => rect.right - rect.left > 1 && rect.bottom - rect.top > 1;

  function onScreen(element, ui = false) {
    if (!element.isConnected || document.hidden || hiddenByPage(element, ui)) return false;
    return [...element.getClientRects()].some(rect => {
      const visible = clippedRect(rect, element, true);
      if (!hasArea(visible)) return false;
      // A rectangle behind an overlay is not visible prose. Sample several points.
      for (const fraction of [0.2, 0.5, 0.8]) {
        const x = visible.left + (visible.right - visible.left) * fraction;
        const y = visible.top + (visible.bottom - visible.top) * fraction;
        const top = document.elementFromPoint(x, y);
        if (top && (top === element || element.contains(top))) return true;
      }
      return false;
    });
  }

  function sourceText(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!node.nodeValue.trim()) { parts.push(' '); continue; }
      if (!parent || hiddenByPage(parent)) continue;
      // Own source wrappers are hidden only in translation-only mode, not by the page.
      if (!parent.closest('[data-zhiyi-hidden="true"]')) {
        const range = document.createRange();
        range.selectNodeContents(node);
        if (![...range.getClientRects()].some(rect => hasArea(clippedRect(rect, parent, false)))) continue;
      }
      parts.push(node.nodeValue);
    }
    return parts.join('').replace(/\s+/g, ' ').trim();
  }

  function eligible(element) {
    for (const record of uiEntries.values()) if (element.contains(record.target)) return false;
    if (hiddenByPage(element) || element.querySelector(CONTROLS)) return false;
    if (element.querySelector(BLOCKS)) return false;
    // Only insert into ordinary prose blocks. Never coerce flex/grid/contents containers.
    if (!['block', 'list-item', 'table-cell', 'flow-root'].includes(getComputedStyle(element).display)) return false;
    const text = sourceText(element);
    return text.length >= 12 && text.length <= 4500 && /[a-zA-Z]{3}/.test(text);
  }


  function uiTask(target, owner, attribute = '') {
    return { target, owner, attribute,
      read: () => attribute ? target.getAttribute(attribute) : target.nodeType === Node.TEXT_NODE ? target.nodeValue : target.textContent,
      write: value => { if (attribute) target.setAttribute(attribute, value); else if (target.nodeType === Node.TEXT_NODE) target.nodeValue = value; else target.textContent = value; }
    };
  }
  function validUi(task) {
    if (!task.target.isConnected || !onScreen(task.owner, true)) return false;
    if (task.target instanceof HTMLOptionElement) return task.owner.selectedOptions[0] === task.target;
    if (task.attribute === 'placeholder') return !task.owner.value;
    const range = document.createRange();
    range.selectNodeContents(task.target);
    return [...range.getClientRects()].some(rect => {
      const visible = clippedRect(rect, task.owner, true);
      if (!hasArea(visible)) return false;
      const top = document.elementFromPoint((visible.left + visible.right) / 2, (visible.top + visible.bottom) / 2);
      return top && (top === task.owner || top.contains(task.owner));
    });
  }
  function restoreUi(record) {
    if (record.read() === record.translation) record.write(record.original);
    if (record.addedValue && record.target.getAttribute('value') === record.originalValue) record.target.removeAttribute('value');
    uiEntries.delete(record.target);
  }
  function scanUi(proseHosts) {
    uiPending = [];
    for (const record of uiEntries.values()) {
      if (!record.target.isConnected || record.read() !== record.translation ||
          (record.target instanceof HTMLOptionElement && record.owner.selectedOptions[0] !== record.target)) restoreUi(record);
    }
    const add = task => {
      const text = (task.read() || '').trim();
      if (!uiEntries.has(task.target) && text.length > 0 && text.length <= 4500 && /[a-zA-Z]/.test(text) && validUi(task)) uiPending.push(task);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const target = walker.currentNode, owner = target.parentElement;
      if (!owner || owner.closest('input,textarea,select,option,optgroup,datalist') || hiddenByPage(owner, true)) continue;
      let covered = false;
      for (let ancestor = owner; ancestor; ancestor = ancestor.parentElement) {
        if (entries.has(ancestor) || proseHosts.has(ancestor)) { covered = true; break; }
      }
      if (!covered) add(uiTask(target, owner));
    }
    for (const select of document.querySelectorAll('select:not([multiple])')) {
      if (select.size > 1) continue;
      const option = select.selectedOptions[0];
      if (option) add(uiTask(option, select, option.hasAttribute('label') ? 'label' : ''));
    }
    for (const input of document.querySelectorAll('input[placeholder],textarea[placeholder]')) {
      if (!input.value) add(uiTask(input, input, 'placeholder'));
    }
  }
  async function translateUi(task) {
    if (uiEntries.has(task.target) || !validUi(task)) return;
    const original = task.read();
    const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE', text: original.trim() });
    if (!result?.ok) throw new Error(result?.error || '翻译请求失败');
    if (stopped || !validUi(task) || task.read() !== original) return;
    const record = { ...task, original, translation: original.match(/^\s*/)[0] + result.translation + original.match(/\s*$/)[0] };
    // For options without a value attribute, text is also the submitted value: preserve it.
    if (task.target instanceof HTMLOptionElement && !task.target.hasAttribute('value')) {
      record.addedValue = true; record.originalValue = task.target.value;
      task.target.setAttribute('value', record.originalValue);
    }
    uiEntries.set(task.target, record);
    task.write(record.translation);
    count++; consecutiveErrors = 0; progress();
  }

  function progress(message) {
    $('#status').textContent = message || ('已翻译 ' + count + ' 处' +
      (failures ? ' · 失败 ' + failures + ' 段' : '') +
      (paused ? ' · 已暂停' : running ? ' · 翻译中' : ' · 等待可见内容（滚动或展开后继续）'));
    $('#pause').textContent = paused ? '继续' : '暂停';
  }

  function reveal(record) {
    for (const node of record.hidden) node.removeAttribute('data-zhiyi-hidden');
    for (const wrapper of record.wrappers) if (wrapper.parentNode) wrapper.replaceWith(...wrapper.childNodes);
    record.hidden = []; record.wrappers = [];
  }
  function hideSource(element, record) {
    for (const node of [...element.childNodes]) {
      if (node === record.box) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.nodeValue) continue;
        const wrapper = document.createElement('span');
        node.replaceWith(wrapper); wrapper.append(node);
        wrapper.dataset.zhiyiHidden = 'true';
        record.hidden.push(wrapper); record.wrappers.push(wrapper);
      } else if (node.nodeType === Node.ELEMENT_NODE && !hiddenByPage(node)) {
        node.dataset.zhiyiHidden = 'true'; record.hidden.push(node);
      }
    }
  }
  function forget(element, record) {
    reveal(record); record.box.remove(); entries.delete(element);
  }
  function render(element, text, translation) {
    const record = { text, hidden: [], wrappers: [], box: document.createElement('span') };
    record.box.dataset.zhiyi = 'translation';
    record.box.className = 'zhiyi-translation';
    record.box.textContent = translation;
    element.append(record.box); entries.set(element, record);
    if (only) hideSource(element, record);
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(scanTimer); scanTimer = setTimeout(scan, 120);
  }
  const viewportObserver = new IntersectionObserver(schedule, { rootMargin: '0px', threshold: 0 });
  function scan() {
    if (stopped) return;
    for (const element of observed) if (!element.isConnected) {
      viewportObserver.unobserve(element); observed.delete(element);
    }
    for (const [element, record] of entries) {
      if (!element.isConnected) { forget(element, record); continue; }
      if (sourceText(element) !== record.text) forget(element, record);
    }
    pending = [];
    const proseHosts = new Set();
    for (const element of document.querySelectorAll(CANDIDATES)) {
      if (element.closest('[data-zhiyi],#zhiyi-toolbar')) continue;
      if (!observed.has(element)) { observed.add(element); viewportObserver.observe(element); }
      if (onScreen(element) && eligible(element) && !entries.has(element)) { pending.push(element); proseHosts.add(element); }
    }
    pending.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    scanUi(proseHosts);
    run();
  }

  async function run() {
    if (running || paused || stopped || document.hidden) return;
    running = true; progress();
    while ((pending.length || uiPending.length) && !paused && !stopped && !document.hidden) {
      if (!pending.length) {
        try { await translateUi(uiPending.shift()); }
        catch (error) { failures++; consecutiveErrors++; if (consecutiveErrors >= 2 || /Key|余额|配置/.test(error.message)) paused = true; progress(error.message); }
        continue;
      }
      const element = pending.shift();
      // Recheck at send-time; scrolling may invalidate the pending queue.
      if (!onScreen(element) || !eligible(element) || entries.has(element)) continue;
      const text = sourceText(element);
      try {
        const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE', text });
        if (!result?.ok) throw new Error(result?.error || '扩展连接中断，请重新加载扩展并刷新网页。');
        if (stopped) break;
        // Do not change layout off-screen if the user scrolled while awaiting the response.
        if (!onScreen(element) || !eligible(element) || sourceText(element) !== text) continue;
        render(element, text, result.translation);
        count++; consecutiveErrors = 0; progress();
      } catch (error) {
        failures++; consecutiveErrors++;
        if (consecutiveErrors >= 2 || /Key|余额|配置/.test(error.message)) paused = true;
        progress(error.message + (paused ? ' 点击继续可重试。' : ''));
      }
    }
    running = false;
    if (!stopped && !paused) progress();
  }

  function owned(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!element?.closest('[data-zhiyi],#zhiyi-toolbar');
  }
  const mutations = new MutationObserver(records => {
    if (records.some(record => !owned(record.target) &&
      (record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes].some(node => !owned(node))))) schedule();
  });
  mutations.observe(document.body, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['hidden', 'open', 'class', 'style', 'aria-hidden', 'aria-expanded'] });
  document.addEventListener('scroll', schedule, { passive: true, capture: true });
  document.addEventListener('toggle', schedule, true);
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('resize', schedule);

  $('#pause').onclick = () => { paused = !paused; progress(); if (!paused) schedule(); };
  $('#toggle').onclick = () => {
    only = !only;
    for (const [element, record] of entries) only ? hideSource(element, record) : reveal(record);
    $('#toggle').textContent = only ? '双语对照' : '仅译文';
  };
  const panel = shadow.querySelector('aside');
  const launcher = $('#launcher');
  function setPanel(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
  }
  function positionBall(left, top) {
    const x = Math.max(8, Math.min(innerWidth - 56, left));
    const y = Math.max(8, Math.min(innerHeight - 56, top));
    launcher.style.right = 'auto'; launcher.style.bottom = 'auto';
    launcher.style.left = x + 'px'; launcher.style.top = y + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    panel.style.left = Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, x + 48 - panel.offsetWidth)) + 'px';
    panel.style.top = Math.max(8, Math.min(innerHeight - panel.offsetHeight - 8, y - panel.offsetHeight - 12)) + 'px';
  }
  let drag = null, wasDragged = false;
  launcher.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    wasDragged = false; launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) wasDragged = true;
    if (wasDragged) positionBall(drag.left + dx, drag.top + dy);
  });
  launcher.addEventListener('pointerup', () => { drag = null; });
  launcher.addEventListener('pointercancel', () => { drag = null; wasDragged = true; });
  launcher.addEventListener('click', () => {
    if (wasDragged) { wasDragged = false; return; }
    setPanel(panel.hidden);
    if (launcher.style.left) { const rect = launcher.getBoundingClientRect(); positionBall(rect.left, rect.top); }
  });
  function keepBallInBounds() {
    if (launcher.style.left) { const rect = launcher.getBoundingClientRect(); positionBall(rect.left, rect.top); }
  }
  window.addEventListener('resize', keepBallInBounds);
  $('#close').onclick = () => { setPanel(false); };
  $('#restore').onclick = () => {
    stopped = true; clearTimeout(scanTimer); mutations.disconnect(); viewportObserver.disconnect();
    document.removeEventListener('scroll', schedule, true);
    document.removeEventListener('toggle', schedule, true);
    document.removeEventListener('change', schedule, true);
    document.removeEventListener('input', schedule, true);
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('resize', keepBallInBounds);
    for (const [element, record] of entries) forget(element, record);
    for (const record of uiEntries.values()) restoreUi(record);
    observed.clear(); pending = []; uiPending = []; host.remove(); sheet.remove(); delete globalThis.__zhiyi;
  };
  globalThis.__zhiyi = { show() { setPanel(true); keepBallInBounds(); schedule(); } };
  scan();
})();
