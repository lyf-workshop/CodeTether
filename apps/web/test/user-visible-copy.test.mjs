import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { relative } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const sourceRoots = [
  new URL('../src/', import.meta.url),
  new URL('../../../packages/ui/src/', import.meta.url),
]
const forbiddenCopy =
  /智能体|推理后端|此电脑|\bProvider\b|这台电脑操作|Node显示|在Node|检查Node|Node版本/u

/** Ignore implementation identifiers/imports and internal typed-error diagnostics. */
function isVisibleLiteral(node) {
  if (
    !ts.isStringLiteralLike(node) &&
    !ts.isJsxText(node) &&
    !ts.isTemplateHead(node) &&
    !ts.isTemplateMiddle(node) &&
    !ts.isTemplateTail(node)
  )
    return false
  const parent = node.parent
  if (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  )
    return false
  if (ts.isNewExpression(parent) && /Error$/u.test(parent.expression.getText()))
    return false
  return true
}

async function sourceFiles(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(
      entry.name + (entry.isDirectory() ? '/' : ''),
      directory,
    )
    if (entry.isDirectory()) result.push(...(await sourceFiles(url)))
    else if (/\.tsx?$/u.test(entry.name)) result.push(url)
  }
  return result
}

test('visible Web and UI copy avoids legacy technical terms and mechanical replacement remnants', async () => {
  const violations = []
  for (const sourceRoot of sourceRoots) {
    for (const url of await sourceFiles(sourceRoot)) {
      const source = ts.createSourceFile(
        fileURLToPath(url),
        await readFile(url, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      function visit(node) {
        if (isVisibleLiteral(node) && forbiddenCopy.test(node.text)) {
          const line =
            source.getLineAndCharacterOfPosition(node.getStart()).line + 1
          violations.push(
            `${relative(fileURLToPath(sourceRoot), fileURLToPath(url))}:${line}: ${node.text.trim()}`,
          )
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  assert.deepEqual(violations, [])
})
