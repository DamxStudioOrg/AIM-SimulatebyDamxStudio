"""Desktop sidecar entry: serve the sim API on 127.0.0.1.

Usage: aim-sim-server [port]  (default 8000). Local and scripted models
only; hosted providers need the llm extra and answer 501 without it.
"""

from __future__ import annotations

import sys

import uvicorn

from aim_sim.api import create_app


def main(argv: list[str]) -> None:
    """Serve the sim API on 127.0.0.1 at the given (or default) port."""
    port = int(argv[1]) if len(argv) > 1 else 8000
    uvicorn.run(create_app(), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main(sys.argv)
