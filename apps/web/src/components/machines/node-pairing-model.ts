export type NodePairingStep = 1 | 2 | 3 | 4
export function nodePairingSearch(search: Record<string, unknown>): {
  step: NodePairingStep
} {
  const requested = Number(search.step)
  return {
    step: requested === 2 || requested === 3 || requested === 4 ? requested : 1,
  }
}
/** Route search is presentation only. Confirmation and success require facts. */
export function nodePairingStep(
  requested: NodePairingStep,
  hasCandidate: boolean,
  hasConfirmedMachine: boolean,
): NodePairingStep {
  if (hasConfirmedMachine) return 4
  if (hasCandidate) return 3
  return requested === 1 ? 1 : 2
}
export function nodePairingCommands(platform: 'linux' | 'macos') {
  const directory =
    platform === 'linux'
      ? '$HOME/.local/share/codetether-node'
      : '$HOME/Library/Application Support/CodeTether/Node'
  const binary = `"${directory}/bin/codetether-node"`
  return {
    stop: `${binary} service stop`,
    pair: `${binary} --pair --data-dir "${directory}/state"`,
    start: `${binary} service start`,
  }
}
