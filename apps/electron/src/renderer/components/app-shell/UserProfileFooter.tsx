import { useState, useCallback } from 'react'
import { useSetAtom } from 'jotai'
import { CloudOff, LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { useCurrentUser, useRefreshCurrentUser } from '@/atoms/auth'
import { useActiveWorkspace, useOptionalAppShellContext } from '@/context/AppShellContext'
import { LinkWorkspaceDialog } from '@/components/workspace/LinkWorkspaceDialog'
import { initializeSessionsAtom } from '@/atoms/sessions'

/**
 * UserProfileFooter - Compact user profile at the bottom of the sidebar.
 * Shows email + sign-out when authenticated, nothing when not.
 */
export function UserProfileFooter() {
  const currentUser = useCurrentUser()
  const refreshCurrentUser = useRefreshCurrentUser()
  const appShell = useOptionalAppShellContext()
  const activeWorkspace = useActiveWorkspace()
  const initializeSessions = useSetAtom(initializeSessionsAtom)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)

  const email = currentUser?.email ?? null
  const canLink = !!activeWorkspace && activeWorkspace.storageMode !== 'cloud'

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true)
    try {
      await window.electronAPI.supabaseSignOut()
      await refreshCurrentUser()
    } finally {
      setIsSigningOut(false)
    }
  }, [refreshCurrentUser])

  const handleLinked = useCallback(async () => {
    await appShell?.onRefreshWorkspaces?.()
    const sessions = await window.electronAPI.getSessions()
    initializeSessions(sessions)
  }, [appShell, initializeSessions])

  if (!email) return null

  return (
    <div className="shrink-0 border-t border-foreground/5 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] text-muted-foreground truncate flex-1 min-w-0">
          {email}
        </span>
        {canLink && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setLinkDialogOpen(true)}
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                <CloudOff className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Link workspace to cloud</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className={cn(
                "shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors",
                isSigningOut && "opacity-50 cursor-not-allowed"
              )}
            >
              <LogOut className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Sign out</TooltipContent>
        </Tooltip>
      </div>
      {activeWorkspace && (
        <LinkWorkspaceDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          localWorkspaceId={activeWorkspace.id}
          localWorkspaceName={activeWorkspace.name}
          onLinked={handleLinked}
        />
      )}
    </div>
  )
}
