import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StemSplit",
  description: "Upload a track, send it to AWS, and separate stems with Demucs on EC2.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
