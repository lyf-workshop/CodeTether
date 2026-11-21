import { cn } from '../../lib/cn.js'
import { projectPathParts } from './project-path-parts.js'

export function ProjectPath({
  path,
  className,
}: {
  readonly path: string
  readonly className?: string
}) {
  const { prefix, tail } = projectPathParts(path)
  const tailCharacters = Array.from(tail)
  const fixedSuffix = tailCharacters.slice(-12).join('')
  const flexibleTail = tailCharacters.slice(0, -12).join('')
  return (
    <span
      className={cn('inline-flex min-w-0 max-w-full', className)}
      title={path}
    >
      {prefix ? (
        <span aria-hidden="true" className="min-w-0 truncate">
          {prefix}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className="inline-flex min-w-0 max-w-full shrink-0"
      >
        {flexibleTail ? (
          <span className="min-w-0 truncate">{flexibleTail}</span>
        ) : null}
        <span className="shrink-0">{fixedSuffix}</span>
      </span>
      <span className="sr-only">{path}</span>
    </span>
  )
}
