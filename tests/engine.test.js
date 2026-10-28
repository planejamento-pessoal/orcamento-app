// Testes do motor de cálculo. Rodar (na pasta do repositório):  node --test
// (usa só dados inventados — nenhum valor real do orçamento fica no repositório)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../docs/js/engine.js');

function fixture() {
  return {
    items: [
      { id: 'a', kind: 'saida', type: 'conta', name: 'Aluguel', due_day: 5, recurring: true, start_month: '2026-01-01', end_month: null, active: true },
      { id: 'b', kind: 'saida', type: 'cartao', name: 'Cartão X', due_day: 20, recurring: false, start_month: null, end_month: null, active: true },
      { id: 'c', kind: 'entrada', type: 'renda', name: 'Salário', due_day: null, recurring: true, start_month: '2026-01-01', end_month: null, active: true },
      { id: 'd', kind: 'saida', type: 'parcela', name: 'TV', due_day: 10, recurring: true, start_month: '2026-03-01', end_month: '2026-05-01', active: true },
      { id: 'e', kind: 'saida', type: 'conta', name: 'Arquivado', due_day: 1, recurring: true, start_month: '2026-01-01', end_month: null, active: false }
    ],
    rates: [
      { item_id: 'a', from_month: '2026-01-01', amount: 1000 },
      { item_id: 'a', from_month: '2026-07-01', amount: 1100 },
      { item_id: 'c', from_month: '2026-01-01', amount: 3000 },
      { item_id: 'd', from_month: '2026-03-01', amount: 333.34 },
      { item_id: 'd', from_month: '2026-04-01', amount: 333.33 },
      { item_id: 'e', from_month: '2026-01-01', amount: 77 }
    ],
    entries: [
      { item_id: 'b', month: '2026-02-01', amount: 500.5 },
      { item_id: 'c', month: '2026-12-01', amount: 4500 },
      { item_id: 'e', month: '2026-02-01', amount: 10 }
    ],
    settings: { balance_start_month: '2026-01-01', opening_balance: 100, min_balance: 1000 }
  };
}

test('meses: conversões e virada de ano', () => {
  assert.equal(E.ms(E.mi('2026-12') + 1), '2027-01');
  assert.equal(E.addMonths('2026-11', 3), '2027-02');
  assert.equal(E.addMonths('2026-01', -1), '2025-12');
  assert.equal(E.diffMonths('2026-10', '2028-01'), 15);
  assert.equal(E.normMonth('2026-10-01'), '2026-10');
  assert.equal(E.toDbDate('2026-10'), '2026-10-01');
  assert.throws(() => E.mi('outubro'));
});

test('centavos: sem erro de ponto flutuante', () => {
  assert.equal(E.cents('13.87'), 1387);
  assert.equal(E.cents(0.1 + 0.2), 30);
  assert.equal(E.cents(1234.5), 123450);
  assert.equal(E.cents('0'), 0);
});

test('valor do item: lançamento vence o previsto; fora do período é zero', () => {
  const d = fixture(), idx = E.buildIndex(d), A = d.items[0], B = d.items[1], C = d.items[2];
  assert.deepEqual(E.amountAt(idx, A, E.mi('2026-06')), { cents: 100000, source: 'previsto' });
  assert.deepEqual(E.amountAt(idx, A, E.mi('2026-07')), { cents: 110000, source: 'previsto' }); // novo valor a partir de jul
  assert.deepEqual(E.amountAt(idx, A, E.mi('2025-12')), { cents: 0, source: 'vazio' });          // antes do início
  assert.deepEqual(E.amountAt(idx, A, E.mi('2031-03')), { cents: 110000, source: 'previsto' });  // anos à frente
  assert.deepEqual(E.amountAt(idx, B, E.mi('2026-02')), { cents: 50050, source: 'real' });
  assert.deepEqual(E.amountAt(idx, B, E.mi('2026-03')), { cents: 0, source: 'vazio' });          // não repete
  assert.deepEqual(E.amountAt(idx, C, E.mi('2026-12')), { cents: 450000, source: 'real' });      // 13º sobrepõe o salário
  assert.deepEqual(E.amountAt(idx, C, E.mi('2027-01')), { cents: 300000, source: 'previsto' });
});

