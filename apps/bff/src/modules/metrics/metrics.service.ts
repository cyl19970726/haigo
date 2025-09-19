import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private orderListenerLastVersion = 0n;
  private orderListenerErrorTotal = 0;

  setOrderListenerLastVersion(v: bigint) {
    this.orderListenerLastVersion = v;
  }

  incOrderListenerError() {
    this.orderListenerErrorTotal += 1;
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    lines.push('# HELP order_listener_last_version Last processed transaction version by OrdersEventListener');
    lines.push('# TYPE order_listener_last_version gauge');
    lines.push(`order_listener_last_version ${Number(this.orderListenerLastVersion)}`);
    lines.push('# HELP order_listener_error_total Total errors encountered by OrdersEventListener');
    lines.push('# TYPE order_listener_error_total counter');
    lines.push(`order_listener_error_total ${this.orderListenerErrorTotal}`);
    return lines.join('\n') + '\n';
  }
}

