import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Folder,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Settings,
  SquarePen,
  Sun,
} from 'lucide-react'
import {
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@codetether/ui'
import { getThemeController } from '../../runtime/theme/theme-preference'
import {
  commandPaletteGroups,
  paletteActionEntries,
  type PaletteActionId,
  type PaletteEntry,
} from './command-palette-model'
import {
  commandPaletteCacheSubscription,
  readCommandPaletteCache,
} from './command-palette-cache'

interface CommandPaletteProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly returnFocusRef?: RefObject<HTMLElement | null>
  readonly onNewConversation?: () => void
  readonly onAddProject?: () => void
  readonly onAddDevice?: () => void
  readonly onSettings?: () => void
}

export function CommandPalette({
  open,
  onOpenChange,
  returnFocusRef,
  onNewConversation,
  onAddProject,
  onAddDevice,
  onSettings,
}: CommandPaletteProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const subscription = useMemo(
    () => commandPaletteCacheSubscription(queryClient),
    [queryClient],
  )
  useSyncExternalStore(
    subscription.subscribe,
    subscription.getSnapshot,
    () => '',
  )
  const theme = getThemeController()
  const currentTheme = useSyncExternalStore(
    theme.subscribe,
    theme.getTheme,
    () => 'light' as const,
  )
  const [query, setQuery] = useState('')
  const [highlightedId, setHighlightedId] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)
  const skipCloseFocusRestore = useRef(false)
  const callbacks: Partial<Record<PaletteActionId, () => void>> = {
    'new-conversation': onNewConversation,
    'add-project': onAddProject,
    'add-device': onAddDevice,
    settings: onSettings,
    'theme-light': () => theme.setPreference('light'),
    'theme-dark': () => theme.setPreference('dark'),
  }
  const available = (Object.keys(callbacks) as PaletteActionId[]).filter(
    (action) => callbacks[action] !== undefined,
  )
  const groups = commandPaletteGroups(
    readCommandPaletteCache(queryClient),
    query,
    paletteActionEntries(currentTheme, available),
  )

  function close(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setQuery('')
      setHighlightedId(undefined)
    }
  }
  async function select(id: string) {
    const entry = groups
      .flatMap((group) => group.entries)
      .find((candidate) => candidate.id === id)
    if (entry === undefined) return
    const target = entry.target
    skipCloseFocusRestore.current = !(
      target.kind === 'action' &&
      (target.action === 'theme-light' || target.action === 'theme-dark')
    )
    close(false)
    if (target.kind === 'action') callbacks[target.action]?.()
    else if (target.kind === 'conversation')
      await navigate({
        to: '/c/$conversationId',
        params: { conversationId: target.conversationId },
        search: {},
      })
    else if (target.kind === 'device')
      await navigate({
        to: '/devices/$machineId',
        params: { machineId: target.machineId },
      })
    else
      await navigate({
        to: '/projects/$projectId',
        params: { projectId: target.projectId },
        search: { machineId: target.machineId },
      })
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        showCloseButton={false}
        className="ct-command-palette overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (skipCloseFocusRestore.current) {
            skipCloseFocusRestore.current = false
            event.preventDefault()
            return
          }
          if (returnFocusRef?.current === undefined) return
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
      >
        <DialogTitle className="sr-only">搜索与操作</DialogTitle>
        <DialogDescription className="sr-only">
          只匹配已加载的会话、项目、设备标题和可用操作，不搜索会话内容。
        </DialogDescription>
        <CommandList
          groups={groups.map((group) => ({
            id: group.id,
            label: group.label,
            items: group.entries.map((entry) => ({
              ...entry,
              icon: paletteIcon(entry),
            })),
          }))}
          query={query}
          highlightedId={highlightedId}
          inputRef={inputRef}
          onQueryChange={(value) => {
            setQuery(value)
            setHighlightedId(undefined)
          }}
          onHighlightChange={setHighlightedId}
          onSelect={(id) => {
            void select(id)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function paletteIcon(entry: PaletteEntry) {
  if (entry.target.kind === 'project') return <Folder />
  if (entry.target.kind === 'conversation') return <MessageSquare />
  if (entry.target.kind === 'device') return <Monitor />
  switch (entry.target.action) {
    case 'new-conversation':
      return <SquarePen />
    case 'add-project':
      return <Folder />
    case 'add-device':
      return <Plus />
    case 'theme-dark':
      return <Moon />
    case 'theme-light':
      return <Sun />
    case 'settings':
      return <Settings />
  }
}
