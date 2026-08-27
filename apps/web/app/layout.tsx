import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Keycap Forge — Editor",
  description: "M2 basic 3D editor scaffold",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
