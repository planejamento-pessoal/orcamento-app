'use strict';
// Testa, SEM rede e SEM navegador, a parte do app que mostra o saldo da 99Pay (só leitura, só admin):
//  • hora e espera em português ("há 3 h", "em 2 min");
//  • o que o app entende da resposta da função e do que está guardado no banco;
//  • todo código que a função pode devolver tem texto em português (nunca texto vindo de fora na tela);
//  • travas estáticas: nada de innerHTML, nada guardado no aparelho, o app nunca fala com a Pluggy.
// (O cartão na tela e o botão são conferidos num navegador de verdade; isso não cabe nos testes sem dependências.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const docs = path.join(root, 'docs');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const Format = require('../docs/js/format.js');

// ── hora e espera ───────────────────────────────────────────────────────
const AGORA = Date.parse('2026-11-14T13:40:00.000Z');
const antes = (ms) => new Date(AGORA - ms).toISOString();
const S = 1000, MIN = 60 * S, H = 60 * MIN, DIA = 24 * H;

test('agoText: "agora há pouco", minutos, horas e dias', () => {
  const t = (ms) => Format.agoText(antes(ms), AGORA);
  assert.equal(t(0), 'agora há pouco');
  assert.equal(t(59 * S + 999), 'agora há pouco');
  assert.equal(t(60 * S), 'há 1 min');
  assert.equal(t(59 * MIN + 59 * S), 'há 59 min');
  assert.equal(t(60 * MIN), 'há 1 h');
  assert.equal(t(28 * H + 30 * MIN), 'há 28 h');
  assert.equal(t(47 * H + 59 * MIN), 'há 47 h');
  assert.equal(t(48 * H), 'há 2 dias');
  assert.equal(t(5 * DIA + 3 * H), 'há 5 dias');
});

test('agoText: horário no futuro (relógio atrasado) vira "agora"; ilegível vira texto vazio', () => {
  assert.equal(Format.agoText(antes(-3 * H), AGORA), 'agora há pouco');
  assert.equal(Format.agoText('', AGORA), '');
  assert.equal(Format.agoText(null, AGORA), '');
  assert.equal(Format.agoText('ontem', AGORA), '');
});

test('toMs/agoText leem o horário do Supabase (6 casas de fração e +00:00)', () => {
  const iso = '2026-11-14T10:40:00.123456+00:00';
  assert.equal(Format.toMs(iso), Date.parse('2026-11-14T10:40:00.123Z'));
  assert.equal(Format.agoText(iso, Date.parse('2026-11-14T12:40:01.000Z')), 'há 2 h');
  assert.equal(Format.agoText(iso, Date.parse('2026-11-14T12:40:00.000Z')), 'há 1 h', 'arredonda para BAIXO: 1 h 59 min ainda é "há 1 h"');
  assert.ok(isNaN(Format.toMs('lixo')));
});

test('waitText: sempre arredonda para cima e nunca diz "0 s"', () => {
  assert.equal(Format.waitText(0.2), '1 s');
  assert.equal(Format.waitText(25), '25 s');
  assert.equal(Format.waitText(25.1), '26 s');
  assert.equal(Format.waitText(59.2), '1 min');
  assert.equal(Format.waitText(61), '2 min');
  assert.equal(Format.waitText(3599), '1 h');
  assert.equal(Format.waitText(3700), '2 h');
  for (const x of [0, -5, NaN, undefined, null, 'abc']) assert.equal(Format.waitText(x), '1 s', String(x));
});

// ── data.js num "navegador" mínimo, com um Supabase de mentira ──────────────
// objetos criados dentro do vm vêm de outro "mundo" (outro Object.prototype): para comparar com deepEqual, passa por JSON
const plain = (x) => JSON.parse(JSON.stringify(x));
const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';
const PUB = 'sb_publishable_TesteLocal0123456789abcdefXYZ';

