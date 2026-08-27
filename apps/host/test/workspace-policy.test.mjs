import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize, resolve, sep } from 'node:path'
import test from 'node:test'

import {
  WorkspacePolicy,
  WorkspacePolicyError,
} from '../dist/api/workspace-policy.js'

test('empty configured roots allow canonical Project registration', async (t) => {
  const root = await temporaryDirectory(t, 'codetether-policy-')
  const project = join(root, 'project')
  await mkdir(project)
  const policy = await WorkspacePolicy.create([])

  assert.deepEqual(policy.allowedRoots, [])
  const expected = normalize(await realpath(project))
  assert.equal(
    await policy.authorizeProjectRoot(`${project}${sep}.${sep}`),
    expected,
  )
  assert.equal(await policy.authorize(`${project}${sep}`), expected)
})

test('configured roots constrain new Project registration', async (t) => {
  const root = await temporaryDirectory(t, 'codetether-policy-')
  const outside = await temporaryDirectory(t, 'codetether-outside-')
  const child = join(root, 'project')
  const dotPrefixedChild = join(root, '..cache')
  const file = join(root, 'file.txt')
  await mkdir(child)
  await mkdir(dotPrefixedChild)
  await writeFile(file, 'not a directory')

  const policy = await WorkspacePolicy.create([`${root}${sep}.${sep}`])
  assert.deepEqual(policy.allowedRoots, [normalize(await realpath(root))])
  assert.equal(
    await policy.authorizeProjectRoot(child),
    normalize(await realpath(child)),
  )
  assert.equal(
    await policy.authorizeProjectRoot(dotPrefixedChild),
    normalize(await realpath(dotPrefixedChild)),
  )

  await rejectsWithCode(
    () => policy.authorizeProjectRoot('relative'),
    'invalid_path',
  )
  await rejectsWithCode(
    () => policy.authorizeProjectRoot(join(root, 'missing')),
    'unavailable',
  )
  await rejectsWithCode(
    () => policy.authorizeProjectRoot(file),
    'not_directory',
  )
  await rejectsWithCode(
    () => policy.authorizeProjectRoot(outside),
    'outside_configured_roots',
  )
})

test('registration resolves links and rejects a link escaping configured roots', async (t) => {
  const root = await temporaryDirectory(t, 'codetether-policy-')
  const outside = await temporaryDirectory(t, 'codetether-outside-')
  const target = join(root, 'target')
  const insideLink = join(root, 'inside-link')
  const escapeLink = join(root, 'escape-link')
  await mkdir(target)
  if (!(await createDirectoryLink(t, target, insideLink))) return
  if (!(await createDirectoryLink(t, outside, escapeLink))) return

  const policy = await WorkspacePolicy.create([root])
  assert.equal(
    await policy.authorizeProjectRoot(insideLink),
    normalize(await realpath(target)),
  )
  await rejectsWithCode(
    () => policy.authorizeProjectRoot(escapeLink),
    'outside_configured_roots',
  )
})

test('saved Project inspection never throws for unavailable or invalid roots', async (t) => {
  const root = await temporaryDirectory(t, 'codetether-policy-')
  const project = join(root, 'project')
  const file = join(root, 'file.txt')
  await mkdir(project)
  await writeFile(file, 'not a directory')
  const policy = await WorkspacePolicy.create([])
  const savedRoot = await policy.authorizeProjectRoot(project)

  assert.equal(await policy.inspectProjectRoot(savedRoot), 'available')
  assert.equal(
    await policy.inspectProjectRoot(join(root, 'missing')),
    'unavailable',
  )
  assert.equal(await policy.inspectProjectRoot(file), 'unavailable')
  assert.equal(await policy.inspectProjectRoot('relative'), 'unavailable')

  await rm(project, { recursive: true })
  assert.equal(await policy.inspectProjectRoot(savedRoot), 'unavailable')
})

