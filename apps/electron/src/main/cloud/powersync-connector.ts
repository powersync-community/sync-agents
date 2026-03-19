import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector, PowerSyncCredentials } from '@powersync/common'
import type { SupabaseClient } from '@supabase/supabase-js'

export class SupabasePowerSyncConnector implements PowerSyncBackendConnector {
  constructor(
    private supabaseClient: SupabaseClient,
    private powersyncUrl: string,
  ) {}

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const { data: { session } } = await this.supabaseClient.auth.getSession()
    if (!session) return null

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
      for (const op of transaction.crud) {
        const table = op.table
        const id = op.id
        let result

        switch (op.op) {
          case 'PUT':
            result = await this.supabaseClient
              .from(table)
              .upsert({ id, ...op.opData })
            break
          case 'PATCH':
            result = await this.supabaseClient
              .from(table)
              .update(op.opData!)
              .eq('id', id)
            break
          case 'DELETE':
            result = await this.supabaseClient
              .from(table)
              .delete()
              .eq('id', id)
            break
        }

        // A 4xx from uploadData blocks the upload queue permanently.
        // Log client errors but don't throw so transaction.complete() proceeds.
        // Only throw on server errors to trigger PowerSync retry.
        if (result?.error) {
          const status = result.status
          if (status >= 400 && status < 500) {
            console.error(
              `[PowerSync] Upload rejected (${status}) for ${op.op} on ${table}/${id}:`,
              result.error.message
            )
          } else {
            throw new Error(`Upload failed (${status}): ${result.error.message}`)
          }
        }
      }

      // CRITICAL: transaction.complete() is mandatory or the upload queue stalls permanently
      await transaction.complete()
    } catch (error) {
      console.error('[PowerSync] Upload failed:', error)
      throw error
    }
  }
}
