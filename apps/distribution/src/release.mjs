import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildIdentity } from './identity.mjs'

const platforms = ['windows', 'macos', 'linux']
const architectures = ['x64', 'arm64']
const components = ['desktop', 'node']
const types = ['exe', 'dmg', 'tar.gz', 'deb', 'AppImage']
const signing = ['signed', 'unsigned', 'ad-hoc', 'notarized', 'not-observed']

export function artifactFilename(
  { component, platform, architecture, artifactType },
  version,
) {
  if (
    !components.includes(component) ||
    !platforms.includes(platform) ||
    !architectures.includes(architecture) ||
    !types.includes(artifactType) ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/u.test(version)
  )
    throw new Error('Invalid artifact identity')
  if (component === 'node' && artifactType !== 'tar.gz')
    throw new Error('Node distribution requires a portable archive')
  if (
    (artifactType === 'exe' && platform !== 'windows') ||
    (artifactType === 'dmg' && platform !== 'macos') ||
    (['deb', 'AppImage'].includes(artifactType) && platform !== 'linux')
  )
    throw new Error('Artifact platform mismatch')
  return `CodeTether-${component}-${version}-${platform}-${architecture}.${artifactType}`
}

export async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function generateManifest(
  directory,
  descriptors,
  identity,
  generatedAt = new Date().toISOString(),
) {
  if (
    !/^[a-f0-9]{40}$/u.test(identity.commit) ||
    identity.dirty ||
    !Number.isFinite(Date.parse(generatedAt))
  )
    throw new Error('Invalid clean release identity')
  if (
    !Array.isArray(descriptors) ||
    descriptors.length === 0 ||
    descriptors.length > 16
  )
    throw new Error('Missing or excessive artifacts')
  const artifacts = []
  const seen = new Set()
  for (const descriptor of descriptors) {
    const { component, platform, architecture, artifactType, signingState } =
      descriptor
    const filename = artifactFilename(descriptor, identity.version)
    if (seen.has(filename)) throw new Error('Duplicate artifact identity')
    seen.add(filename)
    if (!signing.includes(signingState))
      throw new Error('Signing observation is required')
    // Artifact receipt is required even for unsigned Alpha builds. It must bind
    // a native smoke, content/privacy audit, and the exact post-signing bytes.
    const receipt = JSON.parse(
      await readFile(join(directory, `${filename}.receipt.json`), 'utf8'),
    )
    const file = join(directory, filename)
    const metadata = await lstat(file)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0)
      throw new Error('Artifact must be a nonempty regular file')
    const hash = await sha256(file)
    if (
      receipt.commit !== identity.commit ||
      receipt.version !== identity.version ||
      receipt.sha256 !== hash ||
      receipt.platform !== platform ||
      receipt.architecture !== architecture ||
      receipt.component !== component ||
      receipt.signingState !== signingState ||
      receipt.launchSmoke !== 'PASS' ||
      receipt.privacy !== 'PASS' ||
      ![
        'BUILD ONLY',
        'REAL VM',
        'REAL INSTALLED DESKTOP',
        'REAL PHYSICAL MACHINE',
      ].includes(receipt.classification)
    ) {
      throw new Error(
        'Missing, stale, or inconsistent artifact validation receipt',
      )
    }
    artifacts.push({
      component,
      platform,
      architecture,
      filename,
      size: metadata.size,
      sha256: hash,
      artifactType,
      signingState,
    })
  }
  return {
    version: identity.version,
    commit: identity.commit,
    channel: 'alpha',
    generatedAt,
    artifacts: artifacts.sort((a, b) => a.filename.localeCompare(b.filename)),
  }
}

export async function verifyManifest(directory, manifest) {
  if (manifest.channel !== 'alpha') throw new Error('Invalid release channel')
  const expected = await generateManifest(
    directory,
    manifest.artifacts,
    { version: manifest.version, commit: manifest.commit },
    manifest.generatedAt,
  )
  if (JSON.stringify(expected) !== JSON.stringify(manifest))
    throw new Error('Manifest or artifact checksum mismatch')
  return true
}

/** Scan unpacked release inputs. Archives must be extracted and inspected on
 * their native builder before a privacy receipt can be emitted. No byte-only
 * scan of a compressed archive is treated as an archive content audit. */
export async function scanReleaseContents(directory, sentinels) {
  if (
    !Array.isArray(sentinels) ||
    sentinels.length === 0 ||
    sentinels.some((value) => typeof value !== 'string' || value.length < 16)
  )
    throw new Error('Synthetic privacy sentinels required')
  let files = 0
  const visit = async (path, depth) => {
    if (depth > 32 || files > 30_000)
      throw new Error('Content scan exceeded bound')
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error('Release input symlink requires native bundle audit')
      if (
        /^(?:\.env(?:\..*)?|output|test|tests|fixtures|\.tmp|\.git|.*\.(?:sqlite3?|pem|key|p12|pfx))$/iu.test(
          entry.name,
        )
      )
        throw new Error('Forbidden release content')
      const file = join(path, entry.name)
      if (entry.isDirectory()) await visit(file, depth + 1)
      else {
        files += 1
        let overlap = Buffer.alloc(0)
        const needles = sentinels.flatMap((value) => [
          Buffer.from(value),
          Buffer.from(value, 'utf16le'),
        ])
        const retained =
          Math.max(1024, ...needles.map((value) => value.length)) - 1
        for await (const chunk of createReadStream(file)) {
          const bytes = Buffer.concat([overlap, chunk])
          if (needles.some((value) => bytes.includes(value)))
            throw new Error('Release content privacy violation')
          // Crypto runtimes contain PEM label constants. A label alone is not
          // a credential; require actual PEM payload rather than rejecting the
          // Node runtime's parser strings or ignoring real key material.
          if (
            /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{64,}/u.test(
              bytes.toString('utf8'),
            )
          )
            throw new Error('Release private key material detected')
          overlap = bytes.subarray(-retained)
        }
      }
    }
  }
  await visit(directory, 0)
  if (files === 0) throw new Error('No release content scanned')
  return { status: 'PASS', files, sentinelCount: sentinels.length }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [operation, directoryArgument, input] = process.argv.slice(2)
  const directory = resolve(directoryArgument ?? 'output/release')
  if (!input || basename(input) !== input)
    throw new Error('Provide an input JSON filename in the release directory')
  const data = JSON.parse(await readFile(join(directory, input), 'utf8'))
  if (operation === 'verify') await verifyManifest(directory, data)
  else if (operation === 'generate') {
    const manifest = await generateManifest(
      directory,
      data,
      buildIdentity({ requireClean: true }),
    )
    await writeFile(
      join(directory, 'release-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: 'wx' },
    )
  } else throw new Error('Use generate or verify')
}
