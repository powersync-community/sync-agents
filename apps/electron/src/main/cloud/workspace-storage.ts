import { basename, join } from 'path'
import { mkdir } from 'fs/promises'

export interface CloudWorkspaceStoragePaths {
  baseDir: string
  powerSyncDir: string
  dbDir: string
  attachmentsDir: string
}

export function getCloudWorkspaceStoragePaths(workspaceRootPath: string): CloudWorkspaceStoragePaths {
  const rootName = basename(workspaceRootPath)
  const powerSyncDir = rootName === '.craft-agent'
    ? join(workspaceRootPath, 'powersync')
    : join(workspaceRootPath, '.craft-agent', 'powersync')
  return {
    baseDir: workspaceRootPath,
    powerSyncDir,
    dbDir: join(powerSyncDir, 'db'),
    attachmentsDir: join(powerSyncDir, 'attachments'),
  }
}

export async function ensureCloudWorkspaceStoragePaths(workspaceRootPath: string): Promise<CloudWorkspaceStoragePaths> {
  const paths = getCloudWorkspaceStoragePaths(workspaceRootPath)
  await mkdir(paths.dbDir, { recursive: true })
  await mkdir(paths.attachmentsDir, { recursive: true })
  return paths
}
