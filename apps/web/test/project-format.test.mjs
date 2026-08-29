import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compactProjectPath,
  projectFolderName,
} from '../.tmp/test-dist/components/projects/project-format.js'

test('Project folder presentation preserves Unicode, spaces, and trailing separators', () => {
  assert.equal(
    projectFolderName('C:\\Users\\lyfff\\项目测试\\我的 Agent 项目\\'),
    '我的 Agent 项目',
  )
  assert.equal(
    projectFolderName('/Users/dev/Code Tether Test/'),
    'Code Tether Test',
  )
})

test('filesystem roots retain their identifying separators', () => {
  for (const rootPath of ['/', 'C:\\', 'C:/']) {
    assert.equal(projectFolderName(rootPath), rootPath)
    assert.equal(compactProjectPath(rootPath), rootPath)
  }
})

test('UNC share roots retain their server, share, and optional trailing separator', () => {
  for (const rootPath of [
    '\\\\server\\share',
    '\\\\server\\share\\',
    '//server/share',
    '//server/share/',
  ]) {
    assert.equal(projectFolderName(rootPath), rootPath)
    assert.equal(compactProjectPath(rootPath), rootPath)
  }

  assert.equal(
    projectFolderName('\\\\server\\share\\team\\project\\'),
    'project',
  )
})

test('long Project paths keep their root and nearest context without mutating the source', () => {
  const windowsPath =
    'C:\\Users\\Administrator\\Documents\\Projects\\Code Tether Test'
  const unicodePath = 'C:\\Users\\lyfff\\项目测试\\我的 Agent 项目'

  assert.equal(
    compactProjectPath(windowsPath),
    'C:\\…\\Projects\\Code Tether Test',
  )
  assert.equal(
    compactProjectPath(unicodePath),
    'C:\\…\\项目测试\\我的 Agent 项目',
  )
  assert.equal(windowsPath.includes('Administrator'), true)
})

test('short and POSIX Project paths remain readable', () => {
  assert.equal(
    compactProjectPath('C:\\workspaces\\alpha'),
    'C:\\workspaces\\alpha',
  )
  assert.equal(compactProjectPath('/Users/dev/work/alpha'), '/…/work/alpha')
})

test('long UNC paths retain their share root and nearest context', () => {
  assert.equal(
    compactProjectPath(
      '\\\\server\\share\\customers\\northwind\\workspace\\frontend',
    ),
    '\\\\server\\share\\…\\workspace\\frontend',
  )
  assert.equal(
    compactProjectPath('//server/share/customers/northwind/workspace/frontend'),
    '//server/share/…/workspace/frontend',
  )
})
