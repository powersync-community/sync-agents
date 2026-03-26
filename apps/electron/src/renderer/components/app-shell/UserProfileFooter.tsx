import { useState, useEffect, useCallback } from 'react'
import { LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'

/**
 * UserProfileFooter - Compact user profile at the bottom of the sidebar.
 * Shows email + sign-out when authenticated, nothing when not.
 */
export function UserProfileFooter() {
  const [email, setEmail] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  useEffect(() => {
    window.electronAPI.supabaseGetUser()
      .then(state => {
        if (state.authenticated && state.user?.email) {
          setEmail(state.user.email)
        }
      })
      .catch(() => {})
  }, [])

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true)
    try {
      await window.electronAPI.supabaseSignOut()
      setEmail(null)
    } finally {
      setIsSigningOut(false)
    }
  }, [])

  if (!email) return null

  return (
    <div className="shrink-0 border-t border-foreground/5 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] text-muted-foreground truncate flex-1 min-w-0">
          {email}
        </span>
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
    </div>
  )
}
