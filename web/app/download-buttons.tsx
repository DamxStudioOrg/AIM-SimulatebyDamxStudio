"use client";

import { useEffect, useState } from "react";
import { fetchShipped } from "@/lib/app-update";
import type { PlatformDownloads } from "@/lib/app-update";

const PLATFORMS: readonly {
  key: keyof PlatformDownloads;
  label: string;
}[] = [
  { key: "mac", label: "macOS" },
  { key: "windows", label: "Windows" },
  { key: "linux", label: "Linux" },
];

/**
 * Landing installer buttons. The hrefs come from the board's version
 * endpoint, so each release only uploads the stable files — no landing
 * edit per release. Until the map lands the buttons sit disabled;
 * against an older server (or an unreachable board) they fall back to
 * the shipped release page instead of a guessed file path.
 */
export default function DownloadButtons(): React.ReactElement {
  const [links, setLinks] = useState<PlatformDownloads | null>(null);
  const [page, setPage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchShipped()
      .then((shipped) => {
        if (!live) {
          return;
        }
        setPage(shipped.url);
        if (shipped.downloads !== undefined) {
          setLinks(shipped.downloads);
        }
      })
      .catch(() => {
        // Unreachable board: the release-page fallback still applies
        // below once any page URL is known; otherwise disabled.
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="download-icons">
      {PLATFORMS.map((platform) => {
        const href = links?.[platform.key] ?? page ?? "#";
        return (
          <a
            key={platform.key}
            href={href}
            className="download-btn"
            aria-label={`Download for ${platform.label}`}
            aria-disabled={href === "#"}
          >
            <span className="download-label">{platform.label}</span>
          </a>
        );
      })}
    </div>
  );
}