test('item arquivado: não projeta, mas lançamento já digitado continua valendo', () => {
  const d = fixture(), idx = E.buildIndex(d), Ar = d.items[4];
  assert.equal(E.amountAt(idx, Ar, E.mi('2026-03')).cents, 0);
  assert.equal(E.amountAt(idx, Ar, E.mi('2026-02')).cents, 1000);
});

test('parcelas: k de n e fim da dívida', () => {
  const d = fixture(), idx = E.buildIndex(d), D = d.items[3];
  assert.deepEqual(E.installmentAt(D, E.mi('2026-03')), { k: 1, n: 3 });
  assert.deepEqual(E.installmentAt(D, E.mi('2026-05')), { k: 3, n: 3 });
  assert.equal(E.installmentAt(D, E.mi('2026-06')), null);
  assert.equal(E.amountAt(idx, D, E.mi('2026-03')).cents, 33334);
  assert.equal(E.amountAt(idx, D, E.mi('2026-05')).cents, 33333);
  assert.equal(E.amountAt(idx, D, E.mi('2026-06')).cents, 0);
  const total = ['2026-03', '2026-04', '2026-05'].reduce((s, m) => s + E.amountAt(idx, D, E.mi(m)).cents, 0);
  assert.equal(total, 100000);
});

test('visão do mês: totais, ordem por vencimento e itens sem valor', () => {
  const d = fixture(), idx = E.buildIndex(d), v = E.monthView(idx, '2026-03');
  assert.deepEqual(v.saidas.map(l => l.item.name), ['Aluguel', 'TV']);   // dia 5, dia 10
  assert.equal(v.totalSaidas, 100000 + 33334);
  assert.equal(v.totalEntradas, 300000);
  assert.equal(v.resultado, 300000 - 133334);
  assert.deepEqual(v.vazias.saidas.map(l => l.item.name), ['Cartão X']);  // pode receber valor; arquivado não aparece
  const v2 = E.monthView(idx, '2026-02');
  assert.equal(v2.saidas.find(l => l.item.id === 'b').source, 'real');
  assert.equal(v2.saidas.find(l => l.item.id === 'e').cents, 1000);       // arquivado com lançamento aparece
});

test('linha do tempo: saldo acumulado, nulo antes do início e consistente em qualquer janela', () => {
  const d = fixture(), idx = E.buildIndex(d);
  const tl = E.timeline(idx, d.settings, '2026-01', 4);
  // jan: 3000 - 1000 = 2000 (+100 de saldo inicial)
  assert.equal(tl[0].saldo, 10000 + 200000);
  // fev: 3000 - 1000 - 500,50 - 10 (arquivado com lançamento)
  assert.equal(tl[1].resultado, 300000 - 100000 - 50050 - 1000);
  assert.equal(tl[1].saldo, tl[0].saldo + tl[1].resultado);
  // janela que começa depois do início dá os mesmos saldos
  const later = E.timeline(idx, d.settings, '2026-03', 2);
  assert.equal(later[0].saldo, tl[2].saldo);
  assert.equal(later[1].saldo, tl[3].saldo);
  // antes do mês inicial não há saldo
  const before = E.timeline(idx, d.settings, '2025-11', 3);
  assert.deepEqual(before.map(x => x.saldo === null), [true, true, false]);
  // muitos anos à frente funciona e é determinístico
  const far = E.timeline(idx, d.settings, '2026-01', 120);
  assert.equal(far.length, 120);
  assert.equal(far[119].month, '2035-12');
  assert.ok(Number.isInteger(far[119].saldo));
});

test('status e resumo do saldo', () => {
  assert.equal(E.statusOf(null, 100000), null);
  assert.equal(E.statusOf(-1, 100000), 'neg');
  assert.equal(E.statusOf(99999, 100000), 'low');
  assert.equal(E.statusOf(100000, 100000), 'ok');
  const tl = [{ month: '2026-01', saldo: 500000 }, { month: '2026-02', saldo: 50000 }, { month: '2026-03', saldo: -2000 }, { month: '2026-04', saldo: 70000 }];
  const s = E.summarize(tl, 100000);
  assert.deepEqual(s, { min: -2000, minMonth: '2026-03', firstNeg: '2026-03', firstLow: '2026-02', last: 70000 });
});

