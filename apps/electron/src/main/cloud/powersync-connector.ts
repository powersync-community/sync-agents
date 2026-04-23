import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector, PowerSyncCredentials } from '@powersync/common'
import type { SupabaseClient } from '@supabase/supabase-js'

// Columns stored as TEXT in the PowerSync schema but JSONB on Supabase.
// We JSON.stringify on write so SQLite has a scalar value, then parse back to
// an object here before upload — otherwise Postgres stores the string as a
// jsonb string primitive and replication round-trips a double-encoded value.
const JSONB_COLUMNS: Record<string, readonly string[]> = {
  chat_sessions: ['metadata'],
  chat_messages: ['content'],
}

function parseJsonbColumns(table: string, data: Record<string, unknown>): Record<string, unknown> {
  const cols = JSONB_COLUMNS[table]
  if (!cols) return data
  const out = { ...data }
  for (const col of cols) {
    const v = out[col]
    if (typeof v === 'string') {
      try { out[col] = JSON.parse(v) } catch { /* leave raw */ }
    }
  }
  return out
}

export class SupabasePowerSyncConnector implements PowerSyncBackendConnector {
  constructor(
    private supabaseClient: SupabaseClient,
    private powersyncUrl: string,
  ) {}

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    console.log('[PowerSync] fetchCredentials: getting session...')
    const { data: { session } } = await this.supabaseClient.auth.getSession()
    if (!session) {
      console.error('[PowerSync] fetchCredentials: no active session')
      return null
    }

    console.log('[PowerSync] fetchCredentials: returning credentials for endpoint:', this.powersyncUrl, 'token expires:', session.expires_at ? new Date(session.expires_at * 1000).toISOString() : 'unknown')
    return {
      endpoint: this.powersyncUrl,
      token: session.access_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction()
    if (!transaction) return

    try {
      const { data: { session } } = await this.supabaseClient.auth.getSession()
      if (!session) {
        throw new Error('Upload failed: no active Supabase session in connector')
      }
      console.log('[PowerSync] Upload transaction auth user:', session.user.id)
      console.log('[PowerSync] Upload transaction started:', { operations: transaction.crud.length })
      for (const op of transaction.crud) {
        const table = op.table
        const id = op.id
        const opData = parseJsonbColumns(table, op.opData ?? {})
        const payload = { id, ...opData } as Record<string, unknown>
        let result

        switch (op.op) {
          case 'PUT':
            if (table === 'cloud_workspaces' || table === 'workspace_members') {
              // These are insert-only under current RLS. Use INSERT (not UPSERT)
              // so we only evaluate insert policies.
              result = await this.supabaseClient
                .from(table)
                .insert(payload as any)
            } else {
              result = await this.supabaseClient
                .from(table)
                .upsert(payload as any)
            }
            break
          case 'PATCH':
            result = await this.supabaseClient
              .from(table)
              .update(opData)
              .eq('id', id)
            break
          case 'DELETE':
            result = await this.supabaseClient
              .from(table)
              .delete()
              .eq('id', id)
            break
        }

        // Do NOT swallow upload errors. Completing the transaction on failure
        // drops writes permanently. For RLS/auth races (e.g. membership not
        // yet visible), we need PowerSync to retry.
        if (result?.error) {
          const status = result.status
          // INSERT on an existing id/unique key is effectively idempotent success
          // for PowerSync retry semantics.
          if (
            op.op === 'PUT' &&
            (table === 'cloud_workspaces' || table === 'workspace_members') &&
            result.error.code === '23505'
          ) {
            console.log(`[PowerSync] Upload duplicate treated as success: ${op.op} ${table}/${id}`)
            continue
          }

          console.error(
            `[PowerSync] Upload rejected (${status}) for ${op.op} on ${table}/${id}: ${result.error.message}`,
            {
              auth_user_id: session.user.id,
              cloud_workspace_id: payload.cloud_workspace_id,
              created_by: payload.created_by,
              user_id: payload.user_id,
              role: payload.role,
            }
          )
          throw new Error(`Upload failed (${status}) for ${op.op} ${table}/${id}: ${result.error.message}`)
        } else {
          console.log(`[PowerSync] Upload ok: ${op.op} ${table}/${id}`)
        }
      }

      // CRITICAL: transaction.complete() is mandatory or the upload queue stalls permanently
      await transaction.complete()
      console.log('[PowerSync] Upload transaction completed')
    } catch (error) {
      console.error('[PowerSync] Upload failed:', error)
      throw error
    }
  }
}
