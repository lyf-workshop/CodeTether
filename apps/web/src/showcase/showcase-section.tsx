import type { ReactNode } from 'react'

interface ShowcaseSectionProps {
  children: ReactNode
  description?: string
  id: string
  title: string
}

export function ShowcaseSection({
  children,
  description,
  id,
  title,
}: ShowcaseSectionProps) {
  const headingId = `${id}-heading`

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <div className="mb-6">
        <h2
          id={headingId}
          className="text-section font-semibold text-text-primary"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-base text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

interface ShowcaseGroupProps {
  children: ReactNode
  title: string
}

export function ShowcaseGroup({ children, title }: ShowcaseGroupProps) {
  return (
    <div className="min-w-0">
      <h3 className="mb-3 text-xs font-medium tracking-wide text-text-muted uppercase">
        {title}
      </h3>
      {children}
    </div>
  )
}
