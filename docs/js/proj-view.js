/* ════════════════════════════════════════════════════════════════════════
   proj-view.js — a aba "Projeção": saldo mês a mês, para onde você quiser
   (6 meses, 12, 2 anos, 5 anos), com gráfico e tabela.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, E = window.Engine, h = d.h;
  var chartApi = null;

  var RANGES = [{ v: 6, t: '6 meses' }, { v: 12, t: '12 meses' }, { v: 24, t: '2 anos' }, { v: 60, t: '5 anos' }];
  var STATUS_CLS = { ok: 'ic-ok', low: 'ic-low', neg: 'ic-neg' };

  function render(main) {
    if (chartApi) { chartApi.destroy(); chartApi = null; }
    var st = App.state, idx = App.index(), settings = st.data.settings, minC = E.minCents(settings);
    var start = st.projStart || F.currentMonth(), count = st.projCount;
    var tl = E.timeline(idx, settings, start, count);
    var sum = E.summarize(tl, minC);

    // filtros (uma linha só, em cima de tudo que eles controlam)
    var seg = d.segmented(RANGES, count, function (v) { st.projCount = v; App.render(true); }, 'Período');
    main.appendChild(h('div', { 'class': 'filtros' }, seg.el,
      h('button', {
        'class': 'btn p', type: 'button',
        on: { click: function () { d.pickMonth({ value: start, title: 'Começar em' }).then(function (m) { if (m) { st.projStart = m; App.render(true); } }); } }
      }, d.icon('calendar', 'p'), 'Começa em ' + F.monthShort(start))));

    // resumo em uma frase
    var resumo;
    if (sum.min === null) resumo = h('p', { 'class': 'resumo-proj' }, 'O saldo acumulado começa em ' + F.monthShort(settings.balance_start_month) + '. Escolha um período a partir dele.');
    else {
      resumo = h('p', { 'class': 'resumo-proj' }, 'Menor saldo: ', h('b', { text: F.money(sum.min) }), ' em ' + F.monthShort(sum.minMonth) + '. ',
        sum.firstNeg ? h('b', { 'class': 'neg-txt', text: 'Fica negativo a partir de ' + F.monthShort(sum.firstNeg) + '.' })
          : sum.firstLow ? h('b', { 'class': 'low-txt', text: 'Fica abaixo do mínimo a partir de ' + F.monthShort(sum.firstLow) + '.' })
            : 'Sempre acima do mínimo de ' + F.money(minC) + (st.data.items.some(function (i) { return i.active !== false && !i.recurring && i.kind === 'saida'; }) ? ', contando só o que está lançado.' : '.'));
    }
    main.appendChild(resumo);

    // itens que não repetem ficam zerados nos meses sem lançamento: a linha pode estar otimista
    var fora = st.data.items.filter(function (i) { return i.active !== false && !i.recurring; });
    if (fora.length) {
      var lastEntry = {};
      st.data.entries.forEach(function (e) { var m = e.month.slice(0, 7); if (!lastEntry[e.item_id] || m > lastEntry[e.item_id]) lastEntry[e.item_id] = m; });
      var fs = fora.filter(function (i) { return i.kind === 'saida'; }), fe = fora.filter(function (i) { return i.kind === 'entrada'; });
      var aviso = h('div', { 'class': 'aviso' }, h('b', { text: 'Só conta o que está lançado. ' }));
      if (fs.length) {
        aviso.appendChild(document.createTextNode('Estas saídas não repetem: nos meses sem valor ficam zeradas, e a linha pode estar otimista.'));
        var cs = h('div', { 'class': 'chips', style: 'padding:10px 0 0' });
        fs.forEach(function (i) {
          // abre no mês seguinte ao último valor lançado, para "Deste mês em diante" não apagar nada
          var m = lastEntry[i.id] ? E.addMonths(lastEntry[i.id], 1) : F.currentMonth();
          if (App.can()) cs.appendChild(h('button', { 'class': 'chip', type: 'button', text: i.name, on: { click: function () { App.sheets.openLaunch(i.id, m); } } }));
          else cs.appendChild(h('span', { 'class': 'chip', text: i.name }));
        });
        aviso.appendChild(cs);
        if (App.can()) aviso.appendChild(h('div', { style: 'margin-top:8px', text: 'Para repetir um valor, toque no item e escolha "Deste mês em diante".' }));
      }
      if (fe.length) aviso.appendChild(h('div', { style: 'margin-top:8px', text: 'Entradas avulsas (' + fe.map(function (i) { return i.name; }).join(', ') + ') também só contam onde foram lançadas.' }));
      main.appendChild(aviso);
    }

    // gráfico
    var host = h('div', { 'class': 'grafico' });
    main.appendChild(host);
    var rows = [];
    var series = [{ key: 'saldo', label: 'Saldo acumulado', color: 'var(--serie)', area: true, emphasis: true, pts: tl }];
    var hasValues = tl.some(function (p) { return p.saldo != null; });
    if (hasValues && count >= 2) {
      chartApi = App.chart.line(host, {
        series: series, minCents: minC, ariaLabel: 'Saldo acumulado de ' + F.monthShort(tl[0].month) + ' a ' + F.monthShort(tl[tl.length - 1].month),
        extras: function (i) {
          var p = tl[i], stt = E.statusOf(p.saldo, minC);
          return [['Entradas', F.money(p.entradas)], ['Saídas', F.money(p.saidas)], ['Resultado', F.money(p.resultado, { sign: true })], ['Situação', stt ? d.STATUS_TXT[stt] : 'Antes do saldo inicial']];
        },
        onPick: function (i) { rows.forEach(function (r, k) { r.classList.toggle('sel', k === i); }); }
      });
    }
    main.appendChild(h('div', { 'class': 'legenda', 'aria-hidden': 'true' },
      h('span', null, h('i', { 'class': 'k', style: 'border-top-color:var(--serie)' }), 'Saldo acumulado'),
      h('span', null, h('i', { 'class': 'k min' }), 'Saldo mínimo')));

    // tabela (o mesmo dado do gráfico, sem precisar tocar nele)
    var tbody = h('tbody');
    tl.forEach(function (p) {
      var stt = E.statusOf(p.saldo, minC);
      var tr = h('tr', { 'class': 'btn-linha', tabindex: '0', 'aria-label': F.monthLong(p.month) + ': resultado ' + F.money(p.resultado, { sign: true }) + ', saldo ' + (p.saldo == null ? 'não calculado' : F.money(p.saldo)) + (stt ? ', ' + d.STATUS_TXT[stt] : ''), on: {
        click: function () { App.go('mes', { month: p.month }); },
        keydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); App.go('mes', { month: p.month }); } }
      } },
        h('td', null, h('div', { 'class': 'cel', text: F.monthShort(p.month) })),
        h('td', null, h('div', { 'class': 'cel' + (p.resultado < 0 ? ' neg-txt' : ''), text: F.money(p.resultado, { sign: true, bare: true }) })),
        h('td', null, h('div', { 'class': 'cel' + (stt === 'neg' ? ' neg-txt' : '') },
          stt ? h('span', { 'class': STATUS_CLS[stt], style: 'display:inline-flex' }, d.statusIcon(stt)) : null,
          h('span', { text: p.saldo == null ? '—' : F.money(p.saldo, { bare: true }) }),
          stt ? h('span', { 'class': 'sr', text: d.STATUS_TXT[stt] }) : null)));
      rows.push(tr); tbody.appendChild(tr);
    });
    main.appendChild(h('table', { 'class': 'tabela' },
      h('caption', { text: 'Mês a mês' }),
      h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Mês' }), h('th', { scope: 'col', text: 'Resultado' }), h('th', { scope: 'col', text: 'Saldo (R$)' }))),
      tbody));
    main.appendChild(h('p', { 'class': 'ajuda', style: 'padding:10px 16px 0', text: 'Toque em um mês para abrir os lançamentos dele.' }));
  }

  App.views.proj = { render: render };
})(window.App = window.App || {});
