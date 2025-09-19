declare const _default: () => {
    env: string;
    port: number;
    hasuraUrl: string;
    indexerUrl: string;
    database: {
        url: string;
    };
    ingestion: {
        pollingIntervalMs: number;
        pageSize: number;
    };
    media: {
        storageDir: string | undefined;
        publicPrefix: string;
    };
};
export default _default;
