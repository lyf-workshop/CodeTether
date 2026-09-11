import { join } from 'node:path'

export function packagedExecutablePaths(
  desktopDirectory,
  platform = process.platform,
) {
  const releaseDirectory = join(
    desktopDirectory,
    'src-tauri',
    'target',
    'release',
  )
  if (platform === 'darwin') {
    const bundleExecutables = join(
      releaseDirectory,
      'bundle',
      'macos',
      'CodeTether.app',
      'Contents',
      'MacOS',
    )
    return {
      desktop: join(bundleExecutables, 'codetether-desktop'),
      host: join(bundleExecutables, 'codetether-host'),
    }
  }
  return {
    desktop: join(
      releaseDirectory,
      platform === 'win32' ? 'codetether-desktop.exe' : 'codetether-desktop',
    ),
    host: join(
      releaseDirectory,
      platform === 'win32' ? 'codetether-host.exe' : 'codetether-host',
    ),
  }
}
