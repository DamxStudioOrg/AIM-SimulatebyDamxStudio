"use client";

import SecretReveal from "./secret-reveal";

/**
 * Arena ID recovery card: the ID stays masked until revealed (it
 * auto-hides again), with a copy action and the blunt warning —
 * sealed progress only opens under this ID, so a misplaced ID means
 * lost history, challenges, leagues, and boards.
 */
export default function RecoveryCard({ uid }: { uid: string }): React.ReactElement {
  return (
    <section className="recovery-card" aria-labelledby="recovery-heading">
      <h3 id="recovery-heading">Keep your arena ID</h3>
      <p className="hint">
        Your history, challenges, leagues, and boards are encrypted with this ID.{" "}
        <strong>
          Store it somewhere safe — lose the ID and your progress can&apos;t be
          restored.
        </strong>
      </p>
      <p className="cta-row key-actions">
        <SecretReveal value={uid} label="Arena ID" />
      </p>
    </section>
  );
}
