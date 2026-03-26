/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - Team Sync
 * - Network (proxy)
 * - About (version, updates)
 *
 * Note: AI settings (connections, model, thinking) have been moved to AiSettingsPage.
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { NetworkProxySettings, SupabaseAuthState } from '../../../shared/types'

import {
  SettingsSection,
  SettingsCard,
  SettingsCardFooter,
  SettingsRow,
  SettingsToggle,
  SettingsInput,
} from '@/components/settings'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

// ============================================
// Proxy form helpers
// ============================================

interface ProxyFormState {
  enabled: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
}

const EMPTY_PROXY_FORM: ProxyFormState = {
  enabled: false,
  httpProxy: '',
  httpsProxy: '',
  noProxy: '',
}

function toProxyFormState(settings?: NetworkProxySettings): ProxyFormState {
  if (!settings) return EMPTY_PROXY_FORM
  return {
    enabled: settings.enabled,
    httpProxy: settings.httpProxy ?? '',
    httpsProxy: settings.httpsProxy ?? '',
    noProxy: settings.noProxy ?? '',
  }
}

function toNetworkProxySettings(form: ProxyFormState): NetworkProxySettings {
  return {
    enabled: form.enabled,
    httpProxy: form.httpProxy.trim() || undefined,
    httpsProxy: form.httpsProxy.trim() || undefined,
    noProxy: form.noProxy.trim() || undefined,
  }
}

