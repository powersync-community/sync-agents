/**
 * Cloud sync RPC handlers — Supabase auth, cloud workspaces, PowerSync status.
 *
 * Guarded by CLOUD_SYNC_EXPERIMENTAL env var. When disabled, all handlers
 * return safe no-op responses.
 */

import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import { SupabaseAuthService } from '../cloud/supabase-auth'
import { PowerSyncService } from '../cloud/powersync-service'
import { ensureCloudWorkspaceStoragePaths } from '../cloud/workspace-storage'
import type { CloudWorkspace, WorkspaceLinkState } from '../../shared/types'

export const CLOUD_SYNC_HANDLED_CHANNELS = [
  RPC_CHANNELS.cloudSync.SIGN_IN,
  RPC_CHANNELS.cloudSync.SIGN_UP,
  RPC_CHANNELS.cloudSync.SIGN_OUT,
  RPC_CHANNELS.cloudSync.GET_USER,
  RPC_CHANNELS.cloudSync.WORKSPACE_LIST,
  RPC_CHANNELS.cloudSync.WORKSPACE_CREATE,
  RPC_CHANNELS.cloudSync.WORKSPACE_LINK_LOCAL,
  RPC_CHANNELS.cloudSync.GET_STATUS,
  RPC_CHANNELS.cloudSync.RECONNECT,
] as const

