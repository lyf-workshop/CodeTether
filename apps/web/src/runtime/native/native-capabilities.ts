export interface DirectoryPicker {
  readonly available: boolean
  pickDirectory(): Promise<string | null>
}

export interface NativeCapabilities {
  readonly directoryPicker: DirectoryPicker
}

interface TauriCoreModule {
  invoke<T>(command: string): Promise<T>
}

type TauriCoreLoader = () => Promise<TauriCoreModule>

interface NativeCapabilitiesOptions {
  loadTauriCore?: TauriCoreLoader
  tauriAvailable?: boolean
}

const loadTauriCore: TauriCoreLoader = async () =>
  await import('@tauri-apps/api/core')

const unavailableDirectoryPicker: DirectoryPicker = {
  available: false,
  pickDirectory: () =>
    Promise.reject(new Error('Native directory selection is unavailable.')),
}

/** Tauri v2 exposes this public marker even when `withGlobalTauri` is off. */
export function hasTauriRuntime(scope: unknown = globalThis): boolean {
  return (
    typeof scope === 'object' &&
    scope !== null &&
    'isTauri' in scope &&
    scope.isTauri === true
  )
}

export function createNativeCapabilities(
  options: NativeCapabilitiesOptions = {},
): NativeCapabilities {
  const tauriAvailable = options.tauriAvailable ?? hasTauriRuntime()
  if (!tauriAvailable) {
    return { directoryPicker: unavailableDirectoryPicker }
  }

  const loadCore = options.loadTauriCore ?? loadTauriCore
  let inFlight: Promise<string | null> | undefined

  const directoryPicker: DirectoryPicker = {
    available: true,
    pickDirectory() {
      if (inFlight !== undefined) return inFlight

      const request = loadCore()
        .then(
          async ({ invoke }) =>
            await invoke<string | null>('pick_project_directory'),
        )
        .then((selected) => {
          if (selected === null || typeof selected === 'string') {
            return selected
          }
          throw new Error('Native directory picker returned an invalid value.')
        })

      const trackedRequest = request.finally(() => {
        if (inFlight === trackedRequest) inFlight = undefined
      })
      inFlight = trackedRequest
      return trackedRequest
    },
  }

  return { directoryPicker }
}

export const nativeCapabilities = createNativeCapabilities()
