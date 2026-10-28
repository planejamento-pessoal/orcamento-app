/* ════════════════════════════════════════════════════════════════════════
   engine.js — motor de cálculo do orçamento.
   Sem dependências; roda no navegador/WebView e no Node (tests/).
   Tudo em CENTAVOS inteiros (nada de float em soma de dinheiro).
   Meses são texto "AAAA-MM" (no banco: date no dia 1, "AAAA-MM-01").
   ════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── meses ──────────────────────────────────────────────────────────────
  function mi(m) {                       // "2026-10" ou "2026-10-01" -> inteiro
    if (typeof m !== 'string' || !/^\d{4}-\d{2}/.test(m)) throw new Error('mês inválido: ' + m);
    return parseInt(m.slice(0, 4), 10) * 12 + parseInt(m.slice(5, 7), 10) - 1;
  }
  function ms(i) {                       // inteiro -> "2026-10"
    var y = Math.floor(i / 12), mo = i - y * 12 + 1;
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  }
  function normMonth(m) { return ms(mi(m)); }
  function addMonths(m, n) { return ms(mi(m) + n); }
  function diffMonths(a, b) { return mi(b) - mi(a); }
  function toDbDate(m) { return normMonth(m) + '-01'; }
  function cents(x) { return Math.round(Number(x) * 100); }

  // ── índice dos dados ───────────────────────────────────────────────────
  // data = { items, rates, entries, settled? } (formato das tabelas do Supabase).
  // settled = marcas "pago/recebido" ({ item_id, month }); é só status: nenhuma conta usa.
  function buildIndex(data) {
    var entries = new Map(), ratesBy = new Map(), settled = new Set(), i;
    var es = data.entries || [], rs = data.rates || [], ss = data.settled || [];
    for (i = 0; i < es.length; i++) entries.set(es[i].item_id + '|' + mi(es[i].month), cents(es[i].amount));
    for (i = 0; i < rs.length; i++) {
      var list = ratesBy.get(rs[i].item_id);
      if (!list) { list = []; ratesBy.set(rs[i].item_id, list); }
      list.push({ from: mi(rs[i].from_month), cents: cents(rs[i].amount) });
    }
    ratesBy.forEach(function (l) { l.sort(function (a, b) { return a.from - b.from; }); });
    for (i = 0; i < ss.length; i++) settled.add(ss[i].item_id + '|' + mi(ss[i].month));
    return { items: data.items || [], entries: entries, ratesBy: ratesBy, settled: settled, cache: new Map() };
  }

  // O item já foi pago/recebido neste mês (m = inteiro do mês)?
  function isSettled(idx, item, m) { return idx.settled.has(item.id + '|' + m); }

  // O item repete neste mês? (recorrente, ativo e dentro de início/fim)
  function inRange(item, m) {
    if (!item.recurring || item.active === false || !item.start_month) return false;
    if (m < mi(item.start_month)) return false;
    if (item.end_month && m > mi(item.end_month)) return false;
    return true;
  }

  // Valor "previsto" (sem olhar lançamentos do mês): o último valor "a partir de" ≤ mês
  function projectedAt(idx, item, m) {
    if (!inRange(item, m)) return 0;
    var list = idx.ratesBy.get(item.id), c = 0;
    if (!list) return 0;
    for (var i = 0; i < list.length; i++) { if (list[i].from <= m) c = list[i].cents; else break; }
    return c;
  }

  // Valor do item no mês: lançamento do mês vence; senão o previsto; senão 0
  function amountAt(idx, item, m) {
    var key = item.id + '|' + m;
    if (idx.entries.has(key)) return { cents: idx.entries.get(key), source: 'real' };
    if (inRange(item, m)) return { cents: projectedAt(idx, item, m), source: 'previsto' };
    return { cents: 0, source: 'vazio' };
  }

  // "parcela k de n" para itens com data final
  function installmentAt(item, m) {
    if (!item.recurring || !item.start_month || !item.end_month) return null;
    var s = mi(item.start_month), e = mi(item.end_month);
    if (m < s || m > e) return null;
    return { k: m - s + 1, n: e - s + 1 };
  }

  function byDueThenName(a, b) {
    var da = a.item.due_day == null ? 99 : a.item.due_day;
    var db = b.item.due_day == null ? 99 : b.item.due_day;
    if (da !== db) return da - db;
    return String(a.item.name).localeCompare(String(b.item.name), 'pt-BR');
  }

  // ── mês ────────────────────────────────────────────────────────────────
  function totalsAt(idx, m) {
    var t = idx.cache.get(m);
    if (t) return t;
    var ent = 0, sai = 0;
    for (var i = 0; i < idx.items.length; i++) {
      var it = idx.items[i], c = amountAt(idx, it, m).cents;
      if (it.kind === 'entrada') ent += c; else sai += c;
    }
    t = { ent: ent, sai: sai, res: ent - sai };
    idx.cache.set(m, t);
    return t;
  }

  // Linhas do mês, já separadas em entradas/saídas e ordenadas por vencimento.
  //  - mostrar: valor diferente de zero (inclui lançamento zero? não: some da lista)
  //  - vazias: itens ativos que poderiam receber valor neste mês (para digitar)
  //  - settled (em cada linha): já foi pago/recebido. Só vale para linha com valor.
  //  - baixa: "dar baixa" = marcar como pago/recebido. Por tipo de linha: n = quantas linhas,
  //    feitas = quantas já marcadas, feito/falta = soma (em centavos) do que já foi e do que falta.
  //    Os totais do mês (totalEntradas, totalSaidas, resultado) NÃO mudam com as marcas.
  function monthView(idx, month) {
    var m = mi(month), lines = [], i;
    for (i = 0; i < idx.items.length; i++) {
      var it = idx.items[i];
      if (it.sim) continue;
      var a = amountAt(idx, it, m);
      lines.push({
        item: it, cents: a.cents, source: a.source, inst: installmentAt(it, m),
        settled: a.cents !== 0 && isSettled(idx, it, m),
        candidate: a.cents === 0 && it.active !== false && (!it.recurring || inRange(it, m))
      });
    }
    function pick(kind, wantValue) {
      return lines.filter(function (l) {
        if (l.item.kind !== kind) return false;
        return wantValue ? l.cents !== 0 : l.candidate;
      }).sort(byDueThenName);
    }
    function baixaOf(list) {
      var b = { n: list.length, feitas: 0, feito: 0, falta: 0 };
      list.forEach(function (l) { if (l.settled) { b.feitas++; b.feito += l.cents; } else b.falta += l.cents; });
      return b;
    }
    var t = totalsAt(idx, m), ent = pick('entrada', true), sai = pick('saida', true);
    return {
      month: normMonth(month),
      entradas: ent, saidas: sai,
      vazias: { entradas: pick('entrada', false), saidas: pick('saida', false) },
      totalEntradas: t.ent, totalSaidas: t.sai, resultado: t.res,
      baixa: { entradas: baixaOf(ent), saidas: baixaOf(sai) }
    };
  }

  // ── linha do tempo com saldo acumulado ─────────────────────────────────
  // settings = { balance_start_month, opening_balance }
  // Antes do mês inicial o saldo é null (a planilha também só acumula a partir dele).
  function timeline(idx, settings, fromMonth, count) {
    var start = mi(settings.balance_start_month), from = mi(fromMonth);
    var bal = cents(settings.opening_balance || 0), m, k, out = [], t;
    for (m = start; m < from; m++) bal += totalsAt(idx, m).res;
    for (k = 0; k < count; k++) {
      m = from + k; t = totalsAt(idx, m);
      if (m < start) { out.push({ month: ms(m), entradas: t.ent, saidas: t.sai, resultado: t.res, saldo: null }); continue; }
      bal += t.res;
      out.push({ month: ms(m), entradas: t.ent, saidas: t.sai, resultado: t.res, saldo: bal });
    }
    return out;
  }

  function statusOf(saldo, minCents) {
    if (saldo == null) return null;
    if (saldo < 0) return 'neg';
    if (saldo < minCents) return 'low';
    return 'ok';
  }

  // Resumo de uma linha do tempo: menor saldo e primeiros meses problemáticos
  function summarize(tl, minCents) {
    var min = null, minMonth = null, firstNeg = null, firstLow = null, last = null;
    for (var i = 0; i < tl.length; i++) {
      var s = tl[i].saldo;
      if (s == null) continue;
      last = s;
      if (min === null || s < min) { min = s; minMonth = tl[i].month; }
      if (s < 0 && firstNeg === null) firstNeg = tl[i].month;
      if (s < minCents && firstLow === null) firstLow = tl[i].month;
    }
    return { min: min, minMonth: minMonth, firstNeg: firstNeg, firstLow: firstLow, last: last };
  }

  // ── edição de valores: o que gravar quando a pessoa muda um valor ─────
  // scope 'mes'    → só aquele mês
  // scope 'adiante'→ daquele mês em diante (vira/continua item que repete)
  // Operações vazias. Os campos "addSettled"/"deleteSettled" (meses "AAAA-MM-01") mexem só nas
  // marcas de pago/recebido; os outros, só nos valores.
  function newOps() {
    return { item: null, upsertRates: [], deleteRates: [], upsertEntries: [], deleteEntries: [], addSettled: [], deleteSettled: [], replaced: 0 };
  }

  function planEdit(data, item, month, newCents, scope) {
    var m = mi(month), idx = buildIndex({ items: [item], rates: data.rates.filter(function (r) { return r.item_id === item.id; }), entries: [] });
    var myRates = data.rates.filter(function (r) { return r.item_id === item.id; });
    var myEntries = data.entries.filter(function (e) { return e.item_id === item.id; });
    var mySettled = (data.settled || []).filter(function (s) { return s.item_id === item.id; });
    var ops = newOps();
    var d1 = toDbDate(month), i;

    if (scope === 'adiante') {
      if (newCents < 0) throw new Error('valor_negativo_nao_repete');
      if (!item.recurring) ops.item = { recurring: true, start_month: d1 };
      else if (item.start_month && mi(item.start_month) > m) ops.item = { start_month: d1 };
      ops.upsertRates.push({ from_month: d1, amount: newCents });
      for (i = 0; i < myRates.length; i++) if (mi(myRates[i].from_month) > m) { ops.deleteRates.push(myRates[i].from_month); ops.replaced++; }
      for (i = 0; i < myEntries.length; i++) if (mi(myEntries[i].month) >= m) { ops.deleteEntries.push(myEntries[i].month); if (mi(myEntries[i].month) > m) ops.replaced++; }
      // valor zero daqui em diante: a linha some de todos esses meses, então as marcas também saem
      // (senão voltariam "já pagas" quando o item ganhasse valor de novo)
      if (newCents === 0) for (i = 0; i < mySettled.length; i++) if (mi(mySettled[i].month) >= m) ops.deleteSettled.push(mySettled[i].month);
      return ops;
    }

    var projected = projectedAt(idx, item, m);
    var has = myEntries.some(function (e) { return mi(e.month) === m; });
    if (newCents === projected) { if (has) ops.deleteEntries.push(d1); }
    else ops.upsertEntries.push({ month: d1, amount: newCents });
    // valor zero: a linha sai do mês, a marca sai junto
    if (newCents === 0) for (i = 0; i < mySettled.length; i++) if (mi(mySettled[i].month) === m) ops.deleteSettled.push(mySettled[i].month);
    return ops;
  }

  // Marcar (on = true) ou desmarcar (on = false) um item como pago/recebido num mês.
  // Só mexe na marca, nunca no valor. Se `ops` vier, soma nele (para gravar junto com uma
  // edição de valor); se a marca já está como se pede, não pede nada.
  function planSettle(data, item, month, on, ops) {
    ops = ops || newOps();
    var m = mi(month), d1 = toDbDate(month);
    var has = (data.settled || []).some(function (s) { return s.item_id === item.id && mi(s.month) === m; });
    if (on && !has && ops.addSettled.indexOf(d1) < 0) ops.addSettled.push(d1);
    if (!on && has && ops.deleteSettled.indexOf(d1) < 0) ops.deleteSettled.push(d1);
    return ops;
  }

  // ── compras parceladas / simulações ────────────────────────────────────
  function splitInstallments(totalCents, n) {
    var per = Math.floor(totalCents / n), rem = totalCents - per * n;
    return { per: per, first: per + rem };
  }

  // spec → item + valores no mesmo formato dos dados do banco (id "sim:…" se não vier)
  // spec = { kind, name, start:"AAAA-MM", n:(número|null=sem fim), perCents, firstCents?, type?, card?, dueDay?, id? }
  function expandSpec(spec) {
    var id = spec.id || ('sim:' + Math.random().toString(36).slice(2, 9));
    var start = normMonth(spec.start);
    var n = spec.n && spec.n > 0 ? Math.floor(spec.n) : null;
    var per = Math.trunc(spec.perCents), first = spec.firstCents != null ? Math.trunc(spec.firstCents) : per;
    var type = spec.type;
    if (!type) type = spec.kind === 'entrada' ? (n === 1 ? 'outro' : 'renda') : (n === 1 ? 'outro' : (n ? 'parcela' : 'conta'));
    var item = {
      id: id, kind: spec.kind, type: type, name: String(spec.name || '').trim(), card_name: spec.card || null,
      due_day: spec.dueDay || null, recurring: true, start_month: start + '-01',
      end_month: n ? addMonths(start, n - 1) + '-01' : null, note: null, active: true
    };
    var rates = [{ item_id: id, from_month: start + '-01', amount: first / 100 }];
    if (n !== 1 && first !== per) rates.push({ item_id: id, from_month: addMonths(start, 1) + '-01', amount: per / 100 });
    return { item: item, rates: rates };
  }

  // Junta os dados reais com simulações (itens marcados sim:true; não aparecem no mês)
  function withSims(data, specs) {
    var items = data.items.slice(), rates = data.rates.slice();
    specs.forEach(function (sp, i) {
      var ex = expandSpec(Object.assign({}, sp, { id: 'sim:' + (sp.id || i) }));
      ex.item.sim = true;
      items.push(ex.item);
      ex.rates.forEach(function (r) { rates.push(r); });
    });
    return { items: items, rates: rates, entries: data.entries, settled: data.settled };
  }


  // ── cenários e formas de pagar ──────────────────────────────────────────
  function minCents(settings) { return cents(settings && settings.min_balance != null ? settings.min_balance : 0); }

  // Linha do tempo sem e com as simulações (specs), do mesmo ponto de partida
  function scenario(data, settings, specs, fromMonth, count) {
    var minC = minCents(settings);
    var base = timeline(buildIndex(data), settings, fromMonth, count);
    var sim = specs && specs.length ? timeline(buildIndex(withSims(data, specs)), settings, fromMonth, count) : base;
    return { base: base, sim: sim, baseSummary: summarize(base, minC), simSummary: summarize(sim, minC), minCents: minC };
  }

  // Uma compra de `totalCents` começando em `start`: à vista (n=1) ou em n parcelas.
  // Cabe quando o menor saldo do período continua ≥ saldo mínimo.
  function waysToPay(data, settings, o) {
    var minC = minCents(settings), horizon = o.horizon || 24, out = [];
    (o.options || [1, 2, 3, 6, 10, 12]).forEach(function (n) {
      var sp = splitInstallments(o.totalCents, n);
      var spec = { kind: 'saida', name: 'compra', start: o.start, n: n, perCents: sp.per, firstCents: sp.first };
      var tl = timeline(buildIndex(withSims(data, [spec])), settings, o.start, Math.max(horizon, n));
      var sum = summarize(tl, minC);
      out.push({
        n: n, per: sp.per, first: sp.first, min: sum.min, minMonth: sum.minMonth,
        status: statusOf(sum.min, minC), fits: sum.min != null && sum.min >= minC
      });
    });
    return out;
  }

  // Primeiro mês (a partir de `from`) em que dá para pagar à vista mantendo o mínimo
  // durante `horizon` meses. Devolve null se não houver nos próximos `search` meses.
  function cashFitMonth(data, settings, totalCents, from, search, horizon) {
    var minC = minCents(settings);
    search = search || 24; horizon = horizon || 24;
    var tl = timeline(buildIndex(data), settings, from, search + horizon);
    for (var k = 0; k < search; k++) {
      var worst = null, worstMonth = null;
      for (var j = k; j < k + horizon && j < tl.length; j++) {
        var sd = tl[j].saldo;
        if (sd == null) continue;
        if (worst === null || sd < worst) { worst = sd; worstMonth = tl[j].month; }
      }
      if (worst !== null && worst - totalCents >= minC) {
        return { month: tl[k].month, minAfter: worst - totalCents, minMonth: worstMonth };
      }
    }
    return null;
  }

  return {
    mi: mi, ms: ms, normMonth: normMonth, addMonths: addMonths, diffMonths: diffMonths, toDbDate: toDbDate, cents: cents,
    buildIndex: buildIndex, inRange: inRange, projectedAt: projectedAt, amountAt: amountAt, installmentAt: installmentAt, isSettled: isSettled,
    monthView: monthView, totalsAt: totalsAt, timeline: timeline, statusOf: statusOf, summarize: summarize,
    planEdit: planEdit, planSettle: planSettle, newOps: newOps, splitInstallments: splitInstallments, expandSpec: expandSpec, withSims: withSims,
    minCents: minCents, scenario: scenario, waysToPay: waysToPay, cashFitMonth: cashFitMonth
  };
});
