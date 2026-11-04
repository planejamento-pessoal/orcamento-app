// Testes da aba "Compras" (a PRIORIDADES da planilha): "essa compra cabe no orçamento?".
// (usa só dados inventados — nenhum valor real do orçamento fica no repositório)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../docs/js/engine.js');

// Salário 5.000 e aluguel 3.000 todo mês, desde jan/2026: sobram 2.000 por mês.
// Saldo no fim de: jan 2.000, fev 4.000, mar 6.000, abr 8.000, mai 10.000, jun 12.000...
function base() {
  return {
    items: [
      { id: 's', kind: 'entrada', type: 'renda', name: 'Salário', recurring: true, start_month: '2026-01-01', end_month: null, active: true },
      { id: 'a', kind: 'saida', type: 'conta', name: 'Aluguel', due_day: 5, recurring: true, start_month: '2026-01-01', end_month: null, active: true }
    ],
    rates: [
      { item_id: 's', from_month: '2026-01-01', amount: 5000 },
      { item_id: 'a', from_month: '2026-01-01', amount: 3000 }
    ],
    entries: [], settled: []
  };
}
const SET = { balance_start_month: '2026-01-01', opening_balance: 0, min_balance: 1000 };
const HOJE = '2026-03';
let n = 0;
function compra(o) {
  return Object.assign({ id: 'c' + (++n), name: 'Compra ' + n, priority: 3, status: 'nada', est_amount: 0, final_amount: null, exec_month: null, inst_total: null, inst_count: null, seq: n }, o);
}
function avalia(list, data, settings, opts) {
  return E.evaluatePurchases(data || base(), settings || SET, list, Object.assign({ today: HOJE }, opts || {}));
}
const um = (c) => avalia([c]).items[0];
const R = (x) => Math.round(x * 100);

test('valor da compra: o final (se preenchido) vale mais que o estimado', () => {
  assert.equal(E.purchaseValue({ est_amount: 500, final_amount: null }), 50000);
  assert.equal(E.purchaseValue({ est_amount: 500, final_amount: 0 }), 50000);
  assert.equal(E.purchaseValue({ est_amount: 500, final_amount: '450.50' }), 45050);
  assert.equal(E.purchaseValue({ est_amount: 0, final_amount: 300 }), 30000);
  assert.equal(E.purchaseValue({ est_amount: 0, final_amount: null }), 0);
  assert.equal(E.purchaseValue({ est_amount: '1234.56' }), 123456);
});

test('à vista: cabe quando o menor saldo menos a compra continua no mínimo ou acima', () => {
  const r = um(compra({ est_amount: 500 }));
  assert.equal(r.state, 'ok');
  assert.equal(r.how, 'avista');
  assert.equal(r.cash.fits, true);
  assert.equal(r.cash.min, R(6000));            // saldo de mar/2026, o menor dos próximos meses (só cresce)
  assert.equal(r.cash.minMonth, '2026-03');
  assert.equal(r.cash.after, R(5500));
  assert.equal(r.cash.missing, 0);
  assert.equal(r.from, '2026-03');
  assert.equal(r.late, false);
});

test('à vista: no limite exato do mínimo ainda cabe; um centavo a mais, não', () => {
  assert.equal(um(compra({ est_amount: 5000 })).cash.fits, true);          // 6.000 - 5.000 = 1.000 (= mínimo)
  const r = um(compra({ est_amount: 5000.01 }));
  assert.equal(r.cash.fits, false);
  assert.equal(r.cash.missing, 1);
});

test('à vista que não cabe: diz quanto falta para manter o mínimo', () => {
  const r = um(compra({ est_amount: 7000 }));
  assert.equal(r.cash.fits, false);
  assert.equal(r.cash.after, R(-1000));
  assert.equal(r.cash.missing, R(2000));        // mínimo 1.000 - (-1.000)
});

test('parcelado: quando não cabe à vista mas as parcelas cabem, a melhor forma é parcelar', () => {
  const r = um(compra({ est_amount: 7000, inst_count: 5 }));
  assert.equal(r.how, 'parcelado');
  assert.equal(r.inst.n, 5);
  assert.equal(r.inst.per, R(1400));
  assert.equal(r.inst.total, R(7000));
  assert.equal(r.inst.totalGiven, false);       // sem total informado: usa o valor da compra (sem juros)
  assert.equal(r.inst.fits, true);
  assert.equal(r.inst.min, R(4600));            // mar/2026: 6.000 - 1.400
  assert.equal(r.inst.minMonth, '2026-03');
});

