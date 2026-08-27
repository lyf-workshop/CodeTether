import { CodeTetherResponseError } from '@codetether/client'
import type { ProjectRecord } from '@codetether/protocol'

import { projectErrorMessage } from './project-actions.js'

export interface ProjectQueryState<TData> {
  readonly status: 'pending' | 'error' | 'success'
  readonly data?: TData
  readonly error?: unknown
}

export type ProjectListViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready'
      readonly projects: readonly ProjectRecord[]
    }

export type ProjectDetailViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'host-unavailable'; readonly message: string }
  | { readonly kind: 'not-found'; readonly message: string }
  | { readonly kind: 'available'; readonly project: ProjectRecord }
  | {
      readonly kind: 'unavailable'
      readonly project: ProjectRecord
      readonly message: string
    }

export function projectListViewState(
  query: ProjectQueryState<readonly ProjectRecord[]>,
): ProjectListViewState {
  if (query.status === 'pending') return { kind: 'loading' }
  if (query.status === 'error') {
    return {
      kind: 'unavailable',
      message: projectErrorMessage(query.error, 'load'),
    }
  }
  if (query.data === undefined || query.data.length === 0) {
    return { kind: 'empty' }
  }
  return { kind: 'ready', projects: query.data }
}

export function projectDetailViewState(
  query: ProjectQueryState<ProjectRecord>,
): ProjectDetailViewState {
  if (query.status === 'pending') return { kind: 'loading' }
  if (query.status === 'error') {
    if (
      query.error instanceof CodeTetherResponseError &&
      query.error.envelope.code === 'not_found'
    ) {
      return { kind: 'not-found', message: '项目不存在或已被移除。' }
    }
    return {
      kind: 'host-unavailable',
      message: projectErrorMessage(query.error, 'load'),
    }
  }
  if (query.data === undefined) {
    return {
      kind: 'host-unavailable',
      message: 'CodeTether Host 返回了不完整的项目数据。',
    }
  }
  return query.data.availability === 'available'
    ? { kind: 'available', project: query.data }
    : {
        kind: 'unavailable',
        project: query.data,
        message: '项目目录当前不存在或无法访问。',
      }
}
