export declare const ORDER_DEFAULTS: {
    readonly insuranceRateBps: number;
    readonly platformFeeBps: number;
    readonly insuranceRateMinBps: 0;
    readonly insuranceRateMaxBps: 2000;
    readonly amountMinApt: 0.01;
    readonly amountMaxApt: 10000;
};
export declare const ORDER_FORM_CACHE_KEY = "haigo:orders:create";
export declare const ORDER_MEDIA_STAGES: {
    readonly CREATED: "created";
    readonly INBOUND: "inbound";
    readonly STORAGE: "storage";
    readonly OUTBOUND: "outbound";
};
export declare const ORDER_MEDIA_HASH_ALGORITHMS: {
    readonly BLAKE3: "BLAKE3";
    readonly KECCAK256: "KECCAK256";
};
export declare const ORDER_MEDIA_CATEGORIES: {
    readonly INBOUND_PHOTO: "inbound_photo";
    readonly INBOUND_VIDEO: "inbound_video";
    readonly INBOUND_DOCUMENT: "inbound_document";
};
export declare const ORDER_MEDIA_VERIFICATION_STATUSES: {
    readonly PENDING: "pending";
    readonly VERIFYING: "verifying";
    readonly VERIFIED: "verified";
    readonly FAILED: "failed";
    readonly RECHECKING: "rechecking";
};
export declare const ORDER_MEDIA_ACCEPTED_MIME: {
    readonly IMAGE: readonly ["image/jpeg", "image/png", "image/webp", "image/heic"];
    readonly VIDEO: readonly ["video/mp4", "video/quicktime"];
    readonly DOCUMENT: readonly ["application/pdf"];
};
export declare const ORDER_MEDIA_MAX_SIZE_BYTES: {
    readonly IMAGE: number;
    readonly VIDEO: number;
    readonly DOCUMENT: number;
};
export declare const ORDER_MEDIA_ERROR_CODES: {
    readonly MIME_NOT_ALLOWED: "MEDIA_MIME_NOT_ALLOWED";
    readonly SIZE_EXCEEDED: "MEDIA_SIZE_EXCEEDED";
    readonly HASH_MISMATCH: "MEDIA_HASH_MISMATCH";
    readonly UPLOAD_FAILED: "MEDIA_UPLOAD_FAILED";
};
export declare const ORDER_STATUS_LABELS: Record<string, string>;
export type OrderStatusKey = keyof typeof ORDER_STATUS_LABELS;