function app(fake) {
  const calls = { invoke: [], query: [] };
  const ctx = { URL, atob, console, Promise, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.Engine = {};
  ctx.Format = Format;
  ctx.APP_CONFIG = { SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: PUB };
  ctx.supabase = {
    createClient: () => ({
      auth: { getSession: () => Promise.resolve({ data: { session: fake.session === undefined ? { user: { id: 'u1' } } : fake.session }, error: null }) },
      functions: { invoke: (nome, opts) => { calls.invoke.push([nome, opts]); return Promise.resolve().then(() => fake.invoke(nome, opts)); } },
      from: (tabela) => {
        const q = { tabela };
        const b = {
          select: (c) => { q.select = c; return b; },
          order: (c, o) => { q.order = [c, o]; return b; },
          limit: (n) => { q.limit = n; return b; },
          then: (ok, ko) => { calls.query.push(q); return Promise.resolve().then(() => fake.query(q)).then(ok, ko); }
        };
        return b;
      }
    })
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(docs, 'js', 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
  assert.equal(ctx.App.data.init(), true, 'init() do data.js falhou: ' + ctx.App.data.problem());
  return { D: ctx.App.data, calls };
}
const httpErro = (status, corpo, jsonOk = true) => ({
  data: null,
  error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status, json: () => (jsonOk ? Promise.resolve(corpo) : Promise.reject(new Error('não é JSON'))) } }
});
const OK_RESP = { ok: true, id: 7, saldo_centavos: 581400, dado_em: '2026-11-13T09:22:11.000Z', item_status: 'UPDATED' };

// ── readSaldo99 ──────────────────────────────────────────────────────────
test('readSaldo99: chama a função certa só com a origem e o tempo limite (nada de chave, nada de cabeçalho)', async () => {
  const { D, calls } = app({ invoke: () => ({ data: OK_RESP, error: null }) });
  const r = await D.readSaldo99('manual');
  assert.deepEqual(plain(r), { ok: true, cents: 581400, dataAt: '2026-11-13T09:22:11.000Z', itemStatus: 'UPDATED' });
  assert.equal(calls.invoke.length, 1);
  assert.equal(calls.invoke[0][0], 'saldo-99pay');
  assert.deepEqual(Object.keys(calls.invoke[0][1]).sort(), ['body', 'timeout']);
  assert.deepEqual(plain(calls.invoke[0][1].body), { origem: 'manual' });
  assert.equal(calls.invoke[0][1].timeout, 50000);
  const r2 = await D.readSaldo99('ao_abrir');
  assert.deepEqual(plain(calls.invoke[1][1].body), { origem: 'ao_abrir' });
  assert.equal(r2.ok, true);
});

test('readSaldo99: sem sessão nem chega a chamar a função', async () => {
  const { D, calls } = app({ session: null, invoke: () => ({ data: OK_RESP, error: null }) });
  const r = await D.readSaldo99('manual');
  assert.equal(r.ok, false);
  assert.match(r.error, /sessão expirou/);
  assert.equal(calls.invoke.length, 0);
});

test('readSaldo99: falha de negócio (HTTP 200 com ok:false) vira código + texto nosso', async () => {
  const { D } = app({ invoke: () => ({ data: { ok: false, codigo: 'pluggy_indisponivel', item_status: 'UPDATING' }, error: null }) });
  const r = await D.readSaldo99('manual');
  assert.equal(r.ok, false); assert.equal(r.code, 'pluggy_indisponivel'); assert.equal(r.soft, false); assert.equal(r.itemStatus, 'UPDATING');
  assert.match(r.error, /Pluggy está fora do ar/);
});

test('readSaldo99: recusas do banco (intervalo, em andamento, limite) são "suaves" e trazem a espera', async () => {
  for (const [codigo, soft] of [['intervalo', true], ['em_andamento', true], ['limite_diario', true], ['pluggy_limite', false]]) {
    const { D } = app({ invoke: () => ({ data: { ok: false, codigo, espere_s: 1234.2 }, error: null }) });
    const r = await D.readSaldo99('ao_abrir');
    assert.equal(r.soft, soft, codigo);
    assert.equal(r.wait, 1235, codigo);
  }
  const { D } = app({ invoke: () => ({ data: { ok: false, codigo: 'intervalo', espere_s: 25 }, error: null }) });
  assert.match((await D.readSaldo99('manual')).error, /de novo em 25 s\./);
});

test('readSaldo99: respostas com status de erro (401, 403, 404, 503, 500) viram o código certo', async () => {
  const casos = [
    [401, { ok: false, codigo: 'sem_login' }, 'sem_login'],
    [403, { ok: false, codigo: 'sem_permissao' }, 'sem_permissao'],
    [503, { ok: false, codigo: 'funcao_nao_configurada' }, 'funcao_nao_configurada'],
    [400, { ok: false, codigo: 'origem_invalida' }, 'origem_invalida'],
    [404, { code: 'NOT_FOUND', message: 'Requested function was not found' }, 'funcao_nao_instalada'],   // aviso do próprio Supabase, sem o nosso código
    [401, { msg: 'Invalid JWT' }, 'sem_login'],
    [403, null, 'sem_permissao'],
    [503, {}, 'funcao_nao_configurada'],
    [500, {}, 'resposta_estranha'],
    [502, null, 'resposta_estranha']
  ];
  for (const [status, corpo, esperado] of casos) {
    const { D } = app({ invoke: () => httpErro(status, corpo) });
    const r = await D.readSaldo99('manual');
    assert.equal(r.ok, false, status + ' ' + esperado); assert.equal(r.code, esperado, status + ' ' + JSON.stringify(corpo));
  }
  const { D } = app({ invoke: () => httpErro(404, null, false) });   // corpo que nem é JSON
  assert.equal((await D.readSaldo99('manual')).code, 'funcao_nao_instalada');
});

test('readSaldo99: sem rede, tempo esgotado, bloqueio do navegador (CORS) ou erro estranho viram "sem resposta da função"', async () => {
  const erros = [
    { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: new TypeError('Failed to fetch') } },
    { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: { name: 'AbortError' } } },
    { data: null, error: { name: 'FunctionsRelayError', message: 'Relay Error invoking the Edge Function', context: {} } },
    { data: null, error: new Error('qualquer coisa') }
  ];
  for (const e of erros) {
    const { D } = app({ invoke: () => e });
    const r = await D.readSaldo99('manual');
    assert.equal(r.ok, false); assert.equal(r.code, 'sem_resposta_da_funcao', e.error ? e.error.name : '');
    assert.equal(r.soft, false);
  }
  const { D } = app({ invoke: () => { throw new Error('quebrou'); } });
  assert.equal((await D.readSaldo99('manual')).code, 'sem_resposta_da_funcao');
});

