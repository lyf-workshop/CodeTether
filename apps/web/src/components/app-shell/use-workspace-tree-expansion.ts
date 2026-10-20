import { useEffect, useState } from 'react'
import type { MachineId, ProjectId } from '@codetether/protocol'
import {
  readWorkspaceTreeExpansion,
  revealWorkspacePath,
  writeWorkspaceTreeExpansion,
} from './workspace-sidebar-model'

/** Only local expansion IDs persist; current navigation still reveals its path. */
export function useWorkspaceTreeExpansion(
  machineId?: MachineId,
  projectId?: ProjectId,
) {
  const [expansion, setExpansion] = useState(readWorkspaceTreeExpansion)
  const revealedExpansion = revealWorkspacePath(expansion, machineId, projectId)
  if (revealedExpansion !== expansion) setExpansion(revealedExpansion)
  useEffect(() => {
    writeWorkspaceTreeExpansion(undefined, revealedExpansion)
  }, [revealedExpansion])
  return { expansion: revealedExpansion, setExpansion }
}
