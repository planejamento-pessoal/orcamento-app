// =============================================================================
// saldo-99pay  ·  lê o saldo da 99Pay (via MeuPluggy / Pluggy)  ·  SOMENTE LEITURA
// =============================================================================
// Para que serve
//   O app chama esta função quando o admin abre o app ("ao_abrir") ou toca em
//   "Ler agora" ("manual"). Ela pergunta à Pluggy qual é o saldo da conta da 99Pay
//   que o MeuPluggy enxerga e guarda o resultado no diário pay99_balance_reads
//   (supabase/02_saldo99.sql). O app só MOSTRA esse saldo, num cartão à parte:
//   ele não entra em nenhuma conta do orçamento.
//
// O que ela NUNCA faz
//   - Não cria pagamento, Pix, transferência nem ordem de qualquer tipo. Para a Pluggy
//     só saem 3 chamadas de leitura (veja chamadaPermitida); qualquer outra é recusada
//     antes de ir à rede. Não pede atualização do MeuPluggy (a Pluggy não deixa por API).
//   - Não lê movimentos nem descrições, e não devolve nem guarda número de conta, CPF,
//     nome, Item ID, Account ID ou chave da Pluggy. Guarda só: saldo (centavos), hora do
//     dado, situação da conexão e um código de erro curto.
//   - Não usa a chave secreta do Supabase (service_role). Fala com o banco COMO a pessoa
//     que está logada (repassa o login dela) e o banco decide se é admin.
//   - Não escreve valores nem chaves nos logs: só "qual chamada" e "código HTTP".
//
// Ordem das coisas (a Pluggy só é chamada depois que o BANCO autoriza)
//   1. confere o pedido (método, origem, login, corpo);
//   2. pay99_start_read: o banco confere se é admin e aplica os limites (1 por hora ao abrir,
//      30 s entre leituras manuais, 12 por dia, uma por vez). Se não permitir, para aqui;
//   3. Pluggy: POST /auth, GET /items/{id}, GET /accounts?itemId=...;
//   4. pay99_finish_read: grava o saldo (ou o código do erro). Sempre tenta fechar a leitura.
//
// Segredos e variáveis (painel do Supabase: Edge Functions > Secrets; só VOCÊ digita)
//   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEM_ID
//   APP_ORIGIN         endereço do app, ex.: https://planejamento-pessoal.github.io
//                      (só esse endereço pode chamar a função a partir de um navegador)
//   PLUGGY_ACCOUNT_ID  opcional: só se o MeuPluggy tiver mais de uma conta bancária
//   SUPABASE_URL       o Supabase preenche sozinho
//
// Esta função precisa ser publicada com "Verify JWT" DESLIGADO: quem confere o login é o
// banco (passo 2). Sem login válido de admin, nada chega à Pluggy.
// =============================================================================

type Env = { get(nome: string): string | undefined };
// deno-lint-ignore no-explicit-any
type Corpo = any;
type Resp = { http: number; corpo: Corpo };
type Deps = {
  // deno-lint-ignore no-explicit-any
  fetch?: (url: string, init?: any) => Promise<Response>;
  agora?: () => Date;
  tempoLimiteMs?: number;
};
type Ctx = {
  // deno-lint-ignore no-explicit-any
  fetch: (url: string, init?: any) => Promise<Response>;
  tempoLimiteMs: number;
};
type Cfg = {
  clientId: string;
  clientSecret: string;
  itemId: string;
  contaId: string | null;
  appOrigin: string;
  supabaseUrl: string;
};
type Banco = { url: string; auth: string; apikey: string };
type Leitura = { ok: true; saldo_centavos: number; dado_em: string; item_status: string | null };
type Falhou = { ok: false; codigo: string; item_status: string | null };

