# Saldo da 99Pay no app Orçamento (somente leitura) — LEIA-ME

As mensagens do app que dizem "veja o LEIA-ME" falando do saldo da 99Pay se referem a este guia.

**Situação em 16/11/2026:** o código está pronto e foi testado no meu ambiente de teste (simulado). **O banco (passo 1) e a função `saldo-99pay` (passo 2) já estão aplicados no Supabase "orcamento"**, por mim, com a sua autorização de 15/11 às 20:54. **Faltam duas coisas, as duas suas:** os segredos (passo 3, só você digita) e subir o app 1.4.0 no GitHub (passo 4: eu não tenho acesso ao seu GitHub, então os arquivos vão num pacote e você sobe, só depois do passo 3). Até lá o app que está no ar continua na versão 1.3.0 e não mostra o cartão. Esta função ainda não falou com a Pluggy (sem os segredos ela não consegue). **Ainda ninguém viu esta leitura funcionar de verdade**: a primeira leitura real vai ser o primeiro teste de verdade (item 9 explica o que falta provar).

---

## 1. O que o app passa a ter (versão 1.4.0)

Um cartão **"Saldo na 99Pay"** no mês atual, **só para o admin** (você). Editor, leitor e bloqueado não veem nada.

- Mostra o último saldo lido, a hora a que o dado se refere ("Dado de 15/11 às 12:11 (há 3 h)") e a hora em que o app leu.
- **Ao abrir o app**, lê sozinho, no máximo 1 vez por hora. Se leu há menos de 1 hora, mostra na hora o último valor guardado e não lê de novo.
- **Ler agora**: lê na hora (mínimo de 30 segundos entre uma leitura e outra).
- **Abrir MeuPluggy**: abre o MeuPluggy fora do app, para você tocar em Atualizar lá.
- Dado com mais de 30 horas fica marcado como **Desatualizado**. Se a última leitura falhar, o cartão diz o motivo em português e continua mostrando o último saldo que deu certo.

O valor **só informa**: não entra em nenhuma conta do orçamento. Saldo inicial, conta corrente, lançamentos, fechamentos e "pago" não são tocados. Não existe pagamento, Pix nem transferência em lugar nenhum do código.

## 2. O que você pediu e como ficou

| Pedido | Como ficou |
|---|---|
| Ao abrir o app, forçar o botão **Atualizar** do MeuPluggy | **Não dá.** Na prova de conceito de 14/11 a Pluggy recusou o pedido de atualização do MeuPluggy (erro 400, "MeuPluggy item cant be updated"). Qualquer outro jeito exigiria guardar o seu login do MeuPluggy ou da 99Pay, e isso eu não faço. No lugar: o botão **Abrir MeuPluggy**. |
| Atualizar 1 vez por dia | O MeuPluggy já se atualiza sozinho uma vez por dia (é o que o README oficial dele diz; não medi o horário). O app lê esse dado quando **você abre** (no máximo 1 vez por hora). **Leitura em horário fixo, sem você abrir o app, ficou de fora**: ela não deixaria o dado mais novo (quem atualiza é o MeuPluggy) e exigiria uma exceção na regra de segurança "a chave service_role não executa nada". Se quiser mesmo assim, é decisão sua e uma fase à parte. |
| Se não bater com a 99Pay, deixar atualizar manualmente | **Ler agora** + **Abrir MeuPluggy** (item 5). |
| Sem perder o "sozinho" | Mantido: a leitura ao abrir roda sem você tocar em nada. |

## 3. Quem faz o quê (e o que precisa da sua autorização)

| Passo | Quem | Autorização | Situação em 16/11 |
|---|---|---|---|
| 1. Criar a tabela e as 2 funções no banco (`02_saldo99.sql`) | você no SQL Editor, **ou eu** | eu só faço com a sua ordem expressa | **Feito por mim** (ordem de 15/11 às 20:54) |
| 2. Publicar a função `saldo-99pay` | você no editor do Supabase, **ou eu** | idem | **Feito por mim** (idem), com a verificação de JWT desligada |
| 3. Criar os segredos (Pluggy e endereço do app) | **só você** | eles nunca passam por mim nem pelo chat | **Pendente (você)** |
| 4. Subir o app 1.4.0 no GitHub | **só você** (a conta gratuita do Claude não conecta ao GitHub) | o `main` é o que os celulares leem: suba só depois do passo 3 | **Pendente (você)**; pacote e passo a passo prontos |
| 5. Primeira leitura de verdade | você abre o app | — | Pendente |

