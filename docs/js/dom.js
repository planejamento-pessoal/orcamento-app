/* ════════════════════════════════════════════════════════════════════════
   dom.js — ajudantes de tela: criar elementos, ícones, painel que sobe,
   aviso rápido (toast), confirmação, escolha de mês, copiar/compartilhar.
   Texto sempre entra por textContent (nomes vêm do banco: nada de innerHTML).
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var F = App.fmt = window.Format;
  App.views = App.views || {};   // as telas se registram aqui (month-view.js etc.)

  // ── criar elementos ────────────────────────────────────────────────────
  function isAttrs(x) { return x && typeof x === 'object' && !x.nodeType && !Array.isArray(x); }
  function addKids(el, kids) {
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) addKids(el, c);
      else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
  }
  function applyAttrs(el, attrs, isSvg) {
    for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'on') { for (var ev in v) el.addEventListener(ev, v[ev]); }
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') { /* depois dos filhos */ }
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  function finish(el, attrs) {
    if (!attrs) return;
    if (attrs.value != null) el.value = attrs.value;
    if (attrs.checked) el.checked = true;
    if (attrs.disabled) el.disabled = true;
    if (attrs.selected) el.selected = true;
  }
  function h(tag, a) {
    var el = document.createElement(tag), attrs = isAttrs(a) ? a : null;
    if (attrs) applyAttrs(el, attrs);
    addKids(el, Array.prototype.slice.call(arguments, attrs ? 2 : 1));
    finish(el, attrs);
    return el;
  }
  function s(tag, a) {
    var el = document.createElementNS(SVGNS, tag), attrs = isAttrs(a) ? a : null;
    if (attrs) applyAttrs(el, attrs, true);
    addKids(el, Array.prototype.slice.call(arguments, attrs ? 2 : 1));
    return el;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // ── ícones (traço de 2px, 24x24) ───────────────────────────────────────
  var ICONS = {
    calendar: [['rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 10h18M8 3v4M16 3v4' }]],
    chart: [['path', { d: 'M3 3v18h18' }], ['path', { d: 'M7 15l4-5 3 3 5-7' }]],
    calc: [['rect', { x: 5, y: 3, width: 14, height: 18, rx: 2 }], ['path', { d: 'M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01' }]],
    list: [['path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }]],
    user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21c1-4 4-6 8-6s7 2 8 6' }]],
    plus: [['path', { d: 'M12 5v14M5 12h14' }]],
    left: [['path', { d: 'M15 5l-7 7 7 7' }]],
    right: [['path', { d: 'M9 5l7 7-7 7' }]],
    check: [['path', { d: 'M5 12.5l4.5 4.5L19 7' }]],
    warn: [['path', { d: 'M12 4l9.5 16.5h-19z' }], ['path', { d: 'M12 10v4.5M12 17.5h.01' }]],
    neg: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M8 12h8' }]],
    x: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
    refresh: [['path', { d: 'M20 11a8 8 0 1 0-2.3 5.7' }], ['path', { d: 'M20 4v7h-7' }]],
    copy: [['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }], ['path', { d: 'M5 15V6a2 2 0 0 1 2-2h8' }]],
    share: [['circle', { cx: 6, cy: 12, r: 2.5 }], ['circle', { cx: 18, cy: 6, r: 2.5 }], ['circle', { cx: 18, cy: 18, r: 2.5 }], ['path', { d: 'M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6' }]],
    trash: [['path', { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' }]],
    eye: [['path', { d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
    lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]]
  };
  function icon(name, cls) {
    var svg = s('svg', { 'class': 'icone' + (cls ? ' ' + cls : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    (ICONS[name] || []).forEach(function (p) { svg.appendChild(s(p[0], p[1])); });
    return svg;
  }
  function statusIcon(st) { return icon(st === 'neg' ? 'neg' : st === 'low' ? 'warn' : 'check', 'p'); }
  var STATUS_TXT = { ok: 'Acima do mínimo', low: 'Abaixo do mínimo', neg: 'Negativo' };

  // ── aviso rápido ───────────────────────────────────────────────────────
  var toastEl = null, toastTimer = null;
  function toast(msg, kind) {
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    clearTimeout(toastTimer);
    toastEl = h('div', { 'class': 'toast' + (kind === 'erro' ? ' erro' : ''), role: kind === 'erro' ? 'alert' : 'status' },
      icon(kind === 'erro' ? 'warn' : 'check', 'p'), h('span', { text: msg }));
    document.body.appendChild(toastEl);
    placeToast(toastEl);
    toastTimer = setTimeout(function () { if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl); }, kind === 'erro' ? 6500 : 3200);
  }

  // Com um painel aberto, o aviso fica logo acima dele, para nunca cobrir o conteúdo do painel
  // (o código do convite, por exemplo). Sem espaço em cima, vai para o topo da tela. Sem painel,
  // volta ao lugar de sempre (definido no CSS). É chamada quando o aviso aparece e também quando
  // um painel abre ou fecha com o aviso ainda na tela.
  function placeToast(el) {
    el.style.top = ''; el.style.bottom = '';
    var top = stack[stack.length - 1];
    if (!top || !top.el) return;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var alt = top.el.offsetHeight;                     // o painel é colado embaixo; a animação de subida não conta
    if (vh - alt > 72) el.style.bottom = (alt + 8) + 'px';
    else { el.style.bottom = 'auto'; el.style.top = 'calc(8px + var(--safe-t))'; }
  }
  function replaceToast() { if (toastEl && toastEl.parentNode) placeToast(toastEl); }

  // ── painel que sobe de baixo ───────────────────────────────────────────
  // O botão "voltar" do celular fecha o painel de cima. Para isso há UMA entrada
  // de histórico enquanto houver qualquer painel aberto (nunca uma por painel) e
  // ela só é devolvida depois que a pilha esvazia de verdade. Assim, fechar um
  // painel e abrir outro no mesmo instante (confirmação, "convite criado") não
  // embaralha o histórico nem expulsa a pessoa do app.
  var stack = [], histDepth = 0, backing = 0, wantPush = false;
  function ensureEntry() {
    if (!stack.length || histDepth > 0) return;
    if (backing > 0) { wantPush = true; return; }          // espera a volta anterior terminar
    try { history.pushState({ painel: 1 }, ''); histDepth = 1; } catch (e) {}
  }
  function releaseEntry() {
    setTimeout(function () {
      if (stack.length || histDepth === 0 || backing > 0) return;
      backing++; histDepth = 0;
      try { history.back(); } catch (e) { backing--; }
    }, 0);
  }

  function removeRec(rec) {
    var i = stack.indexOf(rec);
    if (i >= 0) stack.splice(i, 1);
    if (rec.scrim.parentNode) rec.scrim.parentNode.removeChild(rec.scrim);
    if (rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
    replaceToast();
    if (rec.opener && rec.opener.focus && document.contains(rec.opener)) { try { rec.opener.focus(); } catch (e) {} }
    if (rec.onClose) rec.onClose();
  }
  function closeRec(rec, fromPop) {
    if (rec.closed) return;
    rec.closed = true;
    removeRec(rec);
    if (!fromPop) releaseEntry();
  }
  window.addEventListener('popstate', function () {
    if (backing > 0) { backing--; if (wantPush) { wantPush = false; ensureEntry(); } return; }
    histDepth = 0;                                          // a pessoa usou "voltar": a entrada foi consumida
    var top = stack[stack.length - 1];
    if (top) closeRec(top, true);
    ensureEntry();                                          // ainda há painéis? repõe a entrada
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && stack.length) closeRec(stack[stack.length - 1], false);
  });

  // opts: { title, sub, body, footer:[nós], onClose, focus: 'first'|'none' }
  function openSheet(opts) {
    var rec = { opener: document.activeElement, onClose: opts.onClose, closed: false };
    rec.scrim = h('div', { 'class': 'scrim', on: { click: function () { closeRec(rec, false); } } });
    var close = h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Fechar', on: { click: function () { closeRec(rec, false); } } }, icon('x'));
    var corpo = h('div', { 'class': 'sheet-corpo' }, opts.body);
    rec.el = h('div', { 'class': 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
      h('div', { 'class': 'sheet-topo' },
        h('div', null, h('h2', { text: opts.title }), opts.sub ? h('span', { 'class': 'sub', text: opts.sub }) : null),
        close),
      corpo,
      opts.footer && opts.footer.length ? h('div', { 'class': 'sheet-pe' }, opts.footer) : null);
    document.body.appendChild(rec.scrim);
    document.body.appendChild(rec.el);
    stack.push(rec);
    replaceToast();
    ensureEntry();
    if (opts.focus !== 'none') {
      var f = corpo.querySelector('input:not([type=checkbox]), select, textarea') || corpo.querySelector('button');
      if (f) setTimeout(function () { try { f.focus(); if (f.select && f.type !== 'month') f.select(); } catch (e) {} }, 30);
    }
    rec.close = function () { closeRec(rec, false); };
    return rec;
  }
  function closeAllSheets() { while (stack.length) closeRec(stack[stack.length - 1], false); }
  function sheetsOpen() { return stack.length; }

  // Confirmação: devolve uma promessa de true/false
  function confirmBox(o) {
    return new Promise(function (resolve) {
      var done = false, rec;
      function finish(v) { if (done) return; done = true; resolve(v); if (rec) rec.close(); }
      var ok = h('button', { 'class': 'btn ' + (o.danger ? 'perigo' : 'primario'), type: 'button', text: o.ok || 'Confirmar', on: { click: function () { finish(true); } } });
      var no = h('button', { 'class': 'btn', type: 'button', text: o.cancel || 'Cancelar', on: { click: function () { finish(false); } } });
      rec = openSheet({
        title: o.title, body: h('p', { text: o.text, style: 'font-size:17px' }), footer: [no, ok], focus: 'none',
        onClose: function () { if (!done) { done = true; resolve(false); } }
      });
    });
  }

  // Escolha de mês: ano em cima, 12 meses embaixo. Devolve "AAAA-MM" ou null.
  function pickMonth(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var cur = o.value || F.currentMonth(), year = parseInt(cur.slice(0, 4), 10), picked = false, rec;
      var grade = h('div', { 'class': 'grade-meses', role: 'group', 'aria-label': 'Meses' });
      var anoTxt = h('span', { 'class': 'ano num', 'aria-live': 'polite' });
      function draw() {
        anoTxt.textContent = String(year);
        clear(grade);
        for (var m = 1; m <= 12; m++) (function (m) {
          var key = year + '-' + (m < 10 ? '0' : '') + m;
          grade.appendChild(h('button', {
            'class': 'chip', type: 'button', 'aria-pressed': key === cur ? 'true' : 'false', text: F.monthAbbr(key),
            'aria-label': F.monthLong(key),
            on: { click: function () { picked = true; resolve(key); rec.close(); } }
          }));
        })(m);
      }
      var body = h('div', null,
        h('div', { 'class': 'ano-nav' },
          h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Ano anterior', on: { click: function () { if (year > 2000) { year--; draw(); } } } }, icon('left')),
          anoTxt,
          h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Próximo ano', on: { click: function () { if (year < 2100) { year++; draw(); } } } }, icon('right'))),
        grade);
      draw();
      rec = openSheet({ title: o.title || 'Escolher mês', body: body, focus: 'none', onClose: function () { if (!picked) resolve(null); } });
    });
  }

  // ── campos de formulário ───────────────────────────────────────────────
  function field(label, input, help) {
    return h('label', { 'class': 'campo' }, h('span', { 'class': 'rot', text: label }), input, help ? h('div', { 'class': 'ajuda', text: help }) : null);
  }
  function moneyInput(cents, extra) {
    var attrs = { 'class': 'entrada dinheiro', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', enterkeyhint: 'done' };
    if (extra) for (var k in extra) attrs[k] = extra[k];
    var el = h('input', attrs);
    if (cents != null && cents !== 0) el.value = F.money(cents, { bare: true });
    return el;
  }
  // Grupo de botões (um escolhido). opts: [{v, t}]
  function segmented(opts, value, onChange, label) {
    var cur = value, el = h('div', { 'class': 'seg', role: 'group', 'aria-label': label || null });
    function draw() {
      clear(el);
      opts.forEach(function (o) {
        el.appendChild(h('button', {
          type: 'button', text: o.t, 'aria-pressed': o.v === cur ? 'true' : 'false',
          on: { click: function () { if (cur === o.v) return; cur = o.v; draw(); if (onChange) onChange(cur); } }
        }));
      });
    }
    draw();
    return { el: el, get: function () { return cur; }, set: function (v) { cur = v; draw(); } };
  }
  function checkRow(label, checked, onChange, help) {
    var box = h('input', { type: 'checkbox', checked: !!checked, on: { change: function () { if (onChange) onChange(box.checked); } } });
    return { el: h('label', { 'class': 'linha-opcao' }, h('span', { text: label }), box), box: box };
  }
  // Chavinha de liga/desliga (role="switch"), de um toque. Quem chama recebe o valor novo.
  // o: { label (nome para leitor de tela), checked, onChange(novoValor), data (marca para achar o botão depois) }
  function chave(o) {
    var on = !!o.checked;
    var btn = h('button', { 'class': 'chave', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': o.label },
      h('span', { 'class': 'chave-trilho' }, h('span', { 'class': 'chave-bola' }, icon('check', 'p'))));
    if (o.data) btn.setAttribute('data-baixa', o.data);
    var api = {
      el: btn,
      get: function () { return on; },
      set: function (v) { on = !!v; btn.setAttribute('aria-checked', on ? 'true' : 'false'); }
    };
    btn.addEventListener('click', function () { api.set(!on); if (o.onChange) o.onChange(on); });
    return api;
  }
  // Linha "texto ........ chavinha" (tocar no texto também liga e desliga)
  function chaveRow(label, checked, onChange) {
    var sw = chave({ label: label, checked: checked, onChange: onChange });
    // o texto é só um alvo de toque maior: o nome acessível já está na própria chavinha (evita ler duas vezes)
    var el = h('div', { 'class': 'linha-opcao chave-linha' }, h('span', { text: label, 'aria-hidden': 'true', on: { click: function () { sw.el.click(); } } }), sw.el);
    return { el: el, get: sw.get, set: sw.set, hide: function (x) { el.hidden = !!x; } };
  }

  // ── copiar / compartilhar ──────────────────────────────────────────────
  function copyText(text) {
    function legacy() {
      var ta = h('textarea', { style: 'position:fixed;opacity:0;left:-1000px', 'aria-hidden': 'true' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
    }
    return Promise.resolve(legacy());
  }
  function shareText(text, title) {
    // Dentro do app Android a folha de compartilhar vem da casca (a WebView não tem navigator.share)
    if (window.OrcAndroid && typeof window.OrcAndroid.share === 'function') {
      try { window.OrcAndroid.share(String(text)); return Promise.resolve('shared'); } catch (e) { /* cai para as opções abaixo */ }
    }
    if (navigator.share) return navigator.share({ title: title || 'Orçamento', text: text }).then(function () { return 'shared'; }, function (e) { return e && e.name === 'AbortError' ? 'cancel' : 'fail'; });
    return copyText(text).then(function (ok) { return ok ? 'copied' : 'fail'; });
  }

  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }

  App.dom = {
    h: h, s: s, clear: clear, icon: icon, statusIcon: statusIcon, STATUS_TXT: STATUS_TXT, toast: toast,
    openSheet: openSheet, closeAllSheets: closeAllSheets, sheetsOpen: sheetsOpen, confirmBox: confirmBox, pickMonth: pickMonth,
    field: field, moneyInput: moneyInput, segmented: segmented, checkRow: checkRow, chave: chave, chaveRow: chaveRow,
    copyText: copyText, shareText: shareText, debounce: debounce
  };
})(window.App = window.App || {});
