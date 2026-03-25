-- =============================================================
-- Seed: test user + default cloud workspace for local dev
-- =============================================================
-- Credentials: dev@syncagents.local / devpass123

-- 1. Test user in auth.users
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password,
  email_confirmed_at, aud, role,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'dev@syncagents.local',
  crypt('devpass123', gen_salt('bf')),
  now(), 'authenticated', 'authenticated',
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(), now(), ''
)
ON CONFLICT (id) DO NOTHING;

-- 2. Identity record (required for sign-in to work)
INSERT INTO auth.identities (
  id, user_id, provider_id, provider,
  identity_data, last_sign_in_at, created_at, updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'email',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-000000000001',
    'email', 'dev@syncagents.local'
  ),
  now(), now(), now()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

-- 3. Default cloud workspace owned by test user
INSERT INTO public.cloud_workspaces (id, name, created_by)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'Dev Workspace',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- 4. Owner membership
INSERT INTO public.workspace_members (cloud_workspace_id, user_id, role)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'owner'
)
ON CONFLICT (cloud_workspace_id, user_id) DO NOTHING;