// aplica as operações de planEdit nos dados (só para testar o efeito final)
function apply(data, itemId, ops) {
  const out = { items: data.items.map(i => Object.assign({}, i)), rates: data.rates.slice(), entries: data.entries.slice() };
  if (ops.item) Object.assign(out.items.find(i => i.id === itemId), ops.item);
  ops.deleteRates.forEach(fm => { out.rates = out.rates.filter(r => !(r.item_id === itemId && r.from_month === fm)); });
  ops.upsertRates.forEach(r => {
    out.rates = out.rates.filter(x => !(x.item_id === itemId && x.from_month === r.from_month));
    out.rates.push({ item_id: itemId, from_month: r.from_month, amount: r.amount / 100 });
  });
  ops.deleteEntries.forEach(mo => { out.entries = out.entries.filter(e => !(e.item_id === itemId && e.month === mo)); });
  ops.upsertEntries.forEach(e => {
    out.entries = out.entries.filter(x => !(x.item_id === itemId && x.month === e.month));
    out.entries.push({ item_id: itemId, month: e.month, amount: e.amount / 100 });
  });
  return out;
}
const val = (d, id, m) => E.amountAt(E.buildIndex(d), d.items.find(i => i.id === id), E.mi(m)).cents;

test('editar só um mês: cria lançamento; voltar ao previsto apaga o lançamento', () => {
  const d = fixture(), A = d.items[0];
  let ops = E.planEdit(d, A, '2026-09', 123456, 'mes');
  assert.deepEqual(ops.upsertEntries, [{ month: '2026-09-01', amount: 123456 }]);
  let d2 = apply(d, 'a', ops);
  assert.equal(val(d2, 'a', '2026-09'), 123456);
  assert.equal(val(d2, 'a', '2026-10'), 110000);               // outros meses intactos
  ops = E.planEdit(d2, A, '2026-09', 110000, 'mes');            // digitou o valor previsto
  assert.deepEqual(ops.upsertEntries, []);
  assert.deepEqual(ops.deleteEntries, ['2026-09-01']);
  assert.equal(val(apply(d2, 'a', ops), 'a', '2026-09'), 110000);
});

test('editar "daqui em diante": novo valor, meses anteriores intactos, trocas futuras removidas', () => {
  const d = fixture(), A = d.items[0];
  d.entries.push({ item_id: 'a', month: '2026-11-01', amount: 999 });   // exceção futura
  const ops = E.planEdit(d, A, '2026-05', 120000, 'adiante');
  assert.deepEqual(ops.upsertRates, [{ from_month: '2026-05-01', amount: 120000 }]);
  assert.deepEqual(ops.deleteRates, ['2026-07-01']);                    // o "1100 a partir de jul" é substituído
  assert.deepEqual(ops.deleteEntries, ['2026-11-01']);
  assert.equal(ops.replaced, 2);
  const d2 = apply(d, 'a', ops);
  assert.equal(val(d2, 'a', '2026-04'), 100000);
  assert.equal(val(d2, 'a', '2026-05'), 120000);
  assert.equal(val(d2, 'a', '2026-08'), 120000);
  assert.equal(val(d2, 'a', '2026-11'), 120000);
  assert.equal(val(d2, 'a', '2030-01'), 120000);
});

test('item que não repetia passa a repetir daqui em diante (histórico preservado)', () => {
  const d = fixture(), B = d.items[1];
  const ops = E.planEdit(d, B, '2026-06', 80000, 'adiante');
  assert.deepEqual(ops.item, { recurring: true, start_month: '2026-06-01' });
  const d2 = apply(d, 'b', ops);
  assert.equal(val(d2, 'b', '2026-02'), 50050);     // lançamento antigo preservado
  assert.equal(val(d2, 'b', '2026-05'), 0);
  assert.equal(val(d2, 'b', '2026-06'), 80000);
  assert.equal(val(d2, 'b', '2027-06'), 80000);
  assert.throws(() => E.planEdit(d, B, '2026-06', -5, 'adiante'));
});

