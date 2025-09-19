export interface RawUploadMediaBody {
  record_uid?: string;
  recordUid?: string;
  stage?: string;
  category?: string;
  hash_algorithm?: string;
  hash_algo?: string;
  hash_value?: string;
  hash?: string;
  cross_check_hash_algorithm?: string;
  cross_check_hash_value?: string;
  size_bytes?: string;
  mime_type?: string;
  address?: string;
  role?: string;
  uploader?: string;
}

export interface NormalizedUploadMediaBody {
  recordUid: string;
  stage?: string;
  category?: string;
  hashAlgorithm?: string;
  hashValue?: string;
  crossCheckHashAlgorithm?: string;
  crossCheckHashValue?: string;
  sizeBytes?: number;
  mimeType?: string;
  address?: string;
  role?: string;
}