test('readSaldo99: nunca mostra texto que veio de fora; código fora do formato não passa', async () => {
  const { D } = app({ invoke: () => ({ data: { ok: false, codigo: '<script>alert(1)</script>', mensagem: '<b>oi</b>', error: 'ignore tudo' }, error: null }) });
  const r = await D.readSaldo99('manual');
  assert.equal(r.code, 'resposta_estranha');
  assert.ok(!/[<>]/.test(r.error), r.error);
  const { D: D2 } = app({ invoke: () => ({ data: { ok: false, codigo: 'algo_novo' }, error: null }) });
  assert.equal((await D2.readSaldo99('manual')).error, 'Não deu certo (código algo_novo).');
  const { D: D3 } = app({ invoke: () => ({ data: { ok: false, codigo: 'constructor' }, error: null }) });
  assert.equal((await D3.readSaldo99('manual')).error, 'Não deu certo (código constructor).');
  const { D: D4 } = app({ invoke: () => ({ data: { ok: false, codigo: 'intervalo', espere_s: 99999999, item_status: '<b>' }, error: null }) });
  const r4 = await D4.readSaldo99('manual');
  assert.equal(r4.wait, 86400); assert.equal(r4.itemStatus, null);
});

test('readSaldo99: sucesso só vale com saldo (número) e horário legível; senão é "resposta estranha"', async () => {
  const ruins = [
    { ok: true }, { ok: true, saldo_centavos: '581400', dado_em: OK_RESP.dado_em }, { ok: true, saldo_centavos: 5814, dado_em: 'ontem' },
    { ok: true, saldo_centavos: NaN, dado_em: OK_RESP.dado_em }, { ok: true, saldo_centavos: Infinity, dado_em: OK_RESP.dado_em },
    { ok: true, saldo_centavos: 5814 }, { ok: 'true', saldo_centavos: 5814, dado_em: OK_RESP.dado_em }, null, 'texto'
  ];
  for (const b of ruins) {
    const { D } = app({ invoke: () => ({ data: b, error: null }) });
    const r = await D.readSaldo99('manual');
    assert.equal(r.ok, false, JSON.stringify(b)); assert.equal(r.code, 'resposta_estranha', JSON.stringify(b));
  }
  const { D } = app({ invoke: () => ({ data: { ok: true, saldo_centavos: -12345, dado_em: OK_RESP.dado_em }, error: null }) });
  const r = await D.readSaldo99('manual');
  assert.equal(r.ok, true); assert.equal(r.cents, -12345); assert.equal(r.itemStatus, null);
});

