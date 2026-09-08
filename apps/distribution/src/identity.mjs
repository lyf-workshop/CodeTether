import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const repository = fileURLToPath(new URL('../../../', import.meta.url))
export function productVersion() {
  const { version } = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  )
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/u.test(version))
    throw new Error('Invalid product version')
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
