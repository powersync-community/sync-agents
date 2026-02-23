import type { SupabaseAuthState } from './types'

export class SupabaseAuthService {
  async initialize(): Promise<void> {
  }

  async signUp(_email: string, _password: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Not yet implemented' }
  }

  async signIn(_email: string, _password: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Not yet implemented' }
  }

  async signOut(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Not yet implemented' }
  }

  async getAuthState(): Promise<SupabaseAuthState> {
    return {
      configured: false,
      authenticated: false,
      verified: false,
      user: null,
    }
  }
}
