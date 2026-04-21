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
import type { CloudWorkspace, CloudWorkspaceMember, WorkspaceLinkState } from '../../shared/types'

export const CLOUD_SYNC_HANDLED_CHANNELS = [
  RPC_CHANNELS.cloudSync.SIGN_IN,
  RPC_CHANNELS.cloudSync.SIGN_UP,
  RPC_CHANNELS.cloudSync.SIGN_OUT,
  RPC_CHANNELS.cloudSync.GET_USER,
  RPC_CHANNELS.cloudSync.WORKSPACE_LIST,
  RPC_CHANNELS.cloudSync.WORKSPACE_CREATE,
  RPC_CHANNELS.cloudSync.WORKSPACE_LINK_LOCAL,
  RPC_CHANNELS.cloudSync.WORKSPACE_MEMBERS,
  RPC_CHANNELS.cloudSync.GET_STATUS,
  RPC_CHANNELS.cloudSync.RECONNECT,
] as const

export function registerCloudSyncHandlers(server: RpcServer, deps: HandlerDeps): void {
  async function waitForWorkspaceMembership(
    cloudWorkspaceId: string,
    userId: string,
    timeoutMs = 60_000,
  ): Promise<void> {
    const client = supabaseAuthService.getClient()
    if (!client) {
      throw new Error('Not authenticated')
    }

    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const { data, error } = await client
        .from('workspace_members')
        .select('id')
        .eq('cloud_workspace_id', cloudWorkspaceId)
        .eq('user_id', userId)
        .limit(1)

      if (!error && data && data.length > 0) {
        return
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }

    throw new Error('Timed out waiting for workspace membership replication')
  }

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
   * Falls back to active workspace so post-auth writes can still route via
   * PowerSync even before a cloud workspace is linked locally.
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

    const { getActiveWorkspace, getWorkspaces } = await import('@craft-agent/shared/config/storage')
    const workspaces = getWorkspaces()
    console.log('[CloudSync] connectPowerSyncForCloudWorkspace: found workspaces:', workspaces.map(w => ({ id: w.id, storageMode: w.storageMode })))
    const cloudWs = workspaces.find(w => w.storageMode === 'cloud')
    const targetWorkspace = cloudWs ?? getActiveWorkspace() ?? workspaces[0]
    if (!targetWorkspace) {
      console.warn('[CloudSync] connectPowerSyncForCloudWorkspace: no workspace available for PowerSync db path')
      return
    }

    const storagePaths = await ensureCloudWorkspaceStoragePaths(targetWorkspace.rootPath)
    const dbPath = join(storagePaths.dbDir, 'powersync.db')
    console.log(
      '[CloudSync] connectPowerSyncForCloudWorkspace: connecting PowerSync at',
      dbPath,
      'to',
      powersyncUrl,
      '(workspace:',
      targetWorkspace.id,
      ')'
    )

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
    console.log('[CloudSync] SIGN_OUT handler called')
    if (!cloudExperimentalEnabled) return { success: false, error: 'Cloud sync is not enabled' }

    try {
      await powerSyncService.disconnectAndClear()
    } catch (err) {
      console.error('[CloudSync] SIGN_OUT: PowerSync cleanup failed (continuing to sign out):', err)
    }
    const result = await supabaseAuthService.signOut()
    console.log('[CloudSync] SIGN_OUT: result', result)
    return result
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

    const db = powerSyncService.getDatabase()
    if (!db) {
      return { success: false, error: 'PowerSync is not connected' }
    }

    // Step 1: Insert workspace via PowerSync (uploaded through connector queue)
    const workspaceId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    try {
      await db.execute(
        `INSERT INTO cloud_workspaces (id, name, created_by, created_at)
         VALUES (?, ?, ?, ?)`,
        [workspaceId, name, userId, createdAt]
      )
      await db.execute(
        `INSERT INTO workspace_members (id, cloud_workspace_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), workspaceId, userId, 'owner', createdAt]
      )

      // Ensure membership has reached Supabase before allowing session writes.
      // chat_sessions RLS requires workspace membership at insert time.
      await waitForWorkspaceMembership(workspaceId, userId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create workspace'
      console.error('[CloudSync] Workspace create failed via PowerSync:', err)
      return { success: false, error: message }
    }

    return {
      success: true,
      workspace: {
        id: workspaceId,
        name,
        createdAt,
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

  server.handle(RPC_CHANNELS.cloudSync.WORKSPACE_MEMBERS, async (_ctx, cloudWorkspaceId: string): Promise<CloudWorkspaceMember[]> => {
    if (!cloudExperimentalEnabled) return []

    const client = supabaseAuthService.getClient()
    if (!client) return []

    // Supabase RPC that resolves user emails from auth.users via SECURITY DEFINER.
    // Falls back to a direct workspace_members query (userId only) if the RPC
    // is not available — callers should treat email as optional.
    const rpc = await client.rpc('workspace_member_emails', { workspace_id: cloudWorkspaceId })
    if (!rpc.error && Array.isArray(rpc.data)) {
      return rpc.data.map((row: any) => ({
        userId: row.user_id,
        email: row.email ?? undefined,
        role: row.role,
      }))
    }

    const { data, error } = await client
      .from('workspace_members')
      .select('user_id, role')
      .eq('cloud_workspace_id', cloudWorkspaceId)

    if (error || !data) return []
    return data.map(row => ({
      userId: row.user_id,
      role: row.role,
    }))
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
