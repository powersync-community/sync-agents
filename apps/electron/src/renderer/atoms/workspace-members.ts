import { atom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import type { CloudWorkspaceMember } from '../../shared/types'

type MembersMap = Map<string, CloudWorkspaceMember[]>

const membersByWorkspaceAtom = atom<MembersMap>(new Map())

const setMembersAtom = atom(
  null,
  (get, set, payload: { workspaceId: string; members: CloudWorkspaceMember[] }) => {
    const next = new Map(get(membersByWorkspaceAtom))
    next.set(payload.workspaceId, payload.members)
    set(membersByWorkspaceAtom, next)
  },
)

export function useWorkspaceMembers(cloudWorkspaceId: string | null | undefined): CloudWorkspaceMember[] {
  const map = useAtomValue(membersByWorkspaceAtom)
  const setMembers = useSetAtom(setMembersAtom)

  useEffect(() => {
    if (!cloudWorkspaceId) return
    if (map.has(cloudWorkspaceId)) return
    const api = (window as any).electronAPI
    if (!api?.cloudWorkspaceMembers) return
    api.cloudWorkspaceMembers(cloudWorkspaceId)
      .then((members: CloudWorkspaceMember[]) => setMembers({ workspaceId: cloudWorkspaceId, members }))
      .catch(() => setMembers({ workspaceId: cloudWorkspaceId, members: [] }))
  }, [cloudWorkspaceId, map, setMembers])

  return cloudWorkspaceId ? map.get(cloudWorkspaceId) ?? [] : []
}

export function useMemberLookup(cloudWorkspaceId: string | null | undefined): (userId: string | undefined) => CloudWorkspaceMember | undefined {
  const members = useWorkspaceMembers(cloudWorkspaceId)
  return (userId: string | undefined) => {
    if (!userId) return undefined
    return members.find(m => m.userId === userId)
  }
}
