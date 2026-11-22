// Testes do "saldo real da conta": o saldo que a 99Pay informou vira o ponto de partida do mês atual, e a sobra prevista
// é  saldo lido + o que ainda falta receber − o que ainda falta pagar.  Rodar: node --test tests/*.test.js
// Só dados inventados (nada de valores reais do orçamento de ninguém).
//
// O que estes testes garantem:
//   • sem leitura (ou com leitura inválida) as contas são exatamente as de sempre;
//   • no mês da leitura o saldo lido manda e o que já foi pago/recebido (até a hora da leitura) não conta de novo;
//   • marcar "pago" ANTES de o banco atualizar não faz a sobra pular (a marca só vale depois que a leitura a alcança);
//   • o valor digitado na conta corrente nesse mês é ignorado enquanto houver leitura, e volta a valer sem ela;
//   • os meses seguintes partem do saldo previsto, e simulações/compras enxergam o mesmo saldo.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../docs/js/engine.js');

// ── dados inventados ────────────────────────────────────────────────────
// Janeiro de 2026 é o mês inicial do saldo. Valores em reais no banco (como no Supabase); aqui, os resultados em centavos.
//   cc  = conta corrente (guarda o dinheiro da conta; começa com 1.000 em janeiro)
//   sal = salário 500/mês | alu = aluguel 200/mês | luz = luz 80/mês | car = cartão 900 (só em março) | bon = bônus 250 (só em maio)
// Contas feitas à mão, sem leitura (classico):
//   jan: 1000 + 500 − 200 − 80 = +1220  → saldo 1220      fev: +500 − 280 = +220 → 1440
//   mar: +500 − (200 + 80 + 900) = −680 → 760             abr: +220 → 980
//   mai: +500 + 250 − 280 = +470 → 1450                   jun: +220 → 1670
const CLASSICO = [122000, 144000, 76000, 98000, 145000, 167000];

const LEITURA = { month: '2026-03', cents: 100000, asOf: '2026-03-15T12:00:00+00:00' };   // R$ 1.000 lidos em 15/03 às 12h (UTC)

function fixture(opts) {
  opts = opts || {};
  const d = {
    items: [
      { id: 'cc', kind: 'entrada', type: 'renda', name: 'Conta', due_day: null, recurring: false, start_month: null, end_month: null, active: true, carry_over: opts.carry !== false },
      { id: 'sal', kind: 'entrada', type: 'renda', name: 'Salário', due_day: 5, recurring: true, start_month: '2026-01-01', end_month: null, active: true, carry_over: false },
      { id: 'alu', kind: 'saida', type: 'conta', name: 'Aluguel', due_day: 10, recurring: true, start_month: '2026-01-01', end_month: null, active: true, carry_over: false },
      { id: 'luz', kind: 'saida', type: 'conta', name: 'Luz', due_day: 15, recurring: true, start_month: '2026-01-01', end_month: null, active: true, carry_over: false },
      { id: 'car', kind: 'saida', type: 'cartao', name: 'Cartão', due_day: 20, recurring: false, start_month: null, end_month: null, active: true, carry_over: false },
      { id: 'bon', kind: 'entrada', type: 'outro', name: 'Bônus', due_day: null, recurring: false, start_month: null, end_month: null, active: true, carry_over: false }
    ],
    rates: [
      { item_id: 'sal', from_month: '2026-01-01', amount: 500 },
      { item_id: 'alu', from_month: '2026-01-01', amount: 200 },
      { item_id: 'luz', from_month: '2026-01-01', amount: 80 }
    ],
    entries: [
      { item_id: 'cc', month: '2026-01-01', amount: 1000 },
      { item_id: 'car', month: '2026-03-01', amount: 900 },
      { item_id: 'bon', month: '2026-05-01', amount: 250 }
    ].concat(opts.entries || []),
    settled: opts.settled || [],
    settings: { balance_start_month: '2026-01-01', opening_balance: 0, min_balance: 100 }
  };
  if (opts.live !== undefined) d.saldoReal = opts.live;
  return d;
}
const tick = (item, month, at) => (at === undefined ? { item_id: item, month: month + '-01' } : { item_id: item, month: month + '-01', settled_at: at });
const saldos = (d, from, n) => E.timeline(E.buildIndex(d), d.settings, from, n).map(r => r.saldo);
const view = (d, month) => E.monthView(E.buildIndex(d), month);

// ── sem leitura: nada muda ──────────────────────────────────────────────
test('sem leitura da 99Pay: as contas são as de sempre (mesmo com horas nas marcas)', () => {
  const d = fixture({ settled: [tick('sal', '2026-03', '2026-03-05T10:00:00+00:00'), tick('alu', '2026-03', null)] });
  assert.deepEqual(saldos(d, '2026-01', 6), CLASSICO);
  const v = view(d, '2026-03');
  assert.equal(v.live, null);
  assert.equal(v.carry.live, undefined);
  assert.deepEqual({ cents: v.carry.cents, auto: v.carry.auto, real: v.carry.real }, { cents: 144000, auto: 144000, real: false });
  assert.equal(v.resultado, -68000);
  assert.equal(E.isLive(E.buildIndex(d), '2026-03'), false);
  assert.equal(E.liveOf(E.buildIndex(d)), null);
  // as marcas continuam sendo só status: os totais não mudam
  assert.deepEqual(saldos(fixture(), '2026-01', 6), CLASSICO);
});

