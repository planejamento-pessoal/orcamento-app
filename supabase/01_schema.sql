-- ════════════════════════════════════════════════════════════════════════
--  ORÇAMENTO — esquema do Supabase (tabelas, permissões e convites)
--
--  COMO USAR (uma vez só, num projeto Supabase NOVO):
--   1. Supabase → Authentication → Sign In / Providers → Email:
--      DESLIGUE "Confirm email" (deixe "Allow new users to sign up" LIGADO por enquanto).
--   2. Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
--      (Se aparecer o aviso de "destructive operations", é só o "drop policy if exists"
--      que deixa o script repetível: confirme com "Run this query".)
--   3. O resultado final mostra o CÓDIGO DO CONVITE DE ADMIN. Abra o app,
--      toque em "Criar conta com convite" e use esse código: você vira admin.
--      (A partir daí, convites e papéis são gerenciados DENTRO do app.)
--
--  Pode rodar de novo sem medo: não apaga dados. Se você ficar sem nenhum
--  admin, rodar de novo gera um convite de admin novo. Se você já rodou uma versão mais
--  antiga deste arquivo, rode esta de novo: ela só acrescenta o que faltar (por exemplo, a
--  tabela do "Pago/Recebido").
--
--  Este arquivo NÃO contém dados pessoais — pode ficar no GitHub público.
--
--  PAPÉIS:  admin = tudo + gerencia usuários e convites
--           editor = lê e altera o orçamento
--           leitor = só lê
--           bloqueado = sem acesso a nada
--
--  SEGURANÇA (resumo do que este arquivo garante, e confere no final):
--   • Todas as tabelas têm RLS ligado e só o papel "authenticated" recebe permissão nelas.
--     "anon" (quem só tem a chave pública) e "service_role" (chave secreta) não recebem NADA
--     nas tabelas. Atenção: isso barra a leitura DIRETA das tabelas. Quem tiver a chave
--     secreta ainda consegue usar a API de administração de usuários do Supabase (trocar a
--     senha de alguém, gerar link de login) e entrar COMO essa pessoa. Chave secreta
--     vazada = gire a chave no painel do Supabase na hora.
--   • Conta criada sem convite não enxerga nada (sem linha em "profiles" = sem acesso).
--   • O papel de cada pessoa é lido do banco a cada pedido (bloquear vale na hora).
--   • Nenhuma função do schema "public" fica executável por anon/service_role.
--   • Se algo ficar diferente disso, o script CANCELA tudo e diz o que está errado.
--
--  SE VOCÊ CRIAR FUNÇÕES NOVAS no schema "public" no futuro: logo depois de criar, rode
--  "revoke execute on function public.nome(args) from public, anon;" (no Postgres, "public"
--  = todo mundo, e nasce com permissão de executar). Se esquecer, este arquivo recusa rodar
--  de novo e mostra o nome da função.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── Nada novo nasce aberto (tabelas e sequências) ──────────────────────
-- Tabelas e sequências criadas depois, neste esquema, não recebem permissão automática para
-- anon / authenticated / service_role (é o que o próprio Supabase recomenda). Quem precisar
-- de acesso ganha um GRANT explícito, como fazemos abaixo.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
-- (Funções: o Postgres dá EXECUTE a "public" em toda função nova, e um "revoke ... in schema"
--  não desfaz isso. Por isso cada função deste arquivo leva seu próprio "revoke ... from public"
--  mais abaixo, e a conferência final recusa qualquer função do schema "public" executável
--  por anon ou service_role.)

-- ─── Usuários com acesso (quem não está aqui não vê nada) ───────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  role        text not null default 'leitor'
              check (role in ('admin', 'editor', 'leitor', 'bloqueado')),
  created_at  timestamptz not null default now()
);

-- ─── Convites (código de uso único que concede um papel) ────────────────
create table if not exists public.invites (
  code        text primary key,
  role        text not null check (role in ('admin', 'editor', 'leitor')),
  note        text,
  -- convite some junto com a conta de quem o criou (um admin removido não deixa convites vivos)
  created_by  uuid references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  used_by     uuid references auth.users(id) on delete set null,
  used_at     timestamptz
);

