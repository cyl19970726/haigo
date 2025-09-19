declare const _default: () => {
    env: string;
    port: number;
    hasuraUrl: string;
    indexerUrl: string;
    nodeApiUrl: string;
    aptosApiKey: string;
    database: {
        url: string;
    };
    ingestion: {
        pollingIntervalMs: number;
        pageSize: number;
        maxPagesPerTick: number;
        startFromLatest: boolean;
        backfillOffsetVersions: number;
    };
    media: {
        storageDir: string | undefined;
        publicPrefix: string;
    };
};
export default _default;
