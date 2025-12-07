// --- 常量与映射 ---
const TYPE_MAP = {
    'n': '名词 (Nomen)', 'v': '动词 (Verb)', 'adj': '形容词 (Adjektiv)',
    'adv': '副词 (Adverb)', 'prep': '介词 (Präposition)', 'pron': '代词 (Pronomen)',
    'conj': '连词 (Konjunktion)', 'num': '数词 (Numerale)', 'art': '冠词 (Artikel)'
};

// --- 状态变量 ---
let configData = {};
let activeList = [];    // 从CSV加载的原始词
let playList = [];      // 过滤掉“斩”掉的词后的播放列表

// 核心状态
let currentMode = 'spelling';   
let currentOrder = 'random';    
let gameState = 'waiting_answer'; 
let currentWord = null;
let currentIndex = 0;

// 本地存储：已删除的单词 ID 集合
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
    btnIgnore: document.getElementById('btn-ignore') // 新增
};

// --- 1. 初始化 ---
// 页面加载时：先读本地存储，再读Config
loadLocalStorage();

fetch('data/config.json')
    .then(res => res.json())
    .then(data => {
        configData = data;
        renderSidebar();
        
        // 尝试自动恢复上次的勾选状态并加载
        if (restoreSidebarSelection()) {
            loadSelectedUnits(true); // true 表示是恢复模式，不弹出alert
        } else {
            els.count.textContent = "请打开侧边栏选择单元";
            toggleSidebar();
        }
    })
    .catch(err => {
        console.error("Config加载失败", err);
        els.count.textContent = "配置加载失败";
    });

// --- 2. 本地存储逻辑 (核心) ---

// 读取本地存储
function loadLocalStorage() {
    // 1. 读取被删除的词
    const savedIgnored = localStorage.getItem('dv_ignored');
    if (savedIgnored) {
        ignoredSet = new Set(JSON.parse(savedIgnored));
    }

    // 2. 读取上次的设置 (模式、顺序)
    const savedSettings = localStorage.getItem('dv_settings');
    if (savedSettings) {
        const s = JSON.parse(savedSettings);
        currentMode = s.mode || 'spelling';
        currentOrder = s.order || 'random';
        currentIndex = s.index || 0; // 恢复进度
        
        // 恢复UI状态
        switchMode(currentMode, false); // false = 不刷新列表(等数据加载完)
        
        // 恢复单选框
        const radios = document.getElementsByName('order');
        for(let r of radios) {
            if(r.value === currentOrder) r.checked = true;
        }
    }
}

// 保存当前状态 (每次变动都调用)
function saveState() {
    const settings = {
        mode: currentMode,
        order: currentOrder,
        index: currentIndex
    };
    localStorage.setItem('dv_settings', JSON.stringify(settings));
}

// 保存删除列表
function saveIgnored() {
    localStorage.setItem('dv_ignored', JSON.stringify([...ignoredSet]));
}

// 恢复侧边栏勾选
function restoreSidebarSelection() {
    const savedSelection = localStorage.getItem('dv_selection');
    if (!savedSelection) return false;

    const checkedValues = JSON.parse(savedSelection);
    // 等待Sidebar渲染完，延迟一点点勾选
    setTimeout(() => {
        const inputs = document.querySelectorAll('#bookshelf input');
        let hasChecked = false;
        inputs.forEach(input => {
            if (checkedValues.includes(input.value)) {
                input.checked = true;
                hasChecked = true;
            }
        });
    }, 0);
    return true; // 表示尝试恢复了
}

// 保存侧边栏勾选
function saveSidebarSelection() {
    const checkboxes = document.querySelectorAll('#bookshelf input:checked');
    const values = Array.from(checkboxes).map(cb => cb.value);
    localStorage.setItem('dv_selection', JSON.stringify(values));
}


// --- 3. 侧边栏与加载 ---
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

