/* ════════════════════════════════════════════════════════════════════════
   format.js — formatação e leitura de dinheiro, meses e códigos (pt-BR).
   Sem dependências; roda no navegador e no Node (tests/).
   Não usa Intl de propósito: o resultado é igual em qualquer WebView.
   ════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Format = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NOMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function parts(m) {
    if (typeof m !== 'string' || !/^\d{4}-\d{2}/.test(m)) throw new Error('mês inválido: ' + m);
    return { y: parseInt(m.slice(0, 4), 10), m: parseInt(m.slice(5, 7), 10) };
  }
  function monthName(m) { return NOMES[parts(m).m - 1]; }              // "outubro"
  function monthAbbr(m) { return ABREV[parts(m).m - 1]; }              // "out"
  function monthShort(m) { var p = parts(m); return ABREV[p.m - 1] + '/' + p.y; }       // "out/2026"
  function monthLong(m) { var p = parts(m); return NOMES[p.m - 1] + ' de ' + p.y; }     // "outubro de 2026"
  function monthTick(m) { var p = parts(m); return ABREV[p.m - 1] + '/' + String(p.y).slice(2); } // "out/26"
  function currentMonth(now) { var d = now || new Date(); return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1); }

  // 123456 -> "1.234,56"
  function groupInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function plain(cents) {
    var neg = cents < 0, a = Math.abs(Math.round(cents));
    var whole = Math.floor(a / 100), frac = a % 100;
    return (neg ? '-' : '') + groupInt(whole) + ',' + (frac < 10 ? '0' : '') + frac;
  }
  // opts.sign: mostra "+" nos positivos; opts.bare: sem "R$ "
  function money(cents, opts) {
    opts = opts || {};
    if (cents == null || isNaN(cents)) return '—';
    var neg = cents < 0, a = Math.abs(Math.round(cents));
    var whole = Math.floor(a / 100), frac = a % 100;
    var body = groupInt(whole) + ',' + (frac < 10 ? '0' : '') + frac;
    var prefix = opts.bare ? '' : 'R$ ';
    var sign = neg ? '-' : (opts.sign && a > 0 ? '+' : '');
    return sign + prefix + body;
  }
  // Para eixos: 0, 500, 1 mil, 2,5 mil, 12 mil, 1,2 mi
  function compact(cents) {
    var v = Math.abs(cents) / 100, s = cents < 0 ? '-' : '';
    function trim(x) { var t = (Math.round(x * 10) / 10).toFixed(1); return t.replace(/\.0$/, '').replace('.', ','); }
    if (v >= 1000000) return s + trim(v / 1000000) + ' mi';
    if (v >= 10000) return s + Math.round(v / 1000) + ' mil';
    if (v >= 1000) return s + trim(v / 1000) + ' mil';
    return s + String(Math.round(v));
  }

  // "1.234,56" | "1234,56" | "1234.56" | "R$ 50" | "-50" | "(50)" -> centavos (ou NaN)
  function parseMoney(str) {
    if (typeof str === 'number') return isFinite(str) ? Math.round(str * 100) : NaN;
    var s = String(str == null ? '' : str).trim();
    if (s === '') return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/R\$/gi, '').replace(/[\s ]/g, '');
    if (s.charAt(0) === '-' || s.charAt(0) === '−') { neg = true; s = s.slice(1); }
    else if (s.charAt(0) === '+') s = s.slice(1);
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    var intPart, fracPart = '';
    if (lastComma >= 0) {                       // vírgula decimal; pontos são milhar
      intPart = s.slice(0, lastComma).replace(/\./g, '');
      fracPart = s.slice(lastComma + 1);
      if (/[.,]/.test(fracPart)) return NaN;
    } else if (lastDot >= 0) {
      var tail = s.slice(lastDot + 1);
      var dots = (s.match(/\./g) || []).length;
      if (dots === 1 && tail.length <= 2) { intPart = s.slice(0, lastDot); fracPart = tail; } // 13.87 = decimal
      else if (/^\d{1,3}(\.\d{3})+$/.test(s)) { intPart = s.replace(/\./g, ''); }          // 1.234 = milhar
      else return NaN;
    } else intPart = s;
    if (intPart === '') intPart = '0';
    if (!/^\d+$/.test(intPart) || (fracPart !== '' && !/^\d{1,2}$/.test(fracPart))) return NaN;
    if (intPart.length > 11) return NaN;
    var cents = parseInt(intPart, 10) * 100 + (fracPart === '' ? 0 : parseInt((fracPart + '0').slice(0, 2), 10));
    return neg ? -cents : cents;
  }

  // Código de convite
  function normalizeCode(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function prettyCode(s) { var c = normalizeCode(s); return c.length === 12 ? c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8) : c; }

  // Senha nova: pelo menos 10 caracteres e nada óbvio (o servidor também confere o tamanho).
  // Devolve o aviso em português, ou '' se a senha serve. Sem dependências, roda no Node.
  var SEQUENCIAS = ['01234567890123456789', '98765432109876543210', 'qwertyuiopasdfghjklzxcvbnm', 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'];
  var SO_PALAVRA = ['senha', 'senhas', 'minhasenha', 'password', 'passw0rd', 'qwerty', 'asdfgh', 'zxcvbn', 'abcdef', 'brasil', 'admin', 'administrador', 'orcamento', 'financeiro', 'teste', 'amor', 'familia', 'deus', 'iloveyou', 'letmein', 'welcome'];
  function passwordProblem(pw, email) {
    var s = String(pw == null ? '' : pw);
    if (s.length < 10) return 'A senha precisa de pelo menos 10 caracteres.';
    var low = s.toLowerCase(), seen = {}, distinct = 0;
    for (var i = 0; i < low.length; i++) if (!seen[low.charAt(i)]) { seen[low.charAt(i)] = 1; distinct++; }
    var letters = low.replace(/[^a-zà-ú]/g, '');
    var local = String(email || '').toLowerCase().split('@')[0];
    var weak = distinct < 5 || (letters !== '' && SO_PALAVRA.indexOf(letters) >= 0) || (local.length >= 4 && low.indexOf(local) >= 0);
    for (var k = 0; !weak && k < SEQUENCIAS.length; k++) if (SEQUENCIAS[k].indexOf(low) >= 0) weak = true;
    return weak ? 'Essa senha é fácil de adivinhar. Use algo menos óbvio: uma frase com 3 ou 4 palavras funciona bem.' : '';
  }

  // "Dia 7" etc.
  function dueText(day) { return day ? 'dia ' + day : ''; }

  // O Supabase manda horários com 6 casas de fração ("...:00.123456+00:00"); alguns navegadores
  // só aceitam 3. Cortamos o excesso antes de ler a data.
  function toDate(iso) { return new Date(String(iso == null ? '' : iso).replace(/(\.\d{3})\d+/, '$1')); }
  // Texto de data/hora curto: "14/10 às 20:09"
  function whenShort(iso) {
    var d = toDate(iso);
    if (isNaN(d)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' às ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function dateShort(iso) {
    var d = toDate(iso);
    if (isNaN(d)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  // Instante (em milissegundos) de um horário do Supabase; NaN se não der para ler.
  function toMs(iso) { return toDate(iso).getTime(); }
  // Há quanto tempo: "agora há pouco", "há 12 min", "há 5 h", "há 3 dias". nowMs = agora em milissegundos.
  // Horário no futuro (relógio do celular atrasado) conta como "agora há pouco". Horário ilegível: ''.
  function agoText(iso, nowMs) {
    var t = toMs(iso);
    if (isNaN(t)) return '';
    var s = Math.max(0, Math.floor(((nowMs == null ? Date.now() : nowMs) - t) / 1000));
    if (s < 60) return 'agora há pouco';
    var m = Math.floor(s / 60);
    if (m < 60) return 'há ' + m + ' min';
    var hh = Math.floor(m / 60);
    if (hh < 48) return 'há ' + hh + ' h';
    return 'há ' + Math.floor(hh / 24) + ' dias';
  }
  // Quanto falta esperar, sempre arredondado para CIMA (nunca diz "0 s"): 25 -> "25 s", 61 -> "2 min", 3700 -> "2 h"
  function waitText(sec) {
    var s = Math.max(1, Math.ceil(Number(sec) || 0));
    if (s < 60) return s + ' s';
    var m = Math.ceil(s / 60);
    if (m < 60) return m + ' min';
    return Math.ceil(m / 60) + ' h';
  }

  // ── relatórios: texto para compartilhar e planilha (CSV) ─────────────────
  // O relatório vem pronto do motor (Engine.monthReport / Engine.periodReport); aqui ele só vira texto. Sem Intl, sem rede.
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function stampOf(now) {
    var d = now instanceof Date && !isNaN(now) ? now : new Date();
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' às ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function reportTitle(rep) {
    return rep.kind === 'mes' ? 'Relatório de ' + monthLong(rep.month) : 'Relatório de ' + monthShort(rep.from) + ' a ' + monthShort(rep.to);
  }
  // Nome do arquivo (sem a extensão): relatorio-2026-10  ou  relatorio-2026-01-a-2026-12
  function reportFile(rep) {
    return rep.kind === 'mes' ? 'relatorio-' + rep.month : 'relatorio-' + rep.from + '-a-' + rep.to;
  }
  // Mesma legenda que a aba Mês põe embaixo do nome: "Cartão, Parcela 2 de 10, no CAIXA VISA"
  function lineMeta(l) {
    var parts = [];
    if (l.card) parts.push('Cartão');
    if (l.inst && l.inst.n > 1) parts.push('Parcela ' + l.inst.k + ' de ' + l.inst.n);
    if (l.cardName) parts.push('no ' + l.cardName);
    return parts.join(', ');
  }
  function lineState(l, kind) { return l.settled ? (kind === 'entrada' ? 'recebido' : 'pago') : (kind === 'entrada' ? 'a receber' : 'a pagar'); }
  // O que "dar baixa" já fez e o que falta (só depois da primeira marca, como na aba Mês). '' quando não há o que dizer.
  function baixaText(b, kind) {
    if (!b || !b.n || !b.feitas) return '';
    if (b.feitas === b.n) return kind === 'entrada' ? 'Tudo recebido.' : 'Tudo pago.';
    var faltam = b.n - b.feitas;
    return (kind === 'entrada' ? 'Já recebido: ' : 'Já pago: ') + money(b.feito) + ' (' + b.feitas + ' de ' + b.n + ') · ' +
      (kind === 'entrada' ? 'Falta receber: ' : 'Falta pagar: ') + money(b.falta) + ' (' + faltam + ')';
  }
  // A frase do saldo, igual à etiqueta da aba Mês
  function statusText(rep) {
    var s = rep.status, minTxt = money(rep.minCents);
    if (s === null) return rep.startMonth ? 'O saldo acumulado começa em ' + monthShort(rep.startMonth) : 'O saldo acumulado ainda não começou';
    return s === 'ok' ? 'Acima do mínimo de ' + minTxt : s === 'low' ? 'Abaixo do mínimo de ' + minTxt : 'Saldo negativo';
  }
  function liveNote(asOf) {
    return asOf == null || isNaN(asOf) ? '' : 'O saldo do fim do mês parte da leitura da 99Pay de ' + whenShort(new Date(asOf).toISOString()) +
      '. O que foi marcado como pago ou recebido depois dessa hora ainda conta como a pagar ou a receber.';
  }
  // Período que passa pelo mês do saldo lido da 99Pay: diz de onde vem o "Resultado" desse mês (é o mesmo da aba Projeção).
  function periodLiveNote(rep) {
    var lv = rep.rows.filter(function (r) { return r.live; })[0];
    return lv ? 'Em ' + monthShort(lv.month) + ' o saldo parte da leitura da 99Pay. Por isso o resultado desse mês é quanto o saldo muda (como na aba Projeção), e o resultado do período pode não ser entradas menos saídas.' : '';
  }

  function monthText(rep) {
    var L = [], c = rep.carry;
    L.push('RESUMO');
    if (c && c.cents != null) L.push('Veio de ' + monthName(c.prev) + (c.real ? ' (corrigido)' : '') + ': ' + money(c.cents));
    L.push('Entradas: ' + money(rep.totalEntradas));
    L.push('Saídas: ' + money(rep.totalSaidas));
    L.push('Resultado do mês: ' + money(rep.resultado, { sign: true }));
    L.push('Saldo no fim do mês: ' + (rep.saldo == null ? '—' : money(rep.saldo)));
    L.push('Situação: ' + statusText(rep));
    var ln = liveNote(rep.liveAsOf);
    if (ln) L.push(ln);
    [['saida', 'SAÍDAS', rep.saidas, rep.totalSaidas, rep.baixa.saidas, 'Nenhuma saída neste mês.'],
      ['entrada', 'ENTRADAS', rep.entradas, rep.totalEntradas, rep.baixa.entradas, 'Nenhuma entrada neste mês.']].forEach(function (s) {
      L.push('');
      L.push(s[1] + ' — ' + money(s[3]));
      if (!s[2].length) L.push(s[5]);
      s[2].forEach(function (l) {
        L.push((l.day ? 'dia ' + l.day + ' · ' : '') + l.name + ' — ' + money(l.cents) + ' (' + lineState(l, s[0]) + ')');
        var meta = lineMeta(l);
        if (meta) L.push('   ' + meta);
      });
      var bx = baixaText(s[4], s[0]);
      if (bx) L.push(bx);
    });
    return L;
  }
  function periodText(rep) {
    var L = [];
    L.push('RESUMO');
    L.push('Entradas no período: ' + money(rep.totalEntradas));
    L.push('Saídas no período: ' + money(rep.totalSaidas));
    L.push('Resultado do período: ' + money(rep.resultado, { sign: true }));
    if (rep.min === null) L.push('Saldo: o saldo acumulado começa em ' + (rep.startMonth ? monthShort(rep.startMonth) : 'um mês que ainda não foi definido') + '.');
    else {
      L.push('Menor saldo: ' + money(rep.min) + ' em ' + monthShort(rep.minMonth));
      L.push('Saldo no fim: ' + money(rep.last));
      L.push(rep.firstNeg ? 'Fica negativo a partir de ' + monthShort(rep.firstNeg) + '.'
        : rep.firstLow ? 'Fica abaixo do mínimo (' + money(rep.minCents) + ') a partir de ' + monthShort(rep.firstLow) + '.'
          : 'Sempre acima do mínimo de ' + money(rep.minCents) + '.');
    }
    L.push('');
    L.push('MÊS A MÊS');
    rep.rows.forEach(function (r) {
      var sit = r.status === 'neg' ? ' (negativo)' : r.status === 'low' ? ' (abaixo do mínimo)' : '';
      L.push(monthShort(r.month) + ' — saldo ' + (r.saldo == null ? 'não calculado' : money(r.saldo)) + sit);
      L.push('   entradas ' + money(r.entradas) + ' · saídas ' + money(r.saidas));
    });
    L.push('');
    L.push('Meses que ainda não chegaram são previsão: só contam o que repete todo mês ou o que já foi lançado.');
    var pn = periodLiveNote(rep);
    if (pn) L.push(pn);
    return L;
  }
  // O texto do relatório, pronto para compartilhar ou copiar (uma linha por item da lista)
  function reportText(rep, now) {
    var head = ['Orçamento — ' + reportTitle(rep).replace(/^R/, 'r'), 'Gerado em ' + stampOf(now), ''];
    return head.concat(rep.kind === 'mes' ? monthText(rep) : periodText(rep)).join('\n');
  }

  // CSV para abrir no Excel / Planilhas (versão em português: separador ";" e vírgula nos decimais).
  // Valor em número puro (sem R$ e sem ponto de milhar) para a planilha poder somar. Texto que começa com = + - @ ganha um
  // apóstrofo na frente: sem isso a planilha trataria o nome de um item como fórmula.
  function csvNum(c) {
    if (c == null || isNaN(c)) return '';
    var neg = c < 0, a = Math.abs(Math.round(c)), frac = a % 100;
    return (neg ? '-' : '') + Math.floor(a / 100) + ',' + (frac < 10 ? '0' : '') + frac;
  }
  function csvText(v) {
    var s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ');
    if (/^[=+\-@\t]/.test(s)) s = "'" + s;
    return /[;"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function reportCsv(rep, now) {
    var rows = [];
    function row(cells) { rows.push(cells.join(';')); }
    row([csvText('Orçamento'), csvText(reportTitle(rep))]);
    row([csvText('Gerado em'), csvText(stampOf(now))]);
    rows.push('');
    if (rep.kind === 'mes') {
      row(['Tipo', 'Dia', 'Item', 'Detalhe', 'Valor', 'Situação']);
      [['saida', 'Saída', rep.saidas], ['entrada', 'Entrada', rep.entradas]].forEach(function (s) {
        s[2].forEach(function (l) { row([csvText(s[1]), l.day == null ? '' : String(l.day), csvText(l.name), csvText(lineMeta(l)), csvNum(l.cents), csvText(lineState(l, s[0]))]); });
      });
      rows.push('');
      var c = rep.carry;
      if (c && c.cents != null) row([csvText('Resumo'), '', csvText('Veio de ' + monthName(c.prev) + (c.real ? ' (corrigido)' : '')), '', csvNum(c.cents), '']);
      row([csvText('Resumo'), '', csvText('Entradas'), '', csvNum(rep.totalEntradas), '']);
      row([csvText('Resumo'), '', csvText('Saídas'), '', csvNum(rep.totalSaidas), '']);
      row([csvText('Resumo'), '', csvText('Resultado do mês'), '', csvNum(rep.resultado), '']);
      row([csvText('Resumo'), '', csvText('Saldo no fim do mês'), '', csvNum(rep.saldo), csvText(statusText(rep))]);
      var ln = liveNote(rep.liveAsOf);
      if (ln) { rows.push(''); row([csvText('Observação'), '', csvText(ln), '', '', '']); }
    } else {
      row(['Mês', 'Entradas', 'Saídas', 'Resultado', 'Saldo', 'Situação']);
      rep.rows.forEach(function (r) {
        row([csvText(monthShort(r.month)), csvNum(r.entradas), csvNum(r.saidas), csvNum(r.resultado), csvNum(r.saldo),
          csvText(r.status === 'neg' ? 'negativo' : r.status === 'low' ? 'abaixo do mínimo' : r.status === 'ok' ? 'acima do mínimo' : 'antes do saldo inicial')]);
      });
      rows.push('');
      row([csvText('Total'), csvNum(rep.totalEntradas), csvNum(rep.totalSaidas), csvNum(rep.resultado), '', '']);
      var pn = periodLiveNote(rep);
      if (pn) { rows.push(''); row([csvText('Observação'), csvText(pn), '', '', '', '']); }
    }
    return rows.join('\r\n') + '\r\n';
  }

  return {
    monthName: monthName, monthAbbr: monthAbbr, monthShort: monthShort, monthLong: monthLong, monthTick: monthTick,
    currentMonth: currentMonth, money: money, plain: plain, compact: compact, parseMoney: parseMoney,
    normalizeCode: normalizeCode, prettyCode: prettyCode, passwordProblem: passwordProblem, dueText: dueText, whenShort: whenShort, dateShort: dateShort,
    toMs: toMs, agoText: agoText, waitText: waitText,
    stampOf: stampOf, reportTitle: reportTitle, reportFile: reportFile, reportText: reportText, reportCsv: reportCsv, reportLineMeta: lineMeta,
    reportLineState: lineState, reportBaixaText: baixaText, reportStatusText: statusText, reportLiveNote: liveNote, reportPeriodLiveNote: periodLiveNote
  };
});
