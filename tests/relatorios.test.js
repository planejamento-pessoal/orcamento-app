'use strict';
// Relatórios (aba Conta → "Relatórios"). Só dados INVENTADOS e sem rede.
//  • Engine.monthReport / periodReport só juntam as contas das abas Mês e Projeção: nada novo é calculado;
//  • o saldo lido da 99Pay (só admin) nunca aparece num relatório;
//  • Format.reportText / reportCsv: texto para compartilhar e planilha para o Excel (separador ";", vírgula decimal);
//  • travas estáticas da tela e do CSS de impressão.
// (A tela em si é conferida num navegador de verdade; isso não cabe nos testes sem dependências.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../docs/js/engine.js');
const F = require('../docs/js/format.js');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const NOW = new Date(2026, 10, 27, 6, 50);   // 27/11/2026 06:50 (horário do aparelho)

// Novembro de 2026 é o mês olhado. Setembro é o mês inicial do saldo.
//   Aluguel 1.500 (dia 5, já pago) | Salário 6.000 (dia 1, já recebido) | TV parcela 3 de 4 (333,34, dia 10)
//   Fatura azul 2.500,50 (cartão Banco Azul, dia 20, lançada) | "=SOMA(A1;A2)" 10,00 (nome que vira fórmula no Excel)
//   Conta corrente: o saldo real de outubro foi corrigido para 1.234,56
function fixture(extra) {
  const d = {
    items: [
      { id: 'a', kind: 'saida', type: 'conta', name: 'Aluguel', due_day: 5, recurring: true, start_month: '2026-01-01', end_month: null, active: true },
      { id: 'b', kind: 'saida', type: 'cartao', name: 'Fatura azul', card_name: 'Banco Azul', due_day: 20, recurring: false, start_month: null, end_month: null, active: true },
      { id: 'c', kind: 'entrada', type: 'renda', name: 'Salário', due_day: 1, recurring: true, start_month: '2026-01-01', end_month: null, active: true },
      { id: 'd', kind: 'saida', type: 'parcela', name: 'TV', due_day: 10, recurring: true, start_month: '2026-09-01', end_month: '2026-12-01', active: true },
      { id: 'k', kind: 'entrada', type: 'outro', name: 'Conta corrente', due_day: null, recurring: false, start_month: null, end_month: null, active: true, carry_over: true },
      { id: 'f', kind: 'saida', type: 'outro', name: '=SOMA(A1;A2)', due_day: null, recurring: false, start_month: null, end_month: null, active: true }
    ],
    rates: [
      { item_id: 'a', from_month: '2026-01-01', amount: 1500 },
      { item_id: 'c', from_month: '2026-01-01', amount: 6000 },
      { item_id: 'd', from_month: '2026-09-01', amount: 333.34 }
    ],
    entries: [
      { item_id: 'b', month: '2026-11-01', amount: 2500.5 },
      { item_id: 'f', month: '2026-11-01', amount: 10 },
      { item_id: 'k', month: '2026-11-01', amount: 1234.56 }
    ],
    settled: [{ item_id: 'a', month: '2026-11-01' }, { item_id: 'c', month: '2026-11-01' }],
    settings: { balance_start_month: '2026-09-01', opening_balance: 100, min_balance: 1000 }
  };
  return Object.assign(d, extra || {});
}
const rep = (d, m) => E.monthReport(E.buildIndex(d), d.settings, m);
const per = (d, m, n) => E.periodReport(E.buildIndex(d), d.settings, m, n);

