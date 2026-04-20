import { atom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'

export interface CurrentUser {
  id: string
  email?: string
}

export const currentUserAtom = atom<CurrentUser | null>(null)
export const authConfiguredAtom = atom<boolean>(false)

const setAuthAtom = atom(
  null,
  (_get, set, payload: { user: CurrentUser | null; configured: boolean }) => {
    set(currentUserAtom, payload.user)
    set(authConfiguredAtom, payload.configured)
  },
)

export function useCurrentUser(): CurrentUser | null {
  return useAtomValue(currentUserAtom)
}

export function useAuthConfigured(): boolean {
  return useAtomValue(authConfiguredAtom)
}

async function loadAuthState(): Promise<{ user: CurrentUser | null; configured: boolean }> {
  const api = (window as any).electronAPI
  if (!api?.supabaseGetUser) return { user: null, configured: false }
  try {
    const state = await api.supabaseGetUser()
    const user = state?.user
    return {
      user: user ? { id: user.id, email: user.email } : null,
      configured: !!state?.configured,
    }
  } catch {
    return { user: null, configured: false }
  }
}

export function useRefreshCurrentUser(): () => Promise<void> {
  const setAuth = useSetAtom(setAuthAtom)
  return useCallback(async () => {
    const state = await loadAuthState()
    setAuth(state)
  }, [setAuth])
}

export function useInitCurrentUser(): void {
  const setAuth = useSetAtom(setAuthAtom)

  useEffect(() => {
    let cancelled = false
    loadAuthState().then((state) => {
      if (!cancelled) setAuth(state)
    })
    return () => {
      cancelled = true
    }
  }, [setAuth])
}
