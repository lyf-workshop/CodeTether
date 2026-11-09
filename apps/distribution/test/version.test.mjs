import assert from 'node:assert/strict'
import test from 'node:test'
import { artifactFilename } from '../src/release.mjs'
import { checkVersionContents, setVersionContents } from '../src/version.mjs'

const old = '0.1.0-alpha.2'
const fixture = {
  root: `{"name":"codetether-v2","version": "${old}"}\n`,
  desktop: `{"name":"@codetether/desktop","version": "${old}"}\n`,
  cargo: `[package]\nname = "codetether-desktop"\nversion = "${old}"\n\n[dependencies]\nserde = "1"\n`,
  posix: `[package]\nname = "codetether-posix-supervisor"\nversion = "${old}"\n`,
  lock: `[[package]]\nname = "codetether-desktop"\nversion = "${old}"\n\n[[package]]\nname = "codetether-posix-supervisor"\nversion = "${old}"\n\n[[package]]\nname = "unrelated"\nversion = "1.2.3"\n`,
  posixLock: `[[package]]\nname = "codetether-posix-supervisor"\nversion = "${old}"\n`,
}

test('root version drives both Desktop crates and the Cargo lockfile', () => {
  assert.equal(checkVersionContents(fixture), old)
  const next = setVersionContents(fixture, '0.1.0-alpha.3')
  assert.equal(checkVersionContents(next), '0.1.0-alpha.3')
  assert.match(next.lock, /name = "unrelated"\nversion = "1\.2\.3"/u)
  assert.match(next.cargo, /serde = "1"/u)
  assert.equal(
    artifactFilename(
      {
        component: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        artifactType: 'exe',
      },
      checkVersionContents(next),
    ),
    'CodeTether-desktop-0.1.0-alpha.3-windows-x64.exe',
  )
})

test('version gate rejects a stale native package and malformed versions', () => {
  assert.throws(
    () =>
      checkVersionContents({
        ...fixture,
        lock: fixture.lock.replace(
          `version = "${old}"`,
          'version = "0.1.0-alpha.1"',
        ),
      }),
    /lockDesktop version/u,
  )
  assert.throws(
    () => setVersionContents(fixture, '0.1.0 alpha.3'),
    /semantic version/u,
  )
  assert.throws(
    () => setVersionContents(fixture, '0.1.0-alpha..3'),
    /semantic version/u,
  )
  assert.throws(
    () => setVersionContents(fixture, '0.1.0-alpha.03'),
    /semantic version/u,
  )
  assert.throws(
    () => setVersionContents(fixture, '0.1.0-RC.1'),
    /semantic version/u,
  )
  assert.throws(
    () =>
      artifactFilename(
        {
          component: 'desktop',
          platform: 'windows',
          architecture: 'x64',
          artifactType: 'exe',
        },
        '0.1.0-RC.1',
      ),
    /Invalid artifact identity/u,
  )
  assert.throws(
    () => setVersionContents(fixture, '0.1.0-alpha-beta.1'),
    /semantic version/u,
  )
  assert.throws(
    () =>
      setVersionContents(
        { ...fixture, posix: '[package]\nname = "broken"\n' },
        '0.1.0-alpha.3',
      ),
    /Invalid Cargo version/u,
  )
})
