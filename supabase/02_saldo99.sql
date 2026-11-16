-- ════════════════════════════════════════════════════════════════════════
--  ORÇAMENTO — saldo da 99Pay (versão 1.4.0): diário das leituras e as 2 funções
--
--  RODE DEPOIS do 01_schema.sql (uma vez só; pode rodar de novo sem medo):
--   Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
--   (Se aparecer o aviso de "destructive operations", é só o "drop policy if exists" que deixa o
--    script repetível: confirme com "Run this query".)
--
--  O QUE ISTO FAZ
--   O app passa a mostrar, num cartão à parte, o saldo que a 99Pay informa ao MeuPluggy. A leitura
--   é feita pela Edge Function "saldo-99pay" (só leitura: não existe ordem de pagamento, Pix nem
--   transferência em lugar nenhum) e cada tentativa fica registrada aqui, para o app mostrar o
--   último saldo bom, a que horas é aquele dado e se a última tentativa falhou.
--
--  O QUE ISTO NÃO FAZ
--   • NÃO mexe em nenhuma tabela do orçamento: saldo inicial, conta corrente (carry_over),
--     lançamentos, despesas, receitas, fechamentos e "pago" continuam exatamente como estão.
--     O saldo da 99Pay é só uma informação ao lado: não entra em nenhuma conta do app.
--   • NÃO guarda movimentações, descrições, nomes nem números de conta: só o saldo (em centavos),
--     a hora a que o dado se refere, a situação da conexão e um código de erro curto.
--   • NÃO guarda senha, token nem chave nenhuma.
--
--  QUEM ENXERGA: só admin (tabela e funções). Editor, leitor, bloqueado e quem não tem perfil não
--  veem nem uma linha. "anon" e "service_role" não recebem permissão nenhuma (mesma regra do 01).
--
--  LIMITES (para não martelar o MeuPluggy/Pluggy). Valem aqui no banco, não só no app:
--   • uma leitura por vez (a anterior que não respondeu em 90 s é dada como perdida);
--   • "ao abrir o app": no máximo 1 por hora; "Ler agora" (manual): no mínimo 30 s entre uma e outra;
--   • no máximo 12 leituras a cada 24 h;
--   • leituras com mais de 120 dias são apagadas sozinhas.
--
--  SE VOCÊ CRIAR FUNÇÕES NOVAS no schema "public": veja o aviso no fim do cabeçalho do 01_schema.sql.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── Confere que o 01_schema.sql já foi rodado (sem ele nada aqui faz sentido) ──
do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regprocedure('public.app_role()') is null then
    raise exception 'RODE_O_01_ANTES: rode o 01_schema.sql e depois este arquivo. Nada foi aplicado.';
  end if;
end
$$;

-- ─── Diário das leituras do saldo da 99Pay ──────────────────────────────
-- Cada linha é UMA tentativa de leitura. Três estados possíveis (a regra pay99_reads_state_chk
-- impede qualquer mistura):
--   em andamento  ok vazio e nada preenchido;
--   deu certo     ok = true, com saldo e a hora do dado;
--   falhou        ok = false, só com o código do erro (sem saldo).
create table if not exists public.pay99_balance_reads (
  id            bigint generated always as identity primary key,
  source        text not null check (source in ('ao_abrir', 'manual')),
  requested_at  timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean,
  balance_cents bigint,        -- saldo em centavos (inteiro: sem erro de arredondamento)
  data_as_of    timestamptz,   -- a que horas o dado vale, segundo o MeuPluggy (NÃO é a hora da leitura)
  item_status   text,          -- situação da conexão no MeuPluggy (ex.: UPDATED, LOGIN_ERROR)
  error         text,          -- código curto do erro (ex.: pluggy_indisponivel). Nunca texto livre.
  constraint pay99_reads_state_chk check (
       (ok is null  and finished_at is null     and balance_cents is null     and data_as_of is null     and error is null and item_status is null)
    or (ok is true  and finished_at is not null and balance_cents is not null and data_as_of is not null and error is null)
    or (ok is false and finished_at is not null and balance_cents is null     and data_as_of is null     and error is not null)
  ),
  -- ±R$ 999.999.999,99: bem além do possível, só para recusar lixo
  constraint pay99_reads_balance_chk check (balance_cents is null or balance_cents between -99999999999 and 99999999999),
  constraint pay99_reads_error_chk   check (error is null or error ~ '^[a-z0-9_]{1,40}$'),
  constraint pay99_reads_status_chk  check (item_status is null or item_status ~ '^[A-Z_]{1,30}$')
);
create index if not exists pay99_reads_requested_idx on public.pay99_balance_reads (requested_at desc);

