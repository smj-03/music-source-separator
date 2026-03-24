import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { getS3Client } from "@/lib/aws";
import { getEnv, getSignedUrlTtlSeconds } from "@/lib/config";
import { buildUploadKey } from "@/lib/jobs";

const uploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = uploadSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid upload request payload." },
      { status: 400 },
    );
  }

  const { fileName, contentType } = parsed.data;
  const jobId = crypto.randomUUID();
  const inputBucket = getEnv("AWS_INPUT_BUCKET");
  const key = buildUploadKey(jobId, fileName);

  const client = getS3Client();
  const signedUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: inputBucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: getSignedUrlTtlSeconds() },
  );

  return Response.json({
    jobId,
    key,
    bucket: inputBucket,
    signedUrl,
  });
}