-- Tentativas erradas de código (só as funções internas mexem aqui)
create table if not exists public.invite_attempts (
  id       bigint generated always as identity primary key,
  user_id  uuid not null,
  at       timestamptz not null default now()
);

-- ─── Itens do orçamento (cada coluna da planilha vira um item) ──────────
create table if not exists public.budget_items (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('saida', 'entrada')),
  type        text not null default 'conta'
              check (type in ('conta', 'cartao', 'parcela', 'renda', 'outro')),
  name        text not null check (length(btrim(name)) between 1 and 80),
  card_name   text check (card_name is null or length(card_name) <= 80),
  due_day     smallint check (due_day between 1 and 31),
  recurring   boolean not null default false,   -- repete todo mês
  start_month date,                              -- 1º dia do mês em que começa
  end_month   date,                              -- 1º dia do último mês (vazio = sem fim)
  note        text check (note is null or length(note) <= 500),
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint items_kind_type_chk check (
    (kind = 'saida'   and type in ('conta', 'cartao', 'parcela', 'outro')) or
    (kind = 'entrada' and type in ('renda', 'outro'))
  ),
  -- meses: sempre o dia 1, finito (nada de 'infinity') e numa faixa razoável
  constraint items_start_day_chk check (start_month is null or (isfinite(start_month) and extract(day from start_month) = 1
                                          and start_month between date '2000-01-01' and date '2200-12-01')),
  constraint items_end_day_chk   check (end_month   is null or (isfinite(end_month)   and extract(day from end_month)   = 1
                                          and end_month   between date '2000-01-01' and date '2200-12-01')),
  constraint items_recurring_chk check (not recurring or start_month is not null),
  constraint items_range_chk     check (end_month is null or start_month is null or end_month >= start_month)
);

-- Valor que vale "a partir de" um mês (itens que repetem todo mês)
create table if not exists public.item_rates (
  item_id     uuid not null references public.budget_items(id) on delete cascade,
  from_month  date not null check (isfinite(from_month) and extract(day from from_month) = 1
                                   and from_month between date '2000-01-01' and date '2200-12-01'),
  -- valores: finitos (o "between" também recusa NaN e infinito, que passariam em "amount >= 0")
  amount      numeric(14, 2) not null check (amount between 0 and 999999999999.99),
  primary key (item_id, from_month)
);

-- Valor digitado para um mês específico (vale mais que o "a partir de")
create table if not exists public.budget_entries (
  item_id     uuid not null references public.budget_items(id) on delete cascade,
  month       date not null check (isfinite(month) and extract(day from month) = 1
                                   and month between date '2000-01-01' and date '2200-12-01'),
  amount      numeric(14, 2) not null check (amount between -999999999999.99 and 999999999999.99),
  note        text check (note is null or length(note) <= 300),
  updated_at  timestamptz not null default now(),
  primary key (item_id, month)
);

-- Marca "pago / recebido": só diz se aquele item, naquele mês, já foi resolvido.
-- Não guarda valor: o valor continua em item_rates / budget_entries, e a marca não mexe em
-- nenhuma conta (saldo e projeção ignoram a marca). Marcar = inserir a linha; desmarcar = apagá-la.
create table if not exists public.budget_settled (
  item_id     uuid not null references public.budget_items(id) on delete cascade,
  month       date not null check (isfinite(month) and extract(day from month) = 1
                                   and month between date '2000-01-01' and date '2200-12-01'),
  primary key (item_id, month)
);

