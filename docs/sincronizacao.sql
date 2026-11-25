-- Meu Financeiro: sincronização entre aparelhos (Supabase).
-- Cole este arquivo inteiro em SQL Editor > New query e clique em Run. Pode rodar mais de uma vez.
--
-- O que ele cria: uma tabela fechada (ninguém lê nem grava direto) e duas funções que o app chama.
-- O app só envia texto já criptografado no aparelho; o servidor não consegue ler nada.

create table if not exists public.sync_blobs (
  id         uuid primary key,
  data       text not null,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- Segurança em linha ligada e SEM nenhuma política: a chave pública não acessa a tabela diretamente.
alter table public.sync_blobs enable row level security;
revoke all on public.sync_blobs from anon, authenticated;

-- Lê o texto criptografado de um código de sincronização (o id é um UUID aleatório, impossível de adivinhar).
create or replace function public.mf_get(p_id uuid)
returns table (data text, version bigint)
language sql
security definer
set search_path = public
as $$
  select b.data, b.version from public.sync_blobs b where b.id = p_id;
$$;

-- Grava com controle de versão: devolve a nova versão, ou -1 se outro aparelho gravou antes (o app tenta de novo).
create or replace function public.mf_put(p_id uuid, p_data text, p_expected bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v bigint;
begin
  if length(p_data) > 8000000 then
    raise exception 'dados grandes demais';
  end if;
  if p_expected = 0 then
    insert into public.sync_blobs (id, data, version) values (p_id, p_data, 1)
    on conflict (id) do nothing;
    if found then return 1; end if;
    return -1;
  end if;
  update public.sync_blobs
     set data = p_data, version = version + 1, updated_at = now()
   where id = p_id and version = p_expected
  returning version into v;
  return coalesce(v, -1);
end;
$$;

revoke all on function public.mf_get(uuid) from public;
revoke all on function public.mf_put(uuid, text, bigint) from public;
grant execute on function public.mf_get(uuid) to anon;
grant execute on function public.mf_put(uuid, text, bigint) to anon;
