/** Current v4 boundaries. The matching named CSS variants are contract-tested. */
export const workspaceLayoutTokens = {
  narrowDesktopMaximum: 1180,
  compactWorkspaceMaximum: 1000,
  phoneMaximum: 600,
  themeGridMinimum: 390,
  compactSidebarWidth: 224,
} as const

export const workspaceLayoutMedia = {
  narrowDesktop: `(max-width: ${workspaceLayoutTokens.narrowDesktopMaximum}px)`,
} as const
