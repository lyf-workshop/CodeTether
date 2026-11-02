import {
  Fragment,
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type Ref,
} from 'react'
import { Search } from 'lucide-react'
import { cn } from '../lib/cn'
import { commandListHighlight } from '../lib/command-list-navigation'

export interface CommandListItem {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly shortcut?: string
  readonly icon?: ReactNode
}
export interface CommandListGroup {
  readonly id: string
  readonly label: string
  readonly items: readonly CommandListItem[]
}
interface CommandListProps {
  readonly groups: readonly CommandListGroup[]
  readonly query: string
  readonly highlightedId?: string
  readonly expanded?: boolean
  readonly inputRef?: Ref<HTMLInputElement>
  readonly onQueryChange: (query: string) => void
  readonly onHighlightChange: (id: string | undefined) => void
  readonly onSelect: (id: string) => void
}

/** Accessible cached-title navigation surface. Data and actions belong to the caller. */
export function CommandList({
  groups,
  query,
  highlightedId,
  expanded = true,
  inputRef,
  onQueryChange,
  onHighlightChange,
  onSelect,
}: CommandListProps) {
  const baseId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const visibleGroups = groups.filter((group) => group.items.length > 0)
  const ids = visibleGroups.flatMap((group) =>
    group.items.map((item) => item.id),
  )
  const popupOpen = expanded && ids.length > 0
  const activeId = !popupOpen
    ? undefined
    : highlightedId !== undefined && ids.includes(highlightedId)
      ? highlightedId
      : ids[0]
  const optionId = (id: string) => baseId + '-option-' + ids.indexOf(id)
  useEffect(() => {
    if (activeId !== undefined)
      listRef.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' })
  }, [activeId])
  return (
    <div>
      <div className="flex h-14 min-w-0 items-center gap-3 border-b border-border px-4">
        <Search
          aria-hidden="true"
          className="size-5 shrink-0 text-text-muted"
        />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="搜索会话、项目、设备或操作"
          aria-autocomplete="list"
          aria-expanded={popupOpen}
          aria-controls={baseId + '-results'}
          aria-activedescendant={
            activeId === undefined ? undefined : optionId(activeId)
          }
          value={query}
          placeholder="搜索会话、项目、设备或操作"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (
              !popupOpen ||
              event.nativeEvent.isComposing ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey
            )
              return
            if (
              event.key === 'ArrowDown' ||
              event.key === 'ArrowUp' ||
              event.key === 'Home' ||
              event.key === 'End'
            ) {
              event.preventDefault()
              onHighlightChange(commandListHighlight(ids, activeId, event.key))
            } else if (
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              activeId !== undefined
            ) {
              event.preventDefault()
              onSelect(activeId)
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted"
        />
        <kbd aria-hidden="true" className="shrink-0 text-xs text-text-muted">
          Esc
        </kbd>
      </div>
      <div
        ref={listRef}
        hidden={!popupOpen}
        className="max-h-[var(--layout-command-list-max-height)] overflow-y-auto p-2"
      >
        {/* Headings stay outside the listbox; its owned groups contain only
            options. Input focus and aria-activedescendant share that owner. */}
        <div
          role="listbox"
          id={baseId + '-results'}
          aria-label="搜索结果"
          tabIndex={-1}
          aria-owns={
            popupOpen
              ? visibleGroups
                  .map((_, index) => baseId + '-group-' + index)
                  .join(' ')
              : undefined
          }
        />
        {visibleGroups.map((group, index) => (
          <Fragment key={group.id}>
            <h3
              id={baseId + '-heading-' + index}
              className="px-2.5 pt-2 pb-1 text-xs font-semibold text-text-muted"
            >
              {group.label}
            </h3>
            <div
              id={baseId + '-group-' + index}
              role="group"
              aria-labelledby={baseId + '-heading-' + index}
            >
              {group.items.map((item) => (
                <button
                  type="button"
                  role="option"
                  id={optionId(item.id)}
                  aria-selected={activeId === item.id}
                  tabIndex={-1}
                  key={item.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerMove={() => onHighlightChange(item.id)}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'flex h-10 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-text-primary outline-none hover:bg-surface-muted',
                    activeId === item.id && 'bg-surface-muted',
                  )}
                >
                  {item.icon === undefined ? null : (
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-text-muted [&>svg]:size-4"
                    >
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate" title={item.label}>
                    {item.label}
                  </span>
                  {item.description === undefined ? null : (
                    <span
                      className="max-w-1/2 truncate text-xs text-text-muted"
                      title={item.description}
                    >
                      {item.description}
                    </span>
                  )}
                  {item.shortcut === undefined ? null : (
                    <kbd className="shrink-0 text-xs text-text-muted">
                      {item.shortcut}
                    </kbd>
                  )}
                </button>
              ))}
            </div>
          </Fragment>
        ))}
      </div>
      {expanded && ids.length === 0 ? (
        <p
          role="status"
          className="px-4 py-8 text-center text-sm text-text-muted"
        >
          没有找到匹配的已加载标题或操作。
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-text-muted">
        <span>↑ ↓ 选择</span>
        <span>Enter 打开</span>
        <span>Esc 关闭</span>
        <span className="ml-auto">这里只匹配已加载的标题。</span>
      </div>
    </div>
  )
}
