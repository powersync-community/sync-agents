import type { SupabaseAuthState } from './types'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { getCredentialManager } from '@craft-agent/shared/credentials'

export class SupabaseAuthService {
  private supabase: SupabaseClient | null = null
  private configured = false
  private initialized = false

  getClient(): SupabaseClient | null {
    return this.supabase
  }

  private getSupabaseConfig(): { url: string; anonKey: string } | null {
    const url = process.env.SUPABASE_URL?.trim()
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim()
    if (!url || !anonKey) return null
    return { url, anonKey }
  }

  private async persistSession(session: Session | null): Promise<void> {
    const manager = getCredentialManager()
    if (!session) {
      await manager.deleteSupabaseAuth()
      return
    }

    await manager.setSupabaseAuth({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at ? session.expires_at * 1000 : undefined,
      tokenType: session.token_type,
    })
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    await this.initialize()
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    const config = this.getSupabaseConfig()
    if (!config) {
      this.configured = false
      this.initialized = true
      return
    }

    this.supabase = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
    this.configured = true
    this.initialized = true

    const manager = getCredentialManager()
    const stored = await manager.getSupabaseAuth()
    if (stored?.accessToken && stored.refreshToken) {
      const { data, error } = await this.supabase.auth.setSession({
        access_token: stored.accessToken,
        refresh_token: stored.refreshToken,
      })
      if (error) {
        await manager.deleteSupabaseAuth()
      } else {
        await this.persistSession(data.session)
      }
    }

    this.supabase.auth.onAuthStateChange((_event, session) => {
      void this.persistSession(session)
    })
  }

  async signIn(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized()
    if (!this.configured || !this.supabase) return { success: false, error: 'Supabase auth is not configured' }

    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password })
    if (error) return { success: false, error: error.message }

    if (!data.session) {
      return { success: false, error: 'No active session returned' }
    }

    await this.persistSession(data.session)
    return { success: true }
  }

  async signUp(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized()
    if (!this.configured || !this.supabase) return { success: false, error: 'Supabase auth is not configured' }

    const { data, error } = await this.supabase.auth.signUp({ email, password })
    if (error) return { success: false, error: error.message }

    if (!data.session) {
      return { success: false, error: 'No active session returned — email confirmation may be required' }
    }

    await this.persistSession(data.session)
    return { success: true }
  }

  async signOut(): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized()
    if (!this.configured || !this.supabase) return { success: false, error: 'Supabase auth is not configured' }

    const { error } = await this.supabase.auth.signOut()
    await this.persistSession(null)
    if (error) return { success: false, error: error.message }
    return { success: true }
  }

  async getAuthState(): Promise<SupabaseAuthState> {
    await this.ensureInitialized()
    if (!this.configured || !this.supabase) {
      return {
        configured: false,
        authenticated: false,
        verified: false,
        user: null,
      }
    }

    const {
      data: { session },
    } = await this.supabase.auth.getSession()

    if (!session) {
      return {
        configured: true,
        authenticated: false,
        verified: false,
        user: null,
      }
    }

    let { data, error } = await this.supabase.auth.getUser()
    if (error || !data.user) {
      const refresh = await this.supabase.auth.refreshSession()
      if (refresh.error || !refresh.data.session) {
        await this.persistSession(null)
        return {
          configured: true,
          authenticated: false,
          verified: false,
          user: null,
        }
      }

      await this.persistSession(refresh.data.session)
      const next = await this.supabase.auth.getUser()
      data = next.data
      error = next.error
      if (error || !data.user) {
        return {
          configured: true,
          authenticated: false,
          verified: false,
          user: null,
        }
      }
    }

    const emailConfirmedAt = data.user.email_confirmed_at ?? undefined

    return {
      configured: true,
      authenticated: true,
      verified: !!emailConfirmedAt,
      user: {
        id: data.user.id,
        email: data.user.email ?? undefined,
        emailConfirmedAt,
      },
    }
  }
}
