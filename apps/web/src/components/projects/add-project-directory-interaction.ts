import type { DirectoryPicker } from '../../runtime/native/native-capabilities.js'

export type ProjectDirectoryPickOutcome =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'error' }
  | { readonly kind: 'selected'; readonly path: string }

/**
 * Keeps the native dialog result and focus-return semantics testable without
 * making the Add Project UI understand Tauri-specific errors or values.
 */
export async function runProjectDirectoryPicker(
  directoryPicker: DirectoryPicker,
  restoreFocus: () => void,
): Promise<ProjectDirectoryPickOutcome> {
  try {
    const selected = await directoryPicker.pickDirectory()
    return selected === null
      ? { kind: 'cancelled' }
      : { kind: 'selected', path: selected }
  } catch {
    return { kind: 'error' }
  } finally {
    restoreFocus()
  }
}
