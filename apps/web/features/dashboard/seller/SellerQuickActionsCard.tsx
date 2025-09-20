'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

interface QuickAction {
  label: string;
  description: string;
  href?: string;
  disabled?: boolean;
}

const ACTIONS: QuickAction[] = [
  {
    label: 'New Order',
    description: '启动新的仓储订单向导，完成物流与金额配置。',
    href: '/orders/new'
  },
  {
    label: 'My Orders',
    description: '查看自身订单的状态与处理进度（即将上线）。',
    disabled: true
  },
  {
    label: 'Profile',
    description: '补充或更新注册资料，保持仓储网络的信誉度。',
    href: '/register'
  }
];

export const SellerQuickActionsCard = () => {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>快捷入口</CardTitle>
        <CardDescription>常用操作统一入口，便于快速切换任务。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {ACTIONS.map((action) => (
          <div key={action.label} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">{action.label}</div>
              <p className="text-xs text-muted-foreground">{action.description}</p>
            </div>
            {action.disabled ? (
              <span
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'cursor-not-allowed opacity-60 text-xs'
                )}
              >
                即将上线
              </span>
            ) : (
              <Link
                href={action.href ?? '#'}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'flex items-center gap-1')}
              >
                前往
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
