export type StemAsset = {
  name: string;
  key: string;
  url?: string;
};

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type DemucsJobMessage = {
  jobId: string;
  trackName: string;
  inputBucket: string;
  inputKey: string;
  outputBucket: string;
  statusKey: string;
  requestedAt: string;
};

export type StoredJobStatus = {
  jobId: string;
  trackName: string;
  status: JobStatus;
  requestedAt: string;
  updatedAt: string;
  message?: string;
  stems?: StemAsset[];
};

export type LibraryTrackRecord = {
  jobId: string;
  trackName: string;
  inputKey: string;
  status: JobStatus;
  requestedAt: string;
  updatedAt: string;
  message?: string;
  stems?: StemAsset[];
};

export function buildStatusKey(jobId: string) {
  return `jobs/${jobId}/status.json`;
}

export function buildUploadKey(jobId: string, fileName: string) {
  const normalizedName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "-");

  return `uploads/${jobId}/${normalizedName}`;
}
