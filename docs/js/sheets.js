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
  function openReadOnly(item, month, cur, inst, carry) {
    var rows = [
      ['Valor em ' + F.monthShort(month), F.money(cur.cents)],
      ['Tipo', typeText(item)],
      ['Vencimento', item.due_day ? 'dia ' + item.due_day : 'sem dia'],
      ['Repete todo mês', item.recurring ? 'sim, desde ' + F.monthShort(item.start_month) : 'não'],
      ['Termina em', item.end_month ? F.monthShort(item.end_month) : 'sem fim']
    ];
    if (carry) {                                                     // conta corrente: a sobra do mês anterior
      rows = [
        ['Saldo no começo de ' + F.monthName(month), F.money(cur.cents)],
        [carry.real ? 'Previsto (sobra de ' + F.monthName(carry.prev) + ')' : 'Sobra de ' + F.monthName(carry.prev), F.money(carry.auto)],
        ['Situação', carry.real ? 'Corrigido com o saldo real' : 'Automático'],
        ['Tipo', 'Conta corrente']
      ];
    }
    // pago/recebido: só aparece se o banco já tem a tabela de marcas e a linha tem valor neste mês
    if (!carry && App.state.data.settledOk !== false && cur.cents !== 0) {
      var feito = E.isSettled(App.index(), item, E.mi(month)), ent = item.kind === 'entrada';
      rows.splice(1, 0, ['Situação em ' + F.monthShort(month), ent ? (feito ? 'Recebido' : 'A receber') : (feito ? 'Pago' : 'A pagar')]);
    }
    if (inst) rows.push(['Parcela', inst.k + ' de ' + inst.n]);
    if (item.card_name) rows.push(['No cartão', item.card_name]);
    if (!carry && E.isCarryItem(item)) rows.push(['Conta corrente', 'puxa a sobra do mês anterior']);
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
    // Conta corrente: depois do mês inicial do saldo o "valor" é a sobra do mês anterior, que aparece
    // sozinha; digitar aqui é dizer o saldo REAL da conta. `isCC`: o item é a conta corrente em qualquer mês (nunca repete).
    var carry = E.carryAt(idx, item, month), isCC = E.isCarry(idx, item);
    if (!App.can()) return openReadOnly(item, month, cur, inst, carry);

    var valLabel = carry ? 'Saldo da conta no começo de ' + F.monthName(month) : 'Valor em ' + F.monthShort(month);
    var val = d.moneyInput(cur.cents, { 'aria-label': valLabel });
    var srcTxt = carry
      ? (carry.real
        ? 'Saldo que você lançou (aparece em azul). O previsto era ' + F.money(carry.auto) + ', a sobra de ' + F.monthName(carry.prev) + '.'
        : 'Automático: é o que sobrou de ' + F.monthName(carry.prev) + '. Se o saldo do seu banco for outro, digite o valor real: os meses seguintes partem dele.')
      : { real: 'Valor lançado por você (aparece em azul).', previsto: 'Valor que repete todo mês (aparece em preto).', vazio: 'Sem valor neste mês.' }[cur.source];
    var err = h('p', { 'class': 'erro-txt', role: 'alert', hidden: true });
    var scopeHint = h('div', { 'class': 'ajuda' });
    var scope = d.segmented([{ v: 'mes', t: 'Só este mês' }, { v: 'adiante', t: 'Deste mês em diante' }], 'mes', function () { hints(); }, 'Aplicar em');
    var scopeBox = h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'Aplicar em' }), scope.el, scopeHint);
    scopeBox.hidden = isCC;                                   // a conta corrente não repete: não existe "deste mês em diante"

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
      settle.hide(!settleOk || isNaN(cents) || cents === 0 || !!carry);   // a sobra do mês anterior não é "recebida"
      if (isNaN(cents) || isCC) { scopeHint.textContent = ''; return; }
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

    // Com a chavinha da conta corrente ligada (ou se o item já é a conta corrente) ela nunca repete: o "Aplicar em"
    // some (fica em "Só este mês") e o "Ainda uso este item" também (parar a conta corrente é desligar a chavinha).
    function syncCarry() {
      var on = carrySwitch ? carrySwitch.get() : isCC;
      if (on) scope.set('mes');
      scopeBox.hidden = on;
      if (active) active.el.hidden = on;
      hints();
    }

    var saving = false;
    var save = h('button', { 'class': 'btn primario', type: 'button', text: 'Salvar', on: { click: onSave } });
    var cancel = h('button', { 'class': 'btn', type: 'button', text: 'Cancelar', on: { click: function () { rec.close(); } } });

    function onSave() {
      if (saving) return;
      showError(err, '');
      // conta corrente: campo vazio não quer dizer "automático" (isso é o botão "Voltar ao automático")
      if (carry && val.value.trim() === '') return showError(err, 'Digite o saldo da conta, ou toque em "Voltar ao automático".');
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
      if (active && !active.el.hidden && active.box.checked !== (item.active !== false)) patch.active = active.box.checked;
      // a conta corrente não fica "parada" (parar é desligar a chavinha): ligar a chavinha num item parado o reativa.
      // (Um item que já é conta corrente e está parado, só por edição direta no banco, segue valendo: o motor não olha "ativo".)
      var carryChanged = !!carrySwitch && carrySwitch.get() !== (item.carry_over === true);
      if (carryChanged && carrySwitch.get() && item.active === false) patch.active = true;

      var ops = null;
      if (scope.get() === 'adiante' || cents !== cur.cents) ops = planFor(cents);
      if (settleOk && cents !== 0 && !carry && settle.get() !== wasSettled) ops = E.planSettle(App.state.data, item, month, settle.get(), ops);
      // Ligar ou desligar a conta corrente é salvo sozinho. Junto com um valor novo, o resultado dependeria da ordem
      // das gravações (o valor digitado poderia ser apagado pelo "desligar"), então a tela pede uma coisa de cada vez.
      if (carryChanged && ops) return showError(err, 'Ligue ou desligue a conta corrente sem mudar o valor ao mesmo tempo. Salve a chavinha primeiro e ajuste o valor depois.');
      // fim: só vale se o item repete (já repetia ou vai repetir)
      var willRepeat = item.recurring || (ops && ops.item && ops.item.recurring);
      if (willRepeat) {
        var newEnd = end.get() ? E.toDbDate(end.get()) : null;
        var startDb = (ops && ops.item && ops.item.start_month) || item.start_month;
        if (newEnd && startDb && E.mi(newEnd) < E.mi(startDb)) return showError(err, 'O fim não pode ser antes do início (' + F.monthShort(startDb) + ').');
        if ((newEnd || null) !== (item.end_month || null)) patch.end_month = newEnd;
      }

      // ligar/desligar a conta corrente (puxar a sobra do mês anterior)
      var carryPlan = null;
      if (carryChanged) carryPlan = E.planCarry(App.state.data, item, carrySwitch.get());
      var ask = Promise.resolve(true);
      if (carryPlan && carryPlan.afetados > 0) {
        var n = carryPlan.afetados, startTxt = F.monthShort(App.state.data.settings.balance_start_month);
        ask = d.confirmBox(carryPlan.item.carry_over
          ? { title: 'Ligar a conta corrente?', ok: 'Ligar', text: (n === 1 ? 'Este item tem 1 valor lançado depois de ' + startTxt + '. Ele passa' : 'Este item tem ' + n + ' valores lançados depois de ' + startTxt + '. Eles passam') + ' a valer como o saldo real da conta naquele mês.' }
          : { title: 'Desligar a conta corrente?', ok: 'Desligar', danger: true, text: (n === 1 ? 'O saldo real que você lançou depois de ' + startTxt + ' será apagado' : 'Os ' + n + ' saldos reais que você lançou depois de ' + startTxt + ' serão apagados') + ': sem a conta corrente eles virariam entradas comuns e mexeriam no saldo.' });
      }

      ask.then(function (yes) {
        if (!yes) return;
        saving = true; save.disabled = true;
        var steps = Promise.resolve({ ok: true });
        if (ops) steps = steps.then(function () { return App.data.applyEdit(item.id, ops); });
        steps.then(function (r) {
          if (!r.ok) return r;
          if (!Object.keys(patch).length) return r;
          return App.data.updateItem(item.id, patch);
        }).then(function (r) {
          if (!r.ok || !carryPlan) return r;
          return App.data.applyEdit(item.id, carryPlan);
        }).then(function (r) {
          if (!r.ok) { saving = false; save.disabled = false; showError(err, r.error); return; }
          if (!ops && !carryPlan && !Object.keys(patch).length) { rec.close(); return; }
          done(rec, 'Salvo');
        });
      });
    }

    // conta corrente: apaga o saldo real lançado neste mês e volta a sobra do mês anterior
    function onAuto() {
      if (saving) return;
      showError(err, '');
      saving = true; save.disabled = true;
      App.data.applyEdit(item.id, E.planCarryAuto(App.state.data, item, month)).then(function (r) {
        if (!r.ok) { saving = false; save.disabled = false; showError(err, r.error); return; }
        done(rec, 'Voltou ao automático');
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

    // Conta corrente: "puxar a sobra do mês anterior". Só para entrada que não repete, e só um item por vez.
    var carrySwitch = null, carryNote = null;
    if (item.kind === 'entrada') {
      var outraCC = App.state.data.items.filter(function (i) { return i.id !== item.id && E.isCarryItem(i); })[0];
      if (item.recurring) carryNote = 'Conta corrente: só vale para uma entrada que não repete todo mês (a que guarda o dinheiro da sua conta).';
      else if (outraCC) carryNote = 'Conta corrente: já é o item "' + outraCC.name + '". Só um item por vez; desligue o outro antes.';
      else {
        carrySwitch = d.chaveRow('Puxar a sobra do mês anterior', item.carry_over === true, syncCarry);
        carryNote = 'Para o item que guarda o dinheiro que você tem na conta do banco. Em cada mês depois de ' + F.monthShort(App.state.data.settings.balance_start_month)
          + ', ele mostra o que sobrou do mês anterior, sem somar de novo no saldo. Se o banco mostrar outro valor, você corrige no mês.';
      }
    }

    var opcoes = h('details', { style: 'margin:4px 0 12px' },
      h('summary', { text: 'Mais opções', style: 'min-height:44px;display:flex;align-items:center;font-weight:600;color:var(--azul);cursor:pointer' }),
      h('div', { style: 'padding-top:10px' },
        d.field('Nome', name),
        d.field('Dia do vencimento', due, 'Deixe vazio se não tiver dia fixo.'),
        card ? d.field('No cartão', card, 'Só para lembrar em qual cartão a parcela cai. Não soma duas vezes.') : null,
        end.el,
        active ? active.el : null,
        carrySwitch ? carrySwitch.el : null,
        carryNote ? h('div', { 'class': 'ajuda', style: 'margin:-2px 0 12px', text: carryNote }) : null,
        h('button', { 'class': 'btn perigo cheio', type: 'button', text: 'Apagar item', on: { click: onDelete } })));

    var body = h('div', null,
      inst ? h('p', { 'class': 'ajuda', style: 'margin:-6px 0 10px', text: 'Parcela ' + inst.k + ' de ' + inst.n + (item.card_name ? ' no cartão ' + item.card_name : '') }) : null,
      d.field(valLabel, val, srcTxt),
      carry && carry.real ? h('button', { 'class': 'btn-texto', type: 'button', style: 'margin:-4px 0 10px', text: 'Voltar ao automático (' + F.money(carry.auto) + ')', on: { click: onAuto } }) : null,
      scopeBox,
      settle.el,
      err, opcoes);
    var rec = d.openSheet({ title: item.name, sub: F.monthLong(month) + (item.kind === 'entrada' ? ', entrada' : ', saída'), body: body, footer: [cancel, save] });
    syncCarry();
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