## 4. Passo a passo (copiar e colar)

Siga **nesta ordem**. Os nomes de menus do Supabase e da Pluggy podem ter mudado; se a sua tela for diferente, pare e me diga o que aparece.

### Passo 1: o banco

**Situação: já aplicado por mim.** Conferi no Supabase: a tabela (vazia), as 2 funções, a regra "só admin lê" e as permissões estão lá, e as tabelas do orçamento ficaram com as mesmas contagens de antes. Os passos abaixo servem só se você quiser refazer (é seguro repetir).

1. Supabase → projeto **orcamento** → **SQL Editor** → **New query**.
2. Abra `supabase/02_saldo99.sql`, copie **tudo**, cole e toque em **Run**.
3. Se aparecer um aviso de "destructive operations", é só o `drop policy if exists` que deixa o arquivo repetível. Confirme em **Run this query**.
4. Deve terminar sem erro (normalmente "Success. No rows returned"). Se aparecer `RODE_O_01_ANTES`, rode primeiro o `01_schema.sql`. Se aparecer `VERIFICACAO_FALHOU`, **pare e me mande o texto**: o arquivo se autoverifica e cancela tudo se algo ficar aberto.
5. Pode rodar de novo quando quiser: não apaga as leituras.

### Passo 2: a função

**Situação: já publicada por mim**, com a verificação de JWT **desligada**, e o texto que está no ar é idêntico, byte a byte, ao `index.ts` deste repositório. Se um dia você publicar de novo pelo editor, **confira que o "Verify JWT" continua desligado** (se voltar a ficar ligado, o cartão dirá "Sua sessão expirou" logo depois de entrar). Os passos abaixo servem só se você quiser refazer.

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nome: exatamente `saldo-99pay` (minúsculas, com hífen).
3. Apague o exemplo, cole **tudo** de `supabase/functions/saldo-99pay/index.ts` e toque em **Deploy**.
4. **Desligue a verificação de JWT** da função (aparece como "Verify JWT", "Enforce JWT Verification" ou parecido). Por quê: quem confere o login é o banco, não o portão do Supabase. Sem login de admin válido, o banco recusa e a Pluggy nem é chamada. Se não achar essa chave, me diga o que aparece.

### Passo 3: os segredos (só você digita) — PENDENTE

Supabase → **Edge Functions** → **Secrets** → adicionar cada um (nome e valor) e salvar:

| Nome (exatamente assim) | Valor |
|---|---|
| `PLUGGY_CLIENT_ID` | o Client ID da sua aplicação na Pluggy (o atual, depois que você girou as chaves) |
| `PLUGGY_CLIENT_SECRET` | o Client Secret da **mesma** aplicação |
| `PLUGGY_ITEM_ID` | o Item ID da conexão do MeuPluggy (Pluggy → Demo → três pontinhos → **Copiar Item ID**); o mesmo da prova de conceito, se a conexão não foi refeita |
| `APP_ORIGIN` | `https://planejamento-pessoal.github.io` (exatamente isso: sem barra no fim e sem `/orcamento-app`) |
| `PLUGGY_ACCOUNT_ID` | **opcional**: só se o cartão disser que há mais de uma conta (item 6); nesse caso me avise que eu explico como achar |

- Copie **direto** do painel da Pluggy para o do Supabase. **Nunca** cole no chat, WhatsApp, e-mail, print ou bloco de notas.
- A função ignora espaços nas pontas, mas confira se não sobrou nada colado junto.
- Segundo a documentação do Supabase, os segredos valem na hora, sem publicar a função de novo. Se o cartão ainda disser que faltam segredos depois de 1 minuto, me avise.

### Passo 4: subir o app 1.4.0 no GitHub (só você, e só depois do passo 3)

O passo a passo, clique por clique, está no `SUBIR-NO-GITHUB.md`, que vem junto com o pacote `orcamento-1.4.0-PARA-SUBIR.zip` (fora deste repositório, como o guia principal). Em resumo:

