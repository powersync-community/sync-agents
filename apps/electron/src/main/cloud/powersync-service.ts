import { createRequire } from 'node:module'
import type { PowerSyncDatabase } from '@powersync/node'
import { AppSchema } from './powersync-schema'
import { SupabasePowerSyncConnector } from './powersync-connector'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncStatus } from './types'

const require = createRequire(__filename)
const { PowerSyncDatabase: PowerSyncDatabaseCjs } = require('@powersync/node') as {
  PowerSyncDatabase: typeof PowerSyncDatabase
}

export class PowerSyncService {
  private db: PowerSyncDatabase | null = null
  private connector: SupabasePowerSyncConnector | null = null
  private connected = false
  private synced = false
  private dbPath: string | null = null
  private lastConnectError: string | null = null

  /**
   * Initialize and start sync in the background.
   * Does NOT block on the first sync — callers must gate cloud-only reads on
   * {@link hasSynced} (or subscribe to GET_STATUS) so auth flows return promptly.
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

    this.lastConnectError = null
    this.dbPath = options.dbPath
    this.connector = new SupabasePowerSyncConnector(
      options.supabaseClient,
      options.powersyncUrl,
    )

    console.log('[PowerSync] connect: creating PowerSyncDatabase')
    try {
      this.db = new PowerSyncDatabaseCjs({
        schema: AppSchema,
        database: {
          dbFilename: options.dbPath,
        },
      })
    } catch (err) {
      this.lastConnectError = err instanceof Error ? err.message : String(err)
      this.db = null
      this.connector = null
      this.dbPath = null
      throw err
    }

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
        if (status.hasSynced && !this.synced) {
          this.synced = true
          console.log('[PowerSync] First sync completed')
        }
      },
    })

    console.log('[PowerSync] connect: calling db.connect(connector)...')
    try {
      await this.db.connect(this.connector)
    } catch (err) {
      this.lastConnectError = err instanceof Error ? err.message : String(err)
      await this.withTimeout('close-after-connect-fail', this.db.close())
      this.db = null
      this.connector = null
      this.dbPath = null
      throw err
    }
    this.connected = true
    console.log('[PowerSync] connect: db.connect() returned, sync running in background')
  }

  /**
   * Opt-in wait for initial sync with a timeout. Resolves early if sync is
   * already done. Never rejects on timeout — returns `false` so callers can
   * decide whether to proceed with a Supabase fallback.
   */
  async waitForFirstSync(timeoutMs = 15_000): Promise<boolean> {
    if (!this.db) return false
    if (this.synced) return true

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await this.db.waitForFirstSync(controller.signal)
      return this.synced
    } catch {
      return this.synced
    } finally {
      clearTimeout(timer)
    }
  }

  private resetState(): void {
    this.db = null
    this.connector = null
    this.connected = false
    this.synced = false
    this.dbPath = null
  }

  private async withTimeout<T>(label: string, promise: Promise<T>, timeoutMs = 5_000): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race<T | undefined>([
        promise,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            console.warn(`[PowerSync] ${label} timed out after ${timeoutMs}ms — proceeding anyway`)
            resolve(undefined)
          }, timeoutMs)
        }),
      ])
    } catch (err) {
      console.error(`[PowerSync] ${label} failed:`, err)
      return undefined
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * Disconnect and close the database (keeps local data).
   * Use for workspace switching. Never throws — logs and moves on.
   */
  async disconnect(): Promise<void> {
    const db = this.db
    if (!db) return
    this.resetState()
    await this.withTimeout('disconnect', db.disconnect())
    await this.withTimeout('close', db.close())
  }

  /**
   * Disconnect and wipe all local data.
   * Required on sign-out or user switch to prevent data leakage.
   * Never throws — logs and moves on so sign-out can always complete.
   */
  async disconnectAndClear(): Promise<void> {
    const db = this.db
    if (!db) return
    this.resetState()
    await this.withTimeout('disconnectAndClear', db.disconnectAndClear())
    await this.withTimeout('close', db.close())
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
    if (this.synced) return true
    const current = this.db?.currentStatus?.hasSynced ?? false
    if (current) this.synced = true
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
        downloading: false,
        uploading: false,
        hasSynced: false,
        error: this.lastConnectError ?? undefined,
      }
    }

    const syncStatus = this.db.currentStatus
    const downloading = syncStatus?.dataFlowStatus?.downloading ?? false
    const uploading = syncStatus?.dataFlowStatus?.uploading ?? false
    const hasSynced = this.synced || (syncStatus?.hasSynced ?? false)
    if (hasSynced) this.synced = true
    return {
      configured: true,
      connected: syncStatus?.connected ?? false,
      syncing: downloading || uploading,
      downloading,
      uploading,
      hasSynced,
      lastSyncedAt: syncStatus?.lastSyncedAt?.getTime(),
      error: this.lastConnectError ?? undefined,
    }
  }
}
