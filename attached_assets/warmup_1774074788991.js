import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, orderBy, limit, getDocs, where, addDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = { apiKey: "AIzaSyBaNWmSxGWq3q3G7qm78Aj-npdGTaAy3tM", authDomain: "logiclords-mvp.firebaseapp.com", projectId: "logiclords-mvp" };
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp(); 
const db = getFirestore(app);

let currentUserId = localStorage.getItem('logicLordsGuestId') || localStorage.getItem('logicLordsUserId');

window.isWarmupPlaying = false;
window.selectedWarmupMode = null;
window.hasDeductedGoldThisMatch = false; 

let isMultiplayer = false;
let currentMatchId = null;
let matchListener = null;
let matchTimeout = null;
let opponentData = null;
let matchSeed = 0; 
let matchRoundStartAt = null; 
let hasMatchStarted = false;
let currentCategory = ""; 
let currentRound = 1;

window.botScore = 0;          
window.isRoundActive = false;
window.isEvaluatingRound = false; 
window.amIDeadButBotIsPlaying = false; 
window.isWaitingForOpponentFinish = false;

window.userData = { 
    economy: { gold: 0, global_xp: 0 }, warmup_date: "", played_categories: [], 
    high_scores: { quickMath: 0, timeLimit: 0, numGrid: 0, blockPuzzle: 0, ticTacToe: 0, advQuickMath: 0, compareExp: 0, trueFalse: 0, missingOp: 0, fifteenPuzzle: 0, completeEq: 0, sequence: 0, memoOrder: 0, pyramid: 0, memoCells: 0, chessNameSurvival: 0, chessNameSpeed: 0, chessFindSurvival: 0, chessFindSpeed: 0, chessMemory: 0 } 
};

// ==========================================
// SPA BOOTLOADER & RECONNECT ENGINE
// ==========================================
window.initializeWarmupScreen = async () => {
    if (!currentUserId) { window.location.href = "index.html"; return; }
    await loadWarmupData();
    updateWarmupCardsUI();

    let savedMatchId = localStorage.getItem('activeMatchId');

    // THE FIX: The Bulletproof DOM Rebuild Engine!
    if (window.isWarmupPlaying) {
        document.getElementById('screen-categories').style.display = 'none';
        document.getElementById('screen-games').style.display = 'none';
        let sArena = document.getElementById('screen-arena'); if(sArena) sArena.classList.add('active');
        
        document.getElementById('arena-stats-container').style.display = 'flex';
        document.getElementById('warmup-mode-hint').style.display = 'none';
        document.getElementById('warmup-mode-buttons').style.display = 'none';
        
        // 1. THE CRITICAL BUG FIX: The main game-container MUST NEVER be hidden!
        // It acts as the parent for the multiplayer match-gameplay-area!
        let gc = document.getElementById('game-container'); 
        if(gc) gc.style.display = 'flex'; 
        
        let titleEl = document.getElementById('arena-game-title'); if(titleEl) titleEl.innerText = GAME_INFO[activeGame]?.t || "Logic Game";
        let descEl = document.getElementById('arena-game-desc'); if(descEl) descEl.innerText = GAME_INFO[activeGame]?.d || "Prepare yourself!";
        let scoreEl = document.getElementById('arena-score'); if(scoreEl) { scoreEl.style.display = 'inline'; scoreEl.innerText = `🏆 ${window.currentMatchMyScore || 0}`; }
        let timerEl = document.getElementById('arena-timer'); if(timerEl) timerEl.style.display = 'inline';

        let startBtn = document.getElementById('btn-warmup-start-stop');
        if(startBtn) { 
            startBtn.style.display = 'inline-block'; 
            if (window.isRoundActive) {
                startBtn.className = "btn-action-main btn-stop-active"; 
                startBtn.innerText = window.isMultiplayer ? "GIVE UP ROUND" : "END SESSION"; 
                startBtn.onclick = window.isMultiplayer ? window.giveUpRound : window.toggleWarmupState;
            }
        }

        // 2. Safely rebuild Best of 5 UI FIRST. (This creates 'match-gameplay-area' inside 'game-container')
        if (window.isMultiplayer) {
            if (typeof window.injectBestOf5Tracker === 'function') window.injectBestOf5Tracker(window.opponentData?.name || "Opponent", window.opponentData?.isAI);
            if (typeof window.updateRoundDots === 'function') window.updateRoundDots(window.userData.tempP1Wins || 0, window.userData.tempP2Wins || 0, true);
            if (typeof window.updateTugOfWarBar === 'function') window.updateTugOfWarBar(window.currentMatchMyScore || 0, window.botScore || 0);
        }

        // 3. Grab mga AFTER it is injected!
        let mga = document.getElementById('match-gameplay-area');
        let container = window.isMultiplayer ? mga : gc;

        try {
            if (window.isRoundActive && typeof activeModule !== 'undefined' && activeModule && typeof activeModule.restoreUI === 'function') {
                activeModule.restoreUI(container);
            } else if (!window.isRoundActive) {
                if (window.isMultiplayer) {
                    let p1Wins = window.userData.tempP1Wins || 0; 
                    let p2Wins = window.userData.tempP2Wins || 0;
                    let isMatchOver = p1Wins >= 3 || p2Wins >= 3;

                    if (window.isWaitingForOpponentFinish || window.amIDeadButBotIsPlaying) {
                        let oppName = window.opponentData?.isAI ? "LogicBot 🤖" : "opponent";
                        if(container) container.innerHTML = `<div style="text-align:center; width:100%; margin-top:20px;"><div style="font-size:50px; margin-bottom:20px; animation: pulse 1s infinite alternate;">⏳</div><h2 style="color:white;">Round Complete!</h2><p style="color: #94a3b8; font-size: 18px;">Waiting for ${oppName} to finish...</p></div>`;
                    } else if (isMatchOver) {
                        if (typeof window.showPostGameUI === 'function') window.showPostGameUI(window.currentMatchMyScore || 0, p1Wins >= 3 ? "MATCH WON!" : "MATCH LOST");
                    } else {
                        if (typeof window.renderRoundResultsUI === 'function') window.renderRoundResultsUI(window.userData.username, p1Wins, window.currentMatchMyScore || 0, window.opponentData?.name || "LogicBot 🤖", p2Wins, window.botScore || 0); 
                        if (typeof window.setupReadyUpButton === 'function') window.setupReadyUpButton(window.opponentData?.isAI, window.currentMatchId, true, false, false);
                    }
                } else {
                    if (typeof window.showPostGameUI === 'function') window.showPostGameUI(window.currentMatchMyScore || 0, "GAME OVER!");
                }
            }
        } catch(err) {
            console.error("Rebuild Engine Error:", err);
        }

        if (activeGame) {
            if (window.cachedLeaderboard && window.cachedLeaderboard.length > 0 && typeof window.renderLiveLeaderboard === 'function') {
                window.renderLiveLeaderboard(window.currentMatchMyScore || 0, activeGame);
            } else if (typeof window.updateLeaderboardUI === 'function') {
                window.updateLeaderboardUI(activeGame);
            }
        }
        return; 
    }
    
    // THE FIX: Ignore bot matches on hard refresh
    if (savedMatchId === "BOT_MATCH") {
        localStorage.removeItem('activeMatchId');
    } else if (savedMatchId) {
        try {
            const snap = await getDoc(doc(db, "matchmaking", savedMatchId));
            if (snap.exists() && (snap.data().status === "playing" || snap.data().status === "waiting_for_ready" || snap.data().status === "next_round_countdown")) {
                window.currentMatchId = savedMatchId;
                window.isMultiplayer = true; window.isWarmupPlaying = true; window.hasMatchStarted = false;
                activeGame = snap.data().gameId;
                
                let foundCategory = Object.keys(CATEGORY_DATA).find(cat => CATEGORY_DATA[cat].games.includes(activeGame));
                if (foundCategory) window.showGames(foundCategory);
                
                window.updateLeaderboardUI(activeGame);

                document.getElementById('screen-categories').style.display = 'none';
                document.getElementById('screen-games').style.display = 'none';
                let sArena = document.getElementById('screen-arena'); if(sArena) sArena.classList.add('active');
                
                document.getElementById('warmup-setup-container').style.display = 'block';
                let modeHint = document.getElementById('warmup-mode-hint'); if(modeHint) modeHint.style.display = 'none';
                let modeBtns = document.getElementById('warmup-mode-buttons'); if(modeBtns) modeBtns.style.display = 'none';
                
                document.getElementById('arena-stats-container').style.display = 'flex';
                let startBtn = document.getElementById('btn-warmup-start-stop');
                if(startBtn) { startBtn.className = "btn-action-main btn-stop-active"; startBtn.innerText = "GIVE UP ROUND"; startBtn.style.display = 'inline-block'; startBtn.onclick = window.giveUpRound; }
                
                document.getElementById('arena-game-title').innerText = GAME_INFO[activeGame].t;
                document.getElementById('arena-game-desc').innerText = GAME_INFO[activeGame].d;

                listenToMatch(savedMatchId);
                return; 
            } else {
                localStorage.removeItem('activeMatchId');
            }
        } catch(e) { localStorage.removeItem('activeMatchId'); }
    }
};