const FN = "saldo-99pay";
const PLUGGY = "https://api.pluggy.ai";
const TEMPO_LIMITE_MS = 8000;
const ORIGENS = ["ao_abrir", "manual"];
const RPCS_DO_BANCO = ["pay99_start_read", "pay99_finish_read"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_CENTAVOS = 99999999999; // o mesmo teto da tabela (R$ 999.999.999,99)

// Todos os códigos que esta função devolve em { ok:false, codigo } (o app traduz cada um).
export const CODIGOS = [
  // o banco não deixou (limites)
  "em_andamento", "limite_diario", "intervalo",
  // pedido / acesso
  "sem_login", "sem_permissao", "origem_invalida", "origem_nao_permitida", "funcao_nao_configurada", "use_post",
  // banco de dados
  "banco_sem_migracao", "banco_indisponivel", "gravacao_falhou",
  // Pluggy / MeuPluggy
  "pluggy_login_recusado", "pluggy_limite", "pluggy_indisponivel", "item_nao_encontrado",
  "pluggy_resposta_inesperada", "sem_conta_bancaria", "varias_contas", "conta_nao_encontrada",
  "moeda_inesperada", "saldo_invalido", "sem_hora_do_dado",
  // bug nosso
  "erro_interno",
];

const CABECALHOS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

// ---------------------------------------------------------------- utilidades

function resposta(corpo: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CABECALHOS, ...extra } });
}

// Cabeçalhos de CORS: só para o endereço do app (APP_ORIGIN). CORS não é segurança de verdade
// (quem manda é o login, conferido pelo banco), mas impede outros sites de ler a resposta.
function cabecalhosCors(req: Request, origem: string): Record<string, string> {
  const pedidos = (req.headers.get("access-control-request-headers") ?? "").toLowerCase().trim();
  const permitidos = /^[a-z0-9,\- ]{1,200}$/.test(pedidos)
    ? pedidos
    : "authorization, apikey, content-type, x-client-info";
  return {
    "access-control-allow-origin": origem,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": permitidos,
    "access-control-max-age": "600",
    "vary": "Origin",
  };
}

// "https://site.com/pasta/" vira "https://site.com". Vazio ou inválido vira "".
function origemDe(txt: string): string {
  try {
    const u = new URL(txt);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : "";
  } catch {
    return "";
  }
}

// Única porta de saída para a Pluggy: só estas combinações método + caminho (todas de LEITURA,
// menos o /auth, que só troca Client ID + Client Secret por uma chave temporária).
export function chamadaPermitida(metodo: string, caminho: string): boolean {
  const regras: Array<[string, RegExp]> = [
    ["POST", /^\/auth$/],
    ["GET", /^\/items\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/],
    ["GET", /^\/accounts$/],
  ];
  return regras.some(([m, r]) => m === metodo && r.test(caminho));
}

// Pedido HTTP com limite de tempo. Resposta com erro HTTP NÃO lança: volta em { http }.
// Só lança (Error "rede") se a conexão falhar ou estourar o tempo. Nunca registra valores.
async function pedir(
  ctx: Ctx,
  rotulo: string,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<Resp> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ctx.tempoLimiteMs);
  try {
    const r = await ctx.fetch(url, { ...init, signal: ctl.signal });
    const texto = await r.text();
    let corpo: Corpo = null;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = null;
    }
    console.log(JSON.stringify({ fn: FN, chamada: rotulo, http: r.status }));
    return { http: r.status, corpo };
  } catch {
    console.log(JSON.stringify({ fn: FN, chamada: rotulo, erro: "rede" }));
    throw new Error("rede");
  } finally {
    clearTimeout(timer);
  }
}

async function chamarPluggy(
  ctx: Ctx,
  metodo: string,
  caminho: string,
  opc: { chave?: string; consulta?: Record<string, string>; corpo?: unknown } = {},
): Promise<Resp> {
  if (!chamadaPermitida(metodo, caminho)) throw new Error("chamada_nao_permitida");
  const alvo = new URL(PLUGGY + caminho);
  for (const [k, v] of Object.entries(opc.consulta ?? {})) alvo.searchParams.set(k, v);
  const cab: Record<string, string> = { accept: "application/json" };
  if (opc.corpo !== undefined) cab["content-type"] = "application/json";
  if (opc.chave) cab["x-api-key"] = opc.chave;
  const rotulo = "pluggy " + metodo + " " + caminho.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id");
  return pedir(ctx, rotulo, alvo.toString(), {
    method: metodo,
    headers: cab,
    body: opc.corpo !== undefined ? JSON.stringify(opc.corpo) : undefined,
  });
}

// Chama uma das 2 funções do banco, COMO a pessoa logada (repassa o login dela).
async function chamarBanco(ctx: Ctx, banco: Banco, nome: string, args: Record<string, unknown>): Promise<Resp> {
  if (!RPCS_DO_BANCO.includes(nome)) throw new Error("chamada_nao_permitida");
  const cab: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    authorization: banco.auth,
  };
  if (banco.apikey) cab.apikey = banco.apikey;
  return pedir(ctx, "banco " + nome, banco.url + "/rest/v1/rpc/" + nome, {
    method: "POST",
    headers: cab,
    body: JSON.stringify(args),
  });
}

