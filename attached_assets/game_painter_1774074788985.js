// game_painter.js
// "Neon Grid" - Spatial Layers Puzzle

let score = 0;
let timeLeft = 0;
let timerInterval = null;
let containerRef = null;
let updateScoreCb, updateTimerCb, gameOverCb;

// Game State
let gridSize = 3; 
let complexity = 4;
let targetGrid = [];
let playerGrid = [];
let rowColors = [];
let colColors = [];

const NEON_COLORS = ['#0ea5e9', '#ec4899', '#eab308', '#22c55e', '#a855f7'];

// --- MULTIPLAYER & SMART PAUSE LOGIC ---
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
// ------------------------------

export function start(gameId, container, onScore, onTimer, onGameOver, multiSeed = null, rStart = null, startScore = 0) {
    containerRef = container; updateScoreCb = onScore; updateTimerCb = onTimer; gameOverCb = onGameOver;
    currentSeed = multiSeed;
    
    roundStartAtGlobal = rStart || Date.now();
    lastTickTime = Date.now();
    score = startScore || 0;
    
    // Scale difficulty based on score for Solo Practice
    gridSize = window.isMultiplayer ? 4 : Math.min(5, 3 + Math.floor(score / 3));
    complexity = gridSize + 2; 

    updateScoreCb(score);

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center; touch-action: none;">
            <div style="color: #94a3b8; font-weight: bold; margin-bottom: 5px; font-size: 14px; letter-spacing: 2px;">TARGET PATTERN</div>
            <div id="neon-target-board" style="display: grid; gap: 2px; margin-bottom: 20px; border: 2px solid var(--locked-grey); padding: 3px; border-radius: 6px; background: rgba(0,0,0,0.5);"></div>
            <div style="color: white; font-size: 14px; margin-bottom: 10px;">Fire the lasers in the correct order to match!</div>
            <div id="neon-interactive-board" style="display: grid; gap: 5px; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 12px; border: 1px solid var(--locked-grey); box-shadow: inset 0 0 20px rgba(0,0,0,0.5);"></div>
        </div>
    `;

    timerInterval = setInterval(tick, 1000);
    tick(); // Run immediately
    generatePuzzle();
}

export function cleanup() { clearInterval(timerInterval); }

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
    let totalTime = window.isMultiplayer ? 120 : 45; // 2 mins for Multi Race, 45s for Solo Survival
    
    timeLeft = totalTime - elapsed;
    
    updateTimerCb(`⏱️ ${Math.max(0, timeLeft)}s`, "var(--boss-red)");
    if (timeLeft <= 0) { cleanup(); gameOverCb(score); }
}

function generatePuzzle() {
    // 1. Assign random colors to the Laser Emitters
    rowColors = []; colColors = [];
    for(let i=0; i<gridSize; i++) {
        rowColors.push(NEON_COLORS[Math.floor(getRand() * NEON_COLORS.length)]);
        colColors.push(NEON_COLORS[Math.floor(getRand() * NEON_COLORS.length)]);
    }

    // 2. Clear boards
    targetGrid = Array(gridSize).fill().map(() => Array(gridSize).fill('transparent'));
    playerGrid = Array(gridSize).fill().map(() => Array(gridSize).fill('transparent'));

    // 3. Simulate chronological laser fires to build the target
    for(let i=0; i<complexity; i++) {
        let isRow = getRand() > 0.5;
        let idx = Math.floor(getRand() * gridSize);
        if (isRow) {
            let color = rowColors[idx];
            for(let c=0; c<gridSize; c++) targetGrid[idx][c] = color;
        } else {
            let color = colColors[idx];
            for(let r=0; r<gridSize; r++) targetGrid[r][idx] = color;
        }
    }

    renderUI();
}

export function restoreUI(container) { renderUI(); }

function renderUI() {
    // Render Target Mini-Board
    const tBoard = document.getElementById('neon-target-board');
    if (tBoard) {
        tBoard.style.gridTemplateColumns = `repeat(${gridSize}, 15px)`;
        tBoard.innerHTML = '';
        for(let r=0; r<gridSize; r++) {
            for(let c=0; c<gridSize; c++) {
                let cell = document.createElement('div');
                cell.style.width = '15px'; cell.style.height = '15px'; cell.style.borderRadius = '2px';
                cell.style.background = targetGrid[r][c] === 'transparent' ? '#1e293b' : targetGrid[r][c];
                tBoard.appendChild(cell);
            }
        }
    }

    // Render Interactive Board + Lasers
    const iBoard = document.getElementById('neon-interactive-board');
    if (!iBoard) return;
    
    // Grid Size + 1 extra column/row for the lasers
    iBoard.style.gridTemplateColumns = `repeat(${gridSize}, 50px) 60px`;
    iBoard.innerHTML = '';

    const bindTap = (btn, action) => {
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, {passive: false});
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); action(); });
    };

    for(let r=0; r <= gridSize; r++) {
        for(let c=0; c <= gridSize; c++) {
            let cell = document.createElement('div');
            
            if (r < gridSize && c < gridSize) {
                // Main Playable Grid
                cell.style.width = '50px'; cell.style.height = '50px'; cell.style.borderRadius = '6px';
                cell.style.transition = 'background 0.2s';
                cell.style.border = '1px solid #334155';
                
                let color = playerGrid[r][c];
                if (color !== 'transparent') {
                    cell.style.background = color;
                    cell.style.boxShadow = `0 0 10px ${color}80`;
                    cell.style.borderColor = color;
                } else {
                    cell.style.background = 'transparent';
                }
            } 
            else if (r < gridSize && c === gridSize) {
                // ROW LASERS (Right Edge)
                let color = rowColors[r];
                cell.style.width = '60px'; cell.style.height = '50px'; cell.style.borderRadius = '8px';
                cell.style.border = `2px solid ${color}`; cell.style.color = color;
                cell.style.display = 'flex'; cell.style.alignItems = 'center'; cell.style.justifyContent = 'center';
                cell.style.cursor = 'pointer'; cell.style.fontWeight = 'bold'; cell.style.background = '#020617';
                cell.innerHTML = '🡠'; 
                bindTap(cell, () => fireLaser('row', r, color));
            }
            else if (r === gridSize && c < gridSize) {
                // COL LASERS (Bottom Edge)
                let color = colColors[c];
                cell.style.width = '50px'; cell.style.height = '60px'; cell.style.borderRadius = '8px';
                cell.style.border = `2px solid ${color}`; cell.style.color = color;
                cell.style.display = 'flex'; cell.style.alignItems = 'center'; cell.style.justifyContent = 'center';
                cell.style.cursor = 'pointer'; cell.style.fontWeight = 'bold'; cell.style.background = '#020617';
                cell.innerHTML = '🡡';
                bindTap(cell, () => fireLaser('col', c, color));
            }
            else if (r === gridSize && c === gridSize) {
                // RESET BUTTON (Bottom Right Corner)
                cell.style.width = '60px'; cell.style.height = '60px'; cell.style.borderRadius = '8px';
                cell.style.background = 'var(--boss-red)'; cell.style.color = 'white';
                cell.style.display = 'flex'; cell.style.alignItems = 'center'; cell.style.justifyContent = 'center';
                cell.style.cursor = 'pointer'; cell.style.fontSize = '24px';
                cell.innerHTML = '↺';
                bindTap(cell, () => {
                    playerGrid = Array(gridSize).fill().map(() => Array(gridSize).fill('transparent'));
                    renderUI();
                });
            }
            
            iBoard.appendChild(cell);
        }
    }
}

function fireLaser(type, index, color) {
    if (type === 'row') {
        for(let c=0; c<gridSize; c++) playerGrid[index][c] = color;
    } else {
        for(let r=0; r<gridSize; r++) playerGrid[r][index] = color;
    }
    renderUI();
    checkWin();
}

function checkWin() {
    for(let r=0; r<gridSize; r++) {
        for(let c=0; c<gridSize; c++) {
            if(playerGrid[r][c] !== targetGrid[r][c]) return; // Not a match yet
        }
    }
    
    // PERFECT MATCH!
    if (window.isMultiplayer) {
        score = 1; updateScoreCb(score);
        cleanup(); setTimeout(() => gameOverCb(score), 500); // Win the Race!
    } else {
        score++; updateScoreCb(score);
        roundStartAtGlobal = Date.now(); // Reset the 45s timer for the next level
        setTimeout(generatePuzzle, 600);
    }
}