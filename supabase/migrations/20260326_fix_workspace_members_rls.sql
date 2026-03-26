-- Fix workspace_members RLS to avoid infinite recursion.
-- Both the old SELECT and INSERT policies query workspace_members itself,
-- triggering the SELECT policy recursively → "stack depth limit exceeded".
--
-- Fix: use SECURITY DEFINER helper that bypasses RLS for the membership check,
-- and simplify policies to avoid self-referential queries.

-- Also fix is_workspace_member() used by all other tables — must be SECURITY DEFINER
-- to avoid triggering workspace_members SELECT policy recursively
create or replace function public.is_workspace_member(workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.cloud_workspace_id = workspace_id
      and wm.user_id = auth.uid()
  );
$$;

-- Drop old policies
drop policy if exists "members can read workspace members" on public.workspace_members;
drop policy if exists "owner can insert membership" on public.workspace_members;

-- Helper: check membership without triggering RLS (SECURITY DEFINER bypasses RLS)
create or replace function public.check_membership(ws_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where cloud_workspace_id = ws_id and user_id = uid
  );
$$;

-- SELECT: a user can see all members of workspaces they belong to
create policy "members can read workspace members"
  on public.workspace_members
  for select
  using (public.check_membership(cloud_workspace_id, auth.uid()));

-- INSERT: workspace owner can add members, OR user can add themselves (self-join)
create policy "owner can insert membership"
  on public.workspace_members
  for insert
  with check (
    public.check_membership(cloud_workspace_id, auth.uid())
    or auth.uid() = user_id
  );
