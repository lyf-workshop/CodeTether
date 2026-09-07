import {
  prepareClaudeCode,
  resolveClaudeCodeLauncher,
  type ClaudeCodeLauncher,
  type ClaudeCodePreparation,
  type ClaudeCodeProcessOwnership,
} from '@codetether/adapter-claude'

export interface NodeClaudeInstallationOptions {
  readonly environment?: NodeJS.ProcessEnv
  /** Internal deterministic-test seam; never populated from Machine input. */
  readonly resolveLauncher?: (
    environment: NodeJS.ProcessEnv,
  ) => Promise<ClaudeCodeLauncher>
}

export interface NodeClaudePreparationOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly processOwnership?: ClaudeCodeProcessOwnership
}

/**
 * Selects one Claude installation after the first successful PATH resolution.
 *
 * Provider health may be re-probed, but version observation and later remote
 * execution retain this exact canonical launcher until the Node restarts. A
 * changed PATH or shim therefore cannot silently move an admitted Turn to a
 * second installation. Failed resolution is not cached, so installing Claude
 * while an idle Node is running remains recoverable through the existing
 * bounded Provider refresh.
 */
export class NodeClaudeInstallation {
  readonly #environment: NodeJS.ProcessEnv
  readonly #resolveLauncher: (
    environment: NodeJS.ProcessEnv,
  ) => Promise<ClaudeCodeLauncher>
  #launcher: ClaudeCodeLauncher | undefined
  #resolution: Promise<ClaudeCodeLauncher> | undefined

  constructor(options: NodeClaudeInstallationOptions = {}) {
    this.#environment = { ...(options.environment ?? process.env) }
    this.#resolveLauncher =
      options.resolveLauncher ??
      (async (environment) => await resolveClaudeCodeLauncher({ environment }))
  }

  #environmentCopy(): NodeJS.ProcessEnv {
    return { ...this.#environment }
  }

  async launcher(): Promise<ClaudeCodeLauncher> {
    if (this.#launcher !== undefined) return copyLauncher(this.#launcher)
    this.#resolution ??= this.#resolveLauncher(this.#environmentCopy())
      .then((launcher) => {
        this.#launcher = copyLauncher(launcher)
        return copyLauncher(launcher)
      })
      .finally(() => {
        this.#resolution = undefined
      })
    return copyLauncher(await this.#resolution)
  }

  async prepare(
    options: NodeClaudePreparationOptions = {},
  ): Promise<ClaudeCodePreparation> {
    const launcher = await this.launcher()
    return await prepareClaudeCode({
      launcher,
      environment: this.#environmentCopy(),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.processOwnership === undefined
        ? {}
        : { processOwnership: options.processOwnership }),
    })
  }
}

function copyLauncher(launcher: ClaudeCodeLauncher): ClaudeCodeLauncher {
  return {
    kind: launcher.kind,
    launcherPath: launcher.launcherPath,
    executable: launcher.executable,
    prefixArguments: [...launcher.prefixArguments],
    sourcePath: launcher.sourcePath,
  }
}
