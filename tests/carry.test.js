// Testes da "conta corrente" (o item que puxa a sobra do mês anterior). Rodar: node --test tests/*.test.js
// Só dados inventados. A regra que importa: o saldo acumulado JÁ carrega a sobra de um mês para o
// outro, então a sobra mostrada na linha do item nunca pode entrar nas entradas nem no resultado do mês
// (entraria duas vezes). Ligar a conta corrente NÃO muda nenhum saldo; só mostra a sobra e deixa corrigir.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../docs/js/engine.js');

// Janeiro é o mês inicial do saldo. A conta corrente começa com R$ 1.000 em janeiro (dinheiro que já estava lá).
//  jan: 1000 + 500 − 200 = +1300 → saldo 1300 | fev: +300 → 1600 | mar: +300 − 900 → 1000
//  abr: +300 → 1300 | mai: +300 + 250 → 1850 | jun: +300 → 2150
function fixture(opts) {
  opts = opts || {};
  return {
    items: [
      { id: 'cc', kind: 'entrada', type: 'renda', name: 'Conta', due_day: null, recurring: false, start_month: null, end_month: null, active: true, carry_over: opts.carry !== false },
      { id: 'sal', kind: 'entrada', type: 'renda', name: 'Salário', due_day: 5, recurring: true, start_month: '2026-01-01', end_month: null, active: true, carry_over: false },
      { id: 'alu', kind: 'saida', type: 'conta', name: 'Aluguel', due_day: 10, recurring: true, start_month: '2026-01-01', end_month: null, active: true, carry_over: false },
      { id: 'car', kind: 'saida', type: 'cartao', name: 'Cartão', due_day: 20, recurring: false, start_month: null, end_month: null, active: true, carry_over: false },
      { id: 'bon', kind: 'entrada', type: 'outro', name: 'Bônus', due_day: null, recurring: false, start_month: null, end_month: null, active: true, carry_over: false }
    ].concat(opts.items || []),
    rates: [
      { item_id: 'sal', from_month: '2026-01-01', amount: 500 },
      { item_id: 'alu', from_month: '2026-01-01', amount: 200 }
    ],
    entries: [
      { item_id: 'cc', month: '2026-01-01', amount: 1000 },
      { item_id: 'car', month: '2026-03-01', amount: 900 },
      { item_id: 'bon', month: '2026-05-01', amount: 250 }
    ].concat(opts.entries || []),
    settled: [],
    settings: { balance_start_month: '2026-01-01', opening_balance: 0, min_balance: 100 }
  };
}
const saldos = (d, from, n) => E.timeline(E.buildIndex(d), d.settings, from, n).map(r => r.saldo);

test('ligar a conta corrente não muda nenhum saldo nem total (nada é contado duas vezes)', () => {
  const on = fixture(), off = fixture({ carry: false });
  assert.deepEqual(E.timeline(E.buildIndex(on), on.settings, '2025-10', 30), E.timeline(E.buildIndex(off), off.settings, '2025-10', 30));
  assert.deepEqual(saldos(on, '2026-01', 6), [130000, 160000, 100000, 130000, 185000, 215000]);   // contas feitas à mão
});

test('mês depois do inicial: a sobra do mês anterior aparece na conta corrente e fica fora das entradas', () => {
  const d = fixture(), idx = E.buildIndex(d), v = E.monthView(idx, '2026-03');
  assert.equal(v.carry.cents, 160000);                                  // o que sobrou de fevereiro
  assert.equal(v.carry.auto, 160000);
  assert.equal(v.carry.prev, '2026-02');
  assert.equal(v.carry.real, false);
  assert.equal(v.carry.item.id, 'cc');
  assert.equal(v.entradas.some(l => l.item.id === 'cc'), false);        // não é entrada do mês
  assert.equal(v.vazias.entradas.some(l => l.item.id === 'cc'), false); // nem "item sem valor"
  assert.equal(v.totalEntradas, 50000);                                 // só o salário
  assert.equal(v.totalSaidas, 110000);                                  // aluguel + cartão
  assert.equal(v.resultado, -60000);
  // a conta fecha: saldo no fim do mês = o que veio + o resultado do mês
  assert.equal(v.carry.cents + v.resultado, 100000);
  assert.equal(E.timeline(idx, d.settings, '2026-03', 1)[0].saldo, 100000);
});

