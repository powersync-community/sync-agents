create extension if not exists pgcrypto;

create table if not exists public.cloud_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  cloud_workspace_id uuid not null references public.cloud_workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (cloud_workspace_id, user_id)
);

create table if not exists public.chat_sessions (
  id text primary key,
  cloud_workspace_id uuid not null references public.cloud_workspaces(id) on delete cascade,
  name text,
  created_by uuid not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id text primary key,
  cloud_workspace_id uuid not null references public.cloud_workspaces(id) on delete cascade,
  session_id text not null references public.chat_sessions(id) on delete cascade,
  role text not null,
  content jsonb not null,
  turn_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_attachments (
  id text primary key,
  cloud_workspace_id uuid not null references public.cloud_workspaces(id) on delete cascade,
  session_id text not null references public.chat_sessions(id) on delete cascade,
  message_id text not null references public.chat_messages(id) on delete cascade,
  storage_bucket text not null default 'chat-attachments',
  object_path text not null,
  mime_type text,
  size_bytes bigint,
  checksum_sha256 text,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_members_user on public.workspace_members(user_id);
create index if not exists idx_chat_sessions_workspace on public.chat_sessions(cloud_workspace_id);
create index if not exists idx_chat_messages_workspace on public.chat_messages(cloud_workspace_id);
create index if not exists idx_chat_messages_session_created on public.chat_messages(session_id, created_at);
create index if not exists idx_chat_attachments_workspace on public.chat_attachments(cloud_workspace_id);

alter table public.cloud_workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_attachments enable row level security;

create or replace function public.is_workspace_member(workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.cloud_workspace_id = workspace_id
      and wm.user_id = auth.uid()
  );
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cloud_workspaces' and policyname = 'members can read workspaces'
  ) then
    create policy "members can read workspaces"
      on public.cloud_workspaces
      for select
      using (public.is_workspace_member(id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cloud_workspaces' and policyname = 'authenticated users can create workspaces'
  ) then
    create policy "authenticated users can create workspaces"
      on public.cloud_workspaces
      for insert
      with check (auth.uid() = created_by);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'workspace_members' and policyname = 'members can read workspace members'
  ) then
    create policy "members can read workspace members"
      on public.workspace_members
      for select
      using (public.is_workspace_member(cloud_workspace_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'workspace_members' and policyname = 'owner can insert membership'
  ) then
    create policy "owner can insert membership"
      on public.workspace_members
      for insert
      with check (
        exists (
          select 1
          from public.workspace_members owner_row
          where owner_row.cloud_workspace_id = workspace_members.cloud_workspace_id
            and owner_row.user_id = auth.uid()
            and owner_row.role = 'owner'
        )
        or auth.uid() = user_id
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_sessions' and policyname = 'members can read chat sessions'
  ) then
    create policy "members can read chat sessions"
      on public.chat_sessions
      for select
      using (public.is_workspace_member(cloud_workspace_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_sessions' and policyname = 'members can write chat sessions'
  ) then
    create policy "members can write chat sessions"
      on public.chat_sessions
      for all
      using (public.is_workspace_member(cloud_workspace_id))
      with check (public.is_workspace_member(cloud_workspace_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_messages' and policyname = 'members can read chat messages'
  ) then
    create policy "members can read chat messages"
      on public.chat_messages
      for select
      using (public.is_workspace_member(cloud_workspace_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_messages' and policyname = 'members can write chat messages'
  ) then
    create policy "members can write chat messages"
      on public.chat_messages
      for all
      using (public.is_workspace_member(cloud_workspace_id))
      with check (public.is_workspace_member(cloud_workspace_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_attachments' and policyname = 'members can read chat attachments'
  ) then
    create policy "members can read chat attachments"
      on public.chat_attachments
      for select
      using (public.is_workspace_member(cloud_workspace_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_attachments' and policyname = 'members can write chat attachments'
  ) then
    create policy "members can write chat attachments"
      on public.chat_attachments
      for all
      using (public.is_workspace_member(cloud_workspace_id))
      with check (public.is_workspace_member(cloud_workspace_id));
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

do $$
begin
  if to_regclass('public.workspace_members') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'workspace members can read chat attachments'
    ) then
      create policy "workspace members can read chat attachments"
        on storage.objects
        for select
        using (
          bucket_id = 'chat-attachments'
          and exists (
            select 1
            from public.workspace_members wm
            where wm.cloud_workspace_id::text = split_part(name, '/', 1)
              and wm.user_id = auth.uid()
          )
        );
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.workspace_members') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'workspace members can upload chat attachments'
    ) then
      create policy "workspace members can upload chat attachments"
        on storage.objects
        for insert
        with check (
          bucket_id = 'chat-attachments'
          and exists (
            select 1
            from public.workspace_members wm
            where wm.cloud_workspace_id::text = split_part(name, '/', 1)
              and wm.user_id = auth.uid()
          )
        );
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.workspace_members') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'workspace members can update chat attachments'
    ) then
      create policy "workspace members can update chat attachments"
        on storage.objects
        for update
        using (
          bucket_id = 'chat-attachments'
          and exists (
            select 1
            from public.workspace_members wm
            where wm.cloud_workspace_id::text = split_part(name, '/', 1)
              and wm.user_id = auth.uid()
          )
        );
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.workspace_members') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'workspace members can delete chat attachments'
    ) then
      create policy "workspace members can delete chat attachments"
        on storage.objects
        for delete
        using (
          bucket_id = 'chat-attachments'
          and exists (
            select 1
            from public.workspace_members wm
            where wm.cloud_workspace_id::text = split_part(name, '/', 1)
              and wm.user_id = auth.uid()
          )
        );
    end if;
  end if;
end $$;

drop publication if exists powersync;
create publication powersync for table
  public.cloud_workspaces,
  public.workspace_members,
  public.chat_sessions,
  public.chat_messages,
  public.chat_attachments;