export function registerCloudSyncHandlers(server: RpcServer, deps: HandlerDeps): void {
  const cloudExperimentalEnabled = process.env.CLOUD_SYNC_EXPERIMENTAL === '1'
  const supabaseAuthService = new SupabaseAuthService()
  const powerSyncService = new PowerSyncService()

  // Wire cloud services into SessionManager so it can route storage through PowerSync
  if (cloudExperimentalEnabled) {
    deps.sessionManager.setCloudServices({ powerSyncService, supabaseAuthService })

    // Initialize Supabase auth and auto-connect PowerSync if user is already signed in
    void supabaseAuthService.initialize().then(async () => {
      const authState = await supabaseAuthService.getAuthState()
      if (authState.authenticated) {
        await connectPowerSyncForCloudWorkspace()
      }
    }).catch(err => {
      console.error('[CloudSync] Auto-init failed:', err)
    })
  }

  /**
   * Connect PowerSync for the first cloud-linked workspace found.
   * Called after sign-in or on startup when already authenticated.
   */
  async function connectPowerSyncForCloudWorkspace(): Promise<void> {
    console.log('[CloudSync] connectPowerSyncForCloudWorkspace: starting')
    const powersyncUrl = process.env.POWERSYNC_URL?.trim()
    if (!powersyncUrl) {
      console.warn('[CloudSync] connectPowerSyncForCloudWorkspace: no POWERSYNC_URL set, skipping')
      return
    }

    const supabaseClient = supabaseAuthService.getClient()
    if (!supabaseClient) {
      console.warn('[CloudSync] connectPowerSyncForCloudWorkspace: no Supabase client, skipping')
      return
    }

    const { getWorkspaces } = await import('@craft-agent/shared/config/storage')
    const workspaces = getWorkspaces()
    console.log('[CloudSync] connectPowerSyncForCloudWorkspace: found workspaces:', workspaces.map(w => ({ id: w.id, storageMode: w.storageMode })))
    const cloudWs = workspaces.find(w => w.storageMode === 'cloud')
    if (!cloudWs) {
      console.warn('[CloudSync] connectPowerSyncForCloudWorkspace: no cloud workspace found')
      return
    }

    const storagePaths = await ensureCloudWorkspaceStoragePaths(cloudWs.rootPath)
    const dbPath = join(storagePaths.dbDir, 'powersync.db')
    console.log('[CloudSync] connectPowerSyncForCloudWorkspace: connecting PowerSync at', dbPath, 'to', powersyncUrl)

    try {
      await powerSyncService.connect({
        dbPath,
        supabaseClient,
        powersyncUrl,
      })
      console.log('[CloudSync] connectPowerSyncForCloudWorkspace: PowerSync connected successfully')
    } catch (err) {
      console.error('[CloudSync] connectPowerSyncForCloudWorkspace: PowerSync connect failed:', err)
      throw err
    }
  }

  // --- Auth handlers ---

  server.handle(RPC_CHANNELS.cloudSync.SIGN_IN, async (_ctx, email: string, password: string) => {
    console.log('[CloudSync] SIGN_IN handler called')
    if (!cloudExperimentalEnabled) return { success: false, error: 'Cloud sync is not enabled' }

    const result = await supabaseAuthService.signIn(email, password)
    console.log('[CloudSync] SIGN_IN: auth result:', { success: result.success, error: result.error })
    if (result.success) {
      try {
        await connectPowerSyncForCloudWorkspace()
      } catch (err) {
        console.error('[CloudSync] SIGN_IN: PowerSync connection failed after auth:', err)
        // Don't fail the sign-in itself — auth succeeded
      }
    }
    return result
  })

  server.handle(RPC_CHANNELS.cloudSync.SIGN_UP, async (_ctx, email: string, password: string) => {
    if (!cloudExperimentalEnabled) return { success: false, error: 'Cloud sync is not enabled' }

    const result = await supabaseAuthService.signUp(email, password)
    if (result.success) {
      await connectPowerSyncForCloudWorkspace()
    }
    return result
  })

  server.handle(RPC_CHANNELS.cloudSync.SIGN_OUT, async () => {
    if (!cloudExperimentalEnabled) return { success: false, error: 'Cloud sync is not enabled' }

    await powerSyncService.disconnectAndClear()
    return supabaseAuthService.signOut()
  })

  server.handle(RPC_CHANNELS.cloudSync.GET_USER, async () => {
    if (!cloudExperimentalEnabled) {
      return { configured: false, authenticated: false, verified: false, user: null }
    }
    return supabaseAuthService.getAuthState()
  })

  // --- Cloud workspace handlers ---

  server.handle(RPC_CHANNELS.cloudSync.WORKSPACE_LIST, async (): Promise<CloudWorkspace[]> => {
    console.log('[CloudSync] WORKSPACE_LIST handler called')
    if (!cloudExperimentalEnabled) return []

    const client = supabaseAuthService.getClient()
    if (!client) {
      console.warn('[CloudSync] WORKSPACE_LIST: no Supabase client')
      return []
    }

    // Join through workspace_members to get role (RLS on cloud_workspaces requires membership)
    console.log('[CloudSync] WORKSPACE_LIST: querying workspace_members...')
    const { data, error } = await client
      .from('workspace_members')
      .select('role, cloud_workspace_id, cloud_workspaces(id, name, created_at)')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[CloudSync] WORKSPACE_LIST: query failed:', error.message, error.details, error.hint, error.code)
      return []
    }
    console.log('[CloudSync] WORKSPACE_LIST: got', data?.length ?? 0, 'results')

    return (data ?? [])
      .filter(row => row.cloud_workspaces)
      .map(row => {
        const ws = row.cloud_workspaces as any
        return {
          id: ws.id,
          name: ws.name,
          createdAt: ws.created_at,
          role: row.role,
        }
      })
  })

  server.handle(RPC_CHANNELS.cloudSync.WORKSPACE_CREATE, async (_ctx, name: string): Promise<{ success: boolean; error?: string; workspace?: CloudWorkspace }> => {
    if (!cloudExperimentalEnabled) return { success: false, error: 'Cloud sync is not enabled' }

    const client = supabaseAuthService.getClient()
    if (!client) return { success: false, error: 'Not authenticated' }

    const { data: { session } } = await client.auth.getSession()
    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }
    const userId = session.user.id

    // Step 1: Insert workspace (no .select() — the SELECT RLS requires membership which doesn't exist yet)
    const workspaceId = crypto.randomUUID()
    const { error } = await client
      .from('cloud_workspaces')
      .insert({ id: workspaceId, name, created_by: userId })

    if (error) {
      console.error('[CloudSync] Workspace create failed:', error)
      return { success: false, error: error.message }
    }

    // Step 2: Add creator as owner (must happen before any SELECT on the workspace)
    const { error: memberError } = await client
      .from('workspace_members')
      .insert({ cloud_workspace_id: workspaceId, user_id: userId, role: 'owner' })

    if (memberError) {
      console.error('[CloudSync] Failed to add owner membership:', memberError)
      return { success: false, error: 'Workspace created but membership failed: ' + memberError.message }
    }

    return {
      success: true,
      workspace: {
        id: workspaceId,
        name,
        createdAt: new Date().toISOString(),
      },
    }
  })

  server.handle(RPC_CHANNELS.cloudSync.WORKSPACE_LINK_LOCAL, async (_ctx, localWorkspaceId: string, cloudWorkspaceId: string): Promise<{ success: boolean; error?: string; link?: WorkspaceLinkState }> => {
    if (!cloudExperimentalEnabled) return { success: false, error: 'Cloud sync is not enabled' }

    const { getWorkspaces, addWorkspace } = await import('@craft-agent/shared/config/storage')
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === localWorkspaceId)

    if (!workspace) return { success: false, error: `Workspace ${localWorkspaceId} not found` }

    // Update workspace with cloud link
    addWorkspace({
      ...workspace,
      storageMode: 'cloud',
      cloudWorkspaceId,
    })

    // Connect PowerSync for the newly linked workspace
    await connectPowerSyncForCloudWorkspace()

    return {
      success: true,
      link: {
        localWorkspaceId,
        cloudWorkspaceId,
        storageMode: 'cloud',
      },
    }
  })

  // --- Sync status handlers ---

  server.handle(RPC_CHANNELS.cloudSync.GET_STATUS, async () => {
    return powerSyncService.getStatus()
  })

  server.handle(RPC_CHANNELS.cloudSync.RECONNECT, async () => {
    if (!cloudExperimentalEnabled) return { success: false, error: 'Cloud sync is not enabled' }

    try {
      await powerSyncService.reconnect()
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: message }
    }
  })
}
