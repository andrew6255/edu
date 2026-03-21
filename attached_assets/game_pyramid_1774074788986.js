// game_pyramid.js

let score = 0;
let timerInterval = null;
let updateScoreCb, updateTimerCb, gameOverCb, containerRef;

let pyramidData = []; 
let hiddenIndices = []; 
let selectedBlock = null; 
let userInput = "";

// --- MULTIPLAYER & RECONNECT LOGIC ---
let currentSeed = null;
let roundStartAtGlobal = null;
let lastTickTime = 0;
let isLocked = false;

function getRand() {
    if (currentSeed === null) return Math.random();
    let t = currentSeed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

export function start(gameId, container, onScore, onTimer, onGameOver, multiSeed = null, rStart = null, startScore = 0) {
    containerRef = container; updateScoreCb = onScore; updateTimerCb = onTimer; gameOverCb = onGameOver;
    currentSeed = multiSeed;
    
    roundStartAtGlobal = rStart || Date.now();
    lastTickTime = Date.now();
    score = startScore || 0;
    isLocked = false;
    updateScoreCb(score); 

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <p style="color: white; margin-bottom: 20px;">The two blocks below add up to the block above.</p>
            <div id="pyramid-wrapper" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;"></div>
            <div id="pyr-numpad" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 250px;"></div>
        </div>
    `;

    buildNumpad();
    timerInterval = setInterval(tick, 1000);
    tick();
    generatePyramid();
}

export function cleanup() { clearInterval(timerInterval); }

function tick() {
    if (isLocked) return;

    let now = Date.now();
    let delta = now - lastTickTime; 
    lastTickTime = now;
    
    let arena = document.getElementById('screen-arena');
    let isSwipedAway = arena && !arena.classList.contains('active');
    let isBotMatch = window.opponentData && window.opponentData.isAI;

    if (isBotMatch && (isSwipedAway || delta > 2000)) {
        roundStartAtGlobal += delta; 
        if (isSwipedAway) return; 
    }

    let elapsed = Math.floor((now - roundStartAtGlobal) / 1000);
    let mode = window.selectedWarmupMode || 'solo';
    let totalTime = (mode === 'friend') ? 60 : 15; 
    
    let timeLeft = totalTime - elapsed;
    updateTimerCb(`⏱️ ${Math.max(0, timeLeft)}s`, "var(--boss-red)");
    
    if (timeLeft <= 0) { isLocked = true; cleanup(); gameOverCb(score); }
}

export function restoreUI(container) {
    containerRef = container;
    container.innerHTML = `<div style="width: 100%; display: flex; flex-direction: column; align-items: center;"><p style="color: white; margin-bottom: 20px;">The two blocks below add up to the block above.</p><div id="pyramid-wrapper" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;"></div><div id="pyr-numpad" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 250px;"></div></div>`;
    buildNumpad(); renderPyramid();
}

function generatePyramid() {
    let b1 = Math.floor(getRand() * 10) + 1; let b2 = Math.floor(getRand() * 10) + 1; let b3 = Math.floor(getRand() * 10) + 1;
    let m1 = b1 + b2; let m2 = b2 + b3; let top = m1 + m2;
    pyramidData = [top, m1, m2, b1, b2, b3];
    
    hiddenIndices = [];
    while(hiddenIndices.length < 3) {
        let r = Math.floor(getRand() * 6);
        if(!hiddenIndices.includes(r)) hiddenIndices.push(r);
    }
    selectedBlock = hiddenIndices[0]; userInput = "";
    renderPyramid();
}

function renderPyramid() {
    const wrap = document.getElementById('pyramid-wrapper'); if (!wrap) return;
    wrap.innerHTML = '';
    const rows = [[0], [1, 2], [3, 4, 5]];
    
    rows.forEach(row => {
        let rowDiv = document.createElement('div'); rowDiv.style.display = 'flex'; rowDiv.style.justifyContent = 'center'; rowDiv.style.gap = '10px';
        row.forEach(idx => {
            let block = document.createElement('div');
            block.style.width = '70px'; block.style.height = '70px'; block.style.display = 'flex'; block.style.alignItems = 'center'; block.style.justifyContent = 'center'; block.style.fontSize = '24px'; block.style.fontWeight = 'bold'; block.style.borderRadius = '8px'; block.style.transition = '0.2s';
            
            if (hiddenIndices.includes(idx)) {
                block.style.cursor = 'pointer';
                if (selectedBlock === idx) { block.style.background = 'var(--accent-color)'; block.style.color = 'black'; block.innerText = userInput || "?"; } 
                else { block.style.background = 'rgba(0,0,0,0.6)'; block.style.border = '2px dashed var(--accent-color)'; block.style.color = 'var(--accent-color)'; block.innerText = "?"; }
                block.onclick = () => { if(!isLocked){ selectedBlock = idx; userInput = ""; renderPyramid(); } };
            } else {
                block.style.background = 'rgba(255,255,255,0.1)'; block.style.color = 'white'; block.style.border = '2px solid var(--locked-grey)'; block.innerText = pyramidData[idx];
            }
            rowDiv.appendChild(block);
        });
        wrap.appendChild(rowDiv);
    });
}

function buildNumpad() {
    const pad = document.getElementById('pyr-numpad');
    const keys = ['1','2','3','4','5','6','7','8','9','C','0','Enter'];
    keys.forEach(k => {
        let btn = document.createElement('button'); btn.className = 'custom-btn'; btn.style.padding = '15px'; btn.style.minWidth = 'auto';
        btn.innerText = k === 'Enter' ? '✔️' : k; if (k === 'Enter') btn.style.background = 'var(--completed-green)';
        
        const bindTap = (button, action) => { button.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, {passive: false}); button.addEventListener('mousedown', (e) => { e.preventDefault(); action(); }); };
        bindTap(btn, () => {
            if (isLocked) return;
            if (k === 'C') userInput = ""; else if (k === 'Enter') checkAnswer(); else userInput += k; renderPyramid();
        });
        pad.appendChild(btn);
    });
}

function checkAnswer() {
    if (isLocked) return;
    let mode = window.selectedWarmupMode || 'solo';
    let isSpeedRun = (mode === 'friend');

    if (parseInt(userInput) === pyramidData[selectedBlock]) {
        hiddenIndices = hiddenIndices.filter(i => i !== selectedBlock); userInput = "";
        if (hiddenIndices.length === 0) {
            score++; updateScoreCb(score);
            if (!isSpeedRun) roundStartAtGlobal = Date.now(); 
            setTimeout(generatePyramid, 500);
        } else { selectedBlock = hiddenIndices[0]; renderPyramid(); }
    } else {
        if (isSpeedRun) {
            score = Math.max(0, score - 1); updateScoreCb(score);
            userInput = ""; renderPyramid();
        } else {
            isLocked = true; cleanup(); setTimeout(() => gameOverCb(score), 500);
        }
    }
}