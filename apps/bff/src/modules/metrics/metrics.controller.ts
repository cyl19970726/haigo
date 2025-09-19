import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from './metrics.service.js';

@Controller('/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  getMetrics(@Res() res: Response) {
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(this.metrics.renderPrometheus());
  }
}

