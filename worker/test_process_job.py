import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path


WORKER_PATH = Path(__file__).with_name("process_job.py")


class FakeS3Client:
    def __init__(self):
        self.downloads = []
        self.uploads = []
        self.status_payloads = []

    def put_object(self, Bucket, Key, Body, ContentType):
        self.status_payloads.append(
            {
                "bucket": Bucket,
                "key": Key,
                "body": json.loads(Body.decode("utf-8")),
                "content_type": ContentType,
            }
        )

    def upload_file(self, Filename, Bucket, Key):
        self.uploads.append(
            {
                "filename": Filename,
                "bucket": Bucket,
                "key": Key,
            }
        )

    def download_file(self, Bucket, Key, Filename):
        self.downloads.append(
            {
                "bucket": Bucket,
                "key": Key,
                "filename": Filename,
            }
        )
        Path(Filename).write_bytes(b"fake audio")


def load_process_job_module():
    fake_boto3 = types.SimpleNamespace(client=lambda _service_name: FakeS3Client())
    sys.modules["boto3"] = fake_boto3

    spec = importlib.util.spec_from_file_location("process_job_under_test", WORKER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ProcessJobTests(unittest.TestCase):
    def setUp(self):
        self.module = load_process_job_module()
        self.fake_s3 = FakeS3Client()
        self.module.boto3 = types.SimpleNamespace(client=lambda _service_name: self.fake_s3)
        self.job = {
            "jobId": "job-123",
            "trackName": "Local Test Song",
            "inputBucket": "input-bucket",
            "inputKey": "uploads/job-123/song.mp3",
            "outputBucket": "output-bucket",
            "statusKey": "jobs/job-123/status.json",
            "requestedAt": "2026-03-25T10:00:00+00:00",
        }

    def test_process_message_uploads_expected_stems_and_status(self):
        def fake_run_demucs(input_path, output_dir):
            stem_dir = output_dir / "htdemucs" / Path(input_path).stem
            stem_dir.mkdir(parents=True, exist_ok=True)

            for stem_name in self.module.EXPECTED_STEMS:
                (stem_dir / f"{stem_name}.wav").write_bytes(f"{stem_name}-audio".encode("utf-8"))

        self.module.run_demucs = fake_run_demucs

        self.module.process_message(self.job)

        self.assertEqual(len(self.fake_s3.downloads), 1)
        self.assertEqual(len(self.fake_s3.uploads), 4)
        self.assertEqual(
            [upload["key"] for upload in self.fake_s3.uploads],
            [
                "jobs/job-123/stems/vocals.wav",
                "jobs/job-123/stems/drums.wav",
                "jobs/job-123/stems/bass.wav",
                "jobs/job-123/stems/other.wav",
            ],
        )

        self.assertEqual(len(self.fake_s3.status_payloads), 2)
        self.assertEqual(self.fake_s3.status_payloads[0]["body"]["status"], "processing")
        self.assertEqual(self.fake_s3.status_payloads[1]["body"]["status"], "completed")
        self.assertEqual(
            [stem["name"] for stem in self.fake_s3.status_payloads[1]["body"]["stems"]],
            self.module.EXPECTED_STEMS,
        )

    def test_process_message_writes_failed_status_when_demucs_fails(self):
        def fake_run_demucs(_input_path, _output_dir):
            raise RuntimeError("demucs exploded")

        self.module.run_demucs = fake_run_demucs

        with self.assertRaisesRegex(RuntimeError, "demucs exploded"):
            self.module.process_message(self.job)

        self.assertEqual(len(self.fake_s3.status_payloads), 2)
        self.assertEqual(self.fake_s3.status_payloads[0]["body"]["status"], "processing")
        self.assertEqual(self.fake_s3.status_payloads[1]["body"]["status"], "failed")
        self.assertEqual(self.fake_s3.status_payloads[1]["body"]["message"], "demucs exploded")


if __name__ == "__main__":
    unittest.main()