-- ─── Começar uma leitura (a Edge Function chama ANTES de falar com a Pluggy) ─────
-- Só admin. Aplica os limites e, se estiver tudo certo, registra a tentativa e devolve o número dela.
-- Devolve sempre um JSON:
--   {"permitido": true,  "id": 123}
--   {"permitido": false, "motivo": "em_andamento" | "limite_diario" | "intervalo", "espere_s": 42}
-- ("espere_s" só vem com "intervalo".) A Pluggy só é consultada se vier "permitido": true.
create or replace function public.pay99_start_read(p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gap  integer;
  v_last timestamptz;
  v_id   bigint;
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('ao_abrir', 'manual') then
    raise exception 'origem_invalida' using errcode = '22023';
  end if;

  -- uma leitura por vez em todo o app: sem isto, dois pedidos simultâneos passariam juntos pelas
  -- contas abaixo (intervalo e teto) antes de qualquer um deles ser registrado
  perform pg_advisory_xact_lock(hashtextextended('orc.pay99', 0));

  delete from public.pay99_balance_reads where requested_at < now() - interval '120 days';

  -- tentativa que nunca respondeu (a função caiu no meio, por exemplo) vira falha, em vez de
  -- ficar "em andamento" para sempre
  update public.pay99_balance_reads
     set ok = false, finished_at = now(), error = 'sem_resposta'
   where ok is null and requested_at <= now() - interval '90 seconds';

  if exists (select 1 from public.pay99_balance_reads where ok is null) then
    return jsonb_build_object('permitido', false, 'motivo', 'em_andamento');
  end if;

  if (select count(*) from public.pay99_balance_reads
       where requested_at > now() - interval '24 hours') >= 12 then
    return jsonb_build_object('permitido', false, 'motivo', 'limite_diario');
  end if;

  v_gap := case p_source when 'ao_abrir' then 3600 else 30 end;
  select max(requested_at) into v_last from public.pay99_balance_reads;
  if v_last is not null and v_last > now() - make_interval(secs => v_gap) then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'intervalo',
      'espere_s', greatest(1, ceil(extract(epoch from (v_last + make_interval(secs => v_gap) - now())))::integer));
  end if;

  insert into public.pay99_balance_reads (source) values (p_source) returning id into v_id;
  return jsonb_build_object('permitido', true, 'id', v_id);
end
$$;

-- ─── Terminar uma leitura (a Edge Function chama DEPOIS de falar com a Pluggy) ───
-- Só admin. Só fecha uma leitura que ainda está em andamento (fechar duas vezes dá erro).
-- Deu certo: p_ok = true, com p_balance_cents e p_data_as_of.  Falhou: p_ok = false, com p_error.
create or replace function public.pay99_finish_read(
  p_id            bigint,
  p_ok            boolean,
  p_balance_cents bigint      default null,
  p_data_as_of    timestamptz default null,
  p_error         text        default null,
  p_item_status   text        default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_id is null or p_ok is null
     or (p_ok and (p_balance_cents is null or p_data_as_of is null
                   or p_data_as_of < timestamptz '2000-01-01 00:00:00+00'
                   or p_data_as_of > now() + interval '1 day'))
     or (not p_ok and p_error is null) then
    raise exception 'parametro_invalido' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('orc.pay99', 0));

  update public.pay99_balance_reads
     set ok            = p_ok,
         finished_at   = now(),
         balance_cents = case when p_ok then p_balance_cents end,
         data_as_of    = case when p_ok then p_data_as_of end,
         error         = case when p_ok then null else p_error end,
         item_status   = p_item_status
   where id = p_id and ok is null;
  if not found then
    raise exception 'leitura_nao_encontrada' using errcode = 'P0002';
  end if;
end
$$;

-- ─── Regras de acesso (RLS) ─────────────────────────────────────────────
alter table public.pay99_balance_reads enable row level security;

drop policy if exists pay99_reads_select on public.pay99_balance_reads;
create policy pay99_reads_select on public.pay99_balance_reads for select to authenticated
  using ((select public.app_role()) = 'admin');

-- ─── Permissões (segunda camada, além das regras acima) ─────────────────
-- Quem está logado só LÊ a tabela (e só admin enxerga linhas). Ninguém escreve direto: as linhas
-- só nascem e mudam pelas 2 funções acima, que rodam como dono e conferem o papel antes.
revoke all on public.pay99_balance_reads from public, anon, authenticated, service_role;
grant select on public.pay99_balance_reads to authenticated;

do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.pay99_balance_reads', 'id'));
end
$$;

revoke all on function public.pay99_start_read(text)
  from public, anon, authenticated, service_role;