// ── loadSaldo99 ──────────────────────────────────────────────────────────
test('loadSaldo99: lê a tabela das leituras, da mais nova para a mais velha, no máximo 20', async () => {
  const rows = [{ id: 2 }, { id: 1 }];
  const { D, calls } = app({ query: () => ({ data: rows, error: null }) });
  const r = await D.loadSaldo99();
  assert.deepEqual(plain(r), { ok: true, installed: true, rows });
  assert.equal(calls.query.length, 1);
  const q = calls.query[0];
  assert.equal(q.tabela, 'pay99_balance_reads');
  assert.equal(q.select, 'id,source,requested_at,finished_at,ok,balance_cents,data_as_of,item_status,error');
  assert.deepEqual(plain(q.order), ['requested_at', { ascending: false }]);
  assert.equal(q.limit, 20);
});

test('loadSaldo99: tabela que ainda não existe = "não instalado" (sem erro); outros erros continuam sendo erro', async () => {
  const faltando = [
    { code: 'PGRST205', message: "Could not find the table 'public.pay99_balance_reads' in the schema cache" },
    { code: '42P01', message: 'relation "public.pay99_balance_reads" does not exist' }
  ];
  for (const error of faltando) {
    const { D } = app({ query: () => ({ data: null, error }) });
    assert.deepEqual(plain(await D.loadSaldo99()), { ok: true, installed: false, rows: [] }, error.code);
  }
  const { D } = app({ query: () => ({ data: null, error: { code: '42501', message: 'permission denied for table pay99_balance_reads' } }) });
  const r = await D.loadSaldo99();
  assert.equal(r.ok, false); assert.match(r.error, /permissão/);
  const { D: D2 } = app({ query: () => ({ data: null, error: { message: 'Failed to fetch' } }) });
  const r2 = await D2.loadSaldo99();
  assert.equal(r2.ok, false); assert.match(r2.error, /Sem conexão/);
  const { D: D3, calls } = app({ session: null, query: () => ({ data: [], error: null }) });
  assert.equal((await D3.loadSaldo99()).ok, false);
  assert.equal(calls.query.length, 0, 'sem sessão não pergunta nada ao banco');
});

// ── saldo99Summary ───────────────────────────────────────────────────────
const { D } = app({});
const linha = (o) => Object.assign({
  id: 1, source: 'manual', requested_at: antes(0), finished_at: antes(0), ok: true, balance_cents: 581400,
  data_as_of: antes(2 * H), item_status: 'UPDATED', error: null
}, o);
const falha = (o) => linha(Object.assign({ ok: false, balance_cents: null, data_as_of: null, item_status: null, error: 'pluggy_indisponivel' }, o));

test('resumo: sem leituras', () => {
  for (const x of [[], null, undefined, 'lixo']) {
    const s = D.saldo99Summary(x, AGORA);
    assert.deepEqual(plain(s), { has: false, cents: null, dataAt: null, readAt: null, old: false, itemStatus: null, pending: false, fail: null });
  }
});

test('resumo: última leitura boa, com a idade do DADO (não a da leitura)', () => {
  const s = D.saldo99Summary([linha({ requested_at: antes(1 * MIN), finished_at: antes(1 * MIN), data_as_of: antes(28 * H) })], AGORA);
  assert.equal(s.has, true); assert.equal(s.cents, 581400); assert.equal(s.old, false);
  assert.equal(s.dataAt, antes(28 * H)); assert.equal(s.readAt, antes(1 * MIN)); assert.equal(s.itemStatus, 'UPDATED'); assert.equal(s.fail, null); assert.equal(s.pending, false);
});