-- Configurações (uma linha só)
create table if not exists public.app_settings (
  id                  smallint primary key default 1 check (id = 1),
  balance_start_month date not null default (date_trunc('month', now())::date)
                      check (isfinite(balance_start_month) and extract(day from balance_start_month) = 1
                             and balance_start_month between date '2000-01-01' and date '2200-12-01'),
  opening_balance     numeric(14, 2) not null default 0
                      check (opening_balance between -999999999999.99 and 999999999999.99),
  min_balance         numeric(14, 2) not null default 1000
                      check (min_balance between -999999999999.99 and 999999999999.99),
  updated_at          timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict do nothing;

-- ─── updated_at automático ──────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_items_touch on public.budget_items;
create trigger trg_items_touch before update on public.budget_items
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_entries_touch on public.budget_entries;
create trigger trg_entries_touch before update on public.budget_entries
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_settings_touch on public.app_settings;
create trigger trg_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- ─── Código de convite: 12 caracteres, 60 bits aleatórios ───────────────
-- Alfabeto de 32 símbolos (sem 0, 1, I, O, que se confundem). Cada símbolo vem de 5 bits
-- sorteados pelo gerador seguro do Postgres (gen_random_uuid usa pg_strong_random);
-- usamos só os bytes do UUID que não têm bits fixos (versão e variante).
create or replace function public.make_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes    bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_pos      constant int[] := array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13];
  v_code     text := '';
  i          int;
begin
  foreach i in array v_pos loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return v_code;
end
$$;

-- ─── Papel de quem está logado (usado nas regras abaixo) ────────────────
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

-- ─── Funções que o app chama ────────────────────────────────────────────

-- Troca um código de convite por acesso. Devolve:
--   'ok' | 'invalido' | 'muitas_tentativas' | 'ja_tem_perfil'
create or replace function public.redeem_invite(p_code text, p_name text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_inv   public.invites%rowtype;
  v_email text;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'nao_autenticado' using errcode = '28000';
  end if;

  -- uma tentativa por vez para cada pessoa: sem isto, dezenas de pedidos simultâneos
  -- passariam todos pela contagem de erros antes de qualquer um ser registrado
  perform pg_advisory_xact_lock(hashtextextended('orc.redeem:' || v_uid::text, 0));

  if exists (select 1 from public.profiles where id = v_uid) then
    return 'ja_tem_perfil';
  end if;

  delete from public.invite_attempts where at < now() - interval '1 day';
  if (select count(*) from public.invite_attempts
       where user_id = v_uid and at > now() - interval '1 hour') >= 5 then
    return 'muitas_tentativas';
  end if;

  select * into v_inv from public.invites where code = v_code for update;
  if not found or v_inv.used_at is not null or v_inv.expires_at <= now() then
    insert into public.invite_attempts (user_id) values (v_uid);
    return 'invalido';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    v_name := split_part(coalesce(v_email, ''), '@', 1);
  end if;
  v_name := left(v_name, 60);

  insert into public.profiles (id, email, name, role)
  values (v_uid, lower(v_email), v_name, v_inv.role);

  update public.invites set used_by = v_uid, used_at = now() where code = v_code;
  return 'ok';
end
$$;

-- Admin: cria convite. Devolve o código (12 caracteres).
create or replace function public.admin_create_invite(
  p_role text, p_days integer default 7, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'editor', 'leitor') then
    raise exception 'papel_invalido' using errcode = '22023';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'validade_invalida' using errcode = '22023';
  end if;

  -- mesma fila das trocas de papel (abaixo): quem acabou de ser bloqueado não consegue
  -- criar um convite "no último segundo"; confere o papel de novo depois de esperar a vez
  perform pg_advisory_xact_lock(hashtextextended('orc.admin', 0));
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  v_code := public.make_invite_code();
  insert into public.invites (code, role, note, created_by, expires_at)
  values (v_code, p_role, left(nullif(btrim(coalesce(p_note, '')), ''), 120),
          auth.uid(), now() + make_interval(days => p_days));
  return v_code;
end
$$;

-- Admin: apaga um convite que ainda não foi usado.
create or replace function public.admin_revoke_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  delete from public.invites
   where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
     and used_at is null;
end
$$;

-- Admin: muda o papel de alguém (não pode rebaixar a si mesmo; nunca deixa o app sem admin).
-- Quem deixa de ser admin perde também os convites que criou e ainda não foram usados.
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'editor', 'leitor', 'bloqueado') then
    raise exception 'papel_invalido' using errcode = '22023';
  end if;
  if p_user = auth.uid() and p_role <> 'admin' then
    raise exception 'nao_pode_rebaixar_a_si_mesmo' using errcode = 'P0001';
  end if;

  -- uma troca de papel por vez no app inteiro: sem isto, dois admins que se bloqueiam ao
  -- mesmo tempo passariam cada um pela conferência "você é admin" e o app ficaria sem admin.
  -- Depois de esperar a vez, o papel de quem chamou é conferido de novo.
  perform pg_advisory_xact_lock(hashtextextended('orc.admin', 0));
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  update public.profiles set role = p_role where id = p_user;
  if not found then
    raise exception 'usuario_nao_encontrado' using errcode = 'P0002';
  end if;

  if p_role <> 'admin' then
    delete from public.invites where created_by = p_user and used_at is null;
  end if;

  if not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'ultimo_admin' using errcode = 'P0001';
  end if;
