// module_chess.js
// Handles Games: chessNameSurvival, chessNameSpeed, chessFindSurvival, chessFindSpeed, chessMemory

let activeGame = "";
let score = 0;
let timeLeft = 0;
let timerInterval = null;
let containerRef = null;

let updateScoreCb, updateTimerCb, gameOverCb;

const FILES = ['a','b','c','d','e','f','g','h'];
const RANKS = ['8','7','6','5','4','3','2','1']; 
const PIECES = ['♙','♘','♗','♖','♕','♔','♟','♞','♝','♜','♛','♚'];

// Game State
let targetSquare = ""; 
let typedInput = ""; 
let isLocked = false;

// Memory Game State
let memoryLevel = 1; 
let memoPhase = false;
let targetPositions = {}; 
let playerPositions = {}; 
let selectedBankPiece = null;

// --- MULTIPLAYER & RECONNECT LOGIC ---
let currentSeed = null;
let roundStartAtGlobal = null;
let lastTickTime = 0;

function getRand() {
    if (currentSeed === null) return Math.random();
    let t = currentSeed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

export function start(gameId, container, onScore, onTimer, onGameOver, multiSeed = null, rStart = null, startScore = 0) {
    activeGame = gameId; containerRef = container; updateScoreCb = onScore; updateTimerCb = onTimer; gameOverCb = onGameOver;
    currentSeed = multiSeed;

    roundStartAtGlobal = rStart || Date.now();
    lastTickTime = Date.now();
    score = startScore || 0;
    isLocked = false;
    typedInput = "";
    updateScoreCb(score);

    if (activeGame === 'chessMemory') {
        memoryLevel = 1;
        updateTimerCb(`Level ${memoryLevel}`, "var(--accent-blue)");
    }
    
    timerInterval = setInterval(tick, 1000);
    nextRound();
    tick(); 
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

    if (activeGame === 'chessMemory') {
        if (memoPhase) {
            let mLeft = 5 - elapsed;
            updateTimerCb(`👁️ Memorize: ${Math.max(0, mLeft)}s`, "var(--accent-blue)");
            if (mLeft <= 0) {
                memoPhase = false;
                updateTimerCb(`🧠 Reconstruct!`, "var(--completed-green)");
                renderGameUI(); 
            }
        }
        return;
    }

    if (activeGame.includes('Speed')) {
        let tLeft = 60 - elapsed;
        updateTimerCb(`⏱️ ${Math.max(0, tLeft)}s`, "var(--boss-red)");
        if (tLeft <= 0) { isLocked = true; cleanup(); gameOverCb(score); }
    } else if (activeGame.includes('Survival')) {
        let tLeft = 5 - elapsed;
        updateTimerCb(`⏱️ ${Math.max(0, tLeft)}s`, "var(--boss-red)");
        if (tLeft <= 0) { isLocked = true; cleanup(); gameOverCb(score); }
    }
}

function nextRound() {
    typedInput = "";
    if (activeGame === 'chessMemory') {
        memoPhase = true;
        roundStartAtGlobal = Date.now(); 
        targetPositions = {}; playerPositions = {}; selectedBankPiece = null;
        
        let numPieces = 2 + Math.ceil(memoryLevel / 2);
        for (let i = 0; i < numPieces; i++) {
            let randSq, randPiece;
            do { randSq = FILES[Math.floor(getRand() * 8)] + RANKS[Math.floor(getRand() * 8)]; } while (targetPositions[randSq]); 
            randPiece = PIECES[Math.floor(getRand() * PIECES.length)];
            targetPositions[randSq] = randPiece;
        }
        updateTimerCb(`👁️ Memorize: 5s`, "var(--accent-blue)");
    } else {
        targetSquare = FILES[Math.floor(getRand() * 8)] + RANKS[Math.floor(getRand() * 8)];
    }
    renderGameUI();
}

function handleCorrect() {
    if (isLocked) return;
    score++; updateScoreCb(score);
    if (activeGame.includes('Survival')) {
        roundStartAtGlobal = Date.now(); 
        updateTimerCb(`⏱️ 5s`, "var(--boss-red)");
    } else if (activeGame === 'chessMemory') { memoryLevel++; }
    nextRound();
}

function handleWrong() {
    if (isLocked) return;
    if (activeGame.includes('Speed')) {
        score = Math.max(0, score - 1); updateScoreCb(score);
        nextRound(); 
    } else {
        isLocked = true; cleanup(); gameOverCb(score);
    }
}

export function restoreUI(container) { containerRef = container; renderGameUI(); }

function renderGameUI() {
    if (!containerRef) return;
    let html = `<div style="display: flex; flex-direction: column; align-items: center; width: 100%;">`;
    
    if (activeGame.includes('Name')) {
        html += `<div style="font-size: 20px; font-weight: bold; margin-bottom: 15px; color: var(--accent-blue);">Name this square: <span style="color:white; letter-spacing: 2px;">${typedInput.padEnd(2, '_')}</span></div>`;
    } else if (activeGame.includes('Find')) {
        html += `<div style="font-size: 20px; font-weight: bold; margin-bottom: 15px; color: white;">Find square: <span style="color: var(--accent-blue); font-size: 24px;">${targetSquare}</span></div>`;
    }

    html += `<div style="display: grid; grid-template-columns: 20px repeat(8, minmax(35px, 45px)); gap: 0; border: 2px solid #334155; background: #0f172a; box-shadow: 0 5px 15px rgba(0,0,0,0.5);">`;
    for(let r=0; r<8; r++) {
        html += `<div style="display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold; color: #94a3b8;">${RANKS[r]}</div>`;
        for(let c=0; c<8; c++) {
            let sq = FILES[c] + RANKS[r]; let isLight = (r + c) % 2 === 0; let bgColor = isLight ? '#f0d9b5' : '#b58863';
            if (activeGame.includes('Name') && sq === targetSquare) bgColor = 'var(--accent-blue)';
            
            let pieceHtml = "";
            if (activeGame === 'chessMemory') {
                if (memoPhase && targetPositions[sq]) pieceHtml = targetPositions[sq];
                else if (!memoPhase && playerPositions[sq]) pieceHtml = playerPositions[sq];
            }

            let clickAttr = "";
            if (!isLocked) {
                if (activeGame.includes('Find')) clickAttr = `onclick="handleSquareClick('${sq}')"`;
                if (activeGame === 'chessMemory' && !memoPhase) clickAttr = `onclick="handleMemorySquare('${sq}')"`;
            }

            html += `<div ${clickAttr} style="background: ${bgColor}; display: flex; align-items: center; justify-content: center; font-size: 30px; height: 100%; aspect-ratio: 1; cursor: pointer; user-select: none; color: black;">${pieceHtml}</div>`;
        }
    }
    html += `<div></div>`;
    for(let c=0; c<8; c++) html += `<div style="display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold; color: #94a3b8; padding: 5px 0;">${FILES[c]}</div>`;
    html += `</div>`; 

    if (activeGame.includes('Name')) html += renderNumpad();
    else if (activeGame === 'chessMemory' && !memoPhase) html += renderPieceBank();

    html += `</div>`;
    containerRef.innerHTML = html;

    window.handleNumpad = function(char) {
        if (isLocked) return;
        if (char === 'DEL') { typedInput = ""; renderGameUI(); return; }
        typedInput += char; renderGameUI();
        if (typedInput.length === 2) { if (typedInput === targetSquare) handleCorrect(); else handleWrong(); }
    };
    window.handleSquareClick = function(sq) { if (!isLocked) { if (sq === targetSquare) handleCorrect(); else handleWrong(); } };
    window.handleBankSelect = function(piece) { if (!isLocked && !memoPhase) { selectedBankPiece = piece; renderGameUI(); } };
    window.handleMemorySquare = function(sq) {
        if (isLocked || memoPhase) return;
        if (selectedBankPiece) { playerPositions[sq] = selectedBankPiece; selectedBankPiece = null; } 
        else if (playerPositions[sq]) { delete playerPositions[sq]; }
        renderGameUI();
    };
    window.submitMemory = function() {
        if (isLocked || memoPhase) return;
        let targetKeys = Object.keys(targetPositions); let playerKeys = Object.keys(playerPositions);
        if (targetKeys.length !== playerKeys.length) return handleWrong();
        for (let key of targetKeys) { if (targetPositions[key] !== playerPositions[key]) return handleWrong(); }
        handleCorrect();
    };
}

function renderNumpad() {
    let keysHtml = `<div style="display: flex; flex-direction: column; gap: 8px; margin-top: 20px;"><div style="display: flex; gap: 6px; justify-content: center;">`;
    FILES.forEach(f => { keysHtml += `<button onclick="handleNumpad('${f}')" style="padding: 10px 14px; font-size: 16px; font-weight: bold; background: var(--bg-card); color: white; border: 1px solid var(--accent-blue); border-radius: 6px; cursor: pointer;">${f}</button>`; });
    keysHtml += `</div><div style="display: flex; gap: 6px; justify-content: center;">`;
    [...RANKS].reverse().forEach(r => { keysHtml += `<button onclick="handleNumpad('${r}')" style="padding: 10px 14px; font-size: 16px; font-weight: bold; background: var(--bg-card); color: white; border: 1px solid var(--accent-blue); border-radius: 6px; cursor: pointer;">${r}</button>`; });
    keysHtml += `<button onclick="handleNumpad('DEL')" style="padding: 10px 14px; font-size: 16px; font-weight: bold; background: var(--boss-red); color: white; border: none; border-radius: 6px; cursor: pointer;">DEL</button></div></div>`;
    return keysHtml;
}

function renderPieceBank() {
    let bankHtml = `<div style="display: flex; flex-direction: column; gap: 15px; margin-top: 20px; align-items: center;"><div style="display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; max-width: 350px;">`;
    PIECES.forEach(p => {
        let isSelected = (selectedBankPiece === p) ? 'border-color: var(--accent-blue); background: rgba(59, 130, 246, 0.2);' : 'border-color: #475569; background: var(--bg-card);';
        bankHtml += `<button onclick="handleBankSelect('${p}')" style="font-size: 28px; width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; color: white; border: 2px solid; border-radius: 8px; cursor: pointer; ${isSelected}">${p}</button>`;
    });
    bankHtml += `</div><button onclick="submitMemory()" style="padding: 12px 30px; font-size: 18px; font-weight: bold; background: var(--completed-green); color: white; border: none; border-radius: 6px; cursor: pointer;">Submit Position</button></div>`;
    return bankHtml;
}