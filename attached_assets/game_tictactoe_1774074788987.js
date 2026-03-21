// game_tictactoe.js

import { getFirestore, doc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
const db = getFirestore();
let currentUserId = localStorage.getItem('logicLordsGuestId') || localStorage.getItem('logicLordsUserId');

let score = 0;
let timerInterval = null;
let board = Array(9).fill(null);
let isLocked = false;
let updateScoreCb, updateTimerCb, gameOverCb, containerRef;

// 1v1 Networking State
let isReal1v1 = false;
let amIPlayer1 = true;
let myMarker = 'X';
let isMyTurn = true;
let boardListener = null;

// --- RECONNECT LOGIC ---
let roundStartAtGlobal = null;
let lastTickTime = 0;

export function start(gameId, container, onScore, onTimer, onGameOver, multiSeed = null, rStart = null, startScore = 0) {
    containerRef = container; updateScoreCb = onScore; updateTimerCb = onTimer; gameOverCb = onGameOver;
    roundStartAtGlobal = rStart || Date.now();
    lastTickTime = Date.now();
    score = startScore || 0; 
    updateScoreCb(score); 

    isReal1v1 = window.isMultiplayer && window.opponentData && !window.opponentData.isAI;
    let vsText = isReal1v1 ? "1v1: Win the board to win the round!" : (window.isMultiplayer ? "Beat the AI to win the round!" : "Beat the AI as many times as you can!");

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <p style="color: white; margin-bottom: 5px; font-size: 18px; text-align: center;">${vsText}</p>
            <p id="ttt-turn-text" style="color: var(--accent-blue); font-weight: bold; margin-bottom: 15px; height: 20px;">Loading...</p>
            <div id="ttt-board" style="display: grid; grid-template-columns: repeat(3, 100px); gap: 10px;"></div>
        </div>
    `;

    timerInterval = setInterval(tick, 1000);
    tick();

    if (isReal1v1) {
        amIPlayer1 = window.currentMatchId ? (window.opponentData.id !== currentUserId) : true;
        myMarker = amIPlayer1 ? 'X' : 'O';
        isLocked = true; 
        
        if (amIPlayer1) updateDoc(doc(db, "matchmaking", window.currentMatchId), { tBoard: Array(9).fill(null), tTurn: 'X' }).catch(()=>{});

        boardListener = onSnapshot(doc(db, "matchmaking", window.currentMatchId), (docSnap) => {
            if (!docSnap.exists()) return;
            let data = docSnap.data();
            if (data.tBoard) board = data.tBoard;
            if (data.tTurn) {
                isMyTurn = (data.tTurn === myMarker);
                isLocked = !isMyTurn;
                let turnEl = document.getElementById('ttt-turn-text');
                if (turnEl) { turnEl.innerText = isMyTurn ? `Your Turn (${myMarker})` : `Waiting for opponent...`; turnEl.style.color = isMyTurn ? "var(--completed-green)" : "#94a3b8"; }
            }
            render(); check1v1MatchState();
        });
    } else {
        resetBoard();
    }
}

export function cleanup() { 
    clearInterval(timerInterval); 
    if (boardListener) { boardListener(); boardListener = null; }
}

function tick() {
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
    let timeLeft = 60 - elapsed;
    updateTimerCb(`⏱️ ${Math.max(0, timeLeft)}s`, "var(--boss-red)");
    
    if (timeLeft <= 0) { isLocked = true; cleanup(); gameOverCb(window.isMultiplayer ? 0 : score); }
}

export function restoreUI(container) {
    containerRef = container;
    let vsText = isReal1v1 ? "1v1: Win the board to win the round!" : (window.isMultiplayer ? "Beat the AI to win the round!" : "Beat the AI as many times as you can!");
    container.innerHTML = `<div style="width: 100%; display: flex; flex-direction: column; align-items: center;"><p style="color: white; margin-bottom: 5px; font-size: 18px; text-align: center;">${vsText}</p><p id="ttt-turn-text" style="color: var(--accent-blue); font-weight: bold; margin-bottom: 15px; height: 20px;"></p><div id="ttt-board" style="display: grid; grid-template-columns: repeat(3, 100px); gap: 10px;"></div></div>`;
    
    let turnEl = document.getElementById('ttt-turn-text');
    if (isReal1v1) {
        if (turnEl) { turnEl.innerText = isMyTurn ? `Your Turn (${myMarker})` : `Waiting for opponent...`; turnEl.style.color = isMyTurn ? "var(--completed-green)" : "#94a3b8"; }
    } else {
        if (turnEl) { turnEl.innerText = isLocked ? "AI is thinking..." : "Your Turn (X)"; turnEl.style.color = isLocked ? "var(--boss-red)" : "var(--completed-green)"; }
    }
    render();
}

function resetBoard() {
    board = Array(9).fill(null); isLocked = false;
    let turnEl = document.getElementById('ttt-turn-text');
    if (turnEl) { turnEl.innerText = "Your Turn (X)"; turnEl.style.color = "var(--completed-green)"; }
    render();
}

function render() {
    const boardEl = document.getElementById('ttt-board'); if (!boardEl) return;
    boardEl.innerHTML = '';
    
    board.forEach((cell, i) => {
        let btn = document.createElement('button');
        btn.style.width = '100px'; btn.style.height = '100px'; btn.style.fontSize = '48px'; btn.style.fontWeight = 'bold'; btn.style.background = 'rgba(255,255,255,0.1)'; btn.style.border = '2px solid var(--accent-color)'; btn.style.color = cell === 'X' ? 'var(--completed-green)' : 'var(--boss-red)'; btn.style.cursor = 'pointer'; btn.style.borderRadius = '12px'; btn.innerText = cell || '';
        
        const bindTap = (button, action) => { button.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, {passive: false}); button.addEventListener('mousedown', (e) => { e.preventDefault(); action(); }); };
        bindTap(btn, () => playerMove(i)); boardEl.appendChild(btn);
    });
}

function playerMove(i) {
    if (board[i] || isLocked) return;
    
    if (isReal1v1) {
        if (!isMyTurn) return;
        board[i] = myMarker; isLocked = true; render();
        let nextTurn = myMarker === 'X' ? 'O' : 'X';
        updateDoc(doc(db, "matchmaking", window.currentMatchId), { tBoard: board, tTurn: nextTurn }).catch(()=>{});
    } else {
        board[i] = 'X'; isLocked = true; render();
        let turnEl = document.getElementById('ttt-turn-text');
        if (turnEl) { turnEl.innerText = "AI is thinking..."; turnEl.style.color = "var(--boss-red)"; }

        if (checkWin('X')) {
            score++; updateScoreCb(score);
            if (window.isMultiplayer) { setTimeout(() => gameOverCb(1), 800); } else { setTimeout(resetBoard, 800); }
            return;
        }
        if (!board.includes(null)) { setTimeout(resetBoard, 800); return; } 
        setTimeout(aiMove, 400); 
    }
}

function check1v1MatchState() {
    if (checkWin(myMarker)) {
        isLocked = true; if (boardListener) { boardListener(); boardListener = null; }
        score = 1; updateScoreCb(score);
        let turnEl = document.getElementById('ttt-turn-text'); if (turnEl) { turnEl.innerText = "You Won!"; turnEl.style.color = "var(--completed-green)"; }
        setTimeout(() => gameOverCb(1), 800);
    } else if (checkWin(myMarker === 'X' ? 'O' : 'X')) {
        isLocked = true; if (boardListener) { boardListener(); boardListener = null; }
        score = 0; updateScoreCb(score);
        let turnEl = document.getElementById('ttt-turn-text'); if (turnEl) { turnEl.innerText = "You Lost!"; turnEl.style.color = "var(--boss-red)"; }
        setTimeout(() => gameOverCb(0), 800);
    } else if (!board.includes(null)) {
        let turnEl = document.getElementById('ttt-turn-text'); if (turnEl) { turnEl.innerText = "Draw! Replaying..."; turnEl.style.color = "#f59e0b"; }
        if (amIPlayer1) { setTimeout(() => { updateDoc(doc(db, "matchmaking", window.currentMatchId), { tBoard: Array(9).fill(null), tTurn: 'X' }).catch(()=>{}); }, 1000); }
    }
}

function aiMove() {
    let empty = board.map((c, i) => c === null ? i : null).filter(c => c !== null);
    let move = empty[Math.floor(Math.random() * empty.length)]; 
    
    if (Math.random() > 0.3) {
        const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
        for (let w of lines) {
            let pVals = w.map(idx => board[idx]);
            if (pVals.filter(v => v === 'O').length === 2 && pVals.includes(null)) { move = w[pVals.indexOf(null)]; break; }
            if (pVals.filter(v => v === 'X').length === 2 && pVals.includes(null)) { move = w[pVals.indexOf(null)]; break; }
        }
    }

    board[move] = 'O'; render();
    let turnEl = document.getElementById('ttt-turn-text');
    if (turnEl) { turnEl.innerText = "Your Turn (X)"; turnEl.style.color = "var(--completed-green)"; }

    if (checkWin('O')) { 
        if (window.isMultiplayer) { isLocked = true; score = 0; updateScoreCb(score); setTimeout(() => gameOverCb(0), 800); } 
        else { setTimeout(resetBoard, 800); }
        return; 
    } 
    if (!board.includes(null)) { setTimeout(resetBoard, 800); return; } 
    isLocked = false; 
}

function checkWin(p) {
    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    return wins.some(w => board[w[0]]===p && board[w[1]]===p && board[w[2]]===p);
}