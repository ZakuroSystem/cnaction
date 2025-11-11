"""Application entrypoint for running the CNACTION server."""
from __future__ import annotations

import os

from cnaction.web import create_app

app, socketio = create_app()


def main() -> None:
    port = int(os.environ.get("PORT", 8071))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    socketio.run(app, debug=debug, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
