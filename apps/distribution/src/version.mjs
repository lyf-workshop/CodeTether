import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repository, validProductVersion } from './identity.mjs'

export { validProductVersion } from './identity.mjs'

const productPackages = ['codetether-desktop', 'codetether-posix-supervisor']

const paths = {
  root: join(repository, 'package.json'),
  desktop: join(repository, 'apps', 'desktop', 'package.json'),
  cargo: join(repository, 'apps', 'desktop', 'src-tauri', 'Cargo.toml'),
  posix: join(repository, 'apps', 'desktop', 'posix-supervisor', 'Cargo.toml'),
  lock: join(repository, 'apps', 'desktop', 'src-tauri', 'Cargo.lock'),
  posixLock: join(
    repository,
    'apps',
    'desktop',
    'posix-supervisor',
    'Cargo.lock',
  ),
}

function packageVersion(source) {
  const version = JSON.parse(source).version
  if (!validProductVersion(version)) throw new Error('Invalid package version')
  return version
}

function cargoPackageVersion(source, name) {
  const header =
    name === null ? /^\[package\]\r?$/gmu : /^\[\[package\]\]\r?$/gmu
  let match
  while ((match = header.exec(source)) !== null) {
    const next = source.indexOf('\n[', match.index + match[0].length)
    const end = next < 0 ? source.length : next + 1
    const section = source.slice(match.index, end)
    if (
      name !== null &&
      !new RegExp(`^name = "${name}"\\r?$`, 'mu').test(section)
    )
      continue
    const version = /^version = "([^"]+)"\r?$/mu.exec(section)?.[1]
    if (!validProductVersion(version))
      throw new Error(`Invalid Cargo version: ${name ?? 'package'}`)
    return version
  }
  throw new Error(`Missing Cargo package: ${name ?? 'package'}`)
}

function replacePackageVersion(source, version) {
  const current = packageVersion(source)
  return source.replace(`"version": "${current}"`, `"version": "${version}"`)
}

function replaceCargoVersion(source, name, version) {
  const current = cargoPackageVersion(source, name)
  const header =
    name === null ? /^\[package\]\r?$/gmu : /^\[\[package\]\]\r?$/gmu
  let match
  while ((match = header.exec(source)) !== null) {
    const next = source.indexOf('\n[', match.index + match[0].length)
    const end = next < 0 ? source.length : next + 1
    const section = source.slice(match.index, end)
    if (
      name !== null &&
      !new RegExp(`^name = "${name}"\\r?$`, 'mu').test(section)
    )
      continue
    const updated = section.replace(
      `version = "${current}"`,
      `version = "${version}"`,
    )
    if (updated === section && current !== version)
      throw new Error('Cargo version replacement failed')
    return source.slice(0, match.index) + updated + source.slice(end)
  }
  throw new Error(`Missing Cargo package: ${name ?? 'package'}`)
}

export function checkVersionContents(contents) {
  const authoritative = packageVersion(contents.root)
  const actual = {
    desktop: packageVersion(contents.desktop),
    cargo: cargoPackageVersion(contents.cargo, null),
    posix: cargoPackageVersion(contents.posix, null),
    lockDesktop: cargoPackageVersion(contents.lock, productPackages[0]),
    lockPosix: cargoPackageVersion(contents.lock, productPackages[1]),
    posixLock: cargoPackageVersion(contents.posixLock, productPackages[1]),
  }
  for (const [location, version] of Object.entries(actual)) {
    if (version !== authoritative)
      throw new Error(
        `${location} version ${version} differs from root ${authoritative}`,
      )
  }
  return authoritative
}

export function setVersionContents(contents, version) {
  if (!validProductVersion(version))
    throw new Error('Provide a valid semantic version')
  // Validate all inputs before changing any file. The root manifest is the
  // source of truth after a successful set, never a value inferred from Cargo.
  packageVersion(contents.root)
  packageVersion(contents.desktop)
  cargoPackageVersion(contents.cargo, null)
  cargoPackageVersion(contents.posix, null)
  for (const name of productPackages) cargoPackageVersion(contents.lock, name)
  cargoPackageVersion(contents.posixLock, productPackages[1])
  let lock = contents.lock
  for (const name of productPackages)
    lock = replaceCargoVersion(lock, name, version)
  return {
    root: replacePackageVersion(contents.root, version),
    desktop: replacePackageVersion(contents.desktop, version),
    cargo: replaceCargoVersion(contents.cargo, null, version),
    posix: replaceCargoVersion(contents.posix, null, version),
    lock,
    posixLock: replaceCargoVersion(
      contents.posixLock,
      productPackages[1],
      version,
    ),
  }
}

async function readVersionFiles() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([key, path]) => [
        key,
        await readFile(path, 'utf8'),
      ]),
    ),
  )
}

async function main() {
  const [command, version] = process.argv.slice(2)
  if (command === 'check' && version === undefined) {
    const current = checkVersionContents(await readVersionFiles())
    process.stdout.write(`Product version ${current} is consistent.\n`)
    return
  }
  if (command === 'set' && validProductVersion(version)) {
    const next = setVersionContents(await readVersionFiles(), version)
    for (const [key, path] of Object.entries(paths))
      await writeFile(path, next[key])
    checkVersionContents(await readVersionFiles())
    process.stdout.write(`Product version set to ${version}.\n`)
    return
  }
  throw new Error('Use `set <semantic-version>` or `check`')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main()
