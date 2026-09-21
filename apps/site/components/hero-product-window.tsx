import Image from 'next/image'

export function HeroProductWindow() {
  return (
    <div
      className="product-window product-window-image"
      aria-label="CodeTether workspace screenshot"
    >
      <Image
        src="/product/codetether-workspace.png"
        alt="CodeTether desktop workspace showing projects, inbox activity, and agent sessions"
        fill
        priority
        sizes="(max-width: 760px) calc(100vw - 40px), (max-width: 1200px) 86vw, 1060px"
      />
      <div className="product-capture-badge">
        <span /> REAL PRODUCT CAPTURE
      </div>
    </div>
  )
}
