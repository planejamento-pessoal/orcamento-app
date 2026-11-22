# Orçamento

App de celular para o orçamento da casa: contas fixas, cartões, parcelados e rendas mês a mês, saldo acumulado, projeção dos meses futuros e simulação de compras (sem gravar nada).

- **Login e senha**, banco no **Supabase** (e-mail + senha; cadastro só com código de convite).
- **Quem edita e quem só lê** é definido dentro do app (Conta → Acessos), sem abrir o Supabase. As regras valem no banco (RLS), não só na tela.
- **Atualização automática**: o app é um site (GitHub Pages) que confere versão nova toda vez que abre. Subir os arquivos no GitHub basta; ninguém reinstala nada.
- Funciona instalado pelo Chrome (PWA, caminho recomendado) ou como app Android (APK, opcional, com tela protegida).
- **Saldo da 99Pay (opcional, só leitura)**: um cartão no mês atual, só para o admin, mostra o saldo que o MeuPluggy informa. Não existe pagamento, Pix nem transferência. Precisa do `supabase/02_saldo99.sql`, da função `supabase/functions/saldo-99pay/` e de segredos que só o dono digita no Supabase; sem isso o app funciona igual, só sem o cartão. Passo a passo e limites: `supabase/functions/saldo-99pay/LEIA-ME.md`.
- **Saldo real no mês atual (1.5.0, opcional)**: com o `supabase/03_marcas_com_hora.sql` rodado e o item da 99Pay marcado como conta corrente ("Puxar a sobra do mês anterior"), o saldo lido vira o ponto de partida das contas do **mês atual** para o admin: *sobra prevista = saldo lido + o que falta receber − o que falta pagar*. Não precisa digitar o saldo da conta, e os juros que o banco soma todo dia já vêm dentro dele. O que foi marcado como pago/recebido **até a hora da leitura** já está no saldo lido e não é contado de novo; o que foi marcado **depois** segue como "a pagar/a receber" até a leitura seguinte (por isso a sobra não pula ao marcar). Os meses seguintes partem da sobra prevista, e a aba Projeção acompanha (no mês atual o "Resultado" mostra quanto o saldo muda e o balão do gráfico mostra o saldo lido, o que falta receber e o que falta pagar). Sem leitura boa deste mês, sem o `03` ou sem a conta corrente definida, as contas são exatamente as de antes (1.4.0). Quem não é admin continua vendo as contas de antes.

Este repositório é **público** (exigência do GitHub Pages gratuito). Por isso não tem nenhum dado pessoal: os valores ficam só no Supabase.

> O passo a passo completo (Supabase, GitHub, primeiro acesso, celular) está no `LEIA-ME.md` que acompanha o pacote, fora deste repositório.

## Pastas

| Pasta | Para quê |
|---|---|
| `docs/` | O app em si (HTML, CSS, JS, sem build). É o que o GitHub Pages publica (branch `main`, pasta `/docs`). |
| `docs/config.js` | **O único arquivo que liga o app ao seu Supabase** (Project URL e chave pública/publishable). |
| `supabase/01_schema.sql` | Tabelas, regras de acesso (RLS), convites e autoverificação. Roda uma vez no SQL Editor do Supabase; pode rodar de novo sem apagar dados. |
| `supabase/02_saldo99.sql` | Opcional (saldo da 99Pay, versão 1.4.0): diário das leituras e 2 funções do banco, só para o admin. Roda **depois** do `01`, uma vez; pode rodar de novo sem apagar leituras. |
| `supabase/03_marcas_com_hora.sql` | Opcional (saldo real, versão 1.5.0): acrescenta a coluna `settled_at` (hora, do servidor) nas marcas de pago/recebido. Não muda nenhuma marca nem valor existente. Roda **depois** do `01`, uma vez; pode rodar de novo. |
| `supabase/functions/saldo-99pay/` | Opcional: a Edge Function que lê o saldo no MeuPluggy/Pluggy (só leitura, 3 chamadas de uma lista fechada) e o `LEIA-ME.md` com o passo a passo. Os segredos dela (chaves da Pluggy) ficam só no Supabase. |
| `android/` | A "casca" Android (WebView) que abre o app. Só precisa de novo APK se mexer aqui. |
| `tests/` | Testes automáticos: cálculos, formatos, travas de segurança, do `config.js`, dos ícones e dos recursos do Android. |
| `tools/` | `sync-launcher.js`: recalcula os hashes da política de segurança do `docs/index.html` e copia o arquivo para dentro do APK. |
| `.github/workflows/` | `tests.yml` roda os testes a cada envio; `android.yml` gera o APK (aba Actions → "Gerar APK"). `dependabot.yml` mantém as ações fixadas em dia. |

