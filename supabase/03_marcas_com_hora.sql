-- ════════════════════════════════════════════════════════════════════════
--  ORÇAMENTO — hora das marcas "pago / recebido" (versão 1.5.0)
--
--  RODE DEPOIS do 01_schema.sql (uma vez só; pode rodar de novo sem medo):
--   Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
--
--  O QUE ISTO FAZ
--   Cada marca "pago / recebido" passa a guardar também a HORA em que foi feita (coluna settled_at,
--   hora do servidor, não a do celular). O app usa essa hora para saber se a marca já está dentro do
--   saldo que a 99Pay informou ou se foi feita DEPOIS daquela leitura (e então o item ainda conta
--   como "a pagar / a receber" até a próxima leitura). Sem a hora, marcar um item faria a sobra
--   do mês pular antes de o banco atualizar.
--
--  O QUE ISTO NÃO FAZ
--   • NÃO muda nenhuma marca que já existe: as marcas antigas ficam SEM hora (o app as trata como
--     "já está no saldo"). A conferência no fim cancela tudo se alguma marca antiga ganhar hora.
--   • NÃO mexe em valores: saldo inicial, conta corrente (carry_over), lançamentos, despesas,
--     receitas, fechamentos e itens continuam exatamente como estão.
--   • NÃO muda permissões nem regras de acesso: continua valendo "todos com acesso leem; admin e
--     editor marcam e desmarcam; ninguém edita uma marca" (e anon/service_role não podem nada).
--   • NÃO é obrigatório para o app funcionar: sem esta coluna o app 1.5.0 volta a calcular como a
--     1.4.0 (a conta corrente continua sendo o saldo que você digita).
--   • A versão 1.4.0 do app continua funcionando com a coluna (ela nem sabe que existe): voltar
--     para a 1.4.0 NÃO exige desfazer nada aqui.
--
--  SE VOCÊ CRIAR FUNÇÕES NOVAS no schema "public": veja o aviso no fim do cabeçalho do 01_schema.sql.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── Confere que o 01_schema.sql já foi rodado (sem ele nada aqui faz sentido) ──
do $$
begin
  if pg_catalog.to_regclass('public.budget_settled') is null
     or pg_catalog.to_regprocedure('public.app_role()') is null then
    raise exception 'RODE_O_01_ANTES: rode o 01_schema.sql e depois este arquivo. Nada foi aplicado.';
  end if;
end
$$;

-- ─── A coluna ───────────────────────────────────────────────────────────
-- Passo 1: cria a coluna SEM valor padrão. Assim as marcas que já existem ficam vazias (sem hora).
--          (Se o padrão "agora" fosse dado já na criação, o Postgres carimbaria TODAS as marcas
--           antigas com a hora de agora, e o app passaria a achar que foram feitas hoje.)
-- Passo 2: só depois liga o padrão "agora": vale apenas para as marcas feitas daqui em diante.
--          O app não precisa mandar a hora: quem carimba é o servidor.
do $$
declare
  v_nova boolean;
begin
  v_nova := not exists (select 1 from pg_catalog.pg_attribute a
                         where a.attrelid = 'public.budget_settled'::regclass
                           and a.attname = 'settled_at' and not a.attisdropped);

  alter table public.budget_settled add column if not exists settled_at timestamptz;
  alter table public.budget_settled alter column settled_at set default now();
  comment on column public.budget_settled.settled_at is
    'Hora (do servidor) em que a marca pago/recebido foi feita. Vazio = marca antiga, de antes da versão 1.5.0.';

  -- se a coluna acabou de ser criada, NENHUMA marca antiga pode ter ganhado hora
  if v_nova and exists (select 1 from public.budget_settled where settled_at is not null) then
    raise exception 'VERIFICACAO_FALHOU: marcas antigas ganharam hora ao criar a coluna settled_at. Nada foi aplicado.';
  end if;
end
$$;

-- ─── Conferência final: se algo estiver fora do combinado, cancela tudo ──
-- (roda dentro da mesma transação: se falhar, NADA deste arquivo é aplicado)
do $$
declare
  v_priv text;
  v_role text;
  v_has  boolean;
  v_bad  text;
