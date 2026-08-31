import { randomInt } from 'node:crypto'

import { z } from 'zod'

export const PairingCodeSchema = z.string().regex(/^\d{6}$/)
export type PairingCode = z.infer<typeof PairingCodeSchema>

export function createPairingCode(): PairingCode {
  return PairingCodeSchema.parse(
    String(randomInt(0, 1_000_000)).padStart(6, '0'),
  )
}

export function normalizePairingCode(value: string): PairingCode {
  return PairingCodeSchema.parse(value.replaceAll(/\s/gu, ''))
}

export function formatPairingCode(value: PairingCode): string {
  const code = PairingCodeSchema.parse(value)
  return `${code.slice(0, 3)} ${code.slice(3)}`
}
