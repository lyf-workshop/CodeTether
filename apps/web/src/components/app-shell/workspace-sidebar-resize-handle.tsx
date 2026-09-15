import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
} from 'react'

import { cn } from '@codetether/ui'

import {
  clampWorkspaceSidebarWidth,
  workspaceSidebarWidthBounds,
} from './workspace-sidebar-layout'

interface WorkspaceSidebarResizeHandleProps {
  resizing: boolean
  setResizing: (resizing: boolean) => void
  setWidth: (width: number) => void
  width: number
}

interface DragState {
  pointerId: number
  startWidth: number
  startX: number
}

export function WorkspaceSidebarResizeHandle({
  resizing,
  setResizing,
  setWidth,
  width,
}: WorkspaceSidebarResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | undefined>(undefined)
  const documentStylesRef = useRef<
    | {
        cursor: string
        userSelect: string
      }
    | undefined
  >(undefined)

  useEffect(
    () => () => {
      dragRef.current = undefined
      restoreDocumentStyles(documentStylesRef)
    },
    [],
  )

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = {
      pointerId: event.pointerId,
      startWidth: width,
      startX: event.clientX,
    }
    documentStylesRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag === undefined || drag.pointerId !== event.pointerId) return
    setWidth(
      clampWorkspaceSidebarWidth(drag.startWidth + event.clientX - drag.startX),
    )
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag === undefined || drag.pointerId !== event.pointerId) return
    dragRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    restoreDocumentStyles(documentStylesRef)
    setResizing(false)
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.shiftKey ? 40 : 10
    let nextWidth: number | undefined
    switch (event.key) {
      case 'ArrowLeft':
        nextWidth = width - delta
        break
      case 'ArrowRight':
        nextWidth = width + delta
        break
      case 'Home':
        nextWidth = workspaceSidebarWidthBounds.minimum
        break
      case 'End':
        nextWidth = workspaceSidebarWidthBounds.maximum
        break
      default:
        return
    }
    event.preventDefault()
    setWidth(clampWorkspaceSidebarWidth(nextWidth))
  }

  return (
    <div
      ref={handleRef}
      role="separator"
      tabIndex={0}
      aria-label="调整侧边栏宽度"
      aria-orientation="vertical"
      aria-valuemin={workspaceSidebarWidthBounds.minimum}
      aria-valuemax={workspaceSidebarWidthBounds.maximum}
      aria-valuenow={width}
      data-resizing={resizing || undefined}
      className={cn(
        'group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset',
      )}
      onDoubleClick={() => setWidth(workspaceSidebarWidthBounds.default)}
      onKeyDown={resizeWithKeyboard}
      onLostPointerCapture={finishResize}
      onPointerCancel={finishResize}
      onPointerDown={startResize}
      onPointerMove={resize}
      onPointerUp={finishResize}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary group-data-[resizing]:bg-primary motion-reduce:transition-none"
      />
    </div>
  )
}

function restoreDocumentStyles(
  stylesRef: MutableRefObject<
    { cursor: string; userSelect: string } | undefined
  >,
): void {
  const styles = stylesRef.current
  if (styles === undefined || typeof document === 'undefined') return
  document.body.style.cursor = styles.cursor
  document.body.style.userSelect = styles.userSelect
  stylesRef.current = undefined
}
