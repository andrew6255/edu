// game_blockpuzzle.js

let score = 0;
let updateScoreCb, updateTimerCb, gameOverCb, containerRef;
let timerInterval = null;

const GRID_SIZE = 8;
let grid = [];
let hand = [];
let selectedHandIdx = -1;

// Drag & Drop State
let isDragging = false;
let dragGhost = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let ptrMoveRef = null;
let ptrUpRef = null;

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

const SHAPE_LIBRARY = [
    { shape: [[1]], weight: 25 }, { shape: [[1,1]], weight: 20 }, { shape: [[1],[1]], weight: 20 }, { shape: [[1,1],[1,1]], weight: 15 }, { shape: [[1,1,1]], weight: 15 }, { shape: [[1],[1],[1]], weight: 15 }, { shape: [[1,1,1,1]], weight: 10 }, { shape: [[1],[1],[1],[1]], weight: 10 }, { shape: [[1,1],[1,0]], weight: 12 }, { shape: [[1,1],[0,1]], weight: 12 }, { shape: [[1,1,1],[1,0,0],[1,0,0]], weight: 8 }, { shape: [[1,1,1],[0,0,1],[0,0,1]], weight: 8 }, { shape: [[1,1,1],[0,1,0]], weight: 10 }, { shape: [[1,1,0],[0,1,1]], weight: 8 }, { shape: [[0,1,1],[1,1,0]], weight: 8 }, { shape: [[1,1,1,1,1]], weight: 4 }, { shape: [[1],[1],[1],[1],[1]], weight: 4 }, { shape: [[1,1,1],[1,1,1],[1,1,1]], weight: 2 } 
];

export function start(gameId, container, onScore, onTimer, onGameOver, multiSeed = null, rStart = null, startScore = 0) {
    containerRef = container; updateScoreCb = onScore; updateTimerCb = onTimer; gameOverCb = onGameOver;
    currentSeed = multiSeed;
    
    roundStartAtGlobal = rStart || Date.now();
    lastTickTime = Date.now();
    isLocked = false;
    
    score = startScore || 0; 
    grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
    
    updateScoreCb(score); 

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center; touch-action: none;">
            <p style="color: #94a3b8; margin-bottom: 10px; font-size: 14px; text-align: center;">Drag a shape and drop it on the board!</p>
            <div id="combo-text" style="color: var(--accent-color); height: 24px; font-weight: bold; font-size: 18px; margin-bottom: 10px; text-shadow: 0 0 10px rgba(59, 130, 246, 0.5);"></div>
            <div id="bp-grid" style="display: grid; grid-template-columns: repeat(8, 35px); gap: 2px; background: rgba(0,0,0,0.8); border: 2px solid var(--locked-grey); padding: 4px; margin-bottom: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.5); border-radius: 8px;"></div>
            <div id="bp-hand" style="display: flex; gap: 15px; justify-content: center; min-height: 100px; align-items: center; width: 100%; flex-wrap: wrap;"></div>
        </div>
    `;

    timerInterval = setInterval(tick, 1000);
    tick();
    fillHand();
    renderGrid();

    ptrMoveRef = (e) => handlePointerMove(e); ptrUpRef = (e) => handlePointerUp(e);
    window.addEventListener('pointermove', ptrMoveRef, {passive: false});
    window.addEventListener('pointerup', ptrUpRef);
    window.addEventListener('touchmove', preventScroll, {passive: false});
}

export function cleanup() { 
    clearInterval(timerInterval);
    if (ptrMoveRef) window.removeEventListener('pointermove', ptrMoveRef);
    if (ptrUpRef) window.removeEventListener('pointerup', ptrUpRef);
    window.removeEventListener('touchmove', preventScroll);
    if (dragGhost && dragGhost.parentNode) dragGhost.parentNode.removeChild(dragGhost);
    isDragging = false; dragGhost = null;
}

function tick() {
    if (!window.isMultiplayer) {
        updateTimerCb(`⏱️ ∞`, "var(--completed-green)");
        return;
    }
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
    let timeLeft = 120 - elapsed; 
    
    updateTimerCb(`⏱️ ${Math.max(0, timeLeft)}s`, "var(--boss-red)");
    if (timeLeft <= 0) { isLocked = true; cleanup(); gameOverCb(score); }
}

export function restoreUI(container) {
    containerRef = container;
    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center; touch-action: none;">
            <p style="color: #94a3b8; margin-bottom: 10px; font-size: 14px; text-align: center;">Drag a shape and drop it on the board!</p>
            <div id="combo-text" style="color: var(--accent-color); height: 24px; font-weight: bold; font-size: 18px; margin-bottom: 10px; text-shadow: 0 0 10px rgba(59, 130, 246, 0.5);"></div>
            <div id="bp-grid" style="display: grid; grid-template-columns: repeat(8, 35px); gap: 2px; background: rgba(0,0,0,0.8); border: 2px solid var(--locked-grey); padding: 4px; margin-bottom: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.5); border-radius: 8px;"></div>
            <div id="bp-hand" style="display: flex; gap: 15px; justify-content: center; min-height: 100px; align-items: center; width: 100%; flex-wrap: wrap;"></div>
        </div>
    `;
    renderGrid();
    renderHand();
}

