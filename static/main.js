const socket = io();
let gameClient = null;
let matchMode = 'auto';

let GameClientCtorPromise = null;
let deleteInProgress = false;

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

function setDeleteMessage(message, isError = false) {
  const messageEl = document.getElementById('deleteRoomMessage');
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.classList.toggle('room-actions__message--error', isError);
}

async function deleteRoomByName(roomName) {
  if (!roomName) {
    setDeleteMessage('削除するルーム名を入力してください。', true);
    return false;
  }
  if (deleteInProgress) return false;
  if (!confirm(`ルーム「${roomName}」を削除しますか？`)) return false;
  deleteInProgress = true;
  setDeleteMessage('ルームを削除しています...');
  const formData = new FormData();
  formData.append('room', roomName);
  try {
    const res = await fetch('/delete_room', { method: 'POST', body: formData });
    if (!res.ok) {
      throw new Error('delete_failed');
    }
    setDeleteMessage('ルームを削除しました。');
    return true;
  } catch (error) {
    console.error('ルーム削除に失敗しました。', error);
    setDeleteMessage('ルームの削除に失敗しました。', true);
    return false;
  } finally {
    deleteInProgress = false;
  }
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

function requestLeave() {
  if (!window.playerId) return;
  socket.emit('leave', { room: window.roomName || '', playerId: window.playerId });
  window.playerId = '';
}

function showStartOverlay() {
  const container = document.getElementById('game-container');
  const ui = document.getElementById('ui');
  const overlay = document.getElementById('start-overlay');
  if (overlay) {
    overlay.style.display = 'block';
  }
  if (container) {
    container.style.display = 'none';
  }
  if (ui) {
    ui.style.display = 'none';
  }
}

function applyMatchSelections(roomInput) {
  if (matchMode === 'manual') {
    const value = roomInput?.value?.trim();
    window.autoMatch = false;
    window.roomName = value || 'room1';
    window.autoMatchRoomHint = '';
    return;
  }
  window.autoMatch = true;
  window.autoMatchRoomHint = '';
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
    requestLeave();
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
  const roomActions = document.getElementById('roomActions');
  const deleteInGame = document.getElementById('deleteRoomInGame');
  if (matchMode === 'manual') {
    roomField?.removeAttribute('hidden');
    roomActions?.removeAttribute('hidden');
    deleteInGame?.removeAttribute('hidden');
    if (hint) {
      hint.textContent = '参加するルーム名を入力してください。';
    }
    return;
  }
  roomField?.setAttribute('hidden', 'true');
  roomActions?.setAttribute('hidden', 'true');
  deleteInGame?.setAttribute('hidden', 'true');
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

function bindDeleteRoomButtons() {
  const deleteButton = document.getElementById('deleteRoomButton');
  const deleteInGame = document.getElementById('deleteRoomInGame');
  const roomInput = document.getElementById('roomName');
  if (deleteButton) {
    deleteButton.addEventListener('click', async () => {
      const roomName = roomInput?.value?.trim() || window.roomName || '';
      const deleted = await deleteRoomByName(roomName);
      if (deleted) {
        window.roomName = '';
      }
    });
  }
  if (deleteInGame) {
    deleteInGame.addEventListener('click', async () => {
      const roomName = window.roomName || roomInput?.value?.trim() || '';
      const deleted = await deleteRoomByName(roomName);
      if (deleted) {
        window.roomName = '';
      }
    });
  }
}

function bindLeaveButton() {
  const leaveButton = document.getElementById('leaveGameButton');
  if (!leaveButton) return;
  leaveButton.addEventListener('click', () => {
    requestLeave();
    if (window.gameClient) {
      window.gameClient.destroy();
    }
    showStartOverlay();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindMatchModeToggle();
  bindStartButton();
  bindRoomInput();
  bindDeleteRoomButtons();
  bindLeaveButton();
});
