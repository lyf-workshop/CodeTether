import { readFileSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const sourceRoot = fileURLToPath(
  new URL('../../../../packages/ui/src/', import.meta.url),
)
const cache = new Map()

// Exercise the real shared TSX components without a browser or a second build.
export function loadUiComponent(relativePath) {
  return load(resolve(sourceRoot, relativePath))
}

function load(path) {
  const filename = [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    resolve(path, 'index.ts'),
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
  if (!filename) throw new Error(`UI test module was not found: ${path}`)
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const requireDependency = createRequire(filename)
  const localRequire = (specifier) => {
    if (specifier.startsWith('@codetether/ui/'))
      return load(
        resolve(sourceRoot, specifier.slice('@codetether/ui/'.length)),
      )
    if (specifier.startsWith('.'))
      return load(resolve(dirname(filename), specifier))
    return requireDependency(specifier)
  }
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2023,
    },
    fileName: filename,
  })
  new Function('require', 'module', 'exports', outputText)(
    localRequire,
    module,
    module.exports,
  )
  return module.exports
}