// ------------------------------------------------------------- leitura na Pluggy

function codigoHttp(http: number, etapa: "login" | "item" | "contas"): string {
  if (http === 429) return "pluggy_limite";
  if (http >= 500) return "pluggy_indisponivel";
  if (etapa === "login" && (http === 400 || http === 401 || http === 403)) return "pluggy_login_recusado";
  if (etapa === "item" && http === 404) return "item_nao_encontrado";
  if (http === 401 || http === 403) return "pluggy_login_recusado"; // a chave acabou de ser dada e foi recusada
  return "pluggy_resposta_inesperada";
}

async function lerPluggy(ctx: Ctx, cfg: Cfg, agora: Date): Promise<Leitura | Falhou> {
  let itemStatus: string | null = null;
  const falha = (codigo: string): Falhou => ({ ok: false, codigo, item_status: itemStatus });
  try {
    // 1) Login: troca Client ID + Client Secret por uma chave que vale 2 horas.
    const login = await chamarPluggy(ctx, "POST", "/auth", {
      corpo: { clientId: cfg.clientId, clientSecret: cfg.clientSecret },
    });
    const apiKey = typeof login.corpo?.apiKey === "string" ? login.corpo.apiKey : "";
    if (login.http !== 200) return falha(codigoHttp(login.http, "login"));
    if (!apiKey) return falha("pluggy_resposta_inesperada");

    // 2) Conexão (item): situação e hora da última sincronização do MeuPluggy.
    const it = await chamarPluggy(ctx, "GET", "/items/" + cfg.itemId, { chave: apiKey });
    if (it.http !== 200) return falha(codigoHttp(it.http, "item"));
    const st = it.corpo?.status;
    itemStatus = typeof st === "string" && /^[A-Z_]{1,30}$/.test(st) ? st : null;

    // 3) Contas e saldo.
    const ac = await chamarPluggy(ctx, "GET", "/accounts", { chave: apiKey, consulta: { itemId: cfg.itemId } });
    if (ac.http !== 200) return falha(codigoHttp(ac.http, "contas"));
    const brutas: Corpo[] | null = Array.isArray(ac.corpo?.results) ? ac.corpo.results : null;
    if (!brutas) return falha("pluggy_resposta_inesperada");
    // veio só parte das contas (resposta em páginas): melhor recusar do que ler a conta errada
    if (Number(ac.corpo?.total) > brutas.length) return falha("pluggy_resposta_inesperada");

    // Qual conta? A bancária. Se houver mais de uma, quem escolhe é você (PLUGGY_ACCOUNT_ID).
    const bancarias = brutas.filter((c) => c && c.type === "BANK");
    let conta: Corpo = null;
    if (cfg.contaId) {
      conta = brutas.find((c) => c && c.id === cfg.contaId) ?? null;
      if (!conta) return falha("conta_nao_encontrada");
    } else if (bancarias.length === 1) {
      conta = bancarias[0];
    } else if (bancarias.length === 0) {
      return falha("sem_conta_bancaria");
    } else {
      return falha("varias_contas");
    }

    // Moeda: só reais. Se a Pluggy não disser a moeda, assume reais (conta brasileira); se disser
    // outra, recusa, em vez de mostrar um número de outra moeda como se fosse R$.
    const moeda = conta.currencyCode;
    if (typeof moeda === "string" && moeda.trim() !== "" && moeda.trim().toUpperCase() !== "BRL") {
      return falha("moeda_inesperada");
    }

    // Saldo em centavos (inteiro). O saldo vem em reais, com 2 casas.
    const saldo = conta.balance;
    if (typeof saldo !== "number" || !Number.isFinite(saldo)) return falha("saldo_invalido");
    const centavos = Math.round(saldo * 100);
    if (!Number.isSafeInteger(centavos) || Math.abs(centavos) > LIMITE_CENTAVOS) return falha("saldo_invalido");

    // Hora do dado: a da última sincronização do MeuPluggy (NÃO é a hora desta leitura).
    const ult = typeof it.corpo?.lastUpdatedAt === "string" ? Date.parse(it.corpo.lastUpdatedAt) : NaN;
    if (!Number.isFinite(ult) || ult < Date.parse("2000-01-01T00:00:00Z") || ult > agora.getTime() + 3600000) {
      return falha("sem_hora_do_dado");
    }

    return { ok: true, saldo_centavos: centavos, dado_em: new Date(ult).toISOString(), item_status: itemStatus };
  } catch (e) {
    if (e instanceof Error && e.message === "rede") return falha("pluggy_indisponivel");
    return falha("erro_interno");
  }
}

