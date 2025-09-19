import type { Response } from 'express';
import { MetricsService } from './metrics.service.js';
export declare class MetricsController {
    private readonly metrics;
    constructor(metrics: MetricsService);
    getMetrics(res: Response): void;
}