// ── Engine: o mesmo que a aba Mês e a aba Projeção ──────────────────────
test('monthReport: os números são os da aba Mês (monthView + timeline), linha por linha', () => {
  const d = fixture(), idx = E.buildIndex(d), r = rep(d, '2026-11');
  const v = E.monthView(idx, '2026-11'), tl = E.timeline(idx, d.settings, '2026-11', 1)[0];
  assert.equal(r.kind, 'mes');
  assert.equal(r.month, '2026-11');
  assert.equal(r.totalEntradas, v.totalEntradas);
  assert.equal(r.totalSaidas, v.totalSaidas);
  assert.equal(r.resultado, v.resultado);
  assert.equal(r.saldo, tl.saldo);
  assert.equal(r.status, E.statusOf(tl.saldo, E.minCents(d.settings)));
  assert.equal(r.minCents, 100000);
  assert.deepEqual(r.saidas.map((l) => [l.name, l.cents, l.settled, l.day]), v.saidas.map((l) => [l.item.name, l.cents, l.settled, l.item.due_day || null]));
  assert.deepEqual(r.entradas.map((l) => [l.name, l.cents, l.settled]), v.entradas.map((l) => [l.item.name, l.cents, l.settled]));
  assert.deepEqual(r.baixa, { entradas: { n: v.baixa.entradas.n, feitas: v.baixa.entradas.feitas, feito: v.baixa.entradas.feito, falta: v.baixa.entradas.falta }, saidas: { n: v.baixa.saidas.n, feitas: v.baixa.saidas.feitas, feito: v.baixa.saidas.feito, falta: v.baixa.saidas.falta } });
  // contas feitas à mão: 6.000 entram; saem 1.500 + 333,34 + 2.500,50 + 10 = 4.343,84; sobra 1.656,16; com 1.234,56 que vieram de outubro: 2.890,72
  assert.equal(r.totalEntradas, 600000);
  assert.equal(r.totalSaidas, 434384);
  assert.equal(r.resultado, 165616);
  assert.equal(r.saldo, 289072);
  assert.equal(r.status, 'ok');
  // a soma das linhas fecha com o total (a conta corrente fica de fora, como na aba Mês)
  assert.equal(r.saidas.reduce((s, l) => s + l.cents, 0), r.totalSaidas);
  assert.equal(r.entradas.reduce((s, l) => s + l.cents, 0), r.totalEntradas);
  // a conta corrente: de onde veio a sobra e que o valor foi corrigido
  assert.deepEqual(r.carry, { prev: '2026-10', cents: 123456, real: true, live: false });
  // parcela, cartão e valor lançado
  const tv = r.saidas.find((l) => l.name === 'TV'), fat = r.saidas.find((l) => l.name === 'Fatura azul');
  assert.deepEqual(tv.inst, { k: 3, n: 4 });
  assert.equal(fat.card, true);
  assert.equal(fat.cardName, 'Banco Azul');
  assert.equal(fat.real, true);
  assert.equal(r.liveAsOf, null);
});

test('monthReport: mês antes do saldo inicial não inventa saldo', () => {
  const r = rep(fixture(), '2026-08');
  assert.equal(r.saldo, null);
  assert.equal(r.status, null);
  assert.equal(r.startMonth, '2026-09');
  assert.equal(r.carry, null);
});

test('periodReport: linha por linha igual à tabela da aba Projeção, com totais e resumo', () => {
  const d = fixture(), idx = E.buildIndex(d), p = per(d, '2026-08', 6);
  const tl = E.timeline(idx, d.settings, '2026-08', 6), sum = E.summarize(tl, E.minCents(d.settings));
  assert.equal(p.kind, 'periodo');
  assert.equal(p.from, '2026-08');
  assert.equal(p.to, '2027-01');
  assert.equal(p.count, 6);
  assert.deepEqual(p.rows.map((r) => [r.month, r.entradas, r.saidas, r.resultado, r.saldo]), tl.map((r) => [r.month, r.entradas, r.saidas, r.resultado, r.saldo]));
  assert.equal(p.rows[0].saldo, null);                       // antes do mês inicial
  assert.equal(p.rows[0].status, null);
  assert.equal(p.totalEntradas, tl.reduce((s, r) => s + r.entradas, 0));
  assert.equal(p.totalSaidas, tl.reduce((s, r) => s + r.saidas, 0));
  assert.equal(p.resultado, p.totalEntradas - p.totalSaidas);
  assert.equal(p.min, sum.min);
  assert.equal(p.minMonth, sum.minMonth);
  assert.equal(p.last, sum.last);
  assert.equal(p.firstNeg, null);
  assert.equal(p.firstLow, null);
  assert.equal(p.hasLive, false);
  // novembro é o mês de menor saldo (a fatura do cartão pesa)
  assert.equal(p.minMonth, '2026-11');
  assert.equal(p.min, 289072);
});

