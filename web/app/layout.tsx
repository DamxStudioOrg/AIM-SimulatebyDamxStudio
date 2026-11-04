import type { Metadata, Viewport } from "next";
// Single style entry: globals.css pulls Tailwind, the BoardUI theme,
// then the site styles (in components layer order) — see styles/globals.css.
import "@/styles/globals.css";
import { Inter } from "next/font/google";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], axes: ["opsz"] });
import { AuthProvider } from "./auth-context";
import { ModeProvider } from "./mode-context";
import SiteBackground from "./site-background";
import MotionFx from "./motion";
import SiteHeader from "./site-header";
import { MoonVisualProvider } from "./moon-visual";
import RunCompleteToast from "./run-complete-toast";
import SwRegister from "./sw-register";
import SwUpdateToast from "./sw-update-toast";
import TourOverlay from "./tour-overlay";

export const metadata: Metadata = {
  title: "Simulate by Damx Studio",
  description: "simulate by Damx Studio: prompt-arena matches and tote pack-outs.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/logo.png", sizes: "256x256", type: "image/png" }],
    apple: "/logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#a33030",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased dark`}>
      <body>
        <a className="skip-link" href="#arena-page">
          Skip to content
        </a>
        <SiteBackground />
        <AuthProvider>
          <ModeProvider>
            <MoonVisualProvider>
              <SiteHeader />
              {children}
            </MoonVisualProvider>
          </ModeProvider>
        </AuthProvider>
        <MotionFx />
        <SwRegister />
        <SwUpdateToast />
        <RunCompleteToast />
        <TourOverlay />
      </body>
    </html>
  );
}
