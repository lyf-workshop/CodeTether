import { createElement as h, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as query from '@tanstack/react-query'
import { loadUiComponent, loadWebComponent } from './render-ui.mjs'

const ui = loadUiComponent('index.ts')

/** Isolated normalized DTO/hook fixture, never a network or Provider client. */
export function metadataUiFixture({
  machines = [],
  projects = [],
  conversations = [],
  candidates = [],
} = {}) {
  const state = {
    connection: 'connected',
    machines,
    projects,
    conversations,
    candidates,
    projectsFailed: false,
    projectsUnknown: false,
    mutationError: undefined,
  }
  const reads = [],
    mutations = [],
    requests = [],
    fanout = []
  const runtime = {
    getConnectionState: () => state.connection,
    listMachines: async (options) => {
      requests.push(['machines', options])
      return { machines: state.machines }
    },
    listProjects: async (options) => {
      requests.push(['projects', options])
      return { projects: state.projects }
    },
    listProjectConversations: async (projectId, options) => {
      requests.push(['conversations', projectId, options])
      return {
        conversations: state.conversations.filter(
          (c) => c.projectId === projectId,
        ),
      }
    },
    getMachine: async (id) => {
      requests.push(['detail', id])
      throw new Error('Unexpected per-device detail read')
    },
    createProject: async (...args) => {
      requests.push(['create-local', ...args])
      return {}
    },
    createRemoteProject: async (...args) => {
      requests.push(['create-remote', ...args])
      return {}
    },
    unpairMachine: async (id) => {
      requests.push(['unpair', id])
      return {}
    },
    retry() {},
  }
  const result = (data, isError = false) => ({
    data,
    isError,
    isSuccess: data !== undefined && !isError,
    isPending: data === undefined && !isError,
    isFetching: false,
    refetch: async () => ({}),
  })
  const container =
    (tag) =>
    ({ children, className, ...props }) =>
      h(
        tag,
        {
          className,
          ...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {}),
        },
        children,
      )
  const dependencies = new Map([
    [
      '@codetether/ui',
      {
        ...ui,
        Dialog: ({ children, open }) =>
          open ? h(Fragment, null, children) : null,
        DialogContent: container('section'),
        DialogHeader: container('header'),
        DialogFooter: container('footer'),
        DialogTitle: container('h2'),
        DialogDescription: container('p'),
        DialogClose: ({ children }) => children,
        DialogTrigger: ({ children }) => children,
      },
    ],
    [
      '@tanstack/react-query',
      {
        ...query,
        useQuery: (options) => {
          reads.push(options)
          const [, kind, scope] = options.queryKey
          if (kind === 'machines') return result(state.machines)
          if (kind === 'projects')
            return result(
              state.projectsUnknown ? undefined : state.projects,
              state.projectsFailed,
            )
          if (kind === 'project-conversations')
            return result(
              state.conversations?.filter((c) => c.projectId === scope),
            )
          return result(undefined)
        },
        useQueries: (options) => {
          fanout.push(options)
          return options.queries.map(() => result({ projects: state.projects }))
        },
        useInfiniteQuery: (options) => {
          reads.push(options)
          return {
            ...result({
              pages: [{ candidates: state.candidates, providers: [] }],
            }),
            isFetchingNextPage: false,
          }
        },
        useMutation: (options) => {
          mutations.push(options)
          return {
            isPending: false,
            isError: state.mutationError !== undefined,
            error: state.mutationError,
            mutate() {},
            reset() {},
          }
        },
        useQueryClient: () => ({
          getQueryData: (key) =>
            key[1] === 'machines' ? state.machines : undefined,
          removeQueries() {},
          invalidateQueries: async () => {},
          fetchQuery: async (options) =>
            await options.queryFn({ signal: undefined }),
        }),
      },
    ],
    [
      '@tanstack/react-router',
      {
        useNavigate: () => async () => {},
        Link: ({ children, to, params, search, ...props }) => {
          const pathname = Object.entries(params ?? {}).reduce(
            (value, [key, id]) => value.replace('$' + key, id),
            to,
          )
          const qs = new URLSearchParams(search ?? {}).toString()
          return h(
            'a',
            { ...props, href: pathname + (qs ? '?' + qs : '') },
            children,
          )
        },
      },
    ],
    [
      '../../runtime/host/host-runtime-hooks',
      {
        useHostRuntime: () => runtime,
        useHostConnectionState: () => state.connection,
      },
    ],
  ])
  return {
    state,
    runtime,
    reads,
    mutations,
    requests,
    fanout,
    load: (path) => loadWebComponent(path, dependencies),
    render: (Component, props) => renderToStaticMarkup(h(Component, props)),
  }
}
