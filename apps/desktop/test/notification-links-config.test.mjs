import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const desktop = resolve(import.meta.dirname, '..')
const read = (path) => readFile(resolve(desktop, 'src-tauri', path), 'utf8')

test('only the Windows installer declares the exact CodeTether protocol', async () => {
  const windows = JSON.parse(await read('tauri.windows.conf.json'))
  const base = JSON.parse(await read('tauri.conf.json'))
  const macos = JSON.parse(await read('tauri.macos.conf.json'))
  assert.deepEqual(windows.plugins, {
    'deep-link': { desktop: { schemes: ['codetether'] } },
  })
  assert.equal(base.plugins?.['deep-link'], undefined)
  assert.equal(macos.plugins?.['deep-link'], undefined)
  assert.equal(base.bundle.windows.nsis.installMode, 'currentUser')
  assert.equal(base.bundle.windows.nsis.installerHooks, undefined)
})

test('official protocol forwarding is Windows-only and never registers at runtime', async () => {
  const cargo = await read('Cargo.toml')
  const supervisor = await read('src/host_supervisor.rs')
  const links = await read('src/notification_links.rs')
  const capability = JSON.parse(await read('capabilities/main.json'))
  const windows = cargo.split("[target.'cfg(windows)'.dependencies]")[1]
  assert.match(windows, /tauri-plugin-deep-link = "=2\.4\.9"/u)
  assert.match(
    windows,
    /tauri-plugin-single-instance = \{ version = "=2\.4\.3", features = \["deep-link"\] \}/u,
  )
  assert.ok(
    supervisor.indexOf('.plugin(tauri_plugin_single_instance::init(') <
      supervisor.indexOf('.plugin(tauri_plugin_deep_link::init())'),
  )
  assert.match(
    supervisor,
    /#\[cfg\(windows\)\]\s*let builder = builder\.plugin\(tauri_plugin_deep_link::init\(\)\)/u,
  )
  assert.match(
    supervisor,
    /handle_arguments\(app, &args\)[\s\S]*return;[\s\S]*show_main_window\(app\)/u,
  )
  assert.ok(
    supervisor.indexOf('handle_arguments(&app, &std::env::args()') >
      supervisor.indexOf('log_lifecycle_event("desktop_ready"'),
  )
  assert.doesNotMatch(
    supervisor + links,
    /register_all\(|\.register\(|on_open_url\(|get_current\(/u,
  )
  assert.doesNotMatch(
    JSON.stringify(capability.permissions),
    /deep-link|shell:|process:/u,
  )
  assert.doesNotMatch(
    links,
    /invoke|resolve_attention|approve|start_turn|\.navigate/u,
  )
})