test('resumo: "desatualizado" passa de 30 h (30 h exatas ainda não)', () => {
  const com = (ms) => D.saldo99Summary([linha({ data_as_of: antes(ms) })], AGORA).old;
  assert.equal(com(30 * H - 1), false);
  assert.equal(com(30 * H), false);
  assert.equal(com(30 * H + 1), true);
  assert.equal(com(3 * DIA), true);
  assert.equal(com(0), false);
  assert.equal(com(-2 * H), false, 'dado "do futuro" (relógio do celular atrasado) não é velho');
});

test('resumo: se a última tentativa falhou, o último saldo bom continua e a falha aparece', () => {
  const s = D.saldo99Summary([falha({ id: 3, item_status: 'LOGIN_ERROR' }), linha({ id: 2, balance_cents: '123456' }), linha({ id: 1, balance_cents: 111 })], AGORA);
  assert.equal(s.has, true); assert.equal(s.cents, 123456);
  assert.deepEqual(plain(s.fail), { code: 'pluggy_indisponivel', at: antes(0), itemStatus: 'LOGIN_ERROR' });
});

test('resumo: falha sem nenhum saldo bom antes', () => {
  const s = D.saldo99Summary([falha({})], AGORA);
  assert.equal(s.has, false); assert.equal(s.cents, null); assert.equal(s.fail.code, 'pluggy_indisponivel');
});

test('resumo: depois de uma falha antiga, uma leitura boa nova apaga o aviso', () => {
  const s = D.saldo99Summary([linha({ id: 3 }), falha({ id: 2 }), linha({ id: 1, balance_cents: 5 })], AGORA);
  assert.equal(s.fail, null); assert.equal(s.cents, 581400);
});

test('resumo: leitura que começou e não terminou — "lendo" por 90 s; depois conta como falha "sem resposta"', () => {
  const pendente = (ms) => ({ id: 9, source: 'ao_abrir', requested_at: antes(ms), finished_at: null, ok: null, balance_cents: null, data_as_of: null, item_status: null, error: null });
  const a = D.saldo99Summary([pendente(89 * S), linha({ id: 8 })], AGORA);
  assert.equal(a.pending, true); assert.equal(a.fail, null); assert.equal(a.has, true);
  const b = D.saldo99Summary([pendente(90 * S), linha({ id: 8 })], AGORA);
  assert.equal(b.pending, false); assert.equal(b.fail.code, 'sem_resposta'); assert.equal(b.has, true);
  const c = D.saldo99Summary([pendente(5 * MIN)], AGORA);
  assert.equal(c.has, false); assert.equal(c.fail.code, 'sem_resposta');
});

test('resumo: linha "boa" sem saldo ou sem horário do dado não vale como leitura boa', () => {
  const s = D.saldo99Summary([linha({ balance_cents: null }), linha({ data_as_of: null }), linha({ id: 5, balance_cents: 777 })], AGORA);
  assert.equal(s.cents, 777);
});

test('resumo: saldo negativo e valor grande chegam como número', () => {
  assert.equal(D.saldo99Summary([linha({ balance_cents: -1234 })], AGORA).cents, -1234);
  assert.equal(D.saldo99Summary([linha({ balance_cents: 99999999999 })], AGORA).cents, 99999999999);
});

