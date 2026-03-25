"use client";

import { useEffect, useRef, useState } from "react";
import { StemPlayer } from "@/components/stem-player";
import type { LibraryTrackRecord, StoredJobStatus } from "@/lib/jobs";

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

function getDisplayStatus(job: LocalJobState) {
  const status = job.remoteStatus?.status;

  if (status === "completed") {
    return { label: "Completed", className: "status-pill success" };
  }

  if (status === "failed" || job.uploadState === "error") {
    return { label: "Failed", className: "status-pill error" };
  }

  return { label: "Pending", className: "status-pill pending" };
}

function getStemIconPath(stemName: string) {
  return `/icons/stems/${stemName}.svg`;
}

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

async function getLibraryTracks(): Promise<LibraryTrackRecord[]> {
  const response = await fetch("/api/library", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch library tracks.");
  }

  const payload = (await response.json()) as { tracks: LibraryTrackRecord[] };
  return payload.tracks;
}

function shouldReplaceRemoteStatus(
  currentStatus: StoredJobStatus | undefined,
  incomingTrack: LibraryTrackRecord,
) {
  if (!currentStatus) {
    return true;
  }

  const currentHasStems = Boolean(currentStatus.stems?.length);
  const incomingHasStems = Boolean(incomingTrack.stems?.length);

  if (currentHasStems && !incomingHasStems) {
    return false;
  }

  if (
    currentStatus.status === "completed" &&
    incomingTrack.status !== "completed" &&
    currentHasStems
  ) {
    return false;
  }

  return incomingTrack.updatedAt >= currentStatus.updatedAt;
}

export function UploadConsole() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<LocalJobState[]>([]);
  const [libraryTracks, setLibraryTracks] = useState<LibraryTrackRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const jobsRef = useRef<LocalJobState[]>([]);
  const pollRef = useRef<number | null>(null);
  const completedLibraryTracks = libraryTracks.filter(
    (track) => track.status === "completed" && Boolean(track.stems?.length),
  );

  jobsRef.current = jobs;

  async function pollJobs() {
    const currentJobs = jobsRef.current;
    const hasActiveJobs = currentJobs.some((job) => {
      const status = job.remoteStatus?.status;
      return (
        job.uploadState !== "error" &&
        (status === "queued" || status === "processing" || !status)
      );
    });

    if (!hasActiveJobs) {
      return;
    }

    const updates = await Promise.all(
      currentJobs.map(async (job) => {
        if (job.uploadState === "error") {
          return job;
        }

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

  async function refreshLibrary() {
    try {
      const tracks = await getLibraryTracks();
      setLibraryTracks(tracks);
      setJobs((current) =>
        current.map((job) => {
          const matchingTrack = tracks.find((track) => track.jobId === job.jobId);

          if (!matchingTrack || !shouldReplaceRemoteStatus(job.remoteStatus, matchingTrack)) {
            return job;
          }

          return {
            ...job,
            trackName: matchingTrack.trackName,
            uploadState: matchingTrack.status === "failed" ? "error" : "uploaded",
            uploadMessage: matchingTrack.message ?? job.uploadMessage,
            remoteStatus: {
              jobId: matchingTrack.jobId,
              trackName: matchingTrack.trackName,
              status: matchingTrack.status,
              requestedAt: matchingTrack.requestedAt,
              updatedAt: matchingTrack.updatedAt,
              message: matchingTrack.message,
              stems: matchingTrack.stems,
            },
          };
        }),
      );
    } catch {
      return;
    }
  }

  useEffect(() => {
    pollRef.current = window.setInterval(() => {
      void pollJobs();
      void refreshLibrary();
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
    void refreshLibrary();
  }, [jobs.length]);

  function loadLibraryTrack(track: LibraryTrackRecord) {
    const remoteStatus: StoredJobStatus = {
      jobId: track.jobId,
      trackName: track.trackName,
      status: track.status,
      requestedAt: track.requestedAt,
      updatedAt: track.updatedAt,
      message: track.message,
      stems: track.stems,
    };

    setJobs((current) => {
      const existingJob = current.find((job) => job.jobId === track.jobId);

      if (existingJob) {
        return current.map((job) =>
          job.jobId === track.jobId
            ? {
                ...job,
                uploadState: track.status === "failed" ? "error" : "uploaded",
                uploadMessage: track.message ?? "",
                remoteStatus,
              }
            : job,
        );
      }

      return [
        {
          jobId: track.jobId,
          trackName: track.trackName,
          uploadState: track.status === "failed" ? "error" : "uploaded",
          uploadMessage: track.message ?? "",
          remoteStatus,
        },
        ...current,
      ];
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!selectedFile) {
      return;
    }

    setSubmitting(true);
    let pendingJobId: string | null = null;

    try {
      const reservation = await reserveUpload(selectedFile);
      pendingJobId = reservation.jobId;
      const resolvedTrackName = selectedFile.name.replace(/\.[^/.]+$/, "");

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
      form.reset();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected upload failure.";

      if (!pendingJobId) {
        setJobs((current) => [
          {
            jobId: crypto.randomUUID(),
            trackName: selectedFile.name.replace(/\.[^/.]+$/, ""),
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
      <section className="panel" style={{ gridColumn: "1 / -1" }}>
        <h2>Upload Track</h2>

        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <div className="upload-row">
              <label className="button secondary file-button" htmlFor="audioFile">
                Browse File
              </label>
              <input
                id="audioFile"
                className="sr-only"
                type="file"
                name="audioFile"
                accept="audio/*"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
              <div className="file-name">
                {selectedFile ? selectedFile.name : "No file selected"}
              </div>
              <button className="button" type="submit" disabled={!selectedFile || submitting}>
              {submitting ? "Uploading..." : "Upload and Separate"}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="panel" style={{ gridColumn: "1 / -1" }}>
        <h2>Library</h2>
        {completedLibraryTracks.length === 0 ? (
          <p className="muted">No completed songs yet.</p>
        ) : (
          <ul className="library-list">
            {completedLibraryTracks.map((track) => {
              return (
                <li className="library-card" key={track.jobId}>
                  <div className="library-copy">
                    <strong>{track.trackName}</strong>
                  </div>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => loadLibraryTrack(track)}
                  >
                    Load stems
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel" style={{ gridColumn: "1 / -1" }}>
        <h2>Jobs</h2>
        {jobs.length === 0 ? (
          <p className="muted">No jobs yet.</p>
        ) : (
          <ul className="job-list">
            {jobs.map((job) => {
              const displayStatus = getDisplayStatus(job);

              return (
                <li className="job-card" key={job.jobId}>
                  <div className="job-status-row">
                    <div className={displayStatus.className}>{displayStatus.label}</div>
                    {job.remoteStatus?.message ? (
                      <p className="small muted job-status-text">{job.remoteStatus.message}</p>
                    ) : null}
                  </div>

                  {job.remoteStatus?.stems?.length ? (
                    <ul className="stem-list">
                      {job.remoteStatus.stems.map((stem) => (
                        stem.url ? (
                          <StemPlayer
                            key={stem.key}
                            iconSrc={getStemIconPath(stem.name)}
                            label={stem.name}
                            url={stem.url}
                          />
                        ) : (
                          <li className="stem-card" key={stem.key}>
                            <div className="stem-player-wave muted">Preparing player...</div>
                          </li>
                        )
                      ))}
                    </ul>
                  ) : null}

                  <p className="small muted job-id">{job.jobId}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