function preventScroll(e) { if (isDragging) e.preventDefault(); }

function getRandomShape() {
    let totalWeight = SHAPE_LIBRARY.reduce((sum, item) => sum + item.weight, 0);
    let rand = getRand() * totalWeight;
    for (let item of SHAPE_LIBRARY) {
        if (rand < item.weight) return item.shape;
        rand -= item.weight;
    }
    return SHAPE_LIBRARY[0].shape;
}

function fillHand() {
    hand = []; for (let i = 0; i < 3; i++) hand.push(getRandomShape());
    selectedHandIdx = -1; renderHand(); checkGameOverState();
}

function renderHand() {
    const handEl = document.getElementById('bp-hand'); if (!handEl) return;
    handEl.innerHTML = '';

    hand.forEach((shape, idx) => {
        if (!shape) { let emptyDiv = document.createElement('div'); emptyDiv.style.width = '60px'; handEl.appendChild(emptyDiv); return; }

        let shapeDiv = document.createElement('div'); shapeDiv.style.display = 'grid'; shapeDiv.style.gridTemplateColumns = `repeat(${shape[0].length}, 15px)`; shapeDiv.style.gap = '2px'; shapeDiv.style.cursor = 'grab'; shapeDiv.style.padding = '8px'; shapeDiv.style.background = 'rgba(0,0,0,0.5)'; shapeDiv.style.border = '2px solid var(--locked-grey)'; shapeDiv.style.borderRadius = '8px'; shapeDiv.style.touchAction = 'none'; 

        shape.forEach(row => { row.forEach(cell => { let block = document.createElement('div'); block.style.width = '15px'; block.style.height = '15px'; block.style.background = cell ? 'var(--accent-color)' : 'transparent'; block.style.borderRadius = '2px'; shapeDiv.appendChild(block); }); });

        shapeDiv.onpointerdown = (e) => {
            if (isLocked) return;
            e.preventDefault(); isDragging = true; selectedHandIdx = idx;
            dragGhost = shapeDiv.cloneNode(true); dragGhost.style.position = 'fixed'; dragGhost.style.pointerEvents = 'none'; dragGhost.style.zIndex = '9999'; dragGhost.style.margin = '0'; dragGhost.style.border = '2px solid var(--completed-green)'; dragGhost.style.background = 'transparent'; dragGhost.style.gridTemplateColumns = `repeat(${shape[0].length}, 35px)`;
            Array.from(dragGhost.children).forEach(child => { child.style.width = '35px'; child.style.height = '35px'; if (child.style.background !== 'transparent') child.style.background = 'var(--completed-green)'; });
            document.body.appendChild(dragGhost);
            dragOffsetX = (shape[0].length * 35) / 2; dragOffsetY = 80; 
            handlePointerMove(e); shapeDiv.style.opacity = '0.2'; 
        };
        handEl.appendChild(shapeDiv);
    });
}

function renderGrid() {
    const gridEl = document.getElementById('bp-grid'); if (!gridEl) return;
    gridEl.innerHTML = '';
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            let cell = document.createElement('div'); cell.dataset.row = r; cell.dataset.col = c;
            cell.style.width = '35px'; cell.style.height = '35px'; cell.style.background = grid[r][c] ? 'var(--completed-green)' : 'rgba(255,255,255,0.05)';
            if (grid[r][c]) { cell.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.5)'; cell.style.border = '1px solid #059669'; }
            cell.style.borderRadius = '4px'; gridEl.appendChild(cell);
        }
    }
}

