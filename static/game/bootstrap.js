import { GameClient } from './game-client.js';

const socket = io();
let gameClient = null;

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

function setupClient(container, socketInstance) {
  const nextClient = new GameClient(container, socketInstance, () => {
    disposeClient(nextClient);
  });

  gameClient = nextClient;
  window.gameClient = nextClient;
  nextClient.start();
}

window.startGame = function startGame() {
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

  setupClient(container, socket);
};

function bindStartButton() {
  const button = document.getElementById('startButton');
  const roomInput = document.getElementById('roomName');
  if (!button) return;

  button.addEventListener('click', () => {
    window.roomName = roomInput?.value || 'room1';
    window.playerId = '';
    window.startGame();
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
      window.startGame();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindStartButton();
  bindRoomInput();
});