end
$$;

-- ─── Regras de acesso (RLS) ─────────────────────────────────────────────
alter table public.profiles        enable row level security;
alter table public.invites         enable row level security;
alter table public.invite_attempts enable row level security;
alter table public.budget_items    enable row level security;
alter table public.item_rates      enable row level security;
alter table public.budget_entries  enable row level security;
alter table public.budget_settled  enable row level security;
alter table public.app_settings    enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.app_role()) = 'admin');

drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select to authenticated
  using ((select public.app_role()) = 'admin');

-- budget_items / item_rates / budget_entries: todos com acesso leem; admin e editor alteram
drop policy if exists items_read on public.budget_items;
create policy items_read on public.budget_items for select to authenticated
  using ((select public.app_role()) in ('admin', 'editor', 'leitor'));
drop policy if exists items_write on public.budget_items;
create policy items_write on public.budget_items for all to authenticated
  using ((select public.app_role()) in ('admin', 'editor'))
  with check ((select public.app_role()) in ('admin', 'editor'));

drop policy if exists rates_read on public.item_rates;
create policy rates_read on public.item_rates for select to authenticated
  using ((select public.app_role()) in ('admin', 'editor', 'leitor'));
drop policy if exists rates_write on public.item_rates;
create policy rates_write on public.item_rates for all to authenticated
  using ((select public.app_role()) in ('admin', 'editor'))
  with check ((select public.app_role()) in ('admin', 'editor'));

drop policy if exists entries_read on public.budget_entries;
create policy entries_read on public.budget_entries for select to authenticated
  using ((select public.app_role()) in ('admin', 'editor', 'leitor'));
drop policy if exists entries_write on public.budget_entries;
create policy entries_write on public.budget_entries for all to authenticated
  using ((select public.app_role()) in ('admin', 'editor'))
  with check ((select public.app_role()) in ('admin', 'editor'));

-- budget_settled: todos com acesso leem; admin e editor marcam (insert) e desmarcam (delete).
-- Não existe "update": a marca nunca é editada, só criada ou apagada.
drop policy if exists settled_read on public.budget_settled;
create policy settled_read on public.budget_settled for select to authenticated
  using ((select public.app_role()) in ('admin', 'editor', 'leitor'));
drop policy if exists settled_insert on public.budget_settled;
create policy settled_insert on public.budget_settled for insert to authenticated
  with check ((select public.app_role()) in ('admin', 'editor'));
drop policy if exists settled_delete on public.budget_settled;
create policy settled_delete on public.budget_settled for delete to authenticated
  using ((select public.app_role()) in ('admin', 'editor'));

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to authenticated
  using ((select public.app_role()) in ('admin', 'editor', 'leitor'));
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings for update to authenticated
  using ((select public.app_role()) in ('admin', 'editor'))
  with check ((select public.app_role()) in ('admin', 'editor'));

-- ─── Permissões de tabela (segunda camada, além das regras acima) ───────
-- "service_role" (a chave secreta) também fica SEM permissão nas tabelas: se essa chave
-- vazar um dia, ela não lê as tabelas direto. (Mas ela ainda manda na API de usuários do
-- Supabase e poderia entrar como qualquer pessoa: se vazar, gire a chave na hora.)
-- O app nunca usa essa chave.
revoke all on public.profiles, public.invites, public.invite_attempts,
              public.budget_items, public.item_rates, public.budget_entries,
              public.budget_settled, public.app_settings
  from public, anon, authenticated, service_role;

