import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile(
  new URL('../../../packages/ui/src/styles/globals.css', import.meta.url),
  'utf8',
)
const declarations = (body) =>
  new Map(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)].map(([, key, value]) => [
      key,
      value.trim(),
    ]),
  )
const common = declarations(/\n:root \{([^}]+)\}/u.exec(css)[1])
const backgrounds = [
  '--background',
  '--navigation',
  '--surface',
  '--surface-muted',
  '--surface-elevated',
  '--surface-inset',
  '--surface-code',
  '--surface-hover',
  '--surface-selected',
  '--primary-muted',
  '--success-muted',
  '--warning-muted',
  '--danger-muted',
  '--status-idle-muted',
  '--status-offline-muted',
]

function resolve(map, name, seen = new Set()) {
  assert.ok(!seen.has(name), `Cyclic alias: ${name}`)
  const value = map.get(name)
  assert.ok(value, `Missing token: ${name}`)
  const alias = /^var\((--[\w-]+)\)$/u.exec(value)
  return alias ? resolve(map, alias[1], new Set([...seen, name])) : value
}

function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/iu)
  const rgb = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    )
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}

for (const theme of ['light', 'dark']) {
  test(`${theme}: muted, idle and offline text meet AA on every used neutral and status surface`, () => {
    const body = new RegExp(
      `\\[data-theme='${theme}'\\] \\{([^}]+)\\}`,
      'u',
    ).exec(css)[1]
    const tokens = new Map([...common, ...declarations(body)])
    for (const foreground of [
      '--text-muted',
      '--status-idle-text',
      '--status-offline-text',
    ]) {
      for (const background of backgrounds) {
        const a = luminance(resolve(tokens, foreground))
        const b = luminance(resolve(tokens, background))
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        assert.ok(
          ratio >= 4.5,
          `${foreground} on ${background}: ${ratio.toFixed(3)}:1`,
        )
      }
    }
    for (const tone of ['warning', 'danger']) {
      for (const background of [
        '--background',
        '--surface',
        `--${tone}-muted`,
      ]) {
        const a = luminance(resolve(tokens, `--${tone}-text`))
        const b = luminance(resolve(tokens, background))
        assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5)
      }
    }
  })
}
