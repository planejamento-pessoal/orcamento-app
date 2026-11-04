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
  function signIn(email, password) {
    return sb.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
      return r.error ? fail(r.error) : good({ session: r.data.session });
    }, fail);
  }
  function signUp(email, password) {
    return sb.auth.signUp({ email: email, password: password }).then(function (r) {
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
  function resetPassword(email) {
    var back = location.origin + location.pathname;
    return sb.auth.resetPasswordForEmail(email, { redirectTo: back }).then(function (r) { return r.error ? fail(r.error) : good(); }, fail);
  }
  // Senha nova depois do link do e-mail ("esqueci a senha"): a sessão do link já prova quem é.
  function updatePassword(pw) {
    return sb.auth.updateUser({ password: pw }).then(function (r) { return r.error ? fail(r.error) : good(); }, fail);
  }
  // Troca de senha com a pessoa já logada: confere a senha ATUAL antes. Protege contra
  // celular desbloqueado na mão de outra pessoa. O pedido também leva current_password,
  // para o servidor exigir a mesma coisa quando "Require current password" estiver ligado.
  function changePassword(email, current, next) {
    return sb.auth.signInWithPassword({ email: email, password: current }).then(function (r) {
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
  function fetchAll(table, orderCols) {
    var out = [], from = 0, size = 1000;
    function next() {
      var q = sb.from(table).select('*');
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
  function fetchSettled() {
    return fetchAll('budget_settled', ['item_id', 'month']).then(function (rows) { return { rows: rows, ok: true }; }, function (e) {
      if (missingTable(e, 'budget_settled')) return { rows: [], ok: false };
      throw e;
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
        var data = { items: p[0], rates: p[1], entries: p[2], settled: p[4].rows, settledOk: p[4].ok, purchases: p[5].rows, purchasesOk: p[5].ok, settings: st };
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
  function patchCache(uid, data) {
    var c = store.get(CACHE_KEY + uid, null);
    if (c && typeof c === 'object') store.set(CACHE_KEY + uid, { at: c.at, data: data });
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
  function setRole(userId, role) {
    return sb.rpc('admin_set_role', { p_user: userId, p_role: role }).then(function (r) { return r.error ? fail(r.error) : good(); }, fail);
  }

  App.data = {
    store: store, configured: configured, configProblem: configProblem, problem: function () { return problem; }, init: init, explain: explain, uuid: uuid,
    getSession: getSession, openSession: openSession, wipeAll: wipeAll, profileKey: function (uid) { return PROFILE_KEY + uid; },
    onAuth: onAuth, signIn: signIn, signUp: signUp, signOut: signOut, resetPassword: resetPassword,
    updatePassword: updatePassword, changePassword: changePassword,
    loadProfile: loadProfile, redeem: redeem, loadAll: loadAll, readCache: readCache, clearCache: clearCache, patchCache: patchCache,
    createItem: createItem, updateItem: updateItem, deleteItem: deleteItem, applyEdit: applyEdit, saveSettings: saveSettings, setSettled: setSettled,
    createPurchase: createPurchase, updatePurchase: updatePurchase, deletePurchase: deletePurchase,
    listProfiles: listProfiles, listInvites: listInvites, createInvite: createInvite, revokeInvite: revokeInvite, setRole: setRole
  };
})(window.App = window.App || {});