test('item que não repete: digitar zero apaga o lançamento do mês', () => {
  const d = fixture(), B = d.items[1];
  const ops = E.planEdit(d, B, '2026-02', 0, 'mes');
  assert.deepEqual(ops.deleteEntries, ['2026-02-01']);
  assert.equal(val(apply(d, 'b', ops), 'b', '2026-02'), 0);
});

test('parcelamento: o total fecha ao centavo', () => {
  assert.deepEqual(E.splitInstallments(100000, 3), { per: 33333, first: 33334 });
  assert.deepEqual(E.splitInstallments(90000, 3), { per: 30000, first: 30000 });
  for (const [t, n] of [[99999, 7], [1, 3], [123456789, 12]]) {
    const s = E.splitInstallments(t, n);
    assert.equal(s.first + s.per * (n - 1), t);
  }
});

test('simulação: compra parcelada altera o saldo só no cenário, e some depois das parcelas', () => {
  const d = fixture(), base = E.buildIndex(d);
  const tlBase = E.timeline(base, d.settings, '2026-01', 24);
  const sp = { kind: 'saida', name: 'Fogão', start: '2026-09', n: 10, perCents: 15000 };
  const sim = E.buildIndex(E.withSims(d, [sp]));
  const tlSim = E.timeline(sim, d.settings, '2026-01', 24);
  assert.equal(tlSim[7].saldo, tlBase[7].saldo);                         // ago: ainda igual
  assert.equal(tlBase[8].saldo - tlSim[8].saldo, 15000);                 // set: 1ª parcela
  assert.equal(tlBase[17].saldo - tlSim[17].saldo, 150000);              // jun/27: 10 parcelas pagas
  assert.equal(tlBase[23].saldo - tlSim[23].saldo, 150000);              // depois disso a diferença para de crescer
  assert.equal(E.monthView(sim, '2026-09').saidas.some(l => l.item.sim), false); // não aparece na tela do mês
});

test('simulação: à vista, renda mensal sem fim e total com resto', () => {
  const { item, rates } = E.expandSpec({ kind: 'saida', name: 'TV', start: '2026-11', n: 1, perCents: 200000 });
  assert.equal(item.end_month, '2026-11-01');
  assert.equal(item.type, 'outro');
  assert.equal(rates.length, 1);
  const r = E.expandSpec({ kind: 'entrada', name: 'Extra', start: '2027-01', n: null, perCents: 50000 });
  assert.equal(r.item.end_month, null);
  assert.equal(r.item.type, 'renda');
  const s = E.splitInstallments(100000, 3);
  const p = E.expandSpec({ kind: 'saida', name: 'Sofá', start: '2026-05', n: 3, perCents: s.per, firstCents: s.first });
  assert.deepEqual(p.rates.map(x => [x.from_month, x.amount]), [['2026-05-01', 333.34], ['2026-06-01', 333.33]]);
  const idx = E.buildIndex({ items: [p.item], rates: p.rates, entries: [] });
  const total = ['2026-05', '2026-06', '2026-07', '2026-08'].reduce((acc, m) => acc + E.amountAt(idx, p.item, E.mi(m)).cents, 0);
  assert.equal(total, 100000);
});

// ── cenários e formas de pagar (dados simples: +R$ 1.000 por mês) ───────────
function simples() {
  return {
    data: {
      items: [
        { id: 's', kind: 'entrada', type: 'renda', name: 'Renda', recurring: true, start_month: '2026-01-01', end_month: null, active: true },
        { id: 'g', kind: 'saida', type: 'conta', name: 'Gasto', recurring: true, start_month: '2026-01-01', end_month: null, active: true }
      ],
      rates: [{ item_id: 's', from_month: '2026-01-01', amount: 3000 }, { item_id: 'g', from_month: '2026-01-01', amount: 2000 }],
      entries: []
    },
    settings: { balance_start_month: '2026-01-01', opening_balance: 0, min_balance: 1000 }
  };
}

