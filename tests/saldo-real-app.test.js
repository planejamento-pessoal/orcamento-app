'use strict';
// Testa, SEM rede e SEM navegador, a parte do app que liga o saldo lido da 99Pay às contas do mês (versão 1.5.0):
//  • data.js: leitura das marcas COM hora (coluna settled_at) e o que fazer quando o banco ainda não tem a coluna;
//  • data.js: saldoReal (a leitura que vira ponto de partida do mês atual), sameSaldoReal e markTime;
//  • o saldo lido nunca vai para a cópia do aparelho (loadAll e patchCache);
//  • travas estáticas de app.js, month-view.js, sheets.js e do arquivo 03 do Supabase.
// (As contas em si são testadas em saldo-real.test.js. A tela é conferida num navegador de verdade, fora destes testes.)
// Só dados INVENTADOS: nada daqui vem do orçamento de verdade.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const Format = require('../docs/js/format.js');

// objetos criados dentro do vm vêm de outro "mundo" (outro Object.prototype): para comparar com deepEqual, passa por JSON
const plain = (x) => JSON.parse(JSON.stringify(x));
const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';
const PUB = 'sb_publishable_TesteLocal0123456789abcdefXYZ';

// ── data.js num "navegador" mínimo: Supabase de mentira (consultas) e localStorage na memória ───────────────────────
// fake.query(q) recebe { tabela, select, orders, range } e devolve { data, error }.
function boot(fake) {
  const calls = { query: [] };
  const mem = new Map();
  const ctx = {
    URL, atob, console, Promise, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } }
  };
  ctx.window = ctx;
  ctx.Engine = {};
  ctx.Format = Format;
  ctx.APP_CONFIG = { SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: PUB };
  ctx.supabase = {
    createClient: () => ({
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null }) },
      from: (tabela) => {
        const q = { tabela, select: null, orders: [], range: null };
        const b = {
          select: (c) => { q.select = c; return b; },
          order: (c, o) => { q.orders.push([c, o]); return b; },
          range: (a, z) => { q.range = [a, z]; return b; },
          then: (ok, ko) => { calls.query.push(q); return Promise.resolve().then(() => fake.query(q)).then(ok, ko); }
        };
        return b;
      }
    })
  };
  vm.createContext(ctx);
  vm.runInContext(read('docs', 'js', 'data.js'), ctx, { filename: 'data.js' });
  assert.equal(ctx.App.data.init(), true, 'init() do data.js falhou: ' + ctx.App.data.problem());
  return { D: ctx.App.data, calls, mem };
}
// as outras tabelas do loadAll respondem vazio; budget_settled quem responde é o teste
const VAZIO = { data: [], error: null };
const AJUSTES = { data: [{ balance_start_month: '2026-01-01', opening_balance: 0, min_balance: 1000 }], error: null };
function banco(settled) {
  return {
    query: (q) => {
      if (q.tabela === 'app_settings') return AJUSTES;
      if (q.tabela === 'budget_settled') return settled(q);
      return VAZIO;
    }
  };
}
const marcasDoBanco = (q) => q.tabela === 'budget_settled' ? q : null;
const pedidosDeMarcas = (calls) => calls.query.filter(marcasDoBanco);

const MARCAS = [
  { item_id: 'i1', month: '2026-03-01', settled_at: '2026-03-10T14:00:00.123456+00:00' },
  { item_id: 'i2', month: '2026-03-01', settled_at: null }
];
const SEM_HORA = MARCAS.map((m) => ({ item_id: m.item_id, month: m.month }));

// ── marcas com hora: loadAll / fetchSettled ──────────────────────────────────────────────────────────────────────────
test('loadAll: pede a hora das marcas (settled_at) e avisa que o banco já tem a coluna', async () => {
  const { D, calls } = boot(banco(() => ({ data: MARCAS, error: null })));
  const r = await D.loadAll('u1');
  assert.equal(r.ok, true);
  assert.equal(r.data.settledOk, true);
  assert.equal(r.data.settledAtOk, true);
  assert.deepEqual(plain(r.data.settled), MARCAS, 'as marcas chegam com a hora (e a marca antiga, sem hora, continua sem)');
  const qs = pedidosDeMarcas(calls);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].select, 'item_id,month,settled_at');
  assert.ok(!('saldoReal' in r.data), 'o saldo lido da 99Pay nunca vem do banco de orçamento: é posto depois, na memória');
});

