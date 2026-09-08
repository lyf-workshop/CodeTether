import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generateService,
  servicePaths,
  checkNoSymlinks,
} from '../dist/service-installation.js'

test('user units serialize absolute paths without shell interpolation or secrets', () => {
  const paths = servicePaths(
    'linux',
    process.platform === 'win32'
      ? 'C:\\Test User\\项目'
      : '/home/Test User/项目',
  )
  paths.executable += '$%"<>&'
  const unit = generateService('linux', paths)
  assert.match(unit, /ExecStart="/u)
  assert.match(unit, /\$\$%%/u)
  assert.match(unit, /KillMode=control-group/u)
  assert.match(unit, /UMask=0077/u)
  assert.doesNotMatch(
    unit,
    /User=root|\/bin\/sh|ANTHROPIC|TOKEN|--pair|0\.0\.0\.0/u,
  )
  const plist = generateService('darwin', paths)
  assert.match(plist, /&quot;&lt;&gt;&amp;/u)
  assert.match(plist, /ProgramArguments/u)
  assert.match(plist, /<integer>63<\/integer>/u)
  assert.doesNotMatch(plist, /zshrc|bashrc|TOKEN|--pair/u)
  assert.throws(() => generateService('linux', { ...paths, data: 'relative' }))
  assert.throws(() =>
    generateService('darwin', { ...paths, data: '/tmp/bad\npath' }),
  )
})
test(
  'installation rejects symlink targets without touching preserved state',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'codetether-service-test-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await mkdir(join(directory, 'real'))
    await symlink(join(directory, 'real'), join(directory, 'alias'))
    await assert.rejects(
      checkNoSymlinks(join(directory, 'alias', 'key')),
      /symlink/u,
    )
    await checkNoSymlinks(join(directory, 'real', 'key'))
  },
)
