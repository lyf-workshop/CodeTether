# CodeTether Icon (Final Design, Double Cards)

The previous two versions were abandoned. Direction A, white connecting lines on blue, was too generic, and the kite's colors did not work well. This version follows Apple's application-icon approach, using one shape, a soft top-to-bottom gradient, a white main element, and subtle depth and shadow, without text or extra details.

The mark consists of two overlapping rounded cards.
- The white front card represents the device at hand. Its command prompt `>` and cursor `_` indicate that the AI tool works here.
- The translucent rear card represents another device you own.

Colors follow these specifications.
- Purple is the primary color. The background gradients from `#b28cff` at the top to `#7146f0` at the bottom, from lavender to blue-violet, with a faint white highlight over the upper half.
- The front card is white, shading slightly to `#eef1f8` at its bottom, with a soft deep-purple shadow beneath it.
- The rear card is white at 32% opacity.
- The prompt and cursor gradient from `#9a6bff` to `#6a3ce8`, in the same color family as the background.
- Purple distinguishes the app from common blue developer-tool icons while remaining compatible with the UI's blue `--ct-accent`. Compare orange, green, graphite, and the previous blue version in `../v3/compare.html`. Color variants change only the colors, preserving the geometry.

| File | Purpose |
|---|---|
| `codetether-app.svg` | Main artwork, full bleed. Used for Windows at 48, 64, 128, and 256 pixels and other PNG exports. |
| `codetether-app-small.svg` | Dedicated 16, 24, and 32-pixel artwork. Larger cards, no shadow or highlight, heavier prompt, and solid `#7a4cf2`. |
| `codetether-app-macos.svg` | macOS artwork, centered at 824 pixels with a 100-pixel transparent margin and a bottom shadow like Apple's template. |

Pixel-by-pixel color sampling after Chromium rendering confirms that the rear card, white front card, and `>_` remain recognizable at 16 pixels. Confirm the actual taskbar and tray appearance with screenshots after installation.

The Windows tray uses the 16-pixel layer of the application icon, so the small-size artwork also determines tray appearance. A monochrome macOS menu-bar template icon is deferred, requiring native code changes and validation on a Mac.
