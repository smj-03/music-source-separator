import { z } from "zod";
import { buildStatusKey } from "@/lib/jobs";
import { readStatus } from "@/lib/s3-status";

const paramsSchema = z.object({
  jobId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const params = await context.params;
  const parsed = paramsSchema.safeParse(params);

  if (!parsed.success) {
    return Response.json({ error: "Invalid job ID." }, { status: 400 });
  }

  const status = await readStatus(buildStatusKey(parsed.data.jobId));

  if (!status) {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }

  return Response.json(status);
}
