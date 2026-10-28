/* ════════════════════════════════════════════════════════════════════════
   sheets.js — os painéis de baixo: lançar/editar valor de um item num mês
   e criar item novo (conta, cartão, parcelado, renda).
   Quem só pode ler vê os mesmos dados, sem campos para mexer.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, E = window.Engine, h = d.h;

  var TIPO_TXT = { conta: 'Conta', cartao: 'Cartão', parcela: 'Parcelado', renda: 'Renda', outro: 'Outro' };
  function typeText(item) { return TIPO_TXT[item.type] || 'Item'; }
  function monthOf(dbDate) { return dbDate ? String(dbDate).slice(0, 7) : null; }
  function findItem(id) { return App.state.data.items.filter(function (i) { return i.id === id; })[0]; }

  // Botão que mostra um mês e abre o seletor; `allowEmpty` ganha um botão para limpar
  function monthField(label, value, o) {
    o = o || {};
    var cur = value || null, clearBtn = null;
    var btn = h('button', {
      type: 'button', 'class': 'entrada', style: 'flex:1;text-align:left',
      on: { click: function () { d.pickMonth({ value: cur || o.fallback, title: label }).then(function (m) { if (m) { cur = m; draw(); if (o.onChange) o.onChange(cur); } }); } }
    });
    if (o.allowEmpty) clearBtn = h('button', { type: 'button', 'class': 'btn-texto', text: o.emptyLabel || 'Sem fim', on: { click: function () { cur = null; draw(); if (o.onChange) o.onChange(null); } } });
    function draw() { btn.textContent = cur ? F.monthShort(cur) : (o.placeholder || 'Escolher mês'); if (clearBtn) clearBtn.hidden = !cur; }
    draw();
    var wrap = h('div', { 'class': 'campo' },
      h('span', { 'class': 'rot', text: label }),
      h('div', { style: 'display:flex;gap:8px;align-items:center' }, btn, clearBtn),
      o.help ? h('div', { 'class': 'ajuda', text: o.help }) : null);
    return { el: wrap, get: function () { return cur; }, set: function (v) { cur = v; draw(); }, hide: function (x) { wrap.hidden = !!x; } };
  }
  function dueInput(item) {
    return h('input', { 'class': 'entrada', type: 'number', inputmode: 'numeric', min: 1, max: 31, placeholder: 'Sem dia', value: item && item.due_day ? String(item.due_day) : '' });
  }
  function readDue(el) {
    var t = String(el.value).trim();
    if (t === '') return { ok: true, v: null };
    var n = parseInt(t, 10);
    if (!/^\d{1,2}$/.test(t) || n < 1 || n > 31) return { ok: false };
    return { ok: true, v: n };
  }
  function showError(box, msg) { box.textContent = msg; box.hidden = !msg; if (msg && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' }); }
  function done(rec, msg) {
    return App.reload(true).then(function () { rec.close(); d.toast(msg); });
  }
  function cardItems() { return App.state.data.items.filter(function (i) { return i.type === 'cartao' && i.active !== false; }); }
  function cardSelect(current) {
    var sel = h('select', { 'class': 'entrada' }, h('option', { value: '', text: 'Nenhum' }));
    cardItems().forEach(function (c) { sel.appendChild(h('option', { value: c.name, text: c.name })); });
    if (current && !cardItems().some(function (c) { return c.name === current; })) sel.appendChild(h('option', { value: current, text: current }));
    sel.value = current || '';
    return sel;
  }

  // ── só leitura ─────────────────────────────────────────────────────────
  function openReadOnly(item, month, cur, inst) {
    var rows = [
      ['Valor em ' + F.monthShort(month), F.money(cur.cents)],
      ['Tipo', typeText(item)],
      ['Vencimento', item.due_day ? 'dia ' + item.due_day : 'sem dia'],
      ['Repete todo mês', item.recurring ? 'sim, desde ' + F.monthShort(item.start_month) : 'não'],
      ['Termina em', item.end_month ? F.monthShort(item.end_month) : 'sem fim']
    ];
    // pago/recebido: só aparece se o banco já tem a tabela de marcas e a linha tem valor neste mês
    if (App.state.data.settledOk !== false && cur.cents !== 0) {
      var feito = E.isSettled(App.index(), item, E.mi(month)), ent = item.kind === 'entrada';
      rows.splice(1, 0, ['Situação em ' + F.monthShort(month), ent ? (feito ? 'Recebido' : 'A receber') : (feito ? 'Pago' : 'A pagar')]);
    }
    if (inst) rows.push(['Parcela', inst.k + ' de ' + inst.n]);
    if (item.card_name) rows.push(['No cartão', item.card_name]);
    var dl = h('dl', { 'class': 'leitura' });
    rows.forEach(function (r) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', { 'class': 'num', text: r[1] })); });
    var rec = d.openSheet({
      title: item.name, sub: F.monthLong(month), focus: 'none',
      body: h('div', null, h('div', { 'class': 'aviso info' }, d.icon('eye', 'p'), ' Sua conta é somente leitura.'), dl),
      footer: [h('button', { 'class': 'btn', type: 'button', text: 'Fechar', on: { click: function () { rec.close(); } } })]
    });
  }

  // ── lançar / editar valor de um item num mês ──────────────────────────
  function openLaunch(itemId, month) {
    var item = findItem(itemId);
    if (!item) return;
    var idx = App.index(), cur = E.amountAt(idx, item, E.mi(month)), inst = E.installmentAt(item, E.mi(month));
    if (!App.can()) return openReadOnly(item, month, cur, inst);

    var val = d.moneyInput(cur.cents, { 'aria-label': 'Valor em ' + F.monthShort(month) });
    var srcTxt = { real: 'Valor lançado por você (aparece em azul).', previsto: 'Valor que repete todo mês (aparece em preto).', vazio: 'Sem valor neste mês.' }[cur.source];
    var err = h('p', { 'class': 'erro-txt', role: 'alert', hidden: true });
    var scopeHint = h('div', { 'class': 'ajuda' });
    var scope = d.segmented([{ v: 'mes', t: 'Só este mês' }, { v: 'adiante', t: 'Deste mês em diante' }], 'mes', function () { hints(); }, 'Aplicar em');

    var name = h('input', { 'class': 'entrada', type: 'text', maxlength: 80, autocomplete: 'off', value: item.name });
    var due = dueInput(item);
    var end = monthField('Termina em', monthOf(item.end_month), { allowEmpty: true, placeholder: 'Sem fim', emptyLabel: 'Sem fim', fallback: month, help: 'Depois desse mês o valor deixa de repetir.' });
    var card = item.type === 'parcela' ? cardSelect(item.card_name) : null;
    var active = item.recurring ? null : d.checkRow('Ainda uso este item', item.active !== false);
    // "Já paguei / Já recebi": vale só para este mês; some quando o valor é zero (linha sem valor não tem o que marcar)
    var settleOk = App.state.data.settledOk !== false;
    var wasSettled = E.isSettled(idx, item, E.mi(month));
    var settle = d.chaveRow('Já ' + (item.kind === 'entrada' ? 'recebi' : 'paguei') + ' neste mês', wasSettled);

    function planFor(cents) { return E.planEdit(App.state.data, item, month, cents, scope.get()); }
    function hints() {
      var cents = F.parseMoney(val.value.trim() === '' ? '0' : val.value);
      end.hide(!(item.recurring || scope.get() === 'adiante'));
      settle.hide(!settleOk || isNaN(cents) || cents === 0);
      if (isNaN(cents)) { scopeHint.textContent = ''; return; }
      if (scope.get() === 'mes') {
        var proj = E.projectedAt(idx, item, E.mi(month));
        scopeHint.textContent = item.recurring && cents === proj ? 'É o valor que já repete: nada muda.' : 'Vale só para ' + F.monthShort(month) + '. Os outros meses não mudam.';
      } else if (cents < 0) {
        scopeHint.textContent = 'Valor que repete não pode ser negativo.';
      } else {
        var ops = planFor(cents);
        scopeHint.textContent = (item.recurring
          ? 'De ' + F.monthShort(month) + ' em diante o valor passa a ser ' + F.money(cents) + ' todo mês.'
          : 'O item passa a repetir todo mês, de ' + F.monthShort(month) + ' em diante, com ' + F.money(cents) + '. Hoje ele é lançado mês a mês.')
          + (ops.replaced ? ' Substitui ' + ops.replaced + (ops.replaced === 1 ? ' valor já definido' : ' valores já definidos') + ' mais à frente.' : '');
      }
    }
    val.addEventListener('input', hints);

    var saving = false;
    var save = h('button', { 'class': 'btn primario', type: 'button', text: 'Salvar', on: { click: onSave } });
    var cancel = h('button', { 'class': 'btn', type: 'button', text: 'Cancelar', on: { click: function () { rec.close(); } } });

    function onSave() {
      if (saving) return;
      showError(err, '');
      var cents = F.parseMoney(val.value.trim() === '' ? '0' : val.value);
      if (isNaN(cents)) return showError(err, 'Digite o valor assim: 1.234,56');
      if (scope.get() === 'adiante' && cents < 0) return showError(err, 'O valor que repete todo mês não pode ser negativo.');
      var nm = name.value.trim();
      if (!nm) return showError(err, 'O nome não pode ficar vazio.');
      var dd = readDue(due);
      if (!dd.ok) return showError(err, 'O dia de vencimento vai de 1 a 31.');

      var patch = {};
      if (nm !== item.name) patch.name = nm;
      if (dd.v !== (item.due_day || null)) patch.due_day = dd.v;
      if (card && (card.value || null) !== (item.card_name || null)) patch.card_name = card.value || null;
      if (active && active.box.checked !== (item.active !== false)) patch.active = active.box.checked;

      var ops = null;
      if (scope.get() === 'adiante' || cents !== cur.cents) ops = planFor(cents);
      if (settleOk && cents !== 0 && settle.get() !== wasSettled) ops = E.planSettle(App.state.data, item, month, settle.get(), ops);
      // fim: só vale se o item repete (já repetia ou vai repetir)
      var willRepeat = item.recurring || (ops && ops.item && ops.item.recurring);
      if (willRepeat) {
        var newEnd = end.get() ? E.toDbDate(end.get()) : null;
        var startDb = (ops && ops.item && ops.item.start_month) || item.start_month;
        if (newEnd && startDb && E.mi(newEnd) < E.mi(startDb)) return showError(err, 'O fim não pode ser antes do início (' + F.monthShort(startDb) + ').');
        if ((newEnd || null) !== (item.end_month || null)) patch.end_month = newEnd;
      }

      saving = true; save.disabled = true;
      var steps = Promise.resolve({ ok: true });
      if (ops) steps = steps.then(function () { return App.data.applyEdit(item.id, ops); });
      steps.then(function (r) {
        if (!r.ok) return r;
        if (!Object.keys(patch).length) return r;
        return App.data.updateItem(item.id, patch);
      }).then(function (r) {
        if (!r.ok) { saving = false; save.disabled = false; showError(err, r.error); return; }
        if (!ops && !Object.keys(patch).length) { rec.close(); return; }
        done(rec, 'Salvo');
      });
    }

    function onDelete() {
      d.confirmBox({ title: 'Apagar "' + item.name + '"?', text: 'Isso apaga o item e os valores dele em todos os meses. Não dá para desfazer.', ok: 'Apagar', danger: true }).then(function (yes) {
        if (!yes) return;
        App.data.deleteItem(item.id).then(function (r) {
          if (!r.ok) return showError(err, r.error);
          done(rec, 'Item apagado');
        });
      });
    }

    var opcoes = h('details', { style: 'margin:4px 0 12px' },
      h('summary', { text: 'Mais opções', style: 'min-height:44px;display:flex;align-items:center;font-weight:600;color:var(--azul);cursor:pointer' }),
      h('div', { style: 'padding-top:10px' },
        d.field('Nome', name),
        d.field('Dia do vencimento', due, 'Deixe vazio se não tiver dia fixo.'),
        card ? d.field('No cartão', card, 'Só para lembrar em qual cartão a parcela cai. Não soma duas vezes.') : null,
        end.el,
        active ? active.el : null,
        h('button', { 'class': 'btn perigo cheio', type: 'button', text: 'Apagar item', on: { click: onDelete } })));

    var body = h('div', null,
      inst ? h('p', { 'class': 'ajuda', style: 'margin:-6px 0 10px', text: 'Parcela ' + inst.k + ' de ' + inst.n + (item.card_name ? ' no cartão ' + item.card_name : '') }) : null,
      d.field('Valor em ' + F.monthShort(month), val, srcTxt),
      h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'Aplicar em' }), scope.el, scopeHint),
      settle.el,
      err, opcoes);
    var rec = d.openSheet({ title: item.name, sub: F.monthLong(month) + (item.kind === 'entrada' ? ', entrada' : ', saída'), body: body, footer: [cancel, save] });
    hints();
  }

  // ── item novo ──────────────────────────────────────────────────────────
  var KINDS = [{ v: 'conta', t: 'Conta' }, { v: 'cartao', t: 'Cartão' }, { v: 'parcelado', t: 'Parcelado' }, { v: 'renda', t: 'Renda' }];

  function openNew(kind, month) {
    if (!App.can()) { d.toast('Sua conta é somente leitura.', 'erro'); return; }
    month = month || F.currentMonth();
    var tipo = d.segmented(KINDS, kind || 'conta', function () { layout(); }, 'Tipo de item');
    var name = h('input', { 'class': 'entrada', type: 'text', maxlength: 80, autocomplete: 'off', placeholder: 'Ex.: Nubank, Internet, Salário' });
    var due = dueInput(null);
    var start = monthField('Começa em', month, { fallback: month });
    var amount = d.moneyInput(0);
    var total = d.moneyInput(0);
    var nParc = h('input', { 'class': 'entrada', type: 'number', inputmode: 'numeric', min: 1, max: 120, placeholder: '10' });
    var repete = d.checkRow('Repete todo mês', true, function () { layout(); });
    var end = monthField('Termina em', null, { allowEmpty: true, placeholder: 'Sem fim', emptyLabel: 'Sem fim', fallback: month, help: 'Deixe sem fim se continua para sempre.' });
    var card = cardSelect('');
    var amountLabel = h('span', { 'class': 'rot' });
    var amountHelp = h('div', { 'class': 'ajuda' });
    var parcelaInfo = h('div', { 'class': 'ajuda', style: 'margin-top:-6px;margin-bottom:12px;font-size:15px;color:var(--tinta-2)' });
    var dueLabel = h('span', { 'class': 'rot' });
    var err = h('p', { 'class': 'erro-txt', role: 'alert', hidden: true });

    var amountField = h('label', { 'class': 'campo' }, amountLabel, amount, amountHelp);
    var totalField = d.field('Valor total', total);
    var nField = d.field('Número de parcelas', nParc);
    var cardField = d.field('No cartão', card, 'Só para lembrar em qual cartão a parcela cai.');
    var dueField = h('label', { 'class': 'campo' }, dueLabel, due);

    function layout() {
      var k = tipo.get();
      var parc = k === 'parcelado';
      if (k === 'cartao') repete.box.checked = repete.box.dataset.touched ? repete.box.checked : false;
      amountField.hidden = parc; totalField.hidden = !parc; nField.hidden = !parc; cardField.hidden = !parc; parcelaInfo.hidden = !parc;
      repete.el.hidden = parc;
      end.hide(parc || !repete.box.checked);
      dueLabel.textContent = k === 'renda' ? 'Dia do recebimento (opcional)' : 'Dia do vencimento (opcional)';
      amountLabel.textContent = k === 'cartao' ? 'Fatura do mês de início (opcional)' : 'Valor por mês';
      amountHelp.textContent = k === 'cartao' && !repete.box.checked ? 'Faturas mudam todo mês: lance mês a mês no app. Se for sempre igual, ligue "Repete todo mês".' : '';
      if (parc) info();
    }
    repete.box.addEventListener('change', function () { repete.box.dataset.touched = '1'; });
    function info() {
      var t = F.parseMoney(total.value.trim() === '' ? '0' : total.value), n = parseInt(nParc.value, 10);
      if (isNaN(t) || t <= 0 || !(n >= 1)) { parcelaInfo.textContent = ''; return; }
      var sp = E.splitInstallments(t, n), s = start.get();
      parcelaInfo.textContent = n + 'x de ' + F.money(sp.per) + (sp.first !== sp.per ? ' (a primeira sai ' + F.money(sp.first) + ' por causa dos centavos)' : '') + ', de ' + F.monthShort(s) + ' a ' + F.monthShort(E.addMonths(s, n - 1)) + '.';
    }
    total.addEventListener('input', info); nParc.addEventListener('input', info);
    start.el.addEventListener('click', function () { setTimeout(info, 300); });

    var saving = false;
    var save = h('button', { 'class': 'btn primario', type: 'button', text: 'Adicionar', on: { click: onSave } });
    var cancel = h('button', { 'class': 'btn', type: 'button', text: 'Cancelar', on: { click: function () { rec.close(); } } });

    function onSave() {
      if (saving) return;
      showError(err, '');
      var k = tipo.get(), nm = name.value.trim();
      if (!nm) return showError(err, 'Dê um nome ao item.');
      var dd = readDue(due);
      if (!dd.ok) return showError(err, 'O dia vai de 1 a 31.');
      var s = start.get(), item, rates = [], entries = [];
      var base = { kind: k === 'renda' ? 'entrada' : 'saida', name: nm, card_name: null, due_day: dd.v, note: null, active: true, recurring: false, start_month: null, end_month: null };

      if (k === 'parcelado') {
        var t = F.parseMoney(total.value.trim() === '' ? '0' : total.value), n = parseInt(nParc.value, 10);
        if (isNaN(t) || t <= 0) return showError(err, 'Digite o valor total da compra.');
        if (!(n >= 1 && n <= 120)) return showError(err, 'O número de parcelas vai de 1 a 120.');
        var ex = E.expandSpec({ kind: 'saida', name: nm, start: s, n: n, perCents: E.splitInstallments(t, n).per, firstCents: E.splitInstallments(t, n).first, type: 'parcela', dueDay: dd.v, card: card.value || null });
        item = ex.item; rates = ex.rates;
      } else {
        var c = F.parseMoney(amount.value.trim() === '' ? '0' : amount.value);
        if (isNaN(c)) return showError(err, 'Digite o valor assim: 1.234,56');
        item = base; item.type = k === 'renda' ? 'renda' : (k === 'cartao' ? 'cartao' : 'conta');
        if (repete.box.checked) {
          if (c <= 0) return showError(err, 'Digite o valor que repete todo mês.');
          item.recurring = true; item.start_month = E.toDbDate(s);
          var e = end.get();
          if (e) {
            if (E.mi(e) < E.mi(s)) return showError(err, 'O fim não pode ser antes do início.');
            item.end_month = E.toDbDate(e);
          }
          rates = [{ item_id: null, from_month: E.toDbDate(s), amount: c / 100 }];
        } else if (c !== 0) {
          entries = [{ month: E.toDbDate(s), amount: c / 100 }];
        }
      }
      delete item.id;
      var rr = rates.map(function (r) { return { from_month: r.from_month, amount: r.amount }; });
      saving = true; save.disabled = true;
      App.data.createItem(item, rr, entries).then(function (r) {
        if (!r.ok) { saving = false; save.disabled = false; return showError(err, r.error); }
        done(rec, 'Adicionado').then(function () { App.go('mes', { month: s }); });
      });
    }

    var body = h('div', null,
      h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'O que você quer adicionar?' }), tipo.el),
      d.field('Nome', name), dueField, start.el,
      amountField, totalField, nField, parcelaInfo, cardField,
      repete.el, end.el, err);
    var rec = d.openSheet({ title: 'Novo item', body: body, footer: [cancel, save], focus: 'none' });
    layout();
    setTimeout(function () { try { name.focus(); } catch (e) {} }, 60);
  }

  // Criar de verdade um item que veio de uma simulação
  function createFromSpec(spec) {
    var ex = E.expandSpec(spec);
    var item = ex.item; delete item.id;
    var rates = ex.rates.map(function (r) { return { from_month: r.from_month, amount: r.amount }; });
    return App.data.createItem(item, rates, []);
  }

  App.sheets = { openLaunch: openLaunch, openNew: openNew, createFromSpec: createFromSpec, typeText: typeText, monthField: monthField };
})(window.App = window.App || {});
