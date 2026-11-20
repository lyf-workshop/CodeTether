import { FileCode2 } from 'lucide-react'

/** Displays recorded path evidence from this conversation's tools. */
export function ConversationFilesSurface({
  files,
}: {
  readonly files: readonly string[]
}) {
  return (
    <ul aria-label={`${files.length} 个已查看文件`} className="space-y-1">
      {files.map((path) => (
        <li
          key={path}
          className="flex min-h-8 min-w-0 items-center gap-2 px-1.5 text-sm"
        >
          <FileCode2
            aria-hidden="true"
            className="size-3.5 shrink-0 text-tool-search"
          />
          <span className="min-w-0 truncate text-text-primary" title={path}>
            {path}
          </span>
        </li>
      ))}
    </ul>
  )
}