async function loadWarmupData() {
    const docSnap = await getDoc(doc(db, "users", currentUserId));
    if (docSnap.exists()) {
        let data = docSnap.data();
        window.userData.username = data.username || "Student";
        window.userData.economy = data.economy || { gold: 0, global_xp: 0 };
        window.userData.equipped = data.equipped || { banner: 'default' };
        window.userData.high_scores = { ...window.userData.high_scores, ...(data.high_scores || {}) };
        window.userData.warmup_date = data.warmup_date || "";
        window.userData.played_categories = data.played_categories || [];
    }
    let today = new Date().toISOString().split('T')[0];
    if (window.userData.warmup_date !== today) { window.userData.warmup_date = today; window.userData.played_categories = []; saveProgressToCloud(); }
}

function updateWarmupCardsUI() {
    Object.keys(window.userData.high_scores).forEach(id => {
        let el = document.getElementById('hs-' + id);
        if (el) { el.innerText = id === 'numGrid' ? `Best: ${window.userData.high_scores[id]}s` : `Best: ${window.userData.high_scores[id]}`; }
    });
}

window.showGames = function(catId) {
    currentCategory = catId;
    document.getElementById('screen-categories').style.display = 'none';
    document.getElementById('screen-games').style.display = 'block';
    let cat = CATEGORY_DATA[catId]; document.getElementById('category-title').innerText = cat.title;
    let grid = document.getElementById('games-list'); grid.innerHTML = '';
    
    cat.games.forEach(gameId => {
        let game = GAME_CARDS[gameId]; let hs = window.userData.high_scores[gameId] || 0; let displayHs = gameId === 'numGrid' ? `${hs}s` : hs;
        grid.innerHTML += `<div class="game-card" onclick="startGame('${gameId}')"><div class="game-icon">${game.icon}</div><h3 style="margin: 0; color: white;">${game.name}</h3><div class="high-score" id="hs-${gameId}">Best: ${displayHs}</div></div>`;
    });
};

window.goBackCategories = function() { document.getElementById('screen-games').style.display = 'none'; document.getElementById('screen-categories').style.display = 'block'; };
window.goBackGames = function() { exitGame(true); }; // True means "I am intentionally quitting!"
async function saveProgressToCloud() {
    try {
        await updateDoc(doc(db, "users", currentUserId), {
            "economy.gold": window.userData.economy.gold, "economy.global_xp": window.userData.economy.global_xp,
            "warmup_date": window.userData.warmup_date, "played_categories": window.userData.played_categories, "high_scores": window.userData.high_scores
        });
        updateWarmupCardsUI();
        if (activeGame && document.getElementById('screen-arena').classList.contains('active')) window.updateLeaderboardUI(activeGame);
    } catch(e) {}
}

let activeGame = ""; let activeModule = null;
const CATEGORY_DATA = { math: { title: "Speed Math 🧮", games: ['quickMath', 'timeLimit', 'advQuickMath', 'compareExp', 'trueFalse', 'missingOp'] }, puzzle: { title: "Logic Puzzles 🧩", games: ['numGrid', 'blockPuzzle', 'ticTacToe', 'fifteenPuzzle', 'completeEq', 'sequence', 'pyramid', 'neonGrid', 'cups'] }, memory: { title: "Memory Matrix 🧠", games: ['memoOrder', 'memoCells'] }, chess: { title: "Chess ♟️", games: ['chessNameSurvival', 'chessNameSpeed', 'chessFindSurvival', 'chessFindSpeed', 'chessMemory'] } };
const GAME_CARDS = { quickMath: { icon: '⏱️', name: 'Quick Math' }, timeLimit: { icon: '⏳', name: 'Time Limit' }, numGrid: { icon: '📈', name: 'Number Grid' }, blockPuzzle: { icon: '🧱', name: 'Block Puzzle' }, ticTacToe: { icon: '❌', name: 'Tic Tac Toe' }, advQuickMath: { icon: '✖️', name: 'Adv. Math' }, compareExp: { icon: '⚖️', name: 'Compare' }, trueFalse: { icon: '✔️', name: 'True / False' }, missingOp: { icon: '❓', name: 'Missing Op.' }, fifteenPuzzle: { icon: '🧩', name: '15 Puzzle' }, completeEq: { icon: '🤝', name: 'Complete Eq.' }, sequence: { icon: '🔢', name: 'Sequence' }, memoOrder: { icon: '🧠', name: 'Memo Order' }, pyramid: { icon: '🔺', name: 'Pyramid' }, memoCells: { icon: '🟩', name: 'Memo Cells' }, chessNameSurvival: { icon: '👁️', name: 'Name Sq (Survival)' }, chessNameSpeed: { icon: '⚡', name: 'Name Sq (Speed)' }, chessFindSurvival: { icon: '🎯', name: 'Find Sq (Survival)' }, chessFindSpeed: { icon: '🕹️', name: 'Find Sq (Speed)' }, chessMemory: { icon: '🧠', name: 'Position Memory' },neonGrid: { icon: '🌈', name: 'Neon Grid' }, cups: { icon: '🪫', name: 'Flip Nodes' } };
const GAME_INFO = { quickMath: { t: "Quick Math", d: "Solve the equation. 10s per question. 1 mistake = Death." }, timeLimit: { t: "Time Limit", d: "Solve as many as you can in 60s. -1 point for wrong guesses." }, numGrid: { t: "Number Grid", d: "Solve to 100%. Fastest time wins!" }, blockPuzzle: { t: "Block Puzzle", d: "Place blocks to clear lines." }, ticTacToe: { t: "Tic Tac Toe", d: "Classic 3x3. Beat the AI!" }, advQuickMath: { t: "Advanced Math", d: "A + B * C. Watch your precedence! 10s. Sudden Death." }, compareExp: { t: "Compare", d: "Which side is greater? 10s. Sudden Death." }, trueFalse: { t: "True or False?", d: "Is the equation correct? 10s. Sudden Death." }, missingOp: { t: "Missing Operator", d: "Find the missing symbol. 10s. Sudden Death." }, fifteenPuzzle: { t: "15 Puzzle", d: "Slide numbers 1 to 15 in order." }, completeEq: { t: "Complete Equation", d: "Pick 2 numbers that solve the puzzle." }, sequence: { t: "Sequence", d: "Find the next number in the pattern." }, memoOrder: { t: "Memorize Order", d: "Tap the dots in the order they appeared." }, pyramid: { t: "Pyramid Math", d: "Fill the blocks. Base blocks add to the top block." }, memoCells: { t: "Memorize Cells", d: "Tap all the highlighted cells." }, chessNameSurvival: { t: "Name Square", d: "Type the name. 5s per question. Sudden Death." }, chessNameSpeed: { t: "Name Square", d: "Name as many as you can in 60s." }, chessFindSurvival: { t: "Find Square", d: "Tap the square. 5s per question. Sudden Death." }, chessFindSpeed: { t: "Find Square", d: "Tap as many as you can in 60s." }, chessMemory: { t: "Position Memory", d: "Reconstruct the board from memory!" },neonGrid: { t: "Neon Grid", d: "Fire the lasers to match the target. The layers matter!"}, cups: { t: "Flip Nodes", d: "Select the exact number of nodes required to flip them. Match the target pattern!" } };

window.renameBackButton = function(isMulti) {
    document.querySelectorAll('button').forEach(btn => {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes('goBackGames')) {
            btn.innerText = isMulti ? "🚪 Leave Game" : "🡠 Back to Games";
            if (isMulti) { btn.style.borderColor = "var(--boss-red)"; btn.style.color = "var(--boss-red)"; } 
            else { btn.style.borderColor = "var(--locked-grey)"; btn.style.color = "#cbd5e1"; }
        }
    });
};