test('leitura inválida é como não ter leitura (mês, centavos ou hora ilegíveis)', () => {
  const base = fixture({ settled: [tick('sal', '2026-03', '2026-03-05T10:00:00+00:00')] });
  const ref = JSON.stringify([E.timeline(E.buildIndex(base), base.settings, '2026-01', 8), E.monthView(E.buildIndex(base), '2026-03')]);
  const invalidas = [
    null, {}, 'x', 5,
    { month: '2026-3', cents: 100000, asOf: LEITURA.asOf },
    { month: 202603, cents: 100000, asOf: LEITURA.asOf },
    { month: '2026-03', cents: 1000.5, asOf: LEITURA.asOf },
    { month: '2026-03', cents: '100000', asOf: LEITURA.asOf },
    { month: '2026-03', cents: NaN, asOf: LEITURA.asOf },
    { month: '2026-03', cents: Infinity, asOf: LEITURA.asOf },
    { month: '2026-03', cents: 100000 },
    { month: '2026-03', cents: 100000, asOf: null },
    { month: '2026-03', cents: 100000, asOf: 'ontem à tarde' },
    { month: '2026-03', cents: 100000, asOf: '' }
  ];
  invalidas.forEach(function (live) {
    const d = fixture({ settled: base.settled, live: live });
    const got = JSON.stringify([E.timeline(E.buildIndex(d), d.settings, '2026-01', 8), E.monthView(E.buildIndex(d), '2026-03')]);
    assert.equal(got, ref, 'leitura inválida mudou as contas: ' + JSON.stringify(live));
  });
});

test('a leitura não vale sem conta corrente definida, sem mês inicial do saldo ou antes dele', () => {
  const sem = fixture({ carry: false, live: LEITURA });
  assert.deepEqual(saldos(sem, '2026-01', 6), saldos(fixture({ carry: false }), '2026-01', 6));
  assert.equal(E.liveOf(E.buildIndex(sem)), null);
  assert.equal(view(sem, '2026-03').live, null);

  const semInicio = fixture({ live: LEITURA });
  delete semInicio.settings;
  assert.equal(E.liveOf(E.buildIndex(semInicio)), null);

  const antes = fixture({ live: { month: '2025-12', cents: 99900, asOf: '2025-12-20T12:00:00+00:00' } });
  assert.equal(E.liveOf(E.buildIndex(antes)), null);
  assert.deepEqual(saldos(antes, '2026-01', 6), CLASSICO);
});

// ── o mês da leitura ────────────────────────────────────────────────────
test('mês da leitura: sobra = saldo lido + o que falta receber − o que falta pagar (sem nenhuma marca)', () => {
  const d = fixture({ live: LEITURA }), idx = E.buildIndex(d), v = E.monthView(idx, '2026-03');
  assert.equal(E.isLive(idx, '2026-03'), true);
  assert.deepEqual(E.liveOf(idx), { month: '2026-03', cents: 100000, asOf: Date.parse(LEITURA.asOf) });
  // faltam: salário 500 a receber; aluguel 200 + luz 80 + cartão 900 a pagar
  assert.deepEqual(v.live, {
    cents: 100000, asOf: Date.parse(LEITURA.asOf),
    receber: 50000, pagar: 118000, nReceber: 1, nPagar: 3,
    sobra: 32000,                                                       // 1000 + 500 − 1180
    feito: { entradas: 0, saidas: 0, nEntradas: 0, nSaidas: 0 },
    tarde: { entradas: 0, saidas: 0, nEntradas: 0, nSaidas: 0 }
  });
  // a conta corrente mostra o saldo lido e fica fora das linhas e dos totais
  assert.deepEqual({ cents: v.carry.cents, auto: v.carry.auto, prev: v.carry.prev, real: v.carry.real, live: v.carry.live },
    { cents: 100000, auto: 144000, prev: '2026-02', real: false, live: true });
  assert.equal(v.entradas.some(l => l.item.id === 'cc'), false);
  assert.equal(v.vazias.entradas.some(l => l.item.id === 'cc'), false);
  assert.equal(v.totalEntradas, 50000);
  assert.equal(v.totalSaidas, 118000);
  // saldo do mês na linha do tempo = a sobra prevista; os meses seguintes partem dela; os anteriores não mudam
  assert.deepEqual(saldos(d, '2026-01', 6), [122000, 144000, 32000, 54000, 101000, 123000]);
});

