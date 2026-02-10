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
    if (typeof loadDefaultConfig === 'function') {
        loadDefaultConfig();
    }
    const applyRoom = document.getElementById('applyRoom');
    if (applyRoom) {
        applyRoom.value = '';
    }
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
            const applyRoom = document.getElementById('applyRoom');
            if (applyRoom) {
                applyRoom.value = data.meta.name || '';
            }
            if (typeof syncApplyRoom === 'function') {
                syncApplyRoom();
            }
            if (typeof ensureStageConfig === 'function') ensureStageConfig();
            if (typeof refreshStageEditor === 'function') {
                refreshStageEditor();
            } else {
                fillForm();
                initDraggables();
                drawCanvas();
                if(typeof syncConfigJson === 'function') syncConfigJson();
                if(typeof updateDetailsPanel === 'function') updateDetailsPanel();
            }
            showEditor();
        });
});

document.getElementById('backList').onclick = () => {
    showList();
};

document.getElementById('deleteRoomFromList')?.addEventListener('click', () => {
    const input = document.getElementById('deleteRoomName');
    if (!input) return;
    const room = input.value.trim();
    if (!room) {
        alert('ルーム名を入力してください。');
        input.focus();
        return;
    }
    if (!confirm(`ルーム ${room} を削除しますか？`)) {
        return;
    }
    const formData = new FormData();
    formData.append('room', room);
    fetch('/delete_room', { method: 'POST', body: formData })
        .then(res => res.text())
        .then(text => {
            alert(text);
            input.value = '';
        });
});

function showEditor() {
    document.getElementById('stage-list').classList.add('hidden');
    document.getElementById('stage-editor').classList.remove('hidden');

    StageList();
}

window.addEventListener('DOMContentLoaded', StageList);
