/* ════════════════════════════════════════════════════════════════════════
   sim-view.js — as abas "Simular" e "Compras".

   Simular: "e se eu comprar isso?" / "e se entrar mais essa renda?". Nada é
   gravado no banco: o cenário fica só neste aparelho até você decidir lançar
   de verdade.

   Compras (a aba PRIORIDADES da planilha): o que você quer comprar, em que
   ordem, e se cabe no orçamento (à vista ou parcelado). Cada compra pode ser
   mandada para o Simular.

   As duas moram no MESMO arquivo de propósito. O index.html lista os arquivos do
   app, e o APK já instalado leva uma cópia dessa lista: se ela crescesse, o APK
   antigo não abriria, sem internet, a cópia guardada da versão nova (veja
   tests/launcher.test.js). Código novo entra em arquivo que já está na lista.
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

  // A aba Compras manda uma compra para cá ("Ver no Simular"). spec: formato de Engine.purchaseSpec +
  // { id, purchaseId }. Mandar a mesma compra, do mesmo jeito, outra vez troca a anterior (não duplica).
  function addSim(spec) {
    var list = loadSims().filter(function (x) { return x.id !== spec.id; });
    list.push(spec);
    saveSims(list);
    form.tipo = 'compra';
  }
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
      // Se a simulação veio da aba Compras, lançar também fecha a compra (senão ela contaria duas vezes: já
      // está no orçamento e ainda aparece como "a comprar").
      var daCompra = sp.purchaseId && (App.state.data.purchases || []).some(function (p) { return p.id === sp.purchaseId && p.status !== 'concluido'; });
      d.confirmBox({
        title: 'Lançar "' + sp.name + '"?',
        text: 'Vai criar o item de verdade no orçamento (' + describe(sp) + '), visível para todos. A simulação sai do cenário.' + (daCompra ? ' A compra também fica como concluída na aba Compras.' : ''),
        ok: 'Lançar'
      }).then(function (yes) {
        if (!yes) return;
        App.sheets.createFromSpec({ kind: sp.kind, name: sp.name, start: sp.start, n: sp.n, perCents: sp.perCents, firstCents: sp.firstCents }).then(function (r) {
          if (!r.ok) return d.toast(r.error, 'erro');
          sims = sims.filter(function (x) { return x.id !== sp.id; }); saveSims(sims);
          var fecha = daCompra ? D.updatePurchase(sp.purchaseId, { status: 'concluido' }) : Promise.resolve({ ok: true });
          fecha.then(function (rc) {
            App.reload(true).then(function () {
              d.toast(rc.ok ? 'Lançado no orçamento' : 'Lançado no orçamento. Não consegui marcar a compra como concluída: marque na aba Compras.', rc.ok ? null : 'erro');
              App.go('mes', { month: sp.start });
            });
          });
        });
      });
    }
  }

  App.views.sim = { render: render };
  App.sim = { add: addSim };
})(window.App = window.App || {});

/* ── Compras ───────────────────────────────────────────────────────────── */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, E = window.Engine, D = App.data, h = d.h;
  var filter = 'pendentes';
  var FILTERS = [{ v: 'pendentes', t: 'Pendentes' }, { v: 'concluidas', t: 'Concluídas' }, { v: 'todas', t: 'Todas' }];
  var STATUS = [{ v: 'nada', t: 'Nada' }, { v: 'planejado', t: 'Planejado' }, { v: 'orcando', t: 'Orçando' }, { v: 'concluido', t: 'Concluído' }];
  var STATUS_TXT = { nada: 'Nada', planejado: 'Planejado', orcando: 'Orçando', concluido: 'Concluído' };

  function monthOf(dbDate) { return dbDate ? String(dbDate).slice(0, 7) : null; }
  function purchases() { var p = App.state.data && App.state.data.purchases; return Array.isArray(p) ? p : []; }
  function findPurchase(id) { return purchases().filter(function (p) { return p.id === id; })[0]; }
  function evaluate(list) {
    var data = App.state.data;
    return E.evaluatePurchases(data, data.settings, list, { today: F.currentMonth() });
  }
  function cap(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); }

  // ── textos do veredito ─────────────────────────────────────────────────
  // tom: 'ok' (cabe) | 'low' (não cabe, mas o saldo não fica negativo) | 'neg' (o saldo ficaria negativo) | 'info'
  function toneOf(r) {
    if (r.state !== 'ok') return 'info';
    if (r.how === 'avista' || r.how === 'parcelado') return 'ok';
    return r.cash.after < 0 ? 'neg' : 'low';
  }
  function shortVerdict(r) {
    if (r.state === 'concluida') return 'Concluída';
    if (r.state === 'sem-valor') return 'Falta o valor para avaliar';
    if (r.state === 'sem-saldo') return 'O saldo acumulado ainda não começou';
    if (r.how === 'avista') return 'Cabe à vista';
    if (r.how === 'parcelado') return 'Cabe parcelado: ' + r.inst.n + 'x de ' + F.money(r.inst.per);
    return 'Não cabe agora' + (r.wait ? '. À vista a partir de ' + F.monthShort(r.wait.month) : '');
  }
  function headline(r) {
    if (r.how === 'avista') return 'Cabe à vista';
    if (r.how === 'parcelado') return 'Não cabe à vista, mas cabe parcelado';
    return 'Não cabe agora';
  }
  // Linhas de detalhe (cada uma com seu tom). ev = resultado de evaluatePurchases.
  function detailLines(r, ev) {
    var settings = App.state.data.settings, minC = ev.minCents, out = [];
    if (r.state === 'concluida') return [{ tone: 'info', text: 'Compra concluída: já foi feita. Ela não entra na disputa de melhor compra.' }];
    if (r.state === 'sem-valor') return [{ tone: 'info', text: 'Digite o valor estimado para ver se a compra cabe no orçamento.' }];
    if (r.state === 'sem-saldo') return [{ tone: 'info', text: 'O saldo acumulado só começa em ' + F.monthShort(settings.balance_start_month) + ', então ainda não dá para avaliar.' }];
    var c = r.cash;
    out.push(c.fits
      ? { tone: 'ok', text: 'À vista cabe: o menor saldo ficaria em ' + F.money(c.after) + ' (' + F.monthShort(c.afterMonth) + ').' }
      : { tone: c.after < 0 ? 'neg' : 'low', text: 'À vista não cabe: faltam ' + F.money(c.missing) + ' para manter o mínimo de ' + F.money(minC) + '.' });
    if (r.inst) {
      var i = r.inst, rot = 'Em ' + i.n + 'x de ' + F.money(i.per);
      out.push(i.fits
        ? { tone: 'ok', text: rot + ' cabe: o menor saldo ficaria em ' + F.money(i.min) + ' (' + F.monthShort(i.minMonth) + ').' }
        : { tone: i.min < 0 ? 'neg' : 'low', text: rot + ' não cabe: o saldo cairia para ' + F.money(i.min) + ' (' + F.monthShort(i.minMonth) + '), abaixo do mínimo de ' + F.money(minC) + '.' });
      if (!i.totalGiven) out.push({ tone: 'info', text: 'Sem "total parcelado": usei o valor da compra (sem juros).' });
    } else if (r.how === 'aguardar') {
      out.push({ tone: 'info', text: 'Para ver se cabe parcelado, informe o número de parcelas em "Mais opções".' });
    }
    if (r.how === 'aguardar') {
      out.push({ tone: 'info', text: r.wait ? 'À vista passa a caber a partir de ' + F.monthShort(r.wait.month) + '.' : 'À vista não passa a caber nos próximos 3 anos.' });
    }
    if (r.late) out.push({ tone: 'info', text: 'O mês previsto (' + F.monthShort(r.execMonth) + ') já passou: avaliei a partir de ' + F.monthShort(r.from) + '.' });
    out.push({ tone: 'info', text: 'Olhei os ' + ev.horizon + ' meses a partir de ' + F.monthShort(r.from) + '.' });
    return out;
  }
  function vd(tone, text) {
    return h('div', { 'class': 'vd ' + tone }, tone === 'info' ? null : d.statusIcon(tone), h('span', { text: text }));
  }

  // ── cartão do veredito (no painel de cada compra) ──────────────────────
  // canSim: mostra os botões "Ver no Simular" (só para compra já salva)
  function verdictBox(r, ev, canSim, onSim) {
    var box = h('div', { 'class': 'vbox', role: 'group', 'aria-label': 'Cabe no orçamento?' });
    if (r.state === 'ok') box.appendChild(h('div', { 'class': 'titulo ' + toneOf(r) }, d.statusIcon(toneOf(r)), h('span', { text: headline(r) })));
    detailLines(r, ev).forEach(function (l) { box.appendChild(vd(l.tone, l.text)); });
    if (canSim && r.state === 'ok') {
      var acoes = h('div', { 'class': 'acoes' }, h('button', { 'class': 'btn p', type: 'button', text: 'Ver à vista no Simular', on: { click: function () { onSim('avista'); } } }));
      if (r.inst) acoes.appendChild(h('button', { 'class': 'btn p', type: 'button', text: 'Ver em ' + r.inst.n + 'x no Simular', on: { click: function () { onSim('parcelado'); } } }));
      box.appendChild(acoes);
    }
    return box;
  }
  // Manda a compra para a aba Simular (cenário só deste aparelho; nada é gravado no orçamento)
  function sendToSim(r, how) {
    var sp = E.purchaseSpec(r, how);
    sp.id = 'compra:' + r.purchase.id + ':' + how;
    sp.purchaseId = r.purchase.id;
    App.sim.add(sp);
    d.closeAllSheets();
    App.go('sim');
  }

  // ── a lista ────────────────────────────────────────────────────────────
  function metaOf(r) {
    var p = r.purchase, parts = [];
    if (p.category) parts.push(cap(p.category));
    parts.push(r.execMonth ? F.monthShort(r.execMonth) + (r.late && p.status !== 'concluido' ? ' (já passou)' : '') : 'sem mês definido');
    if (p.status && p.status !== 'nada') parts.push(STATUS_TXT[p.status]);
    return parts.join(' · ');
  }
  function row(r, ev) {
    var p = r.purchase, tone = toneOf(r), final = p.final_amount != null && E.cents(p.final_amount) > 0;
    var verdict = h('span', { 'class': 'vd ' + tone }, tone === 'info' ? (r.state === 'concluida' ? d.icon('check', 'p') : null) : d.statusIcon(tone), h('span', { text: shortVerdict(r) }));
    var btn = h('button', { 'class': 'linha compra', type: 'button', on: { click: function () { openPurchase(p.id); } } },
      h('span', { 'class': 'dia' }, h('span', { 'class': 'prio p' + p.priority }, h('span', { 'class': 'sr', text: 'Prioridade ' }), String(p.priority))),
      h('span', { 'class': 'nome' }, h('span', { 'class': 'nome-txt', text: p.name }), h('span', { 'class': 'meta', text: metaOf(r) }), verdict),
      h('span', { 'class': 'valor' + (final ? ' real' : '') }, r.valor > 0 ? [h('span', { 'class': 'sr', text: 'R$ ' }), F.money(r.valor, { bare: true }), final ? h('span', { 'class': 'sr', text: ', valor final' }) : null] : '—'));
    return h('li', { 'class': r.state === 'concluida' ? 'concluida' : null }, btn);
  }

  function summary(ev, hasPending) {
    var st = App.state, settings = st.data.settings, box = h('section', { 'class': 'compras-resumo', 'aria-label': 'Resumo das compras' });
    box.appendChild(h('div', { 'class': 'ex-linha' }, h('span', { text: 'Saldo no fim de ' + F.monthShort(ev.today) }),
      h('span', { 'class': 'v' + (ev.saldoToday != null && ev.saldoToday < 0 ? ' neg-txt' : ''), text: ev.saldoToday == null ? '—' : F.money(ev.saldoToday) })));
    box.appendChild(h('div', { 'class': 'ex-linha' }, h('span', { text: 'Saldo mínimo para manter' }), h('span', { 'class': 'v', text: F.money(ev.minCents) })));
    if (ev.saldoToday == null) box.appendChild(h('p', { 'class': 'ajuda', text: 'O saldo acumulado começa em ' + F.monthShort(settings.balance_start_month) + '.' }));
    if (!hasPending) return box;
    var b = ev.best;
    if (b) {
      box.appendChild(h('button', { 'class': 'melhor', type: 'button', on: { click: function () { openPurchase(b.purchase.id); } } },
        h('span', { 'class': 'rot', text: 'Melhor compra agora' }),
        h('span', { 'class': 'nome', text: b.purchase.name }),
        h('span', { 'class': 'meta', text: 'À vista, ' + F.money(b.valor) + ', ' + F.monthShort(b.from) + '. Prioridade ' + b.purchase.priority + '.' })));
    } else if (ev.bestInstallment) {
      var bi = ev.bestInstallment;
      box.appendChild(h('button', { 'class': 'melhor nenhuma', type: 'button', on: { click: function () { openPurchase(bi.purchase.id); } } },
        h('span', { 'class': 'rot', text: 'Nenhuma compra cabe à vista agora' }),
        h('span', { 'class': 'nome', text: bi.purchase.name }),
        h('span', { 'class': 'meta', text: 'Parcelada cabe: ' + bi.inst.n + 'x de ' + F.money(bi.inst.per) + ', a partir de ' + F.monthShort(bi.from) + '. Prioridade ' + bi.purchase.priority + '.' })));
    } else {
      box.appendChild(h('div', { 'class': 'melhor nenhuma' }, h('span', { 'class': 'rot', text: 'Nenhuma compra pendente cabe agora' }),
        h('span', { 'class': 'meta', text: 'Toque numa compra para ver quando passa a caber.' })));
    }
    return box;
  }

  function render(main) {
    var st = App.state, data = st.data;
    if (data.purchasesOk === false) {
      main.appendChild(h('div', { 'class': 'aviso info' }, h('b', { text: 'A aba Compras ainda não está ligada. ' }),
        App.can() ? 'No Supabase, rode o arquivo 01_schema.sql de novo (é seguro: não apaga nada) e toque em atualizar.'
                  : 'Peça a quem administra o app para ligá-la.'));
      return;
    }
    if (!Array.isArray(data.purchases)) {   // cópia antiga deste aparelho, de antes da aba existir
      main.appendChild(h('p', { 'class': 'vazio', text: 'Ainda não carreguei as compras. Ligue a internet e toque em atualizar (as setas lá em cima).' }));
      return;
    }
    var ev = evaluate(data.purchases);
    var pend = ev.items.filter(function (r) { return r.state !== 'concluida'; });
    var feitas = ev.items.length - pend.length;
    main.appendChild(summary(ev, pend.length > 0));

    var chips = h('div', { 'class': 'chips', role: 'group', 'aria-label': 'Filtro' });
    FILTERS.forEach(function (f) {
      var n = f.v === 'pendentes' ? pend.length : f.v === 'concluidas' ? feitas : ev.items.length;
      chips.appendChild(h('button', { 'class': 'chip', type: 'button', 'aria-pressed': f.v === filter ? 'true' : 'false', text: f.t + ' (' + n + ')', on: { click: function () { filter = f.v; App.render(true); } } }));
    });
    main.appendChild(chips);
    main.appendChild(h('p', { 'class': 'ajuda', style: 'padding:0 16px 6px', text: 'Cada compra é conferida sozinha contra o orçamento, olhando os ' + ev.horizon + ' meses a partir do mês previsto. Prioridade 5 é a mais urgente.' }));

    var shown = ev.items.filter(function (r) { return filter === 'todas' || (filter === 'concluidas') === (r.state === 'concluida'); });
    var ul = h('ul', { 'class': 'livro' });
    shown.forEach(function (r) { ul.appendChild(row(r, ev)); });
    if (shown.length) main.appendChild(ul);
    else if (filter === 'concluidas') main.appendChild(h('p', { 'class': 'vazio', text: 'Nenhuma compra concluída.' }));
    else if (!ev.items.length) main.appendChild(h('p', { 'class': 'vazio' }, 'Nenhuma compra na lista. Cadastre o que você quer comprar e o app diz se cabe no orçamento, à vista ou parcelado. ',
      App.can() ? h('b', { text: 'Toque em Nova compra.' }) : null));
    else main.appendChild(h('p', { 'class': 'vazio', text: 'Nada pendente. Toque em "Concluídas" ou "Todas" para ver o resto.' }));

    if (App.can()) App.setFab({ label: 'Nova compra', icon: 'plus', on: function () { openPurchase(null); } });
  }

  // ── painel de uma compra ───────────────────────────────────────────────
  function showError(box, msg) { box.textContent = msg; box.hidden = !msg; if (msg && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' }); }
  function done(rec, msg) { return App.reload(true).then(function () { rec.close(); d.toast(msg); }); }

  function openReadOnly(p) {
    var ev = evaluate([p]), r = ev.items[0];
    var rows = [['Valor estimado', F.money(E.cents(p.est_amount || 0))]];
    if (p.final_amount != null && E.cents(p.final_amount) > 0) rows.push(['Valor final', F.money(E.cents(p.final_amount))]);
    rows.push(['Mês previsto', p.exec_month ? F.monthShort(p.exec_month) : 'sem mês definido']);
    rows.push(['Situação', STATUS_TXT[p.status] || '—']);
    if (p.inst_count) rows.push(['Parcelas', p.inst_count + (p.inst_total != null && E.cents(p.inst_total) > 0 ? ' (total ' + F.money(E.cents(p.inst_total)) + ')' : '')]);
    if (p.category) rows.push(['Tipo', cap(p.category)]);
    if (p.supplier) rows.push(['Fornecedor', p.supplier]);
    if (p.model) rows.push(['Modelo', p.model]);
    var dl = h('dl', { 'class': 'leitura' });
    rows.forEach(function (x) { dl.appendChild(h('dt', { text: x[0] })); dl.appendChild(h('dd', { 'class': 'num', text: x[1] })); });
    var rec = d.openSheet({
      title: p.name, sub: 'Prioridade ' + p.priority, focus: 'none',
      body: h('div', null, h('div', { 'class': 'aviso info' }, d.icon('eye', 'p'), ' Sua conta é somente leitura.'),
        verdictBox(r, ev, true, function (how) { sendToSim(r, how); }), dl),
      footer: [h('button', { 'class': 'btn', type: 'button', text: 'Fechar', on: { click: function () { rec.close(); } } })]
    });
  }

  function openPurchase(id) {
    var cur = id ? findPurchase(id) : null;
    if (id && !cur) return;
    if (!App.can()) { if (cur) openReadOnly(cur); return; }
    var p0 = cur || { name: '', priority: 3, status: 'nada', est_amount: 0, final_amount: null, exec_month: F.currentMonth() + '-01', inst_total: null, inst_count: null, category: null, supplier: null, model: null };

    var name = h('input', { 'class': 'entrada', type: 'text', maxlength: 80, autocomplete: 'off', placeholder: 'Ex.: Fogão, Guarda-roupa', value: p0.name || '' });
    var prio = d.segmented([1, 2, 3, 4, 5].map(function (n) { return { v: String(n), t: String(n) }; }), String(p0.priority), function () { refresh(); }, 'Prioridade');
    var status = d.segmented(STATUS, p0.status, function () { refresh(); }, 'Situação');
    var est = d.moneyInput(E.cents(p0.est_amount || 0), { 'aria-label': 'Valor estimado' });
    var fin = d.moneyInput(p0.final_amount != null ? E.cents(p0.final_amount) : 0, { 'aria-label': 'Valor final' });
    var tot = d.moneyInput(p0.inst_total != null ? E.cents(p0.inst_total) : 0, { 'aria-label': 'Total parcelado' });
    var nParc = h('input', { 'class': 'entrada', type: 'number', inputmode: 'numeric', min: 2, max: 120, placeholder: 'Sem parcelas', 'aria-label': 'Número de parcelas', value: p0.inst_count ? String(p0.inst_count) : '' });
    var cat = h('input', { 'class': 'entrada', type: 'text', maxlength: 40, autocomplete: 'off', placeholder: 'Ex.: Eletro, Móvel, Reforma', value: p0.category || '' });
    var sup = h('input', { 'class': 'entrada', type: 'text', maxlength: 80, autocomplete: 'off', placeholder: 'Loja, site ou pessoa', value: p0.supplier || '' });
    var mod = h('input', { 'class': 'entrada', type: 'text', maxlength: 80, autocomplete: 'off', placeholder: 'Modelo (opcional)', value: p0.model || '' });
    var execM = App.sheets.monthField('Mês previsto', monthOf(p0.exec_month), {
      allowEmpty: true, placeholder: 'Sem mês definido', emptyLabel: 'Sem mês', fallback: F.currentMonth(), onChange: function () { refresh(); },
      help: 'Em que mês você pretende comprar. Se o mês já passou, o app avalia a partir de hoje.'
    });
    var err = h('p', { 'class': 'erro-txt', role: 'alert', hidden: true });
    var vhost = h('div');

    // Lê o formulário. Devolve { row } com os campos em reais/texto (prontos para o banco) ou { error }.
    function read() {
      var nm = name.value.trim();
      if (!nm) return { error: 'Dê um nome à compra.' };
      var e = F.parseMoney(est.value.trim() === '' ? '0' : est.value);
      if (isNaN(e)) return { error: 'Digite o valor estimado assim: 1.234,56' };
      var f = fin.value.trim() === '' ? 0 : F.parseMoney(fin.value);
      if (isNaN(f)) return { error: 'Digite o valor final assim: 1.234,56' };
      var t = tot.value.trim() === '' ? 0 : F.parseMoney(tot.value);
      if (isNaN(t)) return { error: 'Digite o total parcelado assim: 1.234,56' };
      if (e < 0 || f < 0 || t < 0) return { error: 'Os valores não podem ser negativos.' };
      var nTxt = String(nParc.value).trim(), n = null;
      if (nTxt !== '') {
        n = /^\d{1,3}$/.test(nTxt) ? parseInt(nTxt, 10) : NaN;
        if (!(n >= 2 && n <= 120)) return { error: 'O número de parcelas vai de 2 a 120. Para pagar de uma vez, deixe vazio.' };
      }
      if (t > 0 && n == null) return { error: 'Você digitou o total parcelado: digite também o número de parcelas.' };
      return { row: {
        name: nm, priority: parseInt(prio.get(), 10), status: status.get(),
        category: cat.value.trim() || null, supplier: sup.value.trim() || null, model: mod.value.trim() || null,
        est_amount: e / 100, final_amount: f > 0 ? f / 100 : null,
        exec_month: execM.get() ? E.toDbDate(execM.get()) : null,
        inst_total: n != null && t > 0 ? t / 100 : null, inst_count: n
      } };
    }

    // O veredito acompanha o que você digita (sem gravar nada)
    function refresh() {
      var x = read(), tmp;
      if (x.row) tmp = x.row;
      else {   // formulário incompleto: avalia com o que dá (valor 0 = "digite o valor")
        tmp = { name: name.value.trim() || '—', priority: parseInt(prio.get(), 10), status: status.get(), est_amount: 0, final_amount: null, exec_month: execM.get() ? E.toDbDate(execM.get()) : null, inst_total: null, inst_count: null };
        var e2 = F.parseMoney(est.value.trim() === '' ? '0' : est.value), f2 = fin.value.trim() === '' ? 0 : F.parseMoney(fin.value);
        if (!isNaN(e2) && e2 > 0) tmp.est_amount = e2 / 100;
        if (!isNaN(f2) && f2 > 0) tmp.final_amount = f2 / 100;
      }
      if (cur) tmp.id = cur.id;
      var ev = evaluate([tmp]), r = ev.items[0];
      d.clear(vhost);
      vhost.appendChild(verdictBox(r, ev, !!cur && tmp.status !== 'concluido', function (how) { sendToSim(r, how); }));
    }
    [name, est, fin, tot, nParc, cat, sup, mod].forEach(function (el) { el.addEventListener('input', refresh); });

    var saving = false;
    var save = h('button', { 'class': 'btn primario', type: 'button', text: cur ? 'Salvar' : 'Adicionar', on: { click: onSave } });
    var cancel = h('button', { 'class': 'btn', type: 'button', text: 'Cancelar', on: { click: function () { rec.close(); } } });

    function sameAsSaved(row) {
      if (!cur) return false;
      return row.name === cur.name && row.priority === Number(cur.priority) && row.status === cur.status &&
        (row.category || null) === (cur.category || null) && (row.supplier || null) === (cur.supplier || null) && (row.model || null) === (cur.model || null) &&
        E.cents(row.est_amount) === E.cents(cur.est_amount || 0) &&
        (row.final_amount == null ? null : E.cents(row.final_amount)) === (cur.final_amount == null ? null : E.cents(cur.final_amount)) &&
        (row.exec_month || null) === (cur.exec_month ? String(cur.exec_month).slice(0, 10) : null) &&
        (row.inst_total == null ? null : E.cents(row.inst_total)) === (cur.inst_total == null ? null : E.cents(cur.inst_total)) &&
        (row.inst_count || null) === (cur.inst_count ? Number(cur.inst_count) : null);
    }
    function onSave() {
      if (saving) return;
      showError(err, '');
      var x = read();
      if (x.error) return showError(err, x.error);
      if (!(x.row.est_amount > 0) && !(x.row.final_amount > 0)) return showError(err, 'Digite o valor estimado da compra.');
      if (sameAsSaved(x.row)) { rec.close(); return; }
      saving = true; save.disabled = true;
      (cur ? D.updatePurchase(cur.id, x.row) : D.createPurchase(x.row)).then(function (r) {
        if (!r.ok) { saving = false; save.disabled = false; return showError(err, r.error); }
        done(rec, cur ? 'Salvo' : 'Compra adicionada');
      });
    }
    function onDelete() {
      d.confirmBox({ title: 'Apagar "' + cur.name + '"?', text: 'A compra sai da lista. O que já foi lançado no orçamento não muda. Não dá para desfazer.', ok: 'Apagar', danger: true }).then(function (yes) {
        if (!yes) return;
        D.deletePurchase(cur.id).then(function (r) {
          if (!r.ok) return showError(err, r.error);
          done(rec, 'Compra apagada');
        });
      });
    }

    var temOpcional = !!(p0.final_amount != null && E.cents(p0.final_amount) > 0) || !!p0.inst_count || !!p0.category || !!p0.supplier || !!p0.model;
    var opcoes = h('details', { style: 'margin:4px 0 12px', open: temOpcional },
      h('summary', { text: 'Mais opções', style: 'min-height:44px;display:flex;align-items:center;font-weight:600;color:var(--azul);cursor:pointer' }),
      h('div', { style: 'padding-top:10px' },
        d.field('Valor final (quando fechar a compra)', fin, 'Se preencher, vale no lugar do estimado.'),
        h('div', { 'class': 'duas' }, d.field('Total parcelado', tot, 'Com juros, se tiver. Vazio = o valor da compra.'), d.field('Nº de parcelas', nParc, 'De 2 a 120.')),
        d.field('Tipo', cat), d.field('Fornecedor', sup), d.field('Modelo', mod),
        cur ? h('button', { 'class': 'btn perigo cheio', type: 'button', text: 'Apagar compra', on: { click: onDelete } }) : null));

    var body = h('div', null,
      vhost,
      d.field('Nome', name),
      h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'Prioridade' }), prio.el, h('div', { 'class': 'ajuda', text: '1 = menos urgente, 5 = mais urgente.' })),
      d.field('Valor estimado', est),
      execM.el,
      h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'Situação' }), status.el),
      err, opcoes);
    var rec = d.openSheet({ title: cur ? cur.name : 'Nova compra', sub: cur ? 'Prioridade ' + cur.priority : null, body: body, footer: [cancel, save], focus: 'none' });
    refresh();
    if (!cur) setTimeout(function () { try { name.focus(); } catch (e) {} }, 60);
  }

  App.views.compras = { render: render };
})(window.App = window.App || {});
