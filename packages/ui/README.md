# @codetether/ui

Shared design-system source for all CodeTether clients.

This package owns the Figma-aligned design tokens, dark-theme foundation, shared primitives, presentational product components, and the `cn` utility. Shared components stay here instead of being redefined by individual apps.

Phase 1A values are mapped from Figma `00 Foundations` and `92 Components`. Components consume semantic tokens so future light and system themes can be added without rewriting component source; only the approved dark theme is implemented now.

Run shadcn commands from this directory and use the checked-in `components.json`. Keep primitive interaction behavior aligned with shadcn/ui and Radix, keep execution status and agent identity in `src/tokens`, and do not add a component until a product task needs it.
