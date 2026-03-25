import { listLibraryTracks } from "@/lib/library";

export async function GET() {
  const tracks = await listLibraryTracks();
  return Response.json({ tracks });
}
