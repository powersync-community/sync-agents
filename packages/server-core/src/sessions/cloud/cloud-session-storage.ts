import { randomUUID } from 'crypto'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { PowerSyncDatabase } from '@powersync/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  SessionConfig,
  SessionMetadata,
  StoredSession,
  StoredMessage,
  SessionTokenUsage,
} from '@craft-agent/shared/sessions/types'
import {
  loadLocalState,
  saveLocalState,
  deleteLocalState,
  type SessionLocalState,
} from './session-sidecar'

const DEFAULT_TOKEN_USAGE: SessionTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  contextTokens: 0,
  costUsd: 0,
}

// Parse a jsonb-sourced text column. Existing rows uploaded before the
// connector's jsonb-object fix were stored as jsonb string primitives and sync
// down double-encoded (`"{\"id\":...}"`) — unwrap that extra layer so old data
// still renders.
function parseJsonbText<T = any>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw as T
  try {
    const first = JSON.parse(raw)
    return typeof first === 'string' ? JSON.parse(first) : first
  } catch {
    return fallback
  }
}

/**
 * Synced metadata fields stored in the `metadata` jsonb column of `chat_sessions`.
 * These are session properties visible to all teammates.
 */
interface SyncedSessionMetadata {
  thinkingLevel?: string
  model?: string
  llmConnection?: string
  connectionLocked?: boolean
  isFlagged?: boolean
  sessionStatus?: string
  labels?: string[]
  enabledSourceSlugs?: string[]
  sharedUrl?: string
  sharedId?: string
  parentSessionId?: string
  siblingOrder?: number
  hidden?: boolean
}

const SYNCED_METADATA_KEYS: (keyof SyncedSessionMetadata)[] = [
  'thinkingLevel', 'model', 'llmConnection', 'connectionLocked',
  'isFlagged', 'sessionStatus', 'labels', 'enabledSourceSlugs',
  'sharedUrl', 'sharedId', 'parentSessionId', 'siblingOrder', 'hidden',
]

/**
 * Cloud session storage adapter.
 * Reads/writes through PowerSync SQLite (synced) + local sidecar JSON (per-device).
 */
export class CloudSessionStorage {
  constructor(
    private db: PowerSyncDatabase,
    private supabase: SupabaseClient,
    private cloudWorkspaceId: string,
    private workspaceRootPath: string,
    private userId: string,
    private hasSyncedFn: () => boolean,
  ) {}

  /**
   * List all sessions for this workspace.
   * Uses PowerSync SQLite when synced, falls back to Supabase direct query.
   */
  async listSessions(): Promise<SessionMetadata[]> {
    let rows: any[]

    if (this.hasSyncedFn()) {
      rows = await this.db.getAll(
        'SELECT * FROM chat_sessions WHERE cloud_workspace_id = ? ORDER BY updated_at DESC',
        [this.cloudWorkspaceId]
      )
    } else {
      const { data } = await this.supabase
        .from('chat_sessions')
        .select('*')
        .eq('cloud_workspace_id', this.cloudWorkspaceId)
        .order('updated_at', { ascending: false })
      rows = data ?? []
    }

    return rows.map(row => this.rowToSessionMetadata(row))
  }

  /**
   * Load a full session with messages.
   */
  async loadSession(sessionId: string): Promise<StoredSession | null> {
    const session = await this.db.getOptional(
      'SELECT * FROM chat_sessions WHERE id = ?',
      [sessionId]
    )
    if (!session) return null

    const messageRows = await this.db.getAll(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    )

    const localState = loadLocalState(this.workspaceRootPath, sessionId)
    return this.assembleStoredSession(session, messageRows, localState)
  }

