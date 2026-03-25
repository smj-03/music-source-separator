import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client } from "@/lib/aws";
import { getEnv } from "@/lib/config";
import type { StemAsset, StoredJobStatus } from "@/lib/jobs";

async function streamToString(stream: ReadableStream | NodeJS.ReadableStream) {
  if ("getReader" in stream) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks).toString("utf-8");
  }

  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf-8");
}

export async function writeInitialStatus(statusKey: string, status: StoredJobStatus) {
  const client = getS3Client();
  const outputBucket = getEnv("AWS_OUTPUT_BUCKET");

  await client.send(
    new PutObjectCommand({
      Bucket: outputBucket,
      Key: statusKey,
      Body: JSON.stringify(status, null, 2),
      ContentType: "application/json",
    }),
  );
}

export async function readStatus(statusKey: string) {
  const client = getS3Client();
  const outputBucket = getEnv("AWS_OUTPUT_BUCKET");

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: outputBucket,
        Key: statusKey,
      }),
    );

    if (!response.Body) {
      return null;
    }

    const body = await streamToString(response.Body as ReadableStream | NodeJS.ReadableStream);
    const parsed = JSON.parse(body) as StoredJobStatus;

    if (!parsed.stems?.length) {
      return parsed;
    }

    const stems = await Promise.all(
      parsed.stems.map(async (stem) => ({
        ...stem,
        url: await createDownloadUrl(stem.key),
      })),
    );

    return {
      ...parsed,
      stems,
    };
  } catch (error) {
    if (typeof error === "object" && error && "name" in error && error.name === "NoSuchKey") {
      return null;
    }

    throw error;
  }
}

async function createDownloadUrl(key: string) {
  const client = getS3Client();
  const outputBucket = getEnv("AWS_OUTPUT_BUCKET");

  await client.send(
    new HeadObjectCommand({
      Bucket: outputBucket,
      Key: key,
    }),
  );

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: outputBucket,
      Key: key,
    }),
    { expiresIn: 3600 },
  );
}

export async function attachStemUrls(stems: StemAsset[]) {
  return Promise.all(
    stems.map(async (stem) => ({
      ...stem,
      url: await createDownloadUrl(stem.key),
    })),
  );
}

export function buildStemAssets(jobId: string, stems: string[]): StemAsset[] {
  return stems.map((stemName) => ({
    name: stemName,
    key: `jobs/${jobId}/stems/${stemName}.wav`,
  }));
}
