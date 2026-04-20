-- Milestone 9: Read-only session viewing
-- Restrict write access on chat_sessions/chat_messages/chat_attachments to the
-- session creator. SELECT remains open to any workspace member so non-owners
-- see sessions/messages as read-only snapshots.

-- chat_sessions: split the unified write policy into ownership-restricted
-- INSERT/UPDATE/DELETE.
drop policy if exists "members can write chat sessions" on public.chat_sessions;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_sessions' and policyname = 'members can insert chat sessions'
  ) then
    create policy "members can insert chat sessions"
      on public.chat_sessions
      for insert
      with check (
        public.is_workspace_member(cloud_workspace_id)
        and created_by = auth.uid()
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_sessions' and policyname = 'creators can update chat sessions'
  ) then
    create policy "creators can update chat sessions"
      on public.chat_sessions
      for update
      using (created_by = auth.uid())
      with check (created_by = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_sessions' and policyname = 'creators can delete chat sessions'
  ) then
    create policy "creators can delete chat sessions"
      on public.chat_sessions
      for delete
      using (created_by = auth.uid());
  end if;
end $$;

-- chat_messages: writes allowed only when caller owns the parent session.
drop policy if exists "members can write chat messages" on public.chat_messages;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_messages' and policyname = 'session creators can insert chat messages'
  ) then
    create policy "session creators can insert chat messages"
      on public.chat_messages
      for insert
      with check (
        exists (
          select 1
          from public.chat_sessions cs
          where cs.id = chat_messages.session_id
            and cs.created_by = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_messages' and policyname = 'session creators can update chat messages'
  ) then
    create policy "session creators can update chat messages"
      on public.chat_messages
      for update
      using (
        exists (
          select 1
          from public.chat_sessions cs
          where cs.id = chat_messages.session_id
            and cs.created_by = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.chat_sessions cs
          where cs.id = chat_messages.session_id
            and cs.created_by = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_messages' and policyname = 'session creators can delete chat messages'
  ) then
    create policy "session creators can delete chat messages"
      on public.chat_messages
      for delete
      using (
        exists (
          select 1
          from public.chat_sessions cs
          where cs.id = chat_messages.session_id
            and cs.created_by = auth.uid()
        )
      );
  end if;
end $$;

-- chat_attachments: mirror chat_messages (writes gated on session ownership).
drop policy if exists "members can write chat attachments" on public.chat_attachments;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_attachments' and policyname = 'session creators can insert chat attachments'
  ) then
    create policy "session creators can insert chat attachments"
      on public.chat_attachments
      for insert
      with check (
        exists (
          select 1
          from public.chat_sessions cs
          where cs.id = chat_attachments.session_id
            and cs.created_by = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_attachments' and policyname = 'session creators can update chat attachments'
  ) then
    create policy "session creators can update chat attachments"
      on public.chat_attachments
      for update
      using (
        exists (
          select 1
          from public.chat_sessions cs
          where cs.id = chat_attachments.session_id
            and cs.created_by = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.chat_sessions cs
          where cs.id = chat_attachments.session_id
            and cs.created_by = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_attachments' and policyname = 'session creators can delete chat attachments'
  ) then
    create policy "session creators can delete chat attachments"
      on public.chat_attachments
      for delete
      using (
        exists (
          select 1
          from public.chat_sessions cs
          where cs.id = chat_attachments.session_id
            and cs.created_by = auth.uid()
        )
      );
  end if;
end $$;

-- Resolve workspace members with emails. Runs as definer so it can read
-- auth.users, but only returns rows when the caller is a member of the
-- workspace (self-gated via is_workspace_member).
create or replace function public.workspace_member_emails(workspace_id uuid)
returns table(user_id uuid, email text, role text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select wm.user_id, u.email::text, wm.role
  from public.workspace_members wm
  left join auth.users u on u.id = wm.user_id
  where wm.cloud_workspace_id = workspace_id
    and public.is_workspace_member(workspace_id);
$$;

grant execute on function public.workspace_member_emails(uuid) to authenticated;

-- Storage objects: tighten chat-attachments writes to session creators.
-- Layout: {cloud_workspace_id}/{session_id}/{attachment_id}
drop policy if exists "workspace members can upload chat attachments" on storage.objects;
drop policy if exists "workspace members can update chat attachments" on storage.objects;
drop policy if exists "workspace members can delete chat attachments" on storage.objects;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'session creators can upload chat attachments'
  ) then
    create policy "session creators can upload chat attachments"
      on storage.objects
      for insert
      with check (
        bucket_id = 'chat-attachments'
        and exists (
          select 1
          from public.chat_sessions cs
          where cs.id = split_part(name, '/', 2)
            and cs.cloud_workspace_id::text = split_part(name, '/', 1)
            and cs.created_by = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'session creators can update chat attachments'
  ) then
    create policy "session creators can update chat attachments"
      on storage.objects
      for update
      using (
        bucket_id = 'chat-attachments'
        and exists (
          select 1
          from public.chat_sessions cs
          where cs.id = split_part(name, '/', 2)
            and cs.cloud_workspace_id::text = split_part(name, '/', 1)
            and cs.created_by = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'session creators can delete chat attachments'
  ) then
    create policy "session creators can delete chat attachments"
      on storage.objects
      for delete
      using (
        bucket_id = 'chat-attachments'
        and exists (
          select 1
          from public.chat_sessions cs
          where cs.id = split_part(name, '/', 2)
            and cs.cloud_workspace_id::text = split_part(name, '/', 1)
            and cs.created_by = auth.uid()
        )
      );
  end if;
end $$;
