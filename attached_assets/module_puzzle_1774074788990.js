// module_puzzle.js
// Handles Games: 11 (Complete Eq), 13 (Memo Order), 15 (Memo Cells)

let activeGame = "";
let score = 0;
let timeLeft = 0;
let timerInterval = null;
let memoInterval = null; 
let containerRef = null;

let updateScoreCb, updateTimerCb, gameOverCb;

// Game-Specific State
let targetSum = 0;
let selectedPairs = [];
let memorySequence = [];
let playerSequence = [];
let memoryLevel = 3; 
let isLocked = false;

// --- MULTIPLAYER & RECONNECT LOGIC ---
let currentSeed = null;
let roundStartAtGlobal = null;
let lastTickTime = 0;
let lastOptions = [];
let lastInstruction = "Loading...";

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
    
    score = startScore || 0;
    memoryLevel = 3; isLocked = false;
    updateScoreCb(score);

    if (activeGame === 'completeEq') {
        timerInterval = setInterval(tick, 1000);
        tick(); 
    } else {
        updateTimerCb(``, "var(--completed-green)");
    }

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <div id="puzzle-instruction" class="huge-display" style="font-size: 36px; min-height: 50px; display: flex; align-items: center; justify-content: center;">Loading...</div>
            <div id="puzzle-grid" style="display: grid; gap: 10px; width: 100%; max-width: 400px; margin-top: 20px;"></div>
        </div>
    `;

    generateProblem();
}

export function cleanup() {
    if (timerInterval) clearInterval(timerInterval);
    if (memoInterval) clearInterval(memoInterval); 
}

function tick() {
    if (activeGame !== 'completeEq' || isLocked) return;

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

    let mode = window.selectedWarmupMode || 'solo';
    let isSpeedRun = (mode === 'friend');
    let elapsed = Math.floor((now - roundStartAtGlobal) / 1000);
    
    let totalTime = isSpeedRun ? 60 : 10;
    timeLeft = totalTime - elapsed;

    updateTimerCb(`⏱️ ${Math.max(0, timeLeft)}s`, "var(--boss-red)");
    if (timeLeft <= 0) { isLocked = true; cleanup(); gameOverCb(score); }
}

function generateProblem() {
    let grid = document.getElementById('puzzle-grid');
    let inst = document.getElementById('puzzle-instruction');
    grid.innerHTML = ''; inst.style.color = "white";

    if (activeGame === 'completeEq') {
        let f1 = Math.floor(getRand() * 20) + 1; 
        let f2 = Math.floor(getRand() * 20) + 1;
        targetSum = f1 + f2;
        selectedPairs = [];
        
        lastInstruction = `? + ? = ${targetSum}`;
        inst.innerText = lastInstruction;
        grid.style.gridTemplateColumns = "repeat(3, 1fr)";
        
        let options = [f1, f2];
        while(options.length < 6) {
            let r = Math.floor(getRand() * 40) + 1;
            if(!options.includes(r)) options.push(r);
        }
        options.sort(() => getRand() - 0.5); 
        lastOptions = options;
        
        options.forEach(val => {
            let btn = document.createElement('button');
            btn.className = 'custom-btn'; btn.innerText = val;
            btn.style.padding = "20px 0";
            btn.onclick = () => handleCompleteEq(val, btn);
            grid.appendChild(btn);
        });
    } 
    else if (activeGame === 'memoOrder' || activeGame === 'memoCells') {
        isLocked = true; playerSequence = []; memorySequence = [];
        
        let gridSize = memoryLevel < 5 ? 9 : 16; 
        grid.style.gridTemplateColumns = `repeat(${Math.sqrt(gridSize)}, 1fr)`;
        
        while(memorySequence.length < memoryLevel) {
            let r = Math.floor(getRand() * gridSize);
            if(!memorySequence.includes(r)) memorySequence.push(r);
        }

        for(let i = 0; i < gridSize; i++) {
            let btn = document.createElement('button');
            btn.className = 'custom-btn'; btn.style.height = "80px"; btn.style.padding = "0"; btn.style.background = "rgba(0,0,0,0.6)"; 
            btn.onclick = () => handleMemory(i, btn);
            grid.appendChild(btn);
        }

        inst.innerHTML = '';
        let readyBtn = document.createElement('button'); readyBtn.className = 'btn btn-primary';
        readyBtn.innerText = "👁️ SHOW SEQUENCE"; readyBtn.style.padding = "10px 30px"; readyBtn.style.fontSize = "22px";
        
        readyBtn.onclick = () => {
            let displayTime = 1000 + (memoryLevel * 400); 
            let countdownSeconds = Math.ceil(displayTime / 1000); 
            
            inst.innerText = `${countdownSeconds}`;
            memoInterval = setInterval(() => {
                countdownSeconds--;
                if (countdownSeconds > 0) inst.innerText = `${countdownSeconds}`;
            }, 1000);
            
            Array.from(grid.children).forEach((btn, i) => {
                let orderIdx = memorySequence.indexOf(i);
                if (orderIdx !== -1) {
                    btn.style.background = "var(--accent-color)";
                    if (activeGame === 'memoOrder') { btn.innerText = orderIdx + 1; btn.style.color = "black"; }
                }
            });

            setTimeout(() => {
                clearInterval(memoInterval);
                Array.from(grid.children).forEach(btn => { btn.style.background = "rgba(0,0,0,0.6)"; btn.innerText = ""; });
                lastInstruction = activeGame === 'memoOrder' ? "Tap in order!" : "Tap the cells!";
                inst.innerText = lastInstruction;
                isLocked = false;
            }, displayTime);
        };
        inst.appendChild(readyBtn);
    }
}

function handleCompleteEq(val, btn) {
    if (isLocked || selectedPairs.find(p => p.val === val)) return; 
    let mode = window.selectedWarmupMode || 'solo';
    let isSpeedRun = (mode === 'friend');
    
    btn.style.background = "var(--accent-color)"; btn.style.color = "black";
    selectedPairs.push({val: val, btn: btn});
    
    if (selectedPairs.length === 2) {
        let sum = selectedPairs[0].val + selectedPairs[1].val;
        if (sum === targetSum) {
            score++; updateScoreCb(score);
            document.getElementById('puzzle-instruction').style.color = "var(--completed-green)";
            if (!isSpeedRun) {
                roundStartAtGlobal = Date.now(); 
                updateTimerCb(`⏱️ 10s`, "var(--completed-green)");
            }
            setTimeout(generateProblem, 300);
        } else {
            if (isSpeedRun) {
                score = Math.max(0, score - 1); updateScoreCb(score);
                selectedPairs.forEach(x => { if(x.btn) x.btn.style.background = "var(--boss-red)"; });
                setTimeout(() => {
                    selectedPairs.forEach(x => { if(x.btn) { x.btn.style.background = "rgba(0,0,0,0.6)"; x.btn.style.color = "white"; } });
                    selectedPairs = [];
                }, 500);
            } else {
                isLocked = true;
                selectedPairs.forEach(x => { if(x.btn) x.btn.style.background = "var(--boss-red)"; });
                cleanup(); setTimeout(() => gameOverCb(score), 500);
            }
        }
    }
}

function handleMemory(idx, btn) {
    if (isLocked || playerSequence.includes(idx)) return;
    playerSequence.push(idx);

    if (activeGame === 'memoOrder') {
        if (idx === memorySequence[playerSequence.length - 1]) {
            btn.style.background = "var(--completed-green)"; btn.innerText = playerSequence.length;
            if (playerSequence.length === memorySequence.length) {
                score++; updateScoreCb(score);
                if (score % 2 === 0) memoryLevel++; 
                isLocked = true; setTimeout(generateProblem, 800);
            }
        } else {
            btn.style.background = "var(--boss-red)";
            isLocked = true; setTimeout(() => gameOverCb(score), 500);
        }
    } 
    else if (activeGame === 'memoCells') {
        if (memorySequence.includes(idx)) {
            btn.style.background = "var(--completed-green)";
            if (playerSequence.length === memorySequence.length) {
                score++; updateScoreCb(score);
                if (score % 2 === 0) memoryLevel++;
                isLocked = true; setTimeout(generateProblem, 800);
            }
        } else {
            btn.style.background = "var(--boss-red)";
            isLocked = true; setTimeout(() => gameOverCb(score), 500);
        }
    }
}

export function restoreUI(container) {
    containerRef = container;
    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <div id="puzzle-instruction" class="huge-display" style="font-size: 36px; min-height: 50px; display: flex; align-items: center; justify-content: center;">${lastInstruction}</div>
            <div id="puzzle-grid" style="display: grid; gap: 10px; width: 100%; max-width: 400px; margin-top: 20px;"></div>
        </div>
    `;
    let grid = document.getElementById('puzzle-grid');
    
    if (activeGame === 'completeEq') {
        grid.style.gridTemplateColumns = "repeat(3, 1fr)";
        lastOptions.forEach(val => {
            let btn = document.createElement('button'); btn.className = 'custom-btn'; btn.innerText = val; btn.style.padding = "20px 0";
            let pairObj = selectedPairs.find(p => p.val === val);
            if (pairObj) { btn.style.background = "var(--accent-color)"; btn.style.color = "black"; pairObj.btn = btn; }
            btn.onclick = () => handleCompleteEq(val, btn);
            grid.appendChild(btn);
        });
    } else {
        let gridSize = memoryLevel < 5 ? 9 : 16; 
        grid.style.gridTemplateColumns = `repeat(${Math.sqrt(gridSize)}, 1fr)`;
        for(let i = 0; i < gridSize; i++) {
            let btn = document.createElement('button'); btn.className = 'custom-btn'; btn.style.height = "80px"; btn.style.padding = "0";
            if (playerSequence.includes(i)) {
                btn.style.background = "var(--completed-green)";
                if (activeGame === 'memoOrder') { btn.innerText = playerSequence.indexOf(i) + 1; btn.style.color = "black"; }
            } else { btn.style.background = "rgba(0,0,0,0.6)"; }
            btn.onclick = () => handleMemory(i, btn);
            grid.appendChild(btn);
        }
    }
}