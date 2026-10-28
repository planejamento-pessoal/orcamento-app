/* ════════════════════════════════════════════════════════════════════════
   sim-view.js — a aba "Simular": "e se eu comprar isso?" / "e se entrar
   mais essa renda?". Nada é gravado no banco: o cenário fica só neste
   aparelho até você decidir lançar de verdade.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, E = window.Engine, D = App.data, h = d.h;
  function simsKey() { return 'orc.sims.v1:' + (App.state.user ? App.state.user.id : ''); }   // cada pessoa tem o seu cenário
  var chartApi = null;
  var form = { tipo: 'compra', nome: '', total: '', modo: 'avista', n: '10', start: null, fim: null };
  var WAYS = [1, 2, 3, 6, 10, 12];

  function loadSims() { var s = D.store.get(simsKey(), []); return Array.isArray(s) ? s : []; }
  function saveSims(list) { D.store.set(simsKey(), list); }
  function startOf() { return form.start || F.currentMonth(); }

  function describe(sp) {
    if (sp.kind === 'entrada') {
      return F.money(sp.perCents) + ' por mês, a partir de ' + F.monthShort(sp.start) + (sp.n ? ' até ' + F.monthShort(E.addMonths(sp.start, sp.n - 1)) : ', sem fim');
    }
    if (sp.n === 1) return 'À vista, ' + F.money(sp.totalCents) + ' em ' + F.monthShort(sp.start);
    return sp.n + 'x de ' + F.money(sp.perCents) + ' (total ' + F.money(sp.totalCents) + '), de ' + F.monthShort(sp.start) + ' a ' + F.monthShort(E.addMonths(sp.start, sp.n - 1));
  }
  function statusText(stt) { return stt === 'ok' ? 'Cabe' : stt === 'low' ? 'Fica abaixo do mínimo' : 'Fica negativo'; }

  function render(main) {
    if (chartApi) { chartApi.destroy(); chartApi = null; }
    var st = App.state, settings = st.data.settings, minC = E.minCents(settings), sims = loadSims(), can = App.can();
    var from = F.currentMonth();
    if (!form.start) form.start = from;

    // ── formulário ───────────────────────────────────────────────────────
    var err = h('p', { 'class': 'erro-txt', role: 'alert', hidden: true });
    var tipo = d.segmented([{ v: 'compra', t: 'Compra' }, { v: 'renda', t: 'Renda nova' }], form.tipo, function (v) { form.tipo = v; App.render(true); }, 'O que simular');
    var nome = h('input', { 'class': 'entrada', type: 'text', maxlength: 60, autocomplete: 'off', placeholder: form.tipo === 'compra' ? 'Ex.: Fogão' : 'Ex.: Aumento, extra', value: form.nome, on: { input: function () { form.nome = this.value; } } });
    var total = d.moneyInput(0, { 'aria-label': form.tipo === 'compra' ? 'Valor total' : 'Valor por mês' });
    total.value = form.total;
    var info = h('div', { 'class': 'ajuda', style: 'font-size:15px;color:var(--tinta-2);margin:-6px 0 14px' });
    var maneiras = h('div');
    var start = App.sheets.monthField('Começa em', form.start, { fallback: from, onChange: function (m) { form.start = m; refreshLive(); } });

    var modo = null, nParc = null, fim = null;
    if (form.tipo === 'compra') {
      modo = d.segmented([{ v: 'avista', t: 'À vista' }, { v: 'parcelado', t: 'Parcelado' }], form.modo, function (v) { form.modo = v; App.render(true); }, 'Como pagar');
      nParc = h('input', { 'class': 'entrada', type: 'number', inputmode: 'numeric', min: 2, max: 120, value: form.n, on: { input: function () { form.n = this.value; refreshLive(); } } });
    } else {
      fim = App.sheets.monthField('Termina em', form.fim, { allowEmpty: true, placeholder: 'Sem fim', emptyLabel: 'Sem fim', fallback: from, onChange: function (m) { form.fim = m; } });
    }
    total.addEventListener('input', function () { form.total = this.value; refreshLive(); });

    function parsed() {
      var c = F.parseMoney(form.total.trim() === '' ? '0' : form.total);
      if (isNaN(c) || c <= 0) return null;
      if (form.tipo === 'compra') {
        var n = form.modo === 'avista' ? 1 : parseInt(form.n, 10);
        if (!(n >= 1 && n <= 120)) return null;
        var sp = E.splitInstallments(c, n);
        return { kind: 'saida', n: n, perCents: sp.per, firstCents: sp.first, totalCents: c, start: form.start };
      }
      return { kind: 'entrada', n: null, perCents: c, totalCents: c, start: form.start };
    }

    // texto "n x de R$ ..." e as formas de pagar, ao vivo
    function refreshLive() {
      var p = parsed();
      info.textContent = '';
      d.clear(maneiras);
      if (!p) return;
      if (form.tipo === 'compra' && p.n > 1) info.textContent = p.n + 'x de ' + F.money(p.perCents) + (p.firstCents !== p.perCents ? ' (a primeira sai ' + F.money(p.firstCents) + ' por causa dos centavos)' : '') + ', de ' + F.monthShort(p.start) + ' a ' + F.monthShort(E.addMonths(p.start, p.n - 1)) + '.';
      if (form.tipo !== 'compra') return;
      var base = sims.length ? E.withSims(st.data, sims) : st.data;
      var ways = E.waysToPay(base, settings, { totalCents: p.totalCents, start: p.start, options: WAYS, horizon: 24 });
      var fit = E.cashFitMonth(base, settings, p.totalCents, from, 36, 24);
      var ul = h('ul', { 'class': 'livro' });
      ways.forEach(function (w) {
        var label = w.n === 1 ? 'À vista' : w.n + 'x de ' + F.money(w.per);
        var on = (form.modo === 'avista' && w.n === 1) || (form.modo === 'parcelado' && String(w.n) === String(form.n));
        ul.appendChild(h('li', null, h('button', {
          'class': 'linha', type: 'button', style: 'grid-template-columns:1fr auto' + (on ? ';background:var(--azul-fundo)' : ''),
          'aria-label': label + ': ' + statusText(w.status) + ', menor saldo ' + F.money(w.min),
          on: { click: function () { form.modo = w.n === 1 ? 'avista' : 'parcelado'; if (w.n > 1) form.n = String(w.n); App.render(true); } }
        },
          h('span', { 'class': 'nome' }, label, h('span', { 'class': 'meta', text: 'Menor saldo ' + F.money(w.min) + (w.minMonth ? ' em ' + F.monthShort(w.minMonth) : '') })),
          h('span', { 'class': 'valor ' + (w.status === 'ok' ? 'ic-ok' : w.status === 'low' ? 'ic-low' : 'ic-neg'), style: 'gap:6px;font-size:16px;font-weight:600' }, d.statusIcon(w.status), statusText(w.status)))));
      });
      maneiras.appendChild(h('div', { 'class': 'secao', style: 'padding-top:6px' }, h('h2', { style: 'font-size:19px', text: 'Como pagar' })));
      maneiras.appendChild(h('p', { 'class': 'ajuda', style: 'padding:8px 0', text: fit ? 'À vista, dá para comprar a partir de ' + F.monthShort(fit.month) + ' mantendo o mínimo de ' + F.money(minC) + '.' : 'À vista não cabe nos próximos 3 anos mantendo o mínimo de ' + F.money(minC) + '.' }));
      maneiras.appendChild(ul);
    }

    function onAdd() {
      say('');
      var p = parsed();
      if (!p) return say(form.tipo === 'compra' ? 'Digite o valor total e, se for parcelado, de 2 a 120 parcelas.' : 'Digite o valor por mês.');
      var nm = form.nome.trim() || (form.tipo === 'compra' ? 'Compra ' + (sims.length + 1) : 'Renda ' + (sims.length + 1));
      var sp = { id: D.uuid(), kind: p.kind, name: nm, start: p.start, n: p.n, perCents: p.perCents, firstCents: p.firstCents != null ? p.firstCents : p.perCents, totalCents: p.totalCents };
      if (p.kind === 'entrada' && form.fim) {
        if (E.mi(form.fim) < E.mi(p.start)) return say('O fim não pode ser antes do início.');
        sp.n = E.diffMonths(p.start, form.fim) + 1;
      }
      sims.push(sp); saveSims(sims);
      form.nome = ''; form.total = '';
      App.render(true);
      var res = document.querySelector('section[aria-label="Resultado da simulação"]');
      if (res && res.scrollIntoView) res.scrollIntoView({ block: 'start' });
    }
    function say(msg) { err.textContent = msg; err.hidden = !msg; }

    var painel = h('section', { 'class': 'painel', 'aria-label': 'Nova simulação' },
      h('h2', { text: 'Simular' }),
      h('div', { 'class': 'campo' }, tipo.el),
      d.field('Nome (opcional)', nome),
      d.field(form.tipo === 'compra' ? 'Valor total' : 'Valor por mês', total),
      form.tipo === 'compra' ? h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'Como pagar' }), modo.el) : null,
      form.tipo === 'compra' && form.modo === 'parcelado' ? d.field('Número de parcelas', nParc) : null,
      info, start.el, fim ? fim.el : null, err,
      h('button', { 'class': 'btn primario cheio', type: 'button', text: 'Adicionar ao cenário', on: { click: onAdd } }),
      maneiras);
    main.appendChild(painel);
    refreshLive();

    // ── cenário e resultado ──────────────────────────────────────────────
    if (!sims.length) {
      main.appendChild(h('p', { 'class': 'vazio', text: 'Adicione uma compra ou uma renda para ver como o saldo muda nos próximos meses. Nada disso é salvo no orçamento.' }));
      return;
    }
    var lista = h('div', { 'class': 'cenario' });
    sims.forEach(function (sp) {
      lista.appendChild(h('div', { 'class': 'cena-item' },
        h('div', null, h('span', { 'class': 'nome', text: sp.name }), h('span', { 'class': 'meta', text: describe(sp) })),
        h('div', { style: 'display:flex;align-items:center;gap:2px' },
          can ? h('button', { 'class': 'btn p', type: 'button', text: 'Lançar', 'aria-label': 'Lançar ' + sp.name + ' no orçamento', on: { click: function () { launch(sp); } } }) : null,
          h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Tirar ' + sp.name + ' do cenário', on: { click: function () { sims = sims.filter(function (x) { return x.id !== sp.id; }); saveSims(sims); App.render(true); } } }, d.icon('x')))));
    });
    main.appendChild(h('section', { 'aria-label': 'Cenário' }, h('div', { 'class': 'secao' }, h('h2', { text: 'Cenário' }),
      h('button', { 'class': 'btn-texto', type: 'button', text: 'Limpar', on: { click: function () { sims = []; saveSims(sims); App.render(true); } } })), lista));

    var last = sims.reduce(function (m, sp) { var e = E.mi(sp.start) + (sp.n ? sp.n - 1 : 0); return Math.max(m, e); }, E.mi(from));
    var count = Math.max(24, Math.min(120, last - E.mi(from) + 13));
    var sc = E.scenario(st.data, settings, sims, from, count);
    var b = sc.baseSummary, s = sc.simSummary;
    var stSim = s.min === null ? null : E.statusOf(s.min, minC);

    var verdict;
    if (stSim === null) verdict = h('div', { 'class': 'aviso info', text: 'O saldo acumulado começa em ' + F.monthShort(settings.balance_start_month) + '.' });
    else if (stSim === 'ok') verdict = h('div', { 'class': 'aviso info' }, h('b', { text: 'Cabe. ' }), 'O menor saldo do período fica em ' + F.money(s.min) + ' (' + F.monthShort(s.minMonth) + '), acima do mínimo de ' + F.money(minC) + '.');
    else if (stSim === 'neg') verdict = h('div', { 'class': 'aviso perigo' }, h('b', { text: 'Não cabe. ' }), 'O saldo fica negativo a partir de ' + F.monthShort(s.firstNeg) + ' (menor saldo ' + F.money(s.min) + ').');
    else verdict = h('div', { 'class': 'aviso' }, h('b', { text: 'Aperta. ' }), 'O saldo cai abaixo do mínimo de ' + F.money(minC) + ' a partir de ' + F.monthShort(s.firstLow) + ' (menor saldo ' + F.money(s.min) + ').');

    var comp = h('div', { 'class': 'comparativo' },
      h('div', { 'class': 'comp-linha comp-cab' }, h('span'), h('span', { 'class': 'r', text: 'Sem simulação' }), h('span', { 'class': 'r', text: 'Com simulação' })),
      h('div', { 'class': 'comp-linha' }, h('span', { text: 'Menor saldo' }), h('span', { 'class': 'r', text: b.min == null ? '—' : F.money(b.min) }), h('span', { 'class': 'r', text: s.min == null ? '—' : F.money(s.min) })),
      h('div', { 'class': 'comp-linha' }, h('span', { text: 'Em' }), h('span', { 'class': 'r', text: b.minMonth ? F.monthShort(b.minMonth) : '—' }), h('span', { 'class': 'r', text: s.minMonth ? F.monthShort(s.minMonth) : '—' })),
      h('div', { 'class': 'comp-linha' }, h('span', { text: 'Saldo no fim' }), h('span', { 'class': 'r', text: b.last == null ? '—' : F.money(b.last) }), h('span', { 'class': 'r', text: s.last == null ? '—' : F.money(s.last) })));

    var host = h('div', { 'class': 'grafico' });
    main.appendChild(h('section', { 'aria-label': 'Resultado da simulação' },
      h('div', { 'class': 'secao' }, h('h2', { text: 'Resultado' })), h('div', { style: 'padding-top:12px' }, verdict), comp, host,
      h('div', { 'class': 'legenda' },
        h('span', null, h('i', { 'class': 'k', style: 'border-top-color:var(--tinta-3)' }), 'Sem simulação'),
        h('span', null, h('i', { 'class': 'k', style: 'border-top-color:var(--serie)' }), 'Com simulação'),
        h('span', null, h('i', { 'class': 'k min' }), 'Saldo mínimo'))));
    var hasValues = sc.sim.some(function (p) { return p.saldo != null; });
    if (hasValues) {
      chartApi = App.chart.line(host, {
        series: [
          { key: 'base', label: 'Sem simulação', color: 'var(--tinta-3)', pts: sc.base },
          { key: 'sim', label: 'Com simulação', color: 'var(--serie)', emphasis: true, pts: sc.sim }
        ],
        minCents: minC, ariaLabel: 'Saldo com e sem a simulação, de ' + F.monthShort(sc.sim[0].month) + ' a ' + F.monthShort(sc.sim[sc.sim.length - 1].month),
        extras: function (i) { var a = sc.base[i].saldo, c = sc.sim[i].saldo; return a == null || c == null ? [] : [['Diferença', F.money(c - a, { sign: true })]]; }
      });
    }
    // tabela equivalente (o gráfico nunca é a única forma de ler)
    var tb = h('tbody');
    sc.sim.forEach(function (p, i) {
      var a = sc.base[i].saldo;
      tb.appendChild(h('tr', null,
        h('td', null, h('div', { 'class': 'cel', text: F.monthShort(p.month) })),
        h('td', null, h('div', { 'class': 'cel', text: a == null ? '—' : F.money(a, { bare: true }) })),
        h('td', null, h('div', { 'class': 'cel' + (p.saldo != null && p.saldo < 0 ? ' neg-txt' : ''), text: p.saldo == null ? '—' : F.money(p.saldo, { bare: true }) }))));
    });
    main.appendChild(h('details', { style: 'padding:8px 16px' },
      h('summary', { text: 'Ver mês a mês', style: 'min-height:44px;display:flex;align-items:center;font-weight:600;color:var(--azul);cursor:pointer' }),
      h('table', { 'class': 'tabela' },
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Mês' }), h('th', { scope: 'col', text: 'Sem (R$)' }), h('th', { scope: 'col', text: 'Com (R$)' }))), tb)));

    function launch(sp) {
      d.confirmBox({ title: 'Lançar "' + sp.name + '"?', text: 'Vai criar o item de verdade no orçamento (' + describe(sp) + '), visível para todos. A simulação sai do cenário.', ok: 'Lançar' }).then(function (yes) {
        if (!yes) return;
        App.sheets.createFromSpec({ kind: sp.kind, name: sp.name, start: sp.start, n: sp.n, perCents: sp.perCents, firstCents: sp.firstCents }).then(function (r) {
          if (!r.ok) return d.toast(r.error, 'erro');
          sims = sims.filter(function (x) { return x.id !== sp.id; }); saveSims(sims);
          App.reload(true).then(function () { d.toast('Lançado no orçamento'); App.go('mes', { month: sp.start }); });
        });
      });
    }
  }

  App.views.sim = { render: render };
})(window.App = window.App || {});
