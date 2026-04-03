# CNACTION

Modernised Flask + Socket.IO server powering the CNACTION cooperative cooking game. The
project has been refactored into a clean, well-documented structure with a focus on ease of
configuration and local development.

## Features

- **Application factory** – `cnaction.web.create_app` wires together the Flask application,
  Socket.IO integration, HTTP routes, and background tasks.
- **Modular services** – dedicated services for stage persistence and asset uploads provide
  clean boundaries and extensive validation.
- **Typed configuration** – `AppSettings` centralises runtime configuration with sensible
  defaults and environment variable overrides.
- **Background processing** – Socket.IO background tasks maintain game timers and clean up
  finished rooms without blocking request handlers.

## Project Layout

```
├── app.py                  # Minimal entrypoint delegating to the application factory
├── cnaction/
│   ├── settings.py         # Dataclass-driven runtime settings
│   ├── services/
│   │   ├── stage_store.py  # Stage CRUD helpers
│   │   └── uploads.py      # Upload management with backups and validation
│   └── web/
│       ├── __init__.py     # create_app factory
│       ├── routes.py       # HTTP blueprints
│       ├── socketio_handlers.py
│       └── background.py   # Background task orchestration
├── templates/              # Jinja templates
└── static/                 # Front-end assets
```

The existing gameplay logic lives in `cnaction/game.py`, `models.py`, and `utils.py`.

## Getting Started

### Installation

Create a virtual environment and install the dependencies declared in `pyproject.toml`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

### Running the Server

Launch the development server via the module entrypoint:

```bash
python app.py
```

Environment variables can be used to override runtime behaviour:

- `PORT` – HTTP port (defaults to `8071`).
- `FLASK_DEBUG` – set to `1` to enable debug mode.
- `CNACTION_SECRET_KEY` – Flask session secret.
- `CNACTION_STAGE_DIR` – directory for persisted stage configurations.
- `CNACTION_UPLOAD_PASSWORD` – password for the asset upload endpoint.
- `CNACTION_ALLOWED_EXTENSIONS` – comma-separated list of permitted upload extensions.

## Testing

At present there is no automated test suite. The recommended manual verification is to
start the server locally and interact with the game client. Contributions adding unit or
integration tests are welcome.
