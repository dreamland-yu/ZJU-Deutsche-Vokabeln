// --- 常量与映射 ---
const TYPE_MAP = {
    'n': '名词 (Nomen)', 'v': '动词 (Verb)', 'adj': '形容词 (Adjektiv)',
    'adv': '副词 (Adverb)', 'prep': '介词 (Präposition)', 'pron': '代词 (Pronomen)',
    'conj': '连词 (Konjunktion)', 'num': '数词 (Numerale)', 'art': '冠词 (Artikel)'
};

// --- 状态变量 ---
let configData = {};
let activeList = [];    // 原始加载的数据
let playList = [];      // 播放列表

// 核心状态
let currentMode = 'spelling';   
let currentOrder = 'random';    
let gameState = 'waiting_answer'; 
let currentWord = null;
let currentIndex = 0;   // 进度指针

// 本地存储
let ignoredSet = new Set(); 

// --- DOM 引用 ---
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
    btnIgnore: document.getElementById('btn-ignore')
};

// --- 1. 程序入口 ---
// 页面加载时立即执行
initApp();

function initApp() {
    // 1. 先恢复一些基础设置 (模式、删除列表)
    loadBasicSettings();

    // 2. 加载配置文件
    fetch('data/config.json')
        .then(res => res.json())
        .then(data => {
            configData = data;
            renderSidebar(); // 渲染侧边栏
            
            // 3. 尝试恢复上次勾选的单元并自动开始
            // 这是关键：如果有上次的选择，就自动加载，不弹侧边栏
            if (restoreSidebarSelection()) {
                loadSelectedUnits(true); // true = 恢复模式
            } else {
                els.count.textContent = "请打开侧边栏选择单元";
                toggleSidebar(); // 第一次来，打开侧边栏
            }
        })
        .catch(err => {
            console.error("Config加载失败", err);
            els.count.textContent = "配置加载失败 (需 Live Server)";
        });
}

// --- 2. 本地存储逻辑 ---

function loadBasicSettings() {
    // 恢复“斩”掉的词
    const savedIgnored = localStorage.getItem('dv_ignored');
    if (savedIgnored) ignoredSet = new Set(JSON.parse(savedIgnored));

    // 恢复模式和顺序设置
    const savedSettings = localStorage.getItem('dv_settings');
    if (savedSettings) {
        const s = JSON.parse(savedSettings);
        currentMode = s.mode || 'spelling';
        currentOrder = s.order || 'random';
        // 注意：currentIndex 暂时不恢复，要等数据加载完
        
        // 恢复UI显示
        switchMode(currentMode, false);
        const radios = document.getElementsByName('order');
        for(let r of radios) {
            if(r.value === currentOrder) r.checked = true;
        }
    }
}

// 恢复侧边栏勾选状态
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

// 保存当前所有状态
function saveState() {
    // 1. 保存设置和进度
    const settings = {
        mode: currentMode,
        order: currentOrder,
        index: currentIndex // 保存当前背到第几个了
    };
    localStorage.setItem('dv_settings', JSON.stringify(settings));

    // 2. 保存侧边栏勾选
    const checkboxes = document.querySelectorAll('#bookshelf input:checked');
    const values = Array.from(checkboxes).map(cb => cb.value);
    localStorage.setItem('dv_selection', JSON.stringify(values));
}

function saveIgnored() {
    localStorage.setItem('dv_ignored', JSON.stringify([...ignoredSet]));
}

// --- 3. 侧边栏与数据加载 ---

