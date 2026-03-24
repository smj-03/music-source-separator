#!/usr/bin/env python3
import json
import os
import subprocess
import time

import boto3


def main():
    queue_url = os.environ["AWS_QUEUE_URL"]
    sqs = boto3.client("sqs")

    while True:
        response = sqs.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=20,
            VisibilityTimeout=900,
        )

        messages = response.get("Messages", [])
        if not messages:
            continue

        for message in messages:
            receipt_handle = message["ReceiptHandle"]
            body = message["Body"]

            try:
                subprocess.run(
                    ["python3", "process_job.py"],
                    check=True,
                    env={**os.environ, "DEMUX_JOB_JSON": body},
                )
                sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt_handle)
            except subprocess.CalledProcessError:
                time.sleep(5)


if __name__ == "__main__":
    main()
