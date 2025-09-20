import type { ComponentProps, ComponentPropsWithoutRef, ElementRef, HTMLAttributes } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Pagination = ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
  <nav role="navigation" aria-label="pagination" className={cn('mx-auto flex w-full justify-center', className)} {...props} />
);

const PaginationContent = ({ className, ...props }: HTMLAttributes<HTMLUListElement>) => (
  <ul className={cn('flex flex-row items-center gap-1', className)} {...props} />
);

const PaginationItem = ({ className, ...props }: HTMLAttributes<HTMLLIElement>) => <li className={cn('', className)} {...props} />;

const PaginationLink = forwardRef<ElementRef<'a'>, ComponentPropsWithoutRef<'a'>>(({ className, ...props }, ref) => (
  <a
    ref={ref}
    className={cn(
      'inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
PaginationLink.displayName = 'PaginationLink';

type PaginationPreviousProps = ComponentProps<typeof PaginationLink> & { label?: string };

const PaginationPrevious = ({ className, label = 'Previous', ...props }: PaginationPreviousProps) => (
  <PaginationLink aria-label={label} className={cn('gap-1 px-2', className)} {...props}>
    <ChevronLeft className="h-4 w-4" />
    <span className="sr-only sm:not-sr-only">{label}</span>
  </PaginationLink>
);

type PaginationNextProps = ComponentProps<typeof PaginationLink> & { label?: string };

const PaginationNext = ({ className, label = 'Next', ...props }: PaginationNextProps) => (
  <PaginationLink aria-label={label} className={cn('gap-1 px-2', className)} {...props}>
    <span className="sr-only sm:not-sr-only">{label}</span>
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
);

export { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext };
