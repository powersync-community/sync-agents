import { useState, useCallback } from 'react'
import { Cloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'

type AuthMode = 'signin' | 'signup'
type AuthStatus = 'idle' | 'loading' | 'error' | 'success'

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
      const result = mode === 'signup'
        ? await window.electronAPI.supabaseSignUp(email, password)
        : await window.electronAPI.supabaseSignIn(email, password)

      if (!result.success) {
        setStatus('error')
        setErrorMessage(result.error || 'Authentication failed')
        return
      }

      // Auth-only: no workspace provisioning or linking.
      // User creates/joins cloud workspaces later from the workspace creation flow.
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

  const isLoading = status === 'loading'
  const isSuccess = status === 'success'

  const loadingText = mode === 'signup' ? 'Creating account...' : 'Signing in...'

  return (
    <StepFormLayout
      icon={<Cloud />}
      title={isSuccess ? 'Connected!' : 'Team Sync'}
      description={
        isSuccess
          ? 'Your account is ready. Create a team workspace to start collaborating.'
          : 'Sign in or create an account to enable team workspaces.'
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
