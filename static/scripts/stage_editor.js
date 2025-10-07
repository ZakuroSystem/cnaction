let config = {};
let draggables = [];
let dragging = null;
let selected = null;
let lastMoved = null;
let pendingSelectId = null;
let dx = 0;
let dy = 0;

const socket = io();
const canvas = document.getElementById('stageCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

const snap = (value) => Math.round(value);
const snapSize = (value) => Math.max(1, Math.round(value));

if (canvas) {
    canvas.style.imageRendering = 'pixelated';
}
if (ctx) {
    ctx.imageSmoothingEnabled = false;
}

const newItemTexture = (filename) => `/static/new_items/${encodeURIComponent(filename)}`;

const bg = new Image();
bg.src = newItemTexture('背景 コンクリート_ブラッシュアップ1.png');
bg.onload = () => drawCanvas();

const details = {
    panel: document.getElementById('objectDetails'),
    type: document.getElementById('objType'),
    x: document.getElementById('objX'),
    y: document.getElementById('objY'),
    w: document.getElementById('objW'),
    h: document.getElementById('objH'),
    actionField: document.getElementById('actionField'),
    action: document.getElementById('objAction'),
    display: document.getElementById('objDisplay'),
    foodField: document.getElementById('foodField'),
    nextFood: document.getElementById('objNextFood')
};

const summaryList = document.getElementById('stageSummary');
const objectList = document.getElementById('objectList');
const configError = document.getElementById('configError');

const typeLabels = {
    action: '作業台',
    delivery: '配達カウンター',
    moving: '動く障害物',
    static: '壁',
    foodGen: '食材マシン',
    transferSrc: 'ワープ入口',
    transferDst: 'ワープ出口'
};

const baseTexturePaths = {
    action_default: newItemTexture('まな板が乗っているカウンター.png'),
    action_cut: newItemTexture('まな板が乗っているカウンター.png'),
    action_bake: newItemTexture('フライパンが乗っているカウンター.png'),
    action_boil: newItemTexture('フライパンが乗っているカウンター.png'),
    action_mix: newItemTexture('まな板が乗っているカウンター.png'),
    delivery: newItemTexture('配膳用カウンター.png'),
    moving: newItemTexture('四角いカウンター .png'),
    static: newItemTexture('四角いカウンター .png'),
    foodGen: newItemTexture('食材が出てくるかご.png'),
    transferSrc: newItemTexture('食材ワープ(青).png'),
    transferDst: newItemTexture('食材ワープ(紫).png')
};

const ingredientTexturePaths = {
    ingredient_burger_buns: '/static/new_items/burger_buns.png',
    ingredient_beef_patty: '/static/new_items/beef_patty.png',
    ingredient_lettuce: '/static/new_items/lettuce.png',
    ingredient_tomato: newItemTexture('TMT.png')
};

const textures = {};
const failedTextures = new Map();

function registerTexture(key, path) {
    if (!key || !path || textures[key]) return;
    const img = new Image();
    img.src = path;
    img.onload = () => {
        failedTextures.delete(key);
        drawCanvas();
    };
    img.onerror = () => {
        if (textures[key] === img) {
            delete textures[key];
        }
        const current = failedTextures.get(key) || 0;
        failedTextures.set(key, current + 1);
    };
    textures[key] = img;
}

Object.entries(baseTexturePaths).forEach(([key, path]) => registerTexture(key, path));
Object.entries(ingredientTexturePaths).forEach(([key, path]) => registerTexture(key, path));

function ensureTexture(key) {
    if (!key) return null;
    if (textures[key]) return textures[key];
    if (baseTexturePaths[key]) {
        registerTexture(key, baseTexturePaths[key]);
        return textures[key];
    }
    if (ingredientTexturePaths[key]) {
        registerTexture(key, ingredientTexturePaths[key]);
        return textures[key];
    }
    const failures = failedTextures.get(key) || 0;
    if (key.startsWith('ingredient_')) {
        const name = key.substring('ingredient_'.length);
        if (failures === 0) {
            registerTexture(key, `/static/new_items/${name}.png`);
        } else if (failures === 1) {
            registerTexture(key, `/static/assets/ingredient/${name}.png`);
        }
        return textures[key] || null;
    }
    if (failures === 0) {
        registerTexture(key, `/static/new_items/${key}.png`);
    } else if (failures === 1) {
        registerTexture(key, `/static/assets/${key}.png`);
    }
    return textures[key] || null;
}

let editor = null;

function normaliseZone(zone, defaults = {}) {
    if (!zone) zone = {};
    zone.x = Number(zone.x);
    if (Number.isNaN(zone.x)) zone.x = defaults.x ?? 100;
    zone.y = Number(zone.y);
    if (Number.isNaN(zone.y)) zone.y = defaults.y ?? 100;
    zone.width = Number(zone.width);
    if (Number.isNaN(zone.width)) zone.width = defaults.width ?? 96;
    zone.height = Number(zone.height);
    if (Number.isNaN(zone.height)) zone.height = defaults.height ?? 96;
    return zone;
}

function ensureStageStructure() {
    if (!config || typeof config !== 'object') config = {};
    config.gameTime = Number(config.gameTime);
    if (Number.isNaN(config.gameTime) || config.gameTime <= 0) config.gameTime = 180;
    config.orderTimeLimit = Number(config.orderTimeLimit);
    if (Number.isNaN(config.orderTimeLimit) || config.orderTimeLimit <= 0) config.orderTimeLimit = 60;
    const penalty = Number(config.wrongOrderPenalty);
    config.wrongOrderPenalty = Number.isNaN(penalty) ? 0 : penalty;

    config.actionZones = Array.isArray(config.actionZones) ? config.actionZones : [];
    config.movingObstacles = Array.isArray(config.movingObstacles) ? config.movingObstacles : [];
    config.staticObstacles = Array.isArray(config.staticObstacles) ? config.staticObstacles : [];
    config.foodGenerators = Array.isArray(config.foodGenerators) ? config.foodGenerators : [];
    config.transferObjects = Array.isArray(config.transferObjects) ? config.transferObjects : [];

    config.actionZones.forEach(zone => normaliseZone(zone, { width: 160, height: 120 }));
    config.movingObstacles.forEach(zone => normaliseZone(zone, { width: 96, height: 96 }));
    config.staticObstacles.forEach(zone => normaliseZone(zone, { width: 96, height: 96 }));
    config.foodGenerators.forEach(zone => normaliseZone(zone, { width: 96, height: 96 }));
    config.transferObjects.forEach(tr => {
        tr.sourceZone = normaliseZone(tr.sourceZone, { width: 72, height: 72 });
        tr.destination = normaliseZone(tr.destination, { width: 72, height: 72 });
    });
    if (config.deliveryZone) {
        config.deliveryZone = normaliseZone(config.deliveryZone, { width: 140, height: 140, x: 640, y: 320 });
    }
    return config;
}

function fillForm() {
    ensureStageStructure();
    const gameTimeInput = document.getElementById('gameTime');
    if (gameTimeInput) gameTimeInput.value = config.gameTime;
    const orderTimeInput = document.getElementById('orderTimeLimit');
    if (orderTimeInput) orderTimeInput.value = config.orderTimeLimit;
    const penaltyInput = document.getElementById('wrongPenalty');
    if (penaltyInput) penaltyInput.value = config.wrongOrderPenalty;
}

function updateAdvancedEditor() {
    if (!editor) return;
    editor.value = JSON.stringify(config, null, 2);
    if (configError) {
        configError.classList.add('d-none');
        configError.textContent = '';
    }
}

function updateSummary() {
    if (!summaryList) return;
    const rows = [
        { label: '作業台', value: config.actionZones.length, suffix: '箇所' },
        { label: '配達カウンター', value: config.deliveryZone ? 1 : 0, suffix: '箇所' },
        { label: '動く障害物', value: config.movingObstacles.length, suffix: '個' },
        { label: '壁', value: config.staticObstacles.length, suffix: '枚' },
        { label: '食材マシン', value: config.foodGenerators.length, suffix: '台' },
        { label: 'ワープ', value: config.transferObjects.length, suffix: '組' }
    ];
    summaryList.innerHTML = '';
    rows.forEach(row => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="stage-summary-label">${row.label}</span><span>${row.value}${row.suffix}</span>`;
        summaryList.appendChild(li);
    });
}

function updateObjectList() {
    if (!objectList) return;
    objectList.innerHTML = '';
    const groups = [
        { type: 'delivery', label: '配達カウンター', items: draggables.filter(d => d.type === 'delivery') },
        { type: 'action', label: '作業台', items: draggables.filter(d => d.type === 'action') },
        { type: 'foodGen', label: '食材マシン', items: draggables.filter(d => d.type === 'foodGen') },
        { type: 'moving', label: '動く障害物', items: draggables.filter(d => d.type === 'moving') },
        { type: 'static', label: '壁', items: draggables.filter(d => d.type === 'static') },
        { type: 'transferSrc', label: 'ワープ入口/出口', items: draggables.filter(d => d.type === 'transferSrc' || d.type === 'transferDst') }
    ];
    let hasItems = false;
    groups.forEach(group => {
        if (!group.items.length) return;
        hasItems = true;
        const header = document.createElement('div');
        header.className = 'stage-object-section';
        header.textContent = group.label;
        objectList.appendChild(header);
        group.items.forEach((item, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'list-group-item list-group-item-action stage-object-item';
            button.dataset.objectId = item.id;
            const label = group.items.length > 1 ? `${typeLabels[item.type] || group.label}${index + 1}` : (typeLabels[item.type] || group.label);
            button.innerHTML = `
                <span class="stage-object-icon stage-object-icon-${item.type}"></span>
                <span class="stage-object-label">
                    ${label}
                    <small>(${Math.round(item.x)}, ${Math.round(item.y)})</small>
                </span>`;
            objectList.appendChild(button);
        });
    });
    if (!hasItems) {
        const empty = document.createElement('div');
        empty.className = 'text-muted small px-3 py-2';
        empty.textContent = 'まだ何も配置されていません。追加ボタンから配置しましょう。';
        objectList.appendChild(empty);
    }
}

function markSelectedInList() {
    if (!objectList) return;
    const buttons = objectList.querySelectorAll('[data-object-id]');
    buttons.forEach(btn => {
        btn.classList.toggle('active', selected && btn.dataset.objectId === selected.id);
    });
}

function initDraggables() {
    ensureStageStructure();
    draggables = [];
    config.actionZones.forEach((zone, i) => draggables.push({ ...zone, type: 'action', idx: i, id: `action-${i}` }));
    if (config.deliveryZone) {
        draggables.push({ ...config.deliveryZone, type: 'delivery', idx: 0, id: 'delivery' });
    }
    config.movingObstacles.forEach((zone, i) => draggables.push({ ...zone, type: 'moving', idx: i, id: `moving-${i}` }));
    config.staticObstacles.forEach((zone, i) => draggables.push({ ...zone, type: 'static', idx: i, id: `static-${i}` }));
    config.foodGenerators.forEach((zone, i) => draggables.push({ ...zone, type: 'foodGen', idx: i, id: `foodGen-${i}` }));
    config.transferObjects.forEach((tr, i) => {
        draggables.push({ ...tr.sourceZone, type: 'transferSrc', idx: i, id: `transfer-${i}-src` });
        draggables.push({ ...tr.destination, type: 'transferDst', idx: i, id: `transfer-${i}-dst` });
    });
}

function refreshUi(options = {}) {
    const { updateEditor = true } = options;
    ensureStageStructure();
    const selectedId = pendingSelectId || (selected ? selected.id : null);
    const lastId = lastMoved ? lastMoved.id : null;
    fillForm();
    initDraggables();
    selected = selectedId ? draggables.find(d => d.id === selectedId) || null : null;
    lastMoved = lastId ? draggables.find(d => d.id === lastId) || null : lastMoved;
    pendingSelectId = null;
    drawCanvas();
    updateDetailsPanel();
    updateSummary();
    updateObjectList();
    markSelectedInList();
    if (updateEditor) updateAdvancedEditor();
}

function loadDefaultConfig() {
    fetch('/api/default_config')
        .then(r => r.json())
        .then(cfg => {
            config = cfg;
            pendingSelectId = null;
            refreshUi();
        });
}
window.loadDefaultConfig = loadDefaultConfig;
window.DefaultConfig = loadDefaultConfig;
window.ensureStageConfig = ensureStageStructure;
window.refreshStageEditor = refreshUi;

function readForm(updateUi = true) {
    ensureStageStructure();
    const gameTimeInput = document.getElementById('gameTime');
    if (gameTimeInput) config.gameTime = Number(gameTimeInput.value) || config.gameTime;
    const orderTimeInput = document.getElementById('orderTimeLimit');
    if (orderTimeInput) config.orderTimeLimit = Number(orderTimeInput.value) || config.orderTimeLimit;
    const penaltyInput = document.getElementById('wrongPenalty');
    if (penaltyInput) config.wrongOrderPenalty = Number(penaltyInput.value) || 0;
    draggables.forEach(d => {
        switch (d.type) {
            case 'action':
                Object.assign(config.actionZones[d.idx], { x: d.x, y: d.y, width: d.width, height: d.height });
                break;
            case 'delivery':
                if (!config.deliveryZone) config.deliveryZone = {};
                Object.assign(config.deliveryZone, { x: d.x, y: d.y, width: d.width, height: d.height });
                break;
            case 'moving':
                Object.assign(config.movingObstacles[d.idx], { x: d.x, y: d.y, width: d.width, height: d.height });
                break;
            case 'static':
                Object.assign(config.staticObstacles[d.idx], { x: d.x, y: d.y, width: d.width, height: d.height });
                break;
            case 'foodGen':
                Object.assign(config.foodGenerators[d.idx], { x: d.x, y: d.y, width: d.width, height: d.height, nextFood: d.nextFood });
                break;
            case 'transferSrc':
                Object.assign(config.transferObjects[d.idx].sourceZone, { x: d.x, y: d.y, width: d.width, height: d.height });
                break;
            case 'transferDst':
                Object.assign(config.transferObjects[d.idx].destination, { x: d.x, y: d.y, width: d.width, height: d.height });
                break;
        }
    });
    if (updateUi) {
        refreshUi();
    } else {
        updateAdvancedEditor();
    }
}

const renderOrder = {
    static: 0,
    moving: 1,
    transferSrc: 2,
    transferDst: 2,
    action: 3,
    foodGen: 4,
    delivery: 5
};

const actionBadges = {
    cut: '切る',
    chop: '切る',
    bake: '焼く',
    grill: '焼く',
    boil: '茹で',
    mix: '混ぜ',
    default: '調理'
};

function beginRoundedRectPath(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function getTextureForDraggable(d) {
    if (d.type === 'action') {
        const key = `action_${d.action || 'default'}`;
        return ensureTexture(key) || ensureTexture('action_default');
    }
    return ensureTexture(d.type) || null;
}

function drawFloorGrid() {
    const cellSize = 96;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = cellSize; x < canvas.width; x += cellSize) {
        ctx.beginPath();
        const posX = snap(x);
        ctx.moveTo(posX, 0);
        ctx.lineTo(posX, canvas.height);
        ctx.stroke();
    }
    for (let y = cellSize; y < canvas.height; y += cellSize) {
        ctx.beginPath();
        const posY = snap(y);
        ctx.moveTo(0, posY);
        ctx.lineTo(canvas.width, posY);
        ctx.stroke();
    }
    ctx.restore();
}

function drawTransferConnections() {
    if (!config.transferObjects || !config.transferObjects.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 170, 255, 0.6)';
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 10]);
    config.transferObjects.forEach(tr => {
        if (!tr || !tr.sourceZone || !tr.destination) return;
        const sourceX = snap(tr.sourceZone.x);
        const sourceY = snap(tr.sourceZone.y);
        const destX = snap(tr.destination.x);
        const destY = snap(tr.destination.y);
        ctx.beginPath();
        ctx.moveTo(sourceX, sourceY);
        ctx.lineTo(destX, destY);
        ctx.stroke();
        const angle = Math.atan2(destY - sourceY, destX - sourceX);
        const arrowSize = 14;
        const ax = destX - Math.cos(angle) * 20;
        const ay = destY - Math.sin(angle) * 20;
        ctx.beginPath();
        ctx.moveTo(destX, destY);
        ctx.lineTo(
            snap(ax + Math.cos(angle + Math.PI / 2) * arrowSize),
            snap(ay + Math.sin(angle + Math.PI / 2) * arrowSize)
        );
        ctx.lineTo(
            snap(ax + Math.cos(angle - Math.PI / 2) * arrowSize),
            snap(ay + Math.sin(angle - Math.PI / 2) * arrowSize)
        );
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 170, 255, 0.6)';
        ctx.fill();
    });
    ctx.restore();
}

function drawActionBadge(d, left, top, width, height) {
    const label = actionBadges[d.action] || actionBadges.default;
    ctx.save();
    ctx.font = '16px "M PLUS Rounded 1c", sans-serif';
    ctx.textBaseline = 'middle';
    const padding = 8;
    const textWidth = ctx.measureText(label).width;
    const badgeWidth = textWidth + padding * 2;
    const badgeHeight = 28;
    const badgeX = left + width / 2 - badgeWidth / 2;
    const badgeY = top + height - badgeHeight - 8;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    beginRoundedRectPath(badgeX, badgeY, badgeWidth, badgeHeight, 12);
    ctx.fill();
    ctx.fillStyle = '#fffde7';
    ctx.fillText(label, badgeX + padding, badgeY + badgeHeight / 2);
    ctx.restore();
}

function drawFoodPreview(d, left, top, width, height) {
    if (!d.nextFood) return;
    const img = ensureTexture(d.nextFood);
    if (!img || !img.complete) return;
    const size = snapSize(Math.min(width * 0.6, 72));
    const bubbleRadius = size / 2 + 8;
    const radius = snapSize(bubbleRadius);
    const cx = snap(d.x);
    let cy = snap(top - bubbleRadius - 8);
    if (cy < radius + 6) {
        cy = snap(top + height + bubbleRadius + 8);
    }
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    const leftImg = snap(cx - size / 2);
    const topImg = snap(cy - size / 2);
    ctx.drawImage(img, leftImg, topImg, size, size);
    ctx.restore();
}

function drawTransferLabel(d, left, top, width, height) {
    const label = d.type === 'transferSrc' ? '入口' : '出口';
    ctx.save();
    ctx.font = '15px "M PLUS Rounded 1c", sans-serif';
    ctx.textBaseline = 'middle';
    const padding = 6;
    const textWidth = ctx.measureText(label).width;
    const badgeWidth = textWidth + padding * 2;
    const badgeHeight = 26;
    const badgeX = left + width / 2 - badgeWidth / 2;
    let badgeY = top - badgeHeight - 4;
    if (badgeY < 8) {
        badgeY = top + height + 4;
    }
    ctx.fillStyle = 'rgba(0, 170, 255, 0.8)';
    beginRoundedRectPath(badgeX, badgeY, badgeWidth, badgeHeight, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, badgeX + padding, badgeY + badgeHeight / 2);
    ctx.restore();
}

function drawDraggable(d) {
    const width = snapSize(d.width);
    const height = snapSize(d.height);
    const left = snap(d.x - width / 2);
    const top = snap(d.y - height / 2);
    const texture = getTextureForDraggable(d);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 6;
    if (texture && texture.complete) {
        ctx.drawImage(texture, left, top, width, height);
    } else {
        const gradient = ctx.createLinearGradient(left, top, left, top + height);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(1, '#d7dee8');
        ctx.fillStyle = gradient;
        ctx.fillRect(left, top, width, height);
    }
    ctx.restore();

    ctx.save();
    ctx.lineWidth = selected && selected.id === d.id ? 4 : 2;
    ctx.strokeStyle = selected && selected.id === d.id ? '#ffd54f' : 'rgba(0, 0, 0, 0.25)';
    ctx.strokeRect(left, top, width, height);
    ctx.restore();

    if (d.type === 'action') {
        drawActionBadge(d, left, top, width, height);
    }
    if (d.type === 'foodGen') {
        drawFoodPreview(d, left, top, width, height);
    }
    if (d.type === 'transferSrc' || d.type === 'transferDst') {
        drawTransferLabel(d, left, top, width, height);
    }
}

function drawCanvas() {
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bg.complete) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    drawFloorGrid();
    drawTransferConnections();
    const ordered = [...draggables].sort((a, b) => (renderOrder[a.type] ?? 99) - (renderOrder[b.type] ?? 99));
    ordered.forEach(drawDraggable);
}

function updateDetailsPanel() {
    if (!details.panel) return;
    if (!selected) {
        details.panel.classList.add('hidden');
        return;
    }
    details.panel.classList.remove('hidden');
    details.type.textContent = typeLabels[selected.type] || selected.type;
    details.x.value = Math.round(selected.x);
    details.y.value = Math.round(selected.y);
    details.w.value = Math.round(selected.width);
    details.h.value = Math.round(selected.height);
    details.actionField.classList.add('hidden');
    details.foodField.classList.add('hidden');
    if (selected.type === 'action') {
        details.actionField.classList.remove('hidden');
        if (selected.action && !Array.from(details.action.options).some(opt => opt.value === selected.action)) {
            const opt = document.createElement('option');
            opt.value = selected.action;
            opt.textContent = selected.action;
            details.action.appendChild(opt);
        }
        details.action.value = selected.action || 'cut';
        details.display.value = selected.display || '';
    }
    if (selected.type === 'foodGen') {
        details.foodField.classList.remove('hidden');
        details.nextFood.value = selected.nextFood || '';
    }
}

function applyDetails() {
    if (!selected) return;
    selected.x = Number(details.x.value) || selected.x;
    selected.y = Number(details.y.value) || selected.y;
    selected.width = Number(details.w.value) || selected.width;
    selected.height = Number(details.h.value) || selected.height;
    const idx = selected.idx;
    switch (selected.type) {
        case 'action':
            selected.action = details.action.value;
            selected.display = details.display.value;
            Object.assign(config.actionZones[idx], selected);
            break;
        case 'delivery':
            if (!config.deliveryZone) config.deliveryZone = {};
            Object.assign(config.deliveryZone, selected);
            break;
        case 'moving':
            Object.assign(config.movingObstacles[idx], selected);
            break;
        case 'static':
            Object.assign(config.staticObstacles[idx], selected);
            break;
        case 'foodGen':
            selected.nextFood = details.nextFood.value;
            Object.assign(config.foodGenerators[idx], selected);
            break;
        case 'transferSrc':
            Object.assign(config.transferObjects[idx].sourceZone, selected);
            break;
        case 'transferDst':
            Object.assign(config.transferObjects[idx].destination, selected);
            break;
    }
    pendingSelectId = selected.id;
    refreshUi();
}

if (canvas) {
    canvas.addEventListener('mousedown', e => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        dragging = draggables.find(d => mx >= d.x - d.width / 2 && mx <= d.x + d.width / 2 && my >= d.y - d.height / 2 && my <= d.y + d.height / 2) || null;
        selected = dragging;
        if (dragging) {
            dx = mx - dragging.x;
            dy = my - dragging.y;
            lastMoved = dragging;
        }
        markSelectedInList();
        updateDetailsPanel();
        drawCanvas();
    });

    canvas.addEventListener('mousemove', e => {
        if (!dragging) return;
        const rect = canvas.getBoundingClientRect();
        dragging.x = e.clientX - rect.left - dx;
        dragging.y = e.clientY - rect.top - dy;
        drawCanvas();
    });

    canvas.addEventListener('mouseup', () => {
        if (!dragging) return;
        const movedId = dragging.id;
        switch (dragging.type) {
            case 'action':
                Object.assign(config.actionZones[dragging.idx], { x: dragging.x, y: dragging.y });
                break;
            case 'delivery':
                if (!config.deliveryZone) config.deliveryZone = {};
                Object.assign(config.deliveryZone, { x: dragging.x, y: dragging.y });
                break;
            case 'moving':
                Object.assign(config.movingObstacles[dragging.idx], { x: dragging.x, y: dragging.y });
                break;
            case 'static':
                Object.assign(config.staticObstacles[dragging.idx], { x: dragging.x, y: dragging.y });
                break;
            case 'foodGen':
                Object.assign(config.foodGenerators[dragging.idx], { x: dragging.x, y: dragging.y });
                break;
            case 'transferSrc':
                Object.assign(config.transferObjects[dragging.idx].sourceZone, { x: dragging.x, y: dragging.y });
                break;
            case 'transferDst':
                Object.assign(config.transferObjects[dragging.idx].destination, { x: dragging.x, y: dragging.y });
                break;
        }
        pendingSelectId = movedId;
        dragging = null;
        refreshUi();
    });
}

if (objectList) {
    objectList.addEventListener('click', e => {
        const button = e.target.closest('[data-object-id]');
        if (!button) return;
        const id = button.dataset.objectId;
        selected = draggables.find(d => d.id === id) || null;
        if (selected) {
            pendingSelectId = selected.id;
            lastMoved = selected;
            updateDetailsPanel();
            markSelectedInList();
            drawCanvas();
        }
    });
}

const addActionButton = document.getElementById('addActionZone');
if (addActionButton) {
    addActionButton.onclick = () => {
        ensureStageStructure();
        const idx = config.actionZones.length;
        config.actionZones.push({ x: 120 + idx * 40, y: 140 + idx * 30, width: 160, height: 120, action: 'cut', display: '作業中', occupied: false });
        pendingSelectId = `action-${idx}`;
        refreshUi();
    };
}

const addDeliveryButton = document.getElementById('addDelivery');
if (addDeliveryButton) {
    addDeliveryButton.onclick = () => {
        ensureStageStructure();
        if (!config.deliveryZone) {
            config.deliveryZone = { x: 640, y: 320, width: 160, height: 160 };
        }
        pendingSelectId = 'delivery';
        refreshUi();
    };
}

const addFoodButton = document.getElementById('addFoodGen');
if (addFoodButton) {
    addFoodButton.onclick = () => {
        ensureStageStructure();
        const idx = config.foodGenerators.length;
        config.foodGenerators.push({ x: 160 + idx * 50, y: 400, width: 96, height: 96, nextFood: 'ingredient_beef_patty' });
        pendingSelectId = `foodGen-${idx}`;
        refreshUi();
    };
}

const addMovingButton = document.getElementById('addMovingObstacle');
if (addMovingButton) {
    addMovingButton.onclick = () => {
        ensureStageStructure();
        const idx = config.movingObstacles.length;
        config.movingObstacles.push({ x: 300 + idx * 60, y: 260, width: 96, height: 96 });
        pendingSelectId = `moving-${idx}`;
        refreshUi();
    };
}

const addStaticButton = document.getElementById('addStaticObstacle');
if (addStaticButton) {
    addStaticButton.onclick = () => {
        ensureStageStructure();
        const idx = config.staticObstacles.length;
        config.staticObstacles.push({ x: 520 + idx * 50, y: 200, width: 96, height: 96 });
        pendingSelectId = `static-${idx}`;
        refreshUi();
    };
}

const addTransferButton = document.getElementById('addTransfer');
if (addTransferButton) {
    addTransferButton.onclick = () => {
        ensureStageStructure();
        const idx = config.transferObjects.length;
        config.transferObjects.push({
            sourceZone: { x: 180, y: 460, width: 72, height: 72 },
            destination: { x: 600, y: 460, width: 72, height: 72 }
        });
        pendingSelectId = `transfer-${idx}-src`;
        refreshUi();
    };
}

const deleteButton = document.getElementById('deleteObject');
if (deleteButton) {
    deleteButton.onclick = () => {
        const target = selected || lastMoved;
        if (!target) {
            alert('削除するオブジェクトを選択してください。');
            return;
        }
        switch (target.type) {
            case 'action':
                config.actionZones.splice(target.idx, 1);
                break;
            case 'delivery':
                config.deliveryZone = null;
                break;
            case 'moving':
                config.movingObstacles.splice(target.idx, 1);
                break;
            case 'static':
                config.staticObstacles.splice(target.idx, 1);
                break;
            case 'foodGen':
                config.foodGenerators.splice(target.idx, 1);
                break;
            case 'transferSrc':
            case 'transferDst':
                config.transferObjects.splice(target.idx, 1);
                break;
        }
        selected = null;
        lastMoved = null;
        pendingSelectId = null;
        refreshUi();
    };
}

document.getElementById('saveStage')?.addEventListener('click', () => {
    readForm(false);
    const payload = {
        key: currentKey,
        name: document.getElementById('stageName').value || 'new_stage',
        config
    };
    fetch('/api/stages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(r => r.json()).then(data => {
        if (data.ok) {
            currentKey = data.key;
            alert('保存しました');
            showList();
        } else {
            alert('保存失敗:' + data.msg);
        }
    });
});

document.getElementById('applyStage')?.addEventListener('click', () => {
    readForm(false);
    const room = document.getElementById('applyRoom').value || 'room1';
    socket.emit('update_config', { room, config });
    alert('適用しました');
});

['x', 'y', 'w', 'h', 'action', 'display', 'nextFood'].forEach(key => {
    if (details[key]) {
        details[key].addEventListener('input', applyDetails);
    }
});

function initEditor() {
    editor = document.getElementById('configEditor');
    if (editor) {
        editor.addEventListener('change', () => syncConfigJson(false));
        editor.addEventListener('blur', () => syncConfigJson(false));
    }
}

function syncConfigJson(toEditor = true) {
    if (!editor) return;
    if (toEditor) {
        updateAdvancedEditor();
    } else {
        try {
            const text = editor.value.trim();
            config = text ? JSON.parse(text) : {};
            ensureStageStructure();
            refreshUi({ updateEditor: false });
        } catch (e) {
            if (configError) {
                configError.textContent = `JSONの読み込みに失敗しました: ${e.message}`;
                configError.classList.remove('d-none');
            } else {
                alert('JSON parse error: ' + e.message);
            }
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    initEditor();
    refreshUi();
});
