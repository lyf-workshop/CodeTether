import { useState } from 'react'

import {
  SegmentedControl,
  SegmentedControlItem,
  SettingsRow,
} from '@codetether/ui'
import {
  readComposerSendShortcut,
  writeComposerSendShortcut,
  type ComposerSendShortcut,
} from '../conversation/composer-shortcut'

export function EditorSettings() {
  const [shortcut, setShortcut] = useState<ComposerSendShortcut>(() =>
    readComposerSendShortcut(),
  )
  const [saveError, setSaveError] = useState(false)

  function changeShortcut(next: string) {
    if (next !== 'enter' && next !== 'ctrl-enter') return
    try {
      writeComposerSendShortcut(next)
      setShortcut(next)
      setSaveError(false)
    } catch {
      setSaveError(true)
    }
  }

  return (
    <>
      <h2 className="mb-5 text-xl font-semibold">编辑器与输入</h2>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <SettingsRow
          title="发送快捷键"
          description="选择在会话输入框中发送消息的按键。Shift+Enter 始终换行。"
        >
          <SegmentedControl
            aria-label="发送快捷键"
            value={shortcut}
            onValueChange={changeShortcut}
            className="flex flex-wrap"
          >
            <SegmentedControlItem value="enter">
              Enter 发送，Shift+Enter 换行
            </SegmentedControlItem>
            <SegmentedControlItem value="ctrl-enter">
              Ctrl+Enter 发送，Enter 换行
            </SegmentedControlItem>
          </SegmentedControl>
          {saveError ? (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              当前设置未保存，请重试。
            </p>
          ) : null}
        </SettingsRow>
      </div>
    </>
  )
}