// ------------------------------------------------------------------ principal

export async function handle(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const doFetch = deps.fetch ?? ((u: string, i?: unknown) => fetch(u, i as RequestInit));
  const agora = deps.agora ?? (() => new Date());
  const ctx: Ctx = { fetch: doFetch, tempoLimiteMs: deps.tempoLimiteMs ?? TEMPO_LIMITE_MS };

  const valor = (n: string) => (env.get(n) ?? "").trim();
  const appOrigin = origemDe(valor("APP_ORIGIN"));
  const origemDoPedido = req.headers.get("origin");
  // Resposta de navegador só é liberada para o endereço do app.
  const cors = appOrigin && origemDoPedido === appOrigin ? cabecalhosCors(req, appOrigin) : {};

  // Configuração. Quem chama não vê O QUE falta (isso só aparece nos logs do Supabase).
  const itemId = valor("PLUGGY_ITEM_ID");
  const contaId = valor("PLUGGY_ACCOUNT_ID");
  const supabaseUrl = origemDe(valor("SUPABASE_URL"));
  const problemas: string[] = [];
  if (!valor("PLUGGY_CLIENT_ID")) problemas.push("PLUGGY_CLIENT_ID");
  if (!valor("PLUGGY_CLIENT_SECRET")) problemas.push("PLUGGY_CLIENT_SECRET");
  if (!UUID.test(itemId)) problemas.push(itemId ? "PLUGGY_ITEM_ID_invalido" : "PLUGGY_ITEM_ID");
  if (contaId && !UUID.test(contaId)) problemas.push("PLUGGY_ACCOUNT_ID_invalido");
  if (!appOrigin) problemas.push("APP_ORIGIN");
  if (!supabaseUrl) problemas.push("SUPABASE_URL");
  if (problemas.length) {
    console.log(JSON.stringify({ fn: FN, aviso: "configuracao_incompleta", problemas }));
    return resposta({ ok: false, codigo: "funcao_nao_configurada" }, 503, cors);
  }

  if (req.method === "OPTIONS") {
    // o navegador pergunta "posso?" antes de mandar o login: só o endereço do app pode
    if (origemDoPedido === appOrigin) return new Response(null, { status: 204, headers: { ...cors, "cache-control": "no-store" } });
    return resposta({ ok: false, codigo: "origem_nao_permitida" }, 403);
  }
  if (req.method !== "POST") return resposta({ ok: false, codigo: "use_post" }, 405, cors);
  if (origemDoPedido && origemDoPedido !== appOrigin) {
    return resposta({ ok: false, codigo: "origem_nao_permitida" }, 403);
  }

  // Login: o app manda o login da pessoa; quem confere de verdade é o banco (passo 2).
  const auth = (req.headers.get("authorization") ?? "").trim();
  if (!/^Bearer [A-Za-z0-9._~+\/=-]{20,4096}$/.test(auth)) {
    return resposta({ ok: false, codigo: "sem_login" }, 401, cors);
  }
  const apikeyEnviada = (req.headers.get("apikey") ?? "").trim();
  const apikey = /^[A-Za-z0-9._-]{10,512}$/.test(apikeyEnviada) ? apikeyEnviada : valor("SUPABASE_ANON_KEY");
  const banco: Banco = { url: supabaseUrl, auth, apikey };

  let origem = "";
  try {
    const txt = await req.text();
    if (txt.length <= 500) {
      const b = JSON.parse(txt);
      if (typeof b?.origem === "string") origem = b.origem;
    }
  } catch {
    origem = "";
  }
  if (!ORIGENS.includes(origem)) return resposta({ ok: false, codigo: "origem_invalida" }, 400, cors);

  const cfg: Cfg = {
    clientId: valor("PLUGGY_CLIENT_ID"),
    clientSecret: valor("PLUGGY_CLIENT_SECRET"),
    itemId,
    contaId: contaId || null,
    appOrigin,
    supabaseUrl,
  };

  // Fecha a leitura no banco (sucesso ou falha). Se der erro de rede ou 5xx, tenta mais uma vez.
  // Devolve se conseguiu. Nunca lança.
  let id = 0;
  const fechar = async (args: Record<string, unknown>): Promise<boolean> => {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const f = await chamarBanco(ctx, banco, "pay99_finish_read", { p_id: id, ...args });
        if (f.http >= 200 && f.http < 300) return true;
        if (f.http < 500) return false;
      } catch { /* tenta de novo */ }
    }
    return false;
  };

  try {
    // 2) O banco confere se é admin e aplica os limites. A Pluggy só entra depois disto.
    let ini: Resp;
    try {
      ini = await chamarBanco(ctx, banco, "pay99_start_read", { p_source: origem });
    } catch {
      return resposta({ ok: false, codigo: "banco_indisponivel" }, 200, cors);
    }
    if (ini.http === 401) return resposta({ ok: false, codigo: "sem_login" }, 401, cors);
    if (ini.http === 403) return resposta({ ok: false, codigo: "sem_permissao" }, 403, cors);
    if (ini.http === 404) return resposta({ ok: false, codigo: "banco_sem_migracao" }, 200, cors);
    if (ini.http !== 200 || typeof ini.corpo !== "object" || ini.corpo === null) {
      return resposta({ ok: false, codigo: "banco_indisponivel" }, 200, cors);
    }
    if (ini.corpo.permitido !== true) {
      const motivo = String(ini.corpo.motivo ?? "");
      if (["em_andamento", "limite_diario", "intervalo"].includes(motivo)) {
        const espere = Number(ini.corpo.espere_s);
        return resposta(
          {
            ok: false,
            codigo: motivo,
            ...(motivo === "intervalo" && Number.isFinite(espere) ? { espere_s: Math.max(1, Math.min(86400, Math.round(espere))) } : {}),
          },
          200,
          cors,
        );
      }
      return resposta({ ok: false, codigo: "banco_indisponivel" }, 200, cors);
    }
    const novoId = ini.corpo.id;
    if (typeof novoId !== "number" || !Number.isSafeInteger(novoId) || novoId < 1) {
      return resposta({ ok: false, codigo: "banco_indisponivel" }, 200, cors);
    }
    id = novoId;

    // 3) Pluggy (leitura).
    const lido = await lerPluggy(ctx, cfg, agora());

    // 4) Fecha a leitura no banco.
    if (lido.ok) {
      const gravou = await fechar({
        p_ok: true,
        p_balance_cents: lido.saldo_centavos,
        p_data_as_of: lido.dado_em,
        p_item_status: lido.item_status,
      });
      if (!gravou) {
        console.log(JSON.stringify({ fn: FN, origem, resultado: "gravacao_falhou" }));
        return resposta({ ok: false, codigo: "gravacao_falhou" }, 200, cors);
      }
      console.log(JSON.stringify({ fn: FN, origem, resultado: "ok" }));
      return resposta(
        { ok: true, id, saldo_centavos: lido.saldo_centavos, dado_em: lido.dado_em, item_status: lido.item_status },
        200,
        cors,
      );
    }

    // Falhou na Pluggy: registra o código (melhor esforço; se não der, o banco dá a leitura como
    // perdida sozinho depois de 90 s) e devolve o mesmo código ao app.
    await fechar({ p_ok: false, p_error: lido.codigo, p_item_status: lido.item_status });
    console.log(JSON.stringify({ fn: FN, origem, resultado: lido.codigo }));
    return resposta({ ok: false, codigo: lido.codigo, ...(lido.item_status ? { item_status: lido.item_status } : {}) }, 200, cors);
  } catch {
    // Erro nosso, inesperado. Se a leitura já tinha começado, tenta fechá-la como falha (senão o banco
    // a dá como perdida sozinho depois de 90 s, e até lá barra outras leituras).
    if (id) await fechar({ p_ok: false, p_error: "erro_interno", p_item_status: null });
    console.log(JSON.stringify({ fn: FN, origem, resultado: "erro_interno" }));
    return resposta({ ok: false, codigo: "erro_interno" }, 200, cors);
  }
}

// Só liga o servidor dentro do Supabase/Deno. Nos testes (Node) não existe "Deno".
const D = (globalThis as { Deno?: { serve: (h: (r: Request) => Promise<Response>) => unknown; env: Env } }).Deno;
if (D && typeof D.serve === "function") {
  D.serve((req: Request) => handle(req, { get: (n: string) => D.env.get(n) }));
}
