/* ════════════════════════════════════════════════════════════════════════
   month-view.js — a aba "Mês": resumo, saídas por vencimento, entradas e,
   em cada linha, a chavinha de "pago / recebido".
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, E = window.Engine, h = d.h;
  var HIDE_KEY = 'orc.esconder.baixas';   // preferência só deste aparelho (não vai para o banco)
  var pending = {};                        // marcas com pedido em andamento: um toque por vez em cada linha

  function hideOn() { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { return false; } }
  function setHide(on) { try { if (on) localStorage.setItem(HIDE_KEY, '1'); else localStorage.removeItem(HIDE_KEY); } catch (e) {} }

  function metaFor(line) {
    var parts = [];
    if (line.item.type === 'cartao') parts.push('Cartão');
    if (line.inst && line.inst.n > 1) parts.push('Parcela ' + line.inst.k + ' de ' + line.inst.n);
    if (line.item.card_name) parts.push('no ' + line.item.card_name);
    return parts.join(', ');
  }

  // cópia dos dados com a marca de (item, mês) ligada ou desligada (month = "AAAA-MM")
  function hasMark(data, itemId, month) {
    return (data.settled || []).some(function (s) { return s.item_id === itemId && String(s.month).slice(0, 7) === month; });
  }
  function withMark(data, itemId, month, on) {
    var rest = (data.settled || []).filter(function (s) { return !(s.item_id === itemId && String(s.month).slice(0, 7) === month); });
    return Object.assign({}, data, { settled: on ? rest.concat([{ item_id: itemId, month: E.toDbDate(month) }]) : rest });
  }

  // Redesenha a tela logo depois do toque: dá tempo de a chavinha deslizar antes de a lista mudar.
  var timer = null;
  function soon() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      if (App.state.tab === 'mes' && App.state.data) App.render(true);
    }, 160);
  }

  // Marca ou desmarca "pago/recebido". A tela muda na hora; se a internet falhar, volta ao que era e avisa.
  // Devolve false se já tem um pedido dessa linha em andamento (o toque é ignorado).
  function toggle(item, month, on) {
    var st = App.state, key = item.id + '|' + month;
    if (pending[key] || !st.data) return false;
    pending[key] = true;
    st.data = withMark(st.data, item.id, month, on);
    st.refocus = key; soon();
    App.data.setSettled(item.id, E.toDbDate(month), on).then(function (r) {
      delete pending[key];
      if (!st.user || !st.data) return;                                  // a pessoa saiu da conta enquanto isso
      if (!r.ok) {                                                       // desfaz só esta linha (outras podem estar em andamento)
        st.data = withMark(st.data, item.id, month, !on); st.refocus = key; soon();
        d.toast(r.error, 'erro');
      } else if (hasMark(st.data, item.id, month) !== on) {              // uma atualização antiga chegou no meio do caminho
        st.data = withMark(st.data, item.id, month, on); soon();
      }
      App.data.patchCache(st.user.id, st.data);
    });
    return true;
  }

  // ctx = { can: mostra a chavinha, cells: só mostra o "visto" (leitor), hide: esconde o que já foi marcado }
  function row(line, month, ctx) {
    var it = line.item, meta = metaFor(line), real = line.source === 'real';
    var verbo = it.kind === 'entrada' ? 'recebido' : 'pago';
    // Sem aria-label: o nome acessível vem do texto que se vê (mais "vence dia" e "R$"
    // escondidos), então quem usa comando de voz pode dizer o que está lendo na tela.
    var btn = h('button', { 'class': 'linha', type: 'button', on: { click: function () { App.sheets.openLaunch(it.id, month); } } },
      h('span', { 'class': 'dia' }, it.due_day ? [h('span', { 'class': 'sr', text: 'vence dia ' }), String(it.due_day)] : null),
      h('span', { 'class': 'nome' }, h('span', { 'class': 'nome-txt', text: it.name }), meta ? h('span', { 'class': 'meta', text: meta }) : null),
      h('span', { 'class': 'valor' + (real ? ' real' : '') }, h('span', { 'class': 'sr', text: 'R$ ' }), F.money(line.cents, { bare: true }),
        real ? h('span', { 'class': 'sr', text: ', valor lançado' }) : null,
        line.settled ? h('span', { 'class': 'sr', text: ', ' + verbo }) : null));
    var cell = null;
    if (ctx.can) {
      var sw = d.chave({
        label: (it.kind === 'entrada' ? 'Recebido: ' : 'Pago: ') + it.name, checked: line.settled, data: it.id + '|' + month,
        onChange: function (on) { if (!toggle(it, month, on)) sw.set(!on); }
      });
      cell = h('div', { 'class': 'baixa-cel' }, sw.el);
    } else if (ctx.cells) {
      cell = h('div', { 'class': 'baixa-cel' }, line.settled ? h('span', { 'class': 'baixa-ok' }, d.icon('check', 'p')) : null);
    }
    return h('li', { 'class': line.settled ? 'paga' : null }, btn, cell);
  }

  function section(title, kind, lines, total, month, emptyText, ctx, baixa) {
    var shown = ctx.hide ? lines.filter(function (l) { return !l.settled; }) : lines;
    var ul = h('ul', { 'class': 'livro' + (ctx.can || ctx.cells ? ' com-baixa' : '') });
    shown.forEach(function (l) { ul.appendChild(row(l, month, ctx)); });
    var vazio = lines.length && !shown.length ? (kind === 'entrada' ? 'Tudo recebido neste mês.' : 'Tudo pago neste mês.') : emptyText;
    var cab = null;
    if (lines.length && (ctx.can || ctx.cells)) {
      cab = h('div', { 'class': 'baixa-cab' },
        h('span', { text: baixa.feitas ? baixa.feitas + ' de ' + baixa.n + (kind === 'entrada' ? ' recebidas' : ' pagas') : '' }),
        ctx.can ? h('span', { 'class': 'rot', 'aria-hidden': 'true', text: kind === 'entrada' ? 'recebido' : 'pago' }) : null);
    }
    return h('section', { 'aria-label': title },
      h('div', { 'class': 'secao' }, h('h2', { text: title }), h('span', { 'class': 'total', text: F.money(total) })),
      cab,
      shown.length ? ul : h('p', { 'class': 'vazio', text: vazio }));
  }

  // ── conta corrente: a sobra do mês anterior ─────────────────────────────
  // Aparece em duas partes: uma linha no resumo ("Veio de outubro") e a linha do próprio item, que se toca
  // para corrigir com o saldo real do banco. Fica FORA de "Entradas" e do "Resultado do mês": o saldo
  // acumulado já carrega essa sobra, e somar de novo a contaria duas vezes.
  function carrySummary(c) {
    return h('div', { 'class': 'ex-linha ex-veio' },
      h('span', { text: 'Veio de ' + F.monthName(c.prev) + (c.real ? ' (corrigido)' : '') }),
      h('span', { 'class': 'v' + (c.cents < 0 ? ' neg-txt' : ''), text: F.money(c.cents) }));
  }
  function carrySection(c, month) {
    var it = c.item;
    var meta = c.real ? 'Saldo real que você lançou. O previsto era ' + F.money(c.auto) : 'Sobra de ' + F.monthName(c.prev) + ', automática';
    var btn = h('button', { 'class': 'linha', type: 'button', on: { click: function () { App.sheets.openLaunch(it.id, month); } } },
      h('span', { 'class': 'dia' }),
      h('span', { 'class': 'nome' }, h('span', { 'class': 'nome-txt', text: it.name }), h('span', { 'class': 'meta', text: meta })),
      h('span', { 'class': 'valor' + (c.real ? ' real' : '') + (c.cents < 0 ? ' neg-txt' : '') }, h('span', { 'class': 'sr', text: 'R$ ' }), F.money(c.cents, { bare: true }),
        c.real ? h('span', { 'class': 'sr', text: ', valor lançado' }) : null));
    return h('section', { 'aria-label': 'Conta corrente' },
      h('div', { 'class': 'secao' }, h('h2', { text: 'Conta corrente' }), h('span', { 'class': 'total', text: F.money(c.cents) })),
      h('ul', { 'class': 'livro' }, h('li', null, btn)));
  }

  // Sob "Entradas"/"Saídas" do resumo: o que ainda falta (só aparece depois da primeira marca)
  function faltaLine(b, kind) {
    if (!b.feitas) return null;
    if (b.feitas === b.n) return h('div', { 'class': 'ex-falta feito' }, d.icon('check', 'p'), h('span', { text: kind === 'entrada' ? 'tudo recebido' : 'tudo pago' }));
    return h('div', { 'class': 'ex-falta' }, h('span', { text: kind === 'entrada' ? 'falta receber' : 'falta pagar' }), h('span', { 'class': 'v', text: F.money(b.falta) }));
  }

  function render(main) {
    var st = App.state, idx = App.index(), settings = st.data.settings, month = st.month;
    var v = E.monthView(idx, month), minC = E.minCents(settings);
    var tl = E.timeline(idx, settings, month, 1)[0], saldo = tl.saldo, stt = E.statusOf(saldo, minC);
    var cur = F.currentMonth();
    var ready = st.data.settledOk !== false;                       // o banco já tem a tabela de marcas?
    var marcadas = v.baixa.entradas.feitas + v.baixa.saidas.feitas;
    var ctx = { can: App.can() && ready, cells: !(App.can() && ready) && marcadas > 0 };
    ctx.hide = marcadas > 0 && hideOn();

    // navegação de mês
    main.appendChild(h('div', { 'class': 'mes-nav' },
      h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Mês anterior', on: { click: function () { App.go('mes', { month: E.addMonths(month, -1) }); } } }, d.icon('left')),
      h('button', {
        'class': 'mes-titulo', type: 'button', 'aria-label': F.monthName(month) + ' ' + month.slice(0, 4) + ', escolher outro mês',
        on: { click: function () { d.pickMonth({ value: month, title: 'Ir para o mês' }).then(function (m) { if (m) App.go('mes', { month: m }); }); } }
      }, F.monthName(month) + ' ', h('span', { 'class': 'ano', text: month.slice(0, 4) })),
      h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Próximo mês', on: { click: function () { App.go('mes', { month: E.addMonths(month, 1) }); } } }, d.icon('right'))));
    main.appendChild(h('div', { 'class': 'mes-sub' }, month === cur ? 'Mês atual'
      : h('button', { type: 'button', text: 'Voltar para ' + F.monthShort(cur), on: { click: function () { App.go('mes', { month: cur }); } } })));

    // banco sem a tabela de marcas (esquema antigo): o app funciona, só sem a chavinha
    if (App.can() && !ready) {
      main.appendChild(h('div', { 'class': 'aviso info' }, h('b', { text: 'Pago/Recebido ainda não está ligado. ' }),
        'No Supabase, rode o arquivo 01_schema.sql de novo (é seguro: não apaga nada) e toque em atualizar.'));
    }

    // resumo (estilo extrato)
    var saldoCls = stt === 'neg' ? ' neg-txt' : stt === 'low' ? ' low-txt' : '';
    var chip;
    if (stt === null) chip = h('span', { 'class': 'estado nulo' }, d.icon('calendar', 'p'), 'O saldo acumulado começa em ' + F.monthShort(settings.balance_start_month));
    else if (stt === 'ok') chip = h('span', { 'class': 'estado ok' }, d.statusIcon('ok'), 'Acima do mínimo de ' + F.money(minC));
    else if (stt === 'low') chip = h('span', { 'class': 'estado low' }, d.statusIcon('low'), 'Abaixo do mínimo de ' + F.money(minC));
    else chip = h('span', { 'class': 'estado neg' }, d.statusIcon('neg'), 'Saldo negativo');
    main.appendChild(h('section', { 'class': 'extrato', 'aria-label': 'Resumo de ' + F.monthLong(month) },
      v.carry ? carrySummary(v.carry) : null,
      h('div', { 'class': 'ex-linha' }, h('span', { text: 'Entradas' }), h('span', { 'class': 'v', text: F.money(v.totalEntradas) })),
      faltaLine(v.baixa.entradas, 'entrada'),
      h('div', { 'class': 'ex-linha' }, h('span', { text: 'Saídas' }), h('span', { 'class': 'v', text: F.money(v.totalSaidas) })),
      faltaLine(v.baixa.saidas, 'saida'),
      h('div', { 'class': 'ex-linha ex-res' }, h('span', { text: 'Resultado do mês' }), h('span', { 'class': 'v' + (v.resultado < 0 ? ' neg-txt' : ''), text: F.money(v.resultado, { sign: true }) })),
      h('div', { 'class': 'ex-saldo' },
        h('span', { 'class': 'rot', text: 'Saldo acumulado no fim do mês' }),
        h('span', { 'class': 'v' + saldoCls, text: saldo == null ? '—' : F.money(saldo) })),
      chip));
    main.appendChild(h('p', { 'class': 'chave-cores' }, h('b', { 'class': 'az', text: 'Azul em negrito' }), ': valor que você lançou. Normal: valor que repete todo mês.'));

    // esconder o que já foi pago/recebido (como apagar a célula na planilha; só neste aparelho)
    if (marcadas > 0) {
      var escondidas = ctx.hide ? marcadas : 0;
      var hsw = d.chave({
        label: 'Esconder pagos e recebidos', checked: ctx.hide, data: 'esconder',
        onChange: function (on) { setHide(on); st.refocus = 'esconder'; soon(); }
      });
      main.appendChild(h('div', { 'class': 'filtro-baixa' },
        h('span', { on: { click: function () { hsw.el.click(); } } }, 'Esconder pagos e recebidos', escondidas ? h('span', { 'class': 'qtd', text: ' (' + escondidas + ')' }) : null),
        hsw.el));
    }

    // listas
    if (v.carry) main.appendChild(carrySection(v.carry, month));
    main.appendChild(section('Saídas', 'saida', v.saidas, v.totalSaidas, month, 'Nenhuma saída neste mês.', ctx, v.baixa.saidas));
    main.appendChild(section('Entradas', 'entrada', v.entradas, v.totalEntradas, month, 'Nenhuma entrada neste mês.', ctx, v.baixa.entradas));

    // itens sem valor neste mês (só quem pode editar)
    if (App.can()) {
      var cand = v.vazias.saidas.concat(v.vazias.entradas);
      if (cand.length) {
        var chips = h('div', { 'class': 'chips' });
        cand.forEach(function (l) {
          chips.appendChild(h('button', {
            'class': 'chip', type: 'button', 'aria-label': 'Lançar valor de ' + l.item.name,
            on: { click: function () { App.sheets.openLaunch(l.item.id, month); } }
          }, d.icon('plus', 'p'), l.item.name));
        });
        main.appendChild(h('section', { 'aria-label': 'Itens sem valor neste mês' },
          h('div', { 'class': 'secao' }, h('h2', { text: 'Sem valor neste mês' })),
          h('p', { 'class': 'sub-titulo', style: 'padding-bottom:0;font-weight:400', text: 'Toque para lançar o valor.' }),
          chips));
      }
      App.setFab({ label: 'Novo item', icon: 'plus', on: function () { App.sheets.openNew('conta', month); } });
    }

    // depois de marcar, o foco volta para a mesma chavinha (a tela é redesenhada a cada marca)
    if (st.refocus) {
      var want = st.refocus; st.refocus = null;
      var els = main.querySelectorAll('[data-baixa]');
      for (var i = 0; i < els.length; i++) {
        if (els[i].getAttribute('data-baixa') === want) { try { els[i].focus({ preventScroll: true }); } catch (e) {} break; }
      }
    }
  }

  App.views.mes = { render: render };
})(window.App = window.App || {});