test('loadAll: banco sem a coluna settled_at — pede de novo só item e mês, e avisa (settledAtOk=false)', async () => {
  const erros = [
    { code: '42703', message: 'column budget_settled.settled_at does not exist' },                         // Postgres
    { code: 'PGRST204', message: "Could not find the 'settled_at' column of 'budget_settled' in the schema cache" },   // PostgREST
    { message: 'column "settled_at" does not exist' },                                                       // sem código
    { code: '42703', message: 'qualquer texto' }                                                              // só o código
  ];
  for (const erro of erros) {
    const { D, calls } = boot(banco((q) => (/settled_at/.test(q.select) ? { data: null, error: erro } : { data: SEM_HORA, error: null })));
    const r = await D.loadAll('u1');
    assert.equal(r.ok, true, JSON.stringify(erro));
    assert.equal(r.data.settledOk, true, 'a tabela existe: a chavinha de pago/recebido continua ligada');
    assert.equal(r.data.settledAtOk, false, 'sem a coluna o saldo lido não pode entrar nas contas');
    assert.deepEqual(plain(r.data.settled), SEM_HORA);
    assert.deepEqual(pedidosDeMarcas(calls).map((q) => q.select), ['item_id,month,settled_at', 'item_id,month'], JSON.stringify(erro));
  }
});

test('loadAll: o erro de "coluna não existe" também cita a tabela, mas não é "tabela não existe"', async () => {
  // se o app conferisse a TABELA primeiro, trataria isto como "sem marcas" e a chavinha sumiria à toa
  const { D } = boot(banco((q) => (/settled_at/.test(q.select)
    ? { data: null, error: { code: '42703', message: 'column budget_settled.settled_at does not exist' } }
    : { data: SEM_HORA, error: null })));
  const r = await D.loadAll('u1');
  assert.equal(r.data.settledOk, true);
  assert.equal(r.data.settled.length, 2);
});

test('loadAll: banco sem a tabela de marcas — como antes (settledOk=false), e sem segunda tentativa', async () => {
  const erros = [
    { code: '42P01', message: 'relation "public.budget_settled" does not exist' },
    { code: 'PGRST205', message: "Could not find the table 'public.budget_settled' in the schema cache" }
  ];
  for (const erro of erros) {
    const { D, calls } = boot(banco(() => ({ data: null, error: erro })));
    const r = await D.loadAll('u1');
    assert.equal(r.ok, true, erro.code);
    assert.equal(r.data.settledOk, false, erro.code);
    assert.equal(r.data.settledAtOk, false, erro.code);
    assert.deepEqual(plain(r.data.settled), []);
    assert.equal(pedidosDeMarcas(calls).length, 1, 'sem a tabela não adianta pedir de novo: ' + erro.code);
  }
});

test('loadAll: sem a coluna e a segunda tentativa também sem a tabela — settledOk=false', async () => {
  const { D } = boot(banco((q) => (/settled_at/.test(q.select)
    ? { data: null, error: { code: '42703', message: 'column budget_settled.settled_at does not exist' } }
    : { data: null, error: { code: '42P01', message: 'relation "public.budget_settled" does not exist' } })));
  const r = await D.loadAll('u1');
  assert.equal(r.ok, true);
  assert.equal(r.data.settledOk, false);
  assert.equal(r.data.settledAtOk, false);
});

test('loadAll: outro erro nas marcas (permissão, rede) continua sendo erro, sem segunda tentativa', async () => {
  for (const erro of [{ code: '42501', message: 'permission denied for table budget_settled' }, { message: 'Failed to fetch' }]) {
    const { D, calls } = boot(banco(() => ({ data: null, error: erro })));
    const r = await D.loadAll('u1');
    assert.equal(r.ok, false, JSON.stringify(erro));
    assert.equal(pedidosDeMarcas(calls).length, 1, JSON.stringify(erro));
  }
});

