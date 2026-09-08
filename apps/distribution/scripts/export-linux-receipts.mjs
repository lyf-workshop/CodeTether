import { cp, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildIdentity, repository } from '../src/identity.mjs'
const identity = buildIdentity({ requireClean: true })
const source = join(repository, 'output', 'release', identity.commit)
const destination = process.argv[2]
if (destination !== '/receipts')
  throw new Error('Unexpected build receipt destination')
for (const filename of await readdir(source)) {
  await cp(join(source, filename), join(destination, filename), {
    errorOnExist: true,
    force: false,
  })
}
