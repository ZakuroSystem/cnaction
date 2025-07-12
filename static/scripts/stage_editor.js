let config = {};
let draggables = [];
let dragging = null;
let dx = 0, dy = 0;
const socket = io();
const canvas = document.getElementById('stageCanvas');
const ctx = canvas.getContext('2d');
const bg = new Image();
bg.src = '/static/assets/background/kitchen.png';
bg.onload = drawCanvas;

function loadDefaultConfig() {
    fetch('/api/default_config')
        .then(r => r.json())
        .then(cfg => {
            config = cfg;
            fillForm();
            initDraggables();
            drawCanvas();
        });
}

function fillForm() {
    document.getElementById('gameTime').value = config.gameTime;
    document.getElementById('orderTimeLimit').value = config.orderTimeLimit;
    document.getElementById('wrongPenalty').value = config.wrongOrderPenalty;
}

function readForm() {
    config.gameTime = +document.getElementById('gameTime').value;
    config.orderTimeLimit = +document.getElementById('orderTimeLimit').value;
    config.wrongOrderPenalty = +document.getElementById('wrongPenalty').value;
    // update from draggables
    draggables.forEach(d => {
        if(d.type === 'action') Object.assign(config.actionZones[d.idx], {x:d.x, y:d.y});
        if(d.type === 'delivery') Object.assign(config.deliveryZone, {x:d.x, y:d.y});
        if(d.type === 'moving') Object.assign(config.movingObstacles[d.idx], {x:d.x, y:d.y});
        if(d.type === 'static') Object.assign(config.staticObstacles[d.idx], {x:d.x, y:d.y});
        if(d.type === 'foodGen') Object.assign(config.foodGenerators[d.idx], {x:d.x, y:d.y});
        if(d.type === 'transferSrc') Object.assign(config.transferObjects[d.idx].sourceZone, {x:d.x, y:d.y});
        if(d.type === 'transferDst') Object.assign(config.transferObjects[d.idx].destination, {x:d.x, y:d.y});
    });
}

function initDraggables() {
    draggables = [];
    config.actionZones.forEach((z, i) => draggables.push({type:'action', idx:i, ...z}));
    if(config.deliveryZone)
        draggables.push({type:'delivery', ...config.deliveryZone});
    (config.movingObstacles || []).forEach((z,i) => draggables.push({type:'moving', idx:i, ...z}));
    (config.staticObstacles || []).forEach((z,i) => draggables.push({type:'static', idx:i, ...z}));
    (config.foodGenerators || []).forEach((z,i) => draggables.push({type:'foodGen', idx:i, ...z}));
    (config.transferObjects || []).forEach((tr,i) => {
        draggables.push({type:'transferSrc', idx:i, ...tr.sourceZone});
        draggables.push({type:'transferDst', idx:i, ...tr.destination});
    });
}

function drawCanvas() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(bg.complete) ctx.drawImage(bg,0,0,canvas.width,canvas.height);
    draggables.forEach(d => {
        const colors = {
            action: 'blue',
            delivery: 'red',
            moving: 'green',
            static: 'gray',
            foodGen: 'orange',
            transferSrc: 'purple',
            transferDst: 'magenta'
        };
        ctx.strokeStyle = colors[d.type] || 'black';
        ctx.strokeRect(d.x-d.width/2, d.y-d.height/2, d.width, d.height);
        ctx.fillStyle = 'black';
        const labels = {
            action: d.action,
            delivery: 'D',
            moving: 'M',
            static: 'S',
            foodGen: 'F',
            transferSrc: 'S',
            transferDst: 'T'
        };
        ctx.fillText(labels[d.type] || '', d.x-10, d.y);
    });
}

canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    dragging = draggables.find(d => mx >= d.x - d.width/2 && mx <= d.x + d.width/2 && my >= d.y - d.height/2 && my <= d.y + d.height/2);
    if(dragging){ dx = mx - dragging.x; dy = my - dragging.y; }
});

canvas.addEventListener('mousemove', e => {
    if(!dragging) return;
    const rect = canvas.getBoundingClientRect();
    dragging.x = e.clientX - rect.left - dx;
    dragging.y = e.clientY - rect.top - dy;
    drawCanvas();
});

canvas.addEventListener('mouseup', () => {
    if(!dragging) return;
    if(dragging.type === 'action') Object.assign(config.actionZones[dragging.idx], {x:dragging.x, y:dragging.y});
    if(dragging.type === 'delivery') Object.assign(config.deliveryZone, {x:dragging.x, y:dragging.y});
    if(dragging.type === 'moving') Object.assign(config.movingObstacles[dragging.idx], {x:dragging.x, y:dragging.y});
    if(dragging.type === 'static') Object.assign(config.staticObstacles[dragging.idx], {x:dragging.x, y:dragging.y});
    if(dragging.type === 'foodGen') Object.assign(config.foodGenerators[dragging.idx], {x:dragging.x, y:dragging.y});
    if(dragging.type === 'transferSrc') Object.assign(config.transferObjects[dragging.idx].sourceZone, {x:dragging.x, y:dragging.y});
    if(dragging.type === 'transferDst') Object.assign(config.transferObjects[dragging.idx].destination, {x:dragging.x, y:dragging.y});
    dragging = null;
});

document.getElementById('addActionZone').onclick = () => {
    config.actionZones.push({x:100,y:100,width:150,height:150,action:'cut',display:'作業中',occupied:false});
    initDraggables();
    drawCanvas();
};

document.getElementById('addMovingObstacle').onclick = () => {
    if(!config.movingObstacles) config.movingObstacles = [];
    config.movingObstacles.push({x:200,y:200,width:96,height:96});
    initDraggables();
    drawCanvas();
};

document.getElementById('addStaticObstacle').onclick = () => {
    if(!config.staticObstacles) config.staticObstacles = [];
    config.staticObstacles.push({x:300,y:200,width:96,height:96});
    initDraggables();
    drawCanvas();
};

document.getElementById('addFoodGen').onclick = () => {
    if(!config.foodGenerators) config.foodGenerators = [];
    config.foodGenerators.push({x:400,y:200,width:96,height:96,nextFood:'ingredient_tomato'});
    initDraggables();
    drawCanvas();
};

document.getElementById('addTransfer').onclick = () => {
    if(!config.transferObjects) config.transferObjects = [];
    config.transferObjects.push({
        sourceZone:{x:500,y:200,width:50,height:50},
        destination:{x:600,y:200,width:50,height:50}
    });
    initDraggables();
    drawCanvas();
};

document.getElementById('saveStage').onclick = () => {
    readForm();
    const payload = {
        key: currentKey,
        name: document.getElementById('stageName').value || 'new_stage',
        config
    };
    fetch('/api/stages', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
    }).then(r=>r.json()).then(data => {
        if(data.ok){
            currentKey = data.key;
            alert('保存しました');
            showList();
        }else{
            alert('保存失敗:'+data.msg);
        }
    });
};

document.getElementById('applyStage').onclick = () => {
    readForm();
    const room = document.getElementById('applyRoom').value || 'room1';
    socket.emit('update_config', { room, config });
    alert('適用しました');
};