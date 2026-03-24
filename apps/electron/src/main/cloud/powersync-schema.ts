import { Schema, Table, column } from '@powersync/common'

const cloud_workspaces = new Table({
  name: column.text,
  created_by: column.text,
  created_at: column.text,
})

const workspace_members = new Table({
  cloud_workspace_id: column.text,
  user_id: column.text,
  role: column.text,
  created_at: column.text,
})

const chat_sessions = new Table({
  cloud_workspace_id: column.text,
  name: column.text,
  created_by: column.text,
  archived: column.integer, // boolean stored as 0/1
  created_at: column.text,
  updated_at: column.text,
}, {
  indexes: {
    by_workspace: ['cloud_workspace_id'],
  },
})

const chat_messages = new Table({
  cloud_workspace_id: column.text,
  session_id: column.text,
  role: column.text,
  content: column.text, // JSON stringified
  turn_id: column.text,
  created_at: column.text,
}, {
  indexes: {
    by_session: ['session_id'],
  },
})

const chat_attachments = new Table({
  cloud_workspace_id: column.text,
  session_id: column.text,
  message_id: column.text,
  storage_bucket: column.text,
  object_path: column.text,
  mime_type: column.text,
  size_bytes: column.integer,
  checksum_sha256: column.text,
  created_at: column.text,
}, {
  indexes: {
    by_session: ['session_id'],
    by_message: ['message_id'],
  },
})

export const AppSchema = new Schema({
  cloud_workspaces,
  workspace_members,
  chat_sessions,
  chat_messages,
  chat_attachments,
})
