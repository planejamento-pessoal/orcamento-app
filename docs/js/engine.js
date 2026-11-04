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
  // data = { items, rates, entries, settled?, settings? } (formato das tabelas do Supabase).
  // settled = marcas "pago/recebido" ({ item_id, month }); é só status: nenhuma conta usa.
  // settings ({ balance_start_month, opening_balance }) só é preciso para a "conta corrente" (abaixo).
  //
  // CONTA CORRENTE ("carry_over"): um item de entrada que não repete (o que guarda o dinheiro da conta) puxa, todo mês depois
  // do mês inicial do saldo, o que sobrou do mês anterior = o saldo acumulado no fim dele.
  // O saldo acumulado JÁ carrega essa sobra de um mês para o outro; por isso a sobra mostrada na linha
  // do item NÃO entra nas entradas nem no resultado do mês (entraria duas vezes). Ela só aparece:
  //   • no mês (monthView.carry) e no valor do item (amountAt, source 'auto');
  //   • como correção: um valor lançado para o item num desses meses vale como o saldo REAL da conta
  //     no começo do mês, e os meses seguintes partem dele (source 'real').
  // No mês inicial e antes dele o item é um item comum (o valor dele é o dinheiro que já estava na conta).
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
    var items = data.items || [], st = data.settings, carry = null;
    for (i = 0; i < items.length && !carry; i++) if (isCarryItem(items[i])) carry = items[i];
    return {
      items: items, entries: entries, ratesBy: ratesBy, settled: settled, cache: new Map(),
      carry: carry,
      start: st && st.balance_start_month ? mi(st.balance_start_month) : null,
      opening: st ? cents(st.opening_balance || 0) : 0,
      bal: new Map(), variants: new Map()
    };
  }

  // Item que puxa a sobra do mês anterior: entrada que não repete e ligada (simulação nunca).
  // "Ativo" não entra aqui de propósito: para um item que não repete ele só serve para sugerir o item nos meses
  // sem valor, e a conta corrente nunca é sugerida. Se "parado" desligasse a conta corrente, o saldo real
  // lançado voltaria a somar como entrada e a sobra do mês anterior entraria duas vezes no saldo.
  function isCarryItem(it) {
    return !!it && it.carry_over === true && it.kind === 'entrada' && !it.recurring && !it.sim;
  }
  // Este item é a conta corrente deste índice?
  function isCarry(idx, item) { return !!idx.carry && !!item && item.id === idx.carry.id; }
  // A conta corrente puxa a sobra neste mês? (só depois do mês inicial do saldo)
  function carryActive(idx, m) { return idx.carry !== null && idx.start !== null && m > idx.start; }
  // Valor lançado para a conta corrente neste mês (centavos) = saldo real digitado; null se não há
  function overrideAt(idx, m) {
    if (!carryActive(idx, m)) return null;
    var k = idx.carry.id + '|' + m;
    return idx.entries.has(k) ? idx.entries.get(k) : null;
  }

  // O mesmo índice, para outras configurações (mês inicial e saldo de abertura). Só muda de verdade se
  // alguém pedir uma linha do tempo com configurações diferentes das que montaram o índice (testes).
  function withSettings(idx, settings) {
    if (!settings || !settings.balance_start_month) return idx;
    var start = mi(settings.balance_start_month), opening = cents(settings.opening_balance || 0);
    if (idx.start === start && idx.opening === opening) return idx;
    var key = start + '|' + opening, v = idx.variants.get(key);
    if (!v) {
      v = Object.assign({}, idx, { start: start, opening: opening, cache: new Map(), bal: new Map(), variants: new Map() });
      idx.variants.set(key, v);
    }
    return v;
  }

  // Saldo acumulado no fim do mês m (inteiro); null antes do mês inicial.
  //   mês inicial:  saldo de abertura + resultado do mês
  //   depois:       (saldo do mês anterior, ou o saldo real digitado na conta corrente) + resultado do mês
  // O resultado do mês (totalsAt) não inclui a sobra mostrada na conta corrente: ela já está no saldo anterior.
  function balanceEnd(idx, m) {
    var st = idx.start;
    if (st === null || m < st) return null;
    var memo = idx.bal, k = m;
    if (memo.has(m)) return memo.get(m);
    while (k > st && !memo.has(k - 1)) k--;
    for (; k <= m; k++) {
      var res = totalsAt(idx, k).res, bal;
      if (k === st) bal = idx.opening + res;
      else { var ov = overrideAt(idx, k); bal = (ov === null ? memo.get(k - 1) : ov) + res; }
      memo.set(k, bal);
    }
    return memo.get(m);
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

  // Valor do item no mês: lançamento do mês vence; senão o previsto; senão 0.
  // Conta corrente (depois do mês inicial): o lançamento do mês (saldo real, source 'real') ou a sobra do
  // mês anterior (source 'auto'). Esse valor é só para mostrar: nunca entra nas somas do mês (ver totalsAt).
  function amountAt(idx, item, m) {
    if (isCarry(idx, item) && carryActive(idx, m)) {
      var ov = overrideAt(idx, m);
      return ov !== null ? { cents: ov, source: 'real' } : { cents: balanceEnd(idx, m - 1), source: 'auto' };
    }
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
    var ent = 0, sai = 0, skip = carryActive(idx, m) ? idx.carry : null;
    for (var i = 0; i < idx.items.length; i++) {
      var it = idx.items[i];
      if (it === skip) continue;             // a sobra do mês anterior não é entrada do mês (o saldo já a carrega)
      var c = amountAt(idx, it, m).cents;
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
  //  - carry: a conta corrente neste mês (ou null). { item, cents (o que aparece), auto (a sobra do mês
  //    anterior), prev (esse mês, "AAAA-MM"), real (há saldo real lançado) }. Fica FORA de entradas, de
  //    vazias e dos totais: o saldo acumulado já carrega essa sobra (somar de novo contaria em dobro).
  //    saldo no fim do mês = cents + resultado.
  function monthView(idx, month) {
    var m = mi(month), lines = [], i, carry = null;
    for (i = 0; i < idx.items.length; i++) {
      var it = idx.items[i];
      if (it.sim) continue;
      if (carryActive(idx, m) && isCarry(idx, it)) {
        var ca = amountAt(idx, it, m);
        carry = { item: it, cents: ca.cents, auto: balanceEnd(idx, m - 1), prev: ms(m - 1), real: ca.source === 'real' };
        continue;
      }
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
      baixa: { entradas: baixaOf(ent), saidas: baixaOf(sai) },
      carry: carry
    };
  }

  // A conta corrente num mês: { auto (centavos), prev, real, cents } ou null (outro item, ou mês sem "puxar").
  function carryAt(idx, item, month) {
    var m = mi(month);
    if (!isCarry(idx, item) || !carryActive(idx, m)) return null;
    var a = amountAt(idx, item, m);
    return { cents: a.cents, auto: balanceEnd(idx, m - 1), prev: ms(m - 1), real: a.source === 'real' };
  }

  // ── linha do tempo com saldo acumulado ─────────────────────────────────
  // settings = { balance_start_month, opening_balance }
  // Antes do mês inicial o saldo é null (a planilha também só acumula a partir dele).
  function timeline(idx, settings, fromMonth, count) {
    idx = withSettings(idx, settings);
    var from = mi(fromMonth), m, k, out = [], t;
    for (k = 0; k < count; k++) {
      m = from + k; t = totalsAt(idx, m);
      out.push({ month: ms(m), entradas: t.ent, saidas: t.sai, resultado: t.res, saldo: balanceEnd(idx, m) });
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

  // A conta corrente puxa a sobra neste mês (inteiro m)? Olha só o item e as configurações (sem índice).
  function isCarryMonth(data, item, m) {
    var st = data.settings;
    return isCarryItem(item) && !!st && !!st.balance_start_month && m > mi(st.balance_start_month);
  }

  function planEdit(data, item, month, newCents, scope) {
    var m = mi(month), idx = buildIndex({ items: [item], rates: data.rates.filter(function (r) { return r.item_id === item.id; }), entries: [] });
    var myRates = data.rates.filter(function (r) { return r.item_id === item.id; });
    var myEntries = data.entries.filter(function (e) { return e.item_id === item.id; });
    var mySettled = (data.settled || []).filter(function (s) { return s.item_id === item.id; });
    var ops = newOps();
    var d1 = toDbDate(month), i;

    // Conta corrente: nunca repete (o banco recusa), então "daqui em diante" não existe para ela.
    // Depois do mês inicial, o valor digitado é o saldo REAL da conta no começo do mês: este plano grava o valor
    // mesmo quando ele é igual à sobra prevista (voltar ao automático é pedido à parte, planCarryAuto).
    // Quem decide se o plano é pedido é a tela: ela só pede quando o valor mudou, então abrir o item e salvar
    // sem mexer no valor não fixa nada.
    if (item.carry_over === true) {
      if (isCarryMonth(data, item, m)) { ops.upsertEntries.push({ month: d1, amount: newCents }); return ops; }
      scope = 'mes';
    }

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

  // Conta corrente: voltar ao automático = apagar o saldo real lançado naquele mês (se houver).
  function planCarryAuto(data, item, month) {
    var m = mi(month), ops = newOps();
    if ((data.entries || []).some(function (e) { return e.item_id === item.id && mi(e.month) === m; })) ops.deleteEntries.push(toDbDate(month));
    return ops;
  }

  // Ligar (on = true) ou desligar a conta corrente de um item.
  // Ligar: os valores que o item já tem DEPOIS do mês inicial passam a valer como saldo real da conta
  //   naquele mês (ops.afetados diz quantos; a tela avisa antes).
  // Desligar: esses mesmos valores são apagados, senão virariam entradas comuns e mexeriam no saldo.
  function planCarry(data, item, on) {
    var ops = newOps(), st = data.settings, i, after = [];
    var start = st && st.balance_start_month ? mi(st.balance_start_month) : null;
    var mine = (data.entries || []).filter(function (e) { return e.item_id === item.id; });
    if (start !== null) after = mine.filter(function (e) { return mi(e.month) > start; });
    ops.item = { carry_over: !!on };
    ops.afetados = after.length;
    if (!on) for (i = 0; i < after.length; i++) ops.deleteEntries.push(toDbDate(after[i].month));
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
    return { items: items, rates: rates, entries: data.entries, settled: data.settled, settings: data.settings };
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

  // Menor saldo da janela [k, k+h) depois de gastar `valor` no mês tl[k] (tl = linha do tempo SEM a compra,
  // idx = o índice dela, já com as configurações). A compra baixa o saldo de todos os meses seguintes, menos os
  // que vêm depois de um saldo real lançado na conta corrente: esse saldo recomeça a conta e apaga o efeito da
  // compra (é o que a aba Simular mostra). Sem saldo real lançado mais à frente, é o menor saldo menos `valor`.
  function worstAfterSpend(idx, tl, k, h, valor) {
    var worst = null, worstMonth = null, erased = false;
    for (var j = k; j < k + h && j < tl.length; j++) {
      if (j > k && overrideAt(idx, mi(tl[j].month)) !== null) erased = true;
      var sd = tl[j].saldo;
      if (sd == null) continue;
      var v = erased ? sd : sd - valor;
      if (worst === null || v < worst) { worst = v; worstMonth = tl[j].month; }
    }
    return { min: worst, minMonth: worstMonth };
  }

  // Primeiro mês (a partir de `from`) em que dá para pagar à vista mantendo o mínimo
  // durante `horizon` meses. Devolve null se não houver nos próximos `search` meses.
  function cashFitMonth(data, settings, totalCents, from, search, horizon) {
    var minC = minCents(settings);
    search = search || 24; horizon = horizon || 24;
    var idx = withSettings(buildIndex(data), settings);
    var tl = timeline(idx, settings, from, search + horizon);
    for (var k = 0; k < search; k++) {
      var w = worstAfterSpend(idx, tl, k, horizon, totalCents);
      if (w.min !== null && w.min >= minC) {
        return { month: tl[k].month, minAfter: w.min, minMonth: w.minMonth };
      }
    }
    return null;
  }

  // ── compras planejadas (a aba "Compras", a PRIORIDADES da planilha) ─────
  // Cada compra é avaliada SOZINHA contra o orçamento de hoje, como na planilha: "se eu comprar só
  // isto, no mês previsto, o saldo acumulado aguenta?". Quando uma compra é lançada no orçamento,
  // as outras passam a ser avaliadas já com ela dentro.
  //
  // compra = { id, name, priority (1-5), status ('nada'|'planejado'|'orcando'|'concluido'),
  //            est_amount, final_amount, exec_month, inst_total, inst_count, seq }   (valores em reais)
  // Tudo que sai daqui é em centavos. `today` ("AAAA-MM") vem de fora: o motor nunca olha o relógio.
  //
  // Regras (as da planilha, menos os furos dela):
  //  • valor da compra = valor final, se foi preenchido; senão o estimado;
  //  • mês avaliado = o mês previsto; se ele já passou (ou não existe), o mês de hoje;
  //  • à vista cabe quando o MENOR saldo acumulado dos próximos `horizon` meses, menos o valor, ainda
  //    fica no saldo mínimo ou acima (a planilha olhava até o último mês da tabela);
  //  • parcelado cabe quando o menor saldo, com as parcelas dentro do orçamento, fica no mínimo ou acima
  //    (a planilha só comparava o resultado do mês de início com a parcela e ignorava os outros meses);
  //  • melhor forma: à vista; senão parcelado; senão aguardar (e diz a partir de que mês cabe à vista);
  //  • melhor compra: entre as que cabem à vista e não foram concluídas, a de maior prioridade;
  //    na mesma prioridade, a mais barata; no empate, a cadastrada primeiro.
  var PURCHASE_HORIZON = 24;

  function purchaseValue(p) {
    var fin = p.final_amount == null ? 0 : cents(p.final_amount);
    var est = p.est_amount == null ? 0 : cents(p.est_amount);
    return fin > 0 ? fin : (est > 0 ? est : 0);
  }

  // ctx = { idx, data, settings, minC, horizon, today }
  function evalPurchase(ctx, p) {
    var valor = purchaseValue(p), tm = mi(ctx.today);
    var execM = p.exec_month ? normMonth(p.exec_month) : null;
    var from = execM && mi(execM) > tm ? execM : ctx.today;
    var r = {
      purchase: p, valor: valor, from: from, execMonth: execM, late: !!execM && mi(execM) < tm,
      state: 'ok', cash: null, inst: null, how: null, wait: null
    };
    if (p.status === 'concluido') { r.state = 'concluida'; return r; }
    if (valor <= 0) { r.state = 'sem-valor'; return r; }
    var tl = timeline(ctx.idx, ctx.settings, from, ctx.horizon);
    var sum = summarize(tl, ctx.minC);
    if (sum.min == null) { r.state = 'sem-saldo'; return r; }          // o saldo acumulado ainda nem começou
    var w = worstAfterSpend(ctx.idx, tl, 0, ctx.horizon, valor);        // como no Simular (um saldo real lançado mais à frente apaga o efeito)
    var after = w.min;
    r.cash = { min: sum.min, minMonth: sum.minMonth, after: after, afterMonth: w.minMonth, fits: after >= ctx.minC, missing: Math.max(0, ctx.minC - after) };
    var n = p.inst_count ? Math.floor(Number(p.inst_count)) : 0;
    if (n >= 2) {
      var given = p.inst_total != null && cents(p.inst_total) > 0;
      var total = given ? cents(p.inst_total) : valor;                   // sem total informado: sem juros
      var w = waysToPay(ctx.data, ctx.settings, { totalCents: total, start: from, options: [n], horizon: ctx.horizon })[0];
      r.inst = { n: n, total: total, totalGiven: given, per: w.per, first: w.first, min: w.min, minMonth: w.minMonth, fits: !!w.fits };
    }
    r.how = r.cash.fits ? 'avista' : (r.inst && r.inst.fits ? 'parcelado' : 'aguardar');
    if (r.how === 'aguardar') r.wait = cashFitMonth(ctx.data, ctx.settings, valor, from, 36, ctx.horizon);
    return r;
  }

  function evaluatePurchases(data, settings, list, opts) {
    opts = opts || {};
    var today = normMonth(opts.today);
    var ctx = { idx: withSettings(buildIndex(data), settings), data: data, settings: settings, minC: minCents(settings), horizon: opts.horizon || PURCHASE_HORIZON, today: today };
    // ordem da lista: prioridade maior primeiro; na mesma prioridade, a cadastrada antes (seq do banco)
    var rows = (list || []).map(function (p, i) { return { p: p, i: i }; });
    rows.sort(function (a, b) {
      if (a.p.priority !== b.p.priority) return b.p.priority - a.p.priority;
      if (a.p.seq != null && b.p.seq != null && Number(a.p.seq) !== Number(b.p.seq)) return Number(a.p.seq) - Number(b.p.seq);
      return a.i - b.i;
    });
    var items = rows.map(function (x) { return evalPurchase(ctx, x.p); });
    function better(a, b) {                                             // a vence b? (empate: quem veio antes na lista)
      if (a.purchase.priority !== b.purchase.priority) return a.purchase.priority > b.purchase.priority;
      return a.valor < b.valor;
    }
    var bestCash = null, bestInst = null;
    items.forEach(function (r) {
      if (r.how === 'avista' && (!bestCash || better(r, bestCash))) bestCash = r;
      if (r.how === 'parcelado' && (!bestInst || better(r, bestInst))) bestInst = r;
    });
    var tl0 = timeline(ctx.idx, settings, today, 1)[0];
    return { today: today, minCents: ctx.minC, horizon: ctx.horizon, saldoToday: tl0 ? tl0.saldo : null,
             items: items, best: bestCash, bestInstallment: bestCash ? null : bestInst };
  }

  // Uma compra avaliada -> simulação no formato da aba Simular (how: 'avista' | 'parcelado')
  function purchaseSpec(r, how) {
    var p = r.purchase;
    if (how === 'parcelado' && r.inst) return { kind: 'saida', name: p.name, start: r.from, n: r.inst.n, perCents: r.inst.per, firstCents: r.inst.first, totalCents: r.inst.total };
    return { kind: 'saida', name: p.name, start: r.from, n: 1, perCents: r.valor, firstCents: r.valor, totalCents: r.valor };
  }

  return {
    mi: mi, ms: ms, normMonth: normMonth, addMonths: addMonths, diffMonths: diffMonths, toDbDate: toDbDate, cents: cents,
    buildIndex: buildIndex, inRange: inRange, projectedAt: projectedAt, amountAt: amountAt, installmentAt: installmentAt, isSettled: isSettled,
    isCarry: isCarry, isCarryItem: isCarryItem, isCarryMonth: isCarryMonth, carryAt: carryAt,
    monthView: monthView, totalsAt: totalsAt, timeline: timeline, statusOf: statusOf, summarize: summarize,
    planEdit: planEdit, planSettle: planSettle, planCarryAuto: planCarryAuto, planCarry: planCarry, newOps: newOps,
    splitInstallments: splitInstallments, expandSpec: expandSpec, withSims: withSims,
    minCents: minCents, scenario: scenario, waysToPay: waysToPay, cashFitMonth: cashFitMonth,
    purchaseValue: purchaseValue, evaluatePurchases: evaluatePurchases, purchaseSpec: purchaseSpec, PURCHASE_HORIZON: PURCHASE_HORIZON
  };
});
