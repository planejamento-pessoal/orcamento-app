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

    // ── relatórios ───────────────────────────────────────────────────────
    if (st.data) { main.appendChild(sectionHead('Relatórios')); main.appendChild(reportBlock()); }

    // ── orçamento ────────────────────────────────────────────────────────
    if (st.data) main.appendChild(settingsBlock(st.data.settings));

    // ── aparência ────────────────────────────────────────────────────────
    main.appendChild(sectionHead('Aparência'));
    var tema = d.segmented([{ v: 'auto', t: 'Automático' }, { v: 'claro', t: 'Claro' }, { v: 'escuro', t: 'Escuro' }], App.getTheme(), function (v) { App.setTheme(v); }, 'Tema');
    main.appendChild(h('div', { 'class': 'bloco', style: 'padding-top:14px' }, tema.el));

    // ── segurança neste aparelho ─────────────────────────────────────────
    main.appendChild(sectionHead('Segurança'));
    main.appendChild(bioBlock());

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

  // ── relatórios ─────────────────────────────────────────────────────────
  // Aqui na aba Conta a pessoa escolhe o que quer; o relatório pronto abre num painel. As contas vêm do motor
  // (Engine.monthReport / periodReport): as mesmas das abas Mês e Projeção, sem nenhum número calculado por esta tela.
  // Dá para ler na tela, copiar e compartilhar. No navegador (celular ou computador) também dá para baixar a planilha (CSV) e
  // imprimir / salvar em PDF. No app do Android o painel só tem copiar e compartilhar: a WebView dele não baixa arquivo nem imprime.
  // Quem só consulta (leitor) também gera: o relatório mostra só o que a pessoa já enxerga nas outras abas.
  var REPORT_RANGES = [{ v: 6, t: '6 meses' }, { v: 12, t: '12 meses' }, { v: 24, t: '2 anos' }];
  var SHARE_LIMIT = 4800;           // o botão de compartilhar do app Android recusa texto com mais de 5000 caracteres (ficaria calado)
  function inApk() { return !!(window.OrcAndroid && typeof window.OrcAndroid.share === 'function'); }
  function pickerBtn(text, label, onClick) {
    return h('button', { 'class': 'btn cheio', type: 'button', 'aria-label': label, on: { click: onClick } }, d.icon('calendar', 'p'), text);
  }

  function reportBlock() {
    var cur = F.currentMonth();
    var cfg = { type: 'mes', month: E.normMonth(App.state.month || cur), from: cur, count: 12 };
    var area = h('div');
    var kind = d.segmented([{ v: 'mes', t: 'De um mês' }, { v: 'periodo', t: 'De vários meses' }], cfg.type, function (v) { cfg.type = v; draw(); }, 'Tipo de relatório');
    function draw() {
      d.clear(area);
      if (cfg.type === 'mes') {
        area.appendChild(h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'Mês' }),
          pickerBtn(F.monthLong(cfg.month), F.monthLong(cfg.month) + ', escolher outro mês', function () {
            d.pickMonth({ value: cfg.month, title: 'Relatório de qual mês?' }).then(function (m) { if (m) { cfg.month = m; draw(); } });
          })));
      } else {
        var rg = d.segmented(REPORT_RANGES, cfg.count, function (v) { cfg.count = v; }, 'Quantos meses');
        area.appendChild(h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'Quantos meses' }), rg.el));
        area.appendChild(h('div', { 'class': 'campo' }, h('span', { 'class': 'rot', text: 'Começa em' }),
          pickerBtn(F.monthShort(cfg.from), 'Começa em ' + F.monthLong(cfg.from) + ', escolher outro mês', function () {
            d.pickMonth({ value: cfg.from, title: 'Começar em' }).then(function (m) { if (m) { cfg.from = m; draw(); } });
          })));
      }
    }
    draw();
    var go = h('button', { 'class': 'btn primario cheio', type: 'button', text: 'Gerar relatório', on: { click: function () {
      var data = App.state.data;
      if (!data) return d.toast('Os dados ainda não carregaram. Toque em atualizar e tente de novo.', 'erro');
      var rep;
      try { rep = cfg.type === 'mes' ? E.monthReport(App.index(), data.settings, cfg.month) : E.periodReport(App.index(), data.settings, cfg.from, cfg.count); }
      catch (e) { if (window.console) console.error(e); return d.toast('Não consegui montar o relatório. Toque em atualizar e tente de novo.', 'erro'); }
      openReport(rep);
    } } });
    return h('div', { 'class': 'bloco', style: 'padding-top:14px' }, kind.el, area, go,
      h('p', { 'class': 'ajuda', text: 'Abre o relatório na tela, para ler, copiar ou compartilhar. Os números são os mesmos das abas Mês e Projeção.' }));
  }

  function moneyLine(label, cents, cls, extra) {
    return h('div', { 'class': 'ex-linha' + (extra ? ' ' + extra : '') }, h('span', { text: label }), h('span', { 'class': 'v' + (cls ? ' ' + cls : ''), text: F.money(cents, extra === 'ex-res' ? { sign: true } : null) }));
  }
  function statusChip(rep) {
    var t = F.reportStatusText(rep);
    if (rep.status === null) return h('span', { 'class': 'estado nulo' }, d.icon('calendar', 'p'), t);
    return h('span', { 'class': 'estado ' + rep.status }, d.statusIcon(rep.status), t);
  }

  function reportList(kind, lines, total, baixa, emptyText) {
    var ul = h('ul', { 'class': 'rel-lista' });
    lines.forEach(function (l) {
      var meta = F.reportLineMeta(l);
      ul.appendChild(h('li', null,
        h('span', { 'class': 'rel-dia' }, l.day ? [h('span', { 'class': 'sr', text: 'vence dia ' }), String(l.day)] : null),
        h('span', { 'class': 'rel-nome' }, h('span', { text: l.name }), meta ? h('span', { 'class': 'rel-meta', text: meta }) : null),
        h('span', { 'class': 'rel-val' + (l.real ? ' real' : '') }, h('span', { 'class': 'sr', text: 'R$ ' }), F.money(l.cents, { bare: true }),
          h('span', { 'class': 'rel-est' + (l.settled ? ' ok' : ''), text: F.reportLineState(l, kind) }))));
    });
    var bx = F.reportBaixaText(baixa, kind);
    return h('section', { 'aria-label': kind === 'entrada' ? 'Entradas' : 'Saídas' },
      h('div', { 'class': 'rel-titulo' }, h('h3', { text: kind === 'entrada' ? 'Entradas' : 'Saídas' }), h('span', { 'class': 'total', text: F.money(total) })),
      lines.length ? ul : h('p', { 'class': 'vazio', text: emptyText }),
      bx ? h('p', { 'class': 'ajuda', text: bx }) : null);
  }

  function monthBody(rep) {
    var c = rep.carry, saldoCls = rep.status === 'neg' ? 'neg-txt' : rep.status === 'low' ? 'low-txt' : '', ln = F.reportLiveNote(rep.liveAsOf);
    return h('div', null,
      h('section', { 'class': 'rel-resumo', 'aria-label': 'Resumo de ' + F.monthLong(rep.month) },
        c && c.cents != null ? moneyLine('Veio de ' + F.monthName(c.prev) + (c.real ? ' (corrigido)' : ''), c.cents, c.cents < 0 ? 'neg-txt' : '', 'ex-veio') : null,
        moneyLine('Entradas', rep.totalEntradas), moneyLine('Saídas', rep.totalSaidas),
        moneyLine('Resultado do mês', rep.resultado, rep.resultado < 0 ? 'neg-txt' : '', 'ex-res'),
        h('div', { 'class': 'ex-saldo' }, h('span', { 'class': 'rot', text: 'Saldo no fim do mês' }), h('span', { 'class': 'v ' + saldoCls, text: rep.saldo == null ? '—' : F.money(rep.saldo) })),
        statusChip(rep),
        ln ? h('p', { 'class': 'ajuda', text: ln }) : null),
      reportList('saida', rep.saidas, rep.totalSaidas, rep.baixa.saidas, 'Nenhuma saída neste mês.'),
      reportList('entrada', rep.entradas, rep.totalEntradas, rep.baixa.entradas, 'Nenhuma entrada neste mês.'),
      // mesma legenda da aba Mês para o valor em negrito azul
      rep.saidas.concat(rep.entradas).some(function (l) { return l.real; }) ? h('p', { 'class': 'ajuda', text: 'Azul em negrito: valor que você lançou. Normal: valor que repete todo mês.' }) : null);
  }

  function periodBody(rep) {
    var tbody = h('tbody');
    rep.rows.forEach(function (r) {
      var cls = { ok: 'ic-ok', low: 'ic-low', neg: 'ic-neg' };
      tbody.appendChild(h('tr', null,
        h('th', { scope: 'row', text: F.monthShort(r.month) }),
        h('td', { text: F.money(r.entradas, { bare: true }) }),
        h('td', { text: F.money(r.saidas, { bare: true }) }),
        h('td', { 'class': r.status === 'neg' ? 'neg-txt' : r.status === 'low' ? 'low-txt' : '' },
          r.status ? h('span', { 'class': cls[r.status], style: 'display:inline-flex;vertical-align:middle;margin-right:3px' }, d.statusIcon(r.status)) : null,
          r.saldo == null ? '—' : F.money(r.saldo, { bare: true }),
          r.status ? h('span', { 'class': 'sr', text: ', ' + d.STATUS_TXT[r.status] }) : null)));
    });
    var frase;
    if (rep.min === null) frase = 'O saldo acumulado começa em ' + (rep.startMonth ? F.monthShort(rep.startMonth) : 'um mês que ainda não foi definido') + '. Escolha um período a partir dele para ver o saldo.';
    else frase = rep.firstNeg ? 'Fica negativo a partir de ' + F.monthShort(rep.firstNeg) + '.' : rep.firstLow ? 'Fica abaixo do mínimo (' + F.money(rep.minCents) + ') a partir de ' + F.monthShort(rep.firstLow) + '.' : 'Sempre acima do mínimo de ' + F.money(rep.minCents) + '.';
    var pn = F.reportPeriodLiveNote(rep);
    return h('div', null,
      h('section', { 'class': 'rel-resumo', 'aria-label': 'Resumo do período' },
        moneyLine('Entradas no período', rep.totalEntradas), moneyLine('Saídas no período', rep.totalSaidas),
        moneyLine('Resultado do período', rep.resultado, rep.resultado < 0 ? 'neg-txt' : '', 'ex-res'),
        rep.min === null ? null : moneyLine('Menor saldo (' + F.monthShort(rep.minMonth) + ')', rep.min, rep.min < 0 ? 'neg-txt' : ''),
        h('p', { 'class': 'rel-frase' + (rep.firstNeg ? ' neg-txt' : rep.firstLow ? ' low-txt' : ''), text: frase })),
      h('table', { 'class': 'rel-tabela' },
        h('caption', { text: 'Mês a mês' }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Mês' }), h('th', { scope: 'col', text: 'Entradas' }), h('th', { scope: 'col', text: 'Saídas' }), h('th', { scope: 'col', text: 'Saldo' }))),
        tbody),
      h('p', { 'class': 'ajuda', text: 'Valores em R$. Meses que ainda não chegaram são previsão: só contam o que repete todo mês ou o que já foi lançado.' }),
      pn ? h('p', { 'class': 'ajuda', text: pn }) : null);
  }

  function downloadCsv(rep, now) {
    var name = F.reportFile(rep) + '.csv';
    try {
      var url = URL.createObjectURL(new Blob(['\ufeff' + F.reportCsv(rep, now)], { type: 'text/csv;charset=utf-8' }));
      var a = h('a', { href: url, download: name, style: 'display:none' });
      document.body.appendChild(a); a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 2000);
      d.toast('Planilha gerada: ' + name);
    } catch (e) { d.toast('Não consegui criar a planilha neste aparelho.', 'erro'); }
  }
  // Impressão: a classe só existe enquanto o relatório está aberto e serve ao CSS de impressão (esconde o app e deixa só o relatório)
  var PRINT_CLS = 'imprime-rel';
  function printReport() {
    var root = document.documentElement;
    function done() { root.classList.remove(PRINT_CLS); window.removeEventListener('afterprint', done); }
    root.classList.add(PRINT_CLS);
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (e) { done(); d.toast('Não consegui abrir a impressão neste aparelho.', 'erro'); }
  }

  function openReport(rep) {
    var now = new Date(), text = F.reportText(rep, now), title = F.reportTitle(rep);
    var body = h('div', { 'class': 'relatorio' }, rep.kind === 'mes' ? monthBody(rep) : periodBody(rep));
    if (!inApk()) {
      body.appendChild(h('div', { 'class': 'rel-extras' },
        h('button', { 'class': 'btn p', type: 'button', text: 'Baixar planilha (CSV)', on: { click: function () { downloadCsv(rep, now); } } }),
        h('button', { 'class': 'btn p', type: 'button', text: 'Imprimir ou salvar em PDF', on: { click: printReport } })));
    }
    function onCopy() { d.copyText(text).then(function (ok) { d.toast(ok ? 'Relatório copiado. Cole na conversa.' : 'Não consegui copiar.', ok ? null : 'erro'); }); }
    function onShare() {
      if (inApk() && text.length > SHARE_LIMIT) {
        d.copyText(text).then(function (ok) { d.toast(ok ? 'Relatório grande demais para o compartilhar: copiei o texto. Cole na conversa.' : 'Relatório grande demais para compartilhar. Escolha menos meses.', ok ? null : 'erro'); });
        return;
      }
      d.shareText(text, title).then(function (r) {
        if (r === 'copied') d.toast('Relatório copiado. Cole na conversa.');
        else if (r === 'fail') d.toast('Não consegui compartilhar. Use o botão Copiar.', 'erro');
      });
    }
    d.openSheet({
      title: title, sub: 'Gerado em ' + F.stampOf(now), body: body, focus: 'none',
      onClose: function () { document.documentElement.classList.remove(PRINT_CLS); },
      footer: [h('button', { 'class': 'btn', type: 'button', text: 'Copiar', on: { click: onCopy } }), h('button', { 'class': 'btn primario', type: 'button', text: 'Compartilhar', on: { click: onShare } })]
    });
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

  // ── digital (vale só para este aparelho e só para esta pessoa) ─────────
  var BIO_HELP = 'Ao abrir o app (e ao voltar para ele depois de alguns instantes), ele pede a sua digital. Vale só neste aparelho. A senha continua valendo, e é ela que entra de novo depois de "Sair".';
  function bioBlock() {
    var uid = App.state.user && App.state.user.id;
    var help = h('p', { 'class': 'ajuda', text: 'Conferindo se este aparelho tem digital…' });
    var row = d.chaveRow('Entrar com a digital', App.bio.isOn(uid), onToggle);
    var sw = row.el.querySelector('button');
    sw.disabled = true;
    App.bio.support().then(function (sp) {
      if (sp.ok) { sw.disabled = false; help.textContent = BIO_HELP; return; }
      sw.disabled = !App.bio.isOn(uid);       // sem digital neste aparelho: só dá para desligar o que já estava ligado
      help.textContent = App.bio.why(sp.why);
    });
    function onToggle(on) {
      sw.disabled = true;
      if (!on) { App.bio.disable(uid); sw.disabled = false; d.toast('Digital desligada neste aparelho'); return; }
      App.bio.enable(uid).then(function (r) {
        sw.disabled = false;
        if (r.ok) return d.toast('Digital ligada neste aparelho');
        row.set(false);
        if (!r.quiet) d.toast(r.text, 'erro');
      });
    }
    return h('div', { 'class': 'bloco', style: 'padding-top:8px' }, row.el, help);
  }

  // ── trocar a própria senha ─────────────────────────────────────────────
  function openPassword() {
    var email = (App.state.user && App.state.user.email) || (App.state.profile && App.state.profile.email) || '';
    var cur = h('input', { 'class': 'entrada', type: 'password', autocomplete: 'current-password' });
    var p1 = h('input', { 'class': 'entrada', type: 'password', autocomplete: 'new-password' });
    var p2 = h('input', { 'class': 'entrada', type: 'password', autocomplete: 'new-password' });
    var err = h('p', { 'class': 'erro-txt', role: 'alert', hidden: true });
    // verificação de segurança (Cloudflare): só existe se o app estiver configurado para ela; trocar a senha confere a senha
    // atual entrando de novo, e o Supabase pode exigir a verificação nessa entrada
    var cap = App.authView && App.authView.captcha ? App.authView.captcha() : null;
    function say(msg) { err.textContent = msg; err.hidden = false; }
    var ok = h('button', { 'class': 'btn primario', type: 'button', text: 'Salvar senha', on: { click: function () {
      err.hidden = true;
      if (!cur.value) return say('Digite a senha atual.');
      var weak = F.passwordProblem(p1.value, email);
      if (weak) return say(weak);
      if (p1.value === cur.value) return say('A nova senha precisa ser diferente da atual.');
      if (p1.value !== p2.value) return say('As duas senhas não são iguais.');
      ok.disabled = true;
      App.authView.tokenOf(cap).then(function (tk) { return D.changePassword(email, cur.value, p1.value, tk); }).then(function (r) {
        ok.disabled = false;
        if (!r.ok) { if (cap) cap.reset(); return say(r.error); }
        rec.close(); d.toast('Senha trocada');
      });
    } } });
    var rec = d.openSheet({ title: 'Trocar senha', onClose: function () { if (cap) cap.drop(); },
      body: h('div', null, d.field('Senha atual', cur), d.field('Senha nova (10 ou mais caracteres)', p1), d.field('Repita a senha nova', p2), cap ? cap.el : null, err),
      footer: [h('button', { 'class': 'btn', type: 'button', text: 'Cancelar', on: { click: function () { rec.close(); } } }), ok] });
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
        // compartilhar só faz sentido enquanto o código vale; apagar vale para qualquer convite (ativo, vencido ou usado)
        inv.appendChild(h('div', { 'class': 'pessoa' },
          h('div', null, h('span', { 'class': 'nome num', text: F.prettyCode(c.code) }), h('span', { 'class': 'meta' }, App.ROLE_TXT[c.role] + (c.note ? ', ' + c.note : '') + ' '), status),
          h('div', { style: 'display:flex' },
            !used && !expired ? h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Compartilhar convite', on: { click: function () { shareInvite(c.code, c.expires_at); } } }, d.icon('share')) : null,
            h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Apagar convite', on: { click: function () { dropInvite(c, nameOf[c.used_by] || 'alguém', box); } } }, d.icon('trash')))));
      });

      box.appendChild(h('p', { 'class': 'sub-titulo', text: 'Pessoas' }));
      box.appendChild(lista);
      box.appendChild(h('p', { 'class': 'sub-titulo', text: 'Convites' }));
      box.appendChild(invites.length ? inv : h('p', { 'class': 'vazio', text: 'Nenhum convite ainda.' }));
      box.appendChild(h('div', { 'class': 'bloco', style: 'padding-top:12px' },
        h('button', { 'class': 'btn primario', type: 'button', text: 'Novo convite', on: { click: function () { openInvite(function () { loadAccess(box); }); } } })));
    });
  }

  // Apagar convite. O que ainda não foi usado some na hora (como sempre foi). O já usado pede confirmação: some o registro
  // de quem entrou com ele, mas a pessoa continua com o acesso (o acesso fica na conta dela, não no convite).
  function dropInvite(c, who, box) {
    var used = !!c.used_at;
    function go() {
      D.deleteInvite(c.code, used).then(function (r) {
        if (!r.ok) return d.toast(r.error, 'erro');
        d.toast('Convite apagado');
        loadAccess(box);
      });
    }
    if (!used) return go();
    d.confirmBox({ title: 'Apagar este convite?', text: 'Ele foi usado por ' + who + '. A pessoa continua com acesso ao app; só some o registro do convite.', ok: 'Apagar', danger: true }).then(function (yes) { if (yes) go(); });
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
