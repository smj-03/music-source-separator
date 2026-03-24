import { UploadConsole } from "@/components/upload-console";

export default function HomePage() {
  return (
    <main className="page-shell">
      <div className="page-grid">
        <section className="hero">
          <p className="eyebrow">Next.js + AWS + Demucs</p>
          <h1>Separate vocals, drums, bass, and more.</h1>
          <p>
            StemSplit is a simple front end for music source separation. Upload a song, store the
            source and separated stems in S3, then let an EC2 worker process the track with Demucs.
          </p>
        </section>

        <UploadConsole />
      </div>
    </main>
  );
}
