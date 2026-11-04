/* ════════════════════════════════════════════════════════════════════════
   account-view.js — a aba "Conta": seus dados, configurações do orçamento,
   aparência e (para admin) pessoas e convites.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, E = window.Engine, D = App.data, h = d.h;
  var ROLE_HELP = {
    admin: 'Pode tudo: lança e altera o orçamento e gerencia quem tem acesso.',
    editor: 'Pode lançar e alterar o orçamento.',
    leitor: 'Só consulta: não consegue alterar nada.'
  };
  var ROLE_OPTS = [{ v: 'admin', t: 'Admin' }, { v: 'editor', t: 'Editor' }, { v: 'leitor', t: 'Só leitura' }, { v: 'bloqueado', t: 'Bloqueado' }];

  function sectionHead(title) { return h('div', { 'class': 'secao' }, h('h2', { text: title })); }

  function render(main) {
    var st = App.state, p = st.profile || {}, user = st.user || {};
    // ── sua conta ────────────────────────────────────────────────────────
    main.appendChild(sectionHead('Sua conta'));
    main.appendChild(h('div', { 'class': 'bloco', style: 'padding-top:12px' },
      h('p', { style: 'font-size:20px;font-weight:600', text: p.name || user.email || '' }),
      h('p', { 'class': 'ajuda', text: p.email || user.email || '' }),
      h('p', { style: 'margin:10px 0 4px' }, h('span', { 'class': 'selo ok', text: App.ROLE_TXT[st.role] || st.role })),
      h('p', { 'class': 'ajuda', text: ROLE_HELP[st.role] || '' }),
      h('div', { style: 'display:flex;gap:10px;margin-top:14px;flex-wrap:wrap' },
        h('button', { 'class': 'btn', type: 'button', text: 'Trocar senha', on: { click: openPassword } }),
        h('button', { 'class': 'btn', type: 'button', text: 'Sair', on: { click: function () { App.signOutNow(); } } }))));

    // ── orçamento ────────────────────────────────────────────────────────
    if (st.data) main.appendChild(settingsBlock(st.data.settings));

    // ── aparência ────────────────────────────────────────────────────────
    main.appendChild(sectionHead('Aparência'));
    var tema = d.segmented([{ v: 'auto', t: 'Automático' }, { v: 'claro', t: 'Claro' }, { v: 'escuro', t: 'Escuro' }], App.getTheme(), function (v) { App.setTheme(v); }, 'Tema');
    main.appendChild(h('div', { 'class': 'bloco', style: 'padding-top:14px' }, tema.el));

    // ── acessos (admin) ──────────────────────────────────────────────────
    if (App.isAdmin()) {
      var box = h('div', { id: 'acessos' }, h('p', { 'class': 'vazio', text: 'Carregando acessos…' }));
      main.appendChild(sectionHead('Acessos'));
      main.appendChild(box);
      loadAccess(box);
    }

    // ── sobre ────────────────────────────────────────────────────────────
    main.appendChild(sectionHead('Sobre'));
    main.appendChild(h('div', { 'class': 'bloco', style: 'padding-top:12px' },
      h('p', { text: 'Orçamento, versão ' + App.version }),
      h('p', { 'class': 'ajuda', text: 'O app confere se há versão nova toda vez que abre.' }),
      h('button', { 'class': 'btn', type: 'button', style: 'margin-top:10px', text: 'Atualizar agora', on: { click: function () { location.replace(location.pathname + '?r=' + Date.now()); } } })));
  }

  // ── configurações do orçamento ─────────────────────────────────────────
  function settingsBlock(s) {
    var can = App.can();
    var min = d.moneyInput(E.cents(s.min_balance), { 'aria-label': 'Saldo mínimo' });
    var open = d.moneyInput(E.cents(s.opening_balance), { 'aria-label': 'Saldo no início' });
    var start = App.sheets.monthField('O saldo acumulado começa em', E.normMonth(s.balance_start_month), { fallback: F.currentMonth() });
    var err = h('p', { 'class': 'erro-txt', role: 'alert', hidden: true });
    var save = h('button', { 'class': 'btn primario', type: 'button', text: 'Salvar', on: { click: onSave } });
    function onSave() {
      err.hidden = true;
      var m = F.parseMoney(min.value.trim() === '' ? '0' : min.value), o = F.parseMoney(open.value.trim() === '' ? '0' : open.value);
      if (isNaN(m) || m < 0) { err.textContent = 'O saldo mínimo precisa ser um valor de zero para cima.'; err.hidden = false; return; }
      if (isNaN(o)) { err.textContent = 'Digite o saldo do início assim: 1.234,56'; err.hidden = false; return; }
      save.disabled = true;
      D.saveSettings({ min_balance: m / 100, opening_balance: o / 100, balance_start_month: E.toDbDate(start.get()) }).then(function (r) {
        save.disabled = false;
        if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
        App.reload(true).then(function () { d.toast('Configurações salvas'); });
      });
    }
    var body = h('div', { 'class': 'bloco', style: 'padding-top:14px' },
      d.field('Saldo mínimo', min, 'Abaixo disso o app avisa em amarelo; abaixo de zero, em vermelho.'),
      start.el,
      d.field('Saldo no início desse mês (antes dos lançamentos)', open),
      err, can ? save : h('p', { 'class': 'ajuda', text: 'Só admin e editor alteram estes valores.' }));
    if (!can) { min.disabled = true; open.disabled = true; start.el.querySelector('button').disabled = true; }
    return h('section', null, sectionHead('Orçamento'), body);
  }

  // ── trocar a própria senha ─────────────────────────────────────────────
  function openPassword() {
    var email = (App.state.user && App.state.user.email) || (App.state.profile && App.state.profile.email) || '';
    var cur = h('input', { 'class': 'entrada', type: 'password', autocomplete: 'current-password' });
    var p1 = h('input', { 'class': 'entrada', type: 'password', autocomplete: 'new-password' });
    var p2 = h('input', { 'class': 'entrada', type: 'password', autocomplete: 'new-password' });
    var err = h('p', { 'class': 'erro-txt', role: 'alert', hidden: true });
    function say(msg) { err.textContent = msg; err.hidden = false; }
    var ok = h('button', { 'class': 'btn primario', type: 'button', text: 'Salvar senha', on: { click: function () {
      err.hidden = true;
      if (!cur.value) return say('Digite a senha atual.');
      var weak = F.passwordProblem(p1.value, email);
      if (weak) return say(weak);
      if (p1.value === cur.value) return say('A nova senha precisa ser diferente da atual.');
      if (p1.value !== p2.value) return say('As duas senhas não são iguais.');
      ok.disabled = true;
      D.changePassword(email, cur.value, p1.value).then(function (r) {
        ok.disabled = false;
        if (!r.ok) return say(r.error);
        rec.close(); d.toast('Senha trocada');
      });
    } } });
    var rec = d.openSheet({ title: 'Trocar senha', body: h('div', null, d.field('Senha atual', cur), d.field('Senha nova (10 ou mais caracteres)', p1), d.field('Repita a senha nova', p2), err), footer: [h('button', { 'class': 'btn', type: 'button', text: 'Cancelar', on: { click: function () { rec.close(); } } }), ok] });
  }

  // ── acessos: pessoas e convites ────────────────────────────────────────
  function loadAccess(box) {
    Promise.all([D.listProfiles(), D.listInvites()]).then(function (res) {
      d.clear(box);
      if (!res[0].ok) { box.appendChild(h('p', { 'class': 'vazio', text: res[0].error })); return; }
      var people = res[0].rows, invites = res[1].ok ? res[1].rows : [];
      var nameOf = {}; people.forEach(function (x) { nameOf[x.id] = x.name || x.email; });

      var lista = h('div');
      people.forEach(function (x) {
        var self = x.id === App.state.user.id;
        var sel = h('select', { 'aria-label': 'Acesso de ' + (x.name || x.email), disabled: self, 'class': 'sel-papel' });
        ROLE_OPTS.forEach(function (o) { sel.appendChild(h('option', { value: o.v, text: o.t })); });
        sel.value = x.role;
        sel.addEventListener('change', function () {
          var novo = sel.value, antigo = x.role;
          function revert() { sel.value = antigo; }
          function go() {
            sel.disabled = true;
            D.setRole(x.id, novo).then(function (r) {
              sel.disabled = false;
              if (!r.ok) { revert(); return d.toast(r.error, 'erro'); }
              x.role = novo; d.toast((x.name || x.email) + ': ' + App.ROLE_TXT[novo]);
              // quem deixa de ser admin perde os convites que ainda não foram usados (o banco apaga): atualiza a lista
              if (novo !== 'admin' && invites.some(function (c) { return c.created_by === x.id && !c.used_at; })) loadAccess(box);
            });
          }
          if (novo === 'bloqueado') d.confirmBox({ title: 'Bloquear ' + (x.name || x.email) + '?', text: 'A pessoa deixa de ver qualquer dado. Dá para liberar de novo depois.', ok: 'Bloquear', danger: true }).then(function (yes) { if (yes) go(); else revert(); });
          else go();
        });
        lista.appendChild(h('div', { 'class': 'pessoa' },
          h('div', null, h('span', { 'class': 'nome', text: (x.name || x.email) + (self ? ' (você)' : '') }), h('span', { 'class': 'meta', text: x.email + ', desde ' + F.dateShort(x.created_at) })),
          sel));
      });

      var inv = h('div');
      var shown = 0;
      invites.forEach(function (c) {
        if (shown >= 15) return; shown++;
        var used = !!c.used_at, expired = !used && new Date(c.expires_at) <= new Date();
        var status = used ? h('span', { 'class': 'selo', text: 'usado por ' + (nameOf[c.used_by] || 'alguém') + ' em ' + F.dateShort(c.used_at) })
          : expired ? h('span', { 'class': 'selo perigo', text: 'venceu em ' + F.dateShort(c.expires_at) })
            : h('span', { 'class': 'selo ok', text: 'vale até ' + F.dateShort(c.expires_at) });
        inv.appendChild(h('div', { 'class': 'pessoa' },
          h('div', null, h('span', { 'class': 'nome num', text: F.prettyCode(c.code) }), h('span', { 'class': 'meta' }, App.ROLE_TXT[c.role] + (c.note ? ', ' + c.note : '') + ' '), status),
          !used && !expired ? h('div', { style: 'display:flex' },
            h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Compartilhar convite', on: { click: function () { shareInvite(c.code, c.expires_at); } } }, d.icon('share')),
            h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Apagar convite', on: { click: function () {
              D.revokeInvite(c.code).then(function (r) { if (!r.ok) return d.toast(r.error, 'erro'); loadAccess(box); });
            } } }, d.icon('trash'))) : null));
      });

      box.appendChild(h('p', { 'class': 'sub-titulo', text: 'Pessoas' }));
      box.appendChild(lista);
      box.appendChild(h('p', { 'class': 'sub-titulo', text: 'Convites' }));
      box.appendChild(invites.length ? inv : h('p', { 'class': 'vazio', text: 'Nenhum convite ainda.' }));
      box.appendChild(h('div', { 'class': 'bloco', style: 'padding-top:12px' },
        h('button', { 'class': 'btn primario', type: 'button', text: 'Novo convite', on: { click: function () { openInvite(function () { loadAccess(box); }); } } })));
    });
  }

  function inviteText(code, expires) {
    return 'Convite para o app Orçamento.\nCódigo: ' + F.prettyCode(code) + '\nVale até ' + F.dateShort(expires) + ' e só pode ser usado uma vez.\nAbra o app, toque em "Criar conta com convite" e digite o código.' +
      (/^https:/.test(location.href) ? '\n' + location.origin + location.pathname : '');
  }
  function shareInvite(code, expires) {
    d.shareText(inviteText(code, expires), 'Convite do Orçamento').then(function (r) {
      if (r === 'copied') d.toast('Convite copiado. Cole na conversa.');
      else if (r === 'fail') d.toast('Não consegui copiar. Anote o código.', 'erro');
    });
  }

  function openInvite(after) {
    var papel = d.segmented([{ v: 'leitor', t: 'Só leitura' }, { v: 'editor', t: 'Editor' }, { v: 'admin', t: 'Admin' }], 'leitor', function () { help(); }, 'Acesso do convite');
    var dias = h('select', { 'class': 'entrada' });
    [1, 3, 7, 15, 30].forEach(function (n) { dias.appendChild(h('option', { value: String(n), text: n === 1 ? '1 dia' : n + ' dias' })); });
    dias.value = '7';
    var nota = h('input', { 'class': 'entrada', type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Ex.: Maria' });
    var ajuda = h('div', { 'class': 'ajuda' });
    var err = h('p', { 'class': 'erro-txt', role: 'alert', hidden: true });
    function help() { ajuda.textContent = ROLE_HELP[papel.get()]; }
    help();
    var go = h('button', { 'class': 'btn primario', type: 'button', text: 'Gerar código', on: { click: function () {
      err.hidden = true; go.disabled = true;
      D.createInvite(papel.get(), parseInt(dias.value, 10), nota.value.trim()).then(function (r) {
        go.disabled = false;
        if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
        rec.close();
        showCode(r.code, new Date(Date.now() + parseInt(dias.value, 10) * 86400000).toISOString());
        if (after) after();
      });
    } } });
    var rec = d.openSheet({
      title: 'Novo convite', body: h('div', null, h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'Que acesso a pessoa vai ter?' }), papel.el, ajuda), d.field('O código vale por', dias, 'Prazo para a pessoa usar o código. Depois que ela entra, o acesso dela não vence.'), d.field('Lembrete (opcional)', nota), err),
      footer: [h('button', { 'class': 'btn', type: 'button', text: 'Cancelar', on: { click: function () { rec.close(); } } }), go], focus: 'none'
    });
  }
  function showCode(code, expires) {
    var rec = d.openSheet({
      title: 'Convite criado', focus: 'none',
      body: h('div', null,
        h('p', { text: 'Mande este código para a pessoa. Ele serve uma vez e vale até ' + F.dateShort(expires) + '.' }),
        h('div', { 'class': 'codigo-grande', 'aria-label': 'Código ' + F.prettyCode(code).split('').join(' '), text: F.prettyCode(code) })),
      footer: [
        h('button', { 'class': 'btn', type: 'button', text: 'Copiar código', on: { click: function () { d.copyText(F.prettyCode(code)).then(function (ok) { d.toast(ok ? 'Código copiado' : 'Não consegui copiar', ok ? null : 'erro'); }); } } }),
        h('button', { 'class': 'btn primario', type: 'button', text: 'Compartilhar', on: { click: function () { shareInvite(code, expires); } } })]
    });
  }

  App.views.conta = { render: render };
})(window.App = window.App || {});