test('parcelado com juros: usa o total informado, não o valor da compra', () => {
  const r = um(compra({ est_amount: 7000, inst_count: 5, inst_total: 8000 }));
  assert.equal(r.inst.total, R(8000));
  assert.equal(r.inst.per, R(1600));
  assert.equal(r.inst.totalGiven, true);
  assert.equal(r.how, 'parcelado');
});

test('parcelado confere o saldo de TODOS os meses das parcelas, não só o do início', () => {
  // despesa grande em jun/2026: o saldo desse mês cai para 3.000
  const d = base();
  d.items.push({ id: 'x', kind: 'saida', type: 'outro', name: 'Imposto', recurring: false, start_month: null, end_month: null, active: true });
  d.entries.push({ item_id: 'x', month: '2026-06-01', amount: 9000 });
  // 6 parcelas de 1.000 a partir de mar: em jun o saldo seria 3.000 - 4 x 1.000 = -1.000
  const r = avalia([compra({ est_amount: 6000, inst_count: 6 })], d).items[0];
  assert.equal(r.inst.fits, false);
  assert.equal(r.inst.minMonth, '2026-06');
  assert.equal(r.how, 'aguardar');
});

test('à vista olha os meses de frente: um mês ruim lá na frente derruba a compra de hoje', () => {
  const d = base();
  d.items.push({ id: 'x', kind: 'saida', type: 'outro', name: 'Imposto', recurring: false, start_month: null, end_month: null, active: true });
  d.entries.push({ item_id: 'x', month: '2026-06-01', amount: 9000 });   // saldo de jun/2026 = 3.000
  const r = avalia([compra({ est_amount: 4000 })], d).items[0];
  assert.equal(r.cash.min, R(3000));
  assert.equal(r.cash.minMonth, '2026-06');
  assert.equal(r.cash.fits, false);              // 3.000 - 4.000 < 1.000, mesmo com 6.000 no caixa em mar
});

test('o horizonte limita até onde se olha (padrão 24 meses)', () => {
  assert.equal(E.PURCHASE_HORIZON, 24);
  const d = base();
  d.items.push({ id: 'x', kind: 'saida', type: 'outro', name: 'Imposto', recurring: false, start_month: null, end_month: null, active: true });
  d.entries.push({ item_id: 'x', month: '2026-12-01', amount: 30000 });  // saldo de dez/2026: 24.000 - 30.000 = -6.000
  const curto = avalia([compra({ est_amount: 500 })], d, SET, { horizon: 3 }).items[0];     // mar, abr, mai
  const longo = avalia([compra({ est_amount: 500 })], d).items[0];
  assert.equal(curto.cash.fits, true);
  assert.equal(longo.cash.fits, false);
  assert.equal(longo.cash.minMonth, '2026-12');
  assert.equal(longo.cash.min, R(-6000));
});

test('aguardar: diz a partir de que mês passa a caber à vista', () => {
  const r = um(compra({ est_amount: 10000 }));
  assert.equal(r.how, 'aguardar');
  assert.equal(r.cash.fits, false);
  assert.equal(r.wait.month, '2026-06');          // jun: 12.000 - 10.000 = 2.000 (mai: 10.000 - 10.000 = 0, não)
  assert.equal(r.wait.minAfter, R(2000));
});

test('aguardar sem previsão: se não cabe nos próximos 3 anos, wait é null', () => {
  const r = um(compra({ est_amount: 1000000 }));
  assert.equal(r.how, 'aguardar');
  assert.equal(r.wait, null);
});

test('mês previsto no passado: avalia a partir de hoje e avisa (late)', () => {
  const r = um(compra({ est_amount: 500, exec_month: '2026-01-01' }));
  assert.equal(r.late, true);
  assert.equal(r.from, '2026-03');
  assert.equal(r.execMonth, '2026-01');
  assert.equal(r.cash.min, R(6000));
});

test('mês previsto no futuro: avalia nesse mês (o saldo de lá, não o de hoje)', () => {
  const r = um(compra({ est_amount: 5000, exec_month: '2026-08-01' }));
  assert.equal(r.late, false);
  assert.equal(r.from, '2026-08');
  assert.equal(r.cash.min, R(16000));             // saldo de ago/2026
  assert.equal(r.cash.after, R(11000));
});

test('mês previsto igual a hoje não é "passado"', () => {
  const r = um(compra({ est_amount: 500, exec_month: '2026-03-01' }));
  assert.equal(r.late, false);
  assert.equal(r.from, '2026-03');
});

