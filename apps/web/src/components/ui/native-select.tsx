import * as React from 'react';
import { cn } from 'cn';

/** A plain `<select>` styled like `Input`: short option lists, native keyboard support. */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'h-9 w-full rounded-md border bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
