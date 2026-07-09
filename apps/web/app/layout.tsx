import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "DROPLOOP",
  description: "AI VJ Pack Builder"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
