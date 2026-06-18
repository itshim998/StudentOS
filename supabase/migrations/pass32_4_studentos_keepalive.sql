-- StudentOS Pass 32.4 Supabase keepalive table.
-- Apply this migration to all four Supabase projects:
-- Project 1 Auth, Project 2 Data Shard 1, Project 3 Data Shard 2, Project 4 Data Shard 3.

create table if not exists public.studentos_keepalive (
  id smallint primary key default 1,
  name text not null default 'studentos-keepalive',
  created_at timestamptz not null default now(),
  constraint studentos_keepalive_fixed_id check (id = 1),
  constraint studentos_keepalive_fixed_name check (name = 'studentos-keepalive')
);

insert into public.studentos_keepalive (id, name)
values (1, 'studentos-keepalive')
on conflict (id) do nothing;

alter table public.studentos_keepalive enable row level security;

revoke all on table public.studentos_keepalive from public;
revoke all on table public.studentos_keepalive from anon;
revoke all on table public.studentos_keepalive from authenticated;

grant select (id, name) on table public.studentos_keepalive to anon;

drop policy if exists studentos_keepalive_anon_select_fixed_row on public.studentos_keepalive;

create policy studentos_keepalive_anon_select_fixed_row
  on public.studentos_keepalive
  for select
  to anon
  using (id = 1 and name = 'studentos-keepalive');
