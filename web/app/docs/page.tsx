"use client";

import { useAuth } from "../auth-context";
import DocsPanel from "../docs-panel";
import { useMoonTitle } from "../moon-visual";
import NavPanel from "../nav-panel";
import PageHeader from "../page-header";
import PlanetPanel from "../planet-panel";
import ScrollHighlightScope from "../scroll-highlight-scope";

/**
 * Docs: what the app can do. Public, so it wears two shells — the
 * signed-in console shell with cross-navigation, and the landing's
 * marketing shell (no nav) for signed-out visitors arriving from
 * the landing teaser's /docs link.
 */
export default function DocsPage(): React.ReactElement {
  const auth = useAuth();
  // Docs publishes no stage in either shell, so the title owns it.
  useMoonTitle("What it does");
  if (!auth.signedIn) {
    return (
      <main>
        <PlanetPanel enabled>
          <section aria-labelledby="docs-heading" className="landing-section">
            <ScrollHighlightScope>
              <PageHeader id="docs-heading" words={["What it", "does"]} />
              <DocsPanel />
            </ScrollHighlightScope>
          </section>
        </PlanetPanel>
      </main>
    );
  }
  return (
    <main className="console-page">
      <PlanetPanel enabled>
        <div className="shell">
          <NavPanel />
          <div className="shell-main">
            <PageHeader words={["What it", "does"]} />
            <DocsPanel />
          </div>
        </div>
      </PlanetPanel>
    </main>
  );
}
