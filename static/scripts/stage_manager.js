let currentKey = null;

async function StageList() {
    const res = await fetch('/api/stages');
    const data = await res.json();
    const tbody = document.querySelector('#stageTable tbody');
    tbody.innerHTML = '';
    data.stages.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${s.name}</td>
            <td>${new Date(s.updated * 1000).toLocaleString()}</td>
            <td><button data-edit="${s.key}">編集</button></td>`;
        tbody.appendChild(tr);
    });
}

document.getElementById('createStage').onclick = () => {
    currentKey = null;
    loadDefaultConfig();
    document.getElementById('stageName').value = '';
    showEditor();
};

document.getElementById('stageTable').addEventListener('click', e => {
    const key = e.target.dataset.edit;
    if (!key) return;
    fetch(`/api/stages/${key}`)
        .then(r => r.json())
        .then(data => {
            currentKey = key;
            config = data.config;
            document.getElementById('stageName').value = data.meta.name;
            fillForm();
            initDraggables();
            drawCanvas();
            if(typeof syncConfigJson === 'function') syncConfigJson();
            showEditor();
        });
});

document.getElementById('backList').onclick = () => {
    showList();
};

function showEditor() {
    document.getElementById('stage-list').classList.add('hidden');
    document.getElementById('stage-editor').classList.remove('hidden');
}

function showList() {
    document.getElementById('stage-editor').classList.add('hidden');
    document.getElementById('stage-list').classList.remove('hidden');
    StageList();
}

window.addEventListener('DOMContentLoaded', StageList);