- **Parte A (obrigatória, é o que muda o app):** 5 arquivos de `docs/`: o `app.css` (1 envio) e os 4 `.js` de `docs/js/` (1 envio só, para o app nunca ficar com arquivos de versões diferentes).
- **Parte B (opcional):** `README.md`, `supabase/...` e `tests/...`. Não mudam o app; só deixam o repositório igual ao que já está no Supabase e deixam o GitHub rodar os testes.
- Em até uns 10 minutos o GitHub Pages publica; o app pega a versão nova na próxima abertura (ou Conta → Sobre → Atualizar agora). **O APK instalado não precisa ser refeito** (`docs/index.html` e a lista de arquivos não mudaram).
- **Para voltar atrás:** suba os 5 arquivos do `orcamento-1.3.0-VOLTAR.zip` do mesmo jeito (mesmas pastas). O Supabase não precisa mexer.

O que acontece se alguma etapa faltar (nos meus testes, nenhum destes casos derruba o app):
- sem o passo 1: o cartão **nem aparece** e o app não chama a função;
- sem o passo 2: o cartão aparece com "A função de leitura ainda não foi instalada";
- sem o passo 3: o cartão diz que faltam segredos.

### Passo 5: primeira leitura de verdade

1. Entre como admin, no mês atual, e role até **Saldo na 99Pay**.
2. Deve aparecer "Lendo…" e depois o saldo com "Dado de dd/mm às hh:mm (há X h)".
3. Compare com o app da 99Pay. Uma pequena diferença é esperada se a 99Pay mexeu na conta depois da última atualização do MeuPluggy (item 5).
4. Apareceu aviso? Procure o texto no item 6. Se não resolver, me mande **só o texto do aviso** (nunca chaves nem prints com CPF, número de conta ou saldo).
5. Me avise que abriu o app: se esta conversa ainda estiver aberta, eu confiro nos logs e no diário do Supabase se a leitura funcionou (olho só se deu certo ou o código do erro, nunca o saldo).

## 5. Quando o saldo não bate com o app da 99Pay

O dado vem do MeuPluggy, que se atualiza sozinho cerca de uma vez por dia; por isso pode estar horas atrasado.

1. No cartão, toque em **Abrir MeuPluggy** (abre fora do app).
2. No MeuPluggy, toque em **Atualizar** na conta da 99Pay e espere uns minutos. Se ele pedir uma ação sua, faça lá (a senha só vai no site ou app oficial dele).
3. Volte ao app e toque em **Ler agora**. Se a hora em "Dado de …" mudou, o MeuPluggy atualizou.
4. Se mesmo assim não bater, o app mostra o que o MeuPluggy recebeu; não há como forçar além disso. Use a 99Pay como referência.

## 6. Mensagens do cartão e o que fazer

| O cartão diz | O que fazer |
|---|---|
| "O banco ainda não tem a leitura do saldo" | Passo 1 |
| "A função de leitura ainda não foi instalada" | Passo 2 (o nome tem que ser exatamente `saldo-99pay`) |
| "…faltam segredos dela" | Passo 3: confira os nomes, um por um |
| "…não aceitou o endereço deste app" | Segredo `APP_ORIGIN` (item do passo 3) |
| "Não consegui falar com a função de leitura" | Veja a internet; se estiver boa, a função não está instalada ou o `APP_ORIGIN` está errado |
| "Sua sessão expirou. Entre de novo." | Entre de novo. Se aparecer **logo depois de entrar**, a verificação de JWT da função provavelmente ficou **ligada** (passo 2, item 4) |
| "A Pluggy recusou as chaves da função" | `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` (use os atuais) |
| "A Pluggy não encontrou a conexão da 99Pay" | Veja no MeuPluggy se a 99Pay ainda está conectada e confira `PLUGGY_ITEM_ID` |
| "…mais de uma conta" | Segredo `PLUGGY_ACCOUNT_ID` (me avise) |
| "O MeuPluggy não conseguiu entrar na 99Pay" / "…está esperando uma ação sua" / "A última atualização do MeuPluggy deu erro" | Toque em **Abrir MeuPluggy** e resolva lá |
| "Desatualizado: dado de …" | O MeuPluggy não atualizou há mais de 30 horas. Veja o item 5 |
| "Já foram feitas 12 leituras nas últimas 24 horas" / "Leitura feita há pouco" | Espere; é o limite de propósito (item 7) |
| "A Pluggy pediu para esperar" / "está fora do ar" | Tente mais tarde |
| "Deu erro dentro da função" | Tente de novo; se repetir, Supabase → Edge Functions → `saldo-99pay` → **Logs** (os logs não têm saldo nem chave) |

