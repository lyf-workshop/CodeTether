interface RoutePlaceholderProps {
  title: string
}

export function RoutePlaceholder({ title }: RoutePlaceholderProps) {
  const headingId = `page-${title.toLowerCase().replaceAll(' ', '-')}`

  return (
    <section
      aria-labelledby={headingId}
      className="px-[var(--layout-content-inline-padding)] py-[var(--layout-content-block-padding)]"
    >
      <h1 id={headingId} className="text-page font-semibold text-text-primary">
        {title}
      </h1>
      <p className="mt-1 text-base text-text-secondary">此页面尚未实现。</p>
    </section>
  )
}
