'use strict';
// Testa a Edge Function "saldo-99pay" SEM rede: a Pluggy e o banco são simulados. O que se prova aqui:
//  • a Pluggy só é chamada DEPOIS que o banco autoriza (admin + limites);
//  • para a Pluggy só saem 3 chamadas de LEITURA; nada de PATCH, movimentos, saldo em tempo real, pagamento;
//  • as chaves de cada lado nunca vão para o outro; nada de chave, saldo ou ID nos logs;
//  • cada erro da Pluggy vira um código curto que o banco aceita guardar.
// (O teste real contra o Supabase e a Pluggy só dá para fazer depois de publicar a função.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ARQ = path.join(__dirname, '..', 'supabase', 'functions', 'saldo-99pay', 'index.ts');
const FONTE = fs.readFileSync(ARQ, 'utf8');
// O Node precisa entender TypeScript (a partir da 22.18 já vem ligado). Se não entender, só os testes de texto rodam.
const TEM_TS = Boolean(process.features && process.features.typescript);
const f = TEM_TS ? test : test.skip;

let F = null;
test.before(async () => { if (TEM_TS) F = await import(pathToFileURL(ARQ).href); });

const APP = 'https://planejamento-pessoal.github.io';
const SB = 'https://abcdefghijklmnopqrst.supabase.co';
const PLUGGY = 'https://api.pluggy.ai';
const ITEM = '11111111-2222-3333-4444-555555555555';
const CONTA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CONTA2 = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: 'pessoa-logada', role: 'authenticated' })}.assinatura_do_login_da_pessoa`;
const APIKEY = 'sb_publishable_TesteLocal0123456789abcdefXYZ';
const CHAVE_PLUGGY = 'chave-temporaria-da-pluggy-0987654321';
const SEGREDO_ID = 'cid-SEGREDO-id-0123456789';
const SEGREDO_SENHA = 'csecret-SEGREDO-senha-9876543210';
const NOME_TITULAR = 'FULANO DE TAL DA SILVA';
const CPF = '123.456.789-00';
const ENV = { PLUGGY_CLIENT_ID: SEGREDO_ID, PLUGGY_CLIENT_SECRET: SEGREDO_SENHA, PLUGGY_ITEM_ID: ITEM, APP_ORIGIN: APP, SUPABASE_URL: SB };
const AGORA = new Date('2026-11-14T12:00:00Z');
const ULTIMA = '2026-11-14T09:22:00.000Z';
const codigosVistos = new Set();

const resp = (status, corpo) => new Response(status === 204 || corpo === undefined ? null : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const conta = (extra = {}) => ({ id: CONTA, type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta', number: '0001/12345-0', owner: NOME_TITULAR, taxNumber: CPF, balance: 5814, currencyCode: 'BRL', ...extra });
const contas = (...lista) => ({ status: 200, corpo: { page: 1, total: lista.length, totalPages: 1, results: lista } });
const itemOk = (extra = {}) => ({ status: 200, corpo: { id: ITEM, status: 'UPDATED', executionStatus: 'SUCCESS', lastUpdatedAt: ULTIMA, connector: { name: 'MeuPluggy' }, ...extra } });

// Mundo simulado: registra tudo que a função tenta enviar e responde conforme "conf".
function mundo(opc = {}) {
  const chamadas = [];
  const conf = {
    start: { status: 200, corpo: { permitido: true, id: 7 } },
    finish: { status: 204 },
    auth: { status: 200, corpo: { apiKey: CHAVE_PLUGGY } },
    item: itemOk(),
    contas: contas(conta()),
    ...opc
  };
  const responde = (c) => {
    if (c instanceof Error) throw c;
    if (typeof c === 'function') return c();
    return resp(c.status, c.corpo);
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    chamadas.push({
      host: u.origin, caminho: u.pathname, consulta: Object.fromEntries(u.searchParams), metodo: init.method,
      cab: init.headers || {}, corpo: init.body ? JSON.parse(init.body) : undefined, cru: JSON.stringify({ url, init: { ...init, signal: undefined } })
    });
    if (u.origin === PLUGGY) {
      if (u.pathname === '/auth' && init.method === 'POST') return responde(conf.auth);
      if (u.pathname === '/items/' + ITEM && init.method === 'GET') return responde(conf.item);
      if (u.pathname === '/accounts' && init.method === 'GET') return responde(conf.contas);
      throw new Error('a função tentou uma chamada que não deveria: ' + init.method + ' ' + u.pathname);
    }
    if (u.origin === SB && u.pathname === '/rest/v1/rpc/pay99_start_read') return responde(conf.start);
    if (u.origin === SB && u.pathname === '/rest/v1/rpc/pay99_finish_read') return responde(conf.finish);
    throw new Error('a função tentou falar com um lugar que não deveria: ' + init.method + ' ' + url);
  };
  const daPluggy = () => chamadas.filter((c) => c.host === PLUGGY);
  const doBanco = () => chamadas.filter((c) => c.host === SB);
  const fechamentos = () => chamadas.filter((c) => c.caminho === '/rest/v1/rpc/pay99_finish_read');
  return { chamadas, fetch, conf, daPluggy, doBanco, fechamentos };
}

async function chamar(m, o = {}) {
  const metodo = o.metodo || 'POST';
  const cab = { ...(o.semContentType ? {} : { 'content-type': 'application/json' }) };
  if (o.origin !== null) cab.origin = o.origin || APP;
  if (o.jwt !== null) cab.authorization = o.authorization || 'Bearer ' + (o.jwt || JWT);
  if (o.apikey !== null) cab.apikey = o.apikey || APIKEY;
  Object.assign(cab, o.cab || {});
  const req = new Request(SB + '/functions/v1/saldo-99pay', {
    method: metodo, headers: cab,
    body: metodo === 'GET' || metodo === 'OPTIONS' || metodo === 'HEAD' ? undefined : (o.corpo !== undefined ? o.corpo : JSON.stringify({ origem: o.origem || 'manual' }))
  });
  const env = { ...ENV, ...(o.env || {}) };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const logs = [];
  const orig = console.log;
  console.log = (...a) => { logs.push(a.map(String).join(' ')); };
  let r;
  try { r = await F.handle(req, { get: (n) => env[n] }, { fetch: m.fetch, agora: o.agora || (() => AGORA), tempoLimiteMs: o.tempoLimiteMs || 500 }); }
  finally { console.log = orig; }
  const texto = await r.text();
  const corpo = texto ? JSON.parse(texto) : null;
  if (corpo && corpo.codigo) codigosVistos.add(corpo.codigo);
  return { status: r.status, h: r.headers, corpo, texto, logs: logs.join('\n') };
}

// ── O caminho feliz ─────────────────────────────────────────────────────
f('caminho feliz: o banco autoriza, a Pluggy é lida (3 chamadas) e o banco grava, nessa ordem', async () => {
  const m = mundo();
  const r = await chamar(m);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ok: true, id: 7, saldo_centavos: 581400, dado_em: ULTIMA, item_status: 'UPDATED' });
  const seq = m.chamadas.map((c) => `${c.metodo} ${c.host === SB ? 'BANCO' : 'PLUGGY'}${c.caminho}`);
  assert.deepEqual(seq, [
    'POST BANCO/rest/v1/rpc/pay99_start_read',
    'POST PLUGGY/auth',
    `GET PLUGGY/items/${ITEM}`,
    'GET PLUGGY/accounts',
    'POST BANCO/rest/v1/rpc/pay99_finish_read'
  ]);
  assert.deepEqual(m.chamadas[0].corpo, { p_source: 'manual' });
  assert.deepEqual(m.chamadas[3].consulta, { itemId: ITEM });
  assert.deepEqual(m.chamadas[4].corpo, { p_id: 7, p_ok: true, p_balance_cents: 581400, p_data_as_of: ULTIMA, p_item_status: 'UPDATED' });
});

f('"ao_abrir" também é repassada ao banco', async () => {
  const m = mundo();
  assert.equal((await chamar(m, { origem: 'ao_abrir' })).corpo.ok, true);
  assert.deepEqual(m.chamadas[0].corpo, { p_source: 'ao_abrir' });
});

f('cada lado só recebe as próprias chaves (a da Pluggy nunca vai ao banco; o login da pessoa nunca vai à Pluggy)', async () => {
  const m = mundo();
  await chamar(m);
  const auth = m.daPluggy()[0];
  assert.deepEqual(auth.corpo, { clientId: SEGREDO_ID, clientSecret: SEGREDO_SENHA });
  assert.equal(auth.cab['x-api-key'], undefined, 'o /auth não leva chave');
  for (const c of m.daPluggy().slice(1)) assert.equal(c.cab['x-api-key'], CHAVE_PLUGGY);
  for (const c of m.daPluggy()) {
    for (const proibido of [JWT, APIKEY, 'Bearer ']) assert.ok(!c.cru.includes(proibido), `a Pluggy recebeu "${proibido.slice(0, 12)}…"`);
    assert.equal(c.cab.authorization, undefined);
  }
  for (const c of m.doBanco()) {
    assert.equal(c.cab.authorization, 'Bearer ' + JWT, 'o banco recebe o login da pessoa, igualzinho');
    assert.equal(c.cab.apikey, APIKEY);
    for (const proibido of [SEGREDO_ID, SEGREDO_SENHA, CHAVE_PLUGGY, ITEM, CONTA, NOME_TITULAR, CPF]) assert.ok(!c.cru.includes(proibido), `o banco recebeu "${proibido.slice(0, 12)}…"`);
  }
});

f('a resposta ao app e os logs não carregam chave, ID, nome, CPF nem saldo', async () => {
  const confs = [{}, { item: { status: 404, corpo: { message: 'item ' + ITEM + ' não existe' } } }, { contas: { status: 500, corpo: { message: CPF } } }];
  for (const conf of confs) {
    const m = mundo(conf);
    const r = await chamar(m);
    for (const s of [JWT, APIKEY, CHAVE_PLUGGY, SEGREDO_ID, SEGREDO_SENHA, ITEM, CONTA, NOME_TITULAR, CPF, 'Bearer']) {
      assert.ok(!r.logs.includes(s), `log com "${s}"`);
      assert.ok(!r.texto.includes(s), `resposta com "${s}"`);
    }
    for (const s of ['5814', '581400']) assert.ok(!r.logs.includes(s), `log com o saldo "${s}"`);
    if (!r.corpo.ok) for (const s of ['5814', '581400']) assert.ok(!r.texto.includes(s), `resposta de erro com o saldo "${s}"`);
    assert.ok(r.logs.length > 0, 'a função deveria registrar quais chamadas fez');
  }
});

// ── Só leitura ──────────────────────────────────────────────────────────
f('chamadaPermitida: só POST /auth, GET /items/{id} e GET /accounts', () => {
  const ok = [['POST', '/auth'], ['GET', `/items/${ITEM}`], ['GET', '/accounts']];
  for (const [mt, p] of ok) assert.equal(F.chamadaPermitida(mt, p), true, mt + ' ' + p);
  const nao = [
    ['PATCH', `/items/${ITEM}`], ['DELETE', `/items/${ITEM}`], ['POST', `/items/${ITEM}`], ['PUT', `/items/${ITEM}`],
    ['GET', '/transactions'], ['GET', '/v2/transactions'], ['GET', `/accounts/${CONTA}/balance`], ['GET', `/accounts/${CONTA}`],
    ['POST', '/payments'], ['POST', '/payment-intents'], ['POST', '/boletos'], ['POST', '/accounts'], ['GET', '/auth'],
    ['POST', '/items'], ['GET', '/items'], ['GET', '/items/nao-e-um-id'], ['GET', `/items/${ITEM}/x`], ['GET', `/items/${ITEM}/`],
    ['GET', '/accounts/'], ['GET', '/accounts?itemId=' + ITEM], ['GET', '//accounts'], ['GET', '/identity'], ['GET', '/investments']
  ];
  for (const [mt, p] of nao) assert.equal(F.chamadaPermitida(mt, p), false, mt + ' ' + p);
});

f('em toda leitura, só essas chamadas saem para a Pluggy (mesmo nas falhas)', async () => {
  const permitidas = new Set(['POST /auth', `GET /items/${ITEM}`, 'GET /accounts']);
  for (const conf of [{}, { auth: { status: 401 } }, { item: { status: 404 } }, { contas: { status: 500 } }, { contas: contas(conta({ type: 'CREDIT' })) }]) {
    const m = mundo(conf);
    await chamar(m);
    for (const c of m.daPluggy()) assert.ok(permitidas.has(`${c.metodo} ${c.caminho}`), `saiu ${c.metodo} ${c.caminho}`);
  }
});

test('o texto da função não tem como pagar, transferir, pedir atualização, ler movimentos nem usar a chave secreta', () => {
  const codigo = FONTE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const proibido of ['PATCH', '/transactions', '/balance', '/payments', 'payment', 'boleto', 'SERVICE_ROLE', 'service_role', 'localStorage', 'eval(', 'new Function']) {
    assert.ok(!codigo.includes(proibido), `a função contém "${proibido}"`);
  }
  assert.ok(!/\bPix\b|\bpix\b|transfer/i.test(codigo), 'a função fala de Pix/transferência');
  assert.match(codigo, /chamadaPermitida\(metodo, caminho\)\) throw/, 'a porta de saída da Pluggy precisa ser conferida em toda chamada');
  assert.match(codigo, /RPCS_DO_BANCO\.includes\(nome\)\) throw/, 'só as 2 funções do banco podem ser chamadas');
});

// ── A Pluggy só entra depois que o banco autoriza ───────────────────────
f('banco recusa ou não autoriza: a Pluggy NÃO é chamada e nada é fechado', async () => {
  const casos = [
    [{ start: { status: 401, corpo: { code: 'PGRST301' } } }, 401, 'sem_login'],
    [{ start: { status: 403, corpo: { code: '42501', message: 'sem_permissao' } } }, 403, 'sem_permissao'],
    [{ start: { status: 404, corpo: { code: 'PGRST202' } } }, 200, 'banco_sem_migracao'],
    [{ start: { status: 500 } }, 200, 'banco_indisponivel'],
    [{ start: { status: 400, corpo: { message: 'origem_invalida' } } }, 200, 'banco_indisponivel'],
    [{ start: new Error('rede caiu') }, 200, 'banco_indisponivel'],
    [{ start: { status: 200, corpo: { permitido: false, motivo: 'em_andamento' } } }, 200, 'em_andamento'],
    [{ start: { status: 200, corpo: { permitido: false, motivo: 'limite_diario' } } }, 200, 'limite_diario'],
    [{ start: { status: 200, corpo: { permitido: false, motivo: 'intervalo', espere_s: 42 } } }, 200, 'intervalo'],
    [{ start: { status: 200, corpo: { permitido: false, motivo: 'inventado' } } }, 200, 'banco_indisponivel'],
    [{ start: { status: 200, corpo: { permitido: false } } }, 200, 'banco_indisponivel'],
    [{ start: { status: 200, corpo: { permitido: 'true', id: 7 } } }, 200, 'banco_indisponivel'],
    [{ start: { status: 200, corpo: { permitido: true } } }, 200, 'banco_indisponivel'],
    [{ start: { status: 200, corpo: { permitido: true, id: '7' } } }, 200, 'banco_indisponivel'],
    [{ start: { status: 200, corpo: { permitido: true, id: 0 } } }, 200, 'banco_indisponivel'],
    [{ start: { status: 200, corpo: null } }, 200, 'banco_indisponivel'],
    [{ start: { status: 200, corpo: [] } }, 200, 'banco_indisponivel']
  ];
  for (const [conf, http, codigo] of casos) {
    const m = mundo(conf);
    const r = await chamar(m);
    assert.equal(r.status, http, codigo);
    assert.equal(r.corpo.ok, false); assert.equal(r.corpo.codigo, codigo);
    assert.equal(m.daPluggy().length, 0, `${codigo}: a Pluggy foi chamada sem autorização do banco`);
    assert.equal(m.fechamentos().length, 0, `${codigo}: fechou uma leitura que nunca começou`);
  }
});

f('"intervalo" devolve quanto esperar (limitado a 1 s até 1 dia); os outros motivos não trazem espera', async () => {
  const esp = async (v, motivo = 'intervalo') => (await chamar(mundo({ start: { status: 200, corpo: { permitido: false, motivo, espere_s: v } } }))).corpo;
  assert.deepEqual(await esp(42), { ok: false, codigo: 'intervalo', espere_s: 42 });
  assert.equal((await esp(0.2)).espere_s, 1);
  assert.equal((await esp(999999)).espere_s, 86400);
  assert.equal((await esp('x')).espere_s, undefined);
  assert.equal((await esp(30, 'limite_diario')).espere_s, undefined);
});

// ── Pedido inválido: nem o banco é chamado ──────────────────────────────
f('pedidos inválidos são barrados antes de qualquer chamada', async () => {
  const casos = [
    ['GET', { metodo: 'GET' }, 405, 'use_post'],
    ['PUT', { metodo: 'PUT', corpo: '{}' }, 405, 'use_post'],
    ['sem login', { jwt: null }, 401, 'sem_login'],
    ['login que não é Bearer', { authorization: 'Basic dXNlcjpwYXNz' }, 401, 'sem_login'],
    ['Bearer curto', { authorization: 'Bearer abc' }, 401, 'sem_login'],
    ['Bearer com espaço no meio', { authorization: 'Bearer aaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbb' }, 401, 'sem_login'],
    ['origem de outro site', { origin: 'https://site-do-golpe.example' }, 403, 'origem_nao_permitida'],
    ['origem parecida com a do app', { origin: APP + '.golpe.example' }, 403, 'origem_nao_permitida'],
    ['corpo que não é JSON', { corpo: 'oi' }, 400, 'origem_invalida'],
    ['corpo vazio', { corpo: '' }, 400, 'origem_invalida'],
    ['sem o campo origem', { corpo: '{}' }, 400, 'origem_invalida'],
    ['origem "agendada" (ainda não existe)', { corpo: '{"origem":"agendada"}' }, 400, 'origem_invalida'],
    ['origem em maiúscula', { corpo: '{"origem":"MANUAL"}' }, 400, 'origem_invalida'],
    ['origem que não é texto', { corpo: '{"origem":["manual"]}' }, 400, 'origem_invalida'],
    ['corpo enorme', { corpo: JSON.stringify({ origem: 'manual', lixo: 'x'.repeat(600) }) }, 400, 'origem_invalida']
  ];
  for (const [nome, o, http, codigo] of casos) {
    const m = mundo();
    const r = await chamar(m, o);
    assert.equal(r.status, http, nome); assert.equal(r.corpo.codigo, codigo, nome);
    assert.equal(m.chamadas.length, 0, `${nome}: saiu chamada para a rede`);
  }
});

f('chamada sem cabeçalho Origin (não é navegador) com login passa a ser tratada normalmente, mas sem liberar CORS', async () => {
  const m = mundo();
  const r = await chamar(m, { origin: null });
  assert.equal(r.corpo.ok, true);
  assert.equal(r.h.get('access-control-allow-origin'), null);
});

f('a chave pública (apikey) vem do pedido; se não vier, usa a do ambiente; se nenhuma, não manda', async () => {
  let m = mundo(); await chamar(m, { apikey: null, env: { SUPABASE_ANON_KEY: 'sb_publishable_do_ambiente_0123456789' } });
  assert.equal(m.doBanco()[0].cab.apikey, 'sb_publishable_do_ambiente_0123456789');
  m = mundo(); await chamar(m, { apikey: null });
  assert.equal(m.doBanco()[0].cab.apikey, undefined);
  m = mundo(); await chamar(m, { apikey: 'tem espaço e coisa estranha' , env: { SUPABASE_ANON_KEY: 'sb_publishable_do_ambiente_0123456789' } });
  assert.equal(m.doBanco()[0].cab.apikey, 'sb_publishable_do_ambiente_0123456789', 'apikey torta é ignorada');
});

// ── Configuração ────────────────────────────────────────────────────────
f('configuração incompleta ou torta: 503 sem dizer o que falta (só o log diz) e nenhuma chamada', async () => {
  const faltas = [
    ['PLUGGY_CLIENT_ID', undefined], ['PLUGGY_CLIENT_SECRET', ''], ['PLUGGY_CLIENT_SECRET', '   '], ['PLUGGY_ITEM_ID', undefined],
    ['PLUGGY_ITEM_ID', 'isto-nao-e-um-id'], ['APP_ORIGIN', undefined], ['APP_ORIGIN', 'isto não é um endereço'],
    ['SUPABASE_URL', undefined], ['SUPABASE_URL', 'lixo'], ['PLUGGY_ACCOUNT_ID', 'nao-e-um-id']
  ];
  for (const [nome, valor] of faltas) {
    const m = mundo();
    const r = await chamar(m, { env: { [nome]: valor } });
    assert.equal(r.status, 503, `${nome}=${valor}`); assert.equal(r.corpo.codigo, 'funcao_nao_configurada');
    assert.equal(m.chamadas.length, 0, `${nome}: chamou a rede mesmo mal configurada`);
    assert.ok(!r.texto.includes(nome), `a resposta entregou o nome ${nome}`);
    assert.ok(r.logs.includes(nome), `o log deveria dizer o que falta (${nome})`);
  }
});

f('APP_ORIGIN aceita o endereço completo (com pasta e barra no fim): vale só o "https://site"', async () => {
  const m = mundo();
  const r = await chamar(m, { env: { APP_ORIGIN: APP + '/orcamento-app/' } });
  assert.equal(r.corpo.ok, true);
  assert.equal(r.h.get('access-control-allow-origin'), APP);
});

// ── CORS ────────────────────────────────────────────────────────────────
f('CORS: o navegador pergunta antes (OPTIONS): só o endereço do app é liberado, e nunca "*"', async () => {
  const m = mundo();
  const r = await chamar(m, { metodo: 'OPTIONS', jwt: null, apikey: null, cab: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, apikey, content-type, x-client-info' } });
  assert.equal(r.status, 204); assert.equal(r.texto, '');
  assert.equal(r.h.get('access-control-allow-origin'), APP);
  assert.equal(r.h.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(r.h.get('access-control-allow-headers'), 'authorization, apikey, content-type, x-client-info');
  assert.match(r.h.get('vary'), /Origin/i);
  assert.equal(m.chamadas.length, 0);
  const outro = await chamar(mundo(), { metodo: 'OPTIONS', origin: 'https://site-do-golpe.example', jwt: null, apikey: null });
  assert.equal(outro.status, 403); assert.equal(outro.h.get('access-control-allow-origin'), null);
  const sem = await chamar(mundo(), { metodo: 'OPTIONS', origin: null, jwt: null, apikey: null });
  assert.equal(sem.status, 403);
});

f('CORS: cabeçalhos pedidos esquisitos voltam para a lista padrão', async () => {
  const r = await chamar(mundo(), { metodo: 'OPTIONS', jwt: null, apikey: null, cab: { 'access-control-request-headers': 'x;drop table' } });
  assert.equal(r.h.get('access-control-allow-headers'), 'authorization, apikey, content-type, x-client-info');
});

f('CORS: respostas de sucesso e de erro (do app) levam o endereço do app; de outros sites, não', async () => {
  for (const conf of [{}, { start: { status: 403 } }, { auth: { status: 500 } }]) {
    const r = await chamar(mundo(conf));
    assert.equal(r.h.get('access-control-allow-origin'), APP);
    assert.notEqual(r.h.get('access-control-allow-origin'), '*');
  }
  const semLogin = await chamar(mundo(), { jwt: null });
  assert.equal(semLogin.h.get('access-control-allow-origin'), APP, 'o app precisa conseguir LER o erro de login');
  const golpe = await chamar(mundo(), { origin: 'https://site-do-golpe.example' });
  assert.equal(golpe.h.get('access-control-allow-origin'), null);
  const r = await chamar(mundo());
  assert.equal(r.h.get('cache-control'), 'no-store');
  assert.equal(r.h.get('x-content-type-options'), 'nosniff');
});

// ── Erros da Pluggy → código curto, gravado no banco ────────────────────
f('cada erro da Pluggy vira um código, é gravado como falha (com a situação da conexão, se já se sabe) e volta ao app', async () => {
  const casos = [
    ['login 400', { auth: { status: 400 } }, 'pluggy_login_recusado', null],
    ['login 401', { auth: { status: 401 } }, 'pluggy_login_recusado', null],
    ['login 403', { auth: { status: 403 } }, 'pluggy_login_recusado', null],
    ['login 429', { auth: { status: 429 } }, 'pluggy_limite', null],
    ['login 500', { auth: { status: 500 } }, 'pluggy_indisponivel', null],
    ['login 503', { auth: { status: 503 } }, 'pluggy_indisponivel', null],
    ['login 418', { auth: { status: 418 } }, 'pluggy_resposta_inesperada', null],
    ['login sem apiKey', { auth: { status: 200, corpo: {} } }, 'pluggy_resposta_inesperada', null],
    ['login com apiKey que não é texto', { auth: { status: 200, corpo: { apiKey: 123 } } }, 'pluggy_resposta_inesperada', null],
    ['rede caiu no login', { auth: new Error('x') }, 'pluggy_indisponivel', null],
    ['item 404', { item: { status: 404 } }, 'item_nao_encontrado', null],
    ['item 401', { item: { status: 401 } }, 'pluggy_login_recusado', null],
    ['item 429', { item: { status: 429 } }, 'pluggy_limite', null],
    ['item 502', { item: { status: 502 } }, 'pluggy_indisponivel', null],
    ['rede caiu no item', { item: new Error('x') }, 'pluggy_indisponivel', null],
    ['contas 401', { contas: { status: 401 }, item: itemOk({ status: 'OUTDATED' }) }, 'pluggy_login_recusado', 'OUTDATED'],
    ['contas 404', { contas: { status: 404 }, item: itemOk({ status: 'UPDATED' }) }, 'pluggy_resposta_inesperada', 'UPDATED'],
    ['contas 429', { contas: { status: 429 }, item: itemOk({ status: 'UPDATING' }) }, 'pluggy_limite', 'UPDATING'],
    ['contas 500', { contas: { status: 500 }, item: itemOk({ status: 'LOGIN_ERROR' }) }, 'pluggy_indisponivel', 'LOGIN_ERROR'],
    ['contas sem "results"', { contas: { status: 200, corpo: { page: 1 } } }, 'pluggy_resposta_inesperada', 'UPDATED'],
    ['contas que não são lista', { contas: { status: 200, corpo: { results: 'x' } } }, 'pluggy_resposta_inesperada', 'UPDATED'],
    ['contas em várias páginas (total maior que o recebido)', { contas: { status: 200, corpo: { total: 3, results: [conta()] } } }, 'pluggy_resposta_inesperada', 'UPDATED'],
    ['só cartão de crédito', { contas: contas(conta({ type: 'CREDIT', subtype: 'CREDIT_CARD' })) }, 'sem_conta_bancaria', 'UPDATED'],
    ['nenhuma conta', { contas: contas() }, 'sem_conta_bancaria', 'UPDATED'],
    ['duas contas bancárias e nenhuma escolhida', { contas: contas(conta(), conta({ id: CONTA2, balance: 1 })) }, 'varias_contas', 'UPDATED'],
    ['moeda em dólar', { contas: contas(conta({ currencyCode: 'USD' })) }, 'moeda_inesperada', 'UPDATED'],
    ['saldo ausente', { contas: contas(conta({ balance: undefined })) }, 'saldo_invalido', 'UPDATED'],
    ['saldo nulo', { contas: contas(conta({ balance: null })) }, 'saldo_invalido', 'UPDATED'],
    ['saldo em texto', { contas: contas(conta({ balance: '5814' })) }, 'saldo_invalido', 'UPDATED'],
    ['saldo absurdo', { contas: contas(conta({ balance: 1e20 })) }, 'saldo_invalido', 'UPDATED'],
    ['saldo absurdo negativo', { contas: contas(conta({ balance: -1e12 })) }, 'saldo_invalido', 'UPDATED'],
    ['sem hora do dado', { item: itemOk({ lastUpdatedAt: undefined }) }, 'sem_hora_do_dado', 'UPDATED'],
    ['hora do dado que não é data', { item: itemOk({ lastUpdatedAt: 'ontem' }) }, 'sem_hora_do_dado', 'UPDATED'],
    ['hora do dado em número', { item: itemOk({ lastUpdatedAt: 1731575000000 }) }, 'sem_hora_do_dado', 'UPDATED'],
    ['hora do dado antes de 2000', { item: itemOk({ lastUpdatedAt: '1999-12-31T23:59:59Z' }) }, 'sem_hora_do_dado', 'UPDATED'],
    ['hora do dado 2 h no futuro', { item: itemOk({ lastUpdatedAt: '2026-11-14T14:00:00Z' }) }, 'sem_hora_do_dado', 'UPDATED']
  ];
  for (const [nome, conf, codigo, status] of casos) {
    const m = mundo(conf);
    const r = await chamar(m);
    assert.equal(r.status, 200, nome);
    assert.equal(r.corpo.ok, false, nome); assert.equal(r.corpo.codigo, codigo, nome);
    assert.equal(m.fechamentos().length, 1, `${nome}: deveria fechar a leitura uma vez`);
    assert.deepEqual(m.fechamentos()[0].corpo, { p_id: 7, p_ok: false, p_error: codigo, p_item_status: status }, nome);
    assert.match(codigo, /^[a-z0-9_]{1,40}$/, 'o banco só aceita este formato de código');
    assert.equal(r.corpo.item_status, status || undefined, nome);
  }
});

f('várias contas: PLUGGY_ACCOUNT_ID escolhe a certa; se não achar, avisa', async () => {
  const duas = contas(conta({ balance: 100 }), conta({ id: CONTA2, balance: 250.5 }));
  let r = await chamar(mundo({ contas: duas }), { env: { PLUGGY_ACCOUNT_ID: CONTA2 } });
  assert.equal(r.corpo.saldo_centavos, 25050);
  r = await chamar(mundo({ contas: duas }), { env: { PLUGGY_ACCOUNT_ID: CONTA } });
  assert.equal(r.corpo.saldo_centavos, 10000);
  r = await chamar(mundo({ contas: duas }), { env: { PLUGGY_ACCOUNT_ID: 'ffffffff-ffff-ffff-ffff-ffffffffffff' } });
  assert.equal(r.corpo.codigo, 'conta_nao_encontrada');
  // com uma conta só e PLUGGY_ACCOUNT_ID de outra: também avisa (não lê "a que sobrou")
  r = await chamar(mundo(), { env: { PLUGGY_ACCOUNT_ID: CONTA2 } });
  assert.equal(r.corpo.codigo, 'conta_nao_encontrada');
});

f('moeda: "BRL" em qualquer caixa ou ausente vale (conta brasileira); outra moeda não', async () => {
  for (const moeda of ['BRL', 'brl', ' BRL ', undefined, null, '']) {
    const r = await chamar(mundo({ contas: contas(conta({ currencyCode: moeda })) }));
    assert.equal(r.corpo.ok, true, String(moeda));
  }
  for (const moeda of ['USD', 'EUR', 'BRLX']) {
    assert.equal((await chamar(mundo({ contas: contas(conta({ currencyCode: moeda })) }))).corpo.codigo, 'moeda_inesperada', moeda);
  }
});

f('saldo em centavos: arredonda certo valores de 2 casas (inclusive os que o computador erra por 1e-13)', async () => {
  const tabela = [[0, 0], [0.01, 1], [0.07, 7], [0.29, 29], [1.1, 110], [8.2, 820], [19.99, 1999], [5760.33, 576033], [5814, 581400],
    [5814.0, 581400], [123456.78, 12345678], [-50.25, -5025], [-0.01, -1], [1234567.89, 123456789], [999999999.99, 99999999999], [-999999999.99, -99999999999]];
  for (const [reais, centavos] of tabela) {
    const r = await chamar(mundo({ contas: contas(conta({ balance: reais })) }));
    assert.equal(r.corpo.ok, true, String(reais));
    assert.equal(r.corpo.saldo_centavos, centavos, `R$ ${reais}`);
    assert.ok(Number.isInteger(r.corpo.saldo_centavos));
  }
  assert.equal((await chamar(mundo({ contas: contas(conta({ balance: 1000000000 })) }))).corpo.codigo, 'saldo_invalido', 'acima do teto da tabela');
});

f('hora do dado: vem do item (não do relógio); até 1 h no futuro (relógio adiantado) passa', async () => {
  let r = await chamar(mundo({ item: itemOk({ lastUpdatedAt: '2026-11-13T09:22:11.456-03:00' }) }));
  assert.equal(r.corpo.dado_em, '2026-11-13T12:22:11.456Z', 'convertida para UTC');
  r = await chamar(mundo({ item: itemOk({ lastUpdatedAt: '2026-11-14T12:59:00Z' }) }));
  assert.equal(r.corpo.ok, true);
});

f('situação da conexão: só maiúsculas e "_" são aceitas; o resto vira vazio; saldo continua sendo gravado', async () => {
  for (const [entra, sai] of [['UPDATED', 'UPDATED'], ['LOGIN_ERROR', 'LOGIN_ERROR'], ['WAITING_USER_INPUT', 'WAITING_USER_INPUT'],
    ['updated', null], ['UPDATED; drop table', null], ['A'.repeat(31), null], [123, null], [undefined, null], ['', null]]) {
    const m = mundo({ item: itemOk({ status: entra }) });
    const r = await chamar(m);
    assert.equal(r.corpo.ok, true, String(entra));
    assert.equal(r.corpo.item_status, sai, String(entra));
    assert.equal(m.fechamentos()[0].corpo.p_item_status, sai);
  }
});

// ── Fechar a leitura no banco ───────────────────────────────────────────
f('gravar o resultado: erro 5xx ou de rede tenta mais uma vez; erro 4xx não; falhando, avisa "gravacao_falhou"', async () => {
  const seq = (...respostas) => { let i = 0; return () => { const c = respostas[Math.min(i++, respostas.length - 1)]; if (c instanceof Error) throw c; return resp(c.status, c.corpo); }; };
  let m = mundo({ finish: seq({ status: 500 }, { status: 204 }) });
  let r = await chamar(m);
  assert.equal(r.corpo.ok, true); assert.equal(m.fechamentos().length, 2, '5xx + sucesso');
  m = mundo({ finish: seq(new Error('x'), { status: 204 }) });
  r = await chamar(m);
  assert.equal(r.corpo.ok, true); assert.equal(m.fechamentos().length, 2, 'rede + sucesso');
  m = mundo({ finish: seq({ status: 500 }, { status: 500 }, { status: 204 }) });
  r = await chamar(m);
  assert.equal(r.corpo.codigo, 'gravacao_falhou'); assert.equal(m.fechamentos().length, 2, 'só duas tentativas');
  m = mundo({ finish: seq({ status: 400, corpo: { code: '22023' } }, { status: 204 }) });
  r = await chamar(m);
  assert.equal(r.corpo.codigo, 'gravacao_falhou'); assert.equal(m.fechamentos().length, 1, '4xx não repete');
  m = mundo({ finish: seq({ status: 403 }) });
  assert.equal((await chamar(m)).corpo.codigo, 'gravacao_falhou');
});

f('se a Pluggy falha E o banco não deixa gravar a falha, o app ainda recebe o erro da Pluggy', async () => {
  const m = mundo({ auth: { status: 429 }, finish: { status: 500 } });
  const r = await chamar(m);
  assert.equal(r.corpo.codigo, 'pluggy_limite');
  assert.equal(m.fechamentos().length, 2);
});

f('tempo esgotado: a Pluggy que não responde vira "pluggy_indisponivel" (e a leitura é fechada)', async () => {
  const m = mundo();
  const normal = m.fetch;
  m.fetch = (url, init = {}) => {
    if (new URL(url).pathname !== '/auth') return normal(url, init);
    // a Pluggy "trava": só termina quando a função desiste (o sinal de cancelamento dispara)
    return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abortado'))));
  };
  const t0 = Date.now();
  const r = await chamar(m, { tempoLimiteMs: 60 });
  assert.equal(r.corpo.codigo, 'pluggy_indisponivel');
  assert.ok(Date.now() - t0 < 3000, 'demorou demais para desistir');
  assert.equal(m.fechamentos().length, 1);
  assert.equal(m.fechamentos()[0].corpo.p_error, 'pluggy_indisponivel');
});

f('erro inesperado nosso depois que a leitura começou: devolve "erro_interno" e tenta fechar a leitura como falha', async () => {
  const m = mundo();
  const r = await chamar(m, { agora: () => { throw new Error('bug'); } });
  assert.equal(r.status, 200); assert.equal(r.corpo.codigo, 'erro_interno');
  assert.equal(m.daPluggy().length, 0);
  assert.equal(m.fechamentos().length, 1);
  assert.deepEqual(m.fechamentos()[0].corpo, { p_id: 7, p_ok: false, p_error: 'erro_interno', p_item_status: null });
  // erro inesperado ANTES de o banco autorizar: nada a fechar
  const m2 = mundo({ start: { status: 200, corpo: { permitido: true, id: 7 } } });
  const normal = m2.fetch;
  m2.fetch = (url, init) => { if (new URL(url).pathname.endsWith('pay99_start_read')) throw new TypeError('x'); return normal(url, init); };
  const r2 = await chamar(m2);
  assert.equal(r2.corpo.codigo, 'banco_indisponivel');
  assert.equal(m2.fechamentos().length, 0);
});

f('Pluggy respondendo texto que não é JSON não derruba a função', async () => {
  const m = mundo({ auth: () => new Response('<html>erro</html>', { status: 200 }) });
  const r = await chamar(m);
  assert.equal(r.corpo.codigo, 'pluggy_resposta_inesperada');
});

f('login recusado na Pluggy ainda grava a falha; a situação "LOGIN_ERROR" do MeuPluggy NÃO impede de mostrar o último saldo', async () => {
  const m = mundo({ item: itemOk({ status: 'LOGIN_ERROR', lastUpdatedAt: '2026-11-10T08:00:00Z' }) });
  const r = await chamar(m);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.item_status, 'LOGIN_ERROR');
  assert.equal(r.corpo.dado_em, '2026-11-10T08:00:00.000Z', 'a idade do dado é que mostra que está velho');
});

// ── Fechamento: todos os códigos usados existem na lista e cabem no banco ─
test('todos os códigos devolvidos fazem parte de CODIGOS, e todos cabem na regra do banco', { skip: !TEM_TS }, () => {
  for (const c of codigosVistos) assert.ok(F.CODIGOS.includes(c), `código fora da lista: ${c}`);
  for (const c of F.CODIGOS) assert.match(c, /^[a-z0-9_]{1,40}$/, c);
  assert.equal(new Set(F.CODIGOS).size, F.CODIGOS.length, 'código repetido');
  // e nenhum código da lista ficou sem teste (código sem teste é código que ninguém sabe se funciona)
  for (const c of F.CODIGOS) assert.ok(codigosVistos.has(c), `nenhum teste produziu o código ${c}`);
});

test('importar a função não liga servidor nenhum (só dentro do Supabase)', { skip: !TEM_TS }, () => {
  assert.equal(typeof globalThis.Deno, 'undefined');
  assert.deepEqual(Object.keys(F).sort(), ['CODIGOS', 'chamadaPermitida', 'handle']);
});
