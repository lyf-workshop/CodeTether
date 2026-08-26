import * as React from 'react'
import { Search } from 'lucide-react'

import { Input, type InputProps } from '@codetether/ui/components/input'
import { cn } from '@codetether/ui/lib/cn'

interface SearchInputProps extends Omit<InputProps, 'type'> {
  containerClassName?: string
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    { 'aria-label': ariaLabel, className, containerClassName, ...props },
    ref,
  ) => (
    <div
      data-slot="search-input"
      className={cn('relative w-full', containerClassName)}
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
      />
      <Input
        ref={ref}
        type="search"
        aria-label={ariaLabel ?? '搜索'}
        className={cn('pr-3 pl-9', className)}
        {...props}
      />
    </div>
  ),
)

SearchInput.displayName = 'SearchInput'

export { SearchInput, type SearchInputProps }
