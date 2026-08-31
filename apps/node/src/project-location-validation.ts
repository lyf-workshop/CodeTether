import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, parse } from 'node:path'

import {
  MachineTransportError,
  RemoteProjectLocationPathSchema,
  machineTransportLimits,
  type ValidatedRemoteProjectLocation,
} from '@codetether/machine-transport'

interface ProjectLocationFileSystem {
  readonly realpath: (path: string) => Promise<string>
  readonly stat: (path: string) => Promise<{ isDirectory(): boolean }>
}

const nodeFileSystem: ProjectLocationFileSystem = { realpath, stat }

export async function validateProjectLocationPath(
  rootPath: string,
  fileSystem: ProjectLocationFileSystem = nodeFileSystem,
): Promise<ValidatedRemoteProjectLocation> {
  const parsed = RemoteProjectLocationPathSchema.safeParse(rootPath)
  if (!parsed.success || !isAbsolute(parsed.data)) {
    throw projectLocationError(
      'project_location_path_invalid',
      'Project Location path must be a bounded absolute path',
    )
  }

  let canonicalPath: string
  try {
    canonicalPath = await fileSystem.realpath(parsed.data)
  } catch (error) {
    throw mapFileSystemError(error)
  }
  if (
    !isAbsolute(canonicalPath) ||
    !RemoteProjectLocationPathSchema.safeParse(canonicalPath).success ||
    Buffer.byteLength(canonicalPath, 'utf8') >
      machineTransportLimits.maximumProjectLocationPathBytes
  ) {
    throw projectLocationError(
      'project_location_path_invalid',
      'Canonical Project Location path is invalid',
    )
  }

  let directory: boolean
  try {
    directory = (await fileSystem.stat(canonicalPath)).isDirectory()
  } catch (error) {
    throw mapFileSystemError(error)
  }
  if (!directory) {
    throw projectLocationError(
      'project_location_not_directory',
      'Project Location path is not a directory',
    )
  }

  return {
    canonicalPath,
    basename: basename(canonicalPath) || parse(canonicalPath).root,
    exists: true,
    directory: true,
  }
}

function mapFileSystemError(error: unknown): MachineTransportError {
  const code = systemErrorCode(error)
  if (code === 'ENOENT') {
    return projectLocationError(
      'project_location_missing',
      'Project Location directory does not exist',
      error,
    )
  }
  if (code === 'ENOTDIR') {
    return projectLocationError(
      'project_location_not_directory',
      'Project Location path is not a directory',
      error,
    )
  }
  if (code === 'ELOOP' || code === 'ENAMETOOLONG' || code === 'EINVAL') {
    return projectLocationError(
      'project_location_path_invalid',
      'Project Location path could not be resolved safely',
      error,
    )
  }
  return projectLocationError(
    'project_location_inaccessible',
    'Project Location directory is inaccessible',
    error,
  )
}

function systemErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function projectLocationError(
  code:
    | 'project_location_path_invalid'
    | 'project_location_missing'
    | 'project_location_not_directory'
    | 'project_location_inaccessible',
  message: string,
  cause?: unknown,
): MachineTransportError {
  return new MachineTransportError(code, message, { cause })
}