function renderSidebar() {
    els.bookshelf.innerHTML = "";
    for (const [bookName, files] of Object.entries(configData)) {
        const bookDiv = document.createElement('div');
        bookDiv.className = 'book-group';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'book-title';
        titleDiv.innerHTML = `<span>📂 ${bookName}</span> <span>⬇</span>`;
        titleDiv.onclick = () => {
            bookDiv.querySelector('.unit-list').classList.toggle('show');
        };
        
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

// 加载单元 (核心修改点)
async function loadSelectedUnits(isRestore = false) {
    const checkboxes = document.querySelectorAll('#bookshelf input:checked');
    if (checkboxes.length === 0) {
        if (!isRestore) alert("请至少选择一个单元！");
        return;
    }

    els.sidebarStats.textContent = "正在读取...";
    let tempAllWords = [];

    const promises = Array.from(checkboxes).map(async cb => {
        const info = JSON.parse(cb.value);
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
                // 生成唯一ID
                const uniqueId = `${info.book}-${info.name}-${row[2].trim()}`;
                
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
        } catch (err) {
            console.error(err); return [];
        }
    });

    const results = await Promise.all(promises);
    results.forEach(w => tempAllWords = tempAllWords.concat(w));
    
    activeList = tempAllWords;
    els.sidebarStats.textContent = `已加载 ${activeList.length} 词`;
    
    // 数据加载完毕，开始生成播放列表
    // 传入 isRestore 标记，告诉函数 "我是自动恢复的，请尝试恢复进度"
    refreshPlayList(isRestore); 
    
    // 如果是手动点击加载，则关闭侧边栏；如果是自动恢复，则不动
    if (!isRestore) toggleSidebar(); 
}

// --- 4. 刷新与播放 (关键逻辑) ---

function refreshPlayList(isRestore = false) {
    // 1. 过滤 (斩掉的 + 模式不符的)
    let filtered = activeList.filter(w => {
        const notIgnored = !ignoredSet.has(w.id);
        const typeMatch = (currentMode === 'gender') ? (w.type === 'n') : true;
        return notIgnored && typeMatch;
    });

    // 2. 排序与进度恢复
    if (currentOrder === 'random') {
        // 随机模式：为了保证"随机感"，每次刷新都重洗。
        // 但如果是恢复网页，用户可能希望看到之前的单词？
        // 随机模式下很难界定"进度"，所以我们策略是：
        // 恢复时也重洗，但如果需要，可以存 seed。这里简单处理：重洗。
        playList = [...filtered].sort(() => Math.random() - 0.5);
        if (!isRestore) currentIndex = 0;
    } else {
        // 顺序模式：这是恢复进度的重点
        playList = [...filtered];
        
        if (isRestore) {
            // 从 localStorage 拿回上次的进度
            const savedSettings = localStorage.getItem('dv_settings');
            if (savedSettings) {
                const s = JSON.parse(savedSettings);
                // 恢复指针
                if (s.index && s.index < playList.length) {
                    currentIndex = s.index;
                } else {
                    currentIndex = 0;
                }
            }
        } else {
            // 手动切换设置，重置进度
            currentIndex = 0;
        }
    }

    saveState(); // 立即保存状态
    els.count.textContent = `剩余: ${playList.length} (斩: ${ignoredSet.size})`;
    nextQuestion();
}

// --- 5. 出题 ---
function nextQuestion() {
    if (playList.length === 0) {
        els.qMain.textContent = "列表为空";
        els.qSub.textContent = "请检查单元选择或恢复已斩单词";
        els.btnSubmit.style.display = 'none';
        els.btnIgnore.style.display = 'none';
        return;
    }

    // 在出题前保存当前进度（这样下次打开就是这个词）
    saveState();

    if (currentOrder === 'random') {
        const r = Math.floor(Math.random() * playList.length);
        currentWord = playList[r];
    } else {
        if (currentIndex >= playList.length) {
            alert("本轮结束，即将重新开始！");
            currentIndex = 0;
        }
        currentWord = playList[currentIndex];
        currentIndex++; // 指向下一个，准备下次调用
    }

    updateIgnoreBtnState();

    // UI 重置
    gameState = 'waiting_answer';
    els.result.innerHTML = ""; els.result.className = "result";
    els.infoArea.style.display = 'none';
    els.inputFull.value = "";
    els.btnIgnore.style.display = 'inline-block';
    
    els.qUnit.textContent = currentWord.unit;
    els.qMain.textContent = currentWord.cn;
    const displayType = TYPE_MAP[currentWord.type] || currentWord.type;
    els.qTag.textContent = displayType;
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
        if (currentWord.type === 'n') {
            els.inputFull.placeholder = "名词: der/die/das + 单词";
        } else {
            els.inputFull.placeholder = "请输入单词...";
        }
    }
}

// --- 6. 交互功能 ---
function toggleIgnore() {
    if (!currentWord) return;
    if (ignoredSet.has(currentWord.id)) {
        ignoredSet.delete(currentWord.id);
    } else {
        ignoredSet.add(currentWord.id);
    }
    saveIgnored();
    updateIgnoreBtnState();
    els.count.textContent = `剩余: ${playList.length} (斩: ${ignoredSet.size})`;
}

function updateIgnoreBtnState() {
    if (!currentWord) return;
    if (ignoredSet.has(currentWord.id)) {
        els.btnIgnore.textContent = "↩️ 撤销";
        els.btnIgnore.classList.add('ignored');
    } else {
        els.btnIgnore.textContent = "🗑️ 斩";
        els.btnIgnore.classList.remove('ignored');
    }
}

function resetIgnored() {
    if (confirm("恢复所有已删除单词？")) {
        ignoredSet.clear();
        saveIgnored();
        loadSelectedUnits(); // 重新加载生效
    }
}

function changeOrder() {
    const radios = document.getElementsByName('order');
    for(let r of radios) if(r.checked) currentOrder = r.value;
    refreshPlayList(false); // 改变顺序时重置进度
}

function switchMode(mode, refresh = true) {
    currentMode = mode;
    els.btnModeGender.className = mode === 'gender' ? 'active' : '';
    els.btnModeSpelling.className = mode === 'spelling' ? 'active' : '';
    if(refresh && activeList.length > 0) refreshPlayList(false); // 改变模式时重置进度
}

// 判题
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
    let ansHtml = currentWord.type === 'n' 
        ? `<span class="c-${currentWord.gender}">${currentWord.gender}</span> ${currentWord.word}`
        : currentWord.word;
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