// ── textos em português ──────────────────────────────────────────────────
// Códigos que a função pode devolver (lidos do código dela), o que o banco guarda sozinho e o que o app inventa.
function codigosDaFuncao() {
  const src = read('supabase', 'functions', 'saldo-99pay', 'index.ts');
  const m = /export const CODIGOS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(m, 'lista CODIGOS não encontrada na função');
  const cods = [...m[1].replace(/\/\/.*$/gm, '').matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
  assert.ok(cods.length >= 20, 'poucos códigos lidos: ' + cods.length);
  return cods;
}

test('todo código da função, do banco e do app tem texto em português (nenhum cai no "Não deu certo (código …)")', () => {
  const todos = new Set([...codigosDaFuncao(), 'sem_resposta', 'funcao_nao_instalada', 'sem_resposta_da_funcao', 'resposta_estranha']);
  for (const c of todos) {
    const t = D.saldo99Text(c, c === 'intervalo' ? 30 : 0);
    assert.ok(t && !/^Não deu certo \(código/.test(t), 'sem texto para ' + c);
    assert.ok(/[a-zà-ú]/.test(t) && !/[<>]/.test(t), c);
  }
  assert.match(D.saldo99Text('intervalo', 0), /Espere um pouco/);
  assert.match(D.saldo99Text('intervalo', 125), /em 3 min\./);
});

test('os textos que mandam mexer em segredos citam só os NOMES dos segredos, nunca valores', () => {
  for (const c of ['pluggy_login_recusado', 'item_nao_encontrado', 'varias_contas', 'conta_nao_encontrada', 'origem_nao_permitida']) {
    const t = D.saldo99Text(c);
    assert.ok(/PLUGGY_|APP_ORIGIN/.test(t), c);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t) && !/sb_|eyJ/.test(t), c);
  }
});

test('situação da conexão no MeuPluggy: avisos só quando precisam (UPDATED e desconhecidos ficam calados)', () => {
  assert.equal(D.saldo99Hint('UPDATED'), '');
  assert.equal(D.saldo99Hint(null), '');
  assert.equal(D.saldo99Hint('QUALQUER'), '');
  assert.equal(D.saldo99Hint('constructor'), '');
  assert.equal(D.saldo99Hint('__proto__'), '');
  assert.match(D.saldo99Hint('UPDATING'), /atualizando agora/);
  assert.match(D.saldo99Hint('LOGIN_ERROR'), /reconecte/);
  assert.match(D.saldo99Hint('OUTDATED'), /Atualizar/);
  assert.match(D.saldo99Hint('WAITING_USER_INPUT'), /esperando uma ação sua/);
});

// ── travas estáticas ─────────────────────────────────────────────────────
const bloco = (arq, de, ate) => {
  const txt = read('docs', 'js', arq);
  const i = txt.indexOf(de), j = txt.indexOf(ate, i + de.length);
  assert.ok(i >= 0 && j > i, `não achei o trecho "${de}" em ${arq}`);
  return txt.slice(i, j);
};
const TRECHOS = {
  'data.js': bloco('data.js', '// ── saldo na 99Pay (só leitura; só o admin vê)', '// ── administração de acessos'),
  'app.js': bloco('app.js', '// ── saldo na 99Pay (só admin)', '// Apaga deste aparelho'),
  'month-view.js': bloco('month-view.js', '// ── saldo na 99Pay: só leitura', '// Sob "Entradas"/"Saídas" do resumo')
};

test('nada do saldo da 99Pay é guardado no aparelho (só na memória)', () => {
  for (const [arq, t] of Object.entries(TRECHOS)) {
    assert.ok(!/localStorage|sessionStorage|indexedDB|store\.(set|get|del)|patchCache|CACHE_KEY|caches\./.test(t), arq + ' guarda algo no aparelho');
  }
});