Qualquer outro código que apareça: me mande só o texto.

## 7. Limites e o que é guardado

- Uma leitura por vez. **Ao abrir o app**: no máximo 1 por hora. **Ler agora**: no mínimo 30 segundos entre uma e outra. No máximo **12 leituras a cada 24 horas**. Esses limites valem **no banco**, não só na tela.
- A função faz exatamente **3 chamadas de leitura** à Pluggy (login da aplicação, dados da conexão, lista de contas). Qualquer outra chamada é recusada antes de sair (movimentos, atualização, pagamento, nada disso existe no código).
- O banco guarda por leitura: saldo em centavos, hora do dado, situação da conexão e um código de erro curto. **Não guarda** movimentações, descrições, nome, CPF, número de conta, senha, token nem chave. Leituras com mais de 120 dias são apagadas sozinhas. Só o admin consegue ler a tabela.
- As chaves da Pluggy ficam **só** nos segredos da função no Supabase; nunca no app, no GitHub nem no aparelho. O app não guarda nenhum valor da 99Pay no aparelho (só na tela).

## 8. Arquivos desta entrega

| Arquivo | O que é |
|---|---|
| `docs/js/app.js`, `docs/js/data.js`, `docs/js/format.js`, `docs/js/month-view.js`, `docs/app.css` | o app 1.4.0 (cartão, leitura ao abrir, botões): **Parte A do passo 4** (os outros 6 arquivos desta tabela são a Parte B, opcional) |
| `supabase/02_saldo99.sql` | tabela do diário + 2 funções do banco (passo 1) |
| `supabase/functions/saldo-99pay/index.ts` | a função (passo 2) |
| `supabase/functions/saldo-99pay/LEIA-ME.md` | este guia |
| `tests/saldo99-app.test.js`, `tests/saldo99-funcao.test.js` | testes automáticos novos |
| `README.md` | seção nova sobre o saldo da 99Pay |

`docs/index.html`, `docs/config.js` e o APK **não mudam**. **Nunca** sobrescreva o `docs/config.js`.

## 9. O que foi e o que NÃO foi testado

**Testado em 15/11/2026, no meu ambiente (Node 22.23.4 e Postgres 16.15 locais, Chromium):**

- Suíte inteira do repositório (`node --test tests/*.test.js`): **186 testes, 186 passaram, 0 falhas, 0 pulados** no Node 22.23.4 (122 já existiam, 64 são novos). No Node 18.20.8: 156 passaram, 0 falharam e 30 foram pulados (os da função em TypeScript, como previsto).
- Banco: 38 testes contra um Postgres de verdade (quem pode ler, limites, concorrência, apagar leituras velhas). Estraguei o `02_saldo99.sql` de 18 jeitos de propósito e os testes pegaram os 18.
- Função: 31 testes com a Pluggy e o banco simulados. Estraguei o `index.ts` de 33 jeitos e os testes pegaram os 33.
- Função + Postgres juntos: 9 testes. Das 4 sabotagens, todas foram pegas nesta rodada; a da "fila de pedidos simultâneos" já escapou numa rodada anterior (depende de tempo), e por isso ela é garantida pelo teste de SQL.
- App: 33 testes de lógica; 31 sabotagens, 31 pegas.
- Navegador (Chromium de verdade): 16 cenários, 16 passaram. Cobrem: cartão só para admin, leitura ao abrir uma vez só, intervalo, falhas em português, dado velho, banco sem o `02`, função não instalada, `APP_ORIGIN` errado (CORS de verdade), tela estreita, tema escuro, nada guardado no aparelho. Estraguei o app de 14 jeitos de propósito e os cenários pegaram os 14.
- O "desfazer" do item 10 e o caso "rodar o `01_schema.sql` de novo depois do `02`" (que o README manda fazer em versões que mexem no banco): testei num Postgres 16 local, do zero. Os dois passam, o desfazer deixa o banco exatamente como estava antes do `02` (mesmas tabelas, funções e regras) e rodar o `02` de novo o traz de volta idêntico.

