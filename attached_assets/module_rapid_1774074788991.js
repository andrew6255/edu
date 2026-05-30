// module_rapid.js
// Handles Games: 1, 2, 6, 7, 8, 9

let activeGame = "";
let score = 0;
let timeLeft = 0;
let timerInterval = null;
let currentAnswer = "";
let containerRef = null;
let updateScoreCb, updateTimerCb, gameOverCb;
let isLocked = false;

// --- MULTIPLAYER SEED LOGIC ---
let currentSeed = null;
let roundStartAtGlobal = null;
let lastTickTime = 0;
let lastQText = "";    // NEW
let lastOptions = [];  // NEW

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
    
    // Sync to Firebase Time and existing score
    roundStartAtGlobal = rStart || Date.now();
    score = startScore || 0;
    lastTickTime = Date.now();
    isLocked = false;
    updateScoreCb(score);

    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <div id="rapid-question" class="huge-display" style="transition: transform 0.15s ease, color 0.15s ease;">Loading...</div>
            <div id="rapid-mcq-zone" class="custom-btn-row"></div>
        </div>
    `;

    timerInterval = setInterval(tick, 1000);
    tick(); // Run immediately to prevent 1-second delay
    generateProblem();
}

export function cleanup() { clearInterval(timerInterval); }

function tick() {
    if (isLocked) return; // THE FIX: Stop ticking if the game is locked!
    
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
    let isSpeedRun = (activeGame === 'timeLimit');
    let totalTime = isSpeedRun ? 60 : 10;
    
    timeLeft = totalTime - elapsed;
    updateTimerCb(`⏱️ ${Math.max(0, timeLeft)}s`, "var(--boss-red)");
    
    if (timeLeft <= 0) { 
        isLocked = true; // Lock the game
        cleanup(); 
        gameOverCb(score); 
    }
}

function triggerFlash(color) {
    let qEl = document.getElementById('rapid-question');
    if (!qEl) return;
    qEl.style.color = color; qEl.style.transform = "scale(1.15)";
    setTimeout(() => { if (qEl) { qEl.style.color = "white"; qEl.style.transform = "scale(1)"; } }, 150);
}

function handleAnswer(selectedBtn, selectedVal) {
    if (isLocked) return; // THE FIX: Instantly reject double-clicks!
    
    let isSpeedRun = (activeGame === 'timeLimit');

    if (selectedVal === currentAnswer) {
        score++; updateScoreCb(score);
        
        if (!isSpeedRun) {
            roundStartAtGlobal = Date.now(); 
            updateTimerCb(`⏱️ 10s`, "var(--completed-green)");
        }
        
        generateProblem(); triggerFlash("var(--completed-green)");
    } else {
        if (isSpeedRun) {
            score = Math.max(0, score - 1); updateScoreCb(score);
            generateProblem(); triggerFlash("var(--boss-red)");
        } else {
            isLocked = true; // THE FIX: Instantly lock the board!
            cleanup(); 
            selectedBtn.style.background = "var(--boss-red)";
            document.getElementById('rapid-question').style.color = "var(--boss-red)";
            setTimeout(() => gameOverCb(score), 500);
        }
    }
}

function generateProblem() {
    let qEl = document.getElementById('rapid-question');
    let zone = document.getElementById('rapid-mcq-zone');
    if(!zone || !qEl) return;
    zone.innerHTML = ''; 
    
    let a, b, c, opStr, qText; let options = [];

    switch(activeGame) {
        case 'quickMath':
        case 'timeLimit':
            let ops = ['+', '-', '*', '/']; let op = ops[Math.floor(getRand() * ops.length)];
            if (op === '+' || op === '-') { a = Math.floor(getRand() * 80) + 10; b = Math.floor(getRand() * 80) + 10; } 
            else { a = Math.floor(getRand() * 14) + 2; b = Math.floor(getRand() * 14) + 2; }
            if (op === '+') currentAnswer = String(a + b);
            if (op === '-') { if(b > a) { let t = a; a = b; b = t; } currentAnswer = String(a - b); }
            if (op === '*') currentAnswer = String(a * b);
            if (op === '/') { currentAnswer = String(a); let dividend = a * b; a = dividend; opStr = '÷'; } else { opStr = op; }
            qText = `${a} ${opStr} ${b}`; let ansNum = parseInt(currentAnswer);
            options = [currentAnswer, String(ansNum+1), String(ansNum-1), String(ansNum+10)];
            break;

        case 'advQuickMath':
            a = Math.floor(getRand() * 15) + 2; b = Math.floor(getRand() * 12) + 2; c = Math.floor(getRand() * 12) + 2;
            let formats = [ { text: `${a} + ${b} × ${c}`, ans: a + (b * c) }, { text: `${a} × ${b} + ${c}`, ans: (a * b) + c }, { text: `${a} × ${b} - ${c}`, ans: (a * b) - c } ];
            let format = formats[Math.floor(getRand() * formats.length)];
            if (format.ans < 0) { format.text = `${c} + ${a} × ${b}`; format.ans = c + (a * b); }
            qText = format.text; currentAnswer = String(format.ans);
            options = [currentAnswer, String(format.ans+1), String(format.ans-1), String(format.ans+10)];
            break;

        case 'compareExp':
            a = Math.floor(getRand() * 40) + 5; b = Math.floor(getRand() * 40) + 5; let c2 = Math.floor(getRand() * 40) + 5; let d = Math.floor(getRand() * 40) + 5;
            let left = a + b; let right = c2 + d;
            if (left > right) currentAnswer = '>'; else if (left < right) currentAnswer = '<'; else currentAnswer = '=';
            qText = `${a} + ${b}   _   ${c2} + ${d}`; options = ['<', '=', '>'];
            break;

        case 'trueFalse':
            a = Math.floor(getRand() * 15) + 2; b = Math.floor(getRand() * 15) + 2;
            let realAns = a * b; let isTrue = getRand() > 0.5; currentAnswer = isTrue ? 'True' : 'False';
            let fakeAns = isTrue ? realAns : realAns + (Math.floor(getRand() * 5) + 1) * (getRand() > 0.5 ? 1 : -1);
            qText = `${a} × ${b} = ${fakeAns}`; options = ['True', 'False'];
            break;

        case 'missingOp':
            a = Math.floor(getRand() * 20) + 2; b = Math.floor(getRand() * 20) + 2;
            let mopVals = [ { o: '+', res: a + b }, { o: '-', res: Math.max(a, b) - Math.min(a, b) }, { o: '×', res: a * b } ];
            let targetOp = mopVals[Math.floor(getRand() * mopVals.length)];
            if (targetOp.o === '-') { let big = Math.max(a, b); let small = Math.min(a, b); a = big; b = small; }
            qText = `${a}   ?   ${b}  =  ${targetOp.res}`; currentAnswer = targetOp.o; options = ['+', '-', '×'];
            break;
    }
    // ... inside generateProblem()
    lastQText = qText;        // Save to memory
    lastOptions = options;    // Save to memory
    
    qEl.innerText = qText;
    // ...
    qEl.innerText = qText;
    if (activeGame !== 'trueFalse') options = [...new Set(options)].sort(() => getRand() - 0.5);

    options.forEach(opt => {
        let btn = document.createElement('button'); btn.className = 'custom-btn'; btn.innerText = opt;
        if (activeGame === 'trueFalse') { btn.style.borderColor = opt === 'True' ? "var(--completed-green)" : "var(--boss-red)"; btn.style.width = '150px'; }
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); handleAnswer(btn, opt); }, {passive: false});
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); handleAnswer(btn, opt); });
        zone.appendChild(btn);
    });
}

export function restoreUI(container) {
    containerRef = container;
    container.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <div id="rapid-question" class="huge-display" style="transition: transform 0.15s ease, color 0.15s ease;">${lastQText}</div>
            <div id="rapid-mcq-zone" class="custom-btn-row"></div>
        </div>
    `;
    let zone = document.getElementById('rapid-mcq-zone');
    lastOptions.forEach(opt => {
        let btn = document.createElement('button'); btn.className = 'custom-btn'; btn.innerText = opt;
        if (activeGame === 'trueFalse') { btn.style.borderColor = opt === 'True' ? "var(--completed-green)" : "var(--boss-red)"; btn.style.width = '150px'; }
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); handleAnswer(btn, opt); }, {passive: false});
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); handleAnswer(btn, opt); });
        zone.appendChild(btn);
    });
}