import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { z } from "zod";
import { getSqsClient } from "@/lib/aws";
import { getEnv } from "@/lib/config";
import {
  buildStatusKey,
  type DemucsJobMessage,
  type StoredJobStatus,
} from "@/lib/jobs";
import { writeInitialStatus } from "@/lib/s3-status";

const createJobSchema = z.object({
  jobId: z.string().uuid(),
  trackName: z.string().min(1),
  inputKey: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createJobSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid job payload." }, { status: 400 });
  }

  const inputBucket = getEnv("AWS_INPUT_BUCKET");
  const outputBucket = getEnv("AWS_OUTPUT_BUCKET");
  const queueUrl = getEnv("AWS_QUEUE_URL");
  const { jobId, trackName, inputKey } = parsed.data;
  const statusKey = buildStatusKey(jobId);

  const initialStatus: StoredJobStatus = {
    jobId,
    trackName,
    status: "queued",
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: "Upload complete. Waiting for an EC2 worker to start Demucs.",
  };

  await writeInitialStatus(statusKey, initialStatus);

  const message: DemucsJobMessage = {
    jobId,
    trackName,
    inputBucket,
    inputKey,
    outputBucket,
    statusKey,
    requestedAt: initialStatus.requestedAt,
  };

  const client = getSqsClient();
  await client.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  );

  return Response.json({
    jobId,
    statusKey,
    status: initialStatus.status,
  });
}
