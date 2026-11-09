import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const repository = fileURLToPath(new URL('../../../', import.meta.url))
const productSemver =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-z0-9]+(?:\.[a-z0-9]+)*)?$/u

export function validProductVersion(version) {
  if (typeof version !== 'string' || !productSemver.test(version)) return false
  const prerelease = version.split('-').slice(1).join('-')
  return (
    prerelease === '' ||
    prerelease.split('.').every((part) => !/^0\d+$/u.test(part))
  )
}

export function productVersion() {
  const { version } = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  )
  if (!validProductVersion(version)) throw new Error('Invalid product version')
  return version
}
export function buildIdentity({ requireClean = false } = {}) {
  const git = (args) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
  const commit = git(['rev-parse', 'HEAD'])
  const dirty = git(['status', '--porcelain', '--untracked-files=all']) !== ''
  if (requireClean && dirty)
    throw new Error('Release artifacts require a clean tracked HEAD')
  return {
    version: productVersion(),
    commit,
    build: `git-${commit.slice(0, 12)}${dirty ? '-dirty' : ''}`,
    dirty,
  }
}
