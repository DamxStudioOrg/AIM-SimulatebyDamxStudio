// One header design for every page: overlapping word pills on the
// dark ground — a yellow pill and an orange pill riding low — with
// an optional green third pill overlapping below. Words stay
// separate spans with real spaces between, so assistive tech and
// text search read the plain title. Zero imports: safe for the
// marketing-only landing (see landing:check).
export default function PageHeader({
  words,
  id,
  highlightTitle = false,
}: Readonly<{
  words: readonly [string, string] | readonly [string, string, string];
  id?: string;
  highlightTitle?: boolean;
}>): React.ReactElement {
  const [first, second, third] = words;
  return (
    <h1
      className="page-header"
      id={id}
      data-highlight-title={highlightTitle ? true : undefined}
    >
      <span className="ph-row">
        <span className="ph-pill ph-a">{first}</span>{" "}
        <span className="ph-pill ph-b">{second}</span>
      </span>
      {third === undefined ? null : (
        <>
          {" "}
          <span className="ph-row ph-row-2">
            <span className="ph-pill ph-c">{third}</span>
          </span>
        </>
      )}
    </h1>
  );
}