## Segurança, em resumo

- **Banco**: RLS em todas as tabelas; `anon` e `service_role` sem permissão nenhuma nas tabelas e funções (isso barra o acesso direto às tabelas, mas **não** a API de usuários do Supabase: chave secreta vazada = gire a chave na hora); papéis admin / editor / leitor / bloqueado lidos do banco a cada pedido; funções `SECURITY DEFINER` com `search_path` vazio e liberadas só para usuários logados; convites de uso único com limite de tentativas (vale sob concorrência) que somem junto com o admin que os criou; trocas de papel em fila (nunca fica sem admin); valores e datas absurdos recusados; o `01_schema.sql` se autoverifica (tabelas, colunas, funções, regras, sequências) e cancela tudo se algo ficar aberto. Funções novas no schema `public` precisam de `revoke execute ... from public, anon` logo depois de criadas.
- **Saldo da 99Pay (opcional)**: quem decide se uma leitura pode acontecer é o banco (só admin, com limites: 1 por hora ao abrir o app, 30 s entre leituras manuais, 12 por dia), e só depois disso a função chama a Pluggy, com 3 chamadas de leitura de uma lista fechada. A função não usa a chave `service_role`; ela repassa o login de quem está no app. As chaves da Pluggy ficam só nos segredos da função; o app não as vê e não guarda nada da 99Pay no aparelho. O banco guarda só saldo, hora do dado, situação da conexão e um código de erro. Desde a 1.5.0 o saldo lido também alimenta as contas do mês atual, mas só na memória do app do admin: ele nunca vai para a cópia guardada no aparelho (testes travam isso).
- **Senha**: mínimo de 10 caracteres, recusa as óbvias; trocar a senha exige a senha atual e encerra os outros aparelhos.
- **App**: política de segurança de conteúdo (CSP) com hashes, `connect-src` restrito ao Supabase do projeto, anti-moldura, sem `Referer`, recusa chave secreta e URL que não seja `https://xxxx.supabase.co`.
- **APK**: `FLAG_SECURE`, links e rede restritos ao app e ao Supabase, sem backup, só a permissão de internet.
- **GitHub**: workflows com permissões mínimas, ações fixadas por hash, checksums do Gradle, varredura de segredos nos testes.

## Atualizar o app

