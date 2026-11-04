/* ════════════════════════════════════════════════════════════════════════
   app.js — estado, abas, carregamento e entrada no app.
   Fluxo: configurado? → sessão? → perfil/convite? → dados (cópia local
   primeiro, internet em seguida) → telas.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, E = window.Engine, D = App.data, h = d.h;
  App.version = '1.3.0';
  App.views = App.views || {};

  var state = App.state = {
    user: null, profile: null, role: null, data: null, idxFor: null, idxCache: null,
    tab: 'mes', month: F.currentMonth(), projCount: 12, projStart: null,
    offline: false, lastLoad: 0, savedAt: 0, loading: false
  };
  var TABS = [
    { id: 'mes', label: 'Mês', icon: 'calendar' },
    { id: 'proj', label: 'Projeção', icon: 'chart' },
    { id: 'sim', label: 'Simular', icon: 'calc' },
    { id: 'compras', label: 'Compras', icon: 'bag' },
    { id: 'itens', label: 'Itens', icon: 'list' },
    { id: 'conta', label: 'Conta', icon: 'user' }
  ];
  var ROLE_TXT = { admin: 'Admin', editor: 'Editor', leitor: 'Só leitura', bloqueado: 'Bloqueado' };
  App.ROLE_TXT = ROLE_TXT;

  App.can = function () { return state.role === 'admin' || state.role === 'editor'; };
  App.isAdmin = function () { return state.role === 'admin'; };
  App.index = function () {
    if (state.idxFor !== state.data) { state.idxCache = E.buildIndex(state.data); state.idxFor = state.data; }
    return state.idxCache;
  };
  App.root = function () { return document.getElementById('app'); };

  // ── tema ───────────────────────────────────────────────────────────────
  App.setTheme = function (mode) { // 'auto' | 'claro' | 'escuro'
    var el = document.documentElement;
    if (mode === 'claro') el.setAttribute('data-theme', 'light');
    else if (mode === 'escuro') el.setAttribute('data-theme', 'dark');
    else el.removeAttribute('data-theme');
    try { if (mode === 'auto') localStorage.removeItem('orc.tema'); else localStorage.setItem('orc.tema', mode); } catch (e) {}
    var dark = mode === 'escuro' || (mode === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0E1912' : '#E8EFE3');
  };
  App.getTheme = function () { try { return localStorage.getItem('orc.tema') || 'auto'; } catch (e) { return 'auto'; } };

  // ── moldura (topo, conteúdo, abas) ─────────────────────────────────────
  function buildShell() {
    var root = App.root();
    d.clear(root);
    var refresh = h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Atualizar dados', id: 'btn-refresh', on: { click: function () { App.reload(false); } } }, d.icon('refresh'));
    var topo = h('header', { 'class': 'topo' },
      h('h1', { text: 'Orçamento' }),
      h('div', { 'class': 'acoes' }, h('span', { 'class': 'papel', id: 'papel', text: ROLE_TXT[state.role] || '' }), h('span', { id: 'fab-host' }), refresh));
    var banner = h('div', { 'class': 'faixa-offline', id: 'faixa', role: 'status', hidden: true });
    var main = h('main', { 'class': 'main', id: 'main' });
    var tabs = h('nav', { 'class': 'tabs', 'aria-label': 'Seções do app' });
    TABS.forEach(function (t) {
      tabs.appendChild(h('button', { 'class': 'tab', type: 'button', 'data-tab': t.id, on: { click: function () { App.go(t.id); } } }, d.icon(t.icon), h('span', { text: t.label })));
    });
    root.appendChild(h('div', { 'class': 'app' }, topo, banner, main, tabs));
    updateTabs();
  }
  function updateTabs() {
    var btns = document.querySelectorAll('.tab');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-tab') === state.tab) btns[i].setAttribute('aria-current', 'page');
      else btns[i].removeAttribute('aria-current');
    }
  }
  function updateBanner() {
    var f = document.getElementById('faixa');
    if (!f) return;
    if (state.offline) {
      f.hidden = false;
      f.textContent = 'Sem conexão. Mostrando a última cópia' + (state.savedAt ? ' (salva em ' + F.whenShort(new Date(state.savedAt).toISOString()) + ')' : '') + '. Alterações só com internet.';
    } else f.hidden = true;
  }
  App.setFab = function (spec) {
    var host = document.getElementById('fab-host');
    if (!host) return;
    d.clear(host);
    if (spec) host.appendChild(h('button', { 'class': 'fab', type: 'button', title: spec.label, on: { click: spec.on } }, d.icon(spec.icon || 'plus'), h('span', { 'class': 'sr', text: spec.label })));
  };

  // ── navegação e desenho ────────────────────────────────────────────────
  App.go = function (tab, opts) {
    opts = opts || {};
    if (opts.month) state.month = E.normMonth(opts.month);
    state.tab = tab;
    updateTabs();
    App.render(false);
  };
  App.render = function (keepScroll) {
    var main = document.getElementById('main');
    if (!main) return;
    var y = keepScroll ? window.scrollY : 0;
    d.clear(main);
    App.setFab(null);
    if (!state.data && state.tab !== 'conta') {
      main.appendChild(state.loadError
        ? h('div', { 'class': 'vazio' }, h('p', { text: state.loadError }), h('p', null, h('button', { 'class': 'btn primario', type: 'button', text: 'Tentar de novo', on: { click: function () { App.reload(false); } } })))
        : h('div', { 'class': 'carregando', role: 'status', text: 'Carregando seu orçamento…' }));
      return;
    }
    try { App.views[state.tab].render(main); }
    catch (e) {
      if (window.console) console.error(e);
      main.appendChild(h('div', { 'class': 'vazio' }, h('p', { text: 'Algo deu errado ao desenhar esta tela.' }), h('p', { 'class': 'ajuda', text: String(e && e.message || e) })));
    }
    window.scrollTo(0, y);
  };
  function setStale(on) { var m = document.getElementById('main'); if (m) m.classList.toggle('velho', !!on); }

  // Apaga deste aparelho a cópia do orçamento e do perfil (sair, ser bloqueado, sessão que caiu).
  function wipeLocal(uid) { if (uid) { D.clearCache(uid); D.store.del(profileKey(uid)); } }

  // Atualiza os dados. Junto, confere o acesso da pessoa: se o admin mudou o papel dela
  // (ou a bloqueou) com o app aberto, a tela acompanha e a cópia local some.
  // skipProfile: já conferimos o perfil agora há pouco (primeira carga ao entrar).
  App.reload = function (quiet, skipProfile) {
    if (!state.user) return Promise.resolve(false);
    var uid = state.user.id;
    if (!quiet) setStale(true);
    return Promise.all([D.loadAll(uid), skipProfile ? Promise.resolve({ ok: false }) : D.loadProfile(uid)]).then(function (res) {
      var r = res[0], pr = res[1];
      if (!state.user || state.user.id !== uid) return false; // a pessoa saiu enquanto carregava
      setStale(false);
      if (pr.ok && (!pr.profile || pr.profile.role === 'bloqueado')) { // perdeu o acesso com o app aberto
        state.data = null; state.idxFor = null; state.offline = false;
        d.closeAllSheets();
        afterProfile(pr.profile);
        return false;
      }
      if (pr.ok && pr.profile.role !== state.role) {
        state.profile = pr.profile; state.role = pr.profile.role;
        D.store.set(profileKey(uid), pr.profile);
        var tag = document.getElementById('papel');
        if (tag) tag.textContent = ROLE_TXT[state.role] || '';
      }
      if (!r.ok) {
        state.offline = !!state.data;
        state.loadError = state.data ? null : r.error;
        updateBanner();
        if (state.data) d.toast(r.error, 'erro'); else App.render(false);
        return false;
      }
      state.offline = false; state.loadError = null;
      state.data = r.data; state.lastLoad = Date.now(); state.savedAt = Date.now();
      updateBanner();
      App.render(true);
      return true;
    });
  };

  // ── entrada no app ─────────────────────────────────────────────────────
  function profileKey(uid) { return D.profileKey(uid); }

  function startApp(fromCache) {
    buildShell();
    var cache = D.readCache(state.user.id);
    if (cache) { state.data = cache.data; state.savedAt = cache.at; }
    if (fromCache) { state.offline = true; updateBanner(); App.render(false); return; }
    App.render(false);
    App.reload(!!cache, true); // o perfil acabou de ser conferido em App.enter
  }

  // opts.offline: sem internet (ou sem resposta): abre direto a cópia local, sem esperar a rede.
  App.enter = function (session, opts) {
    state.user = session.user;
    state.data = null; state.idxFor = null; state.loadError = null; state.offline = false;
    var root = App.root();
    d.clear(root);
    root.appendChild(h('div', { 'class': 'carregando', role: 'status', text: 'Entrando…' }));
    if (opts && opts.offline) {
      var p0 = D.store.get(profileKey(session.user.id), null), c0 = D.readCache(session.user.id);
      if (p0 && c0 && p0.role !== 'bloqueado') { state.profile = p0; state.role = p0.role; startApp(true); }
      else App.authView.failed(root, 'Sem conexão com a internet. Tente de novo.');
      return Promise.resolve();
    }
    return D.loadProfile(session.user.id).then(function (r) {
      if (!r.ok) {
        // sem internet: tenta abrir com a cópia local
        var p = D.store.get(profileKey(session.user.id), null), cache = D.readCache(session.user.id);
        if (p && cache && p.role !== 'bloqueado') { state.profile = p; state.role = p.role; return startApp(true); }
        return App.authView.failed(root, r.error);
      }
      var pending = D.store.get('orc.convite.pendente', null);
      if (!r.profile && pending && pending.code) {
        return D.redeem(pending.code, pending.name).then(function (rr) {
          D.store.del('orc.convite.pendente');
          return D.loadProfile(session.user.id).then(function (r2) { return afterProfile(r2.ok ? r2.profile : null, rr); });
        });
      }
      return afterProfile(r.profile);
    });
  };
  function afterProfile(profile, redeemResult) {
    var root = App.root();
    if (!profile) { wipeLocal(state.user.id); state.data = null; return App.authView.needInvite(root, redeemResult || null); }
    state.profile = profile; state.role = profile.role;
    if (profile.role === 'bloqueado') { wipeLocal(state.user.id); state.data = null; return App.authView.blocked(root); }
    D.store.set(profileKey(state.user.id), profile);
    startApp(false);
  }

  function resetView() { state.tab = 'mes'; state.month = F.currentMonth(); state.projStart = null; state.projCount = 12; }
  App.signOutNow = function () {
    var uid = state.user && state.user.id;
    return D.signOut().then(function () {
      wipeLocal(uid);
      state.user = null; state.profile = null; state.role = null; state.data = null; resetView();
      d.closeAllSheets();
      App.authView.login(App.root());
    });
  };

  // Abre o app: confere a sessão guardada e entra (ou mostra o login).
  App.resume = function () {
    return D.openSession().then(function (r) {
      if (r.session) return App.enter(r.session, { offline: r.offline });
      D.wipeAll();
      App.authView.login(App.root());
    });
  };

  App.boot = function () {
    App.setTheme(App.getTheme());
    var root = App.root();
    // Link do e-mail ("esqueci a senha"): o endereço chega com #...type=recovery. A biblioteca apaga isso da barra
    // assim que lê, por isso olhamos ANTES de criar o cliente.
    var hash = location.hash || '';
    var recovery = /(^|[#&])type=recovery(&|$)/.test(hash), linkError = /(^|[#&])error(_code|_description)?=/.test(hash);
    if (!D.init()) return App.authView.setup(root, D.problem());
    var recoveryShown = false;
    D.onAuth(function (event) {
      if (event === 'PASSWORD_RECOVERY') { recoveryShown = true; App.authView.newPassword(root); }
      else if (event === 'SIGNED_OUT' && state.user) { // sessão caiu (revogada, vencida ou saiu em outra aba)
        wipeLocal(state.user.id);
        state.user = null; state.profile = null; state.role = null; state.data = null; resetView(); d.closeAllSheets(); App.authView.login(root);
      }
    });
    if (recovery || linkError) {
      D.getSession().then(function (session) {
        // Com link de recuperação válido, o evento PASSWORD_RECOVERY chega logo depois e mostra a tela de senha nova.
        // Se não vier, o link não valeu: segue como uma abertura normal (ou volta ao login explicando).
        setTimeout(function () {
          if (recoveryShown) return;
          try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
          if (session) App.resume();
          else App.authView.login(root, 'O link do e-mail não vale mais (venceu ou já foi usado). Peça outro em "Esqueci a senha".');
        }, 1500);
      });
    } else App.resume();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.user && state.data && Date.now() - state.lastLoad > 30000 && !d.sheetsOpen()) App.reload(true);
    });
    window.addEventListener('online', function () { if (state.user && state.data) App.reload(true); });
  };
})(window.App = window.App || {});
