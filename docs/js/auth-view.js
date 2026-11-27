/* ════════════════════════════════════════════════════════════════════════
   auth-view.js — telas de entrada: configurar, entrar, criar conta com
   convite, esqueci a senha, código de convite, acesso bloqueado.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, D = App.data, h = d.h;

  function cover(root, kids) {
    // a verificação de segurança da tela anterior sai (a desta, se houver, está dentro de `kids`)
    if (tsCurrent && !(kids && kids.contains && kids.contains(tsCurrent.el))) tsCurrent.drop();
    d.clear(root);
    root.appendChild(h('main', { 'class': 'capa' }, h('h1', { text: 'Orçamento' }), h('div', { 'class': 'regua-dupla' }), kids));
    window.scrollTo(0, 0);
  }
  function emailInput(extra) {
    var a = { 'class': 'entrada', type: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', required: true };
    if (extra) for (var k in extra) a[k] = extra[k];
    return h('input', a);
  }
  function passInput(autocomplete, label) {
    return h('input', { 'class': 'entrada', type: 'password', autocomplete: autocomplete, 'aria-label': label || 'Senha', required: true });
  }
  function errBox() { return h('p', { 'class': 'erro-txt', role: 'alert', hidden: true }); }
  function say(box, msg) { box.textContent = msg || ''; box.hidden = !msg; }
  function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s); }
  // formulário com botão de envio que trava enquanto trabalha
  function form(onSubmit, kids, label) {
    var btn = h('button', { 'class': 'btn primario cheio', type: 'submit', text: label });
    var f = h('form', { novalidate: true, on: { submit: function (ev) {
      ev.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      Promise.resolve(onSubmit()).then(function (keepBusy) { if (!keepBusy) btn.disabled = false; }, function () { btn.disabled = false; });
    } } }, kids, h('div', { style: 'margin-top:6px' }, btn));
    return f;
  }
  function link(text, fn) { return h('button', { 'class': 'btn-texto', type: 'button', text: text, on: { click: fn } }); }

  // ── verificação de segurança (Cloudflare Turnstile) ────────────────────
  // Só entra em ação se o config.js tiver TURNSTILE_SITEKEY (a chave pública do widget); sem ela, nada muda. Quem EXIGE a
  // verificação é o Supabase (Authentication, Attack Protection): aqui o app só pega o código com o Cloudflare e o manda
  // junto com entrar, criar conta, "esqueci a senha" e "trocar senha". Cada código vale UMA vez (o widget se refaz depois de
  // cada tentativa). O app nunca fica preso: se o Cloudflare não responder, o pedido segue sem código e o Supabase decide.
  // A chave SECRETA do Cloudflare nunca passa por este app.
  var TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var TS_WAIT = 15000;                       // quanto esperar o código antes de seguir sem ele
  var tsScript = null, tsCurrent = null;
  function tsLoad() {
    if (window.turnstile && window.turnstile.render) return Promise.resolve(true);
    if (tsScript) return tsScript;
    tsScript = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = TS_SRC; s.async = true;
      s.onload = function () { resolve(!!(window.turnstile && window.turnstile.render)); };
      s.onerror = function () { tsScript = null; if (s.parentNode) s.parentNode.removeChild(s); resolve(false); };
      document.head.appendChild(s);
    });
    return tsScript;
  }
  // Devolve null se o app não usa a verificação. Senão { el, token(), reset(), drop() }.
  function captchaWidget() {
    var key = D.captchaKey();
    if (!key) {
      // O campo do config.js está preenchido com algo que NÃO é uma chave de site (talvez a chave SECRETA, colada por engano):
      // avisa em vermelho, nunca mostra o valor, e o login segue sem a verificação (o app não fica preso por isso).
      if (D.captchaProblem && D.captchaProblem()) {
        return {
          el: h('p', { 'class': 'erro-txt', role: 'alert', text: 'ATENÇÃO: o campo TURNSTILE_SITEKEY do config.js não tem uma chave pública do Cloudflare. Se você colou a chave SECRETA, apague-a do config.js agora (ele é público) e gere uma chave secreta nova no Cloudflare.' }),
          token: function () { return Promise.resolve(null); }, reset: function () {}, drop: function () {}
        };
      }
      return null;
    }
    if (tsCurrent) tsCurrent.drop();
    var host = h('div', { 'class': 'captcha' });
    var note = h('p', { 'class': 'ajuda captcha-nota', role: 'status', text: 'Verificação de segurança: preparando…' });
    var again = h('button', { 'class': 'btn-texto', type: 'button', hidden: true, text: 'Tentar a verificação de novo', on: { click: retry } });
    var el = h('div', { 'class': 'captcha-caixa' }, host, note, again);
    var wid = null, tok = null, bad = null, dead = false, waiting = [];
    function wake() { var w = waiting; waiting = []; w.forEach(function (fn) { fn(); }); }
    function say2(t, canRetry) { note.textContent = t; again.hidden = !canRetry; }
    function ready(n) {                       // o widget só pode ser desenhado depois que a tela está na página
      if (dead) return;
      if (document.body.contains(host)) return draw();
      if (n > 40) { bad = 'tela'; say2('Não consegui preparar a verificação de segurança.', true); return wake(); }
      setTimeout(function () { ready((n || 0) + 1); }, 50);
    }
    function draw() {
      tsLoad().then(function (ok) {
        if (dead) return;
        if (!ok) { bad = 'script'; say2('Não consegui abrir a verificação de segurança. Confira a internet ou feche e abra o app.', true); return wake(); }
        try {
          wid = window.turnstile.render(host, {
            sitekey: key, theme: 'auto', size: 'flexible', language: 'pt-br', appearance: 'interaction-only',
            retry: 'auto', 'refresh-expired': 'auto', 'response-field': false,
            callback: function (t) { tok = t; bad = null; say2('Verificação de segurança: ok.', false); wake(); },
            'error-callback': function (code) { tok = null; bad = String(code || 'erro'); say2('A verificação de segurança falhou (código ' + bad + ').', true); wake(); return true; },
            'expired-callback': function () { tok = null; say2('A verificação venceu. Refazendo…', false); },
            'timeout-callback': function () { tok = null; say2('A verificação demorou demais.', true); }
          });
        } catch (e) { bad = 'render'; say2('Não consegui preparar a verificação de segurança.', true); wake(); }
      });
    }
    function retry() {
      tok = null; bad = null; say2('Verificação de segurança: preparando…', false);
      if (wid !== null) { try { window.turnstile.reset(wid); } catch (e) {} } else draw();
    }
    var api = {
      el: el,
      // o código (ou null se não deu: o pedido segue sem ele e o Supabase decide)
      token: function () {
        if (tok) return Promise.resolve(tok);
        if (bad) return Promise.resolve(null);
        return new Promise(function (resolve) {
          var done = false, t;
          function fin() { if (done) return; done = true; clearTimeout(t); resolve(tok || null); }
          t = setTimeout(fin, TS_WAIT);
          waiting.push(fin);
        });
      },
      // o código já foi usado (certo ou errado): pede outro
      reset: function () { if (wid !== null) retry(); },
      drop: function () {
        dead = true;
        if (wid !== null) { try { window.turnstile.remove(wid); } catch (e) {} wid = null; }
        if (tsCurrent === api) tsCurrent = null;
      }
    };
    tsCurrent = api;
    ready(0);
    return api;
  }
  function tokenOf(cap) { return cap ? cap.token() : Promise.resolve(null); }

  // ── digital: tranco do app neste aparelho ──────────────────────────────
  // NÃO é um jeito de entrar sem conta: a pessoa continua logada neste aparelho (a sessão fica guardada) e a digital passa a
  // ser pedida ao abrir o app e ao voltar para ele depois de um tempo. A primeira entrada e a entrada depois de "Sair"
  // continuam sendo com e-mail e senha. O estado é só deste aparelho e só desta pessoa (orc.bio.<id>).
  // Quem pergunta "é você?":
  //   • app Android: o próprio Android (ponte OrcAndroid), com a digital ou, se ela falhar, o bloqueio de tela do celular;
  //   • navegador / app instalado pelo Chrome: o autenticador do aparelho, pela API WebAuthn, usado só como confirmação local.
  // O Orçamento nunca recebe a digital: só fica sabendo "confirmou" ou "não confirmou".
  var BIO_GRACE_MS = 30000;     // sair do app por menos que isso não pede a digital de novo
  var BIO_WAIT_MS = 120000;     // espera máxima pela resposta do aparelho
  var BIO_SUPPORT_MS = 5000;    // espera máxima por "este aparelho sabe pedir a digital?": sem resposta vale como 'erro' (o app não pode ficar parado)
  var bioPend = null, bioCover = null, bioHiddenAt = 0;
  var NATIVE = { 0: 'ok', 1: 'cancelado', 2: 'falhou', 3: 'sem_digital', 4: 'bloqueado' };
  var WHY = {
    'app-antigo': 'Esta versão do app Android ainda não tem a digital. Instale o app novo (peça o arquivo a quem administra).',
    antigo: 'Este celular tem Android antigo (abaixo do 11) e a digital do app não funciona nele.',
    sem_digital: 'Este aparelho não tem digital (nem bloqueio de tela) cadastrada. Cadastre nas configurações do celular e volte aqui.',
    sem_aparelho: 'Este aparelho não oferece a digital para apps.',
    indisponivel: 'O sensor do celular não respondeu agora. Tente de novo em instantes.',
    sem_suporte: 'Este navegador não consegue pedir a digital. No Chrome do celular costuma funcionar.',
    erro: 'Não consegui conferir a digital neste aparelho agora. Tente de novo mais tarde.'
  };
  var NOSAVE = 'Não consegui guardar esta escolha neste aparelho (o navegador não deixa guardar dados). A digital não foi ligada.';
  var ASK_TXT = {
    cancelado: 'Cancelado. A digital não foi ligada.',
    falhou: 'Não deu certo. Tente de novo.',
    sem_digital: WHY.sem_digital,
    bloqueado: 'O celular travou a digital por tentativas demais. Espere um pouco ou use o bloqueio de tela do celular.'
  };
  function bioKey(uid) { return 'orc.bio.' + uid; }
  function bioRec(uid) { var r = uid ? D.store.get(bioKey(uid), null) : null; return r && typeof r === 'object' ? r : null; }
  function bioSave(uid, rec) { return D.store.set(bioKey(uid), rec); }

  // — Android —
  function nativeBridge() { var o = window.OrcAndroid; return o && typeof o.bioAsk === 'function' && typeof o.bioStatus === 'function' ? o : null; }
  function askNative(mode) {
    if (bioPend) return bioPend.promise;
    var o = nativeBridge();
    if (!o) return Promise.resolve('sem_digital');
    var p = {};
    p.promise = new Promise(function (resolve) {
      p.resolve = resolve;
      p.timer = setTimeout(function () { if (bioPend === p) { bioPend = null; resolve('cancelado'); } }, BIO_WAIT_MS);
    });
    bioPend = p;
    try { o.bioAsk(mode); } catch (e) { bioPend = null; clearTimeout(p.timer); return Promise.resolve('falhou'); }
    return p.promise;
  }
  // O Android chama isto com o resultado (um número). Sem pergunta em andamento, é ignorado.
  function nativeDone(code) {
    var p = bioPend;
    if (!p) return;
    bioPend = null; clearTimeout(p.timer);
    p.resolve(NATIVE[code] || 'falhou');
  }

  // — navegador (WebAuthn) —
  function webOk() { return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get && window.crypto && window.crypto.getRandomValues); }
  function rnd(n) { var a = new Uint8Array(n); window.crypto.getRandomValues(a); return a; }
  function b64u(buf) { var b = new Uint8Array(buf), t = ''; for (var i = 0; i < b.length; i++) t += String.fromCharCode(b[i]); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(x) { var t = String(x).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; var r = atob(t), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  function webErr(e) { var n = e && e.name; return n === 'NotAllowedError' || n === 'AbortError' ? 'cancelado' : n === 'NotSupportedError' ? 'sem_digital' : 'falhou'; }
  function webCreate() {
    return navigator.credentials.create({ publicKey: {
      rp: { name: 'Orçamento' }, user: { id: rnd(16), name: 'orcamento', displayName: 'Orçamento' }, challenge: rnd(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none'
    } }).then(function (c) { return c && c.rawId ? { result: 'ok', cred: b64u(c.rawId) } : { result: 'falhou' }; }, function (e) { return { result: webErr(e) }; });
  }
  function webGet(cred) {
    var id;
    try { id = unb64u(cred); } catch (e) { return Promise.resolve('falhou'); }
    return navigator.credentials.get({ publicKey: {
      challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: id, transports: ['internal'] }], userVerification: 'required', timeout: 60000
    } }).then(function (a) {
      var ad = a && a.response && a.response.authenticatorData ? new Uint8Array(a.response.authenticatorData) : null;
      return ad && ad.length > 32 && (ad[32] & 4) ? 'ok' : 'falhou';        // o aviso "pessoa verificada" do aparelho tem que vir ligado
    }, webErr);
  }

  // Este aparelho consegue pedir a digital? { ok, kind: 'android' | 'web' } ou { ok: false, why }
  function bioSupport() {
    if (window.OrcAndroid) {                       // dentro do app Android
      var o = nativeBridge();
      if (!o) return Promise.resolve({ ok: false, why: 'app-antigo' });
      var st;
      try { st = String(o.bioStatus()); } catch (e) { st = 'erro'; }
      return Promise.resolve(st === 'pronta' ? { ok: true, kind: 'android' } : { ok: false, why: WHY[st] ? st : 'erro' });
    }
    if (!webOk() || typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return Promise.resolve({ ok: false, why: 'sem_suporte' });
    // O navegador pode demorar, falhar ou nunca responder. Sem resposta em BIO_SUPPORT_MS (ou com falha) vale 'erro': quem já
    // ligou a digital cai na tela de bloqueio (que tem a saída pela senha) e o app não fica parado em "Carregando…".
    return new Promise(function (resolve) {
      var fin = false, t = setTimeout(function () { end({ ok: false, why: 'erro' }); }, BIO_SUPPORT_MS);
      function end(v) { if (fin) return; fin = true; clearTimeout(t); resolve(v); }
      try {
        window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(function (yes) {
          end(yes ? { ok: true, kind: 'web' } : { ok: false, why: 'sem_digital' });
        }, function () { end({ ok: false, why: 'erro' }); });
      } catch (e) { end({ ok: false, why: 'erro' }); }
    });
  }
  // Pede a digital de quem já ligou. Resolve 'ok' | 'cancelado' | 'falhou' | 'sem_digital' | 'bloqueado'.
  function bioAsk(rec, mode) {
    if (rec.kind === 'android') return askNative(mode);
    if (!webOk() || !rec.cred) return Promise.resolve('sem_digital');
    return webGet(rec.cred);
  }

  // Liga a digital para esta pessoa neste aparelho. Resolve { ok: true } ou { ok: false, text, quiet } (quiet: foi só cancelar).
  function bioEnable(uid) {
    return bioSupport().then(function (sp) {
      if (!sp.ok) return { ok: false, text: WHY[sp.why] || WHY.erro };
      function bad(r) { return { ok: false, text: ASK_TXT[r] || ASK_TXT.falhou, quiet: r === 'cancelado' }; }
      // se o navegador não deixa guardar dados, a escolha se perderia: não diz "ligada" sem ter guardado
      function saved(rec) { return bioSave(uid, rec) ? { ok: true } : { ok: false, text: NOSAVE }; }
      if (sp.kind === 'android') {
        return askNative(2).then(function (r) {
          if (r !== 'ok') return bad(r);
          return saved({ on: true, kind: 'android' });
        });
      }
      return webCreate().then(function (c) {
        if (c.result !== 'ok') return bad(c.result);
        return saved({ on: true, kind: 'web', cred: c.cred });
      });
    });
  }
  function bioDisable(uid) { var r = bioRec(uid) || {}; bioSave(uid, { on: false, kind: r.kind, no: true }); }

  function bioShow(hide) { document.documentElement.classList[hide ? 'add' : 'remove']('trava-escondida'); }

  // A tela de bloqueio. Cobre o app inteiro (nada embaixo recebe toque nem leitor de tela) e abre sozinha a pergunta da
  // digital. Resolve true quando a pessoa confirma; false se ela escolher "Sair e usar a senha" (aí sai da conta neste aparelho).
  function lockScreen(uid) {
    return new Promise(function (resolve) {
      var rec = bioRec(uid) || {}, app = App.root(), busy = false, done = false, leaving = false;
      var err = errBox();
      var lead = h('p', { 'class': 'lead', text: 'Use a digital para abrir.' });
      var go = h('button', { 'class': 'btn primario cheio', type: 'button', text: 'Usar a digital', on: { click: ask } });
      var pw = link('Sair e usar a senha', usePassword);
      var box = h('div', { 'class': 'trava', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Orçamento bloqueado' },
        h('main', { 'class': 'capa' }, h('h1', { text: 'Orçamento' }), h('div', { 'class': 'regua-dupla' }),
          lead, go, err, h('div', { 'class': 'rodape' }, pw)));
      bioCover = box;
      bioShow(true);
      if (app) { app.setAttribute('aria-hidden', 'true'); app.setAttribute('inert', ''); }
      document.body.appendChild(box);
      try { go.focus(); } catch (e) {}
      setTimeout(ask, 250);                          // a pergunta do aparelho já abre sozinha

      function close() {
        done = true; bioCover = null; bioHiddenAt = 0;
        if (box.parentNode) box.parentNode.removeChild(box);
        if (app) { app.removeAttribute('aria-hidden'); app.removeAttribute('inert'); }
        bioShow(false);
      }
      function ask() {
        if (busy || done || leaving) return;
        busy = true; go.disabled = true; say(err, '');
        bioAsk(rec, 1).then(function (r) {
          busy = false; go.disabled = leaving;
          if (done || leaving) return;
          if (r === 'ok') { close(); resolve(true); return; }
          if (r === 'sem_digital' && rec.kind === 'android') {   // o celular não tem mais como perguntar: não deixa a pessoa trancada fora do próprio app
            bioSave(uid, { on: false, kind: rec.kind, no: false });
            close(); d.toast('A digital não está mais disponível neste celular. O bloqueio foi desligado.', 'erro'); resolve(true); return;
          }
          say(err, r === 'cancelado' ? 'Confirme com a digital para abrir.' : ASK_TXT[r] || ASK_TXT.falhou);
          try { go.focus(); } catch (e) {}
        });
      }
      // Sair da conta pode levar alguns segundos (internet lenta). A tela de bloqueio FICA até a saída terminar, e a trava só é
      // desligada depois: se o app fechar no meio, a trava continua ligada e a sessão guardada continua protegida.
      function usePassword() {
        if (done || leaving) return;
        leaving = true; go.disabled = true; pw.disabled = true; say(err, '');
        lead.textContent = 'Saindo da conta…';
        var out;
        try { out = App.state && App.state.user ? App.signOutNow() : D.signOut().then(function () { D.wipeAll(); App.authView.login(App.root()); }); }
        catch (e) { out = Promise.reject(e); }
        Promise.resolve(out).then(function () {
          bioSave(uid, { on: false, kind: rec.kind, no: false });   // a digital volta a ser oferecida depois da próxima entrada
          close(); resolve(false);
        }, function () {
          leaving = false; go.disabled = busy; pw.disabled = false; lead.textContent = 'Use a digital para abrir.';
          say(err, 'Não consegui sair agora. Tente de novo ou use a digital.');
        });
      }
    });
  }

  // Ao abrir o app: com a digital ligada para quem está logado, pede a digital ANTES de mostrar qualquer coisa do orçamento.
  // Resolve true (pode entrar) ou false (a pessoa escolheu a senha: já saiu e está na tela de entrar).
  function bioGate(uid) {
    var rec = bioRec(uid);
    if (!rec || !rec.on) return Promise.resolve(true);
    return bioSupport().then(function (sp) {
      if (!sp.ok && sp.why === 'indisponivel') {   // o sensor não respondeu agora (ocupado, reiniciando): abre só desta vez e a trava continua ligada
        d.toast('O sensor do celular não respondeu agora. O app abriu sem pedir a digital desta vez.', 'erro');
        return true;
      }
      if ((!sp.ok && sp.why !== 'erro') || (sp.ok && sp.kind !== rec.kind)) {   // o aparelho não tem mais como perguntar
        bioSave(uid, { on: false, kind: rec.kind, no: false });
        d.toast('A digital não está disponível neste aparelho agora. O bloqueio foi desligado.', 'erro');
        return true;
      }
      return lockScreen(uid);
    });
  }

  // Voltar para o app depois de um tempo pede a digital de novo. Ao sair, o conteúdo some na hora (antes de qualquer foto da tela).
  function bioWatch() {
    document.addEventListener('visibilitychange', function () {
      var st = App.state, uid = st && st.user && st.user.id, rec = bioRec(uid);
      if (!uid || !rec || !rec.on || bioCover) return;
      if (document.hidden) { bioHiddenAt = Date.now(); bioShow(true); return; }
      var away = bioHiddenAt ? Date.now() - bioHiddenAt : 0;
      bioHiddenAt = 0;
      if (away >= 0 && away < BIO_GRACE_MS) { bioShow(false); return; }   // relógio atrasado no meio do caminho (away < 0) não pula a trava
      d.closeAllSheets();
      lockScreen(uid);
    });
  }

  // Convite único, logo depois da primeira entrada num aparelho que sabe pedir a digital.
  function bioOffer() {
    var st = App.state, uid = st && st.user && st.user.id, rec = bioRec(uid);
    if (!uid || bioCover || d.sheetsOpen() || (rec && (rec.on || rec.no))) return;
    bioSupport().then(function (sp) {
      var now = App.state && App.state.user;
      if (!sp.ok || !now || now.id !== uid || bioCover || d.sheetsOpen()) return;
      var r2 = bioRec(uid);
      if (r2 && (r2.on || r2.no)) return;
      var err = errBox(), enabled = false, rec2;
      var yes = h('button', { 'class': 'btn primario', type: 'button', text: 'Ligar a digital', on: { click: function () {
        yes.disabled = true; say(err, '');
        bioEnable(uid).then(function (r) {
          yes.disabled = false;
          if (r.ok) { enabled = true; rec2.close(); d.toast('Digital ligada neste aparelho'); return; }
          if (!r.quiet) say(err, r.text);
        });
      } } });
      rec2 = d.openSheet({
        title: 'Entrar com a digital?', focus: 'none',
        body: h('div', null,
          h('p', { style: 'font-size:17px', text: 'Ao abrir o app, ele pede a sua digital em vez de ficar aberto para quem pegar o celular. Vale só neste aparelho, e a senha continua valendo.' }),
          h('p', { 'class': 'ajuda', text: 'Dá para desligar a qualquer hora em Conta, Segurança.' }), err),
        footer: [h('button', { 'class': 'btn', type: 'button', text: 'Agora não', on: { click: function () { rec2.close(); } } }), yes],
        onClose: function () { if (!enabled) { var cur = bioRec(uid); if (!cur || !cur.on) bioSave(uid, { on: false, kind: cur && cur.kind, no: true }); } }
      });
    });
  }

  // ── falta configurar o Supabase (ou o config.js está errado) ───────────
  // "problem" vem de App.data.problem(). Esta tela nunca mostra o valor da chave.
  function setup(root, problem) {
    var p = problem || 'modelo', alert = false, lead, steps;
    var end = 'Salve, suba para o GitHub e abra o app de novo.';
    if (p === 'url') {
      lead = 'O endereço do Supabase no config.js não está certo.';
      steps = [['Em ', h('code', { text: 'docs/config.js' }), ', SUPABASE_URL precisa ser só o endereço do projeto, assim: https://xxxxxxxx.supabase.co (sem barra no fim e sem nada depois).'],
        'Copie o valor de "Project URL" no Supabase e cole no lugar.', end];
    } else if (p === 'chave') {
      lead = 'A chave do config.js não é a chave pública do Supabase.';
      steps = [['Em ', h('code', { text: 'docs/config.js' }), ', SUPABASE_ANON_KEY precisa ser a chave pública (publishable), que começa com sb_publishable_.'],
        'No Supabase ela fica em Settings, API Keys. Confira se copiou inteira.', end];
    } else if (p === 'chave-secreta') {
      alert = true;
      lead = 'ATENÇÃO: o config.js tem uma chave SECRETA do Supabase. O app se recusa a usar.';
      steps = [['Abra ', h('code', { text: 'docs/config.js' }), ' no GitHub e apague essa chave agora. Ele é público: quem abrir o site consegue ver.'],
        'No Supabase (Settings, API Keys) apague ou troque essa chave secreta: trate a que ficou no GitHub como vazada.',
        'Cole no config.js só a chave pública (publishable), que começa com sb_publishable_.'];
    } else if (p === 'biblioteca') {
      lead = 'Faltou um arquivo do app (vendor/supabase.js).';
      steps = ['Suba de novo a pasta docs inteira para o GitHub, incluindo a pasta vendor.', 'Abra o app de novo.'];
    } else {
      lead = 'O app ainda não está ligado ao seu banco de dados.';
      steps = [['Abra o arquivo ', h('code', { text: 'docs/config.js' }), ' do projeto no GitHub.'],
        ['Cole a ', h('b', { text: 'URL do projeto' }), ' e a ', h('b', { text: 'chave pública' }), ' (começa com sb_publishable_) do Supabase.'], end];
    }
    cover(root, h('div', null,
      h('p', { 'class': alert ? 'lead erro-txt' : 'lead', role: alert ? 'alert' : null, text: lead }),
      h('ol', { 'class': 'passos' }, steps.map(function (s) { return h('li', null, s); })),
      h('p', { 'class': 'ajuda', text: 'O passo a passo completo está no LEIA-ME.md.' }),
      h('p', { style: 'margin-top:14px' }, h('button', { 'class': 'btn', type: 'button', text: 'Tentar de novo', on: { click: function () { location.reload(); } } }))));
  }

  // ── entrar ─────────────────────────────────────────────────────────────
  function login(root, note) {
    var email = emailInput(), pass = passInput('current-password'), err = errBox(), cap = captchaWidget();
    if (note) say(err, note);
    var f = form(function () {
      say(err, '');
      var em = email.value.trim().toLowerCase();
      if (!validEmail(em)) { say(err, 'Digite um e-mail válido.'); return; }
      if (!pass.value) { say(err, 'Digite a senha.'); return; }
      return tokenOf(cap).then(function (tk) { return D.signIn(em, pass.value, tk); }).then(function (r) {
        if (!r.ok) { if (cap) cap.reset(); say(err, r.error); return; }   // o código da verificação vale uma vez: pede outro
        if (cap) cap.drop();
        App.enter(r.session);
        return true;
      });
    }, [d.field('E-mail', email), d.field('Senha', pass), cap ? cap.el : null, err], 'Entrar');
    cover(root, h('div', null,
      h('p', { 'class': 'lead', text: 'Entre com seu e-mail e sua senha.' }), f,
      h('div', { 'class': 'rodape' }, link('Criar conta com convite', function () { signup(root); }), link('Esqueci a senha', function () { forgot(root, email.value); }))));
  }

  // ── criar conta (precisa de convite) ───────────────────────────────────
  function signup(root) {
    var nome = h('input', { 'class': 'entrada', type: 'text', autocomplete: 'name', maxlength: 60, required: true });
    var email = emailInput(), pass = passInput('new-password', 'Senha nova'), err = errBox(), cap = captchaWidget();
    var code = h('input', { 'class': 'entrada', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 20, placeholder: 'ABCD-EFGH-JKMN', style: 'letter-spacing:.08em;font-weight:600' });
    var f = form(function () {
      say(err, '');
      var nm = nome.value.trim(), em = email.value.trim().toLowerCase(), cd = F.normalizeCode(code.value);
      if (!nm) { say(err, 'Digite seu nome.'); return; }
      if (!validEmail(em)) { say(err, 'Digite um e-mail válido.'); return; }
      var weak = F.passwordProblem(pass.value, em);
      if (weak) { say(err, weak); return; }
      if (cd.length !== 12) { say(err, 'O código do convite tem 12 letras e números (ex.: ABCD-EFGH-JKMN).'); return; }
      D.store.set('orc.convite.pendente', { code: cd, name: nm });
      return tokenOf(cap).then(function (tk) { return D.signUp(em, pass.value, tk); }).then(function (r) {
        if (!r.ok) { if (cap) cap.reset(); D.store.del('orc.convite.pendente'); say(err, r.error); return; }
        if (cap) cap.drop();
        if (r.session) { App.enter(r.session); return true; }
        checkEmail(root, em);
        return true;
      });
    }, [d.field('Seu nome', nome), d.field('E-mail', email), d.field('Senha (10 ou mais caracteres)', pass, 'Uma frase com 3 ou 4 palavras é fácil de lembrar e difícil de adivinhar.'), d.field('Código do convite', code, 'Quem administra o app gera o código em Conta, Acessos.'), cap ? cap.el : null, err], 'Criar conta');
    cover(root, h('div', null,
      h('p', { 'class': 'lead', text: 'O acesso é só com convite.' }), f,
      h('div', { 'class': 'rodape' }, link('Já tenho conta', function () { login(root); }))));
  }

  function checkEmail(root, em) {
    cover(root, h('div', null,
      h('p', { 'class': 'lead', text: 'Falta confirmar o e-mail.' }),
      h('p', { style: 'font-size:17px;margin-bottom:16px', text: 'Enviamos um link para ' + em + '. Abra o link, volte aqui e entre com seu e-mail e sua senha. O convite que você digitou fica guardado e é usado no primeiro acesso.' }),
      h('button', { 'class': 'btn primario cheio', type: 'button', text: 'Ir para o login', on: { click: function () { login(root); } } })));
  }

  // ── esqueci a senha ────────────────────────────────────────────────────
  function forgot(root, preset) {
    var email = emailInput(), err = errBox(), cap = captchaWidget();
    if (preset) email.value = preset;
    var f = form(function () {
      say(err, '');
      var em = email.value.trim().toLowerCase();
      if (!validEmail(em)) { say(err, 'Digite um e-mail válido.'); return; }
      return tokenOf(cap).then(function (tk) { return D.resetPassword(em, tk); }).then(function (r) {
        if (!r.ok) { if (cap) cap.reset(); say(err, r.error); return; }
        if (cap) cap.drop();
        cover(root, h('div', null,
          h('p', { 'class': 'lead', text: 'Pronto. Se esse e-mail tiver conta, o link para criar uma senha nova já está a caminho.' }),
          h('p', { style: 'font-size:17px;margin-bottom:16px', text: 'Não chegou em alguns minutos? Olhe a caixa de spam. Se continuar sem chegar, peça para quem administra o app ajudar.' }),
          h('button', { 'class': 'btn primario cheio', type: 'button', text: 'Voltar ao login', on: { click: function () { login(root); } } })));
        return true;
      });
    }, [d.field('E-mail da sua conta', email), cap ? cap.el : null, err], 'Enviar link');
    cover(root, h('div', null, h('p', { 'class': 'lead', text: 'Vamos enviar um link para você criar uma senha nova.' }), f,
      h('div', { 'class': 'rodape' }, link('Voltar', function () { login(root); }))));
  }

  // ── senha nova (depois de clicar no link do e-mail) ────────────────────
  function newPassword(root) {
    var p1 = passInput('new-password', 'Senha nova'), p2 = passInput('new-password', 'Repita a senha nova'), err = errBox();
    var f = form(function () {
      say(err, '');
      var weak = F.passwordProblem(p1.value, '');
      if (weak) { say(err, weak); return; }
      if (p1.value !== p2.value) { say(err, 'As duas senhas não são iguais.'); return; }
      return D.updatePassword(p1.value).then(function (r) {
        if (!r.ok) { say(err, r.error); return; }
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        D.getSession().then(function (s) { if (s) App.enter(s); else login(root); });
        return true;
      });
    }, [d.field('Senha nova', p1), d.field('Repita a senha nova', p2), err], 'Salvar senha');
    cover(root, h('div', null, h('p', { 'class': 'lead', text: 'Crie sua senha nova.' }), f));
  }

  // ── conta criada, falta o convite ──────────────────────────────────────
  function needInvite(root, last) {
    var code = h('input', { 'class': 'entrada', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 20, placeholder: 'ABCD-EFGH-JKMN', style: 'letter-spacing:.08em;font-weight:600' });
    var err = errBox();
    if (last) {
      if (last.ok === false) say(err, last.error);
      else if (last.result === 'invalido') say(err, 'Esse código não vale: está errado, já foi usado ou venceu. Peça um novo a quem administra o app.');
      else if (last.result === 'muitas_tentativas') say(err, 'Muitas tentativas erradas. Tente de novo daqui a 1 hora.');
    }
    var f = form(function () {
      say(err, '');
      var cd = F.normalizeCode(code.value);
      if (cd.length !== 12) { say(err, 'O código do convite tem 12 letras e números (ex.: ABCD-EFGH-JKMN).'); return; }
      return D.redeem(cd, null).then(function (r) {
        if (!r.ok) { say(err, r.error); return; }
        if (r.result === 'invalido') { say(err, 'Esse código não vale: está errado, já foi usado ou venceu.'); return; }
        if (r.result === 'muitas_tentativas') { say(err, 'Muitas tentativas erradas. Tente de novo daqui a 1 hora.'); return; }
        D.getSession().then(function (s) { if (s) App.enter(s); else login(root); });
        return true;
      });
    }, [d.field('Código do convite', code), err], 'Usar o código');
    cover(root, h('div', null,
      h('p', { 'class': 'lead', text: 'Sua conta existe, mas ainda não tem acesso. Digite o código que o administrador enviou.' }), f,
      h('div', { 'class': 'rodape' }, link('Sair', function () { App.signOutNow(); }))));
  }

  function blocked(root) {
    cover(root, h('div', null,
      h('p', { 'class': 'lead', text: 'Seu acesso está bloqueado.' }),
      h('p', { style: 'font-size:17px;margin-bottom:16px', text: 'Fale com quem administra o app para liberar de novo.' }),
      h('button', { 'class': 'btn cheio', type: 'button', text: 'Sair', on: { click: function () { App.signOutNow(); } } })));
  }

  function failed(root, msg) {
    cover(root, h('div', null,
      h('p', { 'class': 'lead', text: msg || 'Não foi possível entrar agora.' }),
      h('div', { style: 'display:flex;gap:10px' },
        h('button', { 'class': 'btn primario', style: 'flex:1', type: 'button', text: 'Tentar de novo', on: { click: function () { App.resume(); } } }),
        h('button', { 'class': 'btn', style: 'flex:1', type: 'button', text: 'Sair', on: { click: function () { App.signOutNow(); } } }))));
  }

  App.authView = { setup: setup, login: login, signup: signup, forgot: forgot, newPassword: newPassword, needInvite: needInvite, blocked: blocked, failed: failed, checkEmail: checkEmail,
    captcha: captchaWidget, tokenOf: tokenOf };   // a verificação também é usada em "Trocar senha" (aba Conta)
  App.bio = {
    support: bioSupport, why: function (k) { return WHY[k] || WHY.erro; }, isOn: function (uid) { var r = bioRec(uid); return !!(r && r.on); },
    enable: bioEnable, disable: bioDisable, gate: bioGate, watch: bioWatch, offer: bioOffer, nativeDone: nativeDone
  };
})(window.App = window.App || {});
