import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

import { normalizeTrustedProjectRoot } from '../project-path.js'

export type WorkspacePolicyErrorCode =
  | 'invalid_path'
  | 'unavailable'
  | 'not_directory'
  | 'outside_configured_roots'
  | 'identity_changed'
  | 'outside_project'

export class WorkspacePolicyError extends Error {
  constructor(
    message: string,
    readonly code: WorkspacePolicyErrorCode = 'unavailable',
  ) {
    super(message)
    this.name = 'WorkspacePolicyError'
  }
}

/** Canonicalizes Project roots and authorizes workspaces within those roots. */
export class WorkspacePolicy {
  private constructor(readonly configuredRoots: readonly string[]) {}

  /** Backwards-compatible name for diagnostics and existing callers. */
  get allowedRoots(): readonly string[] {
    return this.configuredRoots
  }

  static async create(
    configuredRoots: readonly string[] = [],
  ): Promise<WorkspacePolicy> {
    if (configuredRoots.length === 0) {
      return new WorkspacePolicy([])
    }

    const canonicalRoots = await Promise.all(
      configuredRoots.map(
        async (root) =>
          await canonicalDirectory(root, 'Configured workspace root'),
      ),
    )
    return new WorkspacePolicy(uniquePaths(canonicalRoots))
  }

  /**
   * Canonicalize a newly registered Project root. Configured roots are an
   * optional operator guard; an empty list leaves registration unconstrained.
   */
  async authorizeProjectRoot(candidate: string): Promise<string> {
    const canonical = await canonicalDirectory(candidate, 'Project workspace')
    if (
      this.configuredRoots.length > 0 &&
      !this.configuredRoots.some((root) => containsPath(root, canonical))
    ) {
      throw new WorkspacePolicyError(
        'Project workspace is outside the configured roots',
        'outside_configured_roots',
      )
    }
    return canonical
  }

  /** Existing Conversation creation treats cwd as a Project registration. */
  async authorize(candidate: string): Promise<string> {
    return await this.authorizeProjectRoot(candidate)
  }

  /**
   * Revalidate a saved canonical Project root and authorize one cwd beneath
   * it. This helper is intentionally stateless so callers can run it before
   * every Provider Turn.
   */
  async authorizeProjectWorkspace(
    savedRoot: string,
    cwd: string,
  ): Promise<string> {
    const expectedRoot = trustedSavedRoot(savedRoot, 'Saved Project workspace')
    const canonicalRoot = await canonicalDirectory(
      savedRoot,
      'Saved Project workspace',
    )
    if (!samePath(expectedRoot, canonicalRoot)) {
      throw new WorkspacePolicyError(
        'Saved Project workspace canonical identity changed',
        'identity_changed',
      )
    }

    const canonicalCwd = await canonicalDirectory(cwd, 'Workspace cwd')
    if (!containsPath(canonicalRoot, canonicalCwd)) {
      throw new WorkspacePolicyError(
        'Workspace cwd is outside the saved Project root',
        'outside_project',
      )
    }
    return canonicalCwd
  }

  /** Inspect durable Project availability without making Host startup fail. */
  async inspectProjectRoot(
    savedRoot: string,
  ): Promise<'available' | 'unavailable'> {
    try {
      const expectedRoot = trustedSavedRoot(
        savedRoot,
        'Saved Project workspace',
      )
      const canonicalRoot = await canonicalDirectory(
        savedRoot,
        'Saved Project workspace',
      )
      if (!samePath(expectedRoot, canonicalRoot)) {
        return 'unavailable'
      }
      return 'available'
    } catch {
      return 'unavailable'
    }
  }
}

async function canonicalDirectory(
  path: string,
  label: string,
): Promise<string> {
  const absolute = requireAbsolute(path, label)
  let canonical: string
  try {
    canonical = normalizeTrustedProjectRoot(
      normalize(resolve(await realpath(absolute))),
    ).rootPath
  } catch (error: unknown) {
    throw new WorkspacePolicyError(
      `${label} is unavailable: ${safeErrorCode(error)}`,
      'unavailable',
    )
  }

  let metadata: Awaited<ReturnType<typeof stat>>
  try {
    metadata = await stat(canonical)
  } catch (error: unknown) {
    throw new WorkspacePolicyError(
      `${label} is unavailable: ${safeErrorCode(error)}`,
      'unavailable',
    )
  }
  if (!metadata.isDirectory()) {
    throw new WorkspacePolicyError(
      `${label} must be a directory`,
      'not_directory',
    )
  }
  return canonical
}

function requireAbsolute(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new WorkspacePolicyError(
      `${label} must be an absolute path`,
      'invalid_path',
    )
  }
  return path
}

function trustedSavedRoot(path: string, label: string): string {
  try {
    return normalizeTrustedProjectRoot(path).rootPath
  } catch {
    throw new WorkspacePolicyError(
      `${label} must be an absolute canonical path`,
      'invalid_path',
    )
  }
}

function containsPath(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate)
  return (
    fromParent === '' ||
    (fromParent !== '..' &&
      !fromParent.startsWith(`..${sep}`) &&
      !isAbsolute(fromParent))
  )
}

function samePath(left: string, right: string): boolean {
  return (
    normalizeTrustedProjectRoot(left).rootPathKey ===
    normalizeTrustedProjectRoot(right).rootPathKey
  )
}

function uniquePaths(paths: readonly string[]): string[] {
  const unique: string[] = []
  for (const path of paths) {
    if (!unique.some((candidate) => samePath(candidate, path))) {
      unique.push(path)
    }
  }
  return unique
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return 'unknown filesystem error'
}