function validateProxyUrl(url: string): string | undefined {
  if (!url.trim()) return undefined
  try {
    const parsed = new URL(url.trim())
    if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol)) {
      return 'Must be http://, https://, socks4://, or socks5:// URL'
    }
    return undefined
  } catch {
    return 'Invalid URL format'
  }
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Power state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false)

  // Proxy state
  const [proxyForm, setProxyForm] = useState<ProxyFormState>(EMPTY_PROXY_FORM)
  const [savedProxyForm, setSavedProxyForm] = useState<ProxyFormState>(EMPTY_PROXY_FORM)
  const [proxyError, setProxyError] = useState<string | undefined>()
  const [isSavingProxy, setIsSavingProxy] = useState(false)

  // Team Sync state
  const [cloudAuthState, setCloudAuthState] = useState<SupabaseAuthState | null>(null)
  const [teamSyncLoading, setTeamSyncLoading] = useState(false)
  const [teamSyncError, setTeamSyncError] = useState<string>()
  const [teamSyncMode, setTeamSyncMode] = useState<'signin' | 'signup'>('signin')
  const [teamSyncEmail, setTeamSyncEmail] = useState('')
  const [teamSyncPassword, setTeamSyncPassword] = useState('')

  // Auto-update state
  const updateChecker = useUpdateChecker()
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingForUpdates(true)
    try {
      await updateChecker.checkForUpdates()
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [updateChecker])

  // Load settings on mount
  const loadSettings = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const [notificationsOn, keepAwakeOn, proxySettings] = await Promise.all([
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getKeepAwakeWhileRunning(),
        window.electronAPI.getNetworkProxySettings(),
      ])
      setNotificationsEnabled(notificationsOn)
      setKeepAwakeEnabled(keepAwakeOn)
      const form = toProxyFormState(proxySettings)
      setProxyForm(form)
      setSavedProxyForm(form)

      try {
        const authState = await window.electronAPI.supabaseGetUser()
        setCloudAuthState(authState)
      } catch {
        // Cloud sync not available — ignore
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  const handleKeepAwakeEnabledChange = useCallback(async (enabled: boolean) => {
    setKeepAwakeEnabled(enabled)
    await window.electronAPI.setKeepAwakeWhileRunning(enabled)
  }, [])

  // Proxy handlers
  const isProxyDirty = useMemo(() => {
    return JSON.stringify(proxyForm) !== JSON.stringify(savedProxyForm)
  }, [proxyForm, savedProxyForm])

  const handleSaveProxy = useCallback(async () => {
    // Validate URLs
    const httpErr = validateProxyUrl(proxyForm.httpProxy)
    const httpsErr = validateProxyUrl(proxyForm.httpsProxy)
    if (httpErr || httpsErr) {
      setProxyError(httpErr || httpsErr)
      return
    }
    setProxyError(undefined)
    setIsSavingProxy(true)
    try {
      const settings = toNetworkProxySettings(proxyForm)
      await window.electronAPI.setNetworkProxySettings(settings)
      // Re-read persisted state to confirm
      const persisted = await window.electronAPI.getNetworkProxySettings()
      const form = toProxyFormState(persisted)
      setProxyForm(form)
      setSavedProxyForm(form)
    } catch (error) {
      setProxyError(error instanceof Error ? error.message : 'Failed to save')
    } finally {
      setIsSavingProxy(false)
    }
  }, [proxyForm])

  const handleResetProxy = useCallback(() => {
    setProxyForm(savedProxyForm)
    setProxyError(undefined)
  }, [savedProxyForm])

  const handleTeamSyncAuth = useCallback(async () => {
    if (!teamSyncEmail.trim() || !teamSyncPassword.trim()) {
      setTeamSyncError('Please enter both email and password.')
      return
    }

    setTeamSyncLoading(true)
    setTeamSyncError(undefined)

    try {
      const result = teamSyncMode === 'signup'
        ? await window.electronAPI.supabaseSignUp(teamSyncEmail, teamSyncPassword)
        : await window.electronAPI.supabaseSignIn(teamSyncEmail, teamSyncPassword)

      if (!result.success) {
        setTeamSyncError(result.error || 'Authentication failed')
        return
      }

      const authState = await window.electronAPI.supabaseGetUser()
      setCloudAuthState(authState)
      setTeamSyncEmail('')
      setTeamSyncPassword('')
    } catch (err) {
      setTeamSyncError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setTeamSyncLoading(false)
    }
  }, [teamSyncEmail, teamSyncPassword, teamSyncMode])

  const handleTeamSyncSignOut = useCallback(async () => {
    setTeamSyncLoading(true)
    try {
      await window.electronAPI.supabaseSignOut()
      setCloudAuthState(null)
    } finally {
      setTeamSyncLoading(false)
    }
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="App" actions={<HeaderMenu route={routes.view.settings('app')} helpFeature="app-settings" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {/* Notifications */}
              <SettingsSection title="Notifications">
                <SettingsCard>
                  <SettingsToggle
                    label="Desktop notifications"
                    description="Get notified when AI finishes working in a chat."
                    checked={notificationsEnabled}
                    onCheckedChange={handleNotificationsEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Power */}
              <SettingsSection title="Power">
                <SettingsCard>
                  <SettingsToggle
                    label="Keep screen awake"
                    description="Prevent the screen from turning off while sessions are running."
                    checked={keepAwakeEnabled}
                    onCheckedChange={handleKeepAwakeEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Network */}
              <SettingsSection title="Network">
                <SettingsCard>
                  <SettingsToggle
                    label="HTTP proxy"
                    description="Route network traffic through a proxy server."
                    checked={proxyForm.enabled}
                    onCheckedChange={(enabled) => setProxyForm(prev => ({ ...prev, enabled }))}
                  />
                  {proxyForm.enabled && (
                    <>
                      <SettingsInput
                        label="HTTP Proxy"
                        value={proxyForm.httpProxy}
                        onChange={(value) => setProxyForm(prev => ({ ...prev, httpProxy: value }))}
                        placeholder="http://proxy.example.com:8080"
                        inCard
                      />
                      <SettingsInput
                        label="HTTPS Proxy"
                        value={proxyForm.httpsProxy}
                        onChange={(value) => setProxyForm(prev => ({ ...prev, httpsProxy: value }))}
                        placeholder="http://proxy.example.com:8080"
                        inCard
                      />
                      <SettingsInput
                        label="Bypass Rules"
                        value={proxyForm.noProxy}
                        onChange={(value) => setProxyForm(prev => ({ ...prev, noProxy: value }))}
                        placeholder="localhost, 127.0.0.1, .example.com"
                        inCard
                      />
                    </>
                  )}
                  {(isProxyDirty || proxyError) && (
                    <SettingsCardFooter>
                      {proxyError && (
                        <span className="text-destructive text-sm mr-auto">{proxyError}</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleResetProxy}
                        disabled={!isProxyDirty || isSavingProxy}
                      >
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveProxy}
                        disabled={!isProxyDirty || isSavingProxy}
                      >
                        {isSavingProxy ? (
                          <>
                            <Spinner className="mr-1.5" />
                            Saving...
                          </>
                        ) : (
                          'Save'
                        )}
                      </Button>
                    </SettingsCardFooter>
                  )}
                </SettingsCard>
              </SettingsSection>

              {/* Team Sync */}
              <SettingsSection title="Team Sync" description="Sign in to enable team workspaces.">
                <SettingsCard>
                  {cloudAuthState?.authenticated ? (
                    <SettingsRow
                      label="Account"
                      description={cloudAuthState.user?.email || 'Signed in'}
                      action={
                        <button
                          type="button"
                          onClick={handleTeamSyncSignOut}
                          disabled={teamSyncLoading}
                          className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors text-foreground/60 hover:text-foreground"
                        >
                          Sign Out
                        </button>
                      }
                    />
                  ) : (
                    <div className="px-4 py-4 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Sign in or create an account to enable team workspaces.
                      </p>
                      <input
                        type="email"
                        placeholder="Email"
                        value={teamSyncEmail}
                        onChange={e => setTeamSyncEmail(e.target.value)}
                        disabled={teamSyncLoading}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                      <input
                        type="password"
                        placeholder="Password"
                        value={teamSyncPassword}
                        onChange={e => setTeamSyncPassword(e.target.value)}
                        disabled={teamSyncLoading}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
                        onKeyDown={e => e.key === 'Enter' && handleTeamSyncAuth()}
                      />
                      {teamSyncError && (
                        <p className="text-sm text-destructive">{teamSyncError}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setTeamSyncMode(m => m === 'signin' ? 'signup' : 'signin')
                            setTeamSyncError(undefined)
                          }}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {teamSyncMode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                        </button>
                        <button
                          type="button"
                          onClick={handleTeamSyncAuth}
                          disabled={teamSyncLoading || !teamSyncEmail.trim() || !teamSyncPassword.trim()}
                          className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors disabled:opacity-50"
                        >
                          {teamSyncLoading ? 'Loading...' : teamSyncMode === 'signup' ? 'Sign Up' : 'Sign In'}
                        </button>
                      </div>
                    </div>
                  )}
                </SettingsCard>
              </SettingsSection>

              {/* About */}
              <SettingsSection title="About">
                <SettingsCard>
                  <SettingsRow label="Version">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {updateChecker.updateInfo?.currentVersion ?? 'Loading...'}
                      </span>
                      {updateChecker.isDownloading && updateChecker.updateInfo?.latestVersion && (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Spinner className="w-3 h-3" />
                          <span>Downloading v{updateChecker.updateInfo.latestVersion} ({updateChecker.downloadProgress}%)</span>
                        </div>
                      )}
                    </div>
                  </SettingsRow>
                  <SettingsRow label="Check for updates">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCheckForUpdates}
                      disabled={isCheckingForUpdates}
                    >
                      {isCheckingForUpdates ? (
                        <>
                          <Spinner className="mr-1.5" />
                          Checking...
                        </>
                      ) : (
                        'Check Now'
                      )}
                    </Button>
                  </SettingsRow>
                  {updateChecker.isReadyToInstall && updateChecker.updateInfo?.latestVersion && (
                    <SettingsRow label="Update ready">
                      <Button
                        size="sm"
                        onClick={updateChecker.installUpdate}
                      >
                        Restart to Update to v{updateChecker.updateInfo.latestVersion}
                      </Button>
                    </SettingsRow>
                  )}
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
