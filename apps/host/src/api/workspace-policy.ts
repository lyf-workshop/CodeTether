import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export class WorkspacePolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspacePolicyError'
  }
}

/** Restricts agent cwd values to explicitly authorized, existing directories. */
export class WorkspacePolicy {
  private constructor(readonly allowedRoots: readonly string[]) {}

  static async create(
    allowedRoots: readonly string[],
  ): Promise<WorkspacePolicy> {
    if (allowedRoots.length === 0) {
      throw new WorkspacePolicyError(
        'At least one explicitly allowed workspace root is required',
      )
    }

    const canonicalRoots = await Promise.all(
      allowedRoots.map(async (root) => await canonicalDirectory(root)),
    )
    return new WorkspacePolicy([...new Set(canonicalRoots)])
  }

  async authorize(candidate: string): Promise<string> {
    if (!isAbsolute(candidate)) {
      throw new WorkspacePolicyError('Workspace cwd must be an absolute path')
    }
    const canonical = await canonicalDirectory(candidate)
    if (!this.allowedRoots.some((root) => containsPath(root, canonical))) {
      throw new WorkspacePolicyError(
        'Workspace cwd is outside the explicitly allowed roots',
      )
    }
    return canonical
  }
}

async function canonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new WorkspacePolicyError(
      `Allowed workspace root must be absolute: ${path}`,
    )
  }
  let canonical: string
  try {
    canonical = resolve(await realpath(path))
  } catch (error: unknown) {
    throw new WorkspacePolicyError(
      `Workspace path is unavailable: ${safeErrorCode(error)}`,
    )
  }
  const metadata = await stat(canonical)
  if (!metadata.isDirectory()) {
    throw new WorkspacePolicyError('Workspace path must be a directory')
  }
  return canonical
}

function containsPath(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate)
  return (
    fromParent === '' ||
    (!fromParent.startsWith('..') && !isAbsolute(fromParent))
  )
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
