/* ════════════════════════════════════════════════════════════════════════
   items-view.js — a aba "Itens": todas as contas, cartões, parcelas e
   rendas cadastradas, com o valor do mês que você está olhando.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, E = window.Engine, h = d.h;
  var filter = 'todos';
  var FILTERS = [
    { v: 'todos', t: 'Todos' }, { v: 'saidas', t: 'Saídas' }, { v: 'entradas', t: 'Entradas' },
    { v: 'cartoes', t: 'Cartões' }, { v: 'parcelados', t: 'Parcelados' }, { v: 'parados', t: 'Parados' }
  ];

  function matches(it) {
    var ativo = it.active !== false;
    switch (filter) {
      case 'saidas': return ativo && it.kind === 'saida';
      case 'entradas': return ativo && it.kind === 'entrada';
      case 'cartoes': return ativo && it.type === 'cartao';
      case 'parcelados': return ativo && it.type === 'parcela';
      case 'parados': return !ativo;
      default: return ativo;
    }
  }
  function metaOf(it) {
    var parts = [];
    parts.push(App.sheets.typeText(it));
    if (it.recurring) parts.push('repete desde ' + F.monthShort(it.start_month)); else parts.push('lançado mês a mês');
    if (it.end_month) parts.push('termina em ' + F.monthShort(it.end_month));
    if (it.card_name) parts.push('no ' + it.card_name);
    return parts.join(', ');
  }

  function render(main) {
    var st = App.state, idx = App.index(), month = st.month;
    var items = st.data.items.filter(matches).sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'saida' ? -1 : 1;
      var da = a.due_day == null ? 99 : a.due_day, db = b.due_day == null ? 99 : b.due_day;
      return da !== db ? da - db : String(a.name).localeCompare(String(b.name), 'pt-BR');
    });

    var chips = h('div', { 'class': 'chips', role: 'group', 'aria-label': 'Filtro' });
    FILTERS.forEach(function (f) {
      chips.appendChild(h('button', { 'class': 'chip', type: 'button', 'aria-pressed': f.v === filter ? 'true' : 'false', text: f.t, on: { click: function () { filter = f.v; App.render(true); } } }));
    });
    main.appendChild(chips);
    main.appendChild(h('p', { 'class': 'ajuda', style: 'padding:0 16px 6px', text: 'Valores de ' + F.monthLong(month) + '. Para olhar outro mês, mude na aba Mês.' }));

    var ul = h('ul', { 'class': 'livro' });
    items.forEach(function (it) {
      var cur = E.amountAt(idx, it, E.mi(month));
      ul.appendChild(h('li', null, h('button', {
        'class': 'linha' + (it.active === false ? ' apagada' : ''), type: 'button',
        on: { click: function () { App.sheets.openLaunch(it.id, month); } }
      },
        h('span', { 'class': 'dia' }, it.due_day ? [h('span', { 'class': 'sr', text: 'vence dia ' }), String(it.due_day)] : null),
        h('span', { 'class': 'nome' }, it.name, h('span', { 'class': 'meta', text: metaOf(it) })),
        h('span', { 'class': 'valor' + (cur.source === 'real' ? ' real' : '') }, cur.cents ? [h('span', { 'class': 'sr', text: 'R$ ' }), F.money(cur.cents, { bare: true })] : '—'))));
    });
    main.appendChild(items.length ? ul : h('p', { 'class': 'vazio' }, filter === 'parados' ? 'Nenhum item parado.' : 'Nada por aqui ainda. ', App.can() && filter !== 'parados' ? h('b', { text: 'Toque em Novo item.' }) : null));

    if (App.can()) {
      var kind = filter === 'cartoes' ? 'cartao' : filter === 'entradas' ? 'renda' : filter === 'parcelados' ? 'parcelado' : 'conta';
      App.setFab({ label: 'Novo item', icon: 'plus', on: function () { App.sheets.openNew(kind, month); } });
    }
  }

  App.views.itens = { render: render };
})(window.App = window.App || {});
