import { useState, useCallback } from 'react'
import { Cloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'

type AuthMode = 'signin' | 'signup'
type AuthStatus = 'idle' | 'loading' | 'provisioning' | 'error' | 'success'

interface TeamSyncStepProps {
  onComplete: () => void
  onBack: () => void
  onSkip: () => void
}

export function TeamSyncStep({ onComplete, onBack, onSkip }: TeamSyncStepProps) {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<AuthStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string>()

  const handleSubmit = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      setStatus('error')
      setErrorMessage('Please enter both email and password.')
      return
    }

    setStatus('loading')
    setErrorMessage(undefined)

    try {
      // 1. Authenticate
      const result = mode === 'signup'
        ? await window.electronAPI.supabaseSignUp(email, password)
        : await window.electronAPI.supabaseSignIn(email, password)

      if (!result.success) {
        setStatus('error')
        setErrorMessage(result.error || 'Authentication failed')
        return
      }

      // 2. Provision workspace
      setStatus('provisioning')

      const existingWorkspaces = await window.electronAPI.cloudWorkspaceList()

      let cloudWorkspaceId: string

      if (existingWorkspaces.length > 0) {
        cloudWorkspaceId = existingWorkspaces[0].id
      } else {
        const createResult = await window.electronAPI.cloudWorkspaceCreate('My Workspace')
        if (!createResult.success || !createResult.workspace) {
          setStatus('error')
          setErrorMessage(createResult.error || 'Failed to create cloud workspace')
          return
        }
        cloudWorkspaceId = createResult.workspace.id
      }

      // 3. Link to current local workspace
      const wsId = await window.electronAPI.getWindowWorkspace()
      if (wsId) {
        const linkResult = await window.electronAPI.cloudWorkspaceLinkLocal(wsId, cloudWorkspaceId)
        if (!linkResult.success) {
          console.warn('Failed to link workspace:', linkResult.error)
          // Non-fatal: auth succeeded, workspace linking can be retried from settings
        }
      }

      // 4. Done
      setStatus('success')
      setTimeout(() => onComplete(), 800)
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Authentication failed')
    }
  }, [email, password, mode, onComplete])

  const toggleMode = useCallback(() => {
    setMode(m => m === 'signin' ? 'signup' : 'signin')
    setStatus('idle')
    setErrorMessage(undefined)
  }, [])

  const isLoading = status === 'loading' || status === 'provisioning'
  const isSuccess = status === 'success'

  const loadingText = status === 'provisioning'
    ? 'Setting up workspace...'
    : mode === 'signup'
      ? 'Creating account...'
      : 'Signing in...'

  return (
    <StepFormLayout
      icon={<Cloud />}
      title={isSuccess ? 'Connected!' : 'Team Sync'}
      description={
        isSuccess
          ? 'Your account is ready. Syncing will start automatically.'
          : 'Sign in or create an account to sync your data across devices.'
      }
      actions={
        !isSuccess ? (
          <>
            <BackButton onClick={onBack} disabled={isLoading} />
            <ContinueButton
              onClick={handleSubmit}
              loading={isLoading}
              loadingText={loadingText}
              disabled={isLoading || !email.trim() || !password.trim()}
            >
              {mode === 'signup' ? 'Sign Up' : 'Sign In'}
            </ContinueButton>
          </>
        ) : undefined
      }
    >
      {!isSuccess && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={isLoading}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={isLoading}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          {status === 'error' && errorMessage && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleMode}
              disabled={isLoading}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>

            <Button
              variant="ghost"
              size="sm"
              onClick={onSkip}
              disabled={isLoading}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Skip
            </Button>
          </div>
        </div>
      )}
    </StepFormLayout>
  )
}