window.startGame = function(gameId) {
    if (window.isWarmupPlaying || window.isRoundActive) {
        window.initializeWarmupScreen();
        return;
    }
    activeGame = gameId;
    document.getElementById('screen-games').style.display = 'none'; 
    document.getElementById('screen-arena').classList.add('active');

    document.getElementById('arena-game-title').innerText = GAME_INFO[gameId].t;
    document.getElementById('arena-game-desc').innerText = GAME_INFO[gameId].d;
    document.getElementById('arena-score').innerText = "🏆 0";
    document.getElementById('arena-timer').innerText = "⏱️ 00:00";

    document.getElementById('warmup-setup-container').style.display = 'block';
    document.getElementById('warmup-mode-hint').style.display = 'block';
    document.getElementById('warmup-mode-hint').innerText = "Select your mode:";
    document.getElementById('warmup-mode-buttons').style.display = 'flex';
    document.getElementById('arena-stats-container').style.display = 'none';
    
    document.getElementById('game-container').style.display = 'flex';
    document.getElementById('game-container').innerHTML = '<h3 style="color: #64748b;">Select a mode and click START to begin!</h3>';
    
    let isChess = currentCategory === 'chess';
    document.getElementById('warmup-mode-buttons').innerHTML = `
        <button id="mode-btn-solo" class="btn mode-btn" style="flex:1;" onclick="selectWarmupMode('solo', this)">👤 Solo Practice</button>
        <button class="btn mode-btn" style="flex:1; ${isChess ? 'opacity:0.5; pointer-events:none;' : ''}" onclick="selectWarmupMode('match', this)">🌐 Ranked (25🪙)</button>
        <button class="btn mode-btn" style="flex:1;" onclick="selectWarmupMode('friend', this)">🤝 Play a Friend</button>
    `;

    let startBtn = document.getElementById('btn-warmup-start-stop');
    startBtn.style.display = 'inline-block'; 
    startBtn.className = "btn-action-main btn-start-dull";
    startBtn.innerText = "START"; 
    startBtn.disabled = true;
    
    // THE FIX: Wipe the button's memory from previous matches!
    startBtn.onclick = window.toggleWarmupState;

    window.isWarmupPlaying = false; window.selectedWarmupMode = null; window.hasDeductedGoldThisMatch = false; 
    updateLeaderboardUI(gameId);

    // THE FIX: Auto-select Solo Practice by default!
    let soloBtn = document.getElementById('mode-btn-solo');
    if (soloBtn && !window.isWarmupPlaying) window.selectWarmupMode('solo', soloBtn);
};

window.selectWarmupMode = function(mode, btnElement) {
    if (window.isWarmupPlaying) return; 
    window.selectedWarmupMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => { btn.style.background = 'transparent'; btn.style.borderColor = 'var(--locked-grey)'; btn.style.color = '#cbd5e1'; });
    btnElement.style.background = 'rgba(59, 130, 246, 0.2)'; btnElement.style.borderColor = 'var(--accent-blue)'; btnElement.style.color = 'white';
    let startBtn = document.getElementById('btn-warmup-start-stop');
    startBtn.className = "btn-action-main btn-start-ready"; startBtn.disabled = false;
};

window.giveUpRound = async function() {
    if (!window.isMultiplayer) { window.toggleWarmupState(); return; }
    if (!window.isRoundActive || !window.currentMatchId) return;

    window.isRoundActive = false;
    if (activeModule && typeof activeModule.cleanup === 'function') activeModule.cleanup();

    let container = document.getElementById('match-gameplay-area') || document.getElementById('game-container');
    container.innerHTML = `<div style="text-align:center; width:100%; margin-top:20px;"><div style="font-size:50px; margin-bottom:20px; animation: pulse 1s infinite alternate;">🏳️</div><h2 style="color:var(--boss-red);">You Gave Up This Round!</h2><p style="color: #94a3b8; font-size: 18px;">Ending round...</p></div>`;

    let startBtn = document.getElementById('btn-warmup-start-stop');
    if(startBtn) { startBtn.className = "btn-action-main btn-start-dull"; startBtn.innerText = "WAITING..."; startBtn.onclick = null; }

    if (window.opponentData && window.opponentData.isAI) {
        if (window.matchTimeout) { clearInterval(window.matchTimeout); window.matchTimeout = null; }
        window.isBotAlive = false; window.amIDeadButBotIsPlaying = false; // THE FIX: Instantly kill the bot!
        let p1Wins = window.userData.tempP1Wins || 0; let p2Wins = window.userData.tempP2Wins || 0;
        p2Wins++; // AI instantly wins the round
        window.userData.tempP1Wins = p1Wins; window.userData.tempP2Wins = p2Wins; updateRoundDots(p1Wins, p2Wins, true);
        if (p1Wins >= 3 || p2Wins >= 3) { showPostGameUI(0, "MATCH LOST"); }
        else { window.renderRoundResultsUI(window.userData.username, p1Wins, 0, "LogicBot 🤖", p2Wins, window.botScore); window.setupReadyUpButton(true, null, true, false, false); }
    } else if (window.currentMatchId) {
        try {
            const matchRef = doc(db, "matchmaking", window.currentMatchId);
            const snap = await getDoc(matchRef);
            if(snap.exists()) {
                let amIPlayer1 = snap.data().player1 === currentUserId;
                let myScoreField = amIPlayer1 ? "player1Score" : "player2Score";
                // THE FIX: Instantly close the round for BOTH players and submit -1 to guarantee the loss!
                await updateDoc(matchRef, { p1Done: true, p2Done: true, [myScoreField]: -1 });
            }
        } catch(e) { console.error(e); }
    }
};

// THE FIX: A bulletproof memory lock to block mobile ghost-clicks
window.isProcessingClick = false;

window.toggleWarmupState = function() {
    // 1. If a click is already processing, instantly kill any extra ghost-clicks
    if (window.isProcessingClick) return;
    window.isProcessingClick = true;
    setTimeout(() => { window.isProcessingClick = false; }, 800); // 800ms strict lock

    let startBtn = document.getElementById('btn-warmup-start-stop');
    if (startBtn) { startBtn.disabled = true; setTimeout(() => { if(startBtn) startBtn.disabled = false; }, 800); }

    if (!window.isWarmupPlaying) {
        // Fallback: Ensure they selected a mode
        if (!window.selectedWarmupMode) {
            window.isProcessingClick = false; 
            return; 
        }

        window.isWarmupPlaying = true;
        if (startBtn) {
            startBtn.className = "btn-action-main btn-stop-active"; 
            startBtn.innerText = "CANCEL SEARCH"; 
            startBtn.onclick = window.toggleWarmupState;
        }
        
        let modeHint = document.getElementById('warmup-mode-hint'); if(modeHint) modeHint.style.display = 'none'; 
        let modeBtns = document.getElementById('warmup-mode-buttons'); if(modeBtns) modeBtns.style.display = 'none';
        
        let statsContainer = document.getElementById('arena-stats-container'); 
        if(statsContainer) statsContainer.style.display = 'flex';
        
        let scoreEl = document.getElementById('arena-score');
        if(scoreEl) scoreEl.style.display = (window.selectedWarmupMode === 'match' || window.selectedWarmupMode === 'friend') ? 'none' : 'inline';
        
        let timerEl = document.getElementById('arena-timer');
        if(timerEl) timerEl.style.display = (window.selectedWarmupMode === 'match' || window.selectedWarmupMode === 'friend') ? 'none' : 'inline';

        // Force the game container to render the next screen safely
        let gc = document.getElementById('game-container');
        if(gc) { gc.style.display = 'flex'; gc.innerHTML = ''; }

        // Route to the correct mode!
        if (window.selectedWarmupMode === 'solo') window.startSolo();
        else if (window.selectedWarmupMode === 'match') window.findMatch();
        else if (window.selectedWarmupMode === 'friend') window.setupFriendMatch();

    } else {
        // --- SOLO OR ABORT BEFORE MATCH STARTS: FORFEIT WHOLE GAME ---
        window.isWarmupPlaying = false; 
        localStorage.removeItem('activeMatchId');
        
        if (window.matchTimeout) { clearTimeout(window.matchTimeout); window.matchTimeout = null; }
        if (window.matchListener) { window.matchListener(); window.matchListener = null; } 
        if (activeModule && typeof activeModule.cleanup === 'function') activeModule.cleanup();
        
        if (window.isMultiplayer && window.currentMatchId && window.currentMatchId !== "BOT_MATCH") { 
            getDoc(doc(db, "matchmaking", window.currentMatchId)).then(snap => {
                if(snap.exists() && snap.data().status.includes('waiting')) deleteDoc(doc(db, "matchmaking", window.currentMatchId));
                else updateDoc(doc(db, "matchmaking", window.currentMatchId), { status: "forfeited", forfeitedBy: currentUserId });
            }).catch(()=>{});
        }
        
        let scoreText = document.getElementById('arena-score') ? document.getElementById('arena-score').innerText : "0"; 
        let currentScore = parseInt(scoreText.replace(/\D/g, '')) || 0;
        
        if (currentScore > 0) {
            let hs = window.userData.high_scores[activeGame] || 0;
            if (activeGame === 'numGrid') { if (hs === 0 || currentScore < hs) window.userData.high_scores[activeGame] = currentScore; } 
            else { if (currentScore > hs) window.userData.high_scores[activeGame] = currentScore; }
            saveProgressToCloud(); 
        }
        showPostGameUI(currentScore, "SESSION ABORTED");
    }
};

window.showPostGameUI = function(score, reason = "GAME OVER!") {
    let startBtn = document.getElementById('btn-warmup-start-stop');
    startBtn.style.display = 'none'; document.getElementById('arena-stats-container').style.display = 'none';
    document.getElementById('warmup-mode-hint').style.display = 'block'; document.getElementById('warmup-mode-hint').innerText = "Change mode or Play Again:";
    document.getElementById('warmup-mode-buttons').style.display = 'flex';

    let displayScore = Math.max(0, score);
    let backBtnLabel = window.isMultiplayer ? "🚪 Leave Game" : "🡠 Back to Games";

    document.getElementById('game-container').innerHTML = `
        <div style="animation: fadeIn 0.5s ease; text-align: center; margin-top: 20px; width: 100%;">
            <h2 style="color: var(--boss-red); font-size: 42px; margin: 0; text-transform: uppercase;">${reason}</h2>
            <p style="color: white; font-size: 26px; margin-top: 10px;">Final Score: <span style="color: #fbbf24; font-weight: bold;">${displayScore}</span></p>
            <div style="display: flex; gap: 15px; justify-content: center; margin-top: 40px;">
                <button class="btn btn-primary" style="padding: 15px 40px; font-size: 20px; font-weight: bold; border-radius: 30px;" onclick="if(window.playWarmupAgain) window.playWarmupAgain()">🔄 Play Again</button>
                <button class="btn" style="padding: 15px 40px; font-size: 20px; font-weight: bold; border-radius: 30px; border-color: var(--locked-grey);" onclick="if(window.goBackGames) window.goBackGames()">${backBtnLabel}</button>
            </div>
        </div>
    `;
    window.isWarmupPlaying = false; localStorage.removeItem('activeMatchId');
    if (window.updateLeaderboardUI) window.updateLeaderboardUI(activeGame); 
};

window.playWarmupAgain = function() { let startBtn = document.getElementById('btn-warmup-start-stop'); startBtn.style.display = 'inline-block'; window.toggleWarmupState(); };

window.exitGame = async function(explicitForfeit = false) {
    // THE FIX: If the router is just switching tabs, DO NOT kill active multiplayer matches!
    if (!explicitForfeit && window.isMultiplayer && localStorage.getItem('activeMatchId')) {
        return; // Leave the match running safely in the background!
    }

    localStorage.removeItem('activeMatchId');
    if (window.isWarmupPlaying) {
        let scoreText = document.getElementById('arena-score')?.innerText || "0"; let currentScore = parseInt(scoreText.replace(/\D/g, '')) || 0;
        if (currentScore > 0) {
            let hs = window.userData.high_scores[activeGame] || 0;
            if (activeGame === 'numGrid') { if (hs === 0 || currentScore < hs) window.userData.high_scores[activeGame] = currentScore; } 
            else { if (currentScore > hs) window.userData.high_scores[activeGame] = currentScore; }
            await saveProgressToCloud();
        }
    }
    if (window.matchTimeout) { clearTimeout(window.matchTimeout); window.matchTimeout = null; }
    if (activeModule && typeof activeModule.cleanup === 'function') activeModule.cleanup();
    if (window.matchListener && typeof window.matchListener === 'function') { window.matchListener(); window.matchListener = null; }
    if (window.isMultiplayer && window.currentMatchId && window.currentMatchId !== "BOT_MATCH") { 
        getDoc(doc(db, "matchmaking", window.currentMatchId)).then(snap => {
            if(snap.exists() && snap.data().status.includes('waiting')) deleteDoc(doc(db, "matchmaking", window.currentMatchId));
            else updateDoc(doc(db, "matchmaking", window.currentMatchId), { status: "forfeited", forfeitedBy: currentUserId });
        }).catch(()=>{});
    }
    window.isMultiplayer = false; window.hasMatchStarted = false; window.isWarmupPlaying = false;
    let sArena = document.getElementById('screen-arena'); if(sArena) sArena.classList.remove('active');
    
    // THE FIX: Route back to the specific Category games list!
    if (currentCategory && window.showGames) {
        window.showGames(currentCategory);
    } else {
        let sGames = document.getElementById('screen-games'); if(sGames) sGames.style.display = 'none'; 
        let sCats = document.getElementById('screen-categories'); if(sCats) sCats.style.display = 'block';
    }
    
    window.renameBackButton(false);
};

window.cachedLeaderboard = [];

window.updateLeaderboardUI = async function(gameId) {
    const list = document.getElementById('warmup-leaderboard-list'); if (!list) return;
    list.innerHTML = '<div style="text-align:center; color:#94a3b8; padding: 20px;">Fetching Live Data... ⏳</div>';
    try {
        const q = query(collection(db, "users"), orderBy(`high_scores.${gameId}`, "desc"), limit(5)); const snap = await getDocs(q);
        window.cachedLeaderboard = [];
        let myScore = window.userData.high_scores[gameId] || 0; 
        let userFoundInTop5 = false;
        
        snap.forEach(docSnap => {
            let data = docSnap.data(); let score = data.high_scores?.[gameId] || 0;
            if (score > 0) {
                let isMe = docSnap.id === currentUserId; 
                if (isMe) userFoundInTop5 = true;
                window.cachedLeaderboard.push({ id: docSnap.id, name: data.username || "Player", score: score, isMe: isMe });
            }
        });
        
        if (!userFoundInTop5 && myScore > 0) {
            window.cachedLeaderboard.push({ id: currentUserId, name: window.userData.username || "YOU", score: myScore, isMe: true });
        }
        window.renderLiveLeaderboard(myScore, gameId);
    } catch (error) { list.innerHTML = '<div style="text-align:center; color:var(--boss-red); padding: 20px;">Failed to sync.</div>'; }
};

window.renderLiveLeaderboard = function(currentScore, gameId = activeGame) {
    const list = document.getElementById('warmup-leaderboard-list'); if (!list) return;
    let lb = [...window.cachedLeaderboard];
    
    // Dynamically inject our live score!
    let myEntry = lb.find(x => x.isMe);
    if (!myEntry && currentScore > 0) {
        myEntry = { id: currentUserId, name: window.userData.username || "YOU", score: currentScore, isMe: true };
        lb.push(myEntry);
    } else if (myEntry) {
        if (gameId === 'numGrid') {
            if (myEntry.score === 0 || currentScore < myEntry.score) myEntry.score = currentScore;
        } else {
            if (currentScore > myEntry.score) myEntry.score = currentScore;
        }
    }
    
    // Re-sort the ranks live!
    if (gameId === 'numGrid') lb.sort((a, b) => a.score - b.score);
    else lb.sort((a, b) => b.score - a.score);
    
    let html = ''; let rank = 1; let userFound = false;
    let top5 = lb.slice(0, 5);
    
    top5.forEach(entry => {
        if (entry.isMe) userFound = true;
        let displayScore = gameId === 'numGrid' ? `${entry.score}s` : entry.score;
        let style = entry.isMe ? 'background: rgba(59,130,246,0.2); border-color: var(--accent-blue);' : '';
        let rankColor = rank === 1 ? '#fbbf24' : (rank === 2 ? '#cbd5e1' : (rank === 3 ? '#b45309' : 'white'));
        html += `<div class="leaderboard-row" style="${style}"><span style="color: ${rankColor}; font-weight: bold; font-size: 16px;">${rank}. ${entry.name}</span><span style="font-weight: bold;">🏆 ${displayScore}</span></div>`; 
        rank++;
    });
    
    if (!userFound && myEntry && myEntry.score > 0) {
        let displayScore = gameId === 'numGrid' ? `${myEntry.score}s` : myEntry.score;
        html += `<div class="leaderboard-row" style="background: rgba(59,130,246,0.2); border-color: var(--accent-blue); border-top: 2px dashed var(--accent-blue); margin-top: 5px;"><span style="color: white; font-weight: bold;">-- YOU</span><span style="font-weight: bold;">🏆 ${displayScore}</span></div>`;
    }
    
    if (html === '') html = '<div style="text-align:center; color:#94a3b8; padding: 20px;">No scores recorded yet. Be the first!</div>';
    list.innerHTML = html;
};


window.setupFriendMatch = function() {
    document.getElementById('game-container').innerHTML = `
        <div style="text-align:center; width:100%; animation: fadeIn 0.3s;">
            <h3 style="color: var(--accent-blue); font-size: 28px;">🤝 Challenge a Friend</h3>
            <p style="color: #94a3b8; margin-bottom: 20px;">Enter their exact username below.</p>
            <input type="text" id="friend-username-input" placeholder="e.g. LogicMaster99" style="width: 100%; max-width: 300px; padding: 15px; border-radius: 8px; border: 2px solid #475569; background: rgba(0,0,0,0.5); color: white; font-size: 18px; margin-bottom: 20px; outline: none; text-align: center;">
            <br><button class="btn btn-primary" style="padding: 15px 40px; font-size: 18px; border-radius: 30px;" onclick="sendFriendChallenge()">Send Challenge 🡢</button>
        </div>
    `;
};

