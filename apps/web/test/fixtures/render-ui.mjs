import { readFileSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const sourceRoot = fileURLToPath(
  new URL('../../../../packages/ui/src/', import.meta.url),
)
const webSourceRoot = fileURLToPath(new URL('../../src/', import.meta.url))
const cache = new Map()

export function loadUiComponent(relativePath) {
  return load(resolve(sourceRoot, relativePath))
}

export function loadWebComponent(relativePath, dependencies = new Map()) {
  return load(
    resolve(webSourceRoot, relativePath),
    dependencies,
    dependencies.size > 0 ? new Map() : cache,
  )
}

function load(path, dependencies = new Map(), moduleCache = cache) {
  if (path.endsWith('.js')) path = path.slice(0, -3)
  const filename = [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    resolve(path, 'index.ts'),
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
  if (!filename) throw new Error(`UI test module was not found: ${path}`)
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports
  const module = { exports: {} }
  moduleCache.set(filename, module)
  const requireDependency = createRequire(filename)
  const localRequire = (specifier) => {
    if (dependencies.has(specifier)) return dependencies.get(specifier)
    if (
      specifier === '@codetether/protocol' ||
      specifier === '@codetether/client'
    )
      return requireDependency(
        resolve(
          sourceRoot,
          '../..',
          specifier.slice('@codetether/'.length),
          'dist/index.js',
        ),
      )
    if (specifier === '@codetether/ui')
      return load(resolve(sourceRoot, 'index.ts'), dependencies, moduleCache)
    if (specifier.startsWith('@codetether/ui/'))
      return load(
        resolve(sourceRoot, specifier.slice('@codetether/ui/'.length)),
        dependencies,
        moduleCache,
      )
    if (specifier.startsWith('.'))
      return load(
        resolve(dirname(filename), specifier),
        dependencies,
        moduleCache,
      )
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
