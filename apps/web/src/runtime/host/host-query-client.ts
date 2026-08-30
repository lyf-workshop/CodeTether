import { QueryClient, type QueryClientConfig } from '@tanstack/react-query'

export const hostQueryClientConfig = {
  defaultOptions: {
    queries: {
      networkMode: 'always',
      retry: false,
    },
    mutations: {
      networkMode: 'always',
    },
  },
} satisfies QueryClientConfig

/**
 * All server state in this QueryClient belongs to the loopback CodeTether
 * Host. Internet reachability must never pause local durable reads or queue a
 * mutation until Wi-Fi returns.
 */
export function createHostQueryClient(): QueryClient {
  return new QueryClient(hostQueryClientConfig)
}
