# Orçamento

App de celular para o orçamento da casa: contas fixas, cartões, parcelados e rendas mês a mês, saldo acumulado, projeção dos meses futuros e simulação de compras (sem gravar nada).

- **Login e senha**, banco no **Supabase** (e-mail + senha; cadastro só com código de convite).
- **Quem edita e quem só lê** é definido dentro do app (Conta → Acessos), sem abrir o Supabase. As regras valem no banco (RLS), não só na tela.
- **Atualização automática**: o app é um site (GitHub Pages) que confere versão nova toda vez que abre. Subir os arquivos no GitHub basta; ninguém reinstala nada.
- Funciona instalado pelo Chrome (PWA, caminho recomendado) ou como app Android (APK, opcional, com tela protegida).

Este repositório é **público** (exigência do GitHub Pages gratuito). Por isso não tem nenhum dado pessoal: os valores ficam só no Supabase.

> O passo a passo completo (Supabase, GitHub, primeiro acesso, celular) está no `LEIA-ME.md` que acompanha o pacote, fora deste repositório.

## Pastas

| Pasta | Para quê |
|---|---|
| `docs/` | O app em si (HTML, CSS, JS, sem build). É o que o GitHub Pages publica (branch `main`, pasta `/docs`). |
| `docs/config.js` | **O único arquivo que liga o app ao seu Supabase** (Project URL e chave pública/publishable). |
| `supabase/01_schema.sql` | Tabelas, regras de acesso (RLS), convites e autoverificação. Roda uma vez no SQL Editor do Supabase; pode rodar de novo sem apagar dados. |
| `android/` | A "casca" Android (WebView) que abre o app. Só precisa de novo APK se mexer aqui. |
| `tests/` | Testes automáticos: cálculos, formatos, travas de segurança, do `config.js`, dos ícones e dos recursos do Android. |
| `tools/` | `sync-launcher.js`: recalcula os hashes da política de segurança do `docs/index.html` e copia o arquivo para dentro do APK. |
| `.github/workflows/` | `tests.yml` roda os testes a cada envio; `android.yml` gera o APK (aba Actions → "Gerar APK"). `dependabot.yml` mantém as ações fixadas em dia. |

## Segurança, em resumo

- **Banco**: RLS em todas as tabelas; `anon` e `service_role` sem permissão nenhuma nas tabelas e funções (isso barra o acesso direto às tabelas, mas **não** a API de usuários do Supabase: chave secreta vazada = gire a chave na hora); papéis admin / editor / leitor / bloqueado lidos do banco a cada pedido; funções `SECURITY DEFINER` com `search_path` vazio e liberadas só para usuários logados; convites de uso único com limite de tentativas (vale sob concorrência) que somem junto com o admin que os criou; trocas de papel em fila (nunca fica sem admin); valores e datas absurdos recusados; o `01_schema.sql` se autoverifica (tabelas, colunas, funções, regras, sequências) e cancela tudo se algo ficar aberto. Funções novas no schema `public` precisam de `revoke execute ... from public, anon` logo depois de criadas.
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
6. Versão que mexe no banco (a 1.2.0 acrescentou as marcas de pago/recebido): rode `supabase/01_schema.sql` de novo no SQL Editor do Supabase. É seguro repetir (não apaga nada). Sem isso o app funciona, só sem a chavinha de pago/recebido.

## Testes

```
node --test tests/*.test.js
```

Precisa só do Node 18 ou mais novo. Não tem dependências. O GitHub roda o mesmo comando a cada envio (aba Actions → "Testes"), e o APK só é compilado se os testes passarem.

## O que é público e o que não é

- Público de propósito: o código, a URL do projeto Supabase e a chave `anon`/publishable. Quem protege os dados são as regras do banco (RLS em `01_schema.sql`): sem convite, a conta criada não enxerga nada.
- **Nunca** colocar neste repositório: a chave `service_role` / secret do Supabase, a senha do banco, o arquivo `.jks` (chave de assinatura do APK) e suas senhas, o seed com os valores da planilha, tokens do GitHub. O `.gitignore` bloqueia `.jks`, `*.keystore`, `*.apk` e `PRIVADO*`; os testes falham se encontrarem chave secreta.
- Se uma chave secreta chegar a ser publicada: gire-a no Supabase (Project Settings → API Keys); apagar o arquivo no GitHub não basta, porque o histórico do Git guarda a antiga.

## Dica de endereço

Em conta pessoal do GitHub, todos os sites do dono dividem o mesmo endereço (`dono.github.io`) e, portanto, o mesmo armazenamento do navegador. Hospedar este app em uma **organização** gratuita separa a origem dos seus outros sites. O endereço do APK é montado sozinho a partir do dono e do nome do repositório (ou de `ORC_START_URL`).
