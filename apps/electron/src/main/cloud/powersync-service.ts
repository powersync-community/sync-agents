import { PowerSyncDatabase } from '@powersync/node'
import { AppSchema } from './powersync-schema'
import { SupabasePowerSyncConnector } from './powersync-connector'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncStatus } from './types'

const FIRST_SYNC_TIMEOUT_MS = 10_000

export class PowerSyncService {
  private db: PowerSyncDatabase | null = null
  private connector: SupabasePowerSyncConnector | null = null
  private connected = false
  private synced = false
  private dbPath: string | null = null

  /**
   * Initialize, connect, and wait for first sync.
   * Called after successful auth when workspace has storageMode === 'cloud'.
   */
  async connect(options: {
    dbPath: string
    supabaseClient: SupabaseClient
    powersyncUrl: string
  }): Promise<void> {
    console.log('[PowerSync] connect: starting', { dbPath: options.dbPath, powersyncUrl: options.powersyncUrl })
    if (this.connected && this.dbPath === options.dbPath) {
      console.log('[PowerSync] connect: already connected to this db, skipping')
      return
    }

    // Close existing connection if switching workspaces
    if (this.db) {
      console.log('[PowerSync] connect: closing existing connection')
      await this.disconnect()
    }

    this.dbPath = options.dbPath
    this.connector = new SupabasePowerSyncConnector(
      options.supabaseClient,
      options.powersyncUrl,
    )

    console.log('[PowerSync] connect: creating PowerSyncDatabase')
    this.db = new PowerSyncDatabase({
      schema: AppSchema,
      database: {
        dbFilename: options.dbPath,
      },
    })

    // Log sync status changes for debugging
    this.db.registerListener({
      statusChanged: (status) => {
        console.log('[PowerSync] statusChanged:', JSON.stringify({
          connected: status.connected,
          lastSyncedAt: status.lastSyncedAt?.toISOString(),
          hasSynced: status.hasSynced,
          downloading: status.dataFlowStatus?.downloading,
          uploading: status.dataFlowStatus?.uploading,
          downloadError: (status as any).downloadError?.message ?? null,
          uploadError: (status as any).uploadError?.message ?? null,
        }))
      },
    })

    // connect() is fire-and-forget — starts sync in background
    console.log('[PowerSync] connect: calling db.connect(connector)...')
    await this.db.connect(this.connector)
    this.connected = true
    console.log('[PowerSync] connect: db.connect() returned, waiting for first sync...')

    // Wait for first sync with timeout — don't block app startup forever
    try {
      await Promise.race([
        this.db.waitForFirstSync(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('First sync timed out')), FIRST_SYNC_TIMEOUT_MS)
        ),
      ])
      this.synced = true
      console.log('[PowerSync] First sync completed')
    } catch (error) {
      console.warn('[PowerSync] First sync did not complete within timeout, continuing:', error)
      this.waitForSyncInBackground()
    }
  }

  /**
   * Keep listening for sync completion in background after timeout.
   */
  private waitForSyncInBackground(): void {
    if (!this.db) return
    this.db.waitForFirstSync().then(() => {
      this.synced = true
      console.log('[PowerSync] Background first sync completed')
    }).catch((err) => {
      console.error('[PowerSync] Background sync failed:', err)
    })
  }

  /**
   * Disconnect and close the database (keeps local data).
   * Use for workspace switching.
   */
  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.disconnect()
      await this.db.close()
      this.db = null
      this.connector = null
      this.connected = false
      this.synced = false
      this.dbPath = null
    }
  }

  /**
   * Disconnect and wipe all local data.
   * Required on sign-out or user switch to prevent data leakage.
   */
  async disconnectAndClear(): Promise<void> {
    if (this.db) {
      await this.db.disconnectAndClear()
      await this.db.close()
      this.db = null
      this.connector = null
      this.connected = false
      this.synced = false
      this.dbPath = null
    }
  }

  /**
   * Reconnect with existing connector (e.g., after token refresh).
   */
  async reconnect(): Promise<void> {
    if (this.db && this.connector) {
      await this.db.disconnect()
      await this.db.connect(this.connector)
    }
  }

  /**
   * Whether the initial sync has completed at least once.
   * Used by Phase B to decide between PowerSync reads vs Supabase fallback.
   */
  hasSynced(): boolean {
    return this.synced
  }

  /**
   * Get the PowerSync database instance for direct queries.
   */
  getDatabase(): PowerSyncDatabase | null {
    return this.db
  }

  getStatus(): SyncStatus {
    if (!this.db) {
      return {
        configured: false,
        connected: false,
        syncing: false,
        hasSynced: false,
      }
    }

    const syncStatus = this.db.currentStatus
    return {
      configured: true,
      connected: syncStatus?.connected ?? false,
      syncing: syncStatus?.dataFlowStatus?.downloading ?? false,
      hasSynced: this.synced,
      lastSyncedAt: syncStatus?.lastSyncedAt?.getTime(),
    }
  }
}