test('marcas feitas até a hora da leitura já estão no saldo; as feitas depois ainda faltam', () => {
  const asOf = LEITURA.asOf;                                            // 15/03 12:00:00
  const d = fixture({
    live: LEITURA,
    settled: [
      tick('sal', '2026-03', '2026-03-05T10:00:00+00:00'),              // antes da leitura: já está no saldo
      tick('alu', '2026-03', asOf),                                     // na hora exata: já está
      tick('luz', '2026-03', '2026-03-15T12:00:01+00:00'),              // 1 segundo depois: ainda não
      tick('car', '2026-03')                                            // marca antiga, sem hora: conta como já refletida
    ]
  });
  const v = view(d, '2026-03');
  assert.deepEqual(v.live, {
    cents: 100000, asOf: Date.parse(asOf),
    receber: 0, pagar: 8000, nReceber: 0, nPagar: 1,
    sobra: 92000,                                                       // 1000 − 80 (só a luz falta)
    feito: { entradas: 50000, saidas: 110000, nEntradas: 1, nSaidas: 2 },
    tarde: { entradas: 0, saidas: 8000, nEntradas: 0, nSaidas: 1 }
  });
  // o que já está no saldo + o que falta = os totais do mês (nada some, nada conta duas vezes)
  assert.equal(v.live.feito.entradas + v.live.receber, v.totalEntradas);
  assert.equal(v.live.feito.saidas + v.live.pagar, v.totalSaidas);
  assert.equal(saldos(d, '2026-03', 1)[0], 92000);
});

test('marcas de outros meses não mexem no mês da leitura', () => {
  const sem = fixture({ live: LEITURA });
  const com = fixture({ live: LEITURA, settled: [tick('sal', '2026-02', '2026-02-05T10:00:00+00:00'), tick('alu', '2026-04', '2026-03-01T00:00:00+00:00')] });
  assert.deepEqual(saldos(com, '2026-01', 6), saldos(sem, '2026-01', 6));
  assert.deepEqual(view(com, '2026-03').live, view(sem, '2026-03').live);
});

test('marcar "pago" antes de o banco atualizar não faz a sobra pular; a leitura seguinte também não', () => {
  // 1) 15/03 12h: o banco informa R$ 1.000. Ainda falta tudo.
  const d1 = fixture({ live: LEITURA });
  assert.equal(view(d1, '2026-03').live.sobra, 32000);
  // 2) 16/03 08h: o cartão (900) é pago e marcado. O banco ainda não leu de novo: o saldo lido é o mesmo, então a sobra não pode mudar.
  const d2 = fixture({ live: LEITURA, settled: [tick('car', '2026-03', '2026-03-16T08:00:00+00:00')] });
  const v2 = view(d2, '2026-03');
  assert.equal(v2.live.sobra, 32000);
  assert.deepEqual(v2.live.tarde, { entradas: 0, saidas: 90000, nEntradas: 0, nSaidas: 1 });
  assert.equal(v2.live.pagar, 118000);                                  // o cartão ainda conta como "a pagar" até a leitura alcançar a marca
  // 3) 17/03 12h: o banco informa R$ 100 (1000 − 900). A marca já está dentro da leitura: a sobra continua a mesma.
  const d3 = fixture({ live: { month: '2026-03', cents: 10000, asOf: '2026-03-17T12:00:00+00:00' }, settled: d2.settled });
  const v3 = view(d3, '2026-03');
  assert.equal(v3.live.sobra, 32000);
  assert.deepEqual(v3.live.tarde, { entradas: 0, saidas: 0, nEntradas: 0, nSaidas: 0 });
  assert.equal(v3.live.pagar, 28000);                                   // aluguel + luz
  assert.equal(v3.live.feito.saidas, 90000);
});

test('juros e cashback do banco entram no saldo lido: a sobra acompanha sem digitar nada', () => {
  // o banco somou R$ 0,35 de rendimento no dia: o saldo lido é 1000,35 e a sobra sobe os mesmos 35 centavos
  const a = view(fixture({ live: LEITURA }), '2026-03').live.sobra;
  const b = view(fixture({ live: { month: '2026-03', cents: 100035, asOf: LEITURA.asOf } }), '2026-03').live.sobra;
  assert.equal(b - a, 35);
});

test('o saldo digitado na conta corrente é ignorado no mês da leitura; sem a leitura ele volta a valer', () => {
  const digitado = [{ item_id: 'cc', month: '2026-03-01', amount: 1500 }];   // "saldo real" digitado no começo de março
  const sem = fixture({ entries: digitado });
  assert.deepEqual(saldos(sem, '2026-03', 2), [82000, 104000]);              // 1500 − 680 = 820; abril +220
  const com = fixture({ entries: digitado, live: LEITURA });
  assert.deepEqual(saldos(com, '2026-03', 2), [32000, 54000]);               // o saldo lido manda
  const v = view(com, '2026-03');
  assert.equal(v.carry.cents, 100000);
  assert.equal(v.carry.real, false);
  assert.equal(v.carry.live, true);
  // o valor digitado continua guardado (não foi apagado): sem a leitura, tudo volta ao que era
  assert.equal(com.entries.some(e => e.item_id === 'cc' && e.month === '2026-03-01' && e.amount === 1500), true);
});

test('um saldo real digitado depois do mês da leitura recomeça a conta (como sempre)', () => {
  const d = fixture({ live: LEITURA, entries: [{ item_id: 'cc', month: '2026-04-01', amount: 2000 }] });
  assert.deepEqual(saldos(d, '2026-03', 3), [32000, 222000, 269000]);        // abr: 2000 + 220 | mai: + 470
});

