// game_fifteen.js

let score = 0;
let timerInterval = null;
let updateScoreCb, updateTimerCb, gameOverCb, containerRef;

const solvedState = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, null];
let board = [];
let emptyIdx = 15;

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
// ------------------------------

export function start(gameId, container, onScore, onTimer, onGameOver, multiSeed = null, rStart = null) {
    containerRef = container; updateScoreCb = onScore; updateTimerCb = onTimer; gameOverCb = onGameOver;
    currentSeed = multiSeed;
    
    roundStartAtGlobal = rStart || Date.now();
    lastTickTime = Date.now();
    isLocked = false;

    score = 0; updateScoreCb(score); 

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <p style="color: white; margin-bottom: 20px;">Slide the tiles to order them 1 through 15!</p>
            <div id="fifteen-board" style="display: grid; grid-template-columns: repeat(4, 65px); gap: 5px; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 8px; border: 1px solid var(--locked-grey);"></div>
        </div>
    `;

    timerInterval = setInterval(tick, 1000);
    tick();
    generateBoard();
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
    updateTimerCb(`⏱️ ${elapsed}s`, "var(--completed-green)");
}

export function restoreUI(container) {
    containerRef = container;
    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <p style="color: white; margin-bottom: 20px;">Slide the tiles to order them 1 through 15!</p>
            <div id="fifteen-board" style="display: grid; grid-template-columns: repeat(4, 65px); gap: 5px; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 8px; border: 1px solid var(--locked-grey);"></div>
        </div>
    `;
    renderBoard();
}

function generateBoard() {
    board = [...solvedState];
    emptyIdx = 15;

    for (let i = 0; i < 250; i++) {
        let validMoves = [];
        if (emptyIdx % 4 !== 0) validMoves.push(emptyIdx - 1); 
        if (emptyIdx % 4 !== 3) validMoves.push(emptyIdx + 1); 
        if (emptyIdx >= 4) validMoves.push(emptyIdx - 4);      
        if (emptyIdx <= 11) validMoves.push(emptyIdx + 4);     
        
        let move = validMoves[Math.floor(getRand() * validMoves.length)];
        board[emptyIdx] = board[move];
        board[move] = null;
        emptyIdx = move;
    }
    renderBoard();
}

function renderBoard() {
    const boardEl = document.getElementById('fifteen-board'); if (!boardEl) return;
    boardEl.innerHTML = '';
    
    board.forEach((val, i) => {
        let btn = document.createElement('button');
        btn.style.width = '65px'; btn.style.height = '65px'; btn.style.fontSize = '24px'; btn.style.fontWeight = 'bold'; btn.style.borderRadius = '8px'; btn.style.transition = '0.1s';
        
        const bindTap = (button, action) => {
            button.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, {passive: false});
            button.addEventListener('mousedown', (e) => { e.preventDefault(); action(); });
        };
        
        if (val === null) { btn.style.background = 'transparent'; btn.style.border = 'none'; btn.style.cursor = 'default'; } 
        else {
            btn.style.background = 'rgba(255,255,255,0.1)'; btn.style.border = '2px solid var(--accent-color)'; btn.style.color = 'white'; btn.style.cursor = 'pointer'; btn.innerText = val;
            bindTap(btn, () => moveTile(i));
        }
        boardEl.appendChild(btn);
    });
}

function moveTile(i) {
    if (isLocked) return;
    let isAdjacent = (i === emptyIdx - 1 && emptyIdx % 4 !== 0) || (i === emptyIdx + 1 && emptyIdx % 4 !== 3) || (i === emptyIdx - 4) || (i === emptyIdx + 4);
    if (isAdjacent) {
        board[emptyIdx] = board[i]; board[i] = null; emptyIdx = i;
        renderBoard(); checkWin();
    }
}

function checkWin() {
    if (JSON.stringify(board) === JSON.stringify(solvedState)) {
        isLocked = true;
        let elapsed = Math.floor((Date.now() - roundStartAtGlobal) / 1000);
        // Formula: A 10 second solve gives 990 points. A 50 second solve gives 950. Fastest time wins!
        score = Math.max(1, 1000 - elapsed); 
        updateScoreCb(score);
        cleanup();
        setTimeout(() => gameOverCb(score), 500); 
    }
}