test('mês inicial e meses antes dele: é um item comum (o valor é o dinheiro que já estava na conta)', () => {
  const d = fixture(), idx = E.buildIndex(d), cc = d.items[0], v = E.monthView(idx, '2026-01');
  assert.equal(v.carry, null);
  assert.deepEqual(v.entradas.map(l => l.item.id).sort(), ['cc', 'sal']);
  assert.equal(v.totalEntradas, 150000);
  assert.equal(E.amountAt(idx, cc, E.mi('2026-01')).source, 'real');
  assert.equal(E.carryAt(idx, cc, '2026-01'), null);
  // antes do mês inicial o saldo nem começou, e o item segue comum
  const antes = fixture({ entries: [{ item_id: 'cc', month: '2025-12-01', amount: 77 }] });
  const vi = E.buildIndex(antes), v0 = E.monthView(vi, '2025-12');
  assert.equal(v0.carry, null);
  assert.equal(v0.totalEntradas, 7700);
  assert.equal(E.timeline(vi, antes.settings, '2025-12', 1)[0].saldo, null);
});

test('valor da conta corrente nos meses seguintes: automático (source auto), igual ao saldo do mês anterior', () => {
  const d = fixture(), idx = E.buildIndex(d), cc = d.items[0];
  assert.deepEqual(E.amountAt(idx, cc, E.mi('2026-02')), { cents: 130000, source: 'auto' });
  assert.deepEqual(E.amountAt(idx, cc, E.mi('2026-04')), { cents: 100000, source: 'auto' });
  const c = E.carryAt(idx, cc, '2026-06');
  assert.deepEqual({ cents: c.cents, auto: c.auto, prev: c.prev, real: c.real }, { cents: 185000, auto: 185000, prev: '2026-05', real: false });
  assert.equal(E.carryAt(idx, d.items[1], '2026-06'), null);            // outro item: nada
  // anos à frente: continua encadeando (nada de limite de meses)
  assert.equal(E.carryAt(idx, cc, '2031-01').prev, '2030-12');
  assert.equal(E.carryAt(idx, cc, '2031-01').cents, E.timeline(idx, d.settings, '2030-12', 1)[0].saldo);
});

test('saldo real digitado num mês: vale como saldo no começo do mês e os meses seguintes partem dele', () => {
  const d = fixture({ entries: [{ item_id: 'cc', month: '2026-04-01', amount: 2000 }] }), idx = E.buildIndex(d);
  // abr: o banco diz 2.000 (a previsão era 1.000, o saldo de março) → 2000 + 300 = 2300; mai: +550 = 2850; jun: +300 = 3150
  assert.deepEqual(saldos(d, '2026-01', 6), [130000, 160000, 100000, 230000, 285000, 315000]);
  const v = E.monthView(idx, '2026-04');
  assert.deepEqual({ cents: v.carry.cents, auto: v.carry.auto, real: v.carry.real }, { cents: 200000, auto: 100000, real: true });
  assert.equal(v.carry.cents + v.resultado, 230000);                    // a conta continua fechando
  assert.deepEqual(E.amountAt(idx, d.items[0], E.mi('2026-04')), { cents: 200000, source: 'real' });
  // o mês seguinte já parte do valor corrigido
  assert.equal(E.monthView(idx, '2026-05').carry.cents, 230000);
  assert.equal(E.monthView(idx, '2026-05').carry.real, false);
  // nada antes da correção mudou
  assert.deepEqual(saldos(d, '2026-01', 3), saldos(fixture(), '2026-01', 3));
});

test('saldo real zero ou negativo (conta no vermelho): a sobra negativa passa adiante', () => {
  const neg = fixture({ entries: [{ item_id: 'cc', month: '2026-02-01', amount: -500 }] }), idx = E.buildIndex(neg);
  assert.equal(E.monthView(idx, '2026-02').carry.cents, -50000);
  // fev: −500 + 300 = −200; mar: −200 + 500 − 200 − 900 = −800
  assert.deepEqual(saldos(neg, '2026-01', 3), [130000, -20000, -80000]);
  assert.equal(E.monthView(idx, '2026-03').carry.cents, -20000);        // a sobra de fevereiro é negativa
  assert.equal(E.monthView(idx, '2026-03').carry.real, false);
  const zero = fixture({ entries: [{ item_id: 'cc', month: '2026-02-01', amount: 0 }] });
  assert.equal(E.monthView(E.buildIndex(zero), '2026-02').carry.real, true);   // zero digitado vale: não é "sem valor"
  assert.deepEqual(saldos(zero, '2026-01', 2), [130000, 30000]);
});