test('o mês depois da leitura: a conta corrente mostra a sobra prevista, sem modo "ao vivo"', () => {
  const d = fixture({ live: LEITURA }), v = view(d, '2026-04');
  assert.equal(v.live, null);
  assert.deepEqual({ cents: v.carry.cents, auto: v.carry.auto, prev: v.carry.prev, real: v.carry.real, live: v.carry.live },
    { cents: 32000, auto: 32000, prev: '2026-03', real: false, live: undefined });
  assert.equal(v.resultado, 22000);
  assert.equal(E.isLive(E.buildIndex(d), '2026-04'), false);
});

test('leitura no mês inicial: o item da conta corrente sai das somas e o saldo lido vira o ponto de partida', () => {
  const live = { month: '2026-01', cents: 130000, asOf: '2026-01-20T12:00:00+00:00' };
  const d = fixture({ live }), v = view(d, '2026-01');
  assert.equal(v.carry.live, true);
  assert.equal(v.carry.auto, null);                                       // não há mês anterior no saldo
  assert.equal(v.entradas.some(l => l.item.id === 'cc'), false);
  assert.equal(v.totalEntradas, 50000);                                   // o 1.000 do item não conta: o saldo lido já o inclui
  assert.equal(v.live.sobra, 152000);                                     // 1300 + 500 − 280
  assert.deepEqual(saldos(d, '2026-01', 3), [152000, 174000, 106000]);    // fev +220 → 1740; mar −680 → 1060
});

// ── simulações, cenários e compras enxergam o mesmo saldo ───────────────
test('simulações e cenários partem do saldo previsto do mês da leitura', () => {
  const d = fixture({ live: LEITURA });
  assert.deepEqual(E.withSims(d, []).saldoReal, LEITURA);
  const spec = { kind: 'saida', name: 'tênis', start: '2026-03', n: 1, perCents: 10000 };
  const sc = E.scenario(d, d.settings, [spec], '2026-03', 3);
  assert.deepEqual(sc.base.map(r => r.saldo), [32000, 54000, 101000]);
  assert.deepEqual(sc.sim.map(r => r.saldo), [22000, 44000, 91000]);
  // a compra de R$ 100 não aparece nas linhas do mês
  assert.equal(E.monthView(E.buildIndex(E.withSims(d, [spec])), '2026-03').entradas.length, 1);
  assert.equal(E.monthView(E.buildIndex(E.withSims(d, [spec])), '2026-03').saidas.length, 3);
});

test('formas de pagar e compras planejadas usam o saldo previsto (e não o da planilha antiga)', () => {
  const live = fixture({ live: LEITURA }), classico = fixture();
  // R$ 300 à vista em março: sobra 320 − 300 = 20 (< mínimo de 100) com a leitura; sem ela, 760 − 300 = 460
  const wl = E.waysToPay(live, live.settings, { totalCents: 30000, start: '2026-03', options: [1], horizon: 6 })[0];
  const wc = E.waysToPay(classico, classico.settings, { totalCents: 30000, start: '2026-03', options: [1], horizon: 6 })[0];
  assert.deepEqual({ min: wl.min, minMonth: wl.minMonth, fits: wl.fits }, { min: 2000, minMonth: '2026-03', fits: false });
  assert.deepEqual({ min: wc.min, fits: wc.fits }, { min: 46000, fits: true });

  const compra = { id: 'p1', name: 'Geladeira', priority: 3, status: 'planejado', est_amount: 300, final_amount: null, exec_month: null, inst_total: null, inst_count: null, seq: 1 };
  const rl = E.evaluatePurchases(live, live.settings, [compra], { today: '2026-03' });
  const rc = E.evaluatePurchases(classico, classico.settings, [compra], { today: '2026-03' });
  assert.equal(rl.saldoToday, 32000);
  assert.equal(rc.saldoToday, 76000);
  assert.equal(rl.items[0].how, 'aguardar');
  assert.equal(rl.items[0].wait.month, '2026-04');                        // abril: 540 − 300 ≥ 100
  assert.equal(rc.items[0].how, 'avista');

  // parcelada em 3 (com a leitura): as parcelas também partem do saldo previsto
  const parc = Object.assign({}, compra, { inst_count: 3, inst_total: 300 });
  const ri = E.evaluatePurchases(live, live.settings, [parc], { today: '2026-03' }).items[0];
  assert.equal(ri.inst.per, 10000);
  assert.equal(ri.inst.min, 22000);                                       // março: 320 − 100 = 220
  assert.equal(ri.inst.fits, true);
  assert.equal(ri.how, 'parcelado');
});

test('o saldo lido recomeça a conta para quem olha de antes dele (como um saldo real digitado)', () => {
  // gastar R$ 1.000 em fevereiro: sem leitura, o saldo de março cai junto; com ela, o saldo de março é o lido e não muda
  const live = fixture({ live: LEITURA }), classico = fixture();
  const a = E.cashFitMonth(classico, classico.settings, 100000, '2026-02', 6, 6);
  const b = E.cashFitMonth(live, live.settings, 100000, '2026-02', 6, 6);
  assert.equal(a.month, '2026-05');                                       // março e abril ficariam negativos
  assert.equal(b.month, '2026-02');                                       // março em diante já parte do saldo real
});