begin
  -- a coluna: tipo certo, aceita vazio (marcas antigas) e o padrão é "agora"
  if not exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = 'public.budget_settled'::regclass and a.attname = 'settled_at'
                    and a.atttypid = 'pg_catalog.timestamptz'::regtype and not a.attnotnull and not a.attisdropped) then
    raise exception 'VERIFICACAO_FALHOU: a coluna budget_settled.settled_at nao esta como combinado (timestamptz, aceita vazio). Nada foi aplicado.';
  end if;
  if not exists (select 1 from pg_catalog.pg_attrdef d
                   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                  where d.adrelid = 'public.budget_settled'::regclass and a.attname = 'settled_at'
                    and pg_catalog.pg_get_expr(d.adbin, d.adrelid) in ('now()', 'CURRENT_TIMESTAMP', 'transaction_timestamp()')) then
    raise exception 'VERIFICACAO_FALHOU: o padrao da coluna settled_at nao e "agora". Nada foi aplicado.';
  end if;

  -- permissões da tabela exatamente como no 01: "authenticated" lê, marca e desmarca (nunca edita);
  -- "anon" e "service_role" não podem nada. (select/insert/update/references também são testados
  -- "em alguma coluna", porque permissão dada a uma coluna só não aparece no teste da tabela inteira.)
  foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    foreach v_role in array array['anon', 'service_role', 'authenticated'] loop
      v_has := case when v_priv in ('select', 'insert', 'update', 'references')
                    then pg_catalog.has_any_column_privilege(v_role, 'public.budget_settled', v_priv)
                    else pg_catalog.has_table_privilege(v_role, 'public.budget_settled', v_priv) end;
      if v_role = 'authenticated' then
        if v_has is distinct from (v_priv in ('select', 'insert', 'delete')) then
          raise exception 'VERIFICACAO_FALHOU: permissao de % para "authenticated" em budget_settled esta diferente do combinado. Nada foi aplicado.', v_priv;
        end if;
      elsif v_has then
        raise exception 'VERIFICACAO_FALHOU: "%" tem permissao de % em budget_settled. Nada foi aplicado.', v_role, v_priv;
      end if;
    end loop;
  end loop;

  -- permissão de coluna sozinha também não pode existir para "update" (a marca nunca é editada)
  select string_agg(a.attname, ', ' order by a.attname) into v_bad
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.budget_settled'::regclass and a.attnum > 0 and not a.attisdropped
     and (pg_catalog.has_column_privilege('authenticated', 'public.budget_settled', a.attname, 'update')
          or pg_catalog.has_column_privilege('anon', 'public.budget_settled', a.attname, 'select')
          or pg_catalog.has_column_privilege('service_role', 'public.budget_settled', a.attname, 'select'));
  if v_bad is not null then
    raise exception 'VERIFICACAO_FALHOU: permissao de coluna fora do combinado em budget_settled (%). Nada foi aplicado.', v_bad;
  end if;

  -- a tabela continua com RLS e só com as 3 regras do 01
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.budget_settled'::regclass) then
    raise exception 'VERIFICACAO_FALHOU: a tabela budget_settled esta sem RLS. Nada foi aplicado.';
  end if;
  select string_agg(p.policyname, ', ' order by p.policyname) into v_bad
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename = 'budget_settled'
     and p.policyname not in ('settled_read', 'settled_insert', 'settled_delete');
  if v_bad is not null then
    raise exception 'VERIFICACAO_FALHOU: regra(s) de acesso desconhecida(s) em budget_settled: %. Apague com "drop policy" e rode de novo. Nada foi aplicado.', v_bad;
  end if;
  if (select count(*) from pg_catalog.pg_policies p
       where p.schemaname = 'public' and p.tablename = 'budget_settled'
         and p.policyname in ('settled_read', 'settled_insert', 'settled_delete')) <> 3 then
    raise exception 'VERIFICACAO_FALHOU: faltam regras de acesso em budget_settled (rode o 01_schema.sql de novo). Nada foi aplicado.';
  end if;
end
$$;

commit;

-- RESULTADO: se a linha abaixo apareceu, deu tudo certo.
-- (marcas_antigas_sem_hora = as marcas de antes desta versão; o app as trata como "já está no saldo")
select 'ok' as marcas_com_hora_instaladas,
       (select count(*) from public.budget_settled) as marcas,
       (select count(*) from public.budget_settled where settled_at is null) as marcas_antigas_sem_hora;
