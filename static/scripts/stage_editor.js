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

const bg = new Image();
bg.src = '/static/assets/background/kitchen.png';
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

const texturePaths = {
    action: '/static/assets/cooking_zone1.png',
    delivery: '/static/assets/delivery_zone.png',
    moving: '/static/assets/obstacle/obstacle2.png',
    static: '/static/assets/obstacle/obstacle1.png',
    foodGen: '/static/assets/food_generator.png',
    transferSrc: '/static/assets/sourceImage.png',
    transferDst: '/static/assets/destinationImage.png'
};

const textures = {};
Object.entries(texturePaths).forEach(([key, path]) => {
    const img = new Image();
    img.src = path;
    img.onload = () => drawCanvas();
    textures[key] = img;
});

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

function drawCanvas() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bg.complete) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    draggables.forEach(d => {
        const img = textures[d.type];
        const x = d.x - d.width / 2;
        const y = d.y - d.height / 2;
        if (img && img.complete) {
            ctx.drawImage(img, x, y, d.width, d.height);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillRect(x, y, d.width, d.height);
        }
        ctx.strokeStyle = selected && selected.id === d.id ? '#ffca28' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = selected && selected.id === d.id ? 4 : 2;
        ctx.strokeRect(x, y, d.width, d.height);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.font = '16px "M PLUS Rounded 1c", sans-serif';
        const label = typeLabels[d.type] || '';
        if (label) ctx.fillText(label, x + 6, y + 20);
    });
    ctx.lineWidth = 1;
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
        config.foodGenerators.push({ x: 160 + idx * 50, y: 400, width: 96, height: 96, nextFood: 'ingredient_tomato' });
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
