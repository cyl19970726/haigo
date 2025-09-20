'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

type ActionType = 'stake' | 'fee';

type QuickActionRow = {
  title: string;
  description: string;
  href?: string;
  cta?: string;
  disabled?: boolean;
  actions?: Array<{ label: string; action: ActionType; variant?: 'primary' | 'secondary' }>;
};

interface WarehouseQuickActionsCardProps {
  onAction?: (action: ActionType) => void;
  walletConnected?: boolean;
}

export const WarehouseQuickActionsCard = ({ onAction, walletConnected = false }: WarehouseQuickActionsCardProps) => {
  const quickActions: QuickActionRow[] = [
    {
      title: '查看全部订单',
      description: '跳转至订单总览，筛选并处理最新入库请求。',
      href: '/(warehouse)/orders'
    },
    {
      title: '质押与费率操作',
      description: '无需离开仪表盘即可追加质押或调整存储费率。',
      actions: [
        { label: '快速质押', action: 'stake', variant: 'primary' },
        { label: '调整费率', action: 'fee', variant: 'secondary' }
      ]
    },
    {
      title: '完善仓库资料',
      description: '准备仓库画像与服务条款，功能即将上线。',
      disabled: true
    }
  ];

  return (
    <Card className="h-full">
      <CardHeader className="space-y-1">
        <CardTitle>快捷操作</CardTitle>
        <CardDescription>常用入口帮助你快速完成订单处理与仓库维护。</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {quickActions.map(({ title, description, href, cta, actions, disabled }) => (
            <div
              key={title}
              className="flex flex-col gap-3 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              {disabled ? (
                <span
                  aria-disabled="true"
                  className="text-xs font-medium text-muted-foreground sm:self-start"
                >
                  敬请期待
                </span>
              ) : actions && actions.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  {actions.map(({ label, action, variant }) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => onAction?.(action)}
                      disabled={!walletConnected}
                      className={cn(
                        buttonVariants({
                          variant: variant === 'secondary' ? 'outline' : 'default',
                          size: 'sm'
                        }),
                        !walletConnected ? 'cursor-not-allowed opacity-60' : ''
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <Link
                  href={href ?? '#'}
                  className={cn(
                    buttonVariants({ variant: 'secondary', size: 'sm' }),
                    'flex items-center gap-1 text-sm'
                  )}
                  aria-label={`前往${title}`}
                >
                  {cta ?? '前往'}
                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default WarehouseQuickActionsCard;
