/* ════════════════════════════════════════════════════════════════════════
   auth-view.js — telas de entrada: configurar, entrar, criar conta com
   convite, esqueci a senha, código de convite, acesso bloqueado.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, D = App.data, h = d.h;

  function cover(root, kids) {
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
    var email = emailInput(), pass = passInput('current-password'), err = errBox();
    if (note) say(err, note);
    var f = form(function () {
      say(err, '');
      var em = email.value.trim().toLowerCase();
      if (!validEmail(em)) { say(err, 'Digite um e-mail válido.'); return; }
      if (!pass.value) { say(err, 'Digite a senha.'); return; }
      return D.signIn(em, pass.value).then(function (r) {
        if (!r.ok) { say(err, r.error); return; }
        App.enter(r.session);
        return true;
      });
    }, [d.field('E-mail', email), d.field('Senha', pass), err], 'Entrar');
    cover(root, h('div', null,
      h('p', { 'class': 'lead', text: 'Entre com seu e-mail e sua senha.' }), f,
      h('div', { 'class': 'rodape' }, link('Criar conta com convite', function () { signup(root); }), link('Esqueci a senha', function () { forgot(root, email.value); }))));
  }

  // ── criar conta (precisa de convite) ───────────────────────────────────
  function signup(root) {
    var nome = h('input', { 'class': 'entrada', type: 'text', autocomplete: 'name', maxlength: 60, required: true });
    var email = emailInput(), pass = passInput('new-password', 'Senha nova'), err = errBox();
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
      return D.signUp(em, pass.value).then(function (r) {
        if (!r.ok) { D.store.del('orc.convite.pendente'); say(err, r.error); return; }
        if (r.session) { App.enter(r.session); return true; }
        checkEmail(root, em);
        return true;
      });
    }, [d.field('Seu nome', nome), d.field('E-mail', email), d.field('Senha (10 ou mais caracteres)', pass, 'Uma frase com 3 ou 4 palavras é fácil de lembrar e difícil de adivinhar.'), d.field('Código do convite', code, 'Quem administra o app gera o código em Conta, Acessos.'), err], 'Criar conta');
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
    var email = emailInput(), err = errBox();
    if (preset) email.value = preset;
    var f = form(function () {
      say(err, '');
      var em = email.value.trim().toLowerCase();
      if (!validEmail(em)) { say(err, 'Digite um e-mail válido.'); return; }
      return D.resetPassword(em).then(function (r) {
        if (!r.ok) { say(err, r.error); return; }
        cover(root, h('div', null,
          h('p', { 'class': 'lead', text: 'Pronto. Se esse e-mail tiver conta, o link para criar uma senha nova já está a caminho.' }),
          h('p', { style: 'font-size:17px;margin-bottom:16px', text: 'Não chegou em alguns minutos? Olhe a caixa de spam. Se continuar sem chegar, peça para quem administra o app ajudar.' }),
          h('button', { 'class': 'btn primario cheio', type: 'button', text: 'Voltar ao login', on: { click: function () { login(root); } } })));
        return true;
      });
    }, [d.field('E-mail da sua conta', email), err], 'Enviar link');
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

  App.authView = { setup: setup, login: login, signup: signup, forgot: forgot, newPassword: newPassword, needInvite: needInvite, blocked: blocked, failed: failed, checkEmail: checkEmail };
})(window.App = window.App || {});
