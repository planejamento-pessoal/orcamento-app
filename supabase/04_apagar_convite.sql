-- ════════════════════════════════════════════════════════════════════════
--  ORÇAMENTO — apagar convite já usado ou vencido (versão 1.6.0)
--
--  RODE DEPOIS do 01_schema.sql (uma vez só; pode rodar de novo sem medo):
--   Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
--
--  O QUE ISTO FAZ
--   Cria UMA função nova, admin_delete_invite(código): só admin chama; apaga o registro de um
--   convite em qualquer situação (ainda valendo, vencido ou já usado). Serve para limpar a lista
--   de convites da aba Conta (por exemplo, um convite de teste que já foi usado e não saía da lista).
--
--  O QUE ISTO NÃO FAZ
--   • NÃO mexe em pessoas nem em acessos: quem entrou com o convite CONTINUA com o acesso (o
--     acesso fica na conta da pessoa, em "profiles", não no convite). Só some o registro do convite.
--   • NÃO mexe em valores: saldo inicial, conta corrente (carry_over), lançamentos, despesas,
--     receitas, fechamentos e itens continuam exatamente como estão.
--   • NÃO muda tabelas, permissões de tabela nem regras de acesso (RLS). A função antiga,
--     admin_revoke_invite, continua igual (só apaga convite que ainda não foi usado).
--   • NÃO é obrigatório: sem ele o app funciona como antes; só não consegue apagar convite já
--     usado (o app avisa e manda rodar este arquivo).
--   • Versões anteriores do app continuam funcionando com a função nova (elas nem sabem dela).
--
--  SE VOCÊ CRIAR FUNÇÕES NOVAS no schema "public": veja o aviso no fim do cabeçalho do 01_schema.sql.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── Confere que o 01_schema.sql já foi rodado (sem ele nada aqui faz sentido) ──
do $$
begin
  if pg_catalog.to_regclass('public.invites') is null
     or pg_catalog.to_regprocedure('public.app_role()') is null
     or pg_catalog.to_regprocedure('public.admin_revoke_invite(text)') is null then
    raise exception 'RODE_O_01_ANTES: rode o 01_schema.sql e depois este arquivo. Nada foi aplicado.';
  end if;
end
$$;

-- ─── A função ───────────────────────────────────────────────────────────
-- Admin: apaga um convite (qualquer situação). Não mexe em quem usou o convite.
create or replace function public.admin_delete_invite(p_code text)
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
   where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
end
$$;

-- Toda função nova nasce executável por "public" (= todo mundo): fecha e abre só para quem está logado.
revoke all on function public.admin_delete_invite(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_invite(text) to authenticated;

-- ─── Conferência final: se algo estiver fora do combinado, cancela tudo ──
-- (roda dentro da mesma transação: se falhar, NADA deste arquivo é aplicado)
do $$
declare
  v_f   constant text := 'public.admin_delete_invite(text)';
  v_bad text;
begin
  -- a função: existe, devolve "nada", roda como dono (security definer) e com o caminho de busca vazio
  if not exists (select 1 from pg_catalog.pg_proc p
                  where p.oid = pg_catalog.to_regprocedure(v_f)::oid
                    and p.prosecdef
                    and p.prorettype = 'pg_catalog.void'::regtype
                    and exists (select 1 from unnest(p.proconfig) c
                                 where c like 'search_path=%'
                                   and replace(replace(substr(c, 13), '"', ''), '''', '') = '')) then
    raise exception 'VERIFICACAO_FALHOU: admin_delete_invite nao esta como combinado (security definer, search_path vazio). Nada foi aplicado.';
  end if;

  -- quem pode executar: só quem está logado ("anon", "service_role" e "public" não)
  if not pg_catalog.has_function_privilege('authenticated', v_f, 'execute') then
    raise exception 'VERIFICACAO_FALHOU: "authenticated" nao pode executar admin_delete_invite. Nada foi aplicado.';
  end if;
  if pg_catalog.has_function_privilege('anon', v_f, 'execute')
     or pg_catalog.has_function_privilege('service_role', v_f, 'execute') then
    raise exception 'VERIFICACAO_FALHOU: anon ou service_role pode executar admin_delete_invite. Nada foi aplicado.';
  end if;

  -- mesma regra do 01_schema.sql: nenhuma função do schema "public" executável por anon nem por service_role
  -- (ficam de fora funções de extensões e de gatilho, que a API não consegue chamar)
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

  -- a tabela de convites continua com RLS e só com a regra de leitura do 01
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.invites'::regclass) then
    raise exception 'VERIFICACAO_FALHOU: a tabela invites esta sem RLS. Nada foi aplicado.';
  end if;
end
$$;

commit;

-- RESULTADO: se a linha abaixo apareceu, deu tudo certo.
select 'ok' as apagar_convite_instalado,
       (select count(*) from public.invites) as convites_na_lista;
