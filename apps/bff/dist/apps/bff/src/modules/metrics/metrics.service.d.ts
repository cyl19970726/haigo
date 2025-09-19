export declare class MetricsService {
    private orderListenerLastVersion;
    private orderListenerErrorTotal;
    private stakingListenerLastVersion;
    private stakingListenerErrorTotal;
    private directoryRequestTotal;
    private directoryCacheHitTotal;
    private directoryErrorTotal;
    private directoryLastLatencyMs;
    setOrderListenerLastVersion(v: bigint): void;
    incOrderListenerError(): void;
    setStakingListenerLastVersion(v: bigint): void;
    incStakingListenerError(): void;
    recordDirectoryRequest(payload: {
        cacheHit: boolean;
        latencyMs: number;
    }): void;
    recordDirectoryError(): void;
    renderPrometheus(): string;
}
