import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { artifactFilename } from './release.mjs'
import { buildIdentity, repository } from './identity.mjs'

const requiredEnvironment = [
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  'CODETETHER_UPDATE_BASE_URL',
  'CODETETHER_UPDATE_PUBKEY',
]
const targets = {
  'windows-x64': { target: 'windows-x86_64-nsis', artifactType: 'exe' },
  'macos-arm64': { target: 'darwin-aarch64', artifactType: 'app.tar.gz' },
}

export function updateReleaseEnabled(environment = process.env) {
  const present = requiredEnvironment.map(
    (name) =>
      typeof environment[name] === 'string' && environment[name].length > 0,
  )
  if (present.every((value) => !value)) return false
  if (present.some((value) => !value))
    throw new Error(
      `Update release requires all four variables: ${requiredEnvironment.join(', ')}`,
    )
  return true
}

export function updateBaseUrl(raw) {
  const url = new URL(raw)
  if (
    url.protocol !== 'https:' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      'Update release base URL must be HTTPS without query or credentials',
    )
  const base = url.toString().replace(/\/+$/u, '')
  if (base.length > 500) throw new Error('Update release base URL is too long')
  return base
}

export function updaterArtifact(platform, architecture, version) {
  const key = `${platform}-${architecture}`
  const specification = targets[key]
  if (!specification) throw new Error('Unsupported Desktop update target')
  return {
    target: specification.target,
    filename: artifactFilename(
      {
        component: 'desktop',
        platform,
        architecture,
        artifactType: specification.artifactType,
      },
      version,
    ),
  }
}

export function updateFragment({
  platform,
  architecture,
  version,
  commit,
  baseUrl,
  signature,
  notes,
}) {
  const { target, filename } = updaterArtifact(platform, architecture, version)
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/u.test(commit))
    throw new Error('Update fragment requires a clean commit identity')
  if (
    typeof signature !== 'string' ||
    signature.trim().length === 0 ||
    signature.length > 16_384
  )
    throw new Error('Missing or oversized updater signature')
  if (typeof notes !== 'string' || notes.length > 2000)
    throw new Error('Update notes must be plain text within 2000 characters')
  const base = updateBaseUrl(baseUrl)
  return {
    version,
    commit,
    notes,
    platforms: {
      [target]: {
        signature: signature.trim(),
        url: `${base}/alpha/${version}/${filename}`,
      },
    },
  }
}

async function regularFile(path) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0)
    throw new Error('Update release file must be a nonempty regular file')
}

export async function mergeUpdateFragments(
  alphaDirectory,
  filenames,
  expectedCommit,
) {
  if (
    !Array.isArray(filenames) ||
    filenames.length === 0 ||
    filenames.length > 2
  )
    throw new Error('Provide one or two platform update fragments')
  let version
  let commit
  let notes
  let base
  const platforms = {}
  for (const name of filenames) {
    if (!/^update-(?:windows-x64|macos-arm64)\.json$/u.test(name))
      throw new Error('Unexpected update fragment name')
    const fragmentPath = join(alphaDirectory, name)
    await regularFile(fragmentPath)
    const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
    const keys = Object.keys(fragment.platforms ?? {})
    if (
      keys.length !== 1 ||
      typeof fragment.version !== 'string' ||
      typeof fragment.commit !== 'string' ||
      !/^[a-f0-9]{40}$/u.test(fragment.commit) ||
      typeof fragment.notes !== 'string' ||
      fragment.notes.length > 2000
    )
      throw new Error('Each update fragment must contain one platform')
    if (expectedCommit !== undefined && fragment.commit !== expectedCommit)
      throw new Error('Update fragment commit differs from current clean HEAD')
    const [target] = keys
    const platformKey = name.slice('update-'.length, -'.json'.length)
    if (
      target !== targets[platformKey].target ||
      Object.hasOwn(platforms, target)
    )
      throw new Error('Duplicate or mismatched update platform')
    const [platform, architecture] = platformKey.split('-')
    const expected = updaterArtifact(platform, architecture, fragment.version)
    const entry = fragment.platforms[target]
    if (
      typeof entry?.signature !== 'string' ||
      entry.signature.trim().length === 0 ||
      entry.signature.length > 16_384
    )
      throw new Error('Missing updater signature')
    const url = new URL(entry.url)
    if (
      url.protocol !== 'https:' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error('Update artifact URL must be HTTPS')
    const suffix = `/alpha/${fragment.version}/${expected.filename}`
    if (!url.pathname.endsWith(suffix))
      throw new Error('Update artifact URL does not match its version')
    const thisBase = `${url.origin}${url.pathname.slice(0, -suffix.length)}`
    if (
      version !== undefined &&
      (fragment.version !== version ||
        fragment.commit !== commit ||
        fragment.notes !== notes ||
        thisBase !== base)
    )
      throw new Error(
        'Update fragments must have the same version, commit, notes, and base URL',
      )
    version = fragment.version
    commit = fragment.commit
    notes = fragment.notes
    base = thisBase
    const artifact = join(alphaDirectory, version, expected.filename)
    const signature = `${artifact}.sig`
    await regularFile(artifact)
    await regularFile(signature)
    if ((await readFile(signature, 'utf8')).trim() !== entry.signature)
      throw new Error('Update signature file differs from fragment')
    platforms[target] = entry
  }
  return {
    version,
    notes,
    platforms: Object.fromEntries(
      Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b)),
    ),
  }
}

async function main() {
  const identity = buildIdentity({ requireClean: true })
  const directory = resolve(
    process.argv[2] ??
      join(repository, 'output', 'release', identity.commit, 'alpha'),
  )
  const fragments = (await readdir(directory)).filter((name) =>
    /^update-(?:windows-x64|macos-arm64)\.json$/u.test(name),
  )
  const manifest = await mergeUpdateFragments(
    directory,
    fragments,
    identity.commit,
  )
  await writeFile(
    join(directory, 'latest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  process.stdout.write(
    `Wrote alpha/latest.json with ${Object.keys(manifest.platforms).length} platform(s).\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main()
