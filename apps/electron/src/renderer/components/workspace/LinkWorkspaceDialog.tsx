import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Cloud, Plus, RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useRegisterModal } from '@/context/ModalContext'
import type { CloudWorkspace } from '../../../shared/types'

type Mode = 'pick' | 'create'

interface LinkWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  localWorkspaceId: string
  localWorkspaceName: string
  onLinked?: () => void | Promise<void>
}

export function LinkWorkspaceDialog({
  open,
  onOpenChange,
  localWorkspaceId,
  localWorkspaceName,
  onLinked,
}: LinkWorkspaceDialogProps) {
  useRegisterModal(open, () => onOpenChange(false))

  const [mode, setMode] = useState<Mode>('pick')
  const [cloudWorkspaces, setCloudWorkspaces] = useState<CloudWorkspace[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshList = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await window.electronAPI.cloudWorkspaceList()
      setCloudWorkspaces(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cloud workspaces')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setMode('pick')
    setSelectedId(null)
    setNewName('')
    setError(null)
    void refreshList()
  }, [open, refreshList])

  const finishLink = useCallback(
    async (cloudWorkspaceId: string, label: string) => {
      const linkResult = await window.electronAPI.cloudWorkspaceLinkLocal(
        localWorkspaceId,
        cloudWorkspaceId,
      )
      if (!linkResult.success) {
        throw new Error(linkResult.error || 'Failed to link workspace')
      }
      toast.success(`Linked "${localWorkspaceName}" to ${label}`)
      await onLinked?.()
      onOpenChange(false)
    },
    [localWorkspaceId, localWorkspaceName, onLinked, onOpenChange],
  )

  const handleLinkExisting = useCallback(async () => {
    if (!selectedId) return
    setIsSubmitting(true)
    setError(null)
    try {
      const picked = cloudWorkspaces.find((w) => w.id === selectedId)
      await finishLink(selectedId, picked?.name ?? 'cloud workspace')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link workspace')
    } finally {
      setIsSubmitting(false)
    }
  }, [selectedId, cloudWorkspaces, finishLink])

  const handleCreateAndLink = useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    setIsSubmitting(true)
    setError(null)
    try {
      const createResult = await window.electronAPI.cloudWorkspaceCreate(name)
      if (!createResult.success || !createResult.workspace) {
        throw new Error(createResult.error || 'Failed to create cloud workspace')
      }
      await finishLink(createResult.workspace.id, name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cloud workspace')
    } finally {
      setIsSubmitting(false)
    }
  }, [newName, finishLink])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Link workspace to cloud</DialogTitle>
          <DialogDescription>
            Route sessions and messages through PowerSync for <span className="font-medium">{localWorkspaceName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-md bg-foreground/5 p-1">
          <ModeTab active={mode === 'pick'} onClick={() => setMode('pick')}>
            Existing
          </ModeTab>
          <ModeTab active={mode === 'create'} onClick={() => setMode('create')}>
            Create new
          </ModeTab>
        </div>

        {mode === 'pick' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {cloudWorkspaces.length} cloud workspace{cloudWorkspaces.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={() => void refreshList()}
                disabled={isLoading}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
                Refresh
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-foreground/10">
              {isLoading && cloudWorkspaces.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>
              ) : cloudWorkspaces.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No cloud workspaces yet. Switch to "Create new" to make one.
                </div>
              ) : (
                <ul className="divide-y divide-foreground/5">
                  {cloudWorkspaces.map((ws) => {
                    const isSelected = ws.id === selectedId
                    return (
                      <li key={ws.id}>
                        <button
                          onClick={() => setSelectedId(ws.id)}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                            isSelected ? 'bg-foreground/5' : 'hover:bg-foreground/3',
                          )}
                        >
                          <Cloud className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate flex-1">{ws.name}</span>
                          {ws.role && (
                            <span className="text-[11px] text-muted-foreground">{ws.role}</span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-foreground">Name</label>
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My Team Workspace"
              disabled={isSubmitting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  void handleCreateAndLink()
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Creates a new cloud workspace you own and links this local workspace to it.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          {mode === 'pick' ? (
            <Button onClick={handleLinkExisting} disabled={!selectedId || isSubmitting}>
              {isSubmitting ? 'Linking…' : 'Link'}
            </Button>
          ) : (
            <Button onClick={handleCreateAndLink} disabled={!newName.trim() || isSubmitting}>
              <Plus className="h-3.5 w-3.5" />
              {isSubmitting ? 'Creating…' : 'Create & Link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
