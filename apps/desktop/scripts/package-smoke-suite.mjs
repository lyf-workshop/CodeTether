import { packageSmokeScripts } from './package-smoke-targets.mjs'

for (const script of packageSmokeScripts()) {
  await import(script)
}
