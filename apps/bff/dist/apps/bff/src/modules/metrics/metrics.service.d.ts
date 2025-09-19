export declare class MetricsService {
    private orderListenerLastVersion;
    private orderListenerErrorTotal;
    setOrderListenerLastVersion(v: bigint): void;
    incOrderListenerError(): void;
    renderPrometheus(): string;
}
