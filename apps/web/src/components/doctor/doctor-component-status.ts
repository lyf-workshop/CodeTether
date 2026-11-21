import type { DoctorComponentState } from '@codetether/protocol'

const doctorComponentStatuses = {
  ready: { label: '就绪', variant: 'success' },
  needs_attention: { label: '需要处理', variant: 'warning' },
  limited: { label: '受限', variant: 'warning' },
  unavailable: { label: '不可用', variant: 'danger' },
  offline: { label: '离线', variant: 'secondary' },
  unknown: { label: '尚未检查', variant: 'secondary' },
} as const satisfies Record<
  DoctorComponentState,
  { label: string; variant: string }
>

export function doctorComponentStatus(state: DoctorComponentState) {
  return doctorComponentStatuses[state]
}