test('sem mês previsto: avalia a partir de hoje', () => {
  const r = um(compra({ est_amount: 500, exec_month: null }));
  assert.equal(r.from, '2026-03');
  assert.equal(r.late, false);
  assert.equal(r.execMonth, null);
});

test('compra concluída não é avaliada nem entra na disputa de melhor compra', () => {
  const lista = [compra({ est_amount: 500, priority: 5, status: 'concluido' }), compra({ est_amount: 800, priority: 1 })];
  const r = avalia(lista);
  assert.equal(r.items[0].state, 'concluida');
  assert.equal(r.items[0].how, null);
  assert.equal(r.items[0].cash, null);
  assert.equal(r.best.purchase.priority, 1);
});

test('sem valor: não avalia (a planilha mostrava "-")', () => {
  const r = um(compra({ est_amount: 0, final_amount: null }));
  assert.equal(r.state, 'sem-valor');
  assert.equal(r.how, null);
});

test('saldo ainda não começou: não inventa resposta', () => {
  const r = avalia([compra({ est_amount: 500 })], base(), { balance_start_month: '2035-01-01', opening_balance: 0, min_balance: 1000 }).items[0];
  assert.equal(r.state, 'sem-saldo');
  assert.equal(r.how, null);
});

test('saldo mínimo maior muda o resultado', () => {
  const r = avalia([compra({ est_amount: 5000 })], base(), { balance_start_month: '2026-01-01', opening_balance: 0, min_balance: 2000 }).items[0];
  assert.equal(r.cash.fits, false);               // 6.000 - 5.000 = 1.000 < 2.000
  assert.equal(r.cash.missing, R(1000));
});

test('saldo inicial entra na conta', () => {
  const r = avalia([compra({ est_amount: 5000 })], base(), { balance_start_month: '2026-01-01', opening_balance: 3000, min_balance: 1000 }).items[0];
  assert.equal(r.cash.min, R(9000));
  assert.equal(r.cash.fits, true);
});

test('lista: prioridade maior primeiro; na mesma prioridade, a cadastrada antes (seq)', () => {
  const a = compra({ name: 'A', priority: 2, seq: 1 });
  const b = compra({ name: 'B', priority: 5, seq: 2 });
  const c = compra({ name: 'C', priority: 2, seq: 3 });
  const d = compra({ name: 'D', priority: 5, seq: 0 });
  const e = compra({ name: 'E', priority: 3, seq: 9 });
  assert.deepEqual(avalia([a, b, c, d, e]).items.map((x) => x.purchase.name), ['D', 'B', 'E', 'A', 'C']);
  // sem seq: vale a ordem em que vieram
  const f = compra({ name: 'F', priority: 4, seq: undefined }), g = compra({ name: 'G', priority: 4, seq: undefined });
  delete f.seq; delete g.seq;
  assert.deepEqual(avalia([g, f]).items.map((x) => x.purchase.name), ['G', 'F']);
});

test('melhor compra: maior prioridade; na mesma prioridade, a mais barata; no empate, a primeira', () => {
  const lista = [
    compra({ name: 'barata p3', priority: 3, est_amount: 100 }),
    compra({ name: 'cara p5', priority: 5, est_amount: 3000 }),
    compra({ name: 'media p5', priority: 5, est_amount: 2000 }),
    compra({ name: 'media p5 (repetida)', priority: 5, est_amount: 2000 })
  ];
  assert.equal(avalia(lista).best.purchase.name, 'media p5');
});

test('melhor compra: só entre as que cabem à vista; quem só cabe parcelada fica de reserva', () => {
  const lista = [
    compra({ name: 'p5 só parcelada', priority: 5, est_amount: 7000, inst_count: 5 }),
    compra({ name: 'p2 à vista', priority: 2, est_amount: 300 })
  ];
  const r = avalia(lista);
  assert.equal(r.best.purchase.name, 'p2 à vista');
  assert.equal(r.bestInstallment, null);          // com uma à vista, a reserva não aparece
  const so = avalia([lista[0]]);
  assert.equal(so.best, null);
  assert.equal(so.bestInstallment.purchase.name, 'p5 só parcelada');
});

test('melhor compra: nada cabe -> best e bestInstallment nulos; lista vazia também', () => {
  const r = avalia([compra({ est_amount: 10000 })]);
  assert.equal(r.best, null);
  assert.equal(r.bestInstallment, null);
  const v = avalia([]);
  assert.deepEqual(v.items, []);
  assert.equal(v.best, null);
});