test('uma linha do tempo com outro mês inicial refaz a leitura: ela só vale a partir do mês inicial', () => {
  const marco = [{ item_id: 'cc', month: '2026-03-01', amount: 1500 }];              // valor do item da conta em março
  const live = fixture({ live: LEITURA, entries: marco }), classico = fixture({ entries: marco });
  const idx = E.buildIndex(live), idxC = E.buildIndex(classico);
  // mês inicial depois da leitura: março vira um mês antes do saldo (o item da conta é um item comum), igual ao orçamento sem leitura
  const abril = { balance_start_month: '2026-04-01', opening_balance: 0 };
  assert.equal(E.timeline(idxC, abril, '2026-03', 1)[0].entradas, 200000);              // 1500 + salário 500
  assert.deepEqual(E.timeline(idx, abril, '2026-03', 3), E.timeline(idxC, abril, '2026-03', 3));
  // mês inicial antes da leitura (fevereiro): a leitura de março continua valendo e manda no saldo de março
  const fev = { balance_start_month: '2026-02-01', opening_balance: 0 };
  assert.equal(E.timeline(idx, fev, '2026-03', 1)[0].saldo, 32000);
  assert.notEqual(E.timeline(idxC, fev, '2026-03', 1)[0].saldo, 32000);
});

test('o motor não altera os dados que recebe', () => {
  const d = fixture({ live: LEITURA, settled: [tick('sal', '2026-03', '2026-03-05T10:00:00+00:00')] });
  const antes = JSON.stringify(d);
  const idx = E.buildIndex(d);
  E.timeline(idx, d.settings, '2026-01', 12);
  E.monthView(idx, '2026-03');
  E.scenario(d, d.settings, [{ kind: 'saida', name: 'x', start: '2026-03', n: 2, perCents: 500 }], '2026-03', 4);
  assert.equal(JSON.stringify(d), antes);
});

// ── a linha do tempo no mês da leitura (é o que a aba Projeção mostra) ───
// Sem isto, a coluna "Resultado" do mês atual mostraria entradas − saídas (que não parte do saldo lido) ao lado de um saldo
// que parte dele: números que não fecham. Por isso a linha do mês da leitura traz também `live`, com o quanto o saldo muda.
test('a linha do tempo traz, só no mês da leitura, o que explica o saldo e quanto ele muda no mês', () => {
  const d = fixture({ live: LEITURA });                                    // março: R$ 1.000 lidos; falta receber 500 e pagar 1.180
  const tl = E.timeline(E.buildIndex(d), d.settings, '2026-02', 3);
  assert.equal('live' in tl[0], false, 'fevereiro não tem leitura');
  assert.equal('live' in tl[2], false, 'abril não tem leitura');
  assert.deepEqual(tl[1].live, { cents: 100000, asOf: Date.UTC(2026, 2, 15, 12, 0, 0), receber: 50000, pagar: 118000, variacao: 32000 - 144000 });
  assert.equal(tl[1].saldo, 32000);
  assert.equal(tl[1].saldo, tl[0].saldo + tl[1].live.variacao, 'o saldo fecha: saldo de fevereiro + quanto muda em março');
  // `resultado` segue sendo entradas − saídas das linhas do mês (o mesmo número do resumo do mês), sem a conta
  assert.equal(tl[1].resultado, -68000);
  assert.equal(tl[1].entradas - tl[1].saidas, tl[1].resultado);
  assert.equal(tl[1].resultado, view(d, '2026-03').resultado);
  assert.equal(tl[2].saldo, 32000 + 22000, 'abril parte do saldo previsto de março, como sempre');
});

test('a linha do mês da leitura acompanha as marcas: o que já está no saldo sai de "a receber/a pagar"', () => {
  // salário recebido às 10h do dia 5 (antes da leitura) e cartão marcado às 8h do dia 16 (depois dela)
  const d = fixture({ live: LEITURA, settled: [tick('sal', '2026-03', '2026-03-05T10:00:00+00:00'), tick('car', '2026-03', '2026-03-16T08:00:00+00:00')] });
  const r = E.timeline(E.buildIndex(d), d.settings, '2026-03', 1)[0];
  assert.equal(r.live.receber, 0);
  assert.equal(r.live.pagar, 118000);                                      // o cartão (marcado depois) ainda conta como a pagar
  assert.equal(r.saldo, 100000 - 118000);
  assert.equal(r.live.variacao, r.saldo - 144000);
  assert.equal(r.resultado, -68000, 'as marcas continuam não mexendo no resultado do mês');
});

