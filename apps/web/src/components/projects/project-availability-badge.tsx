import { CircleCheck, TriangleAlert } from 'lucide-react'

import { Badge } from '@codetether/ui'
import type { ProjectAvailability } from '@codetether/protocol'

interface ProjectAvailabilityBadgeProps {
  availability: ProjectAvailability
}

export function ProjectAvailabilityBadge({
  availability,
}: ProjectAvailabilityBadgeProps) {
  const available = availability === 'available'
  const Icon = available ? CircleCheck : TriangleAlert

  return (
    <Badge variant={available ? 'success' : 'warning'}>
      <Icon aria-hidden="true" />
      {available ? '可用' : '不可用'}
    </Badge>
  )
}