test('só um item puxa a sobra, e só se for entrada que não repete e de verdade (não simulação)', () => {
  const d = fixture();
  const base = d.items[0];
  assert.equal(E.isCarryItem(base), true);
  assert.equal(E.isCarryItem(Object.assign({}, base, { recurring: true })), false);
  assert.equal(E.isCarryItem(Object.assign({}, base, { kind: 'saida' })), false);
  assert.equal(E.isCarryItem(Object.assign({}, base, { sim: true })), false);
  assert.equal(E.isCarryItem(Object.assign({}, base, { carry_over: false })), false);
  assert.equal(E.isCarryItem(Object.assign({}, base, { carry_over: undefined })), false);   // cópia antiga, sem a coluna
  // dois ligados (o banco não deixa; se acontecer, vale o primeiro e o outro é comum)
  const dois = fixture({
    items: [{ id: 'cc2', kind: 'entrada', type: 'renda', name: 'Outra', recurring: false, active: true, carry_over: true }],
    entries: [{ item_id: 'cc2', month: '2026-04-01', amount: 100 }]
  });
  const idx = E.buildIndex(dois), v = E.monthView(idx, '2026-04');
  assert.equal(idx.carry.id, 'cc');
  assert.equal(v.carry.item.id, 'cc');
  assert.deepEqual(v.entradas.map(l => l.item.id).sort(), ['cc2', 'sal']);   // a "segunda" soma como entrada comum
  assert.equal(v.totalEntradas, 50000 + 10000);
});

test('conta corrente "parada" (ativo falso) continua puxando a sobra: o saldo real lançado não vira entrada', () => {
  // Se "parado" desligasse a conta corrente, o saldo real lançado em abril (2.000) passaria a somar como entrada
  // e a sobra de março entraria duas vezes no saldo (foi um defeito da primeira versão desta função).
  const mk = (ativo) => { const d = fixture({ entries: [{ item_id: 'cc', month: '2026-04-01', amount: 2000 }] }); d.items[0].active = ativo; return d; };
  const on = mk(true), off = mk(false);
  assert.equal(E.isCarryItem(off.items[0]), true);
  assert.equal(E.isCarry(E.buildIndex(off), off.items[0]), true);
  assert.deepEqual(saldos(off, '2026-01', 6), saldos(on, '2026-01', 6));
  assert.deepEqual(saldos(off, '2026-01', 6), [130000, 160000, 100000, 230000, 285000, 315000]);
  const v = E.monthView(E.buildIndex(off), '2026-04');
  assert.equal(v.carry.cents, 200000);
  assert.equal(v.carry.real, true);
  assert.equal(v.totalEntradas, 50000);                                 // só o salário: o saldo lançado fica fora das entradas
  assert.equal(v.vazias.entradas.some(l => l.item.id === 'cc'), false); // e a conta corrente nunca é sugerida como "sem valor"
  assert.equal(E.monthView(E.buildIndex(off), '2026-03').carry.item.id, 'cc');
  // item parado que NÃO é conta corrente: segue comum (só deixa de ser sugerido nos meses sem valor)
  const comum = fixture({ carry: false }); comum.items[0].active = false;
  assert.equal(E.monthView(E.buildIndex(comum), '2026-03').carry, null);
  assert.equal(E.monthView(E.buildIndex(comum), '2026-03').vazias.entradas.some(l => l.item.id === 'cc'), false);
});

test('simulações: a sobra mostrada já inclui a simulação; o item simulado não aparece no mês', () => {
  const d = fixture(), spec = { kind: 'saida', name: 'Compra', start: '2026-03', n: 1, perCents: 10000 };
  const sc = E.scenario(d, d.settings, [spec], '2026-01', 6);
  assert.deepEqual(sc.base.map(r => r.saldo), [130000, 160000, 100000, 130000, 185000, 215000]);
  assert.deepEqual(sc.sim.map(r => r.saldo), [130000, 160000, 90000, 120000, 175000, 205000]);
  const sw = E.withSims(d, [spec]);
  assert.equal(sw.settings, d.settings);                                // as configurações acompanham os dados
  const idx = E.buildIndex(sw), v = E.monthView(idx, '2026-04');
  assert.equal(v.carry.cents, 90000);                                   // sobra de março, já sem os R$ 100 da compra
  assert.equal(v.carry.cents + v.resultado, 120000);
  assert.equal(v.saidas.some(l => l.item.sim), false);
  // sem a simulação, a sobra de abril é a de sempre
  assert.equal(E.monthView(E.buildIndex(d), '2026-04').carry.cents, 100000);
});