window.sendFriendChallenge = async function() {
    let targetName = document.getElementById('friend-username-input').value.trim();
    if (!targetName) return alert("Enter a username!");
    if (targetName.toLowerCase() === window.userData.username.toLowerCase()) return alert("You can't challenge yourself!");
    
    // Show the waiting screen AFTER they click send!
    document.getElementById('game-container').innerHTML = `<div style="text-align:center;"><div style="font-size: 50px; animation: pulse 1s infinite alternate;">⏳</div><h3 style="color: #f59e0b;">Waiting for ${targetName} to accept...</h3><p style="color:#94a3b8;">They must open their Notifications panel to accept.</p></div>`;

    const q = query(collection(db, "users"), where("username", "==", targetName), limit(1));
    const snap = await getDocs(q); if (snap.empty) { alert("User not found!"); window.toggleWarmupState(); return; }
    let friendId = snap.docs[0].id;
    window.isMultiplayer = true; window.hasMatchStarted = false; window.matchSeed = Math.floor(Math.random() * 1000000);

    const newMatch = await addDoc(collection(db, "matchmaking"), {
        gameId: activeGame, player1: currentUserId, player1Name: window.userData.username, player1Banner: window.userData.equipped?.banner || 'default',
        player2: null, player2Name: null, status: "waiting_friend", seed: window.matchSeed, timestamp: new Date(), p1RoundsWon: 0, p2RoundsWon: 0, p1Done: false, p2Done: false,
        roundStartAt: Date.now() + 3000
    });
    window.currentMatchId = newMatch.id; localStorage.setItem('activeMatchId', window.currentMatchId);

    await addDoc(collection(db, "invites"), { senderId: currentUserId, senderName: window.userData.username, targetId: friendId, matchId: window.currentMatchId, gameId: activeGame, gameName: GAME_INFO[activeGame].t, type: "warmup", status: "pending", timestamp: Date.now() });
    listenToMatch(window.currentMatchId);
};


window.acceptInvite = async function(inviteId, matchId, gameId) {
    document.getElementById('notifications-modal').style.display = 'none';
    try {
        await updateDoc(doc(db, "invites", inviteId), { status: "accepted" });
        await updateDoc(doc(db, "matchmaking", matchId), { 
            player2: currentUserId, player2Name: window.userData.username, 
            status: "playing", roundStartAt: Date.now() + 3000, player1Score: 0, player2Score: 0, seed: Math.floor(Math.random() * 1000000)
        });
        localStorage.setItem('activeMatchId', matchId);
        routeAppMode('warmup');
        setTimeout(() => { 
            let category = gameId.split('_')[0]; 
            if (window.showGames) window.showGames(category);
            if (window.joinFriendWarmup) window.joinFriendWarmup(gameId, matchId); 
            if (window.updateLeaderboardUI) window.updateLeaderboardUI(gameId);
        }, 500);
    } catch(e) {}
};

window.joinFriendWarmup = function(gameId, matchId) {
    activeGame = gameId; window.currentMatchId = matchId; window.isMultiplayer = true; window.selectedWarmupMode = 'friend'; window.isWarmupPlaying = true;
    localStorage.setItem('activeMatchId', matchId);
    
    document.getElementById('screen-categories').style.display = 'none'; document.getElementById('screen-games').style.display = 'none';
    let sArena = document.getElementById('screen-arena'); if(sArena) sArena.classList.add('active');
    document.getElementById('arena-game-title').innerText = GAME_INFO[gameId].t; document.getElementById('arena-game-desc').innerText = GAME_INFO[gameId].d;
    document.getElementById('warmup-setup-container').style.display = 'block'; document.getElementById('warmup-mode-hint').style.display = 'none'; document.getElementById('warmup-mode-buttons').style.display = 'none';
    document.getElementById('arena-stats-container').style.display = 'flex'; document.getElementById('arena-score').style.display = 'none';
    let startBtn = document.getElementById('btn-warmup-start-stop'); startBtn.className = "btn-action-main btn-stop-active"; startBtn.innerText = "CANCEL SEARCH"; startBtn.style.display = 'inline-block'; startBtn.onclick = window.toggleWarmupState;
    document.getElementById('game-container').innerHTML = `<div style="text-align:center;"><div style="font-size: 50px; animation: pulse 1s infinite alternate;">🔗</div><h3 style="color: var(--completed-green);">Connecting to Match...</h3></div>`;
    listenToMatch(window.currentMatchId);
};

window.startSolo = function() { window.isMultiplayer = false; window.renameBackButton(false); window.beginMatch(false); };

window.findMatch = async function() {
    if (window.userData.economy.gold < 25) { alert("Not enough Gold! You need 25🪙."); window.toggleWarmupState(); return; }
    document.getElementById('game-container').innerHTML = `<div style="text-align:center;"><div style="font-size: 50px; margin-bottom: 20px; animation: pulse 1s infinite alternate;">⚔️</div><h3 style="color: #f59e0b;">Searching for opponent...</h3><p style="color: #94a3b8; font-size: 14px;">(Will connect to a bot if no players are found)</p></div>`;
    window.isMultiplayer = true; window.hasMatchStarted = false; let playerName = window.userData.username || "Player";

    try {
        const q = query(collection(db, "matchmaking"), where("gameId", "==", activeGame), where("status", "==", "waiting"), limit(5));
        const snap = await getDocs(q); let matchDoc = null; snap.forEach(d => { if (d.data().player1 !== currentUserId && !matchDoc) matchDoc = d; });

        if (matchDoc) {
            window.currentMatchId = matchDoc.id; localStorage.setItem('activeMatchId', window.currentMatchId);
            await updateDoc(doc(db, "matchmaking", window.currentMatchId), { player2: currentUserId, player2Name: playerName, player2Banner: window.userData.equipped?.banner || 'default', status: "playing", roundStartAt: Date.now() + 3000, player1Score: 0, player2Score: 0, seed: Math.floor(Math.random() * 1000000) });
            listenToMatch(window.currentMatchId);
        } else {
            window.matchSeed = Math.floor(Math.random() * 1000000); 
            const newMatch = await addDoc(collection(db, "matchmaking"), { gameId: activeGame, player1: currentUserId, player1Name: playerName, player1Banner: window.userData.equipped?.banner || 'default', player2: null, player2Name: null, status: "waiting", seed: window.matchSeed, timestamp: new Date(), p1RoundsWon: 0, p2RoundsWon: 0, p1Done: false, p2Done: false, roundStartAt: Date.now() + 3000 });
            window.currentMatchId = newMatch.id; localStorage.setItem('activeMatchId', window.currentMatchId); listenToMatch(window.currentMatchId);
            window.matchTimeout = setTimeout(() => { spawnAI(); }, 10000); 
        }
    } catch(e) {}
};

window.evaluateBotRound = function(finalScore) {
    if (window.matchTimeout) { clearInterval(window.matchTimeout); window.matchTimeout = null; }
    window.amIDeadButBotIsPlaying = false;
    window.isWaitingForOpponentFinish = false;
    window.isRoundActive = false;
    
    let p1Wins = window.userData.tempP1Wins || 0; 
    let p2Wins = window.userData.tempP2Wins || 0;
    
    if (finalScore > window.botScore) p1Wins++; 
    else if (window.botScore > finalScore) p2Wins++;
    
    window.userData.tempP1Wins = p1Wins; 
    window.userData.tempP2Wins = p2Wins; 
    
    // THE FIX: Check if the user is actually looking at the Arena right now!
    let arena = document.getElementById('screen-arena');
    let isVisible = arena && arena.classList.contains('active');
    
    if (p1Wins >= 3 || p2Wins >= 3) { 
        if (p1Wins >= 3) { window.userData.economy.gold += 50; saveProgressToCloud(); } 
        if (isVisible) showPostGameUI(finalScore, p1Wins >= 3 ? "MATCH WON!" : "MATCH LOST"); 
    } else { 
        if (isVisible) {
            window.updateRoundDots(p1Wins, p2Wins, true);
            window.renderRoundResultsUI(window.userData.username, p1Wins, finalScore, "LogicBot 🤖", p2Wins, window.botScore); 
            window.setupReadyUpButton(true, null, true, false, false); 
        }
    }
};