test('à vista: primeiro mês em que cabe mantendo o mínimo', () => {
  const { data, settings } = simples();
  const r = E.cashFitMonth(data, settings, 250000, '2026-01', 12, 6);
  assert.equal(r.month, '2026-04');            // saldo de abr = 4.000 -> 4.000 - 2.500 = 1.500 >= 1.000
  assert.equal(r.minAfter, 150000);
  assert.equal(E.cashFitMonth(data, settings, 250000, '2026-01', 2, 6), null);  // não cabe nos 2 primeiros meses
  assert.equal(E.cashFitMonth(data, settings, 100000, '2026-01', 12, 6).month, '2026-02'); // 2.000 - 1.000 = 1.000 (igual ao mínimo cabe)
});

test('formas de pagar: parcelar muda o veredito', () => {
  const { data, settings } = simples();
  const w = E.waysToPay(data, settings, { totalCents: 600000, start: '2026-02', options: [1, 3, 6, 12], horizon: 24 });
  assert.deepEqual(w.map(x => x.n), [1, 3, 6, 12]);
  assert.deepEqual(w.map(x => x.fits), [false, false, true, true]);
  assert.equal(w[0].status, 'neg');
  assert.equal(w[2].per, 100000);
  assert.equal(w[2].min, 100000);              // menor saldo = exatamente o mínimo
  assert.equal(w[3].per, 50000);
});

test('cenário: sem e com simulação, resumos e mínimo', () => {
  const { data, settings } = simples();
  const sp = { kind: 'saida', name: 'Fogão', start: '2026-03', n: 1, perCents: 150000 };
  const sc = E.scenario(data, settings, [sp], '2026-01', 6);
  assert.equal(sc.minCents, 100000);
  assert.deepEqual(sc.base.map(x => x.saldo), [100000, 200000, 300000, 400000, 500000, 600000]);
  assert.deepEqual(sc.sim.map(x => x.saldo), [100000, 200000, 150000, 250000, 350000, 450000]);
  assert.equal(sc.baseSummary.min, 100000);
  assert.equal(sc.simSummary.min, 100000);
  assert.equal(sc.simSummary.firstNeg, null);
  const sc2 = E.scenario(data, settings, [], '2026-01', 3);
  assert.equal(sc2.sim, sc2.base);              // sem simulação, os dois são o mesmo
  const sc3 = E.scenario(data, settings, [{ kind: 'saida', name: 'Carro', start: '2026-02', n: 1, perCents: 500000 }], '2026-01', 4);
  assert.equal(sc3.simSummary.firstNeg, '2026-02');
});

// ── pago / recebido ────────────────────────────────────────────────────────
// aplica nas marcas o que planEdit/planSettle pediram (só para testar o efeito final)
function applyMarks(data, itemId, ops) {
  let s = (data.settled || []).slice();
  (ops.deleteSettled || []).forEach(mo => { s = s.filter(x => !(x.item_id === itemId && x.month === mo)); });
  (ops.addSettled || []).forEach(mo => { if (!s.some(x => x.item_id === itemId && x.month === mo)) s.push({ item_id: itemId, month: mo }); });
  return Object.assign({}, data, { settled: s });
}
// valores (apply) + marcas (applyMarks), sem perder as configurações nem as marcas que não mudaram
function applyAll(data, itemId, ops) {
  return Object.assign(apply(data, itemId, ops), { settings: data.settings, settled: applyMarks(data, itemId, ops).settled });
}
const marked = (d, id, m) => E.isSettled(E.buildIndex(d), d.items.find(i => i.id === id), E.mi(m));

test('marcas: dados antigos (sem a lista) continuam funcionando e nada vem marcado', () => {
  const d = fixture();                                   // sem "settled", como a cópia local de antes da 1.2
  const idx = E.buildIndex(d), v = E.monthView(idx, '2026-03');
  assert.equal(idx.settled.size, 0);
  assert.ok(v.saidas.concat(v.entradas).every(l => l.settled === false));
  assert.deepEqual(v.baixa.saidas, { n: 2, feitas: 0, feito: 0, falta: 133334 });
  assert.deepEqual(v.baixa.entradas, { n: 1, feitas: 0, feito: 0, falta: 300000 });
});