revoke all on function public.pay99_finish_read(bigint, boolean, bigint, timestamptz, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.pay99_start_read(text) to authenticated;
grant execute on function public.pay99_finish_read(bigint, boolean, bigint, timestamptz, text, text) to authenticated;

-- ─── Conferência final: se algo estiver fora do combinado, cancela tudo ──
-- (roda dentro da mesma transação: se falhar, NADA deste arquivo é aplicado)
do $$
declare
  v_priv  text;
  v_role  text;
  v_has   boolean;
  v_bad   text;
  v_qual  text;
  v_func  text;
  v_seq   text := pg_catalog.pg_get_serial_sequence('public.pay99_balance_reads', 'id');
  v_funcs constant text[] := array['public.pay99_start_read(text)',
                                   'public.pay99_finish_read(bigint, boolean, bigint, timestamptz, text, text)'];
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.pay99_balance_reads'::regclass) then
    raise exception 'VERIFICACAO_FALHOU: a tabela pay99_balance_reads esta sem RLS. Nada foi aplicado.';
  end if;

  -- "authenticated" só lê; "anon" e "service_role" não podem nada. (select/insert/update/references
  -- também são testados "em alguma coluna", porque permissão dada a uma coluna só não aparece no
  -- teste da tabela inteira.)
  foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    foreach v_role in array array['anon', 'service_role', 'authenticated'] loop
      v_has := case when v_priv in ('select', 'insert', 'update', 'references')
                    then pg_catalog.has_any_column_privilege(v_role, 'public.pay99_balance_reads', v_priv)
                    else pg_catalog.has_table_privilege(v_role, 'public.pay99_balance_reads', v_priv) end;
      if v_role = 'authenticated' then
        if v_has is distinct from (v_priv = 'select') then
          raise exception 'VERIFICACAO_FALHOU: permissao de % para "authenticated" em pay99_balance_reads esta diferente do combinado. Nada foi aplicado.', v_priv;
        end if;
      elsif v_has then
        raise exception 'VERIFICACAO_FALHOU: "%" tem permissao de % em pay99_balance_reads. Nada foi aplicado.', v_role, v_priv;
      end if;
    end loop;
  end loop;

  -- regras de acesso: só a deste arquivo (uma regra de modelo do painel, como "using (true)", abriria a leitura)
  select string_agg(p.policyname, ', ' order by p.policyname) into v_bad
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename = 'pay99_balance_reads' and p.policyname <> 'pay99_reads_select';
  if v_bad is not null then
    raise exception 'VERIFICACAO_FALHOU: regra(s) de acesso desconhecida(s) em pay99_balance_reads: %. Apague com "drop policy" e rode de novo. Nada foi aplicado.', v_bad;
  end if;
  -- e ela tem que ser EXATAMENTE "só admin lê" (o texto é comparado sem espaços, parênteses e "public.",
  -- porque o Postgres escreve a mesma regra de jeitos um pouco diferentes conforme o ambiente)
  select p.qual into v_qual
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename = 'pay99_balance_reads'
     and p.policyname = 'pay99_reads_select' and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
     and p.roles = array['authenticated']::name[];
  if v_qual is null
     or regexp_replace(v_qual, '[[:space:]()]|public\.', '', 'g') is distinct from 'SELECTapp_roleASapp_role=''admin''::text' then
    raise exception 'VERIFICACAO_FALHOU: a regra pay99_reads_select nao esta como combinado (so admin le; esta assim: %). Nada foi aplicado.', coalesce(v_qual, '(nao existe)');
  end if;

  -- contador das linhas: ninguém além do dono mexe nele
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['usage', 'select', 'update'] loop
      if pg_catalog.has_sequence_privilege(v_role, v_seq, v_priv) then
        raise exception 'VERIFICACAO_FALHOU: "%" tem permissao de % na sequencia %. Nada foi aplicado.', v_role, v_priv, v_seq;
      end if;
    end loop;
  end loop;

  -- funções com os nomes deste arquivo, mas com outros argumentos (sobras de versões antigas)
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('pay99_start_read', 'pay99_finish_read')
     and p.oid not in (select pg_catalog.to_regprocedure(f)::oid from unnest(v_funcs) as f);
  if v_bad is not null then
    raise exception 'VERIFICACAO_FALHOU: funcao(oes) com nome deste app e argumentos diferentes: %. Apague com "drop function" e rode de novo. Nada foi aplicado.', v_bad;
  end if;

  -- a mesma regra geral do 01: nenhuma função do schema "public" (a API publica tudo que está ali)
  -- pode ser executada por anon nem por service_role (fora as de extensão e as de gatilho)
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')
     and p.prorettype not in ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
     and not exists (select 1 from pg_catalog.pg_depend d
                      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and (pg_catalog.has_function_privilege('anon', p.oid, 'execute')
          or pg_catalog.has_function_privilege('service_role', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'VERIFICACAO_FALHOU: anon ou service_role pode executar: %. Rode "revoke execute on function <nome> from public, anon, service_role;" e execute este arquivo de novo. Nada foi aplicado.', v_bad;
  end if;

  -- as 2 funções: liberadas para quem está logado (a conferência de admin é feita DENTRO delas)
  foreach v_func in array v_funcs loop
    if not pg_catalog.has_function_privilege('authenticated', v_func, 'execute') then
      raise exception 'VERIFICACAO_FALHOU: "authenticated" nao pode executar %. Nada foi aplicado.', v_func;
    end if;
    if pg_catalog.has_function_privilege('anon', v_func, 'execute')
       or pg_catalog.has_function_privilege('service_role', v_func, 'execute') then
      raise exception 'VERIFICACAO_FALHOU: anon ou service_role pode executar %. Nada foi aplicado.', v_func;
    end if;
  end loop;
end
$$;

commit;

-- RESULTADO: se a linha abaixo apareceu, deu tudo certo.
select 'ok' as saldo_99pay_instalado,
       (select count(*) from public.pay99_balance_reads) as leituras_guardadas;
