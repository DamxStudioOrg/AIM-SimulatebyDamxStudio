"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  FacebookLogoIcon,
  InstagramLogoIcon,
  LinkedinLogoIcon,
  RedditLogoIcon,
  TelegramLogoIcon,
  WhatsappLogoIcon,
  XLogoIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import CopyButton from "./copy-button";

const SHARE_TEXT = "Can your prompt save the city? Simulate:";
const SITE_URL = "https://simulate.damxstudio.com";

interface ShareTarget {
  label: string;
  href: (text: string, url: string) => string;
  Logo: Icon;
}

/**
 * Every major platform's share URL, same dare everywhere.
 * Instagram ships no web share endpoint, so it rides a copy
 * button below instead of a link.
 */
const TARGETS: readonly ShareTarget[] = [
  {
    label: "Share on X",
    href: (text, url) => `https://x.com/intent/tweet?text=${text}&url=${url}`,
    Logo: XLogoIcon,
  },
  {
    label: "Share on Facebook",
    href: (_text, url) => `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    Logo: FacebookLogoIcon,
  },
  {
    label: "Share on WhatsApp",
    href: (text, url) => `https://wa.me/?text=${text}%20${url}`,
    Logo: WhatsappLogoIcon,
  },
  {
    label: "Share on Telegram",
    href: (text, url) => `https://t.me/share/url?url=${url}&text=${text}`,
    Logo: TelegramLogoIcon,
  },
  {
    label: "Share on LinkedIn",
    href: (_text, url) => `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    Logo: LinkedinLogoIcon,
  },
  {
    label: "Share on Reddit",
    href: (text, url) => `https://www.reddit.com/submit?title=${text}&url=${url}`,
    Logo: RedditLogoIcon,
  },
];

/**
 * Instagram ships no web share endpoint, so its row button copies
 * the dare + link for a DM or story. Same 44px ghost box as the
 * link siblings; a check swaps in briefly on copy.
 */
function InstagramCopy({ text }: Readonly<{ text: string }>): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timer.current = window.setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="ghost icon-button"
      aria-label={copied ? "Copied for Instagram" : "Copy for Instagram"}
      onClick={() => {
        void copy();
      }}
    >
      {copied ? (
        <CheckIcon size={18} aria-hidden="true" />
      ) : (
        <InstagramLogoIcon size={18} aria-hidden="true" />
      )}
    </button>
  );
}

/** Challenge-a-friend share row for the How to simulate landing. */
export default function ShareRow(): React.ReactElement {
  const text = encodeURIComponent(SHARE_TEXT);
  const url = encodeURIComponent(SITE_URL);

  return (
    <div className="share-row">
      <span className="hint">Challenge a friend:</span>
      {TARGETS.map((target) => (
        <a
          key={target.label}
          className="ghost icon-button"
          href={target.href(text, url)}
          target="_blank"
          rel="noreferrer"
          aria-label={target.label}
        >
          <target.Logo size={18} aria-hidden="true" />
        </a>
      ))}
      <InstagramCopy text={`${SHARE_TEXT} ${SITE_URL}`} />
      <CopyButton text={SITE_URL} />
    </div>
  );
}
