import {
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  type LucideIcon,
} from 'lucide-react'

export const permissionRisks = ['low', 'medium', 'high'] as const

export type PermissionRisk = (typeof permissionRisks)[number]

export interface RiskDefinition {
  label: string
  icon: LucideIcon
  badgeClassName: string
}

export const riskDefinitions = {
  low: {
    label: 'Low risk',
    icon: ShieldCheck,
    badgeClassName: 'border-success/30 bg-success-muted text-success',
  },
  medium: {
    label: 'Medium risk',
    icon: ShieldQuestion,
    badgeClassName: 'border-warning/30 bg-warning-muted text-warning',
  },
  high: {
    label: 'High risk',
    icon: ShieldAlert,
    badgeClassName: 'border-danger/30 bg-danger-muted text-danger',
  },
} satisfies Record<PermissionRisk, RiskDefinition>
