import { UploadConsole } from "@/components/upload-console";

export default function HomePage() {
  return (
    <main className="page-shell">
      <div className="page-grid">
        <section className="hero">
          <h1>Separate music sources.</h1>
          <p>
            Upload a song and split it into the standard Demucs stems: vocals, drums, bass, and
            other. The original file is stored in S3, processed on EC2, and the separated results
            are returned as downloadable stem files when the job completes.
          </p>
        </section>

        <UploadConsole />
      </div>
    </main>
  );
}