window.updateTugOfWarBar = function(myScore, oppScore) {
    let displayMy = Math.max(0, myScore);
    let displayOpp = Math.max(0, oppScore);
    let mS = document.getElementById('tow-my-score'); let oS = document.getElementById('tow-opp-score');
    if (mS) mS.innerText = displayMy; if (oS) oS.innerText = displayOpp;
    let fill = document.getElementById('tow-fill'); if (!fill) return;
    let diff = displayMy - displayOpp; let clampedDiff = Math.max(-5, Math.min(5, diff)); 
    if (clampedDiff > 0) { let widthPercent = (clampedDiff / 5) * 50; fill.style.background = 'var(--completed-green)'; fill.style.width = widthPercent + '%'; fill.style.left = (50 - widthPercent) + '%'; } 
    else if (clampedDiff < 0) { let widthPercent = (Math.abs(clampedDiff) / 5) * 50; fill.style.background = 'var(--boss-red)'; fill.style.width = widthPercent + '%'; fill.style.left = '50%'; } 
    else { fill.style.width = '0%'; }
};

window.renderRoundResultsUI = function(myName, myWins, myScore, oppName, oppWins, oppScore) {
    let displayMyScore = Math.max(0, myScore);
    let displayOppScore = Math.max(0, oppScore);
    let gArea = document.getElementById('match-gameplay-area') || document.getElementById('game-container');
    let myColor = myScore > oppScore ? "var(--completed-green)" : (myScore < oppScore ? "var(--boss-red)" : "white");
    let oppColor = oppScore > myScore ? "var(--completed-green)" : (oppScore < myScore ? "var(--boss-red)" : "white");
    let titleText = myScore > oppScore ? "Round Won!" : (myScore < oppScore ? "Round Lost!" : "Tie!");
    
    gArea.innerHTML = `
        <div style="text-align:center; width:100%; margin-top:20px; animation: fadeIn 0.5s ease;">
            <h2 style="color: ${myColor}; font-size: 36px; text-transform: uppercase;">${titleText}</h2>
            <div style="background: rgba(0,0,0,0.5); padding: 20px; border-radius: 12px; border: 1px solid var(--locked-grey); margin: 20px auto; max-width: 500px;">
                <div style="color: #94a3b8; font-size: 12px; font-weight: bold; letter-spacing: 2px; margin-bottom: 10px;">ROUNDS WON</div>
                <div style="font-size: 30px; font-weight: bold; margin-bottom: 20px; display: flex; justify-content: center; align-items: center; gap: 15px;"><span style="color: ${myColor};">${myName}</span> <span style="color: white; background: #0f172a; padding: 5px 15px; border-radius: 8px;">${myWins} - ${oppWins}</span> <span style="color: ${oppColor};">${oppName}</span></div>
                <div style="color: #94a3b8; font-size: 12px; font-weight: bold; letter-spacing: 2px; margin-bottom: 10px; border-top: 1px solid #475569; padding-top: 15px;">CURRENT ROUND SCORE</div>
                <div style="display: flex; justify-content: space-around; font-size: 24px; font-weight: bold;"><span style="color:${myColor}">${displayMyScore}</span><span style="color:${oppColor}">${displayOppScore}</span></div>
            </div>
        </div>
    `;
};

function injectBestOf5Tracker(oppName, isAI) {
    let container = document.getElementById('game-container'); if(!container) return;
    if(document.getElementById('round-tracker')) return; // Don't inject twice on reconnect
    let trackerHtml = `
        <div id="round-tracker" style="width: 100%; margin-bottom: 20px; background: rgba(0,0,0,0.5); padding: 15px; border-radius: 12px; border: 1px solid var(--locked-grey);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <div style="display: flex; gap: 8px;" id="p1-rounds"><div class="round-dot p1-dot"></div><div class="round-dot p1-dot"></div><div class="round-dot p1-dot"></div></div>
                <div style="color: #94a3b8; font-size: 12px; font-weight: bold; letter-spacing: 2px;">BEST OF 5</div>
                <div style="display: flex; gap: 8px;" id="p2-rounds"><div class="round-dot p2-dot"></div><div class="round-dot p2-dot"></div><div class="round-dot p2-dot"></div></div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 15px;">
                <span id="tow-my-score" style="color: var(--completed-green); font-weight: bold; font-size: 24px; min-width: 30px; text-align: right;">0</span>
                <div style="position: relative; flex: 1; height: 16px; background: #0f172a; border-radius: 8px; border: 1px solid #475569; overflow: hidden;"><div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: #475569; z-index: 5;"></div><div id="tow-fill" style="position: absolute; top: 0; bottom: 0; width: 0%; left: 50%; background: transparent; transition: 0.3s ease-out;"></div></div>
                <span id="tow-opp-score" style="color: var(--boss-red); font-weight: bold; font-size: 24px; min-width: 30px; text-align: left;">0</span>
            </div>
            <div style="display: flex; justify-content: space-between; width: 100%; margin-top: 5px; font-size: 12px; font-weight: bold;"><span style="color: var(--accent-blue);">YOU</span><span style="color: var(--boss-red);">${oppName}</span></div>
        </div>
        <style>.round-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--locked-grey); background: rgba(0,0,0,0.5); transition: 0.3s; } .p1-dot.won { background: var(--completed-green); border-color: var(--completed-green); box-shadow: 0 0 10px var(--completed-green); } .p2-dot.won { background: var(--boss-red); border-color: var(--boss-red); box-shadow: 0 0 10px var(--boss-red); }</style>
        <div id="match-gameplay-area" style="width: 100%;"></div>
    `;
    container.innerHTML = trackerHtml;
}

function updateRoundDots(p1Wins = 0, p2Wins = 0, amIPlayer1) {
    let myWins = amIPlayer1 ? p1Wins : p2Wins; let oppWins = amIPlayer1 ? p2Wins : p1Wins;
    document.querySelectorAll('.p1-dot').forEach((dot, i) => { if (i < myWins) dot.classList.add('won'); else dot.classList.remove('won'); });
    document.querySelectorAll('.p2-dot').forEach((dot, i) => { if (i < oppWins) dot.classList.add('won'); else dot.classList.remove('won'); });
}



window.setupReadyUpButton = function(isAI, mId, amIPlayer1, p1Ready, p2Ready) {
    let startBtn = document.getElementById('btn-warmup-start-stop'); if (!startBtn) return;
    let amIReady = isAI ? false : (amIPlayer1 ? p1Ready : p2Ready);

    if (amIReady) {
        startBtn.className = "btn-action-main btn-start-dull"; startBtn.innerText = "WAITING..."; startBtn.onclick = null;
    } else {
        startBtn.className = "btn-action-main btn-start-ready"; startBtn.innerText = "READY UP";
        startBtn.onclick = async () => {
            startBtn.className = "btn-action-main btn-start-dull"; 
            startBtn.innerText = "WAITING..."; 
            startBtn.onclick = null;
            startBtn.disabled = true; // Prevent double taps

            if (isAI) {
                window.botScore = 0;
                window.currentMatchMyScore = 0;
                if (typeof window.beginMatch === 'function') window.beginMatch(true);
            } else if (mId) {
                let myReadyField = amIPlayer1 ? "p1Ready" : "p2Ready"; 
                try { await updateDoc(doc(db, "matchmaking", mId), { [myReadyField]: true }); } catch(e){}
            }
        };
    }
};

