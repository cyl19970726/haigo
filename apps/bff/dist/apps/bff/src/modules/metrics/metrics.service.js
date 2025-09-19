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
    }
    setOrderListenerLastVersion(v) {
        this.orderListenerLastVersion = v;
    }
    incOrderListenerError() {
        this.orderListenerErrorTotal += 1;
    }
    renderPrometheus() {
        const lines = [];
        lines.push('# HELP order_listener_last_version Last processed transaction version by OrdersEventListener');
        lines.push('# TYPE order_listener_last_version gauge');
        lines.push(`order_listener_last_version ${Number(this.orderListenerLastVersion)}`);
        lines.push('# HELP order_listener_error_total Total errors encountered by OrdersEventListener');
        lines.push('# TYPE order_listener_error_total counter');
        lines.push(`order_listener_error_total ${this.orderListenerErrorTotal}`);
        return lines.join('\n') + '\n';
    }
};
MetricsService = __decorate([
    Injectable()
], MetricsService);
export { MetricsService };
