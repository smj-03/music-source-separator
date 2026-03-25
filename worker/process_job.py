#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import boto3

EXPECTED_STEMS = ["vocals", "drums", "bass", "other"]


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def write_status(s3_client, bucket, key, payload):
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(payload, indent=2).encode("utf-8"),
        ContentType="application/json",
    )


def write_library_record(job, payload):
    table_name = os.environ.get("AWS_TRACKS_TABLE")
    if not table_name:
        return

    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(table_name)
    table.put_item(
        Item={
            "jobId": job["jobId"],
            "trackName": job["trackName"],
            "inputKey": job["inputKey"],
            "status": payload["status"],
            "requestedAt": payload["requestedAt"],
            "updatedAt": payload["updatedAt"],
            "message": payload.get("message"),
            "stems": payload.get("stems", []),
        }
    )


def upload_file(s3_client, bucket, source_path, destination_key):
    s3_client.upload_file(str(source_path), bucket, destination_key)


def run_demucs(input_path, output_dir):
    command = [
        "python3",
        "-m",
        "demucs",
        "-n",
        "htdemucs",
        "-o",
        str(output_dir),
        str(input_path),
    ]
    subprocess.run(command, check=True)


def collect_stems(job_id, separated_root, original_name):
    stem_parent = separated_root / "htdemucs" / Path(original_name).stem
    produced = []

    for stem_name in EXPECTED_STEMS:
        stem_path = stem_parent / f"{stem_name}.wav"
        if stem_path.exists():
            produced.append((stem_name, stem_path, f"jobs/{job_id}/stems/{stem_name}.wav"))

    if not produced:
        raise RuntimeError("Demucs completed but no expected stem files were found.")

    return produced


def process_message(job):
    s3_client = boto3.client("s3")
    input_bucket = job["inputBucket"]
    output_bucket = job["outputBucket"]
    status_key = job["statusKey"]
    job_id = job["jobId"]
    input_key = job["inputKey"]
    track_name = job["trackName"]

    initial_status = {
        "jobId": job_id,
        "trackName": track_name,
        "status": "processing",
        "requestedAt": job["requestedAt"],
        "updatedAt": utc_now(),
        "message": "Worker picked up the job and is running Demucs.",
    }
    write_status(s3_client, output_bucket, status_key, initial_status)
    write_library_record(job, initial_status)

    temp_dir = Path(tempfile.mkdtemp(prefix=f"demucs-{job_id}-"))

    try:
        source_path = temp_dir / Path(input_key).name
        separated_dir = temp_dir / "output"
        separated_dir.mkdir(parents=True, exist_ok=True)

        s3_client.download_file(input_bucket, input_key, str(source_path))
        run_demucs(source_path, separated_dir)

        produced_stems = collect_stems(job_id, separated_dir, source_path.name)
        stem_descriptors = []

        for stem_name, local_path, destination_key in produced_stems:
            upload_file(s3_client, output_bucket, local_path, destination_key)
            stem_descriptors.append(
                {
                    "name": stem_name,
                    "key": destination_key,
                }
            )

        final_status = {
            "jobId": job_id,
            "trackName": track_name,
            "status": "completed",
            "requestedAt": job["requestedAt"],
            "updatedAt": utc_now(),
            "message": "Stem separation complete.",
            "stems": stem_descriptors,
        }
        write_status(s3_client, output_bucket, status_key, final_status)
        write_library_record(job, final_status)
    except Exception as error:
        failed_status = {
            "jobId": job_id,
            "trackName": track_name,
            "status": "failed",
            "requestedAt": job["requestedAt"],
            "updatedAt": utc_now(),
            "message": str(error),
        }
        write_status(s3_client, output_bucket, status_key, failed_status)
        write_library_record(job, failed_status)
        raise
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def main():
    raw_message = os.environ.get("DEMUX_JOB_JSON")
    if not raw_message:
        raise RuntimeError("DEMUX_JOB_JSON environment variable is required.")

    payload = json.loads(raw_message)
    process_message(payload)


if __name__ == "__main__":
    main()
