import { runControlPlane } from './runtime.js'

runControlPlane().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      component: 'control-plane',
      event: 'startup_failed',
    })}\n`,
  )
  process.exitCode = 1
})
