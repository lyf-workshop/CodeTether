import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { buildIdentity, repository } from './identity.mjs'

const identity = buildIdentity({ requireClean: true })
const runId = `${identity.commit.slice(0, 12)}-${new Date().toISOString().replaceAll(':', '-')}`
const directory = join(
  repository,
  'output',
  'playwright',
  'phase8d',
  'final-evidence',
  runId,
)
await mkdir(directory, { recursive: true })
const pnpm =
  process.env.npm_execpath ??
  join(
    process.env.PNPM_HOME ?? dirname(process.execPath),
    'node_modules',
    'pnpm',
    'bin',
    'pnpm.mjs',
  )
const gates = [
  'typecheck',
  'lint',
  'format:check',
  'build',
  'test',
  'desktop:build',
].map((name) => ({ name, executable: process.execPath, args: [pnpm, name] }))
const cargo = join(
  homedir(),
  '.cargo',
  'bin',
  process.platform === 'win32' ? 'cargo.exe' : 'cargo',
)
for (const [name, args] of [
  ['cargo-fmt', ['fmt', '--all', '--', '--check']],
  ['cargo-check', ['check', '--all-targets', '--locked']],
  [
    'cargo-clippy',
    [
      'clippy',
      '--all-targets',
      '--all-features',
      '--locked',
      '--',
      '-D',
      'warnings',
    ],
  ],
  ['cargo-test', ['test', '--locked']],
])
  gates.push({
    name,
    executable: cargo,
    args: [
      args[0],
      '--manifest-path',
      join(repository, 'apps', 'desktop', 'src-tauri', 'Cargo.toml'),
      ...args.slice(1),
    ],
  })
const results = []
for (const gate of gates) {
  const start = Date.now()
  const stream = createWriteStream(
    join(directory, `${gate.name.replaceAll(':', '-')}.log`),
    { flags: 'wx' },
  )
  process.stdout.write(`Starting ${gate.name}\n`)
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(gate.executable, gate.args, {
      cwd: repository,
      shell: false,
      windowsHide: true,
      env: { ...process.env, CARGO_BUILD_JOBS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.pipe(stream, { end: false })
    child.stderr.pipe(stream, { end: false })
    child.once('error', reject)
    child.once('close', (code) => stream.end(() => resolveCode(code)))
  })
  results.push({
    gate: gate.name,
    status: code === 0 ? 'PASS' : 'FAIL',
    exitCode: code,
    durationMs: Date.now() - start,
  })
  await writeFile(
    join(directory, 'implementation-gates.json'),
    `${JSON.stringify({ classification: 'AUTOMATED', ...identity, platform: process.platform, architecture: process.arch, results }, null, 2)}\n`,
  )
  process.stdout.write(`${gate.name}: ${code === 0 ? 'PASS' : 'FAIL'}\n`)
  if (code !== 0) {
    process.exitCode = 1
    break
  }
}
process.stdout.write(
  `Receipt directory: output/playwright/phase8d/final-evidence/${runId}\n`,
)
