import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private orderListenerLastVersion = 0n;
  private orderListenerErrorTotal = 0;
  private stakingListenerLastVersion = 0n;
  private stakingListenerErrorTotal = 0;
  private directoryRequestTotal = 0;
  private directoryCacheHitTotal = 0;
  private directoryErrorTotal = 0;
  private directoryLastLatencyMs = 0;

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

  recordDirectoryRequest(payload: { cacheHit: boolean; latencyMs: number }) {
    this.directoryRequestTotal += 1;
    if (payload.cacheHit) {
      this.directoryCacheHitTotal += 1;
    }
    if (Number.isFinite(payload.latencyMs)) {
      this.directoryLastLatencyMs = payload.latencyMs;
    }
  }

  recordDirectoryError() {
    this.directoryErrorTotal += 1;
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
    lines.push('# HELP directory_request_total Total directory API requests processed');
    lines.push('# TYPE directory_request_total counter');
    lines.push(`directory_request_total ${this.directoryRequestTotal}`);
    lines.push('# HELP directory_cache_hit_total Directory cache hits');
    lines.push('# TYPE directory_cache_hit_total counter');
    lines.push(`directory_cache_hit_total ${this.directoryCacheHitTotal}`);
    lines.push('# HELP directory_error_total Directory errors encountered');
    lines.push('# TYPE directory_error_total counter');
    lines.push(`directory_error_total ${this.directoryErrorTotal}`);
    lines.push('# HELP directory_request_latency_ms Last observed directory request latency in milliseconds');
    lines.push('# TYPE directory_request_latency_ms gauge');
    lines.push(`directory_request_latency_ms ${this.directoryLastLatencyMs}`);
    return lines.join('\n') + '\n';
  }
}