test('marcas: só valem para o item e o mês marcados; data com dia/mês em formato do banco', () => {
  const d = Object.assign(fixture(), { settled: [{ item_id: 'a', month: '2026-03-01' }] });
  assert.equal(marked(d, 'a', '2026-03'), true);
  assert.equal(marked(d, 'a', '2026-04'), false);        // outro mês
  assert.equal(marked(d, 'c', '2026-03'), false);        // outro item
  assert.equal(marked(d, 'a', '2027-03'), false);        // outro ano
});

test('marcas: visão do mês separa o que falta, sem mudar totais nem saldo', () => {
  const base = fixture();
  const d = Object.assign(fixture(), { settled: [{ item_id: 'a', month: '2026-03-01' }, { item_id: 'c', month: '2026-03-01' }] });
  const v = E.monthView(E.buildIndex(d), '2026-03'), v0 = E.monthView(E.buildIndex(base), '2026-03');
  assert.deepEqual(v.saidas.map(l => [l.item.name, l.settled]), [['Aluguel', true], ['TV', false]]);
  assert.deepEqual(v.baixa.saidas, { n: 2, feitas: 1, feito: 100000, falta: 33334 });
  assert.deepEqual(v.baixa.entradas, { n: 1, feitas: 1, feito: 300000, falta: 0 });
  // marcar é só status: totais e resultado do mês são os mesmos
  assert.equal(v.totalSaidas, v0.totalSaidas);
  assert.equal(v.totalEntradas, v0.totalEntradas);
  assert.equal(v.resultado, v0.resultado);
  assert.deepEqual(E.timeline(E.buildIndex(d), d.settings, '2026-01', 24), E.timeline(E.buildIndex(base), base.settings, '2026-01', 24));
});

test('marcas: linha sem valor não conta como marcada, mesmo com marca esquecida no banco', () => {
  // "Cartão X" não tem valor em março; a marca esquecida de lá não pode aparecer nem inflar a contagem
  const d = Object.assign(fixture(), { settled: [{ item_id: 'b', month: '2026-03-01' }, { item_id: 'a', month: '2025-12-01' }] });
  const v = E.monthView(E.buildIndex(d), '2026-03');
  assert.deepEqual(v.baixa.saidas, { n: 2, feitas: 0, feito: 0, falta: 133334 });
  assert.deepEqual(v.vazias.saidas.map(l => [l.item.name, l.settled]), [['Cartão X', false]]);
  assert.equal(E.monthView(E.buildIndex(d), '2025-12').baixa.saidas.n, 0);
});

test('marcas: planSettle só pede o que muda (e nunca mexe em valores)', () => {
  const d = Object.assign(fixture(), { settled: [{ item_id: 'a', month: '2026-03-01' }] }), A = d.items[0], C = d.items[2];
  let ops = E.planSettle(d, C, '2026-03', true);                         // marcar o que não está marcado
  assert.deepEqual(ops.addSettled, ['2026-03-01']);
  assert.deepEqual(ops.deleteSettled, []);
  ops = E.planSettle(d, A, '2026-03', false);                            // desmarcar o que está marcado
  assert.deepEqual(ops.deleteSettled, ['2026-03-01']);
  assert.deepEqual(ops.addSettled, []);
  for (const o of [E.planSettle(d, A, '2026-03', true), E.planSettle(d, C, '2026-03', false)]) { // já está como se pede
    assert.deepEqual(o.addSettled, []); assert.deepEqual(o.deleteSettled, []);
  }
  ops = E.planSettle(d, C, '2026-03', true);
  assert.deepEqual([ops.item, ops.upsertRates, ops.deleteRates, ops.upsertEntries, ops.deleteEntries, ops.replaced], [null, [], [], [], [], 0]);
  // chamar duas vezes no mesmo plano não duplica
  E.planSettle(d, C, '2026-03', true, ops);
  assert.deepEqual(ops.addSettled, ['2026-03-01']);
  // dados sem a lista de marcas (banco antigo) também funcionam
  assert.deepEqual(E.planSettle(fixture(), A, '2026-03', true).addSettled, ['2026-03-01']);
});

