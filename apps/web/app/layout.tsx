import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import { ExpressiveAccent } from "@/components/effects/expressive-accent";

export const metadata: Metadata = {
  title: "MNEMO",
  description: "My Neural & Extended Memory Oracle — a second mind that knows you, remembers everything, and connects the dots.",
  applicationName: "MNEMO",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "MNEMO" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#F3F7F7",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover", // draw under the notch + home indicator; we pad with safe-area insets
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-backdrop" aria-hidden />
        {children}
        <Toaster />
        <ExpressiveAccent />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