test('o app não fala com a Pluggy: só o link "Abrir MeuPluggy" existe, e ele abre FORA do app', () => {
  const todos = fs.readdirSync(path.join(docs, 'js')).map((f) => [f, read('docs', 'js', f)]).concat([['config.js', read('docs', 'config.js')], ['index.html', read('docs', 'index.html')], ['app.css', read('docs', 'app.css')]]);
  for (const [arq, t] of todos) {
    assert.ok(!/api\.pluggy\.ai/i.test(t), arq + ' fala com a API da Pluggy');
    assert.ok(!/PLUGGY_CLIENT|clientSecret|client_secret|x-api-key|CLIENT_SECRET/i.test(t.replace(/PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET/g, '')), arq + ' cita chave da Pluggy');
    const urls = [...t.matchAll(/https?:\/\/[^\s'")]+/g)].map((m) => m[0]).filter((u) => /pluggy/i.test(u));
    for (const u of urls) assert.equal(u, 'https://meu.pluggy.ai/', arq + ': endereço da Pluggy inesperado ' + u);
  }
  const v = TRECHOS['month-view.js'];
  assert.match(v, /href: MEUPLUGGY, target: '_blank', rel: 'noopener noreferrer'/, 'o link precisa abrir fora do app, sem passar a origem');
  assert.match(v, /var MEUPLUGGY = 'https:\/\/meu\.pluggy\.ai\/';/);
});

test('o app só chama a função de leitura (nada de pagar, transferir ou outras funções)', () => {
  const t = TRECHOS['data.js'];
  assert.equal([...t.matchAll(/sb\.functions\.invoke\(/g)].length, 1, 'uma única chamada de função');
  assert.match(t, /sb\.functions\.invoke\(S99\.FN, \{ body: \{ origem: origem \}, timeout: S99\.PEDIDO_MS \}\)/);
  assert.match(t, /FN: 'saldo-99pay'/);
  assert.ok(!/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(t), 'o trecho do saldo só LÊ (select) e chama a função');
  const todos = fs.readdirSync(path.join(docs, 'js')).map((f) => read('docs', 'js', f)).join('\n');
  assert.equal([...todos.matchAll(/functions\.invoke\(/g)].length, 1, 'nenhuma outra função é chamada pelo app');
  assert.ok(!/pay99_start_read|pay99_finish_read/.test(todos), 'o app não chama as funções internas do banco (quem chama é a função do Supabase)');
});

test('texto na tela sempre por textContent: nada de innerHTML & cia em docs/js', () => {
  for (const f of fs.readdirSync(path.join(docs, 'js'))) {
    const t = read('docs', 'js', f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(t), f);
  }
});

test('o cartão só aparece para o admin, com o banco instalado e no mês atual (e um defeito nele não derruba a aba)', () => {
  const v = TRECHOS['month-view.js'];
  assert.match(v, /S && S\.installed === true && App\.isAdmin\(\) && App\.state\.month === F\.currentMonth\(\)/);
  const m = read('docs', 'js', 'month-view.js');
  assert.match(m, /try \{ var s99 = saldo99Card\(\); if \(s99\) main\.appendChild\(s99\); \}/);
  assert.ok(m.indexOf('var s99 = saldo99Card()') > m.indexOf('carrySection(v.carry, month)'), 'o cartão vem depois da conta corrente');
  assert.ok(m.indexOf('try { var s99') < m.indexOf("main.appendChild(section('Saídas'"), 'e antes das saídas');
});

test('app.js: a leitura automática só roda para o admin, com internet, e é quieta; limpa tudo ao sair', () => {
  const a = read('docs', 'js', 'app.js');
  assert.match(a, /function saldo99OnOpen\(\) \{\s*if \(!state\.user \|\| !App\.isAdmin\(\) \|\| state\.offline \|\| !state\.data\) return;/);
  assert.match(a, /App\.saldo99Read\('ao_abrir'\)/);
  assert.equal([...a.matchAll(/App\.saldo99Read\('manual'\)/g)].length, 0, 'o botão manual mora no cartão (month-view.js)');
  assert.match(read('docs', 'js', 'month-view.js'), /App\.saldo99Read\('manual'\)/);
  // todo lugar que zera o login zera também o saldo
  const zera = [...a.matchAll(/state\.data = null;[^\n]*/g)].map((m) => m[0]);
  assert.ok(zera.length >= 5);
  for (const linha of zera) assert.ok(/state\.saldo99 = null/.test(linha) || /state\.data = null; state\.idxFor = null; state\.loadError = null/.test(linha), 'sem zerar o saldo: ' + linha);
  assert.match(a, /App\.version = '1\.5\.0';/);
});

test('a leitura automática respeita os intervalos do banco (30 s manual, 1 h automática, 5 min entre conferências ao voltar)', () => {
  const t = TRECHOS['app.js'];
  assert.match(t, /S99_ABRIR_MS = 5 \* 60 \* 1000/);
  assert.match(t, /S99_ESPERA_MS = 30 \* 1000/);
  assert.match(t, /S99_HORA_MS = 60 \* 60 \* 1000/);
  const sql = read('supabase', '02_saldo99.sql');
  assert.match(sql, /3600/, 'o banco usa 3600 s para a leitura automática');
  assert.match(sql, /\b30\b/, 'o banco usa 30 s para a manual');
});
