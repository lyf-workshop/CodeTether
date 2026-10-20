import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import * as reactQuery from '@tanstack/react-query'
import { loadUiComponent, loadWebComponent } from './fixtures/render-ui.mjs'

const machineId = 'machine_create01'
const projectId = 'proj_create01'
const machine = {
  machineId,
  kind: 'local',
  connectionState: 'local',
  displayName: '这台电脑',
  availability: 'available',
  capabilities: { projectAccess: true, providerExecution: true },
}
const project = {
  projectId,
  name: '测试项目',
  locations: [
    {
      machineId,
      availability: 'available',
      rootPath: 'D:\\fixture-only\\project',
    },
  ],
}
const provider = {
  provider: 'codex',
  displayName: 'Codex',
  availability: 'available',
  models: [],
  reasoningOptions: [],
  capabilities: { streaming: true, resume: true, reasoningControl: false },
}

for (const [name, overrides] of [
  ['no registered project', { projects: [] }],
  ['no available provider', { providers: [] }],
  [
    'installed descriptor is not executable',
    { providers: [{ ...provider, availability: 'not_installed' }] },
  ],
  [
    'project device cannot execute',
    {
      machines: [
        {
          ...machine,
          capabilities: { ...machine.capabilities, providerExecution: false },
        },
      ],
    },
  ],
  ['Host disconnected', { connectionState: 'reconnecting' }],
]) {
  test(`real desktop create form rejects ${name} even if submit is dispatched directly`, () => {
    const fixture = renderDialog(overrides)
    assert.match(fixture.markup, /type="submit"[^>]*disabled=""/u)
    fixture.submit()
    fixture.submit()
    assert.deepEqual(fixture.calls, [])
    assert.doesNotMatch(fixture.markup, /<textarea|选择模型/u)
  })
}

test('real desktop create form submits exact IDs once before rerender with no first input or model', () => {
  const fixture = renderDialog()
  assert.doesNotMatch(fixture.markup, /type="submit"[^>]*disabled=""/u)
  fixture.submit()
  fixture.submit()
  assert.deepEqual(fixture.calls, [{ projectId, machineId, provider: 'codex' }])
  assert.equal('input' in fixture.calls[0], false)
  assert.equal('model' in fixture.calls[0], false)
})

function renderDialog({
  projects = [project],
  machines = [machine],
  providers = [provider],
  connectionState = 'connected',
} = {}) {
  const calls = []
  let handleSubmit
  const capture = (jsx) => (type, props, key) => {
    if (type === 'form') handleSubmit = props.onSubmit
    return jsx(type, props, key)
  }
  const passthrough = ({ children }) => children
  // Only the portal/context shell is replaced for SSR. Selection, fields,
  // eligibility and the form's actual synchronous submit guard remain real.
  const ui = { ...loadUiComponent('index.ts') }
  for (const name of [
    'Dialog',
    'DialogContent',
    'DialogHeader',
    'DialogFooter',
    'DialogClose',
    'DialogTrigger',
  ])
    ui[name] = passthrough
  ui.DialogTitle = ({ children }) => h('h2', {}, children)
  ui.DialogDescription = ({ children }) => h('p', {}, children)
  const dependencies = new Map([
    [
      'react/jsx-runtime',
      {
        ...jsxRuntime,
        jsx: capture(jsxRuntime.jsx),
        jsxs: capture(jsxRuntime.jsxs),
      },
    ],
    ['@codetether/ui', ui],
    [
      '@tanstack/react-router',
      { useNavigate: () => () => assert.fail('Unexpected navigation') },
    ],
    [
      '@tanstack/react-query',
      {
        ...reactQuery,
        useQueryClient: () => ({}),
        useQuery: ({ queryKey }) => ({
          isPending: false,
          isError: false,
          isSuccess: true,
          data:
            queryKey[1] === 'projects'
              ? projects
              : queryKey[2] === 'list'
                ? machines
                : { providers },
        }),
        useMutation: () => ({
          isPending: false,
          isError: false,
          mutate: (selection) => calls.push(selection),
          reset() {},
        }),
      },
    ],
    [
      '../../runtime/host/host-runtime-hooks',
      {
        useHostRuntime: () => ({}),
        useHostConnectionState: () => connectionState,
      },
    ],
  ])
  const { NewConversationDialog } = loadWebComponent(
    'components/conversations/new-conversation-dialog.tsx',
    dependencies,
  )
  const markup = renderToStaticMarkup(h(NewConversationDialog, { open: true }))
  assert.equal(typeof handleSubmit, 'function')
  return { markup, calls, submit: () => handleSubmit({ preventDefault() {} }) }
}
