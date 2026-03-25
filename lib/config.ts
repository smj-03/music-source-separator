const requiredVars = [
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_INPUT_BUCKET",
  "AWS_OUTPUT_BUCKET",
  "AWS_QUEUE_URL",
] as const;

export function getEnv(name: (typeof requiredVars)[number]) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getOptionalEnv(name: string) {
  return process.env[name];
}

export function getSignedUrlTtlSeconds() {
  const rawValue = process.env.AWS_SIGNED_URL_TTL_SECONDS ?? "900";
  const parsed = Number(rawValue);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 900;
  }

  return parsed;
}
