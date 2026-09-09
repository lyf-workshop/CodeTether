import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('Run workspace tests through pnpm test')

// Fixture Projects cross the same exact canonical-root boundaries as real
// registered Locations. macOS commonly supplies a /var alias for /private/var;
// make newly created test roots canonical without relaxing product validation.
const environment = { ...process.env }
if (process.platform === 'darwin') environment.TMPDIR = realpathSync(tmpdir())

const result = spawnSync(
  process.execPath,
  [
    pnpm,
    '-r',
    '--workspace-concurrency=1',
    '--if-present',
    'test',
    ...process.argv.slice(2),
  ],
  { env: environment, stdio: 'inherit', shell: false },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