test('loadAll: mais de 1000 marcas vêm em páginas, sempre pedindo a hora', async () => {
  const todas = Array.from({ length: 1005 }, (_, i) => ({ item_id: 'i' + i, month: '2026-03-01', settled_at: null }));
  const { D, calls } = boot(banco((q) => ({ data: todas.slice(q.range[0], q.range[1] + 1), error: null })));
  const r = await D.loadAll('u1');
  assert.equal(r.ok, true);
  assert.equal(r.data.settled.length, 1005);
  const qs = pedidosDeMarcas(calls);
  assert.deepEqual(qs.map((q) => q.range), [[0, 999], [1000, 1999]]);
  assert.ok(qs.every((q) => q.select === 'item_id,month,settled_at'));
  assert.equal(r.data.settledAtOk, true);
});

test('loadAll: a cópia do aparelho guarda settledAtOk e nunca o saldo lido da 99Pay', async () => {
  const { D, mem } = boot(banco(() => ({ data: MARCAS, error: null })));
  const r = await D.loadAll('u1');
  assert.equal(r.ok, true);
  const guardado = D.readCache('u1');
  assert.equal(guardado.data.settledAtOk, true);
  assert.ok(!JSON.stringify([...mem.entries()]).includes('saldoReal'));
});

// ── patchCache: o saldo lido nunca vai para o aparelho ────────────────────────────────────────────────────────────────
test('patchCache: grava os dados novos mantendo a data da cópia e SEM o saldo lido (data.saldoReal)', () => {
  const { D, mem } = boot({ query: () => VAZIO });
  D.store.set('orc.cache.v1:u1', { at: 1234, data: { items: [], settled: [] } });
  const dados = { items: [{ id: 'i1' }], settled: [{ item_id: 'i1', month: '2026-03-01', settled_at: '2026-03-15T12:00:00.000Z' }], settledAtOk: true,
    saldoReal: { month: '2026-03', cents: 100000, asOf: '2026-03-15T12:00:00+00:00' } };
  D.patchCache('u1', dados);
  const c = D.readCache('u1');
  assert.equal(c.at, 1234, 'a data em que a cópia foi baixada do servidor não muda');
  assert.deepEqual(plain(c.data.settled), plain(dados.settled));
  assert.equal(c.data.settledAtOk, true);
  assert.ok(!('saldoReal' in c.data));
  assert.ok(!JSON.stringify([...mem.entries()]).includes('saldoReal') && !JSON.stringify([...mem.entries()]).includes('100000'));
  assert.ok('saldoReal' in dados, 'os dados da tela não são alterados');
});

test('patchCache: sem cópia no aparelho não cria nenhuma', () => {
  const { D, mem } = boot({ query: () => VAZIO });
  D.patchCache('u1', { items: [], saldoReal: { month: '2026-03', cents: 1, asOf: '2026-03-15T12:00:00Z' } });
  assert.equal(mem.size, 0);
});

// ── saldoReal: a leitura vira ponto de partida do mês atual ─────────────────────────────────────────────────────────
// As datas são montadas na hora local do aparelho (como o app faz), para o teste valer em qualquer fuso.
const local = (y, mes, dia, h = 12, min = 0) => new Date(y, mes - 1, dia, h, min, 0, 0);
const bom = (dataAt, cents = 100000) => ({ has: true, cents, dataAt, readAt: dataAt, old: false, itemStatus: 'UPDATED', pending: false, fail: null });

test('saldoReal: dado do mês atual vale e devolve mês, saldo e o horário do dado, como veio', () => {
  const { D } = boot({ query: () => VAZIO });
  const dado = local(2026, 3, 15).toISOString();
  const agora = local(2026, 3, 15, 18).getTime();
  assert.deepEqual(plain(D.saldoReal(bom(dado, 123456), agora)), { month: '2026-03', cents: 123456, asOf: dado });
  assert.deepEqual(plain(D.saldoReal(bom(dado, -4500), agora)), { month: '2026-03', cents: -4500, asOf: dado }, 'saldo negativo também vale');
  assert.equal(D.saldoReal(bom(dado, 0), agora).cents, 0, 'saldo zero é um saldo (não "sem leitura")');
});

test('saldoReal: dado velho (mais de 30 h) do mesmo mês ainda vale — a tela é que avisa "Desatualizado"', () => {
  const { D } = boot({ query: () => VAZIO });
  const dado = local(2026, 3, 10).toISOString();
  const agora = local(2026, 3, 20).getTime();
  const sum = Object.assign(bom(dado), { old: true });
  assert.ok(D.saldoReal(sum, agora));
});

