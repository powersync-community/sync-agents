/**
 * Type stub for PowerSyncService.
 * The concrete implementation lives in apps/electron/src/main/cloud/powersync-service.ts.
 * SessionManager only uses type imports, so this stub satisfies the resolver.
 */
import type { PowerSyncDatabase } from '@powersync/node'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SyncStatus {
  configured: boolean
  connected: boolean
  syncing: boolean
  hasSynced: boolean
  lastSyncedAt?: number
}

export declare class PowerSyncService {
  connect(options: { dbPath: string; supabaseClient: SupabaseClient; powersyncUrl: string }): Promise<void>
  disconnect(): Promise<void>
  disconnectAndClear(): Promise<void>
  reconnect(): Promise<void>
  hasSynced(): boolean
  getDatabase(): PowerSyncDatabase | null
  getStatus(): SyncStatus
}
