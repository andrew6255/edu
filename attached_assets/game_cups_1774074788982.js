// game_cups.js
// "Flip Nodes" (Parity Puzzle)

let score = 0;
let timerInterval = null;
let updateScoreCb, updateTimerCb, gameOverCb, containerRef;

let numCups = 3;
let flipLimit = 2;
let targetState = [];
let cupsState = [];
let selectedCups = [];

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
    isLocked = false;
    score = startScore || 0; 
    updateScoreCb(score); 

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center; touch-action: none;">
            <div id="cups-target-text" style="color: #94a3b8; font-weight: bold; margin-bottom: 5px; font-size: 14px; letter-spacing: 2px;">TARGET PATTERN</div>
            <div id="cups-target-board" style="display: flex; gap: 8px; margin-bottom: 20px; border: 2px solid var(--locked-grey); padding: 10px; border-radius: 8px; background: rgba(0,0,0,0.5);"></div>
            <div id="cups-instruction" style="color: white; font-size: 16px; margin-bottom: 20px; text-align: center;">Loading...</div>
            <div id="cups-interactive-board" style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: center; background: rgba(0,0,0,0.3); padding: 25px 20px; border-radius: 12px; border: 1px solid var(--locked-grey); box-shadow: inset 0 0 20px rgba(0,0,0,0.5); min-height: 120px; align-items: center;"></div>
        </div>
    `;

    timerInterval = setInterval(tick, 1000);
    tick();
    generatePuzzle();
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
    let totalTime = (mode === 'friend' || window.isMultiplayer) ? 60 : 60; // 60s for both modes
    let timeLeft = totalTime - elapsed;
    
    updateTimerCb(`⏱️ ${Math.max(0, timeLeft)}s`, "var(--boss-red)");
    if (timeLeft <= 0) { isLocked = true; cleanup(); gameOverCb(score); }
}

export function restoreUI(container) {
    containerRef = container;
    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center; touch-action: none;">
            <div id="cups-target-text" style="color: #94a3b8; font-weight: bold; margin-bottom: 5px; font-size: 14px; letter-spacing: 2px;">TARGET PATTERN</div>
            <div id="cups-target-board" style="display: flex; gap: 8px; margin-bottom: 20px; border: 2px solid var(--locked-grey); padding: 10px; border-radius: 8px; background: rgba(0,0,0,0.5);"></div>
            <div id="cups-instruction" style="color: white; font-size: 16px; margin-bottom: 20px; text-align: center;">Loading...</div>
            <div id="cups-interactive-board" style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: center; background: rgba(0,0,0,0.3); padding: 25px 20px; border-radius: 12px; border: 1px solid var(--locked-grey); box-shadow: inset 0 0 20px rgba(0,0,0,0.5); min-height: 120px; align-items: center;"></div>
        </div>
    `;
    renderUI();
}

function generatePuzzle() {
    selectedCups = [];
    
    // Difficulty Scaling based on your requested tiers!
    if (score < 3) { numCups = 3; flipLimit = 2; }
    else if (score < 6) { numCups = 4; flipLimit = 2; }
    else if (score < 9) { numCups = 5; flipLimit = 3; }
    else { numCups = 5; flipLimit = Math.floor(getRand() * 2) + 2; } // Flips 2 or 3

    // Determine Target Pattern (All Up vs Random)
    targetState = [];
    for (let i = 0; i < numCups; i++) {
        if (score < 9) targetState.push(true); // Early levels: All UP
        else targetState.push(getRand() > 0.5); // Hard levels: Random Pattern
    }

    // Reverse-Scramble to GUARANTEE mathematical solvability!
    cupsState = [...targetState];
    let scrambleMoves = 3 + Math.floor(getRand() * 3); // 3 to 5 scrambles
    
    for (let m = 0; m < scrambleMoves; m++) {
        let indices = [];
        while (indices.length < flipLimit) {
            let r = Math.floor(getRand() * numCups);
            if (!indices.includes(r)) indices.push(r);
        }
        indices.forEach(idx => cupsState[idx] = !cupsState[idx]);
    }

    // Failsafe: Make sure it doesn't accidentally scramble back into the solved state
    if (JSON.stringify(cupsState) === JSON.stringify(targetState)) {
        for(let i=0; i<flipLimit; i++) cupsState[i] = !cupsState[i];
    }

    renderUI();
}

