import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

/** Network-free DOM; components execute their real hooks and event handlers. */
export async function createDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div><button id="outside">别处</button></body></html>',
    { url: 'http://localhost/' },
  )
  const original = new Map()
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLFormElement',
    'Element',
    'Node',
    'NodeFilter',
    'DocumentFragment',
    'MutationObserver',
    'CustomEvent',
    'Event',
    'KeyboardEvent',
    'getComputedStyle',
  ]) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value:
        key === 'getComputedStyle'
          ? dom.window.getComputedStyle.bind(dom.window)
          : dom.window[key],
    })
  }
  original.set(
    'IS_REACT_ACT_ENVIRONMENT',
    Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'),
  )
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.document.hasFocus = () => true
  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  return {
    window: dom.window,
    container,
    async render(component) {
      await act(async () => root.render(component))
    },
    async perform(callback) {
      await act(async () => {
        await callback()
      })
    },
    async input(element, value) {
      await act(async () => {
        const prototype =
          element.tagName === 'TEXTAREA'
            ? dom.window.HTMLTextAreaElement.prototype
            : dom.window.HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(
          element,
          value,
        )
        element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
    },
    async until(predicate) {
      for (let count = 0; count < 100; count += 1) {
        if (predicate()) return
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
        })
      }
      throw new Error(
        'Expected DOM state was not reached within the bounded test wait',
      )
    },
    async close() {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}

export { act, createElement as h }