test('índice montado sem configurações, ou usado com outras: refaz o que depende do mês inicial', () => {
  const d = fixture(), semCfg = Object.assign({}, d, { settings: undefined });
  const ref = E.timeline(E.buildIndex(d), d.settings, '2025-12', 12);
  assert.deepEqual(E.timeline(E.buildIndex(semCfg), d.settings, '2025-12', 12), ref);
  // outro mês inicial e outro saldo de abertura, no MESMO índice (o cache não pode misturar)
  const idx = E.buildIndex(d);
  const outras = { balance_start_month: '2026-03-01', opening_balance: 50, min_balance: 100 };
  const d2 = Object.assign({}, d, { settings: outras });
  const a1 = E.timeline(idx, outras, '2026-01', 6), a2 = E.timeline(E.buildIndex(d2), outras, '2026-01', 6);
  assert.deepEqual(a1, a2);
  assert.deepEqual(a1.map(r => r.saldo), [null, null, 50 * 100 + (-60000), -55000 + 30000, -25000 + 55000, 30000 + 30000]);
  assert.deepEqual(E.timeline(idx, d.settings, '2025-12', 12), ref);   // e o original segue igual
});

test('planEdit da conta corrente: depois do mês inicial grava o saldo real, sempre só naquele mês', () => {
  const d = fixture(), cc = d.items[0];
  const ops = E.planEdit(d, cc, '2026-04', 250000, 'mes');
  assert.deepEqual(ops.upsertEntries, [{ month: '2026-04-01', amount: 250000 }]);
  assert.equal(ops.item, null);
  assert.deepEqual([ops.upsertRates, ops.deleteRates, ops.deleteEntries], [[], [], []]);
  // igual à sobra prevista (R$ 1.000,00 em abril): fixa do mesmo jeito (digitar é fixar)
  assert.deepEqual(E.planEdit(d, cc, '2026-04', 100000, 'mes').upsertEntries, [{ month: '2026-04-01', amount: 100000 }]);
  // "daqui em diante" não existe para a conta corrente
  assert.deepEqual(E.planEdit(d, cc, '2026-04', 250000, 'adiante'), ops);
  // conta no vermelho e zero são aceitos
  assert.deepEqual(E.planEdit(d, cc, '2026-04', -5000, 'mes').upsertEntries, [{ month: '2026-04-01', amount: -5000 }]);
  assert.deepEqual(E.planEdit(d, cc, '2026-04', 0, 'mes').upsertEntries, [{ month: '2026-04-01', amount: 0 }]);
  // no mês inicial é um item comum, mas também não repete
  const ini = E.planEdit(d, cc, '2026-01', 120000, 'adiante');
  assert.equal(ini.item, null);
  assert.deepEqual(ini.upsertRates, []);
  assert.deepEqual(ini.upsertEntries, [{ month: '2026-01-01', amount: 120000 }]);
  // um item comum continua como sempre
  const sal = E.planEdit(d, d.items[1], '2026-04', 60000, 'adiante');
  assert.deepEqual(sal.upsertRates, [{ from_month: '2026-04-01', amount: 60000 }]);
});

test('planCarryAuto: voltar ao automático apaga só o saldo real daquele mês', () => {
  const d = fixture({ entries: [{ item_id: 'cc', month: '2026-04-01', amount: 2000 }] }), cc = d.items[0];
  assert.deepEqual(E.planCarryAuto(d, cc, '2026-04').deleteEntries, ['2026-04-01']);
  assert.deepEqual(E.planCarryAuto(d, cc, '2026-05').deleteEntries, []);   // nada lançado em maio
  const voltou = Object.assign({}, d, { entries: d.entries.filter(e => !(e.item_id === 'cc' && e.month === '2026-04-01')) });
  assert.deepEqual(saldos(voltou, '2026-01', 6), saldos(fixture(), '2026-01', 6));
});

test('planCarry: ligar avisa quantos valores viram saldo real; desligar apaga só os posteriores ao mês inicial', () => {
  const d = fixture({ carry: false, entries: [{ item_id: 'cc', month: '2026-02-01', amount: 10 }, { item_id: 'cc', month: '2026-03-01', amount: 20 }] });
  const cc = d.items[0];
  const on = E.planCarry(d, cc, true);
  assert.deepEqual(on.item, { carry_over: true });
  assert.equal(on.afetados, 2);                                          // fev e mar (o de jan é o dinheiro de abertura)
  assert.deepEqual(on.deleteEntries, []);
  const off = E.planCarry(d, cc, false);
  assert.deepEqual(off.item, { carry_over: false });
  assert.deepEqual(off.deleteEntries.sort(), ['2026-02-01', '2026-03-01']);
  const limpo = E.planCarry(fixture({ carry: false }), fixture().items[0], false);
  assert.deepEqual(limpo.deleteEntries, []);
  assert.equal(limpo.afetados, 0);
});