test('mês da leitura = mês inicial: o saldo de partida é zero (o saldo lido já traz tudo) e a abertura e o valor digitado na conta não contam', () => {
  const d = fixture({ live: LEITURA, entries: [{ item_id: 'cc', month: '2026-03-01', amount: 777 }] });
  d.settings = { balance_start_month: '2026-03-01', opening_balance: 50, min_balance: 100 };
  const tl = E.timeline(E.buildIndex(d), d.settings, '2026-02', 3);
  assert.equal(tl[0].saldo, null);
  assert.equal('live' in tl[0], false);
  assert.equal(tl[1].saldo, 32000);
  assert.equal(tl[1].live.variacao, 32000);                                // partida zero: o saldo do mês é a própria variação
  assert.equal(tl[2].saldo, 54000);
  assert.equal(tl[2].saldo, tl[1].saldo + tl[2].resultado);
  assert.equal('live' in tl[2], false);
  // a mesma situação sem a leitura (como na 1.4.0): no mês inicial a conta é uma entrada comum e a abertura soma
  const c = fixture({ entries: [{ item_id: 'cc', month: '2026-03-01', amount: 777 }] });
  c.settings = d.settings;
  const tc = E.timeline(E.buildIndex(c), c.settings, '2026-03', 2);
  assert.equal(tc[0].saldo, 5000 + 77700 + 50000 - 118000);
  assert.equal('live' in tc[0], false);
  assert.equal(tc[1].saldo, tc[0].saldo + 22000);
});

test('sem leitura boa nenhuma linha da linha do tempo ganha a chave `live`', () => {
  const ruins = [undefined, { month: '2026-03', cents: 1.5, asOf: LEITURA.asOf }, { month: '2026-03', cents: 100000, asOf: 'ontem' }, { month: 'março', cents: 100000, asOf: LEITURA.asOf }];
  ruins.forEach(function (live) {
    const d = fixture({ live: live });
    E.timeline(E.buildIndex(d), d.settings, '2026-01', 8).forEach(function (r) { assert.equal('live' in r, false, JSON.stringify(live)); });
  });
  // sem conta corrente definida, a leitura não vale: nenhuma linha muda
  const semCC = fixture({ live: LEITURA, carry: false });
  E.timeline(E.buildIndex(semCC), semCC.settings, '2026-01', 8).forEach(function (r) { assert.equal('live' in r, false); });
});

// ── a hora da marca e da leitura: formatos do Supabase ──────────────────
test('horas no formato do Supabase (6 casas, "+00" curto, espaço no lugar do T) são lidas igual', () => {
  const alvo = Date.UTC(2026, 2, 15, 12, 0, 0);
  [
    '2026-03-15T12:00:00+00:00', '2026-03-15T12:00:00Z', '2026-03-15 12:00:00+00', '2026-03-15T09:00:00-03:00',
    '2026-03-15T09:00:00-03', '2026-03-15T12:00:00.000000+00:00', '2026-03-15 12:00:00.000+00'
  ].forEach(function (s) {
    const d = fixture({ live: { month: '2026-03', cents: 100000, asOf: s } });
    assert.equal(E.liveOf(E.buildIndex(d)).asOf, alvo, s);
  });
  const frac = fixture({ live: { month: '2026-03', cents: 100000, asOf: '2026-03-15T12:00:00.430498+00:00' } });
  assert.equal(E.liveOf(E.buildIndex(frac)).asOf, alvo + 430);
  const num = fixture({ live: { month: '2026-03', cents: 100000, asOf: alvo } });
  assert.equal(E.liveOf(E.buildIndex(num)).asOf, alvo);

  // marca com 6 casas e "+00" curto: 12:00:00.5 está DEPOIS de 12:00:00 → ainda falta; 11:59:59.999999 → já está no saldo
  const depois = fixture({ live: LEITURA, settled: [tick('car', '2026-03', '2026-03-15 12:00:00.500000+00')] });
  assert.equal(view(depois, '2026-03').live.tarde.nSaidas, 1);
  const antes = fixture({ live: LEITURA, settled: [tick('car', '2026-03', '2026-03-15 11:59:59.999999+00')] });
  assert.equal(view(antes, '2026-03').live.tarde.nSaidas, 0);
  assert.equal(view(antes, '2026-03').live.feito.nSaidas, 1);
  // hora ilegível na marca = marca antiga (sem hora): conta como já refletida
  const lixo = fixture({ live: LEITURA, settled: [tick('car', '2026-03', 'ontem')] });
  assert.equal(view(lixo, '2026-03').live.feito.nSaidas, 1);
});

// ── prova cruzada: um modelo independente, com dados sorteados ──────────
// (laços simples sobre os dados crus; não usa nenhuma função do motor)
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function lastEntry(d, itemId, key) {                                            // o último lançamento do item no mês (o que vale)
  let e = null;
  d.entries.forEach(function (x) { if (x.item_id === itemId && x.month === key) e = x; });
  return e;
}
function modelAmount(d, it, month) {
  const key = month + '-01';
  const e = lastEntry(d, it.id, key);
  if (e) return Math.round(e.amount * 100);
  if (!it.recurring || it.active === false || !it.start_month) return 0;
  if (key < it.start_month) return 0;
  if (it.end_month && key > it.end_month) return 0;
  let c = 0, best = '';
  d.rates.forEach(function (r) { if (r.item_id === it.id && r.from_month <= key && r.from_month >= best) { c = Math.round(r.amount * 100); best = r.from_month; } });
  return c;
}
const nextMonth = (m) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'); };