function listenToMatch(mId) {
    if (window.matchListener) { window.matchListener(); window.matchListener = null; } 
    window.matchListener = onSnapshot(doc(db, "matchmaking", mId), (docSnap) => {
        if (!docSnap.exists()) return;
        let data = docSnap.data(); let amIPlayer1 = data.player1 === currentUserId;

        // 1. THE RECONNECT FAILSAFE
        if (!window.opponentData && data.player1 && data.player2) {
            window.opponentData = { id: amIPlayer1 ? data.player2 : data.player1, name: amIPlayer1 ? data.player2Name : data.player1Name, isAI: false, banner: amIPlayer1 ? data.player2Banner : data.player1Banner };
        }

        if (data.status === "declined") { if (window.matchListener) window.matchListener(); showPostGameUI(0, "CHALLENGE DECLINED!"); return; }
        if (data.status === "forfeited") {
            if (data.forfeitedBy !== currentUserId) {
                if (activeModule && typeof activeModule.cleanup === 'function') activeModule.cleanup();
                window.userData.economy.gold += 50; saveProgressToCloud(); showPostGameUI(50, "OPPONENT FLED!"); 
                if (window.matchListener) window.matchListener(); 
            } return;
        }

        if (data.status === "playing") {
            // THE FIX: If a real human joined, instantly kill the 10-second Bot Spawn countdown!
            if (window.matchTimeout) { clearTimeout(window.matchTimeout); window.matchTimeout = null; }

            if (!window.hasMatchStarted) {
                window.hasMatchStarted = true; window.matchRoundStartAt = data.roundStartAt; window.matchSeed = data.seed;
                window.opponentData = { id: amIPlayer1 ? data.player2 : data.player1, name: amIPlayer1 ? data.player2Name : data.player1Name, isAI: false, banner: amIPlayer1 ? data.player2Banner : data.player1Banner };
                startMultiplayerMatch(data);
            } else if (window.matchRoundStartAt !== data.roundStartAt) {
                window.matchRoundStartAt = data.roundStartAt; window.matchSeed = data.seed;
                
                let startBtn = document.getElementById('btn-warmup-start-stop');
                if(startBtn) { startBtn.className = "btn-action-main btn-stop-active"; startBtn.innerText = "GIVE UP ROUND"; startBtn.onclick = window.giveUpRound; }
                
                window.beginMatch(true, data);
            }
        }

        if (data.status === "playing" && window.hasMatchStarted) {
            updateRoundDots(data.p1RoundsWon, data.p2RoundsWon, amIPlayer1);
            if (!window.opponentData.isAI) window.updateTugOfWarBar(window.currentMatchMyScore || 0, amIPlayer1 ? (data.player2Score || 0) : (data.player1Score || 0));

            if (data.p1Done && data.p2Done && window.isRoundActive) {
                window.isRoundActive = false;
                if (activeModule && typeof activeModule.cleanup === 'function') activeModule.cleanup();
            }

            // 2. SAFE EVALUATION: Both players can safely evaluate because the score math is perfectly identical!
            if (data.p1Done && data.p2Done && !window.isEvaluatingRound) {
                window.isEvaluatingRound = true; let p1Score = data.player1Score || 0; let p2Score = data.player2Score || 0;
                let p1Wins = data.p1RoundsWon || 0; let p2Wins = data.p2RoundsWon || 0;
                
                if (p1Score > p2Score) p1Wins++; else if (p2Score > p1Score) p2Wins++;
                let nextStatus = (p1Wins >= 3 || p2Wins >= 3) ? "match_over" : "waiting_for_ready";
                updateDoc(doc(db, "matchmaking", mId), { p1RoundsWon: p1Wins, p2RoundsWon: p2Wins, status: nextStatus, p1Done: false, p2Done: false, p1Ready: false, p2Ready: false }); 
            }
        }

        if (data.status === "waiting_for_ready") {
            window.isEvaluatingRound = false; updateRoundDots(data.p1RoundsWon, data.p2RoundsWon, amIPlayer1); 
            let myScore = amIPlayer1 ? (data.player1Score || 0) : (data.player2Score || 0); let theirScore = amIPlayer1 ? (data.player2Score || 0) : (data.player1Score || 0);
            window.renderRoundResultsUI(window.userData.username, amIPlayer1 ? data.p1RoundsWon : data.p2RoundsWon, myScore, window.opponentData.name, amIPlayer1 ? data.p2RoundsWon : data.p1RoundsWon, theirScore);
            window.setupReadyUpButton(false, mId, amIPlayer1, data.p1Ready, data.p2Ready);
        }

        // 3. RACE CONDITION FIX: Only Player 1 is allowed to generate the randomized seed and start the countdown!
        if (data.status === "waiting_for_ready" && data.p1Ready && data.p2Ready && amIPlayer1) {
            updateDoc(doc(db, "matchmaking", mId), { status: "playing", seed: Math.floor(Math.random() * 1000000), roundStartAt: Date.now() + 3000, player1Score: 0, player2Score: 0, p1Done: false, p2Done: false, p1Ready: false, p2Ready: false });
        }

        if (data.status === "match_over") {
            window.isEvaluatingRound = false; updateRoundDots(data.p1RoundsWon, data.p2RoundsWon, amIPlayer1); let myWins = amIPlayer1 ? data.p1RoundsWon : data.p2RoundsWon;
            if (myWins >= 3) { window.userData.economy.gold += 50; saveProgressToCloud(); }
            if (window.matchListener) window.matchListener(); showPostGameUI(myWins >= 3 ? "VICTORY!" : "DEFEAT", myWins >= 3 ? "MATCH WON!" : "MATCH LOST"); 
        }
    });
}

async function spawnAI() {
    if (window.matchListener) window.matchListener(); 
    try { await deleteDoc(doc(db, "matchmaking", window.currentMatchId)); } catch(e){} 
    
    // THE FIX: Use a dummy ID so the Ongoing Session button knows we are playing!
    window.currentMatchId = "BOT_MATCH";
    localStorage.setItem('activeMatchId', "BOT_MATCH"); 
    
    window.opponentData = { id: "bot_1", name: "LogicBot 🤖", isAI: true, banner: 'default' };
    startMultiplayerMatch(null);
}

window.startMultiplayerMatch = function(reconnectData = null) {
    window.renameBackButton(true);
    if (!window.hasDeductedGoldThisMatch && window.selectedWarmupMode === 'match') {
        window.hasDeductedGoldThisMatch = true; window.userData.economy.gold -= 25;
        let goldEl = document.getElementById('hud-val-gold'); if(goldEl) goldEl.innerText = window.userData.economy.gold;
        saveProgressToCloud(); 
    }

    currentRound = 1; window.userData.tempP1Wins = 0; window.userData.tempP2Wins = 0;
    injectBestOf5Tracker(window.opponentData.name, window.opponentData.isAI);

    if (window.opponentData.isAI) {
        window.botScore = 0; window.currentMatchMyScore = 0;
        window.isBotAlive = true; window.amIDeadButBotIsPlaying = false;
        window.botExtraTicks = 0; // THE FIX: A strict counter to enforce the 3-second limit!
        
        // Prevent duplicate loops from starting!
        if (window.matchTimeout) { clearInterval(window.matchTimeout); window.matchTimeout = null; }
        
        window.matchTimeout = setInterval(() => {
            let arena = document.getElementById('screen-arena');
            if (arena && !arena.classList.contains('active')) return; 

            if (window.isBotAlive && (window.isRoundActive || window.amIDeadButBotIsPlaying)) { 
                
                let p1Wins = window.userData.tempP1Wins || 0; let p2Wins = window.userData.tempP2Wins || 0;
                let diff = window.currentMatchMyScore - window.botScore; 
                
                let chanceToDie = 0.02; 
                
                // Match Fairness History
                if (p2Wins > p1Wins) chanceToDie += 0.05; 
                else if (p1Wins > p2Wins) chanceToDie -= 0.01; 
                
                // Round Suspense (Rubber-Banding)
                if (window.amIDeadButBotIsPlaying) {
                    window.botExtraTicks++;
                    // THE FIX: 100% chance to die after exactly 2 ticks (~3 seconds)
                    if (window.botExtraTicks >= 2) chanceToDie = 1.0; 
                    else chanceToDie = 0.3; // 30% chance to end it instantly on the first tick!
                    
                    if (window.botScore > window.currentMatchMyScore) chanceToDie = 1.0; // Die instantly if it takes the lead
                } else {
                    if (diff < -3) chanceToDie += 0.15; 
                    else if (diff < -1) chanceToDie += 0.05; 
                    else if (diff > 5) chanceToDie = 0.001; 
                }

                let timerText = document.getElementById('arena-timer')?.innerText || "";
                let isTimeUp = timerText.trim() === '⏱️ 0s' || timerText.trim() === '⏱️ 00:00';
                if (isTimeUp) chanceToDie = 1.0; 
                
                // Roll the dice for a mistake!
                if (Math.random() < chanceToDie) {
                    window.isBotAlive = false;
                    if (window.matchTimeout) { clearInterval(window.matchTimeout); window.matchTimeout = null; }
                    if (window.amIDeadButBotIsPlaying) window.evaluateBotRound(window.currentMatchMyScore);
                    return; 
                }

                // 2. If bot survives, does it score? (Will only happen max 2 times while player is dead)
                let chanceToScore = 0.3;
                if (diff >= 3) chanceToScore = 0.8; else if (diff > 0) chanceToScore = 0.6; else if (diff < -2) chanceToScore = 0.05; else if (diff < 0) chanceToScore = 0.2;
                if (Math.random() < chanceToScore) { window.botScore++; if (typeof window.updateTugOfWarBar === 'function') window.updateTugOfWarBar(window.currentMatchMyScore, window.botScore); }
            }
        }, 1500);
        
        document.getElementById('match-gameplay-area').innerHTML = '<h2 style="color:white; text-align:center; width:100%; margin-top:40px;">Synchronizing Link...</h2>';
        setTimeout(() => { window.beginMatch(true); }, 2000);
    } else {
        window.beginMatch(true, reconnectData);
    }
};