function handlePointerMove(e) { if (!isDragging || !dragGhost) return; dragGhost.style.left = (e.clientX - dragOffsetX) + 'px'; dragGhost.style.top = (e.clientY - dragOffsetY) + 'px'; }

function handlePointerUp(e) {
    if (!isDragging) return; isDragging = false;
    let placed = false;
    if (dragGhost) {
        let rect = dragGhost.getBoundingClientRect(); dragGhost.style.display = 'none'; 
        let targetX = rect.left + 17.5; let targetY = rect.top + 17.5;
        let target = document.elementFromPoint(targetX, targetY);
        if (target && target.dataset && target.dataset.row) {
            let r = parseInt(target.dataset.row); let c = parseInt(target.dataset.col);
            placed = attemptPlacement(r, c);
        }
        document.body.removeChild(dragGhost); dragGhost = null;
    }
    if (!placed) { selectedHandIdx = -1; renderHand(); }
}

function attemptPlacement(startRow, startCol) {
    if (selectedHandIdx === -1 || !hand[selectedHandIdx] || isLocked) return false;
    let shape = hand[selectedHandIdx];
    
    for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[0].length; c++) {
            if (shape[r][c] === 1) {
                let targetR = startRow + r; let targetC = startCol + c;
                if (targetR >= GRID_SIZE || targetC >= GRID_SIZE || grid[targetR][targetC] === 1) return false; 
            }
        }
    }

    let placedBlocks = 0;
    for (let r = 0; r < shape.length; r++) { for (let c = 0; c < shape[0].length; c++) { if (shape[r][c] === 1) { grid[startRow + r][startCol + c] = 1; placedBlocks++; } } }
    score += placedBlocks; 

    hand[selectedHandIdx] = null; selectedHandIdx = -1;
    clearLines(); renderGrid();
    
    if (hand.every(s => s === null)) fillHand(); else { renderHand(); checkGameOverState(); }
    return true;
}

function clearLines() {
    let linesToClearR = []; let linesToClearC = [];

    for (let i = 0; i < GRID_SIZE; i++) {
        let rowFull = true; let colFull = true;
        for (let j = 0; j < GRID_SIZE; j++) { if (grid[i][j] === 0) rowFull = false; if (grid[j][i] === 0) colFull = false; }
        if (rowFull) linesToClearR.push(i); if (colFull) linesToClearC.push(i);
    }

    let totalLines = linesToClearR.length + linesToClearC.length;

    if (totalLines > 0) {
        linesToClearR.forEach(r => { for (let c = 0; c < GRID_SIZE; c++) grid[r][c] = 0; });
        linesToClearC.forEach(c => { for (let r = 0; r < GRID_SIZE; r++) grid[r][c] = 0; });

        let comboMultiplier = totalLines; let earned = (totalLines * 20) * comboMultiplier;
        score += earned; updateScoreCb(score);
        
        let comboEl = document.getElementById('combo-text');
        if (comboEl) {
            if (totalLines > 1) comboEl.innerText = `🔥 ${totalLines}x COMBO! +${earned} pts`;
            else comboEl.innerText = `Line Cleared! +${earned} pts`;
            setTimeout(() => { if (comboEl.innerText.includes(earned)) comboEl.innerText = ""; }, 2000);
        }
    } else { updateScoreCb(score); }
}

function checkGameOverState() {
    let canMove = false;
    for (let h of hand) {
        if (!h) continue;
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                let fits = true;
                for (let sr = 0; sr < h.length; sr++) { for (let sc = 0; sc < h[0].length; sc++) { if (h[sr][sc] === 1) { if (r + sr >= GRID_SIZE || c + sc >= GRID_SIZE || grid[r + sr][c + sc] === 1) fits = false; } } }
                if (fits) canMove = true;
            }
        }
    }
    
    if (!canMove && !hand.every(s => s === null)) {
        isLocked = true;
        setTimeout(() => gameOverCb(score), 800);
    }
}