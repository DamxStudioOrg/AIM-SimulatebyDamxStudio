"use client";

import AdoptUidForm from "./adopt-uid-form";
import { Button } from "@/components/base/buttons/button";
import { useAuth } from "./auth-context";

/**
 * Shared sign-in gate: one random local ID, no password, no email.
 * Fresh visitors create it with one click; previous users expand
 * the arena-ID login and adopt the ID they stored.
 */
export default function SigninGate({
  headingId,
  title,
  hint,
}: Readonly<{
  headingId: string;
  title: string;
  hint: string;
}>): React.ReactElement {
  const auth = useAuth();
  return (
    <section className="signin-card" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <p>{hint}</p>
      <p className="cta-row">
        <Button variant="primary" onClick={auth.continueAsGuest}>
          Create account
        </Button>
      </p>
      <AdoptUidForm idPrefix={headingId} onAdopted={auth.continueAsGuest} />
    </section>
  );
}
