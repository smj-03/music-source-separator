import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoDbClient } from "@/lib/aws";
import { getOptionalEnv } from "@/lib/config";
import type { LibraryTrackRecord, StoredJobStatus } from "@/lib/jobs";
import { attachStemUrls } from "@/lib/s3-status";

function getTracksTableName() {
  return getOptionalEnv("AWS_TRACKS_TABLE");
}

function getDocumentClient() {
  return DynamoDBDocumentClient.from(getDynamoDbClient(), {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
}

export async function upsertLibraryTrack(record: LibraryTrackRecord) {
  const tableName = getTracksTableName();

  if (!tableName) {
    return;
  }

  const client = getDocumentClient();
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: record,
    }),
  );
}

export async function listLibraryTracks() {
  const tableName = getTracksTableName();

  if (!tableName) {
    return [] as LibraryTrackRecord[];
  }

  const client = getDocumentClient();
  const response = await client.send(
    new ScanCommand({
      TableName: tableName,
      ConsistentRead: true,
    }),
  );

  const items = (response.Items ?? []) as LibraryTrackRecord[];
  const enrichedItems = await Promise.all(
    items.map(async (item) => ({
      ...item,
      stems: item.stems?.length ? await attachStemUrls(item.stems) : item.stems,
    })),
  );

  return enrichedItems.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function syncLibraryTrackFromStatus(status: StoredJobStatus, inputKey?: string) {
  await upsertLibraryTrack({
    jobId: status.jobId,
    trackName: status.trackName,
    inputKey: inputKey ?? "",
    status: status.status,
    requestedAt: status.requestedAt,
    updatedAt: status.updatedAt,
    message: status.message,
    stems: status.stems,
  });
}
