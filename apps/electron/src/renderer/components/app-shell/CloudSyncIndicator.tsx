import * as React from 'react'
import { Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import type { SyncStatus } from '../../../shared/types'

const POLL_INTERVAL_MS = 3000

type IndicatorState =
  | { kind: 'unavailable'; label: string; description: string; icon: typeof CloudOff; className: string }
  | { kind: 'disconnected'; label: string; description: string; icon: typeof CloudOff; className: string }
  | { kind: 'syncing'; label: string; description: string; icon: typeof RefreshCw; className: string }
  | { kind: 'synced'; label: string; description: string; icon: typeof Cloud; className: string }

function formatLastSyncedAt(lastSyncedAt?: number): string | null {
  if (!lastSyncedAt) return null
  const deltaMs = Date.now() - lastSyncedAt
  if (deltaMs < 0) return null
  const deltaSeconds = Math.floor(deltaMs / 1000)
  if (deltaSeconds < 60) return 'just now'
  const deltaMinutes = Math.floor(deltaSeconds / 60)
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const deltaHours = Math.floor(deltaMinutes / 60)
  if (deltaHours < 24) return `${deltaHours}h ago`
  const deltaDays = Math.floor(deltaHours / 24)
  return `${deltaDays}d ago`
}

function getIndicatorState(status: SyncStatus | null, error: string | null): IndicatorState {
  if (error) {
    return {
      kind: 'disconnected',
      label: 'Cloud sync disconnected',
      description: error,
      icon: CloudOff,
      className: 'text-destructive',
    }
  }

  if (!status || !status.configured) {
    return {
      kind: 'unavailable',
      label: 'Cloud sync unavailable',
      description: 'Cloud sync is not configured for this workspace.',
      icon: CloudOff,
      className: 'text-foreground/45',
    }
  }

  if (!status.connected) {
    return {
      kind: 'disconnected',
      label: 'Cloud sync disconnected',
      description: 'No active cloud sync connection right now.',
      icon: CloudOff,
      className: 'text-destructive',
    }
  }

  if (status.downloading || status.uploading) {
    const transferDescription = status.downloading && status.uploading
      ? 'Downloading and uploading changes.'
      : status.downloading
        ? 'Downloading changes.'
        : 'Uploading changes.'
    return {
      kind: 'syncing',
      label: status.hasSynced ? 'Syncing changes' : 'Initial sync in progress',
      description: status.hasSynced
        ? `Connected. ${transferDescription}`
        : 'Connected. Waiting for the first full sync to complete.',
      icon: RefreshCw,
      className: 'text-info',
    }
  }

  if (!status.hasSynced) {
    return {
      kind: 'syncing',
      label: 'Initial sync in progress',
      description: 'Connected. Waiting for the first full sync to complete.',
      icon: RefreshCw,
      className: 'text-info',
    }
  }

  const lastSynced = formatLastSyncedAt(status.lastSyncedAt)
  return {
    kind: 'synced',
    label: 'Cloud sync complete',
    description: lastSynced
      ? `Connected. Last synced ${lastSynced}.`
      : 'Connected. Initial sync has completed.',
    icon: Cloud,
    className: 'text-success',
  }
}

interface CloudSyncIndicatorProps {
  show: boolean
}

export function CloudSyncIndicator({ show }: CloudSyncIndicatorProps) {
  const [status, setStatus] = React.useState<SyncStatus | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!show) {
      setStatus(null)
      setError(null)
      return
    }

    if (!window.electronAPI.isChannelAvailable(RPC_CHANNELS.cloudSync.GET_STATUS)) {
      setStatus(null)
      setError(null)
      return
    }

    let isDisposed = false

    const refreshStatus = async () => {
      try {
        const nextStatus = await window.electronAPI.syncGetStatus()
        if (isDisposed) return
        setStatus(nextStatus)
        setError(nextStatus.error ?? null)
      } catch (err) {
        if (isDisposed) return
        const message = err instanceof Error ? err.message : 'Unable to load sync status.'
        setStatus(null)
        setError(message)
      }
    }

    void refreshStatus()
    const interval = window.setInterval(() => {
      void refreshStatus()
    }, POLL_INTERVAL_MS)

    const cleanupReconnect = window.electronAPI.onReconnected(() => {
      void refreshStatus()
    })

    return () => {
      isDisposed = true
      window.clearInterval(interval)
      cleanupReconnect()
    }
  }, [show])

  if (!show) return null

  const indicator = getIndicatorState(status, error)
  const Icon = indicator.icon
  const shouldPulse = Boolean(status?.downloading || status?.uploading)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={indicator.label}
          className={cn(
            'titlebar-no-drag inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg',
            'hover:bg-foreground/5 transition-colors',
            indicator.className
          )}
        >
          <Icon className={cn('h-4 w-4', shouldPulse && 'animate-pulse')} strokeWidth={1.75} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{indicator.label}</span>
          <span className="text-foreground/60">{indicator.description}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
