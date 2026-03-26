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
    const powersyncUrl = process.env.POWERSYNC_URL?.trim()
    if (!powersyncUrl) return

    const supabaseClient = supabaseAuthService.getClient()
    if (!supabaseClient) return

    const { getWorkspaces } = await import('@craft-agent/shared/config/storage')
    const workspaces = getWorkspaces()
    const cloudWs = workspaces.find(w => w.storageMode === 'cloud_canonical')
    if (!cloudWs) return

    const storagePaths = await ensureCloudWorkspaceStoragePaths(cloudWs.rootPath)
    const dbPath = join(storagePaths.dbDir, 'powersync.db')

    await powerSyncService.connect({
      dbPath,
      supabaseClient,
      powersyncUrl,
    })
  }

  // --- Auth handlers ---

  server.handle(RPC_CHANNELS.cloudSync.SIGN_IN, async (_ctx, email: string, password: string) => {
    if (!cloudExperimentalEnabled) return { success: false, error: 'Cloud sync is not enabled' }

    const result = await supabaseAuthService.signIn(email, password)
    if (result.success) {
      await connectPowerSyncForCloudWorkspace()
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
    if (!cloudExperimentalEnabled) return []

    const client = supabaseAuthService.getClient()
    if (!client) return []

    // Join through workspace_members to get role (RLS on cloud_workspaces requires membership)
    const { data, error } = await client
      .from('workspace_members')
      .select('role, cloud_workspace_id, cloud_workspaces(id, name, created_at)')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[CloudSync] Failed to list workspaces:', error)
      return []
    }

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

    // Refresh session to ensure JWT is fresh (RLS needs valid auth.uid())
    const { data: refreshData, error: refreshError } = await client.auth.refreshSession()
    if (refreshError || !refreshData.session?.user) {
      // Fall back to existing session
      console.warn('[CloudSync] Session refresh failed, trying existing session:', refreshError?.message)
    }

    const { data: { session } } = await client.auth.getSession()
    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }
    const userId = session.user.id

    console.log('[CloudSync] Creating workspace, userId:', userId, 'jwt sub:', session.access_token ? 'present' : 'missing')

    const { data, error } = await client
      .from('cloud_workspaces')
      .insert({ name, created_by: userId })
      .select('id, name, created_at')
      .single()

    if (error) {
      console.error('[CloudSync] Workspace create failed:', error)
      return { success: false, error: error.message }
    }

    // Add creator as owner in workspace_members (required for RLS)
    const { error: memberError } = await client
      .from('workspace_members')
      .insert({ cloud_workspace_id: data.id, user_id: userId, role: 'owner' })

    if (memberError) {
      console.error('[CloudSync] Failed to add owner membership:', memberError)
      // Non-fatal: workspace was created, membership can be retried
    }

    return {
      success: true,
      workspace: {
        id: data.id,
        name: data.name,
        createdAt: data.created_at,
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
      storageMode: 'cloud_canonical',
      cloudWorkspaceId,
    })

    // Connect PowerSync for the newly linked workspace
    await connectPowerSyncForCloudWorkspace()

    return {
      success: true,
      link: {
        localWorkspaceId,
        cloudWorkspaceId,
        storageMode: 'cloud_canonical',
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
