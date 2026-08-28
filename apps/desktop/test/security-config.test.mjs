import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const desktopDirectory = resolve(import.meta.dirname, '..')
const repositoryDirectory = resolve(desktopDirectory, '..', '..')

test('production Desktop CSP and capabilities stay loopback-only and non-wildcard', async () => {
  const config = JSON.parse(
    await readFile(
      resolve(desktopDirectory, 'src-tauri', 'tauri.conf.json'),
      'utf8',
    ),
  )
  const capability = JSON.parse(
    await readFile(
      resolve(desktopDirectory, 'src-tauri', 'capabilities', 'main.json'),
      'utf8',
    ),
  )

  assert.deepEqual(capability.permissions, [])
  assert.deepEqual(config.bundle.externalBin, ['binaries/codetether-host'])
  assert.equal(config.app.windows[0].visible, false)
  assert.equal(config.app.windows[0].center, true)
  assert.equal(config.app.windows[0].backgroundColor, '#07111f')
  assert.equal(config.app.windows[0].useHttpsScheme, false)
  assert.match(
    config.app.security.csp['connect-src'],
    /http:\/\/127\.0\.0\.1:4317/u,
  )
  assert.doesNotMatch(
    JSON.stringify(config.app.security.csp),
    /(?:^|[\s"'])\*(?:$|[\s"'])/u,
  )
  assert.equal(config.app.security.csp['base-uri'], "'none'")
  assert.equal(config.app.security.csp['form-action'], "'none'")
  assert.equal(config.app.security.csp['frame-ancestors'], "'none'")
  assert.equal(config.app.withGlobalTauri, false)
})

test('Web UI has no native shell bridge or Desktop-only component fork', async () => {
  const webPackage = JSON.parse(
    await readFile(
      resolve(repositoryDirectory, 'apps', 'web', 'package.json'),
      'utf8',
    ),
  )
  const desktopRustDirectory = resolve(desktopDirectory, 'src-tauri', 'src')
  const rustFiles = (
    await readdir(desktopRustDirectory, {
      recursive: true,
      withFileTypes: true,
    })
  ).filter((entry) => entry.isFile() && entry.name.endsWith('.rs'))
  const desktopRust = (
    await Promise.all(
      rustFiles.map((entry) =>
        readFile(resolve(entry.parentPath, entry.name), 'utf8'),
      ),
    )
  ).join('\n')

  assert.equal(webPackage.dependencies?.['@tauri-apps/api'], undefined)
  assert.doesNotMatch(desktopRust, /run_command|invoke_handler/u)
  assert.match(desktopRust, /CODETETHER_DESKTOP_MANAGED/u)
  assert.match(desktopRust, /http:\/\/tauri\.localhost/u)
})
