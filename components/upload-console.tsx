"use client";

import { useEffect, useRef, useState } from "react";
import type { StoredJobStatus } from "@/lib/jobs";

type UploadReservation = {
  jobId: string;
  key: string;
  signedUrl: string;
};

type LocalJobState = {
  jobId: string;
  trackName: string;
  uploadState: "idle" | "uploading" | "uploaded" | "error";
  uploadMessage: string;
  remoteStatus?: StoredJobStatus;
};

async function reserveUpload(file: File): Promise<UploadReservation> {
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "audio/mpeg",
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to reserve an S3 upload.");
  }

  return response.json();
}

async function uploadFile(file: File, reservation: UploadReservation) {
  const response = await fetch(reservation.signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "audio/mpeg",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error("Failed to upload audio to S3.");
  }
}

async function enqueueJob(jobId: string, trackName: string, inputKey: string) {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobId,
      trackName,
      inputKey,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to queue Demucs processing.");
  }
}

async function getStatus(jobId: string): Promise<StoredJobStatus> {
  const response = await fetch(`/api/jobs/${jobId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch job status.");
  }

  return response.json();
}

export function UploadConsole() {
  const [trackName, setTrackName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<LocalJobState[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const jobsRef = useRef<LocalJobState[]>([]);
  const pollRef = useRef<number | null>(null);

  jobsRef.current = jobs;

  async function pollJobs() {
    const currentJobs = jobsRef.current;
    const hasActiveJobs = currentJobs.some((job) => {
      const status = job.remoteStatus?.status;
      return status === "queued" || status === "processing" || !status;
    });

    if (!hasActiveJobs) {
      return;
    }

    const updates = await Promise.all(
      currentJobs.map(async (job) => {
        if (job.remoteStatus?.status === "completed" || job.remoteStatus?.status === "failed") {
          return job;
        }

        try {
          const remoteStatus = await getStatus(job.jobId);
          return { ...job, remoteStatus };
        } catch {
          return job;
        }
      }),
    );

    setJobs(updates);
  }

  useEffect(() => {
    pollRef.current = window.setInterval(() => {
      void pollJobs();
    }, 5000);

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    void pollJobs();
  }, [jobs.length]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      return;
    }

    setSubmitting(true);
    let pendingJobId: string | null = null;

    try {
      const reservation = await reserveUpload(selectedFile);
      pendingJobId = reservation.jobId;
      const resolvedTrackName = trackName.trim() || selectedFile.name.replace(/\.[^/.]+$/, "");

      setJobs((current) => [
        {
          jobId: reservation.jobId,
          trackName: resolvedTrackName,
          uploadState: "uploading",
          uploadMessage: "Uploading original audio to S3...",
        },
        ...current,
      ]);

      await uploadFile(selectedFile, reservation);
      await enqueueJob(reservation.jobId, resolvedTrackName, reservation.key);

      setJobs((current) =>
        current.map((job) =>
          job.jobId === reservation.jobId
            ? {
                ...job,
                uploadState: "uploaded",
                uploadMessage: "Queued for Demucs processing on EC2.",
              }
            : job,
        ),
      );

      setSelectedFile(null);
      setTrackName("");
      const form = event.currentTarget;
      form.reset();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected upload failure.";

      if (!pendingJobId) {
        setJobs((current) => [
          {
            jobId: crypto.randomUUID(),
            trackName: trackName.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""),
            uploadState: "error",
            uploadMessage: message,
          },
          ...current,
        ]);
        return;
      }

      setJobs((current) =>
        current.map((job) =>
          job.jobId === pendingJobId
            ? {
                ...job,
                uploadState: "error",
                uploadMessage: message,
              }
            : job,
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel-grid">
      <section className="panel">
        <h2>Upload Track</h2>
        <p className="muted">
          Audio is uploaded directly to S3. Once the upload completes, the app sends a job to SQS
          and an EC2 worker runs Demucs to generate stems.
        </p>

        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="trackName">Track name</label>
            <input
              id="trackName"
              type="text"
              name="trackName"
              placeholder="Example: Midnight Session"
              value={trackName}
              onChange={(event) => setTrackName(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="audioFile">Audio file</label>
            <input
              id="audioFile"
              type="file"
              name="audioFile"
              accept="audio/*"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
          </div>

          <div className="button-row">
            <button className="button" type="submit" disabled={!selectedFile || submitting}>
              {submitting ? "Uploading..." : "Upload and Separate"}
            </button>
          </div>
        </form>
      </section>

      <aside className="panel">
        <h3>AWS Flow</h3>
        <ul className="info-list">
          <li className="info-card">1. Browser uploads the source file directly to the input S3 bucket.</li>
          <li className="info-card">2. Next.js enqueues an SQS message with the job metadata.</li>
          <li className="info-card">3. EC2 worker downloads audio, runs Demucs, and uploads stems to S3.</li>
          <li className="info-card">4. The worker writes `status.json` so the UI can poll progress and fetch results.</li>
        </ul>
      </aside>

      <section className="panel" style={{ gridColumn: "1 / -1" }}>
        <h2>Jobs</h2>
        {jobs.length === 0 ? (
          <p className="muted">No jobs yet.</p>
        ) : (
          <ul className="job-list">
            {jobs.map((job) => {
              const remoteStatus = job.remoteStatus?.status;
              const pillClassName =
                remoteStatus === "completed"
                  ? "status-pill success"
                  : remoteStatus === "failed"
                    ? "status-pill error"
                    : "status-pill";

              return (
                <li className="job-card" key={job.jobId}>
                  <strong>{job.trackName}</strong>
                  <div className={pillClassName}>{remoteStatus ?? job.uploadState}</div>
                  <p className="small muted">
                    {job.remoteStatus?.message ?? job.uploadMessage}
                  </p>
                  <p className="small muted">Job ID: {job.jobId}</p>

                  {job.remoteStatus?.stems?.length ? (
                    <ul className="stem-list">
                      {job.remoteStatus.stems.map((stem) => (
                        <li className="stem-card" key={stem.key}>
                          <strong>{stem.name}</strong>
                          {stem.url ? (
                            <a className="link-button" href={stem.url} target="_blank" rel="noreferrer">
                              Download stem
                            </a>
                          ) : (
                            <span className="small muted">Preparing download link...</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
