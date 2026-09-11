export function packageSmokeScripts(platform = process.platform) {
  const scripts = ['./package-smoke.mjs']
  if (platform === 'win32') scripts.push('./lifecycle-smoke.mjs')
  return scripts
}