test('periodReport: quantidade de meses é limitada (1 a 120) e a virada de ano funciona', () => {
  const d = fixture();
  assert.equal(per(d, '2026-11', 0).count, 1);
  assert.equal(per(d, '2026-11', -5).count, 1);
  assert.equal(per(d, '2026-11', 'abc').count, 1);
  assert.equal(per(d, '2026-11', 500).count, 120);
  assert.equal(per(d, '2026-11', 3).rows.map((r) => r.month).join(), '2026-11,2026-12,2027-01');
});

test('periodReport: saldo negativo e abaixo do mínimo aparecem na linha e no resumo', () => {
  const d = fixture({ settings: { balance_start_month: '2026-09-01', opening_balance: 0, min_balance: 5000 } });
  d.entries = d.entries.filter((e) => e.item_id !== 'k');
  d.rates.push({ item_id: 'a', from_month: '2026-12-01', amount: 20000 });  // aluguel de 20.000 a partir de dezembro: estoura
  const p = per(d, '2026-09', 6);
  assert.ok(p.rows.some((r) => r.status === 'low'));
  assert.ok(p.rows.some((r) => r.status === 'neg'));
  assert.equal(p.firstNeg, p.rows.find((r) => r.status === 'neg').month);
  assert.equal(p.firstLow, p.rows.find((r) => r.status !== 'ok' && r.status !== null).month);
  const t = F.reportText(p, NOW);
  assert.match(t, /Fica negativo a partir de /);
  assert.match(t, /\(negativo\)/);
});

// ── o saldo lido da 99Pay nunca vai para o relatório ────────────────────
test('mês com saldo lido da 99Pay: o valor lido NÃO aparece em nenhum campo, só o instante da leitura', () => {
  const LIDO = 98765432;                                                   // R$ 987.654,32 (inventado; nenhuma conta chega perto)
  const d = fixture({ saldoReal: { month: '2026-11', cents: LIDO, asOf: '2026-11-15T12:00:00+00:00' } });
  const idx = E.buildIndex(d), v = E.monthView(idx, '2026-11');
  assert.ok(v.live && v.live.cents === LIDO, 'o teste precisa começar com a leitura valendo');
  const r = rep(d, '2026-11');
  assert.equal(r.carry.live, true);
  assert.equal(r.carry.cents, null);
  assert.equal(r.liveAsOf, v.live.asOf);
  assert.equal(r.saldo, v.live.sobra);                                      // o mesmo "Sobra prevista no fim do mês" da aba Mês
  const todo = JSON.stringify(r) + F.reportText(r, NOW) + F.reportCsv(r, NOW);
  assert.ok(!todo.includes(String(LIDO)), 'o saldo lido apareceu no relatório do mês');
  assert.ok(!/987\.654,32|987654,32/.test(todo), 'o saldo lido (formatado) apareceu no relatório do mês');
  assert.match(F.reportText(r, NOW), /parte da leitura da 99Pay de 15\/11 às /);
  // o relatório de vários meses também não leva o valor lido
  const p = per(d, '2026-10', 3);
  assert.equal(p.hasLive, true);
  assert.equal(p.rows.filter((x) => x.live).length, 1);
  const tudo = JSON.stringify(p) + F.reportText(p, NOW) + F.reportCsv(p, NOW);
  assert.ok(!tudo.includes(String(LIDO)), 'o saldo lido apareceu no relatório de vários meses');
  assert.match(F.reportText(p, NOW), /Em nov\/2026 o saldo parte da leitura da 99Pay/);
});

