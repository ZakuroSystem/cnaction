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

## How to Play

1. Open the game in your browser after starting the server.
2. Choose **オートマッチ** to join an available room, or **ルーム選択** to enter a room name.
3. Press the start button to begin the session.

### Controls

- Move: Arrow keys / WASD
- Action: Space key
- Mobile: press and hold the right/bottom edges to move, use the action button to interact

### Gameplay Loop

- Follow the order list to assemble dishes.
- Pick up ingredients, cook them at the appropriate stations, and submit completed items.
- Earn as many points as possible before the timer runs out.

### Leaving or Resetting

- Use the in-game **ゲームを退出** button to leave a room and return to the start screen.
- Use the **ルームを削除** button (manual mode) to remove a room you created.

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

### Windows one-click setup/start

If Python 3.10+ is already installed, you can use:

```bat
setup_and_run.bat
```

- First run: creates `.venv` and installs `requirements.txt`.
- Later runs: starts the server directly using the existing virtualenv.

Environment variables can be used to override runtime behaviour:

- `PORT` – HTTP port (defaults to `8071`).
- `FLASK_DEBUG` – set to `1` to enable debug mode.
- `CNACTION_SECRET_KEY` – Flask session secret.
- `CNACTION_STAGE_DIR` – directory for persisted stage configurations.
- `CNACTION_UPLOAD_PASSWORD` – password for the asset upload endpoint.
- `CNACTION_ALLOWED_EXTENSIONS` – comma-separated list of permitted upload extensions.
- `CNACTION_CLUSTER_SYNC_ENABLED` – set to `1` to enable multi-server sync.
- `CNACTION_CLUSTER_SYNC_KEY` – shared random secret key (recommended 160 characters).
- `CNACTION_CLUSTER_SYNC_PEERS` – comma-separated peer base URLs (e.g. `http://host1:8071,http://host2:8071`).
- `CNACTION_CLUSTER_SYNC_INTERVAL_SEC` – sync polling interval in seconds (default `5`).
- `CNACTION_CLUSTER_NODE_ID` – server identifier used for conflict branch naming (e.g. `Server_A`).


When two servers edited the same room independently during disconnect, incoming conflicting room configs are preserved as branch rooms named like `room_Server_A_1`.

## Testing

At present there is no automated test suite. The recommended manual verification is to
start the server locally and interact with the game client. Contributions adding unit or
integration tests are welcome.
