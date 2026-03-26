import { useState, useEffect, useCallback } from "react"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slugify"
import { Input } from "../ui/input"
import { AddWorkspaceContainer, AddWorkspaceStepHeader, AddWorkspacePrimaryButton } from "./primitives"

interface AddWorkspaceStep_CreateTeamProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string, options: { storageMode: 'cloud'; cloudWorkspaceId: string }) => Promise<void>
  isCreating: boolean
  submitError?: string | null
}

/**
 * AddWorkspaceStep_CreateTeam - Create a cloud-synced team workspace
 *
 * Creates the workspace in Supabase first, then creates the local folder
 * with storageMode: 'cloud' and the cloud workspace ID.
 */
export function AddWorkspaceStep_CreateTeam({
  onBack,
  onCreate,
  isCreating,
  submitError = null,
}: AddWorkspaceStep_CreateTeamProps) {
  const [name, setName] = useState('')
  const [homeDir, setHomeDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [cloudError, setCloudError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getHomeDir().then(setHomeDir)
  }, [])

  const slug = slugify(name)
  const defaultBasePath = homeDir ? `${homeDir}/.craft-agent/workspaces` : null
  const finalPath = defaultBasePath && slug ? `${defaultBasePath}/${slug}` : null

  // Validate slug uniqueness
  useEffect(() => {
    if (!slug) {
      setError(null)
      return
    }

    const validateSlug = async () => {
      setIsValidating(true)
      try {
        const result = await window.electronAPI.checkWorkspaceSlug(slug, defaultBasePath || undefined)
        if (result.exists) {
          setError(`A workspace named "${slug}" already exists`)
        } else {
          setError(null)
        }
      } catch (err) {
        console.error('Failed to validate workspace slug:', err)
      } finally {
        setIsValidating(false)
      }
    }

    const timeout = setTimeout(validateSlug, 300)
    return () => clearTimeout(timeout)
  }, [slug, defaultBasePath])

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !finalPath || error) return
    setCloudError(null)

    try {
      // Step 1: Create cloud workspace in Supabase
      const result = await window.electronAPI.cloudWorkspaceCreate(name.trim())
      if (!result.success || !result.workspace) {
        setCloudError(result.error || 'Failed to create cloud workspace')
        return
      }

      // Step 2: Create local workspace folder linked to cloud
      await onCreate(finalPath, name.trim(), {
        storageMode: 'cloud',
        cloudWorkspaceId: result.workspace.id,
      })
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to create team workspace')
    }
  }, [name, finalPath, error, onCreate])

  const canCreate = name.trim() && finalPath && !error && !isValidating && !isCreating

  return (
    <AddWorkspaceContainer>
      <button
        onClick={onBack}
        disabled={isCreating}
        className={cn(
          "self-start flex items-center gap-1 text-sm text-muted-foreground",
          "hover:text-foreground transition-colors mb-4",
          isCreating && "opacity-50 cursor-not-allowed"
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <AddWorkspaceStepHeader
        title="Create team workspace"
        description="This workspace will be synced to the cloud and visible to your team."
      />

      <div className="mt-6 w-full space-y-6">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground mb-2.5">
            Workspace name
          </label>
          <div className="bg-background shadow-minimal rounded-lg">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Team Workspace"
              disabled={isCreating}
              autoFocus
              className="border-0 bg-transparent shadow-none"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {finalPath && (
          <p className="text-xs text-muted-foreground">
            Local folder: <span className="font-mono">{finalPath}</span>
          </p>
        )}

        <AddWorkspacePrimaryButton
          onClick={handleCreate}
          disabled={!canCreate}
          loading={isCreating}
          loadingText="Creating..."
        >
          Create Team Workspace
        </AddWorkspacePrimaryButton>
        {(cloudError || submitError) && (
          <p className="text-xs text-destructive">{cloudError || submitError}</p>
        )}
      </div>
    </AddWorkspaceContainer>
  )
}
