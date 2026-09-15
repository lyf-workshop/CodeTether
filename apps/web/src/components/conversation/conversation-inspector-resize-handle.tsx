import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
} from 'react'

import { cn } from '@codetether/ui'

import {
  clampConversationInspectorWidth,
  conversationInspectorMaximumWidth,
  conversationInspectorWidthBounds,
} from './conversation-inspector-layout'

interface ConversationInspectorResizeHandleProps {
  resizing: boolean
  setResizing: (resizing: boolean) => void
  setWidth: (width: number) => void
  width: number
  workspaceWidth?: number
}

interface DragState {
  pointerId: number
  startWidth: number
  startX: number
}

export function ConversationInspectorResizeHandle({
  resizing,
  setResizing,
  setWidth,
  width,
  workspaceWidth,
}: ConversationInspectorResizeHandleProps) {
  const dragRef = useRef<DragState | undefined>(undefined)
  const documentStylesRef = useRef<
    | {
        cursor: string
        userSelect: string
      }
    | undefined
  >(undefined)
  const maximumWidth = conversationInspectorMaximumWidth(workspaceWidth)

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
      clampConversationInspectorWidth(
        drag.startWidth + drag.startX - event.clientX,
        workspaceWidth,
      ),
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
        nextWidth = width + delta
        break
      case 'ArrowRight':
        nextWidth = width - delta
        break
      case 'Home':
        nextWidth = conversationInspectorWidthBounds.minimum
        break
      case 'End':
        nextWidth = maximumWidth
        break
      default:
        return
    }
    event.preventDefault()
    setWidth(clampConversationInspectorWidth(nextWidth, workspaceWidth))
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="调整检查器宽度"
      aria-orientation="vertical"
      aria-valuemin={conversationInspectorWidthBounds.minimum}
      aria-valuemax={maximumWidth}
      aria-valuenow={width}
      data-resizing={resizing || undefined}
      className={cn(
        'group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset',
      )}
      onDoubleClick={() =>
        setWidth(
          clampConversationInspectorWidth(
            conversationInspectorWidthBounds.default,
            workspaceWidth,
          ),
        )
      }
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
