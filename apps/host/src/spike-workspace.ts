import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export interface SpikeWorkspace {
  readonly root: string
  readonly exampleFile: string
}

export async function prepareSpikeWorkspace(
  repositoryRoot: string,
): Promise<SpikeWorkspace> {
  const temporaryRoot = resolve(repositoryRoot, '.tmp')
  const root = resolve(temporaryRoot, 'codetether-codex-spike')
  assertContainedPath(temporaryRoot, root)

  const sourceDirectory = resolve(root, 'src')
  const exampleFile = resolve(sourceDirectory, 'example.ts')
  await mkdir(sourceDirectory, { recursive: true })
  await prepareGitBoundary(root)
  await writeFile(
    resolve(root, 'AGENTS.md'),
    [
      '# Runtime Spike Workspace',
      '',
      '- Work only inside this directory.',
      '- Do not traverse to parent directories.',
      '- Do not install dependencies, access the network, or delete files.',
      '- The only requested edit target is `src/example.ts`.',
      '',
    ].join('\n'),
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
  return { root, exampleFile }
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
