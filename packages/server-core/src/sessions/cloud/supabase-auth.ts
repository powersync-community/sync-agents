/**
 * Type stub for SupabaseAuthService.
 * The concrete implementation lives in apps/electron/src/main/cloud/supabase-auth.ts.
 * SessionManager only uses type imports, so this stub satisfies the resolver.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseAuthState {
  configured: boolean
  authenticated: boolean
  verified: boolean
  user: {
    id: string
    email?: string
    emailConfirmedAt?: string
  } | null
}

export declare class SupabaseAuthService {
  initialize(): Promise<void>
  signIn(email: string, password: string): Promise<{ success: boolean; error?: string }>
  signUp(email: string, password: string): Promise<{ success: boolean; error?: string }>
  signOut(): Promise<{ success: boolean; error?: string }>
  getAuthState(): Promise<SupabaseAuthState>
  getClient(): SupabaseClient | null
}