test('saldo de hoje e mínimo vêm junto do resultado', () => {
  const r = avalia([]);
  assert.equal(r.saldoToday, R(6000));
  assert.equal(r.minCents, R(1000));
  assert.equal(r.today, '2026-03');
  assert.equal(r.horizon, 24);
});

test('parcelas: 0, 1 ou vazio não contam como parcelamento', () => {
  assert.equal(um(compra({ est_amount: 500, inst_count: 0 })).inst, null);
  assert.equal(um(compra({ est_amount: 500, inst_count: 1 })).inst, null);
  assert.equal(um(compra({ est_amount: 500, inst_count: null })).inst, null);
});

test('centavos da parcela: a primeira leva a sobra', () => {
  const r = um(compra({ est_amount: 1000, inst_count: 3 }));
  assert.equal(r.inst.per, 33333);
  assert.equal(r.inst.first, 33334);
  assert.equal(r.inst.per * 2 + r.inst.first, 100000);
});

test('simulação gerada pela compra: à vista e parcelada, no formato da aba Simular', () => {
  const r = um(compra({ name: 'Fogão', est_amount: 7000, inst_count: 5, exec_month: '2026-05-01' }));
  assert.deepEqual(E.purchaseSpec(r, 'avista'), { kind: 'saida', name: 'Fogão', start: '2026-05', n: 1, perCents: R(7000), firstCents: R(7000), totalCents: R(7000) });
  assert.deepEqual(E.purchaseSpec(r, 'parcelado'), { kind: 'saida', name: 'Fogão', start: '2026-05', n: 5, perCents: R(1400), firstCents: R(1400), totalCents: R(7000) });
  const sem = um(compra({ name: 'X', est_amount: 100 }));
  assert.equal(E.purchaseSpec(sem, 'parcelado').n, 1);   // sem parcelas informadas: cai para à vista
});

test('a simulação gerada bate com o veredito (a aba Simular concorda com a aba Compras)', () => {
  const lista = [compra({ est_amount: 7000, inst_count: 5 }), compra({ est_amount: 5000 }), compra({ est_amount: 5001 })];
  lista.forEach((c) => {
    const r = avalia([c]).items[0];
    const sp = E.purchaseSpec(r, r.how === 'parcelado' ? 'parcelado' : 'avista');
    const sc = E.scenario(base(), SET, [sp], r.from, 24);
    const cabe = sc.simSummary.min >= E.minCents(SET);
    assert.equal(cabe, r.how !== 'aguardar', 'divergiu em ' + c.est_amount);
  });
});

test('não altera os dados que recebe', () => {
  const d = base(), lista = [compra({ est_amount: 7000, inst_count: 5 })];
  const antes = JSON.stringify([d, lista, SET]);
  avalia(lista, d);
  assert.equal(JSON.stringify([d, lista, SET]), antes);
});

test('sem "hoje" o motor recusa (ele nunca olha o relógio sozinho)', () => {
  assert.throws(() => E.evaluatePurchases(base(), SET, [], {}));
  assert.throws(() => E.evaluatePurchases(base(), SET, []));
});

test('valores vindos do banco como texto ("1000.00") funcionam', () => {
  const r = um(compra({ est_amount: '1000.00', final_amount: '950.50', exec_month: '2026-05-01', inst_total: '1100.00', inst_count: 4 }));
  assert.equal(r.valor, 95050);
  assert.equal(r.inst.total, 110000);
  assert.equal(r.from, '2026-05');
});

// ── conta corrente com saldo real lançado mais à frente ────────────────────
// O saldo real recomeça a conta naquele mês: uma compra feita ANTES dele não mexe nos meses depois dele.
// A aba Simular já mostrava isso; a aba Compras tem que concordar com ela.
//  jan 2.000 | fev 4.000 | mar 6.000 | abr 8.000 | mai 10.000 | jun: saldo real 3.000 + 2.000 = 5.000 | jul 7.000
//  ago: 7.000 + 2.000 - 7.000 (imposto) = 2.000 | set 4.000 | out 6.000 ...
function comSaldoReal() {
  const d = base();
  d.items.push({ id: 'cc', kind: 'entrada', type: 'renda', name: 'Conta', recurring: false, start_month: null, end_month: null, active: true, carry_over: true });
  d.items.push({ id: 'x', kind: 'saida', type: 'outro', name: 'Imposto', recurring: false, start_month: null, end_month: null, active: true });
  d.entries.push({ item_id: 'cc', month: '2026-06-01', amount: 3000 });   // o banco diz 3.000 no começo de junho (o previsto era 10.000)
  d.entries.push({ item_id: 'x', month: '2026-08-01', amount: 7000 });
  d.settings = SET;
  return d;
}