// "Resultado" de cada mês do relatório de vários meses é o MESMO número que a aba Projeção mostra; no mês que parte da leitura
// da 99Pay isso é "quanto o saldo muda" (p.live.variacao), e o relatório diz isso em texto e na planilha.
test('mês com leitura da 99Pay: o Resultado do relatório de vários meses é o da aba Projeção, a soma fecha e há aviso (texto e CSV)', () => {
  const LIDO = 98765432;
  const d = fixture({ saldoReal: { month: '2026-11', cents: LIDO, asOf: '2026-11-15T12:00:00+00:00' } });
  const idx = E.buildIndex(d), tl = E.timeline(idx, d.settings, '2026-10', 3), p = per(d, '2026-10', 3), r = rep(d, '2026-11');
  assert.equal(tl[1].live !== undefined && tl[1].live !== null, true, 'o teste precisa do mês de novembro com leitura');
  p.rows.forEach((x, i) => assert.equal(x.resultado, tl[i].live ? tl[i].live.variacao : tl[i].resultado, 'Resultado de ' + x.month + ' diferente da aba Projeção'));
  assert.equal(p.rows[1].live, true);
  assert.equal(p.rows[0].live, false);
  assert.equal(p.resultado, p.rows.reduce((t, x) => t + x.resultado, 0), 'o Resultado do período é a soma da coluna Resultado');
  assert.equal(p.totalEntradas, tl.reduce((t, x) => t + x.entradas, 0));
  assert.equal(p.totalSaidas, tl.reduce((t, x) => t + x.saidas, 0));
  assert.notEqual(p.resultado, p.totalEntradas - p.totalSaidas, 'com a leitura valendo o Resultado NÃO é entradas menos saídas (e o relatório avisa)');
  // aviso no texto, na planilha do período e na planilha do mês
  assert.match(F.reportText(p, NOW), /resultado do período pode não ser entradas menos saídas\./);
  assert.match(F.reportCsv(p, NOW), /(^|\r\n)Observação;Em nov\/2026 o saldo parte da leitura da 99Pay\./);
  assert.match(F.reportCsv(r, NOW), /(^|\r\n)Observação;;O saldo do fim do mês parte da leitura da 99Pay de 15\/11 às /);
  assert.match(F.reportText(r, NOW), /O que foi marcado como pago ou recebido depois dessa hora ainda conta como a pagar ou a receber\./);
  assert.match(F.reportCsv(r, NOW), /ainda conta como a pagar ou a receber\./);
  assert.notEqual(F.reportPeriodLiveNote(p), '');
  assert.notEqual(F.reportLiveNote(r.liveAsOf), '');
});

test('sem a leitura (leitor, editor ou admin sem leitura): relatório igual ao de sempre, sem aviso da 99Pay', () => {
  const r = rep(fixture(), '2026-11');
  assert.equal(r.liveAsOf, null);
  assert.ok(!/99Pay/.test(F.reportText(r, NOW)));
  assert.ok(!/99Pay/.test(F.reportText(per(fixture(), '2026-10', 3), NOW)));
  // sem leitura: nenhuma linha "Observação" nas planilhas e o aviso do período é vazio
  assert.ok(!/Observação/.test(F.reportCsv(r, NOW)));
  assert.ok(!/Observação/.test(F.reportCsv(per(fixture(), '2026-10', 3), NOW)));
  assert.equal(F.reportPeriodLiveNote(per(fixture(), '2026-10', 3)), '');
  assert.equal(F.reportLiveNote(null), '');
  // e o Resultado de cada mês segue sendo entradas menos saídas
  per(fixture(), '2026-10', 3).rows.forEach((x) => assert.equal(x.resultado, x.entradas - x.saidas));
});

