import type { ReactNode } from "react";
import Link from "next/link";
import SimStatus from "./sim-status";
import { link } from "@/lib/routing";

export default function NavPanel({
  children,
}: Readonly<{ children?: ReactNode }>): React.ReactElement {
  // Client-side links: menu hops must not reload the page, or an
  // in-flight simulation (which lives outside the route) would lose
  // its stream. The run keeps playing; a toast reports it done.
  return (
    <aside className="panel nav-panel">
      <p className="brand">
        {/* Signed-in shell only, so the brand rides to the console. */}
        <Link href={link("console")}>simulate</Link>
      </p>
      {children}
      <nav aria-label="Site" className="site-nav">
        <ul className="nav-list">
          <li>
            <Link href={link("console")}>Operator console</Link>
          </li>
          <li>
            <Link href={link("ranks")}>Ranks</Link>
          </li>
          <li>
            <Link href={link("prompts")}>My prompts</Link>
          </li>
          <li>
            <Link href={link("docs")}>Docs</Link>
          </li>
          <li>
            <Link href={link("account")}>Account</Link>
          </li>
        </ul>
      </nav>
      <SimStatus />
    </aside>
  );
}
