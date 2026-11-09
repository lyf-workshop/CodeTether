declare const __CODETETHER_PRODUCT_VERSION__: string

/** The root package version is injected by Vite for both Desktop and Browser builds. */
export const productVersion =
  typeof __CODETETHER_PRODUCT_VERSION__ === 'string'
    ? __CODETETHER_PRODUCT_VERSION__
    : 'unknown'