// ── Format: texto para compartilhar ─────────────────────────────────────
test('reportText (mês): cabeçalho, resumo, listas na ordem da aba Mês e linhas de "já pago / falta pagar"', () => {
  const t = F.reportText(rep(fixture(), '2026-11'), NOW);
  assert.equal(t, [
    'Orçamento — relatório de novembro de 2026',
    'Gerado em 27/11/2026 às 06:50',
    '',
    'RESUMO',
    'Veio de outubro (corrigido): R$ 1.234,56',
    'Entradas: R$ 6.000,00',
    'Saídas: R$ 4.343,84',
    'Resultado do mês: +R$ 1.656,16',
    'Saldo no fim do mês: R$ 2.890,72',
    'Situação: Acima do mínimo de R$ 1.000,00',
    '',
    'SAÍDAS — R$ 4.343,84',
    'dia 5 · Aluguel — R$ 1.500,00 (pago)',
    'dia 10 · TV — R$ 333,34 (a pagar)',
    '   Parcela 3 de 4',
    'dia 20 · Fatura azul — R$ 2.500,50 (a pagar)',
    '   Cartão, no Banco Azul',
    '=SOMA(A1;A2) — R$ 10,00 (a pagar)',
    'Já pago: R$ 1.500,00 (1 de 4) · Falta pagar: R$ 2.843,84 (3)',
    '',
    'ENTRADAS — R$ 6.000,00',
    'dia 1 · Salário — R$ 6.000,00 (recebido)',
    'Tudo recebido.'
  ].join('\n'));
});

test('reportText (vários meses): resumo e duas linhas por mês', () => {
  const t = F.reportText(per(fixture(), '2026-08', 6), NOW);
  assert.equal(t, [
    'Orçamento — relatório de ago/2026 a jan/2027',
    'Gerado em 27/11/2026 às 06:50',
    '',
    'RESUMO',
    'Entradas no período: R$ 36.000,00',
    'Saídas no período: R$ 12.843,86',
    'Resultado do período: +R$ 23.156,14',
    'Menor saldo: R$ 2.890,72 em nov/2026',
    'Saldo no fim: R$ 11.557,38',
    'Sempre acima do mínimo de R$ 1.000,00.',
    '',
    'MÊS A MÊS',
    'ago/2026 — saldo não calculado',
    '   entradas R$ 6.000,00 · saídas R$ 1.500,00',
    'set/2026 — saldo R$ 4.266,66',
    '   entradas R$ 6.000,00 · saídas R$ 1.833,34',
    'out/2026 — saldo R$ 8.433,32',
    '   entradas R$ 6.000,00 · saídas R$ 1.833,34',
    'nov/2026 — saldo R$ 2.890,72',
    '   entradas R$ 6.000,00 · saídas R$ 4.343,84',
    'dez/2026 — saldo R$ 7.057,38',
    '   entradas R$ 6.000,00 · saídas R$ 1.833,34',
    'jan/2027 — saldo R$ 11.557,38',
    '   entradas R$ 6.000,00 · saídas R$ 1.500,00',
    '',
    'Meses que ainda não chegaram são previsão: só contam o que repete todo mês ou o que já foi lançado.'
  ].join('\n'));
});

