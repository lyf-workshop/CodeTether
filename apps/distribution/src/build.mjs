import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  writeFile,
  readdir,
  rm,
  readFile,
  chmod,
  open,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { artifactFilename, scanReleaseContents, sha256 } from './release.mjs'
import { buildIdentity, repository } from './identity.mjs'

export async function reserveArtifact(path) {
  const handle = await open(path, 'wx', 0o600)
  await handle.close()
}

export function assertNativeTarget(
  platform,
  architecture,
  actualPlatform = process.platform,
  actualArchitecture = process.arch,
) {
  const native = { windows: 'win32', macos: 'darwin', linux: 'linux' }[platform]
  if (!native || !['x64', 'arm64'].includes(architecture))
    throw new Error('Unknown distribution target')
  if (native !== actualPlatform || architecture !== actualArchitecture)
    throw new Error(
      'NOT BUILT — matching native platform and architecture required',
    )
}

function pnpm(args) {
  const entry =
    process.env.npm_execpath ??
    join(
      process.env.PNPM_HOME ?? dirname(process.execPath),
      'node_modules',
      'pnpm',
      'bin',
      'pnpm.mjs',
    )
  execFileSync(process.execPath, [entry, ...args], {
    cwd: repository,
    stdio: 'inherit',
  })
}

async function main() {
  const [component, platform, architecture] = process.argv.slice(2)
  assertNativeTarget(platform, architecture)
  const identity = buildIdentity({ requireClean: true })
  const directory = join(repository, 'output', 'release', identity.commit)
  await mkdir(directory, { recursive: true })
  if (component === 'desktop') {
    // Tauri's native signing integration consumes secure environment/CI inputs.
    // No credential value is serialized into a generated config or manifest.
    pnpm(['desktop:build'])
    const kinds =
      platform === 'windows'
        ? [['nsis', 'exe']]
        : platform === 'macos'
          ? [['dmg', 'dmg']]
          : [
              ['deb', 'deb'],
              ['appimage', 'AppImage'],
            ]
    for (const [folder, artifactType] of kinds) {
      const bundle = join(
        repository,
        'apps',
        'desktop',
        'src-tauri',
        'target',
        'release',
        'bundle',
        folder,
      )
      const matches = (await readdir(bundle)).filter(
        (name) =>
          name.includes(identity.version) && name.endsWith(`.${artifactType}`),
      )
      if (matches.length !== 1)
        throw new Error('Expected exactly one current native Desktop artifact')
      const descriptor = {
        component,
        platform,
        architecture,
        artifactType,
        signingState: 'not-observed',
      }
      const filename = artifactFilename(descriptor, identity.version)
      const destination = join(directory, filename)
      await copyFile(
        join(bundle, matches[0]),
        destination,
        constants.COPYFILE_EXCL,
      )
      await writeFile(
        `${destination}.build.json`,
        `${JSON.stringify({ ...descriptor, ...identity, sha256: await sha256(destination), classification: 'BUILD ONLY', installedValidation: 'NOT OBSERVED' }, null, 2)}\n`,
        { flag: 'wx' },
      )
    }
    process.stdout.write(
      'Desktop built. Run native installed lifecycle/privacy validation before publishing a manifest receipt.\n',
    )
    return
  }
  if (component !== 'node' || platform === 'windows')
    throw new Error('Unsupported distribution component')
  pnpm(['node:sea'])
  const nativePlatform = platform === 'macos' ? 'darwin' : platform
  const source = join(
    repository,
    'apps',
    'node',
    'dist',
    'sea',
    `codetether-node-${nativePlatform}-${architecture}`,
  )
  const observation = JSON.parse(
    execFileSync(source, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 16_384,
    }),
  )
  if (
    observation.version !== identity.version ||
    observation.build !== identity.build ||
    observation.platform !== nativePlatform ||
    observation.architecture !== architecture
  )
    throw new Error('Native artifact identity mismatch')
  const staging = await mkdtemp(join(tmpdir(), 'codetether-distribution-'))
  if (
    dirname(staging) !== resolve(tmpdir()) ||
    !basename(staging).startsWith('codetether-distribution-')
  )
    throw new Error('Unexpected staging cleanup path')
  try {
    await copyFile(source, join(staging, 'codetether-node'))
    const target = `${platform === 'macos' ? 'Darwin' : 'Linux'}/${architecture === 'x64' ? 'x86_64' : platform === 'macos' ? 'arm64' : 'aarch64'}`
    const installer = (
      await readFile(
        new URL('../assets/install-node.sh', import.meta.url),
        'utf8',
      )
    )
      .replace('@NATIVE_TARGET@', target)
      .replace('@NODE_SHA256@', await sha256(source))
    await writeFile(join(staging, 'install.sh'), installer, { mode: 0o700 })
    await chmod(join(staging, 'codetether-node'), 0o700)
    await writeFile(
      join(staging, 'INSTALL.txt'),
      'After verifying the archive checksum, run ./install.sh as the intended non-root user. It verifies architecture and the Node checksum before installation.\nUse service start|stop|restart|status|uninstall. Uninstall retains durable identity.\nSee docs/PHASE8D-CROSS-PLATFORM-DISTRIBUTION.md for pairing, endpoint-local configuration, and Alpha limitations.\n',
    )
    await writeFile(
      join(staging, 'build.json'),
      `${JSON.stringify({ version: identity.version, commit: identity.commit, platform, architecture })}\n`,
    )
    const privacy = await scanReleaseContents(staging, [
      'CODETETHER_SYNTHETIC_RELEASE_SECRET_8D',
    ])
    const descriptor = {
      component,
      platform,
      architecture,
      artifactType: 'tar.gz',
      signingState: platform === 'macos' ? 'ad-hoc' : 'not-observed',
    }
    const filename = artifactFilename(descriptor, identity.version)
    const archive = join(directory, filename)
    await reserveArtifact(archive)
    // Fixed allowlist, no repository tree, dotfiles, Provider installations, or
    // developer environment are packaged. Never recursively archive the cwd.
    execFileSync(
      'tar',
      [
        '-czf',
        archive,
        '-C',
        staging,
        'codetether-node',
        'install.sh',
        'INSTALL.txt',
        'build.json',
      ],
      { timeout: 60_000 },
    )
    await writeFile(
      join(directory, `${filename}.receipt.json`),
      `${JSON.stringify(
        {
          ...descriptor,
          ...identity,
          sha256: await sha256(archive),
          launchSmoke: 'PASS',
          privacy: privacy.status,
          classification: 'BUILD ONLY',
          serviceLifecycle: 'NOT OBSERVED',
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    )
    await writeFile(
      join(directory, `${filename}.descriptor.json`),
      `${JSON.stringify([descriptor], null, 2)}\n`,
      { flag: 'wx' },
    )
    process.stdout.write(
      `${filename}: native CLI smoke passed; service/REAL platform validation pending.\n`,
    )
  } finally {
    await rm(staging, { recursive: true })
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main()
