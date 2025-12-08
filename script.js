// --- 常量 ---
const TYPE_MAP = {
    'n': '名词 (Nomen)', 'v': '动词 (Verb)', 'adj': '形容词 (Adjektiv)',
    'adv': '副词 (Adverb)', 'prep': '介词 (Präposition)', 'pron': '代词 (Pronomen)',
    'conj': '连词 (Konjunktion)', 'num': '数词 (Numerale)', 'art': '冠词 (Artikel)'
};

// --- 状态 ---
let configData = {};
let activeList = []; 
let playList = [];      

let currentMode = 'spelling';   
let currentOrder = 'random';    
let gameState = 'waiting_answer'; 
let currentWord = null;
let currentIndex = 0;   

let ignoredSet = new Set(); 
let favoriteSet = new Set(); // 新增：收藏集合

// --- DOM ---
const els = {
    count: document.getElementById('word-count'),
    bookshelf: document.getElementById('bookshelf'),
    sidebarStats: document.getElementById('sidebar-stats'),
    qUnit: document.getElementById('q-unit'),
    qMain: document.getElementById('q-main'),
    qSub: document.getElementById('q-sub'),
    qTag: document.getElementById('q-tag'),
    uiGender: document.getElementById('ui-gender-btns'),
    uiInput: document.getElementById('ui-input-box'),
    inputFull: document.getElementById('input-full'),
    result: document.getElementById('result-msg'),
    infoArea: document.getElementById('info-area'),
    infoForms: document.getElementById('info-forms'),
    infoExample: document.getElementById('info-example'),
    btnSubmit: document.getElementById('btn-submit'),
    btnNext: document.getElementById('btn-next'),
    btnModeGender: document.getElementById('btn-mode-gender'),
    btnModeSpelling: document.getElementById('btn-mode-spelling'),
    btnIgnore: document.getElementById('btn-ignore'),
    btnFav: document.getElementById('btn-fav') // 新增
};

// --- 1. 初始化 ---
initApp();

function initApp() {
    loadBasicSettings();
    fetch('data/config.json')
        .then(res => res.json())
        .then(data => {
            configData = data;
            renderSidebar(); 
            if (restoreSidebarSelection()) {
                loadSelectedUnits(true);
            } else {
                els.count.textContent = "请打开侧边栏选择单元";
                toggleSidebar(); 
            }
        })
        .catch(err => {
            console.error(err);
            els.count.textContent = "配置加载失败";
        });
}

// --- 2. 存储逻辑 ---
function loadBasicSettings() {
    const savedIgnored = localStorage.getItem('dv_ignored');
    if (savedIgnored) ignoredSet = new Set(JSON.parse(savedIgnored));

    // 加载收藏
    const savedFav = localStorage.getItem('dv_favorites');
    if (savedFav) favoriteSet = new Set(JSON.parse(savedFav));

    const savedSettings = localStorage.getItem('dv_settings');
    if (savedSettings) {
        const s = JSON.parse(savedSettings);
        currentMode = s.mode || 'spelling';
        currentOrder = s.order || 'random';
        switchMode(currentMode, false);
        document.getElementsByName('order').forEach(r => {
            if(r.value === currentOrder) r.checked = true;
        });
    }
}

function saveState() {
    const settings = { mode: currentMode, order: currentOrder, index: currentIndex };
    localStorage.setItem('dv_settings', JSON.stringify(settings));

    const checkboxes = document.querySelectorAll('#bookshelf input:checked');
    const values = Array.from(checkboxes).map(cb => cb.value);
    localStorage.setItem('dv_selection', JSON.stringify(values));
}

function saveIgnored() { localStorage.setItem('dv_ignored', JSON.stringify([...ignoredSet])); }
function saveFavorites() { localStorage.setItem('dv_favorites', JSON.stringify([...favoriteSet])); }

// --- 3. 侧边栏 ---
function renderSidebar() {
    els.bookshelf.innerHTML = "";

    // 【新增】特殊的“我的收藏”选项
    const favDiv = document.createElement('div');
    // 使用特殊 value 标记
    favDiv.innerHTML = `<label class="special-item" style="display:block; padding:10px; cursor:pointer;">
        <input type="checkbox" value="FAVORITES_ALL"> ❤️ 我的收藏本
    </label>`;
    els.bookshelf.appendChild(favDiv);

    // 渲染普通书架
    for (const [bookName, files] of Object.entries(configData)) {
        const bookDiv = document.createElement('div');
        bookDiv.className = 'book-group';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'book-title';
        titleDiv.innerHTML = `<span>📂 ${bookName}</span> <span>⬇</span>`;
        titleDiv.onclick = () => { bookDiv.querySelector('.unit-list').classList.toggle('show'); };
        
        const listDiv = document.createElement('div');
        listDiv.className = 'unit-list';
        
        files.forEach(fileName => {
            const displayName = fileName.replace('.csv', '');
            const fileInfo = JSON.stringify({ book: bookName, file: fileName, name: displayName });
            const label = document.createElement('label');
            label.innerHTML = `<input type="checkbox" value='${fileInfo}'> ${displayName}`;
            listDiv.appendChild(label);
        });

        bookDiv.appendChild(titleDiv);
        bookDiv.appendChild(listDiv);
        els.bookshelf.appendChild(bookDiv);
    }
}