test('marcas: planSettle soma ao plano de uma edição de valor (salvar valor e marcar de uma vez)', () => {
  const d = fixture(), A = d.items[0];
  const ops = E.planEdit(d, A, '2026-09', 123456, 'mes');
  const same = E.planSettle(d, A, '2026-09', true, ops);
  assert.equal(same, ops);                                               // devolve o mesmo plano
  assert.deepEqual(ops.upsertEntries, [{ month: '2026-09-01', amount: 123456 }]);
  assert.deepEqual(ops.addSettled, ['2026-09-01']);
  const d2 = applyAll(d, 'a', ops);
  assert.equal(val(d2, 'a', '2026-09'), 123456);
  assert.equal(marked(d2, 'a', '2026-09'), true);
});

test('marcas: editar o valor (mês ou daqui em diante) não mexe nas marcas; zerar tira só as que somem', () => {
  const d = Object.assign(fixture(), { settled: [
    { item_id: 'a', month: '2026-03-01' }, { item_id: 'a', month: '2026-05-01' }, { item_id: 'a', month: '2026-08-01' }, { item_id: 'c', month: '2026-05-01' }
  ] }), A = d.items[0];
  // valor diferente de zero: nenhuma marca é removida
  assert.deepEqual(E.planEdit(d, A, '2026-05', 120000, 'mes').deleteSettled, []);
  assert.deepEqual(E.planEdit(d, A, '2026-05', 120000, 'adiante').deleteSettled, []);
  assert.deepEqual(E.planEdit(d, A, '2026-05', 100000, 'mes').deleteSettled, []);   // voltar ao previsto também não
  // zerar só este mês: some a marca deste mês, e só dele
  let ops = E.planEdit(d, A, '2026-05', 0, 'mes');
  assert.deepEqual(ops.deleteSettled, ['2026-05-01']);
  assert.deepEqual(ops.addSettled, []);
  // zerar daqui em diante: somem as marcas deste mês em diante; as de antes e as de outros itens ficam
  ops = E.planEdit(d, A, '2026-05', 0, 'adiante');
  assert.deepEqual(ops.deleteSettled.sort(), ['2026-05-01', '2026-08-01']);
  const d2 = applyAll(d, 'a', ops);
  assert.equal(marked(d2, 'a', '2026-03'), true);
  assert.equal(marked(d2, 'a', '2026-05'), false);
  assert.equal(marked(d2, 'c', '2026-05'), true);
  assert.equal(val(d2, 'a', '2026-08'), 0);
});

test('marcas: zerar e depois dar valor de novo não ressuscita "já pago"', () => {
  let d = Object.assign(fixture(), { settled: [{ item_id: 'a', month: '2026-06-01' }, { item_id: 'a', month: '2026-07-01' }] });
  const A = d.items[0];
  let ops = E.planEdit(d, A, '2026-06', 0, 'adiante');
  d = applyAll(d, 'a', ops);
  assert.equal(val(d, 'a', '2026-07'), 0);
  ops = E.planEdit(d, A, '2026-06', 100000, 'adiante');                  // o aluguel volta
  d = applyAll(d, 'a', ops);
  assert.equal(val(d, 'a', '2026-07'), 100000);
  const v = E.monthView(E.buildIndex(d), '2026-07');
  assert.equal(v.saidas.find(l => l.item.id === 'a').settled, false);    // volta como "a pagar"
});

test('marcas: simulação e cenário ignoram as marcas (só valores contam)', () => {
  const d = Object.assign(fixture(), { settled: [{ item_id: 'a', month: '2026-03-01' }, { item_id: 'c', month: '2026-04-01' }] });
  const sp = { kind: 'saida', name: 'Fogão', start: '2026-03', n: 2, perCents: 150000 };
  const com = E.scenario(d, d.settings, [sp], '2026-01', 6), sem = E.scenario(fixture(), d.settings, [sp], '2026-01', 6);
  assert.deepEqual(com.base, sem.base);
  assert.deepEqual(com.sim, sem.sim);
  assert.deepEqual(E.newOps(), { item: null, upsertRates: [], deleteRates: [], upsertEntries: [], deleteEntries: [], addSettled: [], deleteSettled: [], replaced: 0 });
});