test('saldoReal: dado de OUTRO mês não vale (virou o mês e ainda não houve leitura nova)', () => {
  const { D } = boot({ query: () => VAZIO });
  const dado = local(2026, 2, 28, 23, 50).toISOString();
  assert.equal(D.saldoReal(bom(dado), local(2026, 3, 1, 0, 10).getTime()), null);
  assert.equal(D.saldoReal(bom(dado), local(2026, 2, 28, 23, 59).getTime()).month, '2026-02', 'no mesmo mês vale');
  // ano novo: dezembro -> janeiro
  const dez = local(2026, 12, 31, 23, 0).toISOString();
  assert.equal(D.saldoReal(bom(dez), local(2027, 1, 1, 0, 30).getTime()), null);
  // dado "do futuro" (relógio do aparelho atrasado) em outro mês também não vale
  assert.equal(D.saldoReal(bom(local(2026, 4, 2).toISOString()), local(2026, 3, 31).getTime()), null);
});

test('saldoReal: sem leitura boa, saldo fora do formato ou horário ilegível devolve null', () => {
  const { D } = boot({ query: () => VAZIO });
  const dado = local(2026, 3, 15).toISOString(), agora = local(2026, 3, 15, 18).getTime();
  const ruins = [
    null, undefined, {}, 'lixo', { has: false, cents: null },
    Object.assign(bom(dado), { has: false }),
    bom(dado, 1000.5), bom(dado, NaN), bom(dado, Infinity), bom(dado, '100000'), bom(dado, null),
    bom('ontem'), bom(''), bom(null), bom(undefined)
  ];
  for (const s of ruins) assert.equal(D.saldoReal(s, agora), null, JSON.stringify(s));
});

test('saldoReal: sem "agora" usa o relógio do aparelho', () => {
  const { D } = boot({ query: () => VAZIO });
  const agora = new Date();
  const r = D.saldoReal(bom(agora.toISOString(), 777));
  assert.equal(r.cents, 777);
  assert.equal(r.month, Format.currentMonth(agora));
});

// ── sameSaldoReal ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('sameSaldoReal: compara mês, saldo e o INSTANTE (não o texto) do dado', () => {
  const { D } = boot({ query: () => VAZIO });
  const a = { month: '2026-03', cents: 100000, asOf: '2026-03-15T12:00:00.000Z' };
  assert.equal(D.sameSaldoReal(null, null), true);
  assert.equal(D.sameSaldoReal(undefined, null), true);
  assert.equal(D.sameSaldoReal(a, null), false);
  assert.equal(D.sameSaldoReal(null, a), false);
  assert.equal(D.sameSaldoReal(a, Object.assign({}, a)), true);
  assert.equal(D.sameSaldoReal(a, Object.assign({}, a, { asOf: '2026-03-15T12:00:00+00:00' })), true, '"Z" e "+00:00" são o mesmo instante');
  assert.equal(D.sameSaldoReal(a, Object.assign({}, a, { asOf: '2026-03-15T12:00:00.000456+00:00' })), true, 'frações além do milissegundo são cortadas (o Supabase manda 6 casas)');
  assert.equal(D.sameSaldoReal(a, Object.assign({}, a, { asOf: '2026-03-15T12:00:00.123456+00:00' })), false, '123 ms depois é outro instante');
  assert.equal(D.sameSaldoReal(a, Object.assign({}, a, { asOf: '2026-03-15T12:00:01.000Z' })), false);
  assert.equal(D.sameSaldoReal(a, Object.assign({}, a, { asOf: 'lixo' })), false, 'horário ilegível nunca é "igual"');
  assert.equal(D.sameSaldoReal(a, Object.assign({}, a, { cents: 100001 })), false);
  assert.equal(D.sameSaldoReal(a, Object.assign({}, a, { month: '2026-04' })), false);
});

