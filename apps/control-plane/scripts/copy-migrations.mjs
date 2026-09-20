import { cp, mkdir, rm } from 'node:fs/promises'

await rm(new URL('../dist/migrations/', import.meta.url), {
  force: true,
  recursive: true,
})
await mkdir(new URL('../dist/migrations/', import.meta.url), {
  recursive: true,
})
await cp(
  new URL('../migrations/', import.meta.url),
  new URL('../dist/migrations/', import.meta.url),
  { recursive: true },
)
