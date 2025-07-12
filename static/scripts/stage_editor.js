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
  }

function initDraggables() {
    draggables = [];
    config.actionZones.forEach((z, i) => draggables.push({type:'action', idx:i, ...z}));
    if(config.deliveryZone)
        draggables.push({type:'delivery', ...config.deliveryZone});
}

function drawCanvas() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(bg.complete) ctx.drawImage(bg,0,0,canvas.width,canvas.height);
    draggables.forEach(d => {
        ctx.strokeStyle = d.type === 'action' ? 'blue' : 'red';
        ctx.strokeRect(d.x-d.width/2, d.y-d.height/2, d.width, d.height);
        ctx.fillStyle = 'black';
        ctx.fillText(d.type==='action'?d.action:'D', d.x-10, d.y);
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
    dragging = null;
});

document.getElementById('addActionZone').onclick = () => {
    config.actionZones.push({x:100,y:100,width:150,height:150,action:'cut',display:'作業中',occupied:false});
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