// ── markTime: a hora da marca que o aparelho usa até o banco gravar a dele ────────────────────────────────────────────────
test('markTime: sem saldo lido é "agora"; com saldo lido nunca fica antes da leitura', () => {
  const { D } = boot({ query: () => VAZIO });
  const antes = Date.now();
  const t1 = Date.parse(D.markTime({ items: [] }));
  assert.ok(t1 >= antes && t1 <= Date.now() + 5, 'sem leitura: agora');
  assert.ok(!isNaN(Date.parse(D.markTime(null))), 'sem dados também funciona');

  // leitura antiga: "agora" já é depois dela
  const passado = { saldoReal: { month: '2026-03', cents: 1, asOf: new Date(Date.now() - 3600 * 1000).toISOString() } };
  const t2 = Date.parse(D.markTime(passado));
  assert.ok(t2 >= antes && t2 <= Date.now() + 5);

  // leitura "do futuro" (relógio do aparelho atrasado): a marca nova fica 1 s depois dela, para não ser tratada como
  // "já está no saldo" (senão a sobra pularia ao marcar, antes de o banco atualizar)
  const asOf = Date.now() + 2 * 3600 * 1000;
  const futuro = { saldoReal: { month: '2026-03', cents: 1, asOf: new Date(asOf).toISOString() } };
  assert.equal(Date.parse(D.markTime(futuro)), asOf + 1000);
  // horário da leitura ilegível: usa "agora"
  const t3 = Date.parse(D.markTime({ saldoReal: { month: '2026-03', cents: 1, asOf: 'lixo' } }));
  assert.ok(t3 >= antes && t3 <= Date.now() + 5);
});

test('markTime + motor: a marca que acabou de ser feita segue "a pagar" até o banco atualizar (a sobra não pula)', () => {
  const { D } = boot({ query: () => VAZIO });
  const E = require('../docs/js/engine.js');
  const M = Format.currentMonth(new Date());
  const base = (leitura, settled) => ({
    items: [
      { id: 'cc', kind: 'entrada', type: 'renda', name: 'Conta', due_day: null, recurring: false, start_month: null, end_month: null, active: true, carry_over: true },
      { id: 'alu', kind: 'saida', type: 'conta', name: 'Aluguel', due_day: 10, recurring: true, start_month: M + '-01', end_month: null, active: true, carry_over: false }
    ],
    rates: [{ item_id: 'alu', from_month: M + '-01', amount: 200 }],
    entries: [], settled, settings: { balance_start_month: M + '-01', opening_balance: 0, min_balance: 100 },
    saldoReal: leitura
  });
  const hora = (ms) => new Date(Date.now() + ms).toISOString();
  // leitura de 1 h atrás, e também uma "do futuro" (relógio do aparelho atrasado): nos dois casos a marca nova é DEPOIS dela
  for (const asOf of [hora(-3600 * 1000), hora(2 * 3600 * 1000)]) {
    const leitura = { month: M, cents: 100000, asOf };
    const antes = base(leitura, []);
    const v0 = E.monthView(E.buildIndex(antes), M).live;
    assert.equal(v0.pagar, 20000); assert.equal(v0.sobra, 80000);

    const marca = { item_id: 'alu', month: M + '-01', settled_at: D.markTime(antes) };       // o que month-view.js (withMark) faz
    const v1 = E.monthView(E.buildIndex(base(leitura, [marca])), M).live;
    assert.equal(v1.sobra, 80000, 'a sobra não pula ao marcar: ' + asOf);
    assert.equal(v1.pagar, 20000, 'o aluguel segue "a pagar" até o banco atualizar');
    assert.equal(v1.tarde.nSaidas, 1); assert.equal(v1.tarde.saidas, 20000);
    assert.equal(v1.feito.nSaidas, 0);

    // o banco atualiza depois da marca: o aluguel entra no saldo lido (que já caiu 200) e a sobra continua a mesma
    const depois = { month: M, cents: 80000, asOf: new Date(Date.parse(marca.settled_at) + 60 * 1000).toISOString() };
    const v2 = E.monthView(E.buildIndex(base(depois, [marca])), M).live;
    assert.equal(v2.sobra, 80000);
    assert.equal(v2.pagar, 0); assert.equal(v2.feito.saidas, 20000); assert.equal(v2.tarde.nSaidas, 0);
  }
});

// ── travas estáticas ────────────────────────────────────────────────────────────────────────────────────────────────────
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const funcao = (src, nome) => {
  const i = src.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'não achei a função ' + nome);
  let nivel = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') nivel++;
    else if (src[k] === '}' && --nivel === 0) return src.slice(i, k + 1);
  }
  throw new Error('chaves desbalanceadas em ' + nome);
};

