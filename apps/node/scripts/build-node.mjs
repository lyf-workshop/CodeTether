import { execFileSync } from 'node:child_process'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'
import { productVersion } from '../../distribution/src/identity.mjs'

const nodeDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDirectory = resolve(nodeDirectory, '..', '..')
const outputDirectory = join(nodeDirectory, 'dist', 'sea')
const temporaryDirectory = join(repositoryDirectory, '.tmp', 'remote-node-sea')

export function createNodeBuildId(revision, dirty) {
  const normalizedRevision = revision.trim().slice(0, 12)
  if (!/^[0-9a-f]{7,12}$/u.test(normalizedRevision)) {
    throw new Error('Git revision is invalid')
  }
  return `git-${normalizedRevision}${dirty ? '-dirty' : ''}`
}

export function nodeArtifactName(
  platform = process.platform,
  architecture = process.arch,
) {
  if (
    !/^[a-z0-9_-]+$/u.test(platform) ||
    !/^[a-z0-9_-]+$/u.test(architecture)
  ) {
    throw new Error('Node artifact platform or architecture is invalid')
  }
  return `codetether-node-${platform}-${architecture}${platform === 'win32' ? '.exe' : ''}`
}

export function createSeaConfiguration(output) {
  return {
    main: 'codetether-node.mjs',
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
    '@codetether/node...',
    'build',
  ])
  const revision = runGit(['rev-parse', '--verify', 'HEAD'])
  const dirty =
    runGit(['status', '--porcelain', '--untracked-files=all']).trim().length > 0
  const buildId = createNodeBuildId(revision, dirty)
  const bundlePath = join(temporaryDirectory, 'codetether-node.mjs')
  const seaConfigPath = join(temporaryDirectory, 'sea-config.json')
  const artifactPath = join(outputDirectory, nodeArtifactName())

  await mkdir(temporaryDirectory, { recursive: true })
  await mkdir(outputDirectory, { recursive: true })
  await build({
    entryPoints: [join(nodeDirectory, 'src', 'main.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node25',
    external: ['node:*'],
    banner: {
      js: "import { createRequire as __ctCreateRequire } from 'node:module'; const require = __ctCreateRequire(import.meta.url);",
    },
    define: {
      __CODETETHER_NODE_VERSION__: JSON.stringify(buildId),
      __CODETETHER_PRODUCT_VERSION__: JSON.stringify(productVersion()),
    },
    logLevel: 'info',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
  })
  await rm(artifactPath, { force: true })
  await writeFile(
    seaConfigPath,
    `${JSON.stringify(createSeaConfiguration(artifactPath), null, 2)}\n`,
    'utf8',
  )
  execFileSync(process.execPath, ['--build-sea', seaConfigPath], {
    cwd: temporaryDirectory,
    stdio: 'inherit',
  })
  if (process.platform !== 'win32') await chmod(artifactPath, 0o755)
  await writeFile(join(outputDirectory, 'build-id.txt'), `${buildId}\n`, 'utf8')
  process.stdout.write(
    `${JSON.stringify({ buildId, platform: process.platform, architecture: process.arch, artifactPath })}\n`,
  )
}

function assertDirectSeaBuildAvailable() {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
  if (major < 25 || (major === 25 && minor < 5)) {
    throw new Error(
      'CodeTether Node SEA builds require Node 25.5+ for official --build-sea support',
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main()
}
