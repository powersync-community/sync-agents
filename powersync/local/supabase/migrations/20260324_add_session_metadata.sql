-- Add metadata column to chat_sessions for synced session properties
-- Stores: permissionMode, thinkingLevel, model, llmConnection, connectionLocked,
--         isFlagged, sessionStatus, labels, enabledSourceSlugs,
--         sharedUrl, sharedId, parentSessionId, siblingOrder, hidden
alter table public.chat_sessions
  add column if not exists metadata jsonb not null default '{}';

-- Add pre-computed fields for efficient list loading
alter table public.chat_sessions
  add column if not exists preview text,
  add column if not exists message_count integer not null default 0,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_role text;