test('app.js: o saldo lido só entra nos dados para o admin, com a tabela instalada e a coluna das horas', () => {
  const a = semComentarios(read('docs', 'js', 'app.js'));
  const w = funcao(a, 'liveWanted');
  assert.match(w, /!App\.isAdmin\(\)/);
  assert.match(w, /S\.installed !== true/);
  assert.match(w, /dt\.settledOk === false \|\| dt\.settledAtOk !== true/);
  assert.match(w, /D\.saldoReal\(D\.saldo99Summary\(S\.rows, now\), now\)/);
  assert.match(w, /return null;/);
  const s = funcao(a, 'syncLive');
  assert.match(s, /D\.sameSaldoReal\(want, state\.data\.saldoReal \|\| null\)\) return false/, 'sem mudança não refaz o índice');
  assert.match(s, /Object\.assign\(\{\}, state\.data\)/, 'objeto NOVO: o índice (App.index) se refaz sozinho');
  assert.match(s, /if \(want\) nd\.saldoReal = want; else delete nd\.saldoReal;/);
  assert.match(s, /state\.data = nd;\s*return true;/);
  // o saldo lido só passa por aqui: nenhuma outra linha do app.js escreve em saldoReal nem guarda no aparelho
  assert.equal([...a.matchAll(/\.saldoReal\s*=/g)].length, 1, 'uma única atribuição a .saldoReal (em syncLive)');
  assert.ok(!/(store|localStorage|sessionStorage)[^;\n]*saldoReal|saldoReal[^;\n]*(store|localStorage|sessionStorage)/.test(a));
});

test('app.js: toda mudança na leitura (e todo carregamento de dados) passa por syncLive antes de redesenhar', () => {
  const a = semComentarios(read('docs', 'js', 'app.js'));
  const d = funcao(a, 's99Draw');
  assert.match(d, /if \(syncLive\(\)\) \{ App\.render\(true\); return; \}/);
  assert.match(d, /saldo99Refresh/, 'sem mudança nas contas, só o cartão é redesenhado (a lista não pula)');
  assert.ok(d.indexOf('syncLive()') < d.indexOf('saldo99Refresh'));
  // carregamento: depois de state.data = r.data e antes de desenhar
  const i = a.indexOf('state.data = r.data;'), j = a.indexOf('syncLive();', i), k = a.indexOf('App.render(true);', i);
  assert.ok(i > 0 && j > i && k > j, 'syncLive vem entre "state.data = r.data" e "App.render(true)"');
  // quem deixa de ser admin perde o saldo lido junto com o cartão (s99Draw -> syncLive -> liveWanted devolve null)
  assert.match(a, /!App\.isAdmin\(\) && state\.saldo99\) \{ state\.saldo99 = null; s99Draw\(\); \}/);
  // sair/ser bloqueado: state.data vira null, então o saldo lido some junto
  assert.equal([...a.matchAll(/state\.data = null;/g)].length >= 5, true);
});

test('app.js: a versão é 1.6.1 e o saldo lido nunca vira parte da cópia do aparelho (cache.data)', () => {
  const a = read('docs', 'js', 'app.js');
  assert.match(a, /App\.version = '1\.6\.1';/);
  const cache = a.indexOf('state.data = cache.data');
  assert.ok(cache > 0, 'a cópia do aparelho só alimenta state.data na abertura');
});