test('saved canonical identity rejects a root retargeted through a link', async (t) => {
  const parent = await temporaryDirectory(t, 'codetether-policy-')
  const outside = await temporaryDirectory(t, 'codetether-outside-')
  const project = join(parent, 'project')
  const child = join(project, 'src')
  await mkdir(child, { recursive: true })
  const policy = await WorkspacePolicy.create([])
  const savedRoot = await policy.authorizeProjectRoot(project)

  await rm(project, { recursive: true })
  if (!(await createDirectoryLink(t, outside, project))) return

  assert.equal(await policy.inspectProjectRoot(savedRoot), 'unavailable')
  await rejectsWithCode(
    () => policy.authorizeProjectWorkspace(savedRoot, project),
    'identity_changed',
  )
})

test('Project workspace authorization is canonical, contained, and directory-only', async (t) => {
  const root = await temporaryDirectory(t, 'codetether-policy-')
  const outside = await temporaryDirectory(t, 'codetether-outside-')
  const project = join(root, 'project')
  const child = join(project, 'src')
  const dotPrefixedChild = join(project, '..cache')
  const file = join(project, 'file.txt')
  await mkdir(child, { recursive: true })
  await mkdir(dotPrefixedChild)
  await writeFile(file, 'not a directory')
  const policy = await WorkspacePolicy.create([])
  const savedRoot = await policy.authorizeProjectRoot(project)

  assert.equal(
    await policy.authorizeProjectWorkspace(savedRoot, `${child}${sep}.${sep}`),
    normalize(await realpath(child)),
  )
  assert.equal(
    await policy.authorizeProjectWorkspace(savedRoot, dotPrefixedChild),
    normalize(await realpath(dotPrefixedChild)),
  )
  await rejectsWithCode(
    () => policy.authorizeProjectWorkspace(savedRoot, outside),
    'outside_project',
  )
  await rejectsWithCode(
    () => policy.authorizeProjectWorkspace(savedRoot, file),
    'not_directory',
  )
  await rejectsWithCode(
    () => policy.authorizeProjectWorkspace(savedRoot, join(project, 'missing')),
    'unavailable',
  )
})

test('Project workspace authorization re-evaluates a retargeted cwd on every call', async (t) => {
  const root = await temporaryDirectory(t, 'codetether-policy-')
  const outside = await temporaryDirectory(t, 'codetether-outside-')
  const project = join(root, 'project')
  const child = join(project, 'src')
  await mkdir(child, { recursive: true })
  const policy = await WorkspacePolicy.create([])
  const savedRoot = await policy.authorizeProjectRoot(project)

  assert.equal(
    await policy.authorizeProjectWorkspace(savedRoot, child),
    normalize(await realpath(child)),
  )
  await rm(child, { recursive: true })
  if (!(await createDirectoryLink(t, outside, child))) return
  await rejectsWithCode(
    () => policy.authorizeProjectWorkspace(savedRoot, child),
    'outside_project',
  )
})

test('canonical identity follows platform path case behavior', async (t) => {
  const root = await temporaryDirectory(t, 'codetether-policycase-')
  const project = join(root, 'project')
  const child = join(project, 'src')
  await mkdir(child, { recursive: true })
  const policy = await WorkspacePolicy.create([])
  const savedRoot = await policy.authorizeProjectRoot(project)

  if (process.platform === 'win32') {
    assert.equal(
      await policy.inspectProjectRoot(savedRoot.toUpperCase()),
      'available',
    )
    assert.equal(
      await policy.authorizeProjectWorkspace(
        savedRoot.toUpperCase(),
        child.toUpperCase(),
      ),
      normalize(await realpath(child)),
    )
    return
  }

  assert.equal(
    await policy.inspectProjectRoot(savedRoot.toUpperCase()),
    'unavailable',
  )
})

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(resolve(tmpdir(), prefix))
  t.after(async () => await rm(directory, { recursive: true, force: true }))
  return directory
}

async function createDirectoryLink(t, target, link) {
  try {
    await symlink(
      target,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    return true
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('Creating directory links is not permitted in this environment')
      return false
    }
    throw error
  }
}

async function rejectsWithCode(operation, code) {
  await assert.rejects(
    operation,
    (error) => error instanceof WorkspacePolicyError && error.code === code,
  )
}