async function loadSelectedUnits(isRestore = false) {
    const checkboxes = document.querySelectorAll('#bookshelf input:checked');
    if (checkboxes.length === 0) {
        if (!isRestore) alert("请至少选择一个单元！");
        return;
    }

    saveSidebarSelection(); // 保存勾选状态

    els.sidebarStats.textContent = "读取中...";
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
                // 生成一个唯一ID用于删除标记：书名-单元-单词
                const uniqueId = `${info.book}-${info.name}-${row[2].trim()}`;
                
                words.push({
                    id: uniqueId, // 关键：唯一ID
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
    
    refreshPlayList(isRestore); // 如果是恢复模式，尽量保持currentIndex
    if (!isRestore) toggleSidebar(); 
}

// --- 4. 刷新播放列表 (过滤删除词) ---
function refreshPlayList(keepIndex = false) {
    // 1. 过滤掉被“斩”的词
    // 2. 过滤掉模式不符的词 (比如只要名词)
    let filtered = activeList.filter(w => {
        const notIgnored = !ignoredSet.has(w.id);
        const typeMatch = (currentMode === 'gender') ? (w.type === 'n') : true;
        return notIgnored && typeMatch;
    });

    // 3. 排序
    if (currentOrder === 'random') {
        // 如果是随机，且不是恢复状态，则重新洗牌
        if (!keepIndex) {
            playList = [...filtered].sort(() => Math.random() - 0.5);
            currentIndex = 0;
        } else {
            // 恢复状态下，如果是随机，为了体验好，也重洗吧，或者保持原样
            // 这里简单处理：只要加载数据就重洗
             playList = [...filtered].sort(() => Math.random() - 0.5);
        }
    } else {
        // 顺序模式
        playList = [...filtered]; 
        // keepIndex为true时(比如刷新页面)，尝试保持进度。
        // 但如果进度超过了现在列表长度，就重置。
        if (!keepIndex) currentIndex = 0;
    }

    if (currentIndex >= playList.length) currentIndex = 0;
    saveState(); // 保存状态

    els.count.textContent = `当前剩余: ${playList.length} 词 (已斩: ${ignoredSet.size})`;
    nextQuestion();
}

// --- 5. 出题 ---
function nextQuestion() {
    if (playList.length === 0) {
        els.qMain.textContent = "没有单词了！";
        els.qSub.textContent = "可能都被你“斩”光了，或未选择单元。";
        els.btnSubmit.style.display = 'none';
        els.btnIgnore.style.display = 'none';
        return;
    }

    // 保存进度
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

    // 更新“斩”按钮状态
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

// --- 6. 新增：删除/恢复功能 ---
function toggleIgnore() {
    if (!currentWord) return;

    if (ignoredSet.has(currentWord.id)) {
        // 撤销删除
        ignoredSet.delete(currentWord.id);
    } else {
        // 确认删除
        ignoredSet.add(currentWord.id);
    }
    
    saveIgnored(); // 保存到硬盘
    updateIgnoreBtnState(); // 更新按钮样式
    
    // 更新左上角计数
    els.count.textContent = `当前剩余: ${playList.length} 词 (已斩: ${ignoredSet.size})`;
    
    // 注意：这里我们不立即刷新 playList，否则当前词会突然消失。
    // 我们只是标记它，下次 filter 时它就不见了。
}

function updateIgnoreBtnState() {
    if (!currentWord) return;
    if (ignoredSet.has(currentWord.id)) {
        els.btnIgnore.textContent = "↩️ 撤销删除";
        els.btnIgnore.classList.add('ignored');
    } else {
        els.btnIgnore.textContent = "🗑️ 斩 (熟词)";
        els.btnIgnore.classList.remove('ignored');
    }
}

function resetIgnored() {
    if (confirm("确定要恢复所有被删除的单词吗？")) {
        ignoredSet.clear();
        saveIgnored();
        alert("已恢复！请重新加载单元生效。");
        // 刷新页面或重新加载
        loadSelectedUnits();
    }
}

// --- 7. 其他交互保持不变 ---
function changeOrder() {
    const radios = document.getElementsByName('order');
    for(let r of radios) if(r.checked) currentOrder = r.value;
    refreshPlayList();
}

function switchMode(mode, refresh = true) {
    currentMode = mode;
    els.btnModeGender.className = mode === 'gender' ? 'active' : '';
    els.btnModeSpelling.className = mode === 'spelling' ? 'active' : '';
    if(refresh && activeList.length > 0) refreshPlayList();
}

// 判题 (保持不变)
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