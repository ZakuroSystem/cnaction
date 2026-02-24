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
            <td>${s.locked ? "🔒" : ""}${s.persistent ? " 🧷" : ""} <button data-edit="${s.key}">編集</button> <button data-copy="${s.key}">コピー</button> <button data-records="${s.name}">対戦記録</button></td>`;
        tbody.appendChild(tr);
    });
}

document.getElementById('createStage').onclick = () => {
    currentKey = null;
    if (typeof loadDefaultConfig === 'function') {
        loadDefaultConfig();
    }
    if (typeof setApplyRoomEditable === 'function') {
        setApplyRoomEditable(true, '');
    } else {
        const applyRoom = document.getElementById('applyRoom');
        if (applyRoom) applyRoom.value = '';
    }
    const pwInput = document.getElementById('stagePassword');
    if (pwInput) pwInput.value = '';
    const lockInput = document.getElementById('stageLocked');
    if (lockInput) lockInput.checked = false;
    showEditor();
};

document.getElementById('stageTable').addEventListener('click', e => {
    const editKey = e.target.dataset.edit;
    const copyKey = e.target.dataset.copy;
    const recordsRoom = e.target.dataset.records;

    if (recordsRoom) {
        if (typeof loadRoomRecords === "function") {
            showEditor();
            const applyRoom = document.getElementById("applyRoom");
            if (applyRoom) applyRoom.value = recordsRoom;
            loadRoomRecords(recordsRoom);
        }
        return;
    }

    if (copyKey) {
        fetch(`/api/stages/${copyKey}/copy`, { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                if (!data.ok) {
                    alert(data.msg || 'コピーに失敗しました');
                    return;
                }
                alert(`コピーしました: ${data.name}`);
                StageList();
            });
        return;
    }

    if (!editKey) return;
    const tryLoad = (password = '') => {
        const query = password ? `?password=${encodeURIComponent(password)}` : '';
        return fetch(`/api/stages/${editKey}${query}`);
    };

    tryLoad()
        .then(async (r) => {
            if (r.status === 403) {
                const pw = prompt('このステージはロックされています。編集パスワードを入力してください。', '');
                if (!pw) {
                    throw new Error('キャンセルしました');
                }
                const rr = await tryLoad(pw);
                if (!rr.ok) {
                    const err = await rr.json().catch(() => ({}));
                    throw new Error(err.msg || 'パスワードが違います');
                }
                return rr.json();
            }
            if (!r.ok) {
                throw new Error('読み込みに失敗しました');
            }
            return r.json();
        })
        .then(data => {
            currentKey = editKey;
            const meta = (data && typeof data.meta === 'object' && data.meta) ? data.meta : {};
            const stageName = String(meta.name || editKey || 'new_stage');
            const loadedConfig = (data && typeof data.config === 'object' && data.config)
                ? data.config
                : (data && typeof data === 'object' ? data : {});
            config = loadedConfig;
            const pwInput = document.getElementById('stagePassword');
            if (pwInput) pwInput.value = meta.password || '';
            const lockInput = document.getElementById('stageLocked');
            if (lockInput) lockInput.checked = Boolean(meta.locked);
            if (typeof setApplyRoomEditable === 'function') {
                setApplyRoomEditable(false, stageName);
            } else {
                const applyRoom = document.getElementById('applyRoom');
                if (applyRoom) applyRoom.value = stageName;
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
        })
        .catch((err) => {
            if (err.message !== 'キャンセルしました') {
                alert(err.message);
            }
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

function showList() {
    document.getElementById('stage-editor').classList.add('hidden');
    document.getElementById('stage-list').classList.remove('hidden');
    StageList();
}

window.showList = showList;
window.showEditor = showEditor;

window.addEventListener('DOMContentLoaded', StageList);