test('reportText: mês vazio, sem marcas e sem saldo inicial não escreve undefined, NaN nem null', () => {
  const vazio = { items: [], rates: [], entries: [], settled: [], settings: { balance_start_month: '2026-11-01', opening_balance: 0, min_balance: 0 } };
  const t1 = F.reportText(rep(vazio, '2026-11'), NOW), t2 = F.reportText(rep(vazio, '2026-05'), NOW), t3 = F.reportText(per(vazio, '2026-05', 3), NOW);   // maio a julho: tudo antes do mês inicial
  [t1, t2, t3].forEach((t) => assert.ok(!/undefined|NaN|null|\[object/.test(t), t));
  assert.match(t1, /Nenhuma saída neste mês\./);
  assert.match(t1, /Nenhuma entrada neste mês\./);
  assert.match(t2, /Situação: O saldo acumulado começa em nov\/2026/);
  assert.match(t3, /Saldo: o saldo acumulado começa em nov\/2026\./);
  // sem nenhuma marca de pago, a linha "já pago / falta pagar" nem aparece (como na aba Mês)
  const semMarca = fixture({ settled: [] });
  assert.ok(!/Já pago|Falta pagar|Tudo pago/.test(F.reportText(rep(semMarca, '2026-11'), NOW)));
  // item sem dia de vencimento: sem "dia"
  assert.match(F.reportText(rep(fixture(), '2026-11'), NOW), /\n=SOMA\(A1;A2\) — R\$ 10,00 \(a pagar\)\n/);
});

test('reportText: tudo pago, tudo recebido e a faixa "abaixo do mínimo" / "negativo"', () => {
  const todos = fixture({ settled: ['a', 'b', 'd', 'f', 'c'].map((id) => ({ item_id: id, month: '2026-11-01' })) });
  assert.match(F.reportText(rep(todos, '2026-11'), NOW), /Tudo pago\./);
  assert.match(F.reportText(rep(todos, '2026-11'), NOW), /Tudo recebido\./);
  const aperto = fixture({ settings: { balance_start_month: '2026-09-01', opening_balance: 0, min_balance: 999999 } });
  assert.match(F.reportText(rep(aperto, '2026-11'), NOW), /Situação: Abaixo do mínimo de R\$ 999\.999,00/);   // min_balance vem em reais no banco
  const neg = fixture({ settings: { balance_start_month: '2026-09-01', opening_balance: -900000, min_balance: 0 } });
  neg.entries = neg.entries.filter((e) => e.item_id !== 'k');
  assert.match(F.reportText(rep(neg, '2026-11'), NOW), /Situação: Saldo negativo/);
});

// ── Format: planilha (CSV) ──────────────────────────────────────────────
test('reportCsv (mês): separador ";", vírgula decimal, número puro e nome que parece fórmula protegido', () => {
  const csv = F.reportCsv(rep(fixture(), '2026-11'), NOW);
  assert.equal(csv, [
    'Orçamento;Relatório de novembro de 2026',
    'Gerado em;27/11/2026 às 06:50',
    '',
    'Tipo;Dia;Item;Detalhe;Valor;Situação',
    'Saída;5;Aluguel;;1500,00;pago',
    'Saída;10;TV;Parcela 3 de 4;333,34;a pagar',
    'Saída;20;Fatura azul;Cartão, no Banco Azul;2500,50;a pagar',
    'Saída;;"\'=SOMA(A1;A2)";;10,00;a pagar',
    'Entrada;1;Salário;;6000,00;recebido',
    '',
    'Resumo;;Veio de outubro (corrigido);;1234,56;',
    'Resumo;;Entradas;;6000,00;',
    'Resumo;;Saídas;;4343,84;',
    'Resumo;;Resultado do mês;;1656,16;',
    'Resumo;;Saldo no fim do mês;;2890,72;Acima do mínimo de R$ 1.000,00',
    ''
  ].join('\r\n'));
  assert.ok(!csv.startsWith('\ufeff'), 'o BOM é posto pela tela, na hora de baixar');
});

test('reportCsv (vários meses): uma linha por mês, total no fim, saldo vazio antes do mês inicial', () => {
  const csv = F.reportCsv(per(fixture(), '2026-08', 3), NOW);
  assert.equal(csv, [
    'Orçamento;Relatório de ago/2026 a out/2026',
    'Gerado em;27/11/2026 às 06:50',
    '',
    'Mês;Entradas;Saídas;Resultado;Saldo;Situação',
    'ago/2026;6000,00;1500,00;4500,00;;antes do saldo inicial',
    'set/2026;6000,00;1833,34;4166,66;4266,66;acima do mínimo',
    'out/2026;6000,00;1833,34;4166,66;8433,32;acima do mínimo',
    '',
    'Total;18000,00;5166,68;12833,32;;',
    ''
  ].join('\r\n'));
});

test('csv: valor negativo sem R$ nem ponto de milhar; texto com aspas, ponto e vírgula, quebra de linha e fórmulas', () => {
  const neg = fixture({ settings: { balance_start_month: '2026-09-01', opening_balance: -900000, min_balance: 0 } });
  neg.entries = neg.entries.filter((e) => e.item_id !== 'k');
  const csv = F.reportCsv(rep(neg, '2026-11'), NOW);
  assert.match(csv, /Saldo no fim do mês;;-\d+,\d\d;Saldo negativo\r\n/);
  assert.ok(!/R\$ |\d\.\d{3},\d\d/.test(csv.split('Resumo')[1] || ''), 'valor com R$ ou ponto de milhar na parte de resumo');
  const d = fixture();
  d.items.push({ id: 'g', kind: 'saida', type: 'outro', name: 'Presente "especial"; com\nquebra', due_day: 7, recurring: false, active: true });
  d.items.push({ id: 'h', kind: 'saida', type: 'outro', name: '@cmd', due_day: 8, recurring: false, active: true });
  d.items.push({ id: 'i', kind: 'saida', type: 'outro', name: '-2+3', due_day: 9, recurring: false, active: true });
  d.items.push({ id: 'j', kind: 'saida', type: 'outro', name: '+55 11 9999', due_day: 11, recurring: false, active: true });
  [['g', 11], ['h', 12], ['i', 13], ['j', 14]].forEach(([id, v]) => d.entries.push({ item_id: id, month: '2026-11-01', amount: v }));
  const c2 = F.reportCsv(rep(d, '2026-11'), NOW);
  assert.match(c2, /Saída;7;"Presente ""especial""; com quebra";;11,00;a pagar/);
  assert.match(c2, /Saída;8;'@cmd;;12,00;a pagar/);
  assert.match(c2, /Saída;9;'-2\+3;;13,00;a pagar/);
  assert.match(c2, /Saída;11;'\+55 11 9999;;14,00;a pagar/);
  // nenhuma célula de TEXTO começa com = + - @ (o valor negativo é número, não texto)
  c2.split('\r\n').forEach((linha) => linha.split(';').forEach((cel, i, all) => {
    if (/^Saída|^Entrada/.test(all[0]) && i === 2) assert.ok(!/^[=+\-@]/.test(cel.replace(/^"/, '')), 'célula de texto começa com fórmula: ' + cel);
  }));
});

test('nome do arquivo e título', () => {
  assert.equal(F.reportFile(rep(fixture(), '2026-11')), 'relatorio-2026-11');
  assert.equal(F.reportFile(per(fixture(), '2026-01', 12)), 'relatorio-2026-01-a-2026-12');
  assert.equal(F.reportTitle(rep(fixture(), '2026-11')), 'Relatório de novembro de 2026');
  assert.equal(F.reportTitle(per(fixture(), '2026-01', 12)), 'Relatório de jan/2026 a dez/2026');
  assert.equal(F.stampOf(new Date(2026, 0, 5, 7, 3)), '05/01/2026 às 07:03');
});

// ── a tela (travas estáticas) ───────────────────────────────────────────
test('aba Conta: bloco "Relatórios" logo depois de "Sua conta", para qualquer papel, com os dados do motor', () => {
  const a = read('docs', 'js', 'account-view.js');
  const iConta = a.indexOf("sectionHead('Sua conta')"), iRel = a.indexOf("sectionHead('Relatórios')"), iOrc = a.indexOf('settingsBlock(st.data.settings)');
  assert.ok(iConta > 0 && iRel > iConta && iOrc > iRel, 'ordem: Sua conta → Relatórios → Orçamento');
  assert.match(a, /if \(st\.data\) \{ main\.appendChild\(sectionHead\('Relatórios'\)\); main\.appendChild\(reportBlock\(\)\); \}/);
  assert.ok(!/App\.can\(\)[^\n]*reportBlock|isAdmin\(\)[^\n]*reportBlock/.test(a), 'relatório não pode depender do papel');
  assert.match(a, /E\.monthReport\(App\.index\(\), data\.settings, cfg\.month\)/);
  assert.match(a, /E\.periodReport\(App\.index\(\), data\.settings, cfg\.from, cfg\.count\)/);
  assert.match(a, /F\.reportText\(rep, now\)/);
  assert.ok(!/innerHTML/.test(a));
  // tela de relatório não faz conta própria: nada de somar valores aqui
  const rel = a.slice(a.indexOf('// ── relatórios'), a.indexOf('// ── configurações do orçamento'));
  assert.ok(!/reduce\(|\+= |parseMoney|E\.cents|Math\.round/.test(rel), 'a tela do relatório não deve calcular valores');
});

test('painel do relatório: copiar e compartilhar sempre; planilha e impressão só fora do app Android; texto grande não some calado', () => {
  const a = read('docs', 'js', 'account-view.js');
  assert.match(a, /function inApk\(\) \{ return !!\(window\.OrcAndroid && typeof window\.OrcAndroid\.share === 'function'\); \}/);
  assert.match(a, /if \(!inApk\(\)\) \{\s*body\.appendChild\(h\('div', \{ 'class': 'rel-extras' \},[\s\S]*?Baixar planilha \(CSV\)[\s\S]*?Imprimir ou salvar em PDF/);
  assert.equal([...a.matchAll(/Baixar planilha \(CSV\)/g)].length, 1);
  assert.equal([...a.matchAll(/text: 'Copiar'/g)].length >= 1, true);
  assert.match(a, /text: 'Compartilhar', on: \{ click: onShare \}/);
  // o compartilhar do Android recusa texto com mais de 5000 caracteres: a tela passa a copiar antes disso
  const java = read('android', 'app', 'src', 'main', 'java', 'com', 'bruno', 'orcamento', 'MainActivity.java');
  const lim = /text\.length\(\) > (\d+)/.exec(java.slice(java.indexOf('public void share')));
  assert.ok(lim, 'não achei o limite do share em MainActivity.java');
  const tela = /var SHARE_LIMIT = (\d+);/.exec(a);
  assert.ok(tela, 'SHARE_LIMIT sumiu');
  assert.ok(Number(tela[1]) < Number(lim[1]), 'SHARE_LIMIT precisa ser menor que o limite do Android (' + lim[1] + ')');
  assert.match(a, /if \(inApk\(\) && text\.length > SHARE_LIMIT\)/);
  // planilha: BOM para o Excel ler os acentos; link temporário apagado depois
  assert.match(a, /\['\\ufeff' \+ F\.reportCsv\(rep, now\)\]/);
  assert.match(a, /URL\.revokeObjectURL\(url\)/);
});

test('CSS: impressão do relatório só vale com a classe imprime-rel (o app imprime como sempre sem ela)', () => {
  const css = read('docs', 'app.css');
  const i = css.indexOf('@media print');
  assert.ok(i > 0, 'faltou o CSS de impressão');
  const bloco = css.slice(i, css.indexOf('\n}\n', i) + 3);
  const regras = bloco.split('\n').filter((l) => /\{/.test(l) && !/@media/.test(l));
  assert.ok(regras.length >= 5);
  regras.forEach((l) => assert.match(l.trim(), /^html\.imprime-rel /, 'regra de impressão sem a classe: ' + l));
  assert.equal([...css.matchAll(/@media print/g)].length, 1);
  const a = read('docs', 'js', 'account-view.js');
  assert.match(a, /var PRINT_CLS = 'imprime-rel';/);
  assert.match(a, /onClose: function \(\) \{ document\.documentElement\.classList\.remove\(PRINT_CLS\); \}/);
});

test('arquivos travados: nenhum arquivo novo em docs/js e o motor continua exportando tudo o que exportava', () => {
  const arquivos = fs.readdirSync(path.join(root, 'docs', 'js')).sort();
  assert.deepEqual(arquivos, ['account-view.js', 'app.js', 'auth-view.js', 'chart.js', 'data.js', 'dom.js', 'engine.js', 'format.js', 'items-view.js', 'month-view.js', 'proj-view.js', 'sheets.js', 'sim-view.js']);
  ['mi', 'ms', 'normMonth', 'addMonths', 'diffMonths', 'toDbDate', 'cents', 'buildIndex', 'monthView', 'timeline', 'statusOf', 'summarize', 'planEdit', 'planSettle', 'scenario', 'evaluatePurchases', 'minCents', 'monthReport', 'periodReport']
    .forEach((k) => assert.equal(typeof E[k], 'function', 'Engine.' + k));
});