function renderUI() {
    let instEl = document.getElementById('cups-instruction');
    if (instEl) instEl.innerHTML = `Select exactly <b style="color: var(--accent-color); font-size: 22px;">${flipLimit}</b> nodes to flip them!`;

    // Draw Target Board (Miniature Neon Nodes)
    let tBoard = document.getElementById('cups-target-board');
    if (tBoard) {
        tBoard.innerHTML = '';
        targetState.forEach(isUp => {
            let mini = document.createElement('div');
            mini.style.width = '24px'; mini.style.height = '24px';
            mini.style.background = isUp ? 'var(--accent-blue)' : 'var(--locked-grey)';
            mini.style.borderRadius = isUp ? '24px 24px 4px 4px' : '4px 4px 24px 24px'; // Semi-circle Node
            tBoard.appendChild(mini);
        });
    }

    // Draw Interactive Board
    let iBoard = document.getElementById('cups-interactive-board');
    if (iBoard) {
        iBoard.innerHTML = '';
        cupsState.forEach((isUp, idx) => {
            let isSelected = selectedCups.includes(idx);
            let btn = document.createElement('div');
            
            btn.style.width = '60px'; btn.style.height = '60px';
            btn.style.background = isUp ? 'var(--accent-blue)' : 'var(--locked-grey)';
            btn.style.borderRadius = isUp ? '60px 60px 8px 8px' : '8px 8px 60px 60px'; 
            btn.style.transition = 'all 0.15s ease-out';
            btn.style.cursor = 'pointer';
            
            // Neon Glow Effect
            btn.style.boxShadow = isUp ? '0 0 15px rgba(59, 130, 246, 0.7)' : '0 0 5px rgba(0,0,0,0.8)';

            // Selection Animation
            if (isSelected) {
                btn.style.transform = 'scale(1.15) translateY(-8px)';
                btn.style.border = '3px solid white';
                btn.style.boxShadow = isUp ? '0 0 25px rgba(255, 255, 255, 0.8)' : '0 0 15px rgba(255, 255, 255, 0.5)';
            } else {
                btn.style.border = '3px solid transparent';
                btn.style.transform = 'scale(1) translateY(0)';
            }

            const bindTap = (button, action) => {
                button.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, {passive: false});
                button.addEventListener('mousedown', (e) => { e.preventDefault(); action(); });
            };

            bindTap(btn, () => handleCupClick(idx));
            iBoard.appendChild(btn);
        });
    }
}

function handleCupClick(idx) {
    if (isLocked) return;

    // Toggle selection
    if (selectedCups.includes(idx)) {
        selectedCups = selectedCups.filter(i => i !== idx);
    } else {
        selectedCups.push(idx);
    }

    renderUI();

    // The Auto-Flip Interaction!
    if (selectedCups.length === flipLimit) {
        isLocked = true;
        
        // Wait 250ms so they can visually register their final tap before it flips
        setTimeout(() => {
            selectedCups.forEach(i => cupsState[i] = !cupsState[i]);
            selectedCups = [];
            renderUI();
            checkWin();
        }, 250); 
    }
}

function checkWin() {
    if (JSON.stringify(cupsState) === JSON.stringify(targetState)) {
        isLocked = true;
        score++; updateScoreCb(score);
        
        if (!window.isMultiplayer) roundStartAtGlobal = Date.now(); // Reset Solo Timer
        
        // Flash the whole board green!
        let iBoard = document.getElementById('cups-interactive-board');
        if (iBoard) iBoard.style.boxShadow = 'inset 0 0 40px var(--completed-green)';
        
        setTimeout(() => {
            if (iBoard) iBoard.style.boxShadow = 'inset 0 0 20px rgba(0,0,0,0.5)';
            isLocked = false;
            generatePuzzle();
        }, 800);
    } else {
        isLocked = false; // Let them keep trying!
    }
}