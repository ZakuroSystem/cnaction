import { GameClient } from './game/game-client.js';

const socket = io();
let gameClient = null;

function ensureDefaults() {
  if (!window.roomName) {
    window.roomName = 'room1';
  }
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

  const nextClient = new GameClient(container, socket, () => {
    if (window.gameClient === nextClient) {
      window.gameClient = null;
    }
    if (gameClient === nextClient) {
      gameClient = null;
    }
  });

  gameClient = nextClient;
  window.gameClient = nextClient;
  nextClient.start();
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