**Conferido no Supabase de verdade (15 e 16/11/2026), sem mexer nos dados da família:** a tabela `pay99_balance_reads` (vazia); as 2 funções do banco (o código confere com o do `02_saldo99.sql` testado aqui); a regra de leitura só para admin e as permissões (só usuário logado executa as funções); um teste de comportamento rodado dentro de uma transação que foi desfeita (passou, e não ficou nenhuma leitura gravada); as tabelas do orçamento com as mesmas contagens de antes; a função publicada, ativa, com a verificação de JWT desligada e com o texto idêntico ao do repositório; e uma chamada de teste sem segredos (que não toca na Pluggy nem no banco): a função ligou no Supabase e respondeu "não configurada" (HTTP 503), como previsto, e o log registrou só os nomes dos segredos que faltam, nunca valores. O autoteste do `02_saldo99.sql` passou também no Postgres 17 do Supabase (os testes locais rodaram no 16).

**NÃO testado (e por isso o cartão só deve ser tratado como funcionando depois da primeira leitura real):**

1. **A camada de API do Supabase não foi testada de verdade.** O banco foi (parágrafo acima), mas aquele teste chamou as funções do banco direto, não pela API REST (PostgREST). O que faz o papel dela nos meus testes (checar o login, escolher a função pelos nomes dos argumentos, devolver o código HTTP) é uma imitação minha. A função publicada nunca foi chamada com login de admin e segredos; o primeiro uso real é o teste.
2. **Esta função nunca falou com a Pluggy de verdade.** Na prova de conceito de 14/11 foram medidos o login, a conexão e a lista de contas (o saldo bateu com o da 99Pay), mas com outro código.
3. **Duas suposições sobre a Pluggy:** conta sem moeda informada é tratada como reais; e a hora em que a conexão foi atualizada pela última vez (`lastUpdatedAt`) é usada como a "hora do dado". Se a Pluggy se comportar diferente, o cartão vai mostrar um aviso ou uma hora estranha, nunca um valor de outra moeda.
4. **Depois do teste gratuito.** O teste de 15 dias da Pluggy termina em 28/11 às 23:59 (horário de Brasília; confira a data no painel). **Não consegui confirmar** que a leitura continua grátis e funcionando depois disso. Só um teste depois dessa data responde. Se parar, o app continua igual; o cartão passa a mostrar o último saldo com "Desatualizado" e o motivo da falha.
5. **Celular de verdade.** Testei no Chromium do computador (inclusive 360 px de largura e tema escuro). Não rodei no Android (nem no APK nem no Chrome instalado). Li o código da casca Android: links de fora do app saem pelo navegador do celular e `*.supabase.co` é permitido, então o botão **Abrir MeuPluggy** e a chamada da função deveriam funcionar, mas isso é leitura de código, não teste.
6. Nomes de menus do Supabase, da Pluggy e do GitHub (passo 4) podem ter mudado, ou ser diferentes na tela do seu celular: escrevi sem ver as suas telas.

## 10. Desfazer

- **O app inteiro**: suba de volta os 5 arquivos do `orcamento-1.3.0-VOLTAR.zip` (mesmas pastas do passo 4, Parte A). O cartão some em todos os celulares na próxima abertura.
- **Só a leitura, mantendo o app 1.4.0**: apague a função (Supabase → Edge Functions → `saldo-99pay` → Delete) e os segredos (Edge Functions → Secrets). O cartão passa a dizer que a função não está instalada.
- **O banco** (só se quiser mesmo apagar o diário; o app funciona normal sem ele, e o cartão some). No SQL Editor:

```sql
drop table if exists public.pay99_balance_reads cascade;
drop function if exists public.pay99_start_read(text);
drop function if exists public.pay99_finish_read(bigint, boolean, bigint, timestamptz, text, text);
```

  Isso não toca em nenhuma tabela do orçamento. Para voltar, rode o `02_saldo99.sql` de novo.
- **Pluggy**: gere um novo Client Secret (o antigo deixa de valer) ou apague a aplicação; no MeuPluggy, desconecte a 99Pay se não for seguir.

## 11. Regras que não mudam

- Só leitura. Nenhum pagamento, Pix ou transferência, agora ou depois.
- Senha de banco, PIN, código de acesso e cookies de sessão **nunca** são pedidos nem guardados. Chaves só nos segredos do Supabase, digitadas por você.
- Custo zero: se qualquer tela pedir cartão de crédito ou plano pago, pare e me avise.
- O saldo da 99Pay aparece separado; nunca altera saldo inicial, conta corrente, lançamentos, fechamentos ou quitados.
- Este repositório é público: este guia não tem (e nenhum arquivo daqui pode ter) chave, Item ID, saldo ou dado pessoal.