test('prova cruzada: 400 orçamentos sorteados, o motor e o modelo independente dão a mesma sobra e o mesmo saldo adiante', () => {
  const R = rng(20261121);
  const pick = (n) => Math.floor(R() * n);
  const meses = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
  let comMarcaTarde = 0, comMarcaFeita = 0, comRecomeco = 0;
  for (let n = 0; n < 400; n++) {
    const items = [{ id: 'cc', kind: 'entrada', type: 'renda', name: 'Conta', recurring: false, start_month: null, end_month: null, active: true, carry_over: true }];
    const rates = [], entries = [], settled = [];
    const qtd = 3 + pick(6);
    for (let i = 0; i < qtd; i++) {
      const recurring = R() < 0.6;
      const it = {
        id: 'i' + i, kind: R() < 0.3 ? 'entrada' : 'saida', type: 'conta', name: 'Item ' + i, recurring: recurring, active: R() < 0.9, carry_over: false,
        start_month: recurring ? meses[pick(4)] + '-01' : null, end_month: recurring && R() < 0.3 ? meses[4 + pick(4)] + '-01' : null
      };
      items.push(it);
      if (recurring) for (let k = 0, nr = 1 + pick(2); k < nr; k++) rates.push({ item_id: it.id, from_month: meses[pick(6)] + '-01', amount: (1 + pick(90000)) / 100 });
      else for (let k = 0, ne = pick(3); k < ne; k++) entries.push({ item_id: it.id, month: meses[pick(8)] + '-01', amount: (1 + pick(90000)) / 100 });
      if (recurring && R() < 0.4) entries.push({ item_id: it.id, month: meses[pick(8)] + '-01', amount: (pick(60000)) / 100 });   // valor do mês que vence o previsto
    }
    entries.push({ item_id: 'cc', month: meses[0] + '-01', amount: pick(300000) / 100 });
    for (let k = 1; k < 8; k++) if (R() < 0.15) entries.push({ item_id: 'cc', month: meses[k] + '-01', amount: pick(400000) / 100 });   // saldos reais digitados
    const inicio = meses[pick(3)];
    const mesLeitura = meses[pick(8)];
    if (mesLeitura < inicio) { n--; continue; }                                   // a leitura antes do mês inicial não vale (outro teste)
    const asOfMs = Date.parse(mesLeitura + '-01T00:00:00Z') + pick(27 * 86400000);
    const live = { month: mesLeitura, cents: pick(900000) - 100000, asOf: new Date(asOfMs).toISOString().replace('Z', '+00:00') };
    const addTick = function (itemId, month, at) {                                // no banco, (item, mês) é a chave: não repete
      if (!settled.some(s => s.item_id === itemId && s.month === month)) settled.push({ item_id: itemId, month: month, settled_at: at });
    };
    items.forEach(function (it) {
      if (it.id === 'cc' || R() < 0.45) return;
      const r = R();
      let at;
      if (r < 0.2) at = null;                                                      // marca antiga, sem hora
      else if (r < 0.5) at = new Date(asOfMs - 1 - pick(5 * 86400000)).toISOString();           // antes da leitura
      else if (r < 0.6) at = new Date(asOfMs).toISOString();                                     // na hora exata
      else at = new Date(asOfMs + 1 + pick(5 * 86400000)).toISOString();                         // depois da leitura
      addTick(it.id, mesLeitura + '-01', at);
      if (R() < 0.3) addTick(it.id, meses[pick(8)] + '-01', new Date(asOfMs + pick(86400000)).toISOString());
    });
    const d = { items, rates, entries, settled, settings: { balance_start_month: inicio + '-01', opening_balance: pick(100000) / 100, min_balance: 0 }, saldoReal: live };

    // modelo independente: sobra do mês da leitura
    let receber = 0, pagar = 0, feitoE = 0, feitoS = 0;
    items.forEach(function (it) {
      if (it.id === 'cc') return;
      const c = modelAmount(d, it, mesLeitura);
      if (!c) return;
      const s = settled.find(x => x.item_id === it.id && x.month === mesLeitura + '-01');
      const feito = !!s && (s.settled_at == null || Date.parse(s.settled_at) <= asOfMs);
      if (s && !feito) comMarcaTarde++;
      if (feito) comMarcaFeita++;
      if (feito) { if (it.kind === 'entrada') feitoE += c; else feitoS += c; }
      else if (it.kind === 'entrada') receber += c; else pagar += c;
    });
    const sobra = live.cents + receber - pagar;

    const idx = E.buildIndex(d), v = E.monthView(idx, mesLeitura);
    assert.equal(v.live.sobra, sobra, 'sobra do mês, caso ' + n);
    assert.equal(v.live.receber, receber, 'a receber, caso ' + n);
    assert.equal(v.live.pagar, pagar, 'a pagar, caso ' + n);
    assert.equal(v.live.feito.entradas, feitoE, 'entradas já no saldo, caso ' + n);
    assert.equal(v.live.feito.saidas, feitoS, 'saídas já no saldo, caso ' + n);
    assert.equal(v.live.feito.entradas + v.live.receber, v.totalEntradas, 'totais de entradas, caso ' + n);
    assert.equal(v.live.feito.saidas + v.live.pagar, v.totalSaidas, 'totais de saídas, caso ' + n);
    assert.equal(v.carry.cents, live.cents);

    // saldo na linha do tempo: mês da leitura e os 3 seguintes (um saldo real digitado depois recomeça a conta)
    const tl = E.timeline(idx, d.settings, mesLeitura, 4);
    let esperado = sobra, m = mesLeitura;
    assert.equal(tl[0].saldo, esperado, 'saldo do mês da leitura, caso ' + n);
    // a linha do mês da leitura explica o saldo; o saldo de partida vem do mesmo orçamento SEM a leitura (os meses de antes não mudam)
    assert.equal(tl[0].live.cents, live.cents, 'saldo lido na linha do tempo, caso ' + n);
    assert.equal(tl[0].live.asOf, asOfMs, 'hora da leitura na linha do tempo, caso ' + n);
    assert.equal(tl[0].live.receber, receber, 'a receber na linha do tempo, caso ' + n);
    assert.equal(tl[0].live.pagar, pagar, 'a pagar na linha do tempo, caso ' + n);
    const partida = mesLeitura === inicio ? 0
      : E.timeline(E.buildIndex(Object.assign({}, d, { saldoReal: null })), d.settings, meses[meses.indexOf(mesLeitura) - 1], 1)[0].saldo;
    assert.equal(tl[0].live.variacao, sobra - partida, 'quanto o saldo muda no mês, caso ' + n);
    assert.equal(tl[0].saldo, partida + tl[0].live.variacao, 'o saldo fecha com a partida, caso ' + n);
    for (let k = 1; k < 4; k++) assert.equal('live' in tl[k], false, 'só o mês da leitura tem `live`, caso ' + n);
    for (let k = 1; k < 4; k++) {
      m = nextMonth(m);
      let ent = 0, sai = 0;
      items.forEach(function (it) { if (it.id === 'cc') return; const c = modelAmount(d, it, m); if (it.kind === 'entrada') ent += c; else sai += c; });
      const dig = lastEntry(d, 'cc', m + '-01');
      if (dig) comRecomeco++;
      esperado = (dig ? Math.round(dig.amount * 100) : esperado) + ent - sai;
      assert.equal(tl[k].saldo, esperado, 'saldo ' + m + ', caso ' + n);
    }

    // marcar um item que ainda falta, DEPOIS da leitura, não mexe na sobra (a marca só vale quando a leitura a alcança)
    const pendente = items.find(it => it.id !== 'cc' && modelAmount(d, it, mesLeitura) !== 0 && !settled.some(s => s.item_id === it.id && s.month === mesLeitura + '-01'));
    if (pendente) {
      const d2 = Object.assign({}, d, { settled: settled.concat([{ item_id: pendente.id, month: mesLeitura + '-01', settled_at: new Date(asOfMs + 1000).toISOString() }]) });
      assert.equal(E.monthView(E.buildIndex(d2), mesLeitura).live.sobra, sobra, 'marca depois da leitura mexeu na sobra, caso ' + n);
      // e a mesma marca feita ANTES da leitura (já está no saldo) tira o item da conta: sobra muda pelo valor dele (com o sinal certo)
      const d3 = Object.assign({}, d, { settled: settled.concat([{ item_id: pendente.id, month: mesLeitura + '-01', settled_at: new Date(asOfMs - 1000).toISOString() }]) });
      const c = modelAmount(d, pendente, mesLeitura);
      assert.equal(E.monthView(E.buildIndex(d3), mesLeitura).live.sobra, sobra + (pendente.kind === 'entrada' ? -c : c), 'marca antes da leitura, caso ' + n);
    }
  }
  assert.ok(comMarcaTarde > 100 && comMarcaFeita > 100 && comRecomeco > 20, 'o sorteio precisa cobrir os casos: ' + [comMarcaTarde, comMarcaFeita, comRecomeco]);
});

test('sem a leitura, a hora das marcas não muda nenhuma conta', () => {
  const R = rng(7);
  for (let n = 0; n < 100; n++) {
    const d = fixture({
      entries: [{ item_id: 'cc', month: '2026-0' + (2 + Math.floor(R() * 5)) + '-01', amount: Math.floor(R() * 3000) }],
      settled: [tick('sal', '2026-03', new Date(1773576000000 + Math.floor(R() * 1e9)).toISOString()), tick('luz', '2026-03', null)]
    });
    const sem = JSON.stringify(E.timeline(E.buildIndex(d), d.settings, '2026-01', 10));
    const semHora = JSON.stringify(E.timeline(E.buildIndex(Object.assign({}, d, { settled: d.settled.map(s => ({ item_id: s.item_id, month: s.month })) })), d.settings, '2026-01', 10));
    assert.equal(sem, semHora);
  }
});

// ── o motor continua sem relógio e sem rede ─────────────────────────────
test('o motor nunca olha o relógio nem a rede (a hora da leitura vem de fora)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../docs/js/engine.js'), 'utf8');
  assert.equal(/Date\.now|new Date\(\s*\)|performance\.now|fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(src), false);
});
