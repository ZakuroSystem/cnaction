// ステージ一覧取得 & モーダル制御
async function fetchStageList() {
  const res = await fetch('/api/stages');
  const data = await res.json();
  const tbody = document.querySelector('#stageList tbody');
  tbody.innerHTML = '';
  data.stages.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.name}</td>
      <td>${new Date(s.updated*1000).toLocaleString()}</td>
      <td>
        <button data-load="${s.key}">読み込み</button>
        <button data-key="${s.key}">上書き</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// イベントバインド
document.getElementById('enterManager').onclick = ()=>{
  document.getElementById('mode-selection').classList.add('hidden');
  document.getElementById('stage-manager').classList.remove('hidden');
  fetchStageList();
};

document.getElementById('newStageBtn').onclick = ()=>{
  startEditing(null, '新規ステージ');
};

document.getElementById('stageList').onclick = e => {
  if(e.target.dataset.load) {
    const key = e.target.dataset.load;
    fetch(`/api/stages/${key}`)
      .then(r=>r.json())
      .then(data=> startEditing(key, data.meta.name, data.config));
  }
};

document.getElementById('closeStageMgr').onclick = ()=>{
  document.getElementById('stage-manager').classList.add('hidden');
  document.getElementById('mode-selection').classList.remove('hidden');
};

document.getElementById('saveStageBtn').onclick = async ()=>{
  const name = prompt('ステージ名を入力');
  if(!name) return;
  const payload = { key: currentKey, name, config };
  const res = await fetch('/api/stages', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
  });
  const data = await res.json();
  if(data.ok){ alert('保存完了'); currentKey = data.key; fetchStageList(); }
  else alert('保存失敗:'+data.msg);
};

function startEditing(key, title, cfg=null){
  currentKey = key;
  document.getElementById('stage-manager').classList.add('hidden');
  document.getElementById('editor').classList.remove('hidden');
  document.getElementById('editorTitle').textContent = title;
  initializeEditor(cfg);
}

document.getElementById('backToMode').onclick = ()=> location.reload();