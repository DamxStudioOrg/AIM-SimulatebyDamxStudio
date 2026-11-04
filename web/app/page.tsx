import DownloadButtons from "./download-buttons";
import HowSlideshow from "./how-slideshow";
import LandingStage from "./landing-challenge";
import PageHeader from "./page-header";
import PlanetPanel from "./planet-panel";
import ScrollHighlightScope from "./scroll-highlight-scope";
import ShareRow from "./share-row";

// Public landing: marketing only. This route must never import
// simulation, match, tote, or console modules (see landing:check).
export default function Landing(): React.ReactElement {
  return (
    <main>
      {/* Left-panel challenge copy; renders nothing here. */}
      <LandingStage />
      <PlanetPanel enabled>
        <section aria-labelledby="arena-how-heading" className="landing-section">
          <ScrollHighlightScope>
            <PageHeader id="arena-how-heading" words={["Simulate", "by Damx Studio"]} />
            <p className="hint">
              Use the app to simulate and get better with prompting, research, and
              experimentation. See how prompting affects output and how different models
              perform for your use case.
            </p>
            <ShareRow />
            <div className="landing-grid">
              <HowSlideshow />
              <p className="hint docs-teaser" data-highlight>
                New here? <a href="/docs">Read the docs</a>
              </p>
              <div className="download-row" id="download" data-highlight>
                <p className="hint">
                  Download the desktop app to run locally, compare models, and play the
                  simulation.
                </p>
                <DownloadButtons />
              </div>
            </div>
          </ScrollHighlightScope>
        </section>
      </PlanetPanel>
    </main>
  );
}