test('month-view.js: a marca nova leva só uma hora provisória na tela; o banco é que carimba (o app nunca manda settled_at)', () => {
  const m = semComentarios(read('docs', 'js', 'month-view.js'));
  assert.match(m, /settled_at: App\.data\.markTime\(data\)/);
  assert.equal([...m.matchAll(/settled_at/g)].length, 1, 'month-view.js só cita settled_at ao montar a marca da tela');
  const d = semComentarios(read('docs', 'js', 'data.js'));
  assert.match(d, /upsert\(\{ item_id: itemId, month: month \}, \{ onConflict: 'item_id,month', ignoreDuplicates: true \}\)/);
  // o único lugar onde data.js fala em settled_at é a leitura (select) e o aviso de coluna que falta
  const lugares = d.split('\n').filter((l) => /settled_at/.test(l));
  assert.ok(lugares.every((l) => /item_id,month,settled_at|missingColumn|settled_at'\)|settledAt/.test(l)), lugares.join('\n'));
  assert.ok(!/(insert|upsert|update)\([^)]*settled_at/.test(d), 'nenhuma gravação manda settled_at');
});

test('month-view.js: com v.live o resumo parte do saldo da 99Pay; sem ele o resumo é o de sempre', () => {
  const m = read('docs', 'js', 'month-view.js');
  assert.match(m, /if \(live\) main\.appendChild\(liveExtrato\(live, info, chip, saldoCls, month\)\);/);
  assert.match(m, /Saldo acumulado no fim do mês/, 'o resumo de sempre continua lá');
  assert.match(m, /'Sobra prevista no fim do mês'/);
  assert.match(m, /'Saldo na 99Pay'/);
  assert.match(m, /var live = v\.live, info = live \? liveInfo\(live, Date\.now\(\)\) : null;/);
  // a linha da conta corrente: no mês "ao vivo" o toque lê a 99Pay de novo, nos outros abre a edição
  assert.match(m, /var open = c\.live \? function \(\) \{ App\.saldo99Read\('manual'\); \} : function \(\) \{ App\.sheets\.openLaunch\(it\.id, month\); \};/);
  // o cartão diz por que o saldo ainda não entra nas contas (e cita o arquivo certo)
  assert.match(m, /03_marcas_com_hora\.sql/);
  assert.match(m, /Puxar a sobra do mês anterior/);
  assert.ok(fs.existsSync(path.join(root, 'supabase', '03_marcas_com_hora.sql')));
});

test('month-view.js: a leitura nunca soma nada por conta própria (só o motor usa o saldo lido)', () => {
  const m = semComentarios(read('docs', 'js', 'month-view.js'));
  // nenhuma conta com o saldo lido na tela: tudo vem de v.live (motor) e saldo99Summary só informa data e idade
  assert.ok(!/sum\.cents\s*[-+*]|[-+*]\s*sum\.cents|S\.rows[^;\n]*[-+*]\s*\d/.test(m));
  assert.ok(!/saldoReal/.test(m), 'month-view.js não mexe no saldoReal (isso é do app.js)');
});

test('sheets.js: na conta corrente do mês "ao vivo" a edição explica que o saldo vem da 99Pay e esconde "Já recebi"', () => {
  const s = read('docs', 'js', 'sheets.js');
  assert.match(s, /var liveCC = isCC && E\.isLive\(idx, month\);/);
  assert.match(s, /não precisa digitar/);
  assert.match(s, /\|\| !!carry \|\| liveCC\)/, 'a conta corrente do mês ao vivo não tem "Já recebi"');
  assert.match(s, /var valLabel = liveCC \?/);
});

test('proj-view.js: no mês com o saldo lido a tabela e o balão mostram o que fecha com o saldo; nos outros meses nada muda', () => {
  const raw = read('docs', 'js', 'proj-view.js');
  const p = semComentarios(raw);
  // tabela: resultado do mês da leitura = quanto o saldo muda (p.live.variacao); nos outros meses, o resultado de sempre
  assert.match(p, /var res = p\.live \? p\.live\.variacao : p\.resultado;/);
  assert.match(p, /F\.money\(res, \{ sign: true, bare: true \}\)/);
  assert.match(p, /': resultado ' \+ F\.money\(res, \{ sign: true \}\)/);
  assert.ok(!/p\.resultado/.test(p.replace('var res = p.live ? p.live.variacao : p.resultado;', '').replace("['Resultado', F.money(p.resultado, { sign: true })]", '')),
    'fora do mês da leitura, só estes dois usos de p.resultado');
  // balão: com `live` mostra saldo lido, a receber, a pagar e o resultado; sem ele, as linhas de sempre
  assert.match(p, /if \(p\.live\) return \[\['Saldo na 99Pay', F\.money\(p\.live\.cents\)\], \['A receber', F\.money\(p\.live\.receber\)\], \['A pagar', F\.money\(p\.live\.pagar\)\], \['Resultado', F\.money\(p\.live\.variacao, \{ sign: true \}\)\], sit\];/);
  assert.match(p, /return \[\['Entradas', F\.money\(p\.entradas\)\], \['Saídas', F\.money\(p\.saidas\)\], \['Resultado', F\.money\(p\.resultado, \{ sign: true \}\)\], sit\];/);
  // nota embaixo da tabela: de onde vem o número do mês da leitura (só aparece quando a janela tem esse mês)
  assert.match(p, /if \(lv\) main\.appendChild/);
  assert.match(raw, /parte do saldo que a 99Pay informou/);
  // a tela só LÊ o que o motor devolveu: nenhuma conta com o saldo lido aqui
  assert.ok(!/saldoReal|saldo99|App\.data/.test(p), 'proj-view.js não mexe na leitura (isso é do app.js e do motor)');
  assert.ok(!/p\.live\.(cents|receber|pagar|variacao)\s*[-+*]|[-+*]\s*p\.live\./.test(p), 'proj-view.js não faz contas com o saldo lido');
});

test('o app não ganhou endereços de internet novos (continua só o Supabase, o link "Abrir MeuPluggy" e a verificação do Cloudflare)', () => {
  // (a lista de arquivos de docs/js é travada por launcher.test.js)
  const arquivos = fs.readdirSync(path.join(root, 'docs', 'js'));
  const todos = arquivos.map((f) => semComentarios(read('docs', 'js', f))).join('\n');
  const hosts = new Set([...todos.matchAll(/https?:\/\/([^\s'"/)]+)/g)].map((x) => x[1]));
  for (const h of hosts) assert.ok(/^(meu\.pluggy\.ai|www\.w3\.org|challenges\.cloudflare\.com)$/.test(h) || /supabase\.co/.test(h), 'endereço novo: ' + h);
  // o Cloudflare (verificação de segurança) só aparece no auth-view.js, que é quem carrega o script dele
  for (const f of arquivos) {
    const t = semComentarios(read('docs', 'js', f));
    assert.equal(/challenges\.cloudflare\.com/.test(t), f === 'auth-view.js', 'o endereço do Cloudflare deve existir só em auth-view.js (achei em ' + f + ')');
  }
});

test('03_marcas_com_hora.sql: só ACRESCENTA a coluna (sem apagar, sem mexer em valores) e confere tudo antes de valer', () => {
  const sql = read('supabase', '03_marcas_com_hora.sql');
  const codigo = sql.replace(/--.*$/gm, '');
  const comandos = codigo.replace(/'(?:[^']|'')*'/g, "''");                 // sem os textos entre aspas (mensagens e listas de nomes)
  assert.match(comandos, /^\s*begin;/m);
  assert.match(comandos, /commit;\s*$/m);
  assert.ok(!/\bdrop\b|\bdelete\s+from\b|\btruncate\b|\binsert\s+into\b|\bgrant\b|\brevoke\b|\bcreate\s+policy\b|\balter\s+policy\b|\bdisable\s+row\b|\bcreate\s+(or\s+replace\s+)?function\b/i.test(comandos), 'nada de apagar, dar permissão, mexer em regras ou criar funções');
  assert.ok(!/\bupdate\s+public\./i.test(comandos) && !/\bupdate\s+budget_settled\b/i.test(comandos), 'nenhuma marca existente é alterada');
  // o único comando que muda o banco é o acréscimo da coluna (mais o padrão e o comentário dela)
  const alteracoes = comandos.split(';').map((s) => s.trim()).filter((s) => /^(alter|create|comment|insert|update|delete)\b/i.test(s));
  assert.ok(alteracoes.length >= 3 && alteracoes.every((s) => /settled_at/.test(s)), 'só a coluna settled_at é tocada: ' + alteracoes.join(' | '));
  const passo1 = codigo.indexOf('add column if not exists settled_at timestamptz;');
  const passo2 = codigo.indexOf('alter column settled_at set default now()');
  assert.ok(passo1 > 0 && passo2 > passo1, 'primeiro cria a coluna SEM padrão e só depois liga o padrão "agora"');
  assert.match(codigo, /VERIFICACAO_FALHOU: marcas antigas ganharam hora/);
  assert.match(codigo, /RODE_O_01_ANTES/);
  assert.match(codigo, /not a\.attnotnull/, 'a coluna aceita vazio (marcas antigas)');
  assert.match(sql, /select 'ok' as marcas_com_hora_instaladas/);
  // permissões e regras de acesso só são CONFERIDAS, nunca alteradas
  assert.match(codigo, /has_any_column_privilege/);
  assert.match(codigo, /settled_read.*settled_insert.*settled_delete/s);
});
