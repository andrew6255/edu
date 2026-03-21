// module_numpad.js
// Handles Games: 3 (Number Grid), 12 (Sequence)

let activeGame = "";
let score = 0;
let timeTracker = 0; 
let timerInterval = null;
let currentAnswer = "";
let userInput = "";
let containerRef = null;

let numGridProgress = 0;
const NUMGRID_TARGET = 10; 

let updateScoreCb, updateTimerCb, gameOverCb;

// --- MULTIPLAYER & RECONNECT LOGIC ---
let currentSeed = null;
let roundStartAtGlobal = null;
let lastTickTime = 0;
let isLocked = false;
let lastQText = "";

function getRand() {
    if (currentSeed === null) return Math.random();
    let t = currentSeed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
// ------------------------------

export function start(gameId, container, onScore, onTimer, onGameOver, multiSeed = null, rStart = null, startScore = 0) {
    activeGame = gameId; containerRef = container; updateScoreCb = onScore; updateTimerCb = onTimer; gameOverCb = onGameOver;
    currentSeed = multiSeed;
    
    roundStartAtGlobal = rStart || Date.now();
    lastTickTime = Date.now();
    isLocked = false;

    score = startScore || 0; 
    userInput = ""; numGridProgress = 0; updateScoreCb(score);

    timeTracker = (activeGame === 'numGrid') ? 0 : 60;
    updateTimerCb(`⏱️ ${timeTracker}s`, activeGame === 'numGrid' ? "var(--completed-green)" : "var(--boss-red)");

    let extraUI = activeGame === 'numGrid' 
        ? `<div style="width:100%; height:15px; background:rgba(255,255,255,0.1); border-radius:10px; margin-bottom:20px; overflow:hidden;"><div id="progress-fill" style="width:0%; height:100%; background:var(--completed-green); transition:0.3s;"></div></div>` : ``;

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            ${extraUI}
            <div id="numpad-question" class="huge-display">Loading...</div>
            <div id="numpad-display" style="font-size: 32px; padding: 15px 30px; background: rgba(0,0,0,0.5); border: 2px solid var(--accent-color); border-radius: 12px; margin-bottom: 20px; min-width: 150px; color: white;">_</div>
            <div id="numpad-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; width: 100%; max-width: 300px;"></div>
        </div>
    `;

    buildNumpad(); 
    timerInterval = setInterval(tick, 1000); 
    tick(); 
    generateProblem();
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

    if (activeGame === 'numGrid') {
        timeTracker = elapsed; 
        updateTimerCb(`⏱️ ${timeTracker}s`, "var(--completed-green)");
    } else {
        let mode = window.selectedWarmupMode || 'solo';
        let isSpeedRun = (mode === 'friend');
        let totalTime = isSpeedRun ? 60 : 10;
        let timeLeft = totalTime - elapsed;

        updateTimerCb(`⏱️ ${Math.max(0, timeLeft)}s`, "var(--boss-red)");
        if (timeLeft <= 0) { isLocked = true; cleanup(); gameOverCb(score); }
    }
}

function buildNumpad() {
    const grid = document.getElementById('numpad-grid');
    const keys = ['1','2','3','4','5','6','7','8','9','-','0','C'];
    
    const bindTap = (btn, action) => {
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, {passive: false});
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); action(); });
    };

    keys.forEach(k => {
        let btn = document.createElement('button'); btn.type = 'button'; btn.className = 'custom-btn'; btn.style.padding = '15px'; btn.style.minWidth = 'auto'; btn.innerText = k;
        bindTap(btn, () => {
            if (isLocked) return;
            if (k === 'C') userInput = "";
            else if (k === '-') userInput = userInput.startsWith('-') ? userInput.substring(1) : '-' + userInput;
            else userInput += k;
            document.getElementById('numpad-display').innerText = userInput || "_";
        });
        grid.appendChild(btn);
    });

    let subBtn = document.createElement('button'); subBtn.type = 'button'; subBtn.className = 'custom-btn'; subBtn.style.gridColumn = 'span 3'; subBtn.style.background = 'var(--completed-green)'; subBtn.innerText = 'SUBMIT';
    bindTap(subBtn, () => handleAnswer());
    grid.appendChild(subBtn);
}

function handleAnswer() {
    if (isLocked) return;
    let display = document.getElementById('numpad-display');
    let mode = window.selectedWarmupMode || 'solo';
    let isSpeedRun = (mode === 'friend');

    if (userInput.trim() === currentAnswer) {
        display.style.borderColor = "var(--completed-green)";
        document.getElementById('numpad-question').style.color = "var(--completed-green)";
        
        if (activeGame === 'numGrid') {
            numGridProgress++;
            let pFill = document.getElementById('progress-fill');
            if (pFill) pFill.style.width = `${(numGridProgress / NUMGRID_TARGET) * 100}%`;
            if (numGridProgress >= NUMGRID_TARGET) { isLocked = true; cleanup(); setTimeout(() => gameOverCb(timeTracker), 500); return; }
        } else { 
            score++; updateScoreCb(score); 
            if (!isSpeedRun) {
                roundStartAtGlobal = Date.now(); 
                updateTimerCb(`⏱️ 10s`, "var(--completed-green)");
            }
        }
        setTimeout(generateProblem, 300);
    } else {
        if (activeGame === 'numGrid') {
            display.style.borderColor = "var(--boss-red)";
            setTimeout(() => { display.style.borderColor = "var(--accent-color)"; userInput = ""; display.innerText = "_"; }, 400);
        } else {
            if (isSpeedRun) {
                score = Math.max(0, score - 1); updateScoreCb(score);
                display.style.borderColor = "var(--boss-red)";
                setTimeout(() => { display.style.borderColor = "var(--accent-color)"; userInput = ""; display.innerText = "_"; }, 400);
            } else {
                isLocked = true;
                display.style.borderColor = "var(--boss-red)";
                cleanup(); setTimeout(() => gameOverCb(score), 500);
            }
        }
    }
}

function generateProblem() {
    userInput = "";
    let dEl = document.getElementById('numpad-display'); if(dEl) { dEl.innerText = "_"; dEl.style.borderColor = "var(--accent-color)"; }
    let qEl = document.getElementById('numpad-question'); if(qEl) qEl.style.color = "white";

    if (activeGame === 'numGrid') {
        let ops = ['+', '-', '*'];
        let op = ops[Math.floor(getRand() * ops.length)];
        let a, b;
        
        if (op === '+' || op === '-') { a = Math.floor(getRand() * 80) + 10; b = Math.floor(getRand() * 80) + 10; } 
        else { a = Math.floor(getRand() * 15) + 2; b = Math.floor(getRand() * 15) + 2; }
        
        if (op === '+') currentAnswer = String(a + b);
        if (op === '-') { if (b > a) { let t = a; a = b; b = t; } currentAnswer = String(a - b); }
        if (op === '*') currentAnswer = String(a * b);
        
        lastQText = `${a} ${op} ${b}`;
    } 
    else if (activeGame === 'sequence') {
        let start = Math.floor(getRand() * 20) + 1;
        let step = Math.floor(getRand() * 8) + 2;
        let isMultiply = getRand() > 0.6; 
        
        let seq = [start];
        for(let i=1; i<4; i++) {
            if(isMultiply) seq.push(seq[i-1] * step);
            else seq.push(seq[i-1] + step);
        }
        
        currentAnswer = String(isMultiply ? seq[3] * step : seq[3] + step);
        lastQText = `${seq[0]}, ${seq[1]}, ${seq[2]}, ${seq[3]}, ?`;
    }
    
    if (qEl) qEl.innerText = lastQText;
}

export function restoreUI(container) {
    containerRef = container;
    let extraUI = activeGame === 'numGrid' ? `<div style="width:100%; height:15px; background:rgba(255,255,255,0.1); border-radius:10px; margin-bottom:20px; overflow:hidden;"><div id="progress-fill" style="width:${(numGridProgress / NUMGRID_TARGET) * 100}%; height:100%; background:var(--completed-green); transition:0.3s;"></div></div>` : ``;

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            ${extraUI}
            <div id="numpad-question" class="huge-display">${lastQText}</div>
            <div id="numpad-display" style="font-size: 32px; padding: 15px 30px; background: rgba(0,0,0,0.5); border: 2px solid var(--accent-color); border-radius: 12px; margin-bottom: 20px; min-width: 150px; color: white;">${userInput || "_"}</div>
            <div id="numpad-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; width: 100%; max-width: 300px;"></div>
        </div>
    `;
    buildNumpad();
}