1. Mexa nos arquivos de `docs/` e envie ao GitHub (`git add . && git commit -m "..." && git push`).
2. Em até uns 10 minutos o GitHub Pages publica. Os celulares pegam a versão nova na próxima vez que abrirem o app (aparece a faixa "Tem uma versão nova do app", ou Conta → Sobre → Atualizar agora).
3. **Nunca sobrescreva `docs/config.js`** com a versão de outro lugar: ele guarda a ligação com o seu Supabase.
4. Se mudar `docs/index.html`, rode `node tools/sync-launcher.js` antes de enviar (recalcula os hashes da CSP e mantém a cópia de emergência do APK igual). Os testes `tests/launcher.test.js` e `tests/seguranca.test.js` avisam se esquecer.
5. Arquivo novo em `docs/js/` precisa entrar na lista `FILES` do `docs/index.html` (e aí rode o passo 4).
6. Versão que mexe no banco (a 1.2.0 acrescentou as marcas de pago/recebido; a 1.3.0, a lista de compras e a conta corrente): rode `supabase/01_schema.sql` de novo no SQL Editor do Supabase. É seguro repetir (não apaga nada). Sem isso o app funciona, só sem a chavinha de pago/recebido, sem a aba Compras e sem a conta corrente.
7. Não mude a lista de arquivos (`FILES`) do `docs/index.html` sem necessidade: o APK já instalado leva uma cópia dele, e se a lista crescer o APK antigo não abre a cópia da versão nova sem internet até ser reinstalado. Código novo vai dentro de arquivos que já estão na lista (a aba Compras mora em `js/sim-view.js`); o `tests/launcher.test.js` trava a lista.
8. A 1.4.0 (saldo da 99Pay) é **opcional** e tem 3 partes além do app: `supabase/02_saldo99.sql` (SQL Editor, depois do `01`), a função `saldo-99pay` e os segredos dela (só você digita, no Supabase). Envie o app por **último**. Sem o `02` o app funciona igual, só sem o cartão; sem a função ou sem os segredos o cartão aparece com um aviso em português. A ordem, os avisos e o que foi (e não foi) testado estão em `supabase/functions/saldo-99pay/LEIA-ME.md`. Os cabeçalhos do `02_saldo99.sql` e da função `index.ts` dizem que o valor "não entra em nenhuma conta": isso vale para a função e para o banco (eles só leem e guardam); a partir da 1.5.0 é o **app** que usa o valor no mês atual (item 9).
9. A 1.5.0 (saldo real no mês atual) também é **opcional**. Ordem: (a) rode `supabase/03_marcas_com_hora.sql` no SQL Editor (só acrescenta uma coluna; as marcas antigas ficam sem hora e o app as trata como "já está no saldo"); (b) no app, abra o item da 99Pay (Mais opções) e ligue "Puxar a sobra do mês anterior" (a partir daí, nos meses depois do mês inicial, o valor desse item deixa de ser uma entrada comum e passa a ser a sobra do mês anterior, ou o saldo real que você digitou; confira se os números dos meses passados continuam batendo); (c) envie o app por **último**. Voltar atrás: reenvie os arquivos da 1.4.0; a coluna nova não atrapalha a versão antiga e não precisa ser desfeita. Limites: marcar como pago continua sendo manual (a Pluggy não entrega as movimentações), e uma marca esquecida deixa a sobra prevista menor do que a real.

## Testes

```
node --test tests/*.test.js
```

Roda no Node 18 ou mais novo e não tem dependências. Os testes da função `saldo-99pay` (que é TypeScript) só rodam de verdade no Node 22.18 ou mais novo: em versões mais velhas, o arquivo `tests/saldo99-funcao.test.js` mostra a maioria deles como "pulados" (skipped) e o resto passa igual. O GitHub usa o Node 22 e roda o mesmo comando a cada envio (aba Actions → "Testes"), e o APK só é compilado se os testes passarem.

## O que é público e o que não é

- Público de propósito: o código, a URL do projeto Supabase e a chave `anon`/publishable. Quem protege os dados são as regras do banco (RLS em `01_schema.sql`): sem convite, a conta criada não enxerga nada.
- **Nunca** colocar neste repositório: a chave `service_role` / secret do Supabase, a senha do banco, o arquivo `.jks` (chave de assinatura do APK) e suas senhas, o seed com os valores da planilha, tokens do GitHub, as chaves da Pluggy (Client ID, Client Secret, API key) e o Item ID do MeuPluggy (eles ficam só nos segredos da função, no Supabase). O `.gitignore` bloqueia `.jks`, `*.keystore`, `*.apk` e `PRIVADO*`; os testes falham se encontrarem chave secreta.
- Se uma chave secreta chegar a ser publicada: gire-a no Supabase (Project Settings → API Keys); apagar o arquivo no GitHub não basta, porque o histórico do Git guarda a antiga.

## Dica de endereço

Em conta pessoal do GitHub, todos os sites do dono dividem o mesmo endereço (`dono.github.io`) e, portanto, o mesmo armazenamento do navegador. Hospedar este app em uma **organização** gratuita separa a origem dos seus outros sites. O endereço do APK é montado sozinho a partir do dono e do nome do repositório (ou de `ORC_START_URL`).