// Sorteio com semente (sempre igual): muitas combinações de itens, mês inicial, saldo de abertura e correções
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
const money = r => Math.round(r() * 500000) / 100;
function randomData(seed, withOverrides) {
  const r = lcg(seed), months = n => E.addMonths('2026-01', n) + '-01';
  const startN = Math.floor(r() * 3), items = [], rates = [], entries = [];
  items.push({ id: 'cc', kind: 'entrada', type: 'renda', name: 'cc', recurring: false, active: true, carry_over: true });
  entries.push({ item_id: 'cc', month: months(startN), amount: money(r) });
  for (let k = 0; k < 3; k++) {
    const id = 's' + k, from = Math.floor(r() * 4);
    items.push({ id, kind: 'saida', type: 'conta', name: id, recurring: true, start_month: months(from), end_month: r() < 0.3 ? months(from + 3 + Math.floor(r() * 8)) : null, active: true });
    rates.push({ item_id: id, from_month: months(from), amount: money(r) / 4 });
  }
  for (let k = 0; k < 2; k++) {
    const id = 'e' + k;
    items.push({ id, kind: 'entrada', type: 'renda', name: id, recurring: true, start_month: months(0), end_month: null, active: true });
    rates.push({ item_id: id, from_month: months(0), amount: money(r) / 3 });
  }
  for (let k = 0; k < 4; k++) {                                          // cartão e bônus: lançados só em alguns meses
    const id = 'x' + k;
    items.push({ id, kind: k % 2 ? 'entrada' : 'saida', type: k % 2 ? 'outro' : 'cartao', name: id, recurring: false, active: true });
    for (let m = 0; m < 30; m++) if (r() < 0.3) entries.push({ item_id: id, month: months(m), amount: money(r) / 2 });
  }
  if (withOverrides) for (let m = startN + 1; m < 30; m++) if (r() < 0.15) entries.push({ item_id: 'cc', month: months(m), amount: money(r) - 1500 });
  return { items, rates, entries, settled: [], settings: { balance_start_month: months(startN), opening_balance: money(r) / 10, min_balance: 100 }, startN };
}

test('sorteio: sem correções, ligar a conta corrente nunca muda o saldo (60 combinações)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const on = randomData(seed, false), off = JSON.parse(JSON.stringify(on));
    off.items[0].carry_over = false;
    assert.deepEqual(E.timeline(E.buildIndex(on), on.settings, '2025-11', 40), E.timeline(E.buildIndex(off), off.settings, '2025-11', 40), 'semente ' + seed);
  }
});

test('sorteio: com correções, a conta fecha todo mês e a lista bate com os totais (60 combinações)', () => {
  for (let seed = 101; seed <= 160; seed++) {
    const d = randomData(seed, true), idx = E.buildIndex(d), start = E.mi(d.settings.balance_start_month);
    const tl = E.timeline(idx, d.settings, E.ms(start), 32);
    for (let k = 1; k < tl.length; k++) {
      const m = tl[k].month, v = E.monthView(idx, m), why = 'semente ' + seed + ' mês ' + m;
      assert.ok(v.carry, why);
      assert.equal(v.carry.cents + v.resultado, tl[k].saldo, why + ': saldo = sobra + resultado');
      const lancado = d.entries.find(e => e.item_id === 'cc' && E.mi(e.month) === E.mi(m));
      if (lancado) assert.deepEqual([v.carry.cents, v.carry.real], [E.cents(lancado.amount), true], why);
      else assert.deepEqual([v.carry.cents, v.carry.real], [tl[k - 1].saldo, false], why + ': sobra = saldo do mês anterior');
      assert.equal(v.entradas.reduce((s, l) => s + l.cents, 0), v.totalEntradas, why + ': entradas');
      assert.equal(v.saidas.reduce((s, l) => s + l.cents, 0), v.totalSaidas, why + ': saídas');
      assert.equal(v.totalEntradas - v.totalSaidas, v.resultado, why);
    }
  }
});
