const socket = io();
let gameClient = null;

let GameClientCtorPromise = null;

function getGameClientModuleUrl() {
  const moduleUrl = new URL('./game/game-client.js', import.meta.url);
  const version = new URL(import.meta.url).searchParams.get('v');
  if (version) {
    moduleUrl.searchParams.set('v', version);
  }
  return moduleUrl.href;
}

function loadGameClientCtor() {
  if (!GameClientCtorPromise) {
    GameClientCtorPromise = import(getGameClientModuleUrl())
      .then((mod) => mod.GameClient)
      .catch((error) => {
        GameClientCtorPromise = null;
        throw error;
      });
  }
  return GameClientCtorPromise;
}

function ensureDefaults() {
  if (!window.roomName) {
    window.roomName = 'room1';
  }
}

function disposeClient(expected) {
  if (window.gameClient === expected) {
    window.gameClient = null;
  }
  if (gameClient === expected) {
    gameClient = null;
  }
}

async function setupClient(container, socketInstance) {
  const GameClient = await loadGameClientCtor();
  const nextClient = new GameClient(container, socketInstance, () => {
    disposeClient(nextClient);
  });

  gameClient = nextClient;
  window.gameClient = nextClient;
  nextClient.start();
}

window.startGame = async function startGame() {
  ensureDefaults();

  const container = document.getElementById('game-container');
  const ui = document.getElementById('ui');
  const overlay = document.getElementById('start-overlay');

  if (!container || !ui || !overlay) {
    console.error('必要なDOM要素が見つかりません。');
    return;
  }

  overlay.style.display = 'none';
  container.style.display = 'block';
  ui.style.display = 'block';

  if (window.gameClient) {
    window.gameClient.destroy();
  }

  await setupClient(container, socket);
};

function bindStartButton() {
  const button = document.getElementById('startButton');
  const roomInput = document.getElementById('roomName');
  if (!button) return;

  button.addEventListener('click', () => {
    window.roomName = roomInput?.value || 'room1';
    window.playerId = '';
    window
      .startGame()
      .catch((error) => console.error('ゲームの開始に失敗しました。', error));
  });
}

function bindRoomInput() {
  const roomInput = document.getElementById('roomName');
  if (!roomInput) return;

  roomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      window.roomName = roomInput.value || 'room1';
      window.playerId = '';
      window
        .startGame()
        .catch((error) => console.error('ゲームの開始に失敗しました。', error));
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindStartButton();
  bindRoomInput();
});
