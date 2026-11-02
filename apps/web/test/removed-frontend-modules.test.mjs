import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const webRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(webRoot, 'src')
const removedModules = [
  'components/hosts/host-directory-page.tsx',
  'components/hosts/remote-host-page.tsx',
  'components/hosts/requesting-device-presentation.ts',
  'components/hosts/index.ts',
  'runtime/account/remote-conversation-read-model.ts',
  'components/conversation/conversation-rail.tsx',
  'components/conversation/conversation-rail-search.tsx',
  'components/conversation/conversation-rail-search-model.ts',
  'components/conversation/demo-conversation-adapter.ts',
  'mocks/conversation-detail.ts',
  'mocks/conversations.ts',
  'components/conversations/conversations-page.tsx',
  'components/conversations/project-conversations-route.tsx',
  'components/conversations/conversation-page-states.tsx',
  'components/conversations/project-summary.tsx',
  'components/conversations/new-conversation-presentation.ts',
  'runtime/host/conversation-list-view-state.ts',
  'components/projects/projects-page.tsx',
  'components/projects/project-locations-section.tsx',
  'components/projects/add-project-location-dialog.tsx',
  'components/projects/project-row.tsx',
  'components/projects/project-availability-badge.tsx',
  'components/projects/project-page-states.tsx',
  'components/inbox/inbox-filters.tsx',
  'components/app-shell/route-placeholder.tsx',
]

test('removed legacy frontend modules stay absent without removing canonical runtime or location removal', () => {
  for (const path of removedModules)
    assert.equal(existsSync(resolve(sourceRoot, path)), false, path)
  for (const path of [
    'runtime/account/remote-supervisor.ts',
    'runtime/account/control-plane-client.ts',
    'runtime/account/local-supervisor-presence.tsx',
    'runtime/host/host-runtime.ts',
    'components/projects/project-location-removal-action.tsx',
    'components/projects/remove-project-location-dialog.tsx',
  ])
    assert.equal(existsSync(resolve(sourceRoot, path)), true, path)
})

test('the main frontend import graph has no dangling local module or nonliteral dynamic import', () => {
  const config = ts.readConfigFile(
    resolve(webRoot, 'tsconfig.app.json'),
    ts.sys.readFile,
  )
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, webRoot)
  const visited = new Set()
  const unresolved = []
  const dynamic = []
  function visit(file) {
    if (visited.has(file) || !file.startsWith(sourceRoot)) return
    visited.add(file)
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    function walk(node) {
      let specifier
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        specifier = node.moduleSpecifier.text
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        if (
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0])
        )
          specifier = node.arguments[0].text
        else dynamic.push(file)
      }
      if (specifier) {
        const dependency = ts.resolveModuleName(
          specifier,
          file,
          parsed.options,
          ts.sys,
        ).resolvedModule
        if (dependency && /\.[cm]?tsx?$/u.test(dependency.resolvedFileName))
          visit(resolve(dependency.resolvedFileName))
        else if (
          specifier.startsWith('.') &&
          !/\.(css|svg|png)$/u.test(specifier)
        )
          unresolved.push({ file, specifier })
      }
      ts.forEachChild(node, walk)
    }
    walk(source)
  }
  visit(resolve(sourceRoot, 'main.tsx'))
  assert.deepEqual(unresolved, [])
  assert.deepEqual(dynamic, [])
  for (const path of removedModules)
    assert.equal(visited.has(resolve(sourceRoot, path)), false, path)
  assert.equal(
    visited.has(
      resolve(
        sourceRoot,
        'components/projects/remove-project-location-dialog.tsx',
      ),
    ),
    true,
  )
})
