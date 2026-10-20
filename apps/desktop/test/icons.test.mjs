import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { inflateSync } from 'node:zlib'

const iconsDirectory = resolve(import.meta.dirname, '../src-tauri/icons')
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function readPng(bytes, size) {
  assert.deepEqual(bytes.subarray(0, 8), pngSignature)
  let position = 8
  const chunks = []
  const compressed = []
  while (position < bytes.length) {
    assert.ok(position + 12 <= bytes.length, 'complete PNG chunk header')
    const length = bytes.readUInt32BE(position)
    const end = position + 12 + length
    assert.ok(end <= bytes.length, 'PNG chunk remains inside its image')
    const type = bytes.toString('ascii', position + 4, position + 8)
    const data = bytes.subarray(position + 8, end - 4)
    assert.equal(
      crc32(bytes.subarray(position + 4, end - 4)),
      bytes.readUInt32BE(end - 4),
    )
    if (type === 'IHDR') {
      assert.equal(length, 13)
      assert.equal(data.readUInt32BE(0), size)
      assert.equal(data.readUInt32BE(4), size)
      assert.deepEqual(
        [...data.subarray(8)],
        [8, 6, 0, 0, 0],
        '8-bit non-interlaced RGBA',
      )
    }
    if (type === 'IDAT') compressed.push(data)
    chunks.push(type)
    position = end
  }
  assert.equal(chunks[0], 'IHDR')
  assert.equal(chunks.at(-1), 'IEND')
  assert.equal(chunks.filter((type) => type === 'IHDR').length, 1)
  assert.equal(chunks.filter((type) => type === 'IEND').length, 1)
  const scanlines = inflateSync(Buffer.concat(compressed))
  const stride = size * 4
  assert.equal(scanlines.length, (stride + 1) * size)
  const pixels = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y += 1) {
    const filter = scanlines[y * (stride + 1)]
    assert.ok(filter <= 4, 'valid PNG scanline filter')
    for (let x = 0; x < stride; x += 1) {
      const index = y * stride + x
      const left = x >= 4 ? pixels[index - 4] : 0
      const above = y > 0 ? pixels[index - stride] : 0
      const upperLeft = y > 0 && x >= 4 ? pixels[index - stride - 4] : 0
      const estimate = left + above - upperLeft
      const distances = [left, above, upperLeft].map((value) =>
        Math.abs(estimate - value),
      )
      const paeth =
        distances[0] <= distances[1] && distances[0] <= distances[2]
          ? left
          : distances[1] <= distances[2]
            ? above
            : upperLeft
      const predictor = [0, left, above, Math.floor((left + above) / 2), paeth][
        filter
      ]
      pixels[index] = scanlines[y * (stride + 1) + x + 1] + predictor
    }
  }
  return (x, y) => [
    ...pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
  ]
}

function readIco(bytes) {
  assert.equal(bytes.readUInt16LE(0), 0)
  assert.equal(bytes.readUInt16LE(2), 1)
  assert.equal(bytes.readUInt16LE(4), 6)
  let imagePosition = 6 + 6 * 16
  const layers = new Map()
  for (let index = 0; index < 6; index += 1) {
    const position = 6 + index * 16
    const size = bytes[position] || 256
    assert.equal(bytes[position + 1] || 256, size)
    assert.equal(bytes[position + 2], 0)
    assert.equal(bytes[position + 3], 0)
    assert.equal(bytes.readUInt16LE(position + 4), 1)
    assert.equal(bytes.readUInt16LE(position + 6), 32)
    const length = bytes.readUInt32LE(position + 8)
    assert.equal(bytes.readUInt32LE(position + 12), imagePosition)
    assert.ok(imagePosition + length <= bytes.length)
    assert.ok(!layers.has(size), 'no duplicate ICO dimensions')
    layers.set(size, bytes.subarray(imagePosition, imagePosition + length))
    imagePosition += length
  }
  assert.equal(
    imagePosition,
    bytes.length,
    'no trailing or unreferenced ICO payload',
  )
  return layers
}

