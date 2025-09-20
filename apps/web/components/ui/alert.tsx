import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg~*]:pl-7 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:text-foreground',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive: 'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
        success: 'border-emerald-500/50 text-emerald-600 dark:border-emerald-600 [&>svg]:text-emerald-500',
        warning: 'border-amber-500/50 text-amber-600 dark:border-amber-600 [&>svg]:text-amber-500',
        info: 'border-primary/50 text-primary dark:border-primary [&>svg]:text-primary'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

type AlertProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;

const icons: Record<NonNullable<AlertProps['variant']>, typeof Info> = {
  default: Info,
  destructive: XCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info
};

const Alert = forwardRef<HTMLDivElement, AlertProps>(({ className, variant = 'default', children, ...props }, ref) => {
  const resolvedVariant = (variant ?? 'default') as NonNullable<AlertProps['variant']>;
  const Icon = icons[resolvedVariant];
  return (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant: resolvedVariant }), className)} {...props}>
      <Icon className="h-4 w-4" />
      {children}
    </div>
  );
});
Alert.displayName = 'Alert';

const AlertTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('mb-1 font-semibold leading-none tracking-tight', className)} {...props} />
);

const AlertDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <div className={cn('text-sm leading-relaxed opacity-90', className)} {...props} />
);

export { Alert, AlertTitle, AlertDescription };
