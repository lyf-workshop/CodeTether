import { loadEnv } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function desktopAccountConfigErrors(environment) {
  const errors = []
  const supabaseUrl = environment.VITE_SUPABASE_URL?.trim()
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  const controlPlaneUrl = environment.VITE_CODETETHER_CONTROL_PLANE_URL?.trim()

  for (const [name, value] of [
    ['VITE_SUPABASE_URL', supabaseUrl],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', publishableKey],
    ['VITE_CODETETHER_CONTROL_PLANE_URL', controlPlaneUrl],
  ]) {
    if (!value) errors.push(`${name} is missing`)
  }

  if (supabaseUrl && !validOrigin(supabaseUrl))
    errors.push('VITE_SUPABASE_URL is invalid')
  if (
    publishableKey &&
    (publishableKey.length > 512 ||
      !publishableKey.startsWith('sb_publishable_'))
  ) {
    errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is invalid')
  }
  if (controlPlaneUrl && !validOrigin(controlPlaneUrl))
    errors.push('VITE_CODETETHER_CONTROL_PLANE_URL is invalid')

  return errors
}

function validOrigin(value) {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) &&
      !url.username &&
      !url.password &&
      url.origin === value.replace(/\/+$/u, '')
    )
  } catch {
    return false
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const errors = desktopAccountConfigErrors(
    loadEnv('production', webDirectory, 'VITE_'),
  )
  if (errors.length > 0) {
    process.stderr.write(
      `Desktop account configuration: ${errors.join('; ')}.\n`,
    )
    process.exitCode = 1
  }
}
