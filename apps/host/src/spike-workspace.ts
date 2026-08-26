import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface SpikeWorkspace {
  readonly root: string
  readonly exampleFile: string
}

export async function prepareSpikeWorkspace(
  repositoryRoot: string,
): Promise<SpikeWorkspace> {
  const root = resolve(repositoryRoot, '.tmp', 'codetether-codex-spike')
  return await prepareWorkspaceFixture(root)
}

export async function prepareIsolatedWorkspace(
  repositoryRoot: string,
  directoryName: string,
): Promise<SpikeWorkspace> {
  if (
    !/^codetether-codex-semantics-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(directoryName)
  ) {
    throw new Error(`Invalid isolated workspace name: ${directoryName}`)
  }
  const temporaryRoot = resolve(repositoryRoot, '.tmp')
  const root = resolve(temporaryRoot, directoryName)
  await resetSemanticsWorkspace(temporaryRoot, root)
  return await prepareWorkspaceFixture(root)
}

/**
 * Creates a disposable Git worktree whose metadata lives outside the worktree
 * root. A read-only Git command can therefore exercise a real sandbox
 * escalation without touching CodeTether or changing the fixture.
 */
export async function prepareApprovalWorkspace(
  repositoryRoot: string,
): Promise<SpikeWorkspace> {
  const temporaryRoot = resolve(repositoryRoot, '.tmp')
  const controlRoot = resolve(
    temporaryRoot,
    'codetether-codex-semantics-approval-control',
  )
  const sourceRoot = resolve(controlRoot, 'repository')
  const root = resolve(controlRoot, 'workspace')
  assertContainedPath(temporaryRoot, controlRoot)
  assertContainedPath(controlRoot, sourceRoot)
  assertContainedPath(controlRoot, root)

  await resetSemanticsWorkspace(temporaryRoot, controlRoot)
  const sourceFile = resolve(sourceRoot, 'src', 'example.ts')
  await mkdir(resolve(sourceRoot, 'src'), { recursive: true })
  await writeWorkspaceFixture(sourceRoot, sourceFile, true)
  await runGit(['init', '--initial-branch=main', sourceRoot])
  await runGit([
    '-C',
    sourceRoot,
    'add',
    '--',
    'AGENTS.md',
    'README.md',
    'src/example.ts',
  ])
  await runGit([
    '-C',
    sourceRoot,
    '-c',
    'user.name=CodeTether Runtime Spike',
    '-c',
    'user.email=runtime-spike@codetether.invalid',
    'commit',
    '--quiet',
    '-m',
    'Initialize approval fixture',
  ])
  await runGit(['-C', sourceRoot, 'worktree', 'add', '--detach', root, 'HEAD'])

  return { root, exampleFile: resolve(root, 'src', 'example.ts') }
}

async function prepareWorkspaceFixture(root: string): Promise<SpikeWorkspace> {
  const sourceDirectory = resolve(root, 'src')
  const exampleFile = resolve(sourceDirectory, 'example.ts')
  await mkdir(sourceDirectory, { recursive: true })
  await prepareGitBoundary(root)
  await writeWorkspaceFixture(root, exampleFile)
  return { root, exampleFile }
}

async function resetSemanticsWorkspace(
  temporaryRoot: string,
  root: string,
): Promise<void> {
  assertContainedPath(temporaryRoot, root)
  const directoryName = relative(temporaryRoot, root)
  if (
    !/^codetether-codex-semantics-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(directoryName)
  ) {
    throw new Error(`Unsafe semantics workspace path: ${root}`)
  }

  await assertDirectoryIsNotLink(temporaryRoot, 'temporary workspace root')
  await mkdir(temporaryRoot, { recursive: true })
  await assertDirectoryIsNotLink(temporaryRoot, 'temporary workspace root')
  await assertDirectoryIsNotLink(root, 'semantics workspace')
  await rm(root, { recursive: true, force: true })
}

async function assertDirectoryIsNotLink(
  path: string,
  label: string,
): Promise<void> {
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing to reset linked ${label}: ${path}`)
    }
    if (!metadata.isDirectory()) {
      throw new Error(`Expected ${label} to be a directory: ${path}`)
    }
  } catch (error: unknown) {
    if (isMissingPathError(error)) return
    throw error
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

async function writeWorkspaceFixture(
  root: string,
  exampleFile: string,
  approvalProbe = false,
): Promise<void> {
  await writeFile(
    resolve(root, 'AGENTS.md'),
    (approvalProbe
      ? [
          '# Runtime Approval Probe',
          '',
          '- Run only `git status --short` when explicitly requested.',
          '- You may access this worktree and the Git metadata linked by its `.git` file.',
          '- Do not modify files, install dependencies, access the network, or delete files.',
          '',
        ]
      : [
          '# Runtime Spike Workspace',
          '',
          '- Work only inside this directory.',
          '- Do not traverse to parent directories.',
          '- Do not install dependencies, access the network, or delete files.',
          '- The only requested edit target is `src/example.ts`.',
          '',
        ]
    ).join('\n'),
    'utf8',
  )
  await writeFile(
    resolve(root, 'README.md'),
    [
      '# CodeTether Codex Runtime Spike',
      '',
      'This disposable project is isolated from the CodeTether source tree.',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    exampleFile,
    [
      'export function greet(name: string): string {',
      '  return `Hello, ${name}`',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
}

async function runGit(arguments_: readonly string[]): Promise<void> {
  await execFileAsync('git', arguments_, { windowsHide: true })
}

async function prepareGitBoundary(root: string): Promise<void> {
  const gitDirectory = resolve(root, '.git')
  assertContainedPath(root, gitDirectory)
  await mkdir(resolve(gitDirectory, 'objects'), { recursive: true })
  await mkdir(resolve(gitDirectory, 'refs', 'heads'), { recursive: true })
  await mkdir(resolve(gitDirectory, 'refs', 'tags'), { recursive: true })
  await writeFile(
    resolve(gitDirectory, 'HEAD'),
    'ref: refs/heads/main\n',
    'utf8',
  )
  await writeFile(
    resolve(gitDirectory, 'config'),
    [
      '[core]',
      '\trepositoryformatversion = 0',
      '\tfilemode = false',
      '\tbare = false',
      '\tlogallrefupdates = true',
      '\tsymlinks = false',
      '\tignorecase = true',
      '',
    ].join('\n'),
    'utf8',
  )
}

export async function readWorkspaceExample(
  workspace: SpikeWorkspace,
): Promise<string> {
  return await readFile(workspace.exampleFile, 'utf8')
}

function assertContainedPath(parent: string, target: string): void {
  const pathFromParent = relative(parent, target)
  if (
    !isAbsolute(parent) ||
    !isAbsolute(target) ||
    pathFromParent.startsWith('..') ||
    isAbsolute(pathFromParent)
  ) {
    throw new Error(`Unsafe spike workspace path: ${target}`)
  }
}
