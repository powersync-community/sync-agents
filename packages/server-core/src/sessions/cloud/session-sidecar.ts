import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import type { SessionTokenUsage } from '@craft-agent/shared/sessions/types'

/**
 * Per-device/per-user state that doesn't sync to the cloud.
 * Stored as a JSON file alongside the session folder.
 */
export interface SessionLocalState {
  // Filesystem (machine-specific — absolute paths differ per device)
  sdkCwd?: string
  workingDirectory?: string

  // Read tracking (per-user — each user has their own read position)
  lastReadMessageId?: string
  hasUnread?: boolean
  lastFinalMessageId?: string

  // SDK state (per-instance — local SDK handles)
  sdkSessionId?: string
  tokenUsage?: SessionTokenUsage

  // Plan execution (per-instance — references local file paths)
  pendingPlanExecution?: { planPath: string; awaitingCompaction: boolean }
}

function getLocalStatePath(workspaceRootPath: string, sessionId: string): string {
  return join(workspaceRootPath, 'sessions', sessionId, 'local-state.json')
}

export function loadLocalState(workspaceRootPath: string, sessionId: string): SessionLocalState {
  const filePath = getLocalStatePath(workspaceRootPath, sessionId)
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    }
  } catch (err) {
    console.warn(`[CloudSync] Failed to load local state for session ${sessionId}:`, err)
  }
  return {}
}

export function saveLocalState(workspaceRootPath: string, sessionId: string, state: SessionLocalState): void {
  const filePath = getLocalStatePath(workspaceRootPath, sessionId)
  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  } catch (err) {
    console.error(`[CloudSync] Failed to save local state for session ${sessionId}:`, err)
  }
}

export function deleteLocalState(workspaceRootPath: string, sessionId: string): void {
  const filePath = getLocalStatePath(workspaceRootPath, sessionId)
  try {
    if (existsSync(filePath)) {
      rmSync(filePath)
    }
  } catch (err) {
    console.warn(`[CloudSync] Failed to delete local state for session ${sessionId}:`, err)
  }
}