test('approved kite SVG sources remain reproducible without changing their artwork', async () => {
  const hashes = {
    'codetether-app.svg':
      '2e3dcd6501b6f3f27431b6f6c61d82701093416a905af6ee9c09eb960d1b8644',
    'codetether-app-small.svg':
      'd01143ad147143ce0deea71fed406a4d2d95245d27b997baa2a985f42f895562',
    'codetether-app-macos.svg':
      '5e8f4a6d719508a11ebd0a8c49f84d0f3da9f80596f5b8cdbc6dd9a50ff56109',
  }
  for (const [name, expectedHash] of Object.entries(hashes)) {
    const source = (
      await readFile(resolve(iconsDirectory, 'source', name), 'utf8')
    ).replace(/\r\n/gu, '\n')
    assert.equal(
      createHash('sha256').update(source).digest('hex'),
      expectedHash,
    )
    assert.match(source, /^<svg\s/u)
    assert.doesNotMatch(source, /<script|<image|<foreignObject|(?:href|src)=/iu)
  }
})

test('standalone app PNGs have the requested RGBA sizes and transparent corners', async () => {
  for (const [name, size] of [
    ['128x128.png', 128],
    ['128x128@2x.png', 256],
    ['icon.png', 512],
  ]) {
    const pixel = readPng(await readFile(resolve(iconsDirectory, name)), size)
    assert.equal(pixel(0, 0)[3], 0)
    assert.equal(pixel(size - 1, size - 1)[3], 0)
    assert.equal(pixel(size / 2, size / 2)[3], 255)
  }
})

test('Windows ICO keeps all six PNG layers with the 32px Tauri default first', async () => {
  const layers = readIco(await readFile(resolve(iconsDirectory, 'icon.ico')))
  assert.deepEqual([...layers.keys()], [32, 16, 24, 48, 64, 256])
  for (const [size, bytes] of layers) {
    const pixel = readPng(bytes, size)
    assert.equal(pixel(0, 0)[3], 0)
  }
  assert.deepEqual(
    layers.get(256),
    await readFile(resolve(iconsDirectory, '128x128@2x.png')),
  )
  const pixel = readPng(layers.get(16), 16)
  assert.deepEqual(
    pixel(9, 5),
    [255, 192, 97, 255],
    'hinted yellow kite face stays distinct at 16px',
  )
  assert.deepEqual(
    pixel(11, 5),
    [242, 100, 63, 255],
    'hinted red kite face stays distinct at 16px',
  )
  assert.deepEqual(
    pixel(3, 13),
    [244, 239, 230, 255],
    'hinted lower-left string endpoint remains visible',
  )
})

test('ICNS contains eleven dimension-correct PNG types including every standard 2x layer', async () => {
  const bytes = await readFile(resolve(iconsDirectory, 'icon.icns'))
  assert.equal(bytes.toString('ascii', 0, 4), 'icns')
  assert.equal(bytes.readUInt32BE(4), bytes.length)
  const expected = new Map([
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512],
  ])
  const actual = new Map()
  let position = 8
  while (position < bytes.length) {
    assert.ok(position + 8 <= bytes.length)
    const type = bytes.toString('ascii', position, position + 4)
    const length = bytes.readUInt32BE(position + 4)
    assert.ok(length > 8 && position + length <= bytes.length)
    assert.ok(expected.has(type), `recognized PNG ICNS type ${type}`)
    assert.ok(!actual.has(type), 'no duplicate ICNS types')
    const size = expected.get(type)
    const pixel = readPng(bytes.subarray(position + 8, position + length), size)
    assert.equal(
      pixel(Math.floor(size / 2), 0)[3],
      0,
      'macOS outer margin stays transparent',
    )
    assert.equal(pixel(0, Math.floor(size / 2))[3], 0)
    assert.equal(pixel(Math.floor(size / 2), Math.floor(size / 2))[3], 255)
    actual.set(type, size)
    position += length
  }
  assert.equal(position, bytes.length)
  assert.deepEqual([...actual].sort(), [...expected].sort())
})