function restoreSidebarSelection() {
    const savedSelection = localStorage.getItem('dv_selection');
    if (!savedSelection) return false;
    const checkedValues = JSON.parse(savedSelection);
    const inputs = document.querySelectorAll('#bookshelf input');
    let hasChecked = false;
    inputs.forEach(input => {
        if (checkedValues.includes(input.value)) {
            input.checked = true;
            hasChecked = true;
        }
    });
    return hasChecked;
}

// 【关键修改】加载逻辑
async function loadSelectedUnits(isRestore = false) {
    const checkboxes = document.querySelectorAll('#bookshelf input:checked');
    if (checkboxes.length === 0) {
        if (!isRestore) alert("请至少选择一个单元！");
        return;
    }

    // 检查是否勾选了“我的收藏”
    let isFavMode = false;
    checkboxes.forEach(cb => {
        if (cb.value === "FAVORITES_ALL") isFavMode = true;
    });

    els.sidebarStats.textContent = isFavMode ? "正在搜索收藏..." : "正在读取...";
    let tempAllWords = [];
    let promises = [];

    if (isFavMode) {
        // 如果选了收藏，我们要扫描所有 config 里的文件，因为我们不知道收藏的词在哪本书里
        // 为了方便，这里直接加载所有书（对于文本文件来说速度很快）
        // 如果你只想加载勾选的书里的收藏，逻辑会不同。这里实现的是“查看所有收藏”
        for (const [bookName, files] of Object.entries(configData)) {
            files.forEach(fileName => {
                const displayName = fileName.replace('.csv', '');
                const info = { book: bookName, file: fileName, name: displayName };
                promises.push(fetchCsv(info));
            });
        }
    } else {
        // 正常模式：只加载勾选的文件
        checkboxes.forEach(cb => {
            if (cb.value !== "FAVORITES_ALL") {
                const info = JSON.parse(cb.value);
                promises.push(fetchCsv(info));
            }
        });
    }

    const results = await Promise.all(promises);
    results.forEach(w => tempAllWords = tempAllWords.concat(w));
    
    // 如果是收藏模式，这里进行过滤，只保留在 favoriteSet 里的
    if (isFavMode) {
        tempAllWords = tempAllWords.filter(w => favoriteSet.has(w.id));
        if (tempAllWords.length === 0) {
            alert("你还没有收藏任何单词！");
            return;
        }
    }

    activeList = tempAllWords;
    els.sidebarStats.textContent = `已加载 ${activeList.length} 词`;
    
    refreshPlayList(isRestore);
    if (!isRestore) toggleSidebar(); 
}

// 辅助：读取单个CSV
async function fetchCsv(info) {
    const path = `data/${info.book}/${info.file}`;
    try {
        const res = await fetch(path);
        if (!res.ok) throw new Error("404");
        const text = await res.text();
        const lines = text.trim().split('\n');
        const words = [];
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const row = lines[i].split(',');
            const uniqueId = `${info.book}-${info.name}-${row[2].trim()}`; // ID生成
            words.push({
                id: uniqueId,
                unit: info.name,
                type: row[0].trim(),
                gender: row[1] ? row[1].trim() : "",
                word: row[2].trim(),
                cn: row[3].trim(),
                forms: row[4] ? row[4].trim() : "",
                example: row[5] ? row[5].trim() : ""
            });
        }
        return words;
    } catch (err) { return []; }
}

// --- 4. 刷新与播放 ---
function refreshPlayList(isRestore = false) {
    let filtered = activeList.filter(w => {
        const notIgnored = !ignoredSet.has(w.id);
        const typeMatch = (currentMode === 'gender') ? (w.type === 'n') : true;
        return notIgnored && typeMatch;
    });

    if (currentOrder === 'random') {
        playList = [...filtered].sort(() => Math.random() - 0.5);
        if (!isRestore) currentIndex = 0;
    } else {
        playList = [...filtered];
        if (isRestore) {
            const savedSettings = localStorage.getItem('dv_settings');
            if (savedSettings) {
                const s = JSON.parse(savedSettings);
                currentIndex = (s.index && s.index < playList.length) ? s.index : 0;
            }
        } else {
            currentIndex = 0;
        }
    }
    saveState();
    els.count.textContent = `剩余: ${playList.length}`;
    nextQuestion();
}