-- O contador de tentativas só é usado por dentro das funções (que rodam como dono): ninguém
-- mais precisa tocar na sequência dele (no ambiente antigo do Supabase ela nasce aberta).
do $$
declare
  v_seq text := pg_get_serial_sequence('public.invite_attempts', 'id');
begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role', v_seq);
end
$$;

grant select on public.profiles, public.invites to authenticated;
grant select, insert, update, delete
  on public.budget_items, public.item_rates, public.budget_entries to authenticated;
grant select, insert, delete on public.budget_settled to authenticated;
grant select, update on public.app_settings to authenticated;

revoke all on function public.app_role()                               from public, anon, authenticated, service_role;
revoke all on function public.redeem_invite(text, text)                from public, anon, authenticated, service_role;
revoke all on function public.admin_create_invite(text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_revoke_invite(text)                from public, anon, authenticated, service_role;
revoke all on function public.admin_set_role(uuid, text)               from public, anon, authenticated, service_role;
revoke all on function public.make_invite_code()                       from public, anon, authenticated, service_role;
revoke all on function public.touch_updated_at()                       from public, anon, authenticated, service_role;
grant execute on function public.app_role()                          to authenticated;
grant execute on function public.redeem_invite(text, text)           to authenticated;
grant execute on function public.admin_create_invite(text, integer, text) to authenticated;
grant execute on function public.admin_revoke_invite(text)           to authenticated;
grant execute on function public.admin_set_role(uuid, text)          to authenticated;

-- ─── Convite inicial de admin (só se ainda não existir nenhum admin) ────
do $$
begin
  if not exists (select 1 from public.profiles where role = 'admin')
     and not exists (select 1 from public.invites
                      where role = 'admin' and used_at is null and expires_at > now()) then
    insert into public.invites (code, role, note, expires_at)
    values (public.make_invite_code(),
            'admin', 'Convite inicial de admin', now() + interval '2 days');
  end if;
end
$$;

-- ─── Conferência final: se algo estiver fora do combinado, cancela tudo ──
-- (roda dentro da mesma transação: se falhar, NADA deste arquivo é aplicado)
do $$
declare
  v_table text;
  v_priv  text;
  v_func  text;
  v_role  text;
  v_want  text[];
  v_has   boolean;
  v_bad   text;
  v_seq   text;
  v_tables constant text[] := array['profiles', 'invites', 'invite_attempts', 'budget_items',
                                    'item_rates', 'budget_entries', 'budget_settled', 'app_settings'];
  v_privs  constant text[] := array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];
  v_colprivs constant text[] := array['select', 'insert', 'update', 'references']; -- os que também existem por coluna
  v_funcs  constant text[] := array['public.app_role()', 'public.redeem_invite(text, text)',
                                    'public.admin_create_invite(text, integer, text)',
                                    'public.admin_revoke_invite(text)', 'public.admin_set_role(uuid, text)',
                                    'public.make_invite_code()', 'public.touch_updated_at()'];
  -- as 5 funções que o app chama (as únicas liberadas para quem está logado)
  v_app_funcs constant text[] := array['public.app_role()', 'public.redeem_invite(text, text)',
                                       'public.admin_create_invite(text, integer, text)',
                                       'public.admin_revoke_invite(text)', 'public.admin_set_role(uuid, text)'];
  v_policies constant text[] := array['profiles_select', 'invites_select', 'items_read', 'items_write',
                                      'rates_read', 'rates_write', 'entries_read', 'entries_write',
                                      'settled_read', 'settled_insert', 'settled_delete',
                                      'settings_read', 'settings_update'];
