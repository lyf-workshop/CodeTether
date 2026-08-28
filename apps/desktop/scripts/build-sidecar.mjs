import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDirectory = resolve(desktopDirectory, '..', '..')
const tauriDirectory = join(desktopDirectory, 'src-tauri')
const binariesDirectory = join(tauriDirectory, 'binaries')
const temporaryDirectory = join(repositoryDirectory, '.tmp', 'desktop-sidecar')

export function createBuildId(revision, dirty) {
  const normalizedRevision = revision.trim().slice(0, 12)
  if (!/^[0-9a-f]{7,12}$/u.test(normalizedRevision)) {
    throw new Error('Git revision is invalid')
  }
  return `git-${normalizedRevision}${dirty ? '-dirty' : ''}`
}

export function sidecarFileName(targetTriple, platform = process.platform) {
  if (!/^[a-z0-9_.-]+$/u.test(targetTriple)) {
    throw new Error('Rust target triple is invalid')
  }
  return `codetether-host-${targetTriple}${platform === 'win32' ? '.exe' : ''}`
}

export function createSeaConfiguration(output) {
  return {
    main: 'codetether-host.mjs',
    mainFormat: 'module',
    output,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    execArgvExtension: 'none',
  }
}

async function main() {
  assertDirectSeaBuildAvailable()
  runPnpm([
    '-r',
    '--workspace-concurrency=1',
    '--filter',
    '@codetether/host...',
    'build',
  ])

  const targetTriple = runRustc(['--print', 'host-tuple']).trim()
  const revision = runGit(['rev-parse', '--verify', 'HEAD'])
  const dirty =
    runGit(['status', '--porcelain', '--untracked-files=all']).trim().length > 0
  const buildId = createBuildId(revision, dirty)
  const bundlePath = join(temporaryDirectory, 'codetether-host.mjs')
  const seaConfigPath = join(temporaryDirectory, 'sea-config.json')
  const sidecarPath = join(binariesDirectory, sidecarFileName(targetTriple))

  await mkdir(temporaryDirectory, { recursive: true })
  await mkdir(binariesDirectory, { recursive: true })
  await build({
    entryPoints: [join(repositoryDirectory, 'apps', 'host', 'src', 'serve.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node25',
    external: ['node:*'],
    define: {
      __CODETETHER_HOST_VERSION__: JSON.stringify(buildId),
    },
    logLevel: 'info',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
  })

  await rm(sidecarPath, { force: true })
  await writeFile(
    seaConfigPath,
    `${JSON.stringify(createSeaConfiguration(sidecarPath), null, 2)}\n`,
    'utf8',
  )
  execFileSync(process.execPath, ['--build-sea', seaConfigPath], {
    cwd: temporaryDirectory,
    stdio: 'inherit',
  })
  await writeFile(
    join(binariesDirectory, 'build-id.txt'),
    `${buildId}\n`,
    'utf8',
  )
  process.stdout.write(
    `${JSON.stringify({ buildId, targetTriple, sidecarPath })}\n`,
  )
}

function assertDirectSeaBuildAvailable() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 25 || (major === 25 && minor < 5)) {
    throw new Error(
      'CodeTether Desktop sidecar builds require Node 25.5+ for official --build-sea support',
    )
  }
}

function runPnpm(arguments_) {
  const pnpmEntrypoint = join(
    process.env.PNPM_HOME ?? dirname(process.execPath),
    'node_modules',
    'pnpm',
    'bin',
    'pnpm.mjs',
  )
  execFileSync(process.execPath, [pnpmEntrypoint, ...arguments_], {
    cwd: repositoryDirectory,
    stdio: 'inherit',
  })
}

function runGit(arguments_) {
  return execFileSync('git', arguments_, {
    cwd: repositoryDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

function runRustc(arguments_) {
  const installed = join(
    process.env.USERPROFILE ?? homedir(),
    '.cargo',
    'bin',
    process.platform === 'win32' ? 'rustc.exe' : 'rustc',
  )
  try {
    return execFileSync(installed, arguments_, {
      cwd: repositoryDirectory,
      encoding: 'utf8',
    })
  } catch {
    return execFileSync('rustc', arguments_, {
      cwd: repositoryDirectory,
      encoding: 'utf8',
    })
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main()
}
