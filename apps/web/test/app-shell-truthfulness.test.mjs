import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const componentDirectory = new URL(
  '../src/components/app-shell/',
  import.meta.url,
)

test('Primary Sidebar does not present fixture Machines as live product state', async () => {
  const source = await readFile(
    new URL('primary-sidebar.tsx', componentDirectory),
    'utf8',
  )

  assert.doesNotMatch(source, /machinePresences|showMockMachines/u)
  assert.doesNotMatch(source, /MacBook Pro|开发服务器|树莓派设备/u)
})

test('Top Bar only renders optional product controls with real handlers', async () => {
  const source = await readFile(
    new URL('top-bar.tsx', componentDirectory),
    'utf8',
  )

  assert.match(source, /onSearch === undefined \? null/u)
  assert.match(source, /onNotifications === undefined \? null/u)
  assert.match(source, /onHelp === undefined \? null/u)
  assert.match(
    source,
    /onProfile === undefined \|\| profile === undefined \? null/u,
  )
  assert.doesNotMatch(source, /defaultProfile|演示用户/u)
})
