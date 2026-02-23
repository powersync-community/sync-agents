import type { SyncStatus } from './types'

export class PowerSyncService {
  async connect(): Promise<void> {
  }

  async disconnect(): Promise<void> {
  }

  async reconnect(): Promise<void> {
  }

  getStatus(): SyncStatus {
    return {
      configured: false,
      connected: false,
      syncing: false,
      error: 'Not yet implemented',
    }
  }
}
