# StemSplit

Simple Next.js starter for music source separation with Demucs on AWS.

## Architecture

- The browser uploads the original track directly to an S3 input bucket using a presigned URL from the Next.js app.
- The app sends a job message to SQS after the upload completes.
- An EC2 worker polls SQS, downloads the source file from S3, runs Demucs, uploads the separated stems to an S3 output bucket, and writes a `status.json` file.
- The UI polls the Next.js API for job status and exposes temporary download links for completed stems.

## Project Structure

- `app/`: Next.js App Router UI and API routes.
- `components/upload-console.tsx`: Upload form and job polling UI.
- `lib/`: AWS clients, config helpers, and shared job metadata types.
- `worker/`: Python scripts for polling SQS and running Demucs on EC2.

## Environment Variables

Copy `.env.example` to `.env.local` for local development and provide:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_INPUT_BUCKET`
- `AWS_OUTPUT_BUCKET`
- `AWS_QUEUE_URL`
- `AWS_TRACKS_TABLE`
- `AWS_SIGNED_URL_TTL_SECONDS`

## Local Web App Setup

1. Install Node.js 20+.
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.
4. Open `http://localhost:3000`.

## EC2 Worker Setup

Use an instance type with enough CPU and disk for audio processing. GPU is optional but useful for heavier workloads.

1. Install system packages:

```bash
sudo apt update
sudo apt install -y ffmpeg python3 python3-venv
```

2. Create a worker environment:

```bash
cd worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. Export AWS credentials and queue configuration:

```bash
export AWS_REGION=eu-central-1
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_QUEUE_URL=...
```

4. Start polling:

```bash
python3 poll_queue.py
```

## Recommended AWS Setup

- One private S3 bucket for uploads and one private S3 bucket for outputs.
- One standard SQS queue for Demucs jobs.
- One DynamoDB table for track/job metadata, using `jobId` as the partition key.
- One EC2 IAM role with permission to `s3:GetObject`, `s3:PutObject`, `sqs:ReceiveMessage`, and `sqs:DeleteMessage`.
- One Next.js runtime with permission to sign S3 uploads and enqueue SQS messages.

## Important Notes

- The worker currently uses `htdemucs` and stores stems as `.wav`.
- `process_job.py` is written for a simple queue-polling model, not autoscaling.
- For production, replace static AWS keys with IAM roles, add auth, add file size limits, and move worker polling into a service such as `systemd`.