// --- 5. 出题 ---
function nextQuestion() {
    if (playList.length === 0) {
        els.qMain.textContent = "列表为空";
        els.qSub.textContent = "请检查选择或恢复已斩单词";
        els.btnSubmit.style.display = 'none';
        els.btnIgnore.style.display = 'none';
        els.btnFav.style.display = 'none';
        return;
    }

    saveState();

    if (currentOrder === 'random') {
        const r = Math.floor(Math.random() * playList.length);
        currentWord = playList[r];
    } else {
        if (currentIndex >= playList.length) {
            alert("本轮结束，重新开始！");
            currentIndex = 0;
        }
        currentWord = playList[currentIndex];
        currentIndex++;
    }

    // 更新按钮状态
    updateBtnStates();

    gameState = 'waiting_answer';
    els.result.innerHTML = ""; els.result.className = "result";
    els.infoArea.style.display = 'none';
    els.inputFull.value = "";
    els.btnIgnore.style.display = 'inline-block';
    els.btnFav.style.display = 'inline-block';
    
    els.qUnit.textContent = currentWord.unit;
    els.qMain.textContent = currentWord.cn;
    els.qTag.textContent = TYPE_MAP[currentWord.type] || currentWord.type;
    els.btnNext.style.display = 'none';

    if (currentMode === 'gender') {
        els.qSub.textContent = currentWord.word;
        els.uiGender.style.display = 'flex';
        els.uiInput.style.display = 'none';
        els.btnSubmit.style.display = 'none';
    } else {
        els.qSub.textContent = "";
        els.uiGender.style.display = 'none';
        els.uiInput.style.display = 'block';
        els.btnSubmit.style.display = 'inline-block';
        els.inputFull.focus();
        if (currentWord.type === 'n') els.inputFull.placeholder = "名词: der/die/das + 单词";
        else els.inputFull.placeholder = "请输入单词...";
    }
}

// --- 6. 交互 (收藏 & 斩) ---
function toggleFav() {
    if (!currentWord) return;
    if (favoriteSet.has(currentWord.id)) {
        favoriteSet.delete(currentWord.id);
    } else {
        favoriteSet.add(currentWord.id);
    }
    saveFavorites();
    updateBtnStates();
}

function toggleIgnore() {
    if (!currentWord) return;
    if (ignoredSet.has(currentWord.id)) {
        ignoredSet.delete(currentWord.id);
    } else {
        ignoredSet.add(currentWord.id);
    }
    saveIgnored();
    updateBtnStates();
    els.count.textContent = `剩余: ${playList.length}`;
}

function updateBtnStates() {
    if (!currentWord) return;
    
    // 更新斩按钮
    if (ignoredSet.has(currentWord.id)) {
        els.btnIgnore.textContent = "↩️ 撤销";
        els.btnIgnore.classList.add('ignored');
    } else {
        els.btnIgnore.textContent = "🗑️ 斩";
        els.btnIgnore.classList.remove('ignored');
    }

    // 更新收藏按钮
    if (favoriteSet.has(currentWord.id)) {
        els.btnFav.textContent = "⭐ 已收藏";
        els.btnFav.classList.add('active');
    } else {
        els.btnFav.textContent = "⭐ 收藏";
        els.btnFav.classList.remove('active');
    }
}

function resetIgnored() {
    if (confirm("恢复所有已删除单词？")) {
        ignoredSet.clear();
        saveIgnored();
        loadSelectedUnits();
    }
}

// --- 其他 ---
function changeOrder() {
    const radios = document.getElementsByName('order');
    for(let r of radios) if(r.checked) currentOrder = r.value;
    refreshPlayList(false);
}
function switchMode(mode, refresh = true) {
    currentMode = mode;
    els.btnModeGender.className = mode === 'gender' ? 'active' : '';
    els.btnModeSpelling.className = mode === 'spelling' ? 'active' : '';
    if(refresh && activeList.length > 0) refreshPlayList(false);
}
function checkGender(uGender) {
    if(gameState!=='waiting_answer') return;
    const ok = uGender.toLowerCase() === currentWord.gender.toLowerCase();
    showResult(ok);
}
function submitSpelling() {
    if(gameState!=='waiting_answer') return;
    const val = els.inputFull.value.trim().replace(/\s+/g, ' ');
    let ok = false;
    if(currentWord.type === 'n') {
        const p = val.split(' ');
        if(p.length >= 2 && p[0].toLowerCase() === currentWord.gender.toLowerCase() && p[1] === currentWord.word) ok = true;
    } else {
        if(val === currentWord.word) ok = true;
    }
    showResult(ok);
}
function showResult(ok) {
    gameState = 'waiting_next';
    let ansHtml = currentWord.type === 'n' ? `<span class="c-${currentWord.gender}">${currentWord.gender}</span> ${currentWord.word}` : currentWord.word;
    els.result.innerHTML = ok ? `✅ Richtig! ${ansHtml}` : `❌ Falsch! 答案: ${ansHtml}`;
    els.result.className = ok ? "result correct" : "result wrong";
    els.infoArea.style.display = 'block';
    els.infoForms.textContent = currentWord.forms ? `变形: ${currentWord.forms}` : "";
    els.infoExample.textContent = currentWord.example ? `例句: ${currentWord.example}` : "";
    els.btnSubmit.style.display = 'none';
    els.btnNext.style.display = 'inline-block';
    els.btnNext.focus();
}
function toggleSidebar() { 
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('visible');
}
function addChar(c) { els.inputFull.value+=c; els.inputFull.focus(); }
document.addEventListener('keydown', e => {
    if(e.key==='Enter') {
        e.preventDefault();
        if(gameState==='waiting_answer' && currentMode==='spelling') submitSpelling();
        else if(gameState==='waiting_next') nextQuestion();
    }
});