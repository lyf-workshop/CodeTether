import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as query from '@tanstack/react-query'
import { loadWebComponent } from './render-ui.mjs'

/** Render the actual v4 collection; only transport/router hook boundaries are replaced. */
export function renderProjectCollection({
  conversations = [],
  pending = false,
  error = false,
  searchPage = false,
  search = {},
  searchState = {},
  machineId = 'machine_collection01',
} = {}) {
  const reads = []
  const unavailable = () => {
    throw new Error('Rendering must not make a runtime request')
  }
  const runtime = { retry: unavailable }
  const queryClient = new query.QueryClient()
  const dependencies = new Map([
    [
      '@tanstack/react-query',
      {
        ...query,
        useQueryClient: () => queryClient,
        useQuery: (options) => {
          reads.push(options)
          return {
            data: pending ? undefined : conversations,
            isError: Boolean(error),
            error: error instanceof Error ? error : undefined,
            isPending: pending,
            refetch: unavailable,
          }
        },
        useInfiniteQuery: () => ({
          data: undefined,
          isError: false,
          isFetching: false,
          isFetchNextPageError: false,
          isFetchingNextPage: false,
          isRefetchError: false,
          hasNextPage: false,
          ...searchState,
        }),
        useMutation: () => ({
          isPending: false,
          isError: false,
          mutate: unavailable,
          reset() {},
        }),
      },
    ],
    [
      '@tanstack/react-router',
      {
        useNavigate: () => unavailable,
        Link: ({ to, params, search, children, ...props }) => {
          let href = to.replace(/\$(\w+)/gu, (_match, name) =>
            encodeURIComponent(params?.[name] ?? name),
          )
          if (search !== undefined && typeof search === 'object') {
            const query = new URLSearchParams(
              Object.entries(search).filter(([, value]) => value !== undefined),
            )
            if (query.size > 0) href += '?' + query.toString()
          }
          return createElement('a', { ...props, href }, children)
        },
      },
    ],
    [
      '../../runtime/host/host-runtime-hooks',
      {
        useHostRuntime: () => runtime,
        useHostConnectionState: () => 'connected',
      },
    ],
  ])
  const { ProjectConversationCollection } = loadWebComponent(
    'components/projects/project-conversation-collection.tsx',
    dependencies,
  )
  const html = renderToStaticMarkup(
    createElement(ProjectConversationCollection, {
      projectId: 'proj_collection01',
      machineId,
      projectName: '真实项目',
      search,
      searchPage,
    }),
  )
  queryClient.clear()
  return { html, reads }
}