  /**
   * Create a new session.
   * Writes to PowerSync SQLite (uploaded to Supabase via connector).
   */
  async createSession(options?: {
    name?: string
    workingDirectory?: string
    permissionMode?: string
    enabledSourceSlugs?: string[]
    model?: string
    hidden?: boolean
    sessionStatus?: string
    labels?: string[]
    isFlagged?: boolean
  }): Promise<SessionConfig> {
    const id = randomUUID()
    const now = new Date().toISOString()

    // Build synced metadata from options
    const metadata: SyncedSessionMetadata = {}
    if (options?.model) metadata.model = options.model
    if (options?.enabledSourceSlugs) metadata.enabledSourceSlugs = options.enabledSourceSlugs
    if (options?.hidden) metadata.hidden = options.hidden
    if (options?.sessionStatus) metadata.sessionStatus = options.sessionStatus
    if (options?.labels) metadata.labels = options.labels
    if (options?.isFlagged) metadata.isFlagged = options.isFlagged

    await this.db.execute(
      `INSERT INTO chat_sessions (id, cloud_workspace_id, name, created_by, archived, created_at, updated_at, metadata, message_count)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0)`,
      [id, this.cloudWorkspaceId, options?.name ?? null, this.userId, now, now, JSON.stringify(metadata)]
    )

    // Ensure session directory exists for local sidecar and attachments
    const sessionDir = join(this.workspaceRootPath, 'sessions', id)
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true })
    }

    // Initialize local sidecar with per-device fields
    const sdkCwd = options?.workingDirectory ?? sessionDir
    const localState: SessionLocalState = {
      sdkCwd,
      workingDirectory: options?.workingDirectory,
      permissionMode: options?.permissionMode,
    }
    saveLocalState(this.workspaceRootPath, id, localState)

    const nowMs = new Date(now).getTime()
    return {
      id,
      workspaceRootPath: this.workspaceRootPath,
      name: options?.name,
      createdAt: nowMs,
      lastUsedAt: nowMs,
      sdkCwd,
      workingDirectory: options?.workingDirectory,
      permissionMode: options?.permissionMode as any,
      enabledSourceSlugs: options?.enabledSourceSlugs,
      model: options?.model,
      hidden: options?.hidden,
      sessionStatus: options?.sessionStatus,
      labels: options?.labels,
      isFlagged: options?.isFlagged,
      createdBy: this.userId,
    }
  }

  /**
   * Save/persist a full session (called after message processing).
   * Updates session metadata + upserts messages.
   */
  async saveSession(session: StoredSession): Promise<void> {
    const now = new Date().toISOString()
    const metadata = this.extractSyncedMetadata(session)

    // Update session row (synced fields)
    await this.db.execute(
      `UPDATE chat_sessions SET
        name = ?, archived = ?, updated_at = ?, metadata = ?,
        preview = ?, message_count = ?, last_message_at = ?, last_message_role = ?
       WHERE id = ?`,
      [
        session.name ?? null,
        session.isArchived ? 1 : 0,
        now,
        JSON.stringify(metadata),
        this.extractPreview(session.messages),
        session.messages.length,
        session.lastMessageAt ? new Date(session.lastMessageAt).toISOString() : null,
        this.getLastMessageRole(session.messages),
        session.id,
      ]
    )

    // Upsert messages
    for (const msg of session.messages) {
      await this.db.execute(
        `INSERT OR REPLACE INTO chat_messages (id, cloud_workspace_id, session_id, role, content, turn_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          msg.id,
          this.cloudWorkspaceId,
          session.id,
          msg.type,
          JSON.stringify(msg),
          (msg as any).turnId ?? null,
          msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
        ]
      )
    }

    // Save local-only state
    saveLocalState(this.workspaceRootPath, session.id, {
      sdkCwd: session.sdkCwd,
      workingDirectory: session.workingDirectory,
      sdkSessionId: session.sdkSessionId,
      tokenUsage: session.tokenUsage,
      lastReadMessageId: session.lastReadMessageId,
      hasUnread: session.hasUnread,
      lastFinalMessageId: (session as any).lastFinalMessageId,
      pendingPlanExecution: session.pendingPlanExecution,
      permissionMode: session.permissionMode,
    })
  }

  /**
   * Update session metadata fields.
   * Routes each field to synced (PowerSync) or local (sidecar) storage.
   */
  async updateMetadata(sessionId: string, updates: Partial<SessionConfig>): Promise<void> {
    // Direct column updates
    const directUpdates: string[] = []
    const directValues: any[] = []
    if ('name' in updates) { directUpdates.push('name = ?'); directValues.push(updates.name ?? null) }
    if ('isArchived' in updates) { directUpdates.push('archived = ?'); directValues.push(updates.isArchived ? 1 : 0) }
    if ('archivedAt' in updates && updates.archivedAt) {
      directUpdates.push('updated_at = ?'); directValues.push(new Date(updates.archivedAt).toISOString())
    }

    // Synced metadata updates
    const metadataUpdates: Record<string, any> = {}
    for (const key of SYNCED_METADATA_KEYS) {
      if (key in updates) metadataUpdates[key] = (updates as any)[key]
    }

    // Apply synced updates via PowerSync
    if (directUpdates.length > 0 || Object.keys(metadataUpdates).length > 0) {
      const current = await this.db.getOptional<{ metadata: string }>('SELECT metadata FROM chat_sessions WHERE id = ?', [sessionId])
      const metadata = { ...parseJsonbText<Record<string, any>>(current?.metadata, {}), ...metadataUpdates }
      const setClauses = [...directUpdates, 'metadata = ?', 'updated_at = ?']
      const values = [...directValues, JSON.stringify(metadata), new Date().toISOString(), sessionId]
      await this.db.execute(`UPDATE chat_sessions SET ${setClauses.join(', ')} WHERE id = ?`, values)
    }

    // Local-only updates
    const localKeys = ['sdkCwd', 'workingDirectory', 'lastReadMessageId', 'hasUnread', 'lastFinalMessageId', 'sdkSessionId', 'pendingPlanExecution', 'permissionMode'] as const
    const localUpdates: Record<string, any> = {}
    for (const key of localKeys) {
      if (key in updates) localUpdates[key] = (updates as any)[key]
    }
    if (Object.keys(localUpdates).length > 0) {
      const state = loadLocalState(this.workspaceRootPath, sessionId)
      Object.assign(state, localUpdates)
      saveLocalState(this.workspaceRootPath, sessionId, state)
    }
  }

  /**
   * Delete a session.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    await this.db.execute('DELETE FROM chat_sessions WHERE id = ?', [sessionId])
    deleteLocalState(this.workspaceRootPath, sessionId)
    return true
  }

  // --- Private helpers ---

  private rowToSessionMetadata(row: any): SessionMetadata {
    const metadata: SyncedSessionMetadata = parseJsonbText(row.metadata, {})
    const localState = loadLocalState(this.workspaceRootPath, row.id)

    return {
      id: row.id,
      workspaceRootPath: this.workspaceRootPath,
      name: row.name ?? undefined,
      createdAt: new Date(row.created_at).getTime(),
      lastUsedAt: new Date(row.updated_at).getTime(),
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at).getTime() : undefined,
      messageCount: row.message_count ?? 0,
      preview: row.preview ?? undefined,
      lastMessageRole: row.last_message_role ?? undefined,
      isArchived: row.archived === 1 || row.archived === true,
      createdBy: row.created_by ?? undefined,
      // Synced metadata
      permissionMode: localState.permissionMode as any,
      thinkingLevel: metadata.thinkingLevel as any,
      model: metadata.model,
      llmConnection: metadata.llmConnection,
      connectionLocked: metadata.connectionLocked,
      isFlagged: metadata.isFlagged,
      sessionStatus: metadata.sessionStatus,
      labels: metadata.labels,
      sharedUrl: metadata.sharedUrl,
      sharedId: metadata.sharedId,
      hidden: metadata.hidden,
      // Local-only state
      sdkCwd: localState.sdkCwd,
      workingDirectory: localState.workingDirectory,
      sdkSessionId: localState.sdkSessionId,
      lastReadMessageId: localState.lastReadMessageId,
      lastFinalMessageId: localState.lastFinalMessageId,
      hasUnread: localState.hasUnread,
      tokenUsage: localState.tokenUsage ?? DEFAULT_TOKEN_USAGE,
    }
  }

  private assembleStoredSession(row: any, messageRows: any[], localState: SessionLocalState): StoredSession {
    const metadata: SyncedSessionMetadata = parseJsonbText(row.metadata, {})
    const messages: StoredMessage[] = messageRows.map(r => {
      const parsed = parseJsonbText<StoredMessage | null>(r.content, null)
      if (parsed && typeof parsed === 'object') return parsed
      return { id: r.id, type: r.role, content: '', timestamp: new Date(r.created_at).getTime() } as StoredMessage
    })

    return {
      id: row.id,
      workspaceRootPath: this.workspaceRootPath,
      name: row.name ?? undefined,
      createdAt: new Date(row.created_at).getTime(),
      lastUsedAt: new Date(row.updated_at).getTime(),
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at).getTime() : undefined,
      isArchived: row.archived === 1 || row.archived === true,
      createdBy: row.created_by ?? undefined,
      messages,
      // Synced metadata
      permissionMode: localState.permissionMode as any,
      thinkingLevel: metadata.thinkingLevel as any,
      model: metadata.model,
      llmConnection: metadata.llmConnection,
      connectionLocked: metadata.connectionLocked,
      isFlagged: metadata.isFlagged,
      sessionStatus: metadata.sessionStatus,
      labels: metadata.labels,
      enabledSourceSlugs: metadata.enabledSourceSlugs,
      sharedUrl: metadata.sharedUrl,
      sharedId: metadata.sharedId,
      hidden: metadata.hidden,
      // Local-only state
      sdkCwd: localState.sdkCwd,
      workingDirectory: localState.workingDirectory,
      sdkSessionId: localState.sdkSessionId,
      lastReadMessageId: localState.lastReadMessageId,
      hasUnread: localState.hasUnread,
      pendingPlanExecution: localState.pendingPlanExecution,
      tokenUsage: localState.tokenUsage ?? DEFAULT_TOKEN_USAGE,
    }
  }

  private extractSyncedMetadata(session: SessionConfig): SyncedSessionMetadata {
    const metadata: SyncedSessionMetadata = {}
    for (const key of SYNCED_METADATA_KEYS) {
      const value = (session as any)[key]
      if (value !== undefined) {
        (metadata as any)[key] = value
      }
    }
    return metadata
  }

  private extractPreview(messages: StoredMessage[]): string | null {
    const firstUserMsg = messages.find(m => m.type === 'user')
    if (!firstUserMsg || !firstUserMsg.content) return null
    const text = typeof firstUserMsg.content === 'string' ? firstUserMsg.content : JSON.stringify(firstUserMsg.content)
    return text.slice(0, 150)
  }

  private getLastMessageRole(messages: StoredMessage[]): string | null {
    if (messages.length === 0) return null
    return messages[messages.length - 1].type
  }
}