begin
  foreach v_table in array v_tables loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = ('public.' || v_table)::regclass) then
      raise exception 'VERIFICACAO_FALHOU: a tabela % esta sem RLS. Nada foi aplicado.', v_table;
    end if;
    -- o que "authenticated" pode fazer em cada tabela (o resto é bloqueado)
    v_want := case v_table
      when 'profiles'        then array['select']
      when 'invites'         then array['select']
      when 'invite_attempts' then array[]::text[]
      when 'app_settings'    then array['select', 'update']
      when 'budget_settled'  then array['select', 'insert', 'delete']
      else array['select', 'insert', 'update', 'delete'] end;
    foreach v_priv in array v_privs loop
      foreach v_role in array array['anon', 'service_role', 'authenticated'] loop
        -- permissão dada só a UMA coluna não aparece no teste da tabela inteira: por isso
        -- select/insert/update/references também são testados "em alguma coluna"
        v_has := case when v_priv = any (v_colprivs)
                      then pg_catalog.has_any_column_privilege(v_role, 'public.' || v_table, v_priv)
                      else pg_catalog.has_table_privilege(v_role, 'public.' || v_table, v_priv) end;
        if v_role = 'authenticated' then
          if v_has is distinct from (v_priv = any (v_want)) then
            raise exception 'VERIFICACAO_FALHOU: permissao de % para "authenticated" em % esta diferente do combinado. Nada foi aplicado.', v_priv, v_table;
          end if;
        elsif v_has then
          raise exception 'VERIFICACAO_FALHOU: "%" tem permissao de % em %. Nada foi aplicado.', v_role, v_priv, v_table;
        end if;
      end loop;
    end loop;
  end loop;

  -- regras de acesso (policies): só as deste arquivo. Uma regra antiga ou de um modelo do painel,
  -- como "using (true)", daria leitura a quem não tem convite.
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname) into v_bad
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename = any (v_tables) and p.policyname <> all (v_policies);
  if v_bad is not null then
    raise exception 'VERIFICACAO_FALHOU: regra(s) de acesso desconhecida(s) nas tabelas do app: %. Apague com "drop policy" e rode de novo. Nada foi aplicado.', v_bad;
  end if;

  -- sequência do contador de tentativas: ninguém além do dono mexe nela
  v_seq := pg_catalog.pg_get_serial_sequence('public.invite_attempts', 'id');
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
     and p.proname in ('app_role', 'redeem_invite', 'admin_create_invite', 'admin_revoke_invite',
                       'admin_set_role', 'make_invite_code', 'touch_updated_at')
     and p.oid not in (select pg_catalog.to_regprocedure(f)::oid from unnest(v_funcs) as f);
  if v_bad is not null then
    raise exception 'VERIFICACAO_FALHOU: funcao(oes) com nome deste app e argumentos diferentes: %. Apague com "drop function" e rode de novo. Nada foi aplicado.', v_bad;
  end if;

  -- nenhuma função do schema "public" (a API do Supabase publica tudo que está ali) pode ser
  -- executada por anon nem por service_role. (Funções que vieram de extensões ficam de fora.)
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_catalog.pg_depend d
                      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and (pg_catalog.has_function_privilege('anon', p.oid, 'execute')
          or pg_catalog.has_function_privilege('service_role', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'VERIFICACAO_FALHOU: anon ou service_role pode executar: %. Rode "revoke execute on function <nome> from public, anon, service_role;" e execute este arquivo de novo. Nada foi aplicado.', v_bad;
  end if;

  -- só as 5 funções que o app chama ficam liberadas para quem está logado
  foreach v_func in array v_funcs loop
    if pg_catalog.has_function_privilege('authenticated', v_func, 'execute') is distinct from (v_func = any (v_app_funcs)) then
      raise exception 'VERIFICACAO_FALHOU: permissao de execucao de % para "authenticated" esta diferente do combinado. Nada foi aplicado.', v_func;
    end if;
  end loop;
end
$$;

commit;

-- RESULTADO: copie o código abaixo (vale 2 dias; depois rode este arquivo de novo).
select substr(code, 1, 4) || '-' || substr(code, 5, 4) || '-' || substr(code, 9, 4)
         as convite_admin_inicial,
       expires_at as vale_ate
  from public.invites
 where role = 'admin' and used_at is null and expires_at > now()
 order by created_at desc
 limit 1;
