/* ════════════════════════════════════════════════════════════════════════
   data.js — tudo que fala com o Supabase (login, leitura, gravação, admin)
   e a cópia local (para abrir rápido e mostrar algo sem internet).
   Nenhuma função aqui lança erro para a tela: devolve { ok, error }.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var E = window.Engine;
  var sb = null, cfg = null;
  var CACHE_KEY = 'orc.cache.v1:', PROFILE_KEY = 'orc.perfil.v1:';

  // ── armazenamento local (localStorage pode falhar: sempre com try/catch) ──
  var store = {
    get: function (k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // ── conferência do config.js ───────────────────────────────────────────
  // Este arquivo é PÚBLICO (vai para o GitHub e para o celular). Só a chave pública
  // pode ficar nele. Se alguém colar a chave secreta por engano, o app se recusa a
  // usá-la e avisa. Devolve null (tudo certo) ou um código do problema; nunca
  // devolve nem mostra o valor da chave.
  function jwtPayload(tok) {
    try {
      var seg = String(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (seg.length % 4) seg += '=';
      return JSON.parse(atob(seg));
    } catch (e) { return null; }
  }
  function apiUrl(raw) { // "https://abc.supabase.co/" -> URL já conferida, ou null
    try {
      var u = new URL(String(raw).trim());
      var ok = u.protocol === 'https:' && !u.username && !u.password && !u.port && u.pathname === '/' && !u.search && !u.hash &&
        /^[a-z0-9-]+\.supabase\.co$/.test(u.hostname);
      return ok ? u : null;
    } catch (e) { return null; }
  }
  function configProblem(c) {
    if (!c || typeof c.SUPABASE_URL !== 'string' || typeof c.SUPABASE_ANON_KEY !== 'string') return 'ausente';
    var url = c.SUPABASE_URL.trim(), key = c.SUPABASE_ANON_KEY.trim();
    if (/^sb_secret_/i.test(key)) return 'chave-secreta';
    var pl = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/.test(key) ? jwtPayload(key) : null;
    if (pl && pl.role === 'service_role') return 'chave-secreta';
    if (!url || !key || /COLE_AQUI/.test(url + key)) return 'modelo';
    if (!apiUrl(url)) return 'url';
    if (/^sb_publishable_[\w-]{20,}$/.test(key)) return null;
    if (pl && pl.role === 'anon') return null; // formato antigo da chave pública (JWT "anon")
    return 'chave';
  }
  function configured(c) { return configProblem(c) === null; }
  var problem = 'ausente';
  function init() {
    cfg = window.APP_CONFIG || {};
    problem = configProblem(cfg);
    if (!problem && !(window.supabase && window.supabase.createClient)) problem = 'biblioteca';
    if (problem) return false;
    sb = window.supabase.createClient(apiUrl(cfg.SUPABASE_URL).origin, cfg.SUPABASE_ANON_KEY.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'orc.auth' }
    });
    return true;
  }

  // ── mensagens de erro em português ─────────────────────────────────────
  function explain(err) {
    var msg = String((err && (err.message || err.error_description || err.msg || err.details)) || err || '');
    if (/Failed to fetch|NetworkError|Load failed|fetch failed|network request/i.test(msg)) return 'Sem conexão com a internet. Tente de novo.';
    // "apagar convite já usado" (arquivo 04_apagar_convite.sql): o banco ainda não tem a função
    if (/admin_delete_invite/i.test(msg) && /could not find|schema cache|does not exist|PGRST202|42883/i.test(msg)) return 'O banco ainda não tem o "apagar convite usado". No Supabase, rode o arquivo 04_apagar_convite.sql (é seguro: não apaga nada seu) e tente de novo.';
    // verificação do Cloudflare recusada pelo Supabase (código vencido, repetido ou ausente)
    if (/captcha/i.test(msg)) return 'A verificação de segurança não passou. Espere um instante e tente de novo. Se continuar, feche e abra o app.';
    if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
    if (/already registered|already been registered|User already/i.test(msg)) return 'Este e-mail já tem conta. Toque em Entrar.';
    if (/Email not confirmed/i.test(msg)) return 'Falta confirmar o e-mail. Abra o link que chegou na sua caixa de entrada e depois entre.';
    if (/rate limit|too many requests|over_email_send_rate_limit|over_request_rate_limit/i.test(msg)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
    if (/signup_disabled|signups? (are |is )?(not allowed|disabled)/i.test(msg)) return 'O cadastro de contas novas está fechado agora. Peça a quem administra o app para abri-lo e passar um convite.';
    if (/pwned|leaked|known to be weak|easy to guess/i.test(msg)) return 'Essa senha já apareceu em vazamentos de dados. Escolha outra.';
    if (/weak_password|Password should|at least \d+ char/i.test(msg)) return 'A senha é fraca. Use 10 ou mais caracteres e nada óbvio.';
    if (/same_password|different from the old/i.test(msg)) return 'A nova senha precisa ser diferente da atual.';
    if (/current.?password|reauthentication/i.test(msg)) return 'A senha atual está incorreta.';
    if (/email_address_invalid|Unable to validate email|invalid format|invalid email/i.test(msg)) return 'E-mail inválido.';
    if (/sem_permissao|permission denied|row-level security|42501/i.test(msg)) return 'Você não tem permissão para fazer isso (conta somente leitura).';
    if (/nao_pode_rebaixar/i.test(msg)) return 'Você não pode tirar o seu próprio acesso de admin.';
    if (/ultimo_admin/i.test(msg)) return 'O app precisa ter pelo menos um admin.';
    if (/usuario_nao_encontrado/i.test(msg)) return 'Essa pessoa não foi encontrada.';
    if (/papel_invalido|validade_invalida/i.test(msg)) return 'Opção inválida.';
    if (/nao_autenticado|JWT|not authenticated|Auth session missing|refresh.?token|session_(not_found|expired)/i.test(msg)) return 'Sua sessão expirou. Entre de novo.';
    // conta corrente (coluna carry_over, versão 1.3.0 do 01_schema.sql)
    if (/carry_over/i.test(msg) && /column|schema cache|does not exist|could not find/i.test(msg)) return 'O banco ainda não tem a conta corrente. No Supabase, rode o arquivo 01_schema.sql de novo (é seguro: não apaga nada) e toque em atualizar.';
    if (/items_one_carry/i.test(msg)) return 'Já existe outra conta corrente. Só um item por vez: desligue a outra antes.';
    if (/items_carry_chk/i.test(msg)) return 'A conta corrente precisa ser uma entrada que não repete todo mês.';
    if (/duplicate key/i.test(msg)) return 'Esse registro já existe.';
    if (/violates check constraint/i.test(msg)) return 'Algum valor não é aceito. Confira nome, dia, datas e valores.';
    return 'Não deu certo: ' + (msg || 'erro desconhecido') + '.';
  }
  function fail(err) { return { ok: false, error: explain(err), raw: err }; }
  function good(extra) { var r = { ok: true }; if (extra) for (var k in extra) r[k] = extra[k]; return r; }
  function must(res) { if (res && res.error) throw res.error; return res; }

  // ── sessão guardada no aparelho ────────────────────────────────────────
  function storedSession() {
    var s = store.get('orc.auth', null);
    return s && typeof s === 'object' && s.user && s.user.id && s.refresh_token ? s : null;
  }
  function isNetworkError(e) {
    if (!e) return false;
    return e.name === 'AuthRetryableFetchError' || e.status === 0 || /Failed to fetch|NetworkError|Load failed|fetch failed|network request/i.test(String(e.message || e));
  }
  // Sessão para abrir o app: { session, offline }.
  // Com o token vencido e sem internet, a biblioteca do Supabase fica ~25 s tentando renovar e no
  // fim diz "sem sessão" (sem apagar a guardada). Para o app abrir NA HORA com a cópia local,
  // sem internet (ou sem resposta em waitMs) usamos a sessão guardada no aparelho, só para
  // saber QUEM é. Os dados novos continuam dependendo do servidor.
  function openSession(waitMs) {
    var kept = storedSession();
    var lib = sb.auth.getSession().then(function (r) {
      return r.data && r.data.session ? { session: r.data.session, offline: false } : { session: null, offline: false, error: r.error };
    }, function (e) { return { session: null, offline: false, error: e }; });
    if (!kept) return lib;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve({ session: kept, offline: true });
    var slow = new Promise(function (res) { setTimeout(function () { res({ session: kept, offline: true }); }, waitMs || 6000); });
    return Promise.race([lib, slow]).then(function (r) { return !r.session && isNetworkError(r.error) ? { session: kept, offline: true } : r; });
  }
  // Ninguém logado: nada do orçamento pode ficar guardado neste aparelho.
  function wipeAll() {
    try {
      var del = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.indexOf(CACHE_KEY) === 0 || k.indexOf(PROFILE_KEY) === 0)) del.push(k);
      }
      del.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  // ── login ──────────────────────────────────────────────────────────────
  function getSession() { return sb.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session : null; }, function () { return null; }); }
  function onAuth(cb) {
    // Chamamos o app fora do callback (regra do supabase-js: nada de await dentro dele)
    return sb.auth.onAuthStateChange(function (event, session) { setTimeout(function () { cb(event, session); }, 0); });
  }
  // Verificação do Cloudflare (Turnstile). No config.js vai só a chave do SITE (pública, feita para ficar no app); a chave
  // SECRETA fica apenas no painel do Supabase e nunca passa por aqui. Sem chave (ou com um valor que não parece chave do
  // site), o app funciona como sempre e nada é mostrado nem enviado. Quem EXIGE a verificação é o Supabase (Authentication,
  // Attack Protection): o app só pega o código com o Cloudflare e o manda junto com entrar, criar conta e "esqueci a senha".
  function captchaKey() {
    var k = cfg && typeof cfg.TURNSTILE_SITEKEY === 'string' ? cfg.TURNSTILE_SITEKEY.trim() : '';
    return /^[0-9A-Za-z_-]{20,32}$/.test(k) ? k : null;   // a chave SECRETA do Cloudflare é maior (35): nunca é aceita aqui
  }
  // O campo TURNSTILE_SITEKEY está preenchido, mas com algo que não é chave de site (a SECRETA colada por engano, um pedaço
  // de chave, texto qualquer)? Vazio ou ausente não é problema: é o app sem verificação. Nunca devolve o valor.
  function captchaProblem() {
    var v = cfg ? cfg.TURNSTILE_SITEKEY : undefined;
    if (v === undefined || v === null) return false;
    if (typeof v !== 'string') return true;
    return v.trim() !== '' && captchaKey() === null;
  }
  // Os pedidos só levam o código quando ele existe: sem a verificação ligada, o pedido é igual ao de sempre.
  function withToken(args, token) { if (token) args.options = { captchaToken: token }; return args; }
  function signIn(email, password, token) {
    return sb.auth.signInWithPassword(withToken({ email: email, password: password }, token)).then(function (r) {
      return r.error ? fail(r.error) : good({ session: r.data.session });
    }, fail);
  }
  function signUp(email, password, token) {
    return sb.auth.signUp(withToken({ email: email, password: password }, token)).then(function (r) {
      if (r.error) return fail(r.error);
      var u = r.data && r.data.user;
      if (u && Array.isArray(u.identities) && u.identities.length === 0) return fail({ message: 'User already registered' });
      return good({ session: r.data.session, needsConfirm: !(r.data && r.data.session) });
    }, fail);
  }
  // Sair: mesmo sem internet a sessão tem que sair DESTE aparelho (a biblioteca desiste de apagar a sessão
  // guardada quando o aviso ao servidor falha, e pode ficar presa ~25 s se estiver renovando um token).
  function signOut() {
    return new Promise(function (resolve) {
      var settled = false, timer;
      function finish() { // roda uma vez só (um aviso tardio não pode apagar uma sessão nova)
        if (settled) return;
        settled = true; clearTimeout(timer);
        store.del('orc.auth');
        resolve(good());
      }
      timer = setTimeout(finish, 2500);
      sb.auth.signOut().then(finish, finish);
    });
  }
  function resetPassword(email, token) {
    var back = location.origin + location.pathname;
    var opts = { redirectTo: back };
    if (token) opts.captchaToken = token;
    return sb.auth.resetPasswordForEmail(email, opts).then(function (r) { return r.error ? fail(r.error) : good(); }, fail);
  }
  // Senha nova depois do link do e-mail ("esqueci a senha"): a sessão do link já prova quem é.
  function updatePassword(pw) {
    return sb.auth.updateUser({ password: pw }).then(function (r) { return r.error ? fail(r.error) : good(); }, fail);
  }
  // Troca de senha com a pessoa já logada: confere a senha ATUAL antes. Protege contra
  // celular desbloqueado na mão de outra pessoa. O pedido também leva current_password,
  // para o servidor exigir a mesma coisa quando "Require current password" estiver ligado.
  function changePassword(email, current, next, token) {
    return sb.auth.signInWithPassword(withToken({ email: email, password: current }, token)).then(function (r) {
      if (r.error) {
        var m = String(r.error.message || r.error.code || '');
        return /Invalid login credentials|invalid_credentials/i.test(m) ? { ok: false, error: 'A senha atual está incorreta.', raw: r.error } : fail(r.error);
      }
      return sb.auth.updateUser({ password: next, current_password: current }).then(function (u) { return u.error ? fail(u.error) : good(); }, fail);
    }, fail);
  }

  // ── perfil e convite ───────────────────────────────────────────────────
  // Sem sessão a biblioteca fala com o banco usando só a chave pública (papel "anon"). O app nunca
  // deve fazer isso: sem sessão, não pergunta nada (e não troca a cópia local por uma resposta vazia).
  function withSession(fn) {
    return sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) return fn();
      return fail({ message: isNetworkError(r.error) ? 'Failed to fetch' : 'nao_autenticado' });
    }, fail);
  }
  function loadProfile(uid) {
    return withSession(function () {
      return sb.from('profiles').select('*').eq('id', uid).then(function (r) {
        if (r.error) return fail(r.error);
        return good({ profile: r.data && r.data.length ? r.data[0] : null });
      }, fail);
    });
  }
  function redeem(code, name) {
    return sb.rpc('redeem_invite', { p_code: code, p_name: name || null }).then(function (r) {
      return r.error ? fail(r.error) : good({ result: r.data });
    }, fail);
  }

  // ── leitura ────────────────────────────────────────────────────────────
  function fetchAll(table, orderCols, cols) {
    var out = [], from = 0, size = 1000;
    function next() {
      var q = sb.from(table).select(cols || '*');
      orderCols.forEach(function (c) { q = q.order(c, { ascending: true }); });
      return q.range(from, from + size - 1).then(function (r) {
        if (r.error) throw r.error;
        var rows = r.data || [];
        out = out.concat(rows);
        if (rows.length < size) return out;
        from += size;
        return next();
      });
    }
    return next();
  }
  // As marcas de pago/recebido ficam numa tabela que veio numa versão nova do 01_schema.sql.
  // Quem ainda não rodou essa versão no Supabase continua usando o app normal, só sem a
  // chavinha (settledOk = false): o app avisa na tela do Mês o que fazer.
  function missingTable(e, table) {
    var code = String((e && e.code) || ''), msg = String((e && (e.message || e.details || e.hint)) || '');
    return code === '42P01' || code === 'PGRST205' || (new RegExp(table || 'budget_settled').test(msg) && /does not exist|schema cache|could not find/i.test(msg));
  }
  // A HORA da marca (coluna settled_at, arquivo 03_marcas_com_hora.sql, versão 1.5.0) é pedida pelo nome. Se o banco ainda
  // não tem a coluna, pede só item e mês como antes e avisa (atOk = false): sem a hora o saldo lido da 99Pay não pode ser
  // usado nas contas (a sobra pularia ao marcar um item), então o app segue calculando como na 1.4.0.
  // Atenção: o erro de "coluna não existe" também cita o nome da tabela, por isso a coluna é conferida ANTES da tabela.
  function missingColumn(e, col) {
    var code = String((e && e.code) || ''), msg = String((e && (e.message || e.details || e.hint)) || '');
    return code === '42703' || code === 'PGRST204' || (new RegExp(col).test(msg) && /does not exist|schema cache|could not find/i.test(msg));
  }
  function fetchSettled() {
    function result(atOk) { return function (rows) { return { rows: rows, ok: true, atOk: atOk }; }; }
    function noTable(e) {
      if (missingTable(e, 'budget_settled')) return { rows: [], ok: false, atOk: false };
      throw e;
    }
    return fetchAll('budget_settled', ['item_id', 'month'], 'item_id,month,settled_at').then(result(true), function (e) {
      if (missingColumn(e, 'settled_at')) return fetchAll('budget_settled', ['item_id', 'month'], 'item_id,month').then(result(false), noTable);
      return noTable(e);
    });
  }
  // A lista de compras (aba Compras) também veio numa versão nova do 01_schema.sql: sem a tabela, o app
  // segue normal e a aba Compras explica o que fazer (purchasesOk = false).
  function fetchPurchases() {
    return fetchAll('purchases', ['seq']).then(function (rows) { return { rows: rows, ok: true }; }, function (e) {
      if (missingTable(e, 'purchases')) return { rows: [], ok: false };
      throw e;
    });
  }
  function loadAll(uid) {
    return withSession(function () {
      return Promise.all([
        fetchAll('budget_items', ['id']),
        fetchAll('item_rates', ['item_id', 'from_month']),
        fetchAll('budget_entries', ['item_id', 'month']),
        sb.from('app_settings').select('*'),
        fetchSettled(),
        fetchPurchases()
      ]).then(function (p) {
        if (p[3].error) throw p[3].error;
        var st = p[3].data && p[3].data[0] ? p[3].data[0] : { balance_start_month: F().currentMonth() + '-01', opening_balance: 0, min_balance: 1000 };
        var data = { items: p[0], rates: p[1], entries: p[2], settled: p[4].rows, settledOk: p[4].ok, settledAtOk: p[4].atOk, purchases: p[5].rows, purchasesOk: p[5].ok, settings: st };
        store.set(CACHE_KEY + uid, { at: Date.now(), data: data });
        return good({ data: data });
      }).catch(fail);
    });
  }
  function F() { return window.Format; }
  function readCache(uid) { return store.get(CACHE_KEY + uid, null); }
  function clearCache(uid) { store.del(CACHE_KEY + uid); }
  // Troca só os dados da cópia local (mantém a data em que ela foi baixada do servidor).
  // Usada depois de marcar pago/recebido, para a cópia sem internet já mostrar a marca.
  // O saldo lido da 99Pay (data.saldoReal) fica só na memória: nunca vai para a cópia do aparelho.
  function patchCache(uid, data) {
    var c = store.get(CACHE_KEY + uid, null);
    if (!c || typeof c !== 'object') return;
    var copy = {};
    for (var k in data) if (k !== 'saldoReal') copy[k] = data[k];
    store.set(CACHE_KEY + uid, { at: c.at, data: copy });
  }

  // ── gravação do orçamento ──────────────────────────────────────────────
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function rateRows(itemId, rates) { return rates.map(function (r) { return { item_id: itemId, from_month: r.from_month, amount: r.amount }; }); }

  // item: campos de budget_items; rates: [{from_month, amount (reais)}]; entries: [{month, amount (reais)}]
  function createItem(item, rates, entries) {
    var id = item.id || uuid(), row = {};
    for (var k in item) row[k] = item[k];
    row.id = id;
    delete row.created_by; delete row.created_at; delete row.updated_at; delete row.sim;
    return sb.from('budget_items').insert(row).then(function (r) {
      must(r);
      var steps = Promise.resolve();
      if (rates && rates.length) steps = steps.then(function () { return sb.from('item_rates').insert(rateRows(id, rates)).then(must); });
      if (entries && entries.length) steps = steps.then(function () {
        return sb.from('budget_entries').insert(entries.map(function (e) { return { item_id: id, month: e.month, amount: e.amount }; })).then(must);
      });
      return steps.then(function () { return good({ id: id }); }, function (err) {
        // desfaz o item para não sobrar um item sem valores
        return sb.from('budget_items').delete().eq('id', id).then(function () { return fail(err); }, function () { return fail(err); });
      });
    }).catch(fail);
  }

  function updateItem(id, patch) {
    return sb.from('budget_items').update(patch).eq('id', id).select().then(function (r) {
      must(r);
      if (!r.data || !r.data.length) return fail({ message: 'sem_permissao' });
      return good();
    }).catch(fail);
  }
  function deleteItem(id) {
    return sb.from('budget_items').delete().eq('id', id).select().then(function (r) {
      must(r);
      if (!r.data || !r.data.length) return fail({ message: 'sem_permissao' });
      return good();
    }).catch(fail);
  }

  // Aplica o plano que o motor (Engine.planEdit) devolveu. Ordem pensada para
  // nunca deixar o item sem valor se algo falhar no meio: primeiro grava o novo
  // valor, só depois apaga o que ele substitui.
  // Exceção: ao DESLIGAR a conta corrente os saldos reais lançados saem antes de o item virar comum. Se a gravação
  // parasse no meio, o item ainda seria conta corrente e o saldo não mudaria; na ordem contrária, esses saldos
  // passariam a somar como entradas e inflariam o saldo.
  function applyEdit(itemId, ops) {
    var p = Promise.resolve();
    var carryOff = !!(ops.item && ops.item.carry_over === false);
    function dropEntries() {
      ops.deleteEntries.forEach(function (mo) {
        p = p.then(function () { return sb.from('budget_entries').delete().eq('item_id', itemId).eq('month', mo).then(must); });
      });
    }
    if (ops.upsertRates.length) p = p.then(function () {
      return sb.from('item_rates').upsert(ops.upsertRates.map(function (r) { return { item_id: itemId, from_month: r.from_month, amount: r.amount / 100 }; }), { onConflict: 'item_id,from_month' }).then(must);
    });
    if (ops.upsertEntries.length) p = p.then(function () {
      return sb.from('budget_entries').upsert(ops.upsertEntries.map(function (e) { return { item_id: itemId, month: e.month, amount: e.amount / 100 }; }), { onConflict: 'item_id,month' }).then(must);
    });
    if (carryOff) dropEntries();
    if (ops.item) p = p.then(function () {
      return sb.from('budget_items').update(ops.item).eq('id', itemId).select().then(function (r) {
        must(r);
        if (!r.data || !r.data.length) throw { message: 'sem_permissao' };
      });
    });
    ops.deleteRates.forEach(function (fm) {
      p = p.then(function () { return sb.from('item_rates').delete().eq('item_id', itemId).eq('from_month', fm).then(must); });
    });
    if (!carryOff) dropEntries();
    // marcas de pago/recebido por último: o valor já está salvo quando a marca entra
    (ops.addSettled || []).forEach(function (mo) {
      p = p.then(function () { return markSettled(itemId, mo, true).then(must); });
    });
    (ops.deleteSettled || []).forEach(function (mo) {
      p = p.then(function () { return markSettled(itemId, mo, false).then(must); });
    });
    return p.then(function () { return good(); }, fail);
  }

  // Marca (on) ou desmarca um item como pago/recebido num mês ("AAAA-MM-01"). Devolve a promessa
  // crua da biblioteca (use .then(must) ou setSettled, que já devolve { ok, error }).
  function markSettled(itemId, month, on) {
    return on
      ? sb.from('budget_settled').upsert({ item_id: itemId, month: month }, { onConflict: 'item_id,month', ignoreDuplicates: true })
      : sb.from('budget_settled').delete().eq('item_id', itemId).eq('month', month);
  }
  function setSettled(itemId, month, on) {
    return markSettled(itemId, month, on).then(must).then(function () { return good(); }, fail);
  }

  function saveSettings(patch) {
    return sb.from('app_settings').update(patch).eq('id', 1).select().then(function (r) {
      must(r);
      if (!r.data || !r.data.length) return fail({ message: 'sem_permissao' });
      return good({ settings: r.data[0] });
    }).catch(fail);
  }

  // ── compras (aba Compras) ──────────────────────────────────────────────
  // row: campos de purchases em reais ou texto; o banco confere tudo de novo (restrições e RLS).
  function createPurchase(row) {
    var r0 = {};
    for (var k in row) r0[k] = row[k];
    delete r0.id; delete r0.seq; delete r0.created_by; delete r0.created_at; delete r0.updated_at;
    return sb.from('purchases').insert(r0).select().then(function (r) {
      must(r);
      if (!r.data || !r.data.length) return fail({ message: 'sem_permissao' });
      return good({ id: r.data[0].id });
    }).catch(fail);
  }
  function updatePurchase(id, patch) {
    return sb.from('purchases').update(patch).eq('id', id).select().then(function (r) {
      must(r);
      if (!r.data || !r.data.length) return fail({ message: 'sem_permissao' });
      return good();
    }).catch(fail);
  }
  function deletePurchase(id) {
    return sb.from('purchases').delete().eq('id', id).select().then(function (r) {
      must(r);
      if (!r.data || !r.data.length) return fail({ message: 'sem_permissao' });
      return good();
    }).catch(fail);
  }

  // ── saldo na 99Pay (só leitura; só o admin vê) ─────────────────────────
  // Quem lê o MeuPluggy é a função "saldo-99pay" do Supabase (pasta supabase/functions). O app nunca fala com a
  // Pluggy e não guarda chave nenhuma dela. Cada leitura fica na tabela pay99_balance_reads (arquivo 02_saldo99.sql),
  // que só o admin consegue ler. Desde a versão 1.5.0 o saldo lido é o ponto de partida das contas do MÊS ATUAL (veja
  // saldoReal abaixo e o motor, engine.js): a sobra prevista = saldo lido + o que falta receber − o que falta pagar.
  // Sem leitura boa, sem a hora das marcas (arquivo 03) ou sem a conta corrente definida, as contas são as de sempre.
  // installed:false = o banco ainda não tem a tabela (02 não rodou): o app segue normal e o cartão nem aparece.
  var S99 = { FN: 'saldo-99pay', TABELA: 'pay99_balance_reads', VELHO_H: 30, PEDIDO_MS: 50000, PENDENTE_S: 90 };
  var S99_SUAVES = ['em_andamento', 'limite_diario', 'intervalo'];   // recusas de propósito do banco: não são defeito
  var S99_TEXTO = {
    em_andamento: 'Já tem uma leitura em andamento. Espere um instante.',
    limite_diario: 'Já foram feitas 12 leituras nas últimas 24 horas. Tente de novo mais tarde.',
    sem_login: 'Sua sessão expirou. Entre de novo.',
    sem_permissao: 'Só o admin pode ler o saldo da 99Pay.',
    origem_invalida: 'O app e a função de leitura não combinam (versões diferentes). Atualize o app e tente de novo.',
    use_post: 'O app e a função de leitura não combinam (versões diferentes). Atualize o app e tente de novo.',
    origem_nao_permitida: 'A função de leitura não aceitou o endereço deste app. No Supabase, confira o segredo APP_ORIGIN (veja o LEIA-ME).',
    funcao_nao_configurada: 'A função de leitura está instalada, mas faltam segredos dela no Supabase (veja o LEIA-ME).',
    funcao_nao_instalada: 'A função de leitura ainda não foi instalada no Supabase (veja o LEIA-ME).',
    sem_resposta_da_funcao: 'Não consegui falar com a função de leitura. Veja se a internet está boa; se estiver, a função pode não estar instalada ou não aceitou o endereço do app (veja o LEIA-ME).',
    resposta_estranha: 'A função respondeu algo que o app não entendeu. Nada foi alterado.',
    banco_sem_migracao: 'O banco ainda não tem a leitura do saldo. No Supabase, rode o arquivo 02_saldo99.sql.',
    banco_indisponivel: 'O Supabase não respondeu direito. Tente de novo em instantes.',
    gravacao_falhou: 'Li o saldo, mas não consegui gravar o resultado. Tente de novo.',
    pluggy_login_recusado: 'A Pluggy recusou as chaves da função. Confira os segredos PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no Supabase.',
    pluggy_limite: 'A Pluggy pediu para esperar (muitas consultas). Tente de novo mais tarde.',
    pluggy_indisponivel: 'A Pluggy está fora do ar agora. Tente de novo mais tarde.',
    item_nao_encontrado: 'A Pluggy não encontrou a conexão da 99Pay. No MeuPluggy, veja se ela ainda está conectada e confira o segredo PLUGGY_ITEM_ID.',
    pluggy_resposta_inesperada: 'A Pluggy respondeu algo que a função não entendeu. Nada foi alterado.',
    sem_conta_bancaria: 'A Pluggy não mostrou nenhuma conta da 99Pay.',
    varias_contas: 'A Pluggy mostrou mais de uma conta e a função não sabe qual usar. Informe o segredo PLUGGY_ACCOUNT_ID (veja o LEIA-ME).',
    conta_nao_encontrada: 'A conta informada em PLUGGY_ACCOUNT_ID não apareceu na Pluggy.',
    moeda_inesperada: 'A conta não está em reais, então não mostrei o valor.',
    saldo_invalido: 'A Pluggy mandou um saldo que não parece válido. Nada foi alterado.',
    sem_hora_do_dado: 'A Pluggy não disse quando o dado foi atualizado, então não mostro o saldo (poderia estar velho sem eu saber).',
    erro_interno: 'Deu erro dentro da função (não foi a Pluggy). Tente de novo; se repetir, veja os logs da função no Supabase.',
    sem_resposta: 'A leitura anterior não terminou (a função não respondeu a tempo).'
  };
  var S99_ITEM = {   // situação da conexão no MeuPluggy (UPDATED não precisa de aviso)
    UPDATING: 'O MeuPluggy está atualizando agora; o saldo pode mudar em alguns minutos.',
    LOGIN_ERROR: 'O MeuPluggy não conseguiu entrar na 99Pay. Abra o MeuPluggy e reconecte a conta.',
    OUTDATED: 'A última atualização do MeuPluggy deu erro, então o dado pode estar velho. Abra o MeuPluggy e toque em Atualizar.',
    WAITING_USER_INPUT: 'O MeuPluggy está esperando uma ação sua. Abra o MeuPluggy.'
  };
  // Texto em português para um código da função (ou do banco). Código que o app não conhece aparece como está
  // (só letras minúsculas, números e _), nunca texto vindo de fora.
  function saldo99Text(code, waitS) {
    var c = typeof code === 'string' && /^[a-z0-9_]{1,40}$/.test(code) ? code : 'erro_interno';
    if (c === 'intervalo') return waitS > 0 ? 'Leitura feita há pouco. Dá para ler de novo em ' + F().waitText(waitS) + '.' : 'Leitura feita há pouco. Espere um pouco para ler de novo.';
    return Object.prototype.hasOwnProperty.call(S99_TEXTO, c) ? S99_TEXTO[c] : 'Não deu certo (código ' + c + ').';
  }
  function saldo99Hint(itemStatus) {
    return typeof itemStatus === 'string' && Object.prototype.hasOwnProperty.call(S99_ITEM, itemStatus) ? S99_ITEM[itemStatus] : '';
  }

  // Leituras guardadas (a mais nova primeiro). installed:false = a tabela não existe ainda.
  function loadSaldo99() {
    return withSession(function () {
      return sb.from(S99.TABELA).select('id,source,requested_at,finished_at,ok,balance_cents,data_as_of,item_status,error')
        .order('requested_at', { ascending: false }).limit(20).then(function (r) {
          if (r.error) return missingTable(r.error, S99.TABELA) ? good({ installed: false, rows: [] }) : fail(r.error);
          return good({ installed: true, rows: r.data || [] });
        }, fail);
    });
  }

  // Resposta da função -> { ok:true, cents, dataAt, itemStatus } ou { ok:false, code, soft, wait, itemStatus, error }.
  // Só entram códigos no formato esperado; o texto mostrado é sempre o nosso (saldo99Text).
  function saldo99Reply(b, status) {
    if (b && b.ok === true && typeof b.saldo_centavos === 'number' && isFinite(b.saldo_centavos) && typeof b.dado_em === 'string' && !isNaN(F().toMs(b.dado_em))) {
      return good({ cents: b.saldo_centavos, dataAt: b.dado_em, itemStatus: typeof b.item_status === 'string' ? b.item_status : null });
    }
    var code = b && typeof b.codigo === 'string' && /^[a-z0-9_]{1,40}$/.test(b.codigo) ? b.codigo
      : status === 404 ? 'funcao_nao_instalada' : status === 401 ? 'sem_login' : status === 403 ? 'sem_permissao' : status === 503 ? 'funcao_nao_configurada' : 'resposta_estranha';
    var wait = b && typeof b.espere_s === 'number' && isFinite(b.espere_s) ? Math.min(86400, Math.max(1, Math.ceil(b.espere_s))) : 0;
    var st = b && typeof b.item_status === 'string' && /^[A-Z_]{1,30}$/.test(b.item_status) ? b.item_status : null;
    return { ok: false, code: code, soft: S99_SUAVES.indexOf(code) >= 0, wait: wait, itemStatus: st, error: saldo99Text(code, wait) };
  }
  // Pede uma leitura à função. origem: 'ao_abrir' (automática) ou 'manual' (botão). Nunca lança erro.
  function readSaldo99(origem) {
    function semResposta() { return saldo99Reply({ codigo: 'sem_resposta_da_funcao' }, 0); }
    return withSession(function () {
      return sb.functions.invoke(S99.FN, { body: { origem: origem }, timeout: S99.PEDIDO_MS }).then(function (r) {
        if (!r.error) return saldo99Reply(r.data, 200);
        var res = r.error.context;   // resposta com status de erro (401, 403, 404, 503...): o corpo traz o código quando é da nossa função
        if (r.error.name === 'FunctionsHttpError' && res && typeof res.json === 'function') {
          return res.json().then(function (b) { return saldo99Reply(b, res.status); }, function () { return saldo99Reply(null, res.status); });
        }
        return semResposta();         // sem rede, tempo esgotado ou bloqueio do navegador (CORS)
      }, semResposta);
    });
  }

  // Resumo das leituras guardadas, para o cartão: o último saldo BOM (mesmo que a última tentativa tenha falhado),
  // se ele está velho (dado com mais de 30 h: o MeuPluggy atualiza a cada 24 h), e o que houve na última tentativa.
  function saldo99Summary(rows, nowMs) {
    var now = nowMs == null ? Date.now() : nowMs, list = Array.isArray(rows) ? rows : [], i, ok = null, t;
    var out = { has: false, cents: null, dataAt: null, readAt: null, old: false, itemStatus: null, pending: false, fail: null };
    for (i = 0; i < list.length; i++) {
      var x = list[i];
      if (x && x.ok === true && x.balance_cents != null && isFinite(Number(x.balance_cents)) && x.data_as_of) { ok = x; break; }
    }
    if (ok) {
      out.has = true; out.cents = Number(ok.balance_cents); out.dataAt = ok.data_as_of; out.readAt = ok.finished_at || ok.requested_at;
      out.itemStatus = ok.item_status || null;
      t = F().toMs(ok.data_as_of);
      out.old = isNaN(t) || now - t > S99.VELHO_H * 3600000;
    }
    var first = list[0] || null;
    if (first && first !== ok) {
      if (first.ok === false) out.fail = { code: first.error || 'erro_interno', at: first.finished_at || first.requested_at, itemStatus: first.item_status || null };
      else if (first.ok == null) {   // leitura que começou e não terminou
        t = F().toMs(first.requested_at);
        if (!isNaN(t) && now - t < S99.PENDENTE_S * 1000) out.pending = true;
        else out.fail = { code: 'sem_resposta', at: first.requested_at, itemStatus: null };
      }
    }
    return out;
  }

  // O saldo lido como ponto de partida do mês atual (vira data.saldoReal, que o motor usa). Só vale se o dado é do mês
  // atual (pela hora do aparelho); senão devolve null e as contas ficam como sempre. Dado velho (mais de 30 h) ainda
  // vale: a tela avisa "Desatualizado". `sum` = o que saldo99Summary devolveu.
  function saldoReal(sum, nowMs) {
    if (!sum || !sum.has || typeof sum.cents !== 'number' || !isFinite(sum.cents) || Math.floor(sum.cents) !== sum.cents) return null;
    var t = F().toMs(sum.dataAt);
    if (isNaN(t)) return null;
    var m = F().currentMonth(new Date(t));
    if (m !== F().currentMonth(new Date(nowMs == null ? Date.now() : nowMs))) return null;
    return { month: m, cents: sum.cents, asOf: sum.dataAt };
  }
  // Duas leituras valem o mesmo? (a hora é comparada como instante: "…Z" e "…+00:00" são a mesma)
  function sameSaldoReal(a, b) {
    if (!a || !b) return !a && !b;
    return a.month === b.month && a.cents === b.cents && F().toMs(a.asOf) === F().toMs(b.asOf);
  }
  // Hora (ISO) que o aparelho usa, por enquanto, numa marca recém-feita (o banco guarda a hora dele quando grava, e é
  // essa que vale na próxima carga). Nunca é anterior à leitura da 99Pay que já está na tela: a marca nova ainda não está
  // nesse saldo, e um relógio atrasado faria a sobra pular até a próxima carga.
  function markTime(data) {
    var t = Date.now(), sr = data && data.saldoReal, a = sr ? F().toMs(sr.asOf) : NaN;
    if (!isNaN(a) && a >= t) t = a + 1000;
    return new Date(t).toISOString();
  }

  // ── administração de acessos ───────────────────────────────────────────
  function listProfiles() {
    return sb.from('profiles').select('*').order('created_at', { ascending: true }).then(function (r) { return r.error ? fail(r.error) : good({ rows: r.data || [] }); }, fail);
  }
  function listInvites() {
    return sb.from('invites').select('*').order('created_at', { ascending: false }).then(function (r) { return r.error ? fail(r.error) : good({ rows: r.data || [] }); }, fail);
  }
  function createInvite(role, days, note) {
    return sb.rpc('admin_create_invite', { p_role: role, p_days: days, p_note: note || null }).then(function (r) { return r.error ? fail(r.error) : good({ code: r.data }); }, fail);
  }
  function revokeInvite(code) {
    return sb.rpc('admin_revoke_invite', { p_code: code }).then(function (r) { return r.error ? fail(r.error) : good(); }, fail);
  }
  // Apagar um convite da lista. O que ainda não foi usado usa a função que já existia (admin_revoke_invite), então isso
  // funciona mesmo antes de rodar o 04. O já usado precisa da admin_delete_invite (arquivo 04_apagar_convite.sql): a pessoa
  // que usou o convite continua com o acesso dela; só some o registro do convite.
  function deleteInvite(code, used) {
    return sb.rpc(used ? 'admin_delete_invite' : 'admin_revoke_invite', { p_code: code }).then(function (r) { return r.error ? fail(r.error) : good(); }, fail);
  }
  function setRole(userId, role) {
    return sb.rpc('admin_set_role', { p_user: userId, p_role: role }).then(function (r) { return r.error ? fail(r.error) : good(); }, fail);
  }

  App.data = {
    store: store, configured: configured, configProblem: configProblem, problem: function () { return problem; }, init: init, explain: explain, uuid: uuid,
    getSession: getSession, openSession: openSession, wipeAll: wipeAll, profileKey: function (uid) { return PROFILE_KEY + uid; },
    onAuth: onAuth, captchaKey: captchaKey, captchaProblem: captchaProblem, signIn: signIn, signUp: signUp, signOut: signOut, resetPassword: resetPassword,
    updatePassword: updatePassword, changePassword: changePassword,
    loadProfile: loadProfile, redeem: redeem, loadAll: loadAll, readCache: readCache, clearCache: clearCache, patchCache: patchCache,
    createItem: createItem, updateItem: updateItem, deleteItem: deleteItem, applyEdit: applyEdit, saveSettings: saveSettings, setSettled: setSettled,
    createPurchase: createPurchase, updatePurchase: updatePurchase, deletePurchase: deletePurchase,
    loadSaldo99: loadSaldo99, readSaldo99: readSaldo99, saldo99Summary: saldo99Summary, saldo99Text: saldo99Text, saldo99Hint: saldo99Hint, saldo99Reply: saldo99Reply,
    saldoReal: saldoReal, sameSaldoReal: sameSaldoReal, markTime: markTime,
    listProfiles: listProfiles, listInvites: listInvites, createInvite: createInvite, revokeInvite: revokeInvite, deleteInvite: deleteInvite, setRole: setRole
  };
})(window.App = window.App || {});