test('saldo real lançado mais à frente apaga o efeito da compra feita antes dele (à vista)', () => {
  const d = comSaldoReal();
  assert.deepEqual(E.timeline(E.buildIndex(d), SET, '2026-03', 6).map((x) => x.saldo), [R(6000), R(8000), R(10000), R(5000), R(7000), R(2000)]);
  const r = avalia([compra({ est_amount: 4500 })], d).items[0];
  assert.equal(r.cash.min, R(2000));                // o menor saldo de hoje (sem a compra) é o de ago
  assert.equal(r.cash.minMonth, '2026-08');
  assert.equal(r.cash.after, R(1500));              // com a compra: mar 6.000 - 4.500 = 1.500 (de jun em diante o saldo real manda: nada muda)
  assert.equal(r.cash.afterMonth, '2026-03');
  assert.equal(r.cash.fits, true);
  assert.equal(r.how, 'avista');
  // o cálculo antigo (menor saldo - valor = 2.000 - 4.500 = -2.500) dizia "não cabe" por engano
  assert.equal(r.cash.min - R(4500) < E.minCents(SET), true);
});

test('saldo real no próprio mês da compra não apaga o efeito dela (ele só vale para os meses seguintes)', () => {
  const d = comSaldoReal();
  const r = avalia([compra({ est_amount: 4000, exec_month: '2026-06-01' })], d).items[0];
  assert.equal(r.from, '2026-06');
  assert.equal(r.cash.after, R(-2000));             // jun 1.000, jul 3.000, ago 2.000 - 4.000 = -2.000
  assert.equal(r.cash.afterMonth, '2026-08');
  assert.equal(r.cash.fits, false);
});

test('aguardar: com saldo real lançado mais à frente, o mês em que passa a caber vem do mesmo cálculo', () => {
  const d = comSaldoReal();
  const r = avalia([compra({ est_amount: 5500 })], d).items[0];
  assert.equal(r.cash.after, R(500));               // mar: 6.000 - 5.500
  assert.equal(r.cash.afterMonth, '2026-03');
  assert.equal(r.cash.missing, R(500));
  assert.equal(r.how, 'aguardar');
  assert.equal(r.wait.month, '2026-04');            // abr: 8.000 - 5.500 = 2.500; o saldo real de jun apaga a compra; o menor depois é ago (2.000)
  assert.equal(r.wait.minAfter, R(2000));
  assert.equal(r.wait.minMonth, '2026-08');
});

test('à vista: o veredito e o "menor saldo" batem com a aba Simular, com e sem saldo real lançado', () => {
  const valores = [500, 1500, 3999, 4000, 4500, 5000, 5500, 6000, 8000, 12000];
  const meses = [null, '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
  [comSaldoReal(), base()].forEach((d, di) => {
    valores.forEach((v) => meses.forEach((m) => {
      const r = avalia([compra({ est_amount: v, exec_month: m })], d).items[0];
      const sc = E.scenario(d, SET, [E.purchaseSpec(r, 'avista')], r.from, 24);
      const onde = ' (dados ' + di + ', valor ' + v + ', mês ' + m + ')';
      assert.equal(r.cash.after, sc.simSummary.min, 'menor saldo' + onde);
      assert.equal(r.cash.afterMonth, sc.simSummary.minMonth, 'mês do menor saldo' + onde);
      assert.equal(r.cash.fits, sc.simSummary.min >= E.minCents(SET), 'cabe' + onde);
      if (r.how === 'aguardar' && r.wait) {                           // o mês indicado cabe de verdade, e o anterior a ele (se existir) não
        const k = E.diffMonths(r.from, r.wait.month);
        const depois = E.scenario(d, SET, [{ kind: 'saida', name: 'c', start: r.wait.month, n: 1, perCents: R(v), firstCents: R(v) }], r.wait.month, 24);
        assert.equal(depois.simSummary.min >= E.minCents(SET), true, 'cabe no mês indicado' + onde);
        assert.equal(depois.simSummary.min, r.wait.minAfter, 'menor saldo no mês indicado' + onde);
        if (k > 0) {
          const antes = E.addMonths(r.wait.month, -1);
          const s2 = E.scenario(d, SET, [{ kind: 'saida', name: 'c', start: antes, n: 1, perCents: R(v), firstCents: R(v) }], antes, 24);
          assert.equal(s2.simSummary.min >= E.minCents(SET), false, 'não cabe no mês anterior' + onde);
        }
      }
    }));
  });
});