window.beginMatch = async function(isMulti = false, matchData = null) {
    if (activeModule && typeof activeModule.cleanup === 'function') activeModule.cleanup();
    window.isRoundActive = false; 

    const container = isMulti ? document.getElementById('match-gameplay-area') : document.getElementById('game-container');
    if(!container) return; 
    
    let startScore = 0; let activeSeed = null; 
    let targetStartTime = Date.now() + (isMulti && !matchData ? 3000 : 0);

    if (isMulti && matchData) {
        targetStartTime = matchData.roundStartAt || Date.now();
        activeSeed = matchData.seed;
        let amIPlayer1 = matchData.player1 === currentUserId;
        startScore = amIPlayer1 ? (matchData.player1Score || 0) : (matchData.player2Score || 0);
        window.currentMatchMyScore = startScore;
        if (window.opponentData && window.opponentData.isAI) window.botScore = matchData.player2Score || 0;
        updateTugOfWarBar(window.currentMatchMyScore, amIPlayer1 ? (matchData.player2Score || 0) : (matchData.player1Score || 0));
    } else {
        window.currentMatchMyScore = 0; document.getElementById('arena-score').innerText = "🏆 0";
        if(isMulti && window.opponentData && window.opponentData.isAI) targetStartTime = Date.now() + 3000;
    }

    let launchGame = () => {
        container.innerHTML = ''; window.isRoundActive = true;
        let scoreEl = document.getElementById('arena-score'); if(scoreEl) scoreEl.style.display = 'inline';
        let timerEl = document.getElementById('arena-timer'); if(timerEl) timerEl.style.display = 'inline';
        let startBtn = document.getElementById('btn-warmup-start-stop'); if(startBtn) { startBtn.className = "btn-action-main btn-stop-active"; startBtn.innerText = "GIVE UP ROUND"; startBtn.onclick = window.giveUpRound; }
        const onScore = async (newScore) => { 
            window.currentMatchMyScore = newScore; document.getElementById('arena-score').innerText = `🏆 ${newScore}`; 
            if (!isMulti) window.renderLiveLeaderboard(newScore);
            if (isMulti) {
                updateTugOfWarBar(window.currentMatchMyScore, window.botScore || 0);
                if (window.currentMatchId && window.opponentData && !window.opponentData.isAI) {
                    try { let myField = matchData.player1 === currentUserId ? "player1Score" : "player2Score"; await updateDoc(doc(db, "matchmaking", window.currentMatchId), { [myField]: newScore }); } catch(e) {}
                }
            }
        };
        const onTimer = (timeStr, color = "var(--boss-red)") => { let tEl = document.getElementById('arena-timer'); if(tEl) { tEl.innerText = timeStr; tEl.style.color = color; } };
        const onGameOver = async (finalScore) => {
            window.isRoundActive = false;
            try {
                if (isMulti) {
                    // Safe High Score Update
                    if (activeGame && activeGame !== 'numGrid') {
                        if (!window.userData.high_scores) window.userData.high_scores = {};
                        if (finalScore > (window.userData.high_scores[activeGame] || 0)) {
                            window.userData.high_scores[activeGame] = finalScore;
                            saveProgressToCloud();
                        }
                    }

                    if (window.opponentData && window.opponentData.isAI) {
                    window.currentMatchMyScore = finalScore;
                    let timerText = document.getElementById('arena-timer')?.innerText || "";
                    let isTimeUp = timerText.trim() === '⏱️ 0s' || timerText.trim() === '⏱️ 00:00' || activeGame === 'numGrid'; 
                    
                    if (window.isBotAlive && !isTimeUp) {
                        window.amIDeadButBotIsPlaying = true;
                        window.isWaitingForOpponentFinish = true; // NEW
                        if (container) {
                            container.innerHTML = `<div style="text-align:center; width:100%; margin-top:20px;"><div style="font-size:50px; margin-bottom:20px; animation: pulse 1s infinite alternate;">⏳</div><h2 style="color:white;">Round Complete!</h2><p style="color: #94a3b8; font-size: 18px;">LogicBot 🤖 is finishing its turn...</p></div>`;
                        }
                    } else {
                        window.isBotAlive = false;
                        window.isWaitingForOpponentFinish = false; // NEW
                        window.evaluateBotRound(finalScore);
                    }
                } else if (window.currentMatchId) { 
                    window.isWaitingForOpponentFinish = true; // NEW
                    if (container) {
                        container.innerHTML = `<div style="text-align:center; width:100%; margin-top:20px;"><div style="font-size:50px; margin-bottom:20px; animation: pulse 1s infinite alternate;">⏳</div><h2 style="color:white;">Round Complete!</h2><p style="color: #94a3b8; font-size: 18px;">Waiting for opponent to finish...</p></div>`;
                    }
                        try { 
                            const matchRef = doc(db, "matchmaking", window.currentMatchId); 
                            const snap = await getDoc(matchRef); 
                            if(snap.exists()) { 
                                let myDoneField = snap.data().player1 === currentUserId ? "p1Done" : "p2Done"; 
                                let myScoreField = snap.data().player1 === currentUserId ? "player1Score" : "player2Score"; 
                                await updateDoc(matchRef, { [myDoneField]: true, [myScoreField]: finalScore }); 
                            } 
                        } catch(e) { console.error("Firebase Sync Error:", e); }
                    } 
                    return;
                }
                
                // --- SOLO MODE GAME OVER ---
                let earnedXP = finalScore * 10; window.userData.economy.global_xp += earnedXP; window.userData.economy.gold += finalScore;
                if (activeGame === 'numGrid') { if (window.userData.high_scores[activeGame] === 0 || finalScore < window.userData.high_scores[activeGame]) { window.userData.high_scores[activeGame] = finalScore; window.userData.economy.gold += 50; } } 
                else { if (finalScore > (window.userData.high_scores[activeGame] || 0)) { window.userData.high_scores[activeGame] = finalScore; window.userData.economy.gold += 50; } }
                if (finalScore > 0 && !window.userData.played_categories.includes(currentCategory)) window.userData.played_categories.push(currentCategory); await saveProgressToCloud();
                let timerEl = document.getElementById('arena-timer'); let timeText = timerEl ? timerEl.innerText.trim() : ""; let reasonText = "GAME OVER!";
                
                // THE FIX: Exact String Matching!
                if (timeText === '⏱️ 0s' || timeText === '⏱️ 00:00') reasonText = "TIME'S UP!"; 
                else if (activeGame === 'numGrid' || activeGame === 'fifteenPuzzle' || activeGame === 'blockPuzzle' || activeGame === 'ticTacToe') reasonText = "PUZZLE FINISHED!"; 
                else reasonText = "WRONG ANSWER!"; 
                
                window.showPostGameUI(finalScore, reasonText);
            } catch (err) {
                console.error("Critical UI Error in onGameOver:", err);
            }
        };

        const rapidGames = ['quickMath', 'timeLimit', 'advQuickMath', 'compareExp', 'trueFalse', 'missingOp'];
        const numpadGames = ['numGrid', 'sequence'];
        const puzzleGames = ['completeEq', 'memoOrder', 'memoCells'];
        const chessGames = ['chessNameSurvival', 'chessNameSpeed', 'chessFindSurvival', 'chessFindSpeed', 'chessMemory'];

        if (rapidGames.includes(activeGame)) import('./module_rapid.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
        else if (numpadGames.includes(activeGame)) import('./module_numpad.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
        else if (puzzleGames.includes(activeGame)) import('./module_puzzle.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
        else if (chessGames.includes(activeGame)) import('./module_chess.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
        
        // Standalone Games
        else if (activeGame === 'blockPuzzle') import('./game_blockpuzzle.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
        else if (activeGame === 'ticTacToe') import('./game_tictactoe.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
        else if (activeGame === 'fifteenPuzzle') import('./game_fifteen.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
        else if (activeGame === 'pyramid') import('./game_pyramid.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
        else if (activeGame === 'neonGrid') import('./game_painter.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
        else if (activeGame === 'cups') import('./game_cups.js').then(m => { activeModule = m; m.start(activeGame, container, onScore, onTimer, onGameOver, activeSeed, targetStartTime, startScore); }).catch(e=>console.error(e));
    };

    let msUntilStart = targetStartTime - Date.now();

    if (msUntilStart > 0) {
        container.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height: 200px;"><div id="round-countdown" class="count-pop" style="font-size: 100px; font-weight: 900; color: var(--accent-blue);">3</div></div>`;
        let cdInt = setInterval(() => {
            let remaining = targetStartTime - Date.now();
            let cdDisplay = document.getElementById('round-countdown'); if (!cdDisplay) { clearInterval(cdInt); return; }
            if (remaining > 1000) { cdDisplay.innerText = Math.ceil(remaining / 1000); } 
            else if (remaining > 0) { if (cdDisplay.innerText !== "GO!") { cdDisplay.innerText = "GO!"; cdDisplay.style.color = "var(--completed-green)"; } } 
            else { clearInterval(cdInt); launchGame(); }
        }, 100); 
    } else {
        launchGame(); 
    }
};