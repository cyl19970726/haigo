var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from '@nestjs/common';
let MetricsService = class MetricsService {
    constructor() {
        this.orderListenerLastVersion = 0n;
        this.orderListenerErrorTotal = 0;
        this.stakingListenerLastVersion = 0n;
        this.stakingListenerErrorTotal = 0;
        this.directoryRequestTotal = 0;
        this.directoryCacheHitTotal = 0;
        this.directoryErrorTotal = 0;
        this.directoryLastLatencyMs = 0;
    }
    setOrderListenerLastVersion(v) {
        this.orderListenerLastVersion = v;
    }
    incOrderListenerError() {
        this.orderListenerErrorTotal += 1;
    }
    setStakingListenerLastVersion(v) {
        this.stakingListenerLastVersion = v;
    }
    incStakingListenerError() {
        this.stakingListenerErrorTotal += 1;
    }
    recordDirectoryRequest(payload) {
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
    renderPrometheus() {
        const lines = [];
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
};
MetricsService = __decorate([
    Injectable()
], MetricsService);
export { MetricsService };
