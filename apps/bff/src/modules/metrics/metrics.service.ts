import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private orderListenerLastVersion = 0n;
  private orderListenerErrorTotal = 0;
  private stakingListenerLastVersion = 0n;
  private stakingListenerErrorTotal = 0;

  setOrderListenerLastVersion(v: bigint) {
    this.orderListenerLastVersion = v;
  }

  incOrderListenerError() {
    this.orderListenerErrorTotal += 1;
  }

  setStakingListenerLastVersion(v: bigint) {
    this.stakingListenerLastVersion = v;
  }

  incStakingListenerError() {
    this.stakingListenerErrorTotal += 1;
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    lines.push('# HELP order_listener_last_version Last processed transaction version by OrdersEventListener');
    lines.push('# TYPE order_listener_last_version gauge');
    lines.push(`order_listener_last_version ${Number(this.orderListenerLastVersion)}`);
    lines.push('# HELP order_listener_error_total Total errors encountered by OrdersEventListener');
    lines.push('# TYPE order_listener_error_total counter');
    lines.push(`order_listener_error_total ${this.orderListenerErrorTotal}`);
    lines.push('# HELP staking_listener_last_version Last processed transaction version by StakingListener');
    lines.push('# TYPE staking_listener_last_version gauge');
    lines.push(`staking_listener_last_version ${Number(this.stakingListenerLastVersion)}`);
    lines.push('# HELP staking_listener_error_total Total errors encountered by StakingListener');
    lines.push('# TYPE staking_listener_error_total counter');
    lines.push(`staking_listener_error_total ${this.stakingListenerErrorTotal}`);
    return lines.join('\n') + '\n';
  }
}
