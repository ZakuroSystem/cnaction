const socket = io();
let gameClient = null;
let matchMode = 'auto';

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
  if (!window.autoMatch && !window.roomName) {
    window.roomName = 'room1';
  }
  if (typeof window.autoMatch !== 'boolean') {
    window.autoMatch = false;
  }
  if (typeof window.autoMatchRoomHint !== 'string') {
    window.autoMatchRoomHint = '';
  }
}

function applyMatchSelections(roomInput) {
  const value = roomInput?.value?.trim();
  if (matchMode === 'manual') {
    window.autoMatch = false;
    window.roomName = value || 'room1';
    window.autoMatchRoomHint = '';
    return;
  }
  window.autoMatch = true;
  window.autoMatchRoomHint = value || '';
  window.roomName = '';
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
    applyMatchSelections(roomInput);
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
    if (event.key === 'Enter' && matchMode === 'manual') {
      event.preventDefault();
      applyMatchSelections(roomInput);
      window.playerId = '';
      window
        .startGame()
        .catch((error) => console.error('ゲームの開始に失敗しました。', error));
    }
  });
}

function setMatchMode(mode) {
  matchMode = mode === 'manual' ? 'manual' : 'auto';
  const roomField = document.getElementById('roomNameField');
  const hint = document.getElementById('matchModeHint');
  if (matchMode === 'manual') {
    roomField?.removeAttribute('hidden');
    if (hint) {
      hint.textContent = '参加するルーム名を入力してください。';
    }
    return;
  }
  roomField?.setAttribute('hidden', 'true');
  if (hint) {
    hint.textContent = '空いているルームに自動で参加します。';
  }
}

function bindMatchModeToggle() {
  const radios = document.querySelectorAll('input[name="matchMode"]');
  if (!radios.length) {
    return;
  }

  let initial = 'auto';
  radios.forEach((radio) => {
    if (radio.checked) {
      initial = radio.value;
    }
    radio.addEventListener('change', (event) => {
      if (event.target instanceof HTMLInputElement && event.target.checked) {
        setMatchMode(event.target.value);
      }
    });
  });

  setMatchMode(initial);
}

document.addEventListener('DOMContentLoaded', () => {
  bindMatchModeToggle();
  bindStartButton();
  bindRoomInput();
});
