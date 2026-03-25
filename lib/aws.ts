import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { getEnv } from "@/lib/config";

const region = process.env.AWS_REGION;

function assertRegion() {
  if (!region) {
    throw new Error("Missing required environment variable: AWS_REGION");
  }

  return region;
}

export function getS3Client() {
  return new S3Client({
    region: assertRegion(),
    credentials: {
      accessKeyId: getEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });
}

export function getSqsClient() {
  return new SQSClient({
    region: assertRegion(),
    credentials: {
      accessKeyId: getEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });
}

export function getDynamoDbClient() {
  return new DynamoDBClient({
    region: assertRegion(),
    credentials: {
      accessKeyId: getEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });
}
