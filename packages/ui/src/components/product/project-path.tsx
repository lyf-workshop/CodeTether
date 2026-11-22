import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '../../lib/cn.js'
import { fitProjectPathToWidth } from './project-path-parts.js'

export function ProjectPath({
  path,
  className,
}: {
  readonly path: string
  readonly className?: string
}) {
  const pathRef = useRef<HTMLSpanElement>(null)
  const [visiblePath, setVisiblePath] = useState(path)

  const measure = useCallback(() => {
    const element = pathRef.current
    const parent = element?.parentElement
    if (!element || !parent) return

    const style = getComputedStyle(element)
    const parentStyle = getComputedStyle(parent)
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return
    context.font =
      style.font ||
      `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0
    const measureText = (value: string) =>
      context.measureText(value).width +
      Math.max(0, Array.from(value).length - 1) * letterSpacing
    const parentRight = parent.getBoundingClientRect().right
    const elementLeft = element.getBoundingClientRect().left
    const paddingRight = Number.parseFloat(parentStyle.paddingRight) || 0
    const availableWidth = Math.max(0, parentRight - elementLeft - paddingRight)
    setVisiblePath(fitProjectPathToWidth(path, availableWidth, measureText))
  }, [path])

  useLayoutEffect(measure)

  useEffect(() => {
    const parent = pathRef.current?.parentElement
    if (!parent) return
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure)
    observer?.observe(parent)
    window.addEventListener('resize', measure)
    let active = true
    void document.fonts?.ready.then(() => {
      if (active) measure()
    })
    return () => {
      active = false
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  return (
    <span
      ref={pathRef}
      data-slot="project-path"
      className={cn('inline-flex min-w-0 max-w-full', className)}
      title={path}
    >
      <span aria-hidden="true" className="min-w-0 truncate">
        {visiblePath}
      </span>
      <span className="sr-only">{path}</span>
    </span>
  )
}
