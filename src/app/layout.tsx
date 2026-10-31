import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { LicenseGate } from "@/components/LicenseGate";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Brand face: wordmark + headings (body copy stays Geist for dense UI).
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const DESCRIPTION = "Sorot momen terbaikmu. Video panjang jadi klip 9:16: pilih clip, reframe wajah, caption, dan skor.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SOROTIN_BASE_URL || "http://localhost:3000"),
  title: { default: "Sorotin — Sorot momen terbaikmu", template: "%s · Sorotin" },
  description: DESCRIPTION,
  applicationName: "Sorotin",
  openGraph: {
    title: "Sorotin — Sorot momen terbaikmu",
    description: DESCRIPTION,
    siteName: "Sorotin",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "Sorotin — Sorot momen terbaikmu", description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#0A0F0D",
  colorScheme: "dark",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      data-shell={process.env.SOROTIN_TAURI === "1" ? "desktop" : "web"}
      className={`${geistSans.variable} ${geistMono.variable} ${jakarta.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <LicenseGate>{children}</LicenseGate>
      </body>
    </html>
  );
}
