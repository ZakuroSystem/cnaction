// Socket.IO 接続 & プレビューなど、既存 code をモジュール化
const socket = io();
let config = {}, currentKey = null;

function initializeEditor(cfg){
  config = cfg || getDefaultConfigGUI();
  setupFormListeners();
  initDraggables(); drawPreview();
}
  document.addEventListener('DOMContentLoaded',()=>{
    const socket = io();
    const roomInput = document.getElementById('roomName');
    const sections = {
      room: document.getElementById('room-selection'),
      mode: document.getElementById('mode-selection'),
      load: document.getElementById('load-settings'),
      export: document.getElementById('export-settings'),
      edit: document.getElementById('edit-mode')
    };

    // 初期セクション
    function show(sec){ Object.values(sections).forEach(s=>s.classList.add('hidden')); sections[sec].classList.remove('hidden'); }
    show('room');

    // モード選択ボタン
    document.getElementById('enterWorkspace').onclick = ()=>{ if(!roomInput.value){alert('部屋名を入力');return;} show('mode'); };
    document.getElementById('loadSettingsBtn').onclick = ()=>show('load');
    document.getElementById('exportSettingsBtn').onclick = ()=>show('export');
    document.getElementById('editModeBtn').onclick = ()=>{
      show('edit');
      initDraggables(); drawPreview(); refreshUploadTargets();
    };
    document.getElementById('backFromLoad').onclick   = ()=>show('mode');
    document.getElementById('backFromExport').onclick = ()=>show('mode');
    document.getElementById('backFromEdit').onclick   = ()=>show('mode');

    // 設定読み込み
    document.getElementById('configFileInputLoad').onchange = e => {
      const f=e.target.files[0]; if(!f) return;
      const r=new FileReader();
      r.onload=()=> {
        try{ const cfg=JSON.parse(r.result); socket.emit('update_config',{room:roomInput.value,config:cfg}); alert('読み込み成功'); }
        catch(err){ alert('読み込み失敗:'+err); }
      };
      r.readAsText(f);
    };

    // 設定書き出し
    document.getElementById('exportNowBtn').onclick =()=>{
      fetch('/export_config?room='+encodeURIComponent(roomInput.value))
        .then(r=>r.json()).then(data=>{
          document.getElementById('exportedConfig').textContent=JSON.stringify(data,null,2);
          const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
          const a=document.createElement('a');
          a.href=URL.createObjectURL(blob);
          a.download=roomInput.value+'_config.json';
          a.click();
        }).catch(e=>alert('書き出し失敗:'+e));
    };

    // GUI用 config オブジェクト
    let config = {
      gameTime:90, chopTime:2, bakeTime:3,
      orderTimeLimit:30, wrongOrderPenalty:5,
      actionZones:[
        {action:'cut',width:150,height:150}, {action:'bake',width:150,height:150}
      ],
      deliveryZone:{width:150,height:150},
      movingObstacles:[{width:96,height:96}],
      staticObstacles:[{width:96,height:96}], foodGenerators:[{width:96,height:96}],
      transferObjects:[], customItems:[], combinationRecipes:[],
      dishList: [], orderMapping:{}, cookingRecipes:[]
    };

    // ==== プレビュー関連 ====
    const canvas=document.getElementById('previewCanvas'), ctx=canvas.getContext('2d');
    const bg=new Image(); bg.src='/static/assets/background/kitchen.png'; bg.onload=drawPreview;
    const imagesCache={};
    function getZoneImg(action){
      if(!imagesCache[action]){
        const img=new Image();
        img.src=`/static/assets/zone_${action}.png`;
        imagesCache[action]=img;
      }
      return imagesCache[action];
    }
    let draggables=[], dragging=null, dx=0, dy=0;
    function initDraggables(){
      draggables=[];
      config.actionZones.forEach((z,i)=>draggables.push({type:'actionZone',action:z.action,idx:i,...z}));
      [{key:'deliveryZone',kind:'delivery'}].forEach(o=>draggables.push({type:'delivery',...config.deliveryZone}));
      ['movingObstacles','staticObstacles','foodGenerators'].forEach(kind=>{
        config[kind].forEach((o,i)=>draggables.push({type:kind,idx:i,...o}));
      });
      config.transferObjects.forEach((p,i)=>{
        draggables.push({type:'transferSource',pairIdx:i,...p.sourceZone});
        draggables.push({type:'transferDest',pairIdx:i,...p.destination});
      });
    }
    function drawPreview(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      if(bg.complete) ctx.drawImage(bg,0,0,canvas.width,canvas.height);
      draggables.forEach(d=>{
        let img;
        if(d.type==='actionZone') img = getZoneImg(d.action);
        else img = new Image(), img.src=`/static/assets/${d.type}.png`;
        if(img.complete) ctx.drawImage(img,d.x-d.width/2,d.y-d.height/2,d.width,d.height);
        else ctx.strokeRect(d.x-d.width/2,d.y-d.height/2,d.width,d.height);
      });
    }
    canvas.onmousedown = e=>{
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      dragging=draggables.find(d=>mx>=d.x-d.width/2&&mx<=d.x+d.width/2&&my>=d.y-d.height/2&&my<=d.y+d.height/2);
      if(dragging){ dx=mx-dragging.x; dy=my-dragging.y; }
    };
    canvas.onmousemove = e=>{ if(dragging){ const r=canvas.getBoundingClientRect(); dragging.x=e.clientX-r.left-dx; dragging.y=e.clientY-r.top-dy; drawPreview(); } };
    canvas.onmouseup = e=>{
      draggables.forEach(d=>{
        if(d.type==='actionZone') Object.assign(config.actionZones[d.idx],{x:d.x,y:d.y});
        if(d.type==='delivery') Object.assign(config.deliveryZone,{x:d.x,y:d.y});
        if(d.type==='movingObstacles') Object.assign(config.movingObstacles[d.idx],{x:d.x,y:d.y});
        if(d.type==='staticObstacles') Object.assign(config.staticObstacles[d.idx],{x:d.x,y:d.y});
        if(d.type==='foodGenerators') Object.assign(config.foodGenerators[d.idx],{x:d.x,y:d.y});
        if(d.type==='transferSource') Object.assign(config.transferObjects[d.pairIdx].sourceZone,{x:d.x,y:d.y,width:d.width,height:d.height});
        if(d.type==='transferDest') Object.assign(config.transferObjects[d.pairIdx].destination,{x:d.x,y:d.y,width:d.width,height:d.height});
      });
      dragging=null;
    };

    // ==== カウント更新 ====
    function updateCountDisplays(){
      document.getElementById('movingObstacleCountDisplay').textContent = config.movingObstacles.length;
      document.getElementById('staticObstacleCountDisplay').textContent = config.staticObstacles.length;
      document.getElementById('foodGenCountDisplay').textContent = config.foodGenerators.length;
    }

    // ==== 行追加/削除 ====
    // 汎用関数
    function delegate(tableSelector,eventSelector,handler){
      document.querySelector(tableSelector).addEventListener('click',e=>{
        if(e.target.matches(eventSelector)) handler(e);
      });
    }
    // ActionZone
    document.getElementById('addAZRow').onclick = ()=>{
      const tbody = document.querySelector('#actionZoneTable tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="azAction" value="action"></td>
        <td><input class="azW" type="number" value="150"></td>
        <td><input class="azH" type="number" value="150"></td>
        <td><input class="azCnt" type="number" value="1"></td>
        <td><button type="button" class="removeAZRow">削除</button></td>`;
      tbody.appendChild(tr);
    };
    delegate('#actionZoneTable','.removeAZRow',e=>{
      e.target.closest('tr').remove();
    });
    // 他のテーブルも同様に…
    ['#customItemTable','.removeCustomItemRow','#combinationTable','.removeCombinationRow',
     '#transferTable','.removeTransferRow'].forEach((sel,i)=>{
      if(i%2===0){
        const table=sel;
        const btn=arguments[i+1];
        delegate(table,btn,e=>{ e.target.closest('tr').remove(); updateTransferConfig(); initDraggables(); drawPreview(); });
      }
    });
    document.getElementById('addCustomItemRow').onclick = ()=>{
      const tb=document.querySelector('#customItemTable tbody');
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td><input class="customItemName" value="new_item"></td>
        <td><input class="customItemImage" value="/static/assets/ingredient/new_item.png"></td>
        <td><input class="customItemMethods" value="base,cut-cut_base-2"></td>
        <td><button class="removeCustomItemRow" type="button">削除</button></td>`;
      tb.appendChild(tr);
    };
    document.getElementById('addCombinationRow').onclick = ()=>{
      const tb=document.querySelector('#combinationTable tbody');
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td><input class="combinationIngredients" value="ing1,ing2"></td>
        <td><input class="combinationResult" value="new_item"></td>
        <td><input class="combinationThreshold" type="number" value="20"></td>
        <td><button class="removeCombinationRow" type="button">削除</button></td>`;
      tb.appendChild(tr);
    };
    document.getElementById('addTransferRow').onclick = ()=>{
      const tb=document.querySelector('#transferTable tbody');
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td><input class="transferSourceWidth" type="number" value="50"></td>
        <td><input class="transferSourceHeight" type="number" value="50"></td>
        <td><input class="transferDestWidth" type="number" value="50"></td>
        <td><input class="transferDestHeight" type="number" value="50"></td>
        <td><button class="removeTransferRow" type="button">削除</button></td>`;
      tb.appendChild(tr);
      updateTransferConfig(); initDraggables(); drawPreview();
    };

    // 幅・高さ変更
    ['chop','bake','delivery','movingObstacle','staticObstacle','foodGen'].forEach(kind=>{
      const wEl=document.getElementById(kind+'Width');
      const hEl=document.getElementById(kind+'Height');
      if(wEl && hEl){
        wEl.onchange = ()=>{ config[ kind==='delivery'?'deliveryZone':kind+'s' ]
          .forEach(o=>o.width=+wEl.value); initDraggables(); drawPreview(); };
        hEl.onchange = ()=>{ config[ kind==='delivery'?'deliveryZone':kind+'s' ]
          .forEach(o=>o.height=+hEl.value); initDraggables(); drawPreview(); };
      }
    });

    // 転送オブジェクト更新
    function updateTransferConfig(){
      const rows=document.querySelectorAll('#transferTable tbody tr');
      config.transferObjects=[];
      rows.forEach(r=>{
        const sW=+r.querySelector('.transferSourceWidth').value;
        const sH=+r.querySelector('.transferSourceHeight').value;
        const dW=+r.querySelector('.transferDestWidth').value;
        const dH=+r.querySelector('.transferDestHeight').value;
        config.transferObjects.push({
          sourceZone:{x:600,y:150,width:sW,height:sH},
          destination:{x:600,y:300,width:dW,height:dH}
        });
      });
    }

    // ==== 画像アップロード ====
    function refreshUploadTargets(){
      const sel=document.getElementById('uploadTarget');
      sel.innerHTML='';
      const names=new Set([...Object.keys(config.orderMapping||{}),...(config.customItems||[]).map(c=>c.name)]);
      names.forEach(n=>{
        const opt=document.createElement('option'); opt.value=n; opt.textContent=n; sel.appendChild(opt);
      });
    }
    const uploadArea=document.getElementById('uploadArea');
    uploadArea.ondragover=e=>{ e.preventDefault(); uploadArea.classList.add('hover'); };
    uploadArea.ondragleave=e=>{ uploadArea.classList.remove('hover'); };
    uploadArea.ondrop=e=>{
      e.preventDefault(); uploadArea.classList.remove('hover');
      document.getElementById('uploadFile').files = e.dataTransfer.files;
    };
    document.getElementById('uploadBtn').onclick = async ()=>{
      const pwd=document.getElementById('uploadPassword').value;
      const file=document.getElementById('uploadFile').files[0];
      let target=document.getElementById('uploadTarget').value;
      const newName=document.getElementById('newItemName').value.trim();
      if(newName) target=newName;
      if(!pwd||!file||!target){ alert('パスワード・ファイル・アイテム名を入力'); return; }
      const fd=new FormData(); fd.append('password',pwd); fd.append('item_name',target); fd.append('file',file);
      const xhr=new XMLHttpRequest();
      xhr.open('POST','/upload_image',true);
      const prog=document.getElementById('uploadProgress'); prog.classList.remove('hidden');
      xhr.upload.onprogress = e=>{ if(e.lengthComputable) prog.value = (e.loaded/e.total)*100; };
      xhr.onreadystatechange = ()=>{
        if(xhr.readyState===4){
          prog.classList.add('hidden');
          const res=JSON.parse(xhr.responseText);
          if(res.success){
            alert('アップロード成功');
            if(!config.customItems.some(c=>c.name===target)){
              config.customItems.push({name:target,image:res.path});
              // GUIにも追加
              document.getElementById('addCustomItemRow').click();
              const lastRow=document.querySelector('#customItemTable tbody tr:last-child');
              lastRow.querySelector('.customItemName').value=target;
              lastRow.querySelector('.customItemImage').value=res.path;
            }
            refreshUploadTargets();
          } else alert('失敗:'+res.message);
        }
      };
      xhr.send(fd);
    };

    // ==== フォーム送信 ====
    document.getElementById('editSettingsForm').onsubmit = e=>{
      e.preventDefault();
      // 時間
      config.gameTime=+document.getElementById('gameTime').value;
      config.chopTime=+document.getElementById('chopTime').value;
      config.bakeTime=+document.getElementById('bakeTime').value;
      config.orderTimeLimit=+document.getElementById('orderTimeLimit').value;
      config.wrongOrderPenalty=+document.getElementById('wrongOrderPenalty').value;
      // actionZones
      const azs=[];
      document.querySelectorAll('#actionZoneTable tbody tr').forEach(r=>{
        const act=r.querySelector('.azAction').value.trim();
        const w=+r.querySelector('.azW').value, h=+r.querySelector('.azH').value, c=+r.querySelector('.azCnt').value;
        for(let i=0;i<c;i++){
          azs.push({x:100+i*180,y:450,width:w,height:h,action:act,display:act+'中…',occupied:false});
        }
      });
      config.actionZones=azs;
      // delivery
      config.deliveryZone.width=+document.getElementById('deliveryWidth').value;
      config.deliveryZone.height=+document.getElementById('deliveryHeight').value;
      // 障害物・BOX
      config.movingObstacles=[{x:150,y:300,width:+document.getElementById('movingObstacleWidth').value,height:+document.getElementById('movingObstacleHeight').value}];
      config.staticObstacles=[{x:300,y:300,width:+document.getElementById('staticObstacleWidth').value,height:+document.getElementById('staticObstacleHeight').value}];
      config.foodGenerators=[{x:450,y:300,width:+document.getElementById('foodGenWidth').value,height:+document.getElementById('foodGenHeight').value,nextFood:config.foodGenerators[0]?.nextFood||Object.keys(config.orderMapping)[0]}];
      // transferObjects already in config
      updateTransferConfig();
      // カスタムアイテム＆レシピ
      config.customItems=[];
      config.cookingRecipes=[];
      document.querySelectorAll('#customItemTable tbody tr').forEach(r=>{
        const name=r.querySelector('.customItemName').value.trim();
        const img=r.querySelector('.customItemImage').value.trim();
        const line=r.querySelector('.customItemMethods').value.trim();
        config.customItems.push({name, image:img});
        if(line){
          const parts=line.split(',');
          const base=parts[0].trim();
          const steps=parts.slice(1).map(seg=>{
            const [action,result,time]=seg.split('-');
            return {action:action.trim(),result:result.trim(),time:+time.trim()};
          });
          config.cookingRecipes.push({base,steps});
        }
      });
      // 組み合わせ
      config.combinationRecipes=[];
      document.querySelectorAll('#combinationTable tbody tr').forEach(r=>{
        const ing=r.querySelector('.combinationIngredients').value.split(',').map(s=>s.trim());
        const res=r.querySelector('.combinationResult').value.trim();
        const th=+r.querySelector('.combinationThreshold').value;
        config.combinationRecipes.push({ingredients:ing,result:res,threshold:th});
      });
      // dishList & orderMapping
      try{ config.dishList=JSON.parse(document.getElementById('dishList').value); }
      catch(e){ alert('料理リストエラー:'+e); return; }
      try{ config.orderMapping=JSON.parse(document.getElementById('orderMapping').value); }
      catch(e){ alert('注文マッピングエラー:'+e); return; }
      // 送信
      socket.emit('update_config',{room:roomInput.value,config});
      // JSON ダウンロード
      const blob=new Blob([JSON.stringify(config,null,2)],{type:'application/json'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=roomInput.value+'_config.json';
      a.click();
      location.href='/';
    };

    // 初期プレビュー
    initDraggables(); drawPreview(); updateCountDisplays();
  });