import { doc, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const GEMINI_API_KEY = "AIzaSyClkuy9lwBmd8rg9ac8aDOKc6aKxQgvhHo";

window.gameMode = 'trophies'; 
window.questionTimer = null;
window.timeLeft = 20;
window.currentStepTimeLimit = 20; 

let currentMissionQuestions = [];
let activeQuestionIndex = 0;
let activeStepIndex = 0;
let currentNumpadValue = "";
let stepAttemptedThisRound = false; 
let currentObjectiveTitle = "";
let currentPrereqId = null;

window.globalFloor = 0;
window.targetTrophies = 0;
window.isMastered = false;

let currentMissionIsBoss = false;
let mistakeMadeThisMission = false;
let hintsUsedThisMission = 0;
window.flawlessMissionsInARow = parseInt(localStorage.getItem('flawlessMissions') || '0');

const randTrophies = () => Math.floor(Math.random() * 6) + 28; 

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ==========================================
// 🚀 SPA HTML INJECTOR (THE ARENA UI)
// ==========================================
function injectArenaHTML() {
    if (document.getElementById('screen-game')) return;
    
    const styleBlock = document.createElement('style');
    styleBlock.innerHTML = `
        .screen { display: none !important; }
        .screen.active { display: block !important; }
        #screen-matchmaking.active { display: flex !important; }
        .mcq-btn { background: var(--bg-card); color: white; border: 2px solid var(--locked-grey); border-radius: 12px; padding: 15px 30px; font-size: 20px; font-weight: bold; cursor: pointer; transition: 0.2s; min-width: 150px; }
        .mcq-btn:hover { border-color: var(--accent-blue); background: rgba(59,130,246,0.1); transform: translateY(-3px); box-shadow: 0 5px 15px rgba(59,130,246,0.3); }
        .math-numpad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 300px; margin: 0 auto; }
        .numpad-btn { background: #1e293b; color: white; border: 2px solid #475569; border-radius: 8px; padding: 15px; font-size: 24px; cursor: pointer; font-weight: bold; transition: 0.2s; display: flex; align-items: center; justify-content: center; }
        .numpad-btn:active { transform: scale(0.95); background: var(--accent-blue); border-color: var(--accent-blue); }
        .action-btn { background: #334155; color: #f59e0b; }
        .submit-btn { grid-column: 1 / -1; background: var(--completed-green); border-color: var(--completed-green); color: white; padding: 20px; font-size: 20px; text-transform: uppercase; }
        .chat-bubble-user { align-self: flex-end; background: var(--accent-blue); color: white; padding: 10px 15px; border-radius: 15px 15px 0 15px; max-width: 80%; font-size: 14px; margin-top: 5px; }
        .chat-bubble-ai { align-self: flex-start; background: #334155; color: #e2e2e2; padding: 10px 15px; border-radius: 15px 15px 15px 0; max-width: 80%; font-size: 14px; border: 1px solid var(--locked-grey); margin-top: 5px; }
    `;
    document.head.appendChild(styleBlock);

    const arenaDiv = document.createElement('div');
    arenaDiv.innerHTML = `
        <div id="screen-game" class="screen" style="width:100%; height:100%; position:fixed; inset:0; background:var(--bg-dark); z-index:150; overflow-y:auto; padding-bottom:50px;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:15px 30px; background:rgba(0,0,0,0.8); border-bottom:1px solid var(--locked-grey);">
                <button class="btn" style="border-color:var(--boss-red); color:var(--boss-red);" onclick="exitTraining()">🏃 Flee (Forfeit)</button>
                <div style="display:flex; gap:20px; font-size:18px; font-weight:bold;">
                    <span style="color:#fbbf24;">🪙 <span id="game-val-gold">0</span></span>
                    <span style="color:#f97316;" id="game-val-streak">🔥 0</span>
                    <span style="color:var(--boss-red);" id="game-val-timer">⏱️ 20s</span>
                </div>
            </div>
            
            <div style="padding:20px 30px;">
                <div style="display:flex; justify-content:space-between; color:#94a3b8; font-size:14px; margin-bottom:5px;">
                    <span id="progress-text">Loading Checkpoint...</span>
                </div>
                <div style="width:100%; height:10px; background:#1e293b; border-radius:5px; overflow:hidden;">
                    <div id="game-progress" style="height:100%; width:0%; background:linear-gradient(90deg, #3b82f6, #10b981); transition:0.3s;"></div>
                </div>
            </div>

            <div style="max-width:800px; margin:0 auto; padding:20px; text-align:center;">
                <div style="background:var(--bg-card); padding:30px; border-radius:16px; border:2px solid var(--accent-blue); box-shadow:0 10px 30px rgba(0,0,0,0.5); margin-bottom:30px;">
                    <h2 id="original-question" style="color:white; margin-top:0; font-size:28px;">Loading Data...</h2>
                    <h3 id="step-instruction" style="color:var(--accent-blue); margin-bottom:0;">Connecting to neural link...</h3>
                </div>

                <div id="input-zone" style="display:flex; flex-wrap:wrap; justify-content:center; gap:15px; margin-bottom:30px;"></div>
                <div id="dynamic-numpad"></div>

                <div id="hint-container" style="display:none; text-align:left; background:rgba(0,0,0,0.6); border:1px solid var(--boss-red); border-radius:12px; padding:20px; margin-top:20px;">
                    <h3 style="color:var(--boss-red); margin-top:0;">⚠️ Analysis Failed</h3>
                    <div class="ai-chat-wrapper" style="display:flex; flex-direction:column; gap:10px;">
                        <div id="ai-chat-history" style="max-height:200px; overflow-y:auto; padding-right:10px; display:flex; flex-direction:column; gap:10px;"></div>
                        <div style="display:flex; gap:10px; margin-top:10px;">
                            <input type="text" id="ai-chat-input" placeholder="Ask the AI for help..." style="flex:1; padding:10px; border-radius:8px; border:1px solid var(--locked-grey); background:#1e293b; color:white; outline:none;" onkeypress="if(event.key==='Enter') sendChatMessage()">
                            <button class="btn btn-primary" id="summon-ai-btn" onclick="sendChatMessage()">Send</button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="ready-overlay" style="position:absolute; inset:0; background:rgba(0,0,0,0.9); z-index:200; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                <h1 style="color:var(--accent-blue); font-size:48px; margin-bottom:10px; text-transform:uppercase;">Initialize Link</h1>
                <p style="color:#cbd5e1; font-size:18px; margin-bottom:30px;">Review the objective parameters before engaging.</p>
                <button class="btn btn-primary" style="font-size:24px; padding:15px 40px;" onclick="startQuestionTimer()">ENGAGE</button>
            </div>
        </div>

        <div id="screen-matchmaking" class="screen" style="width:100%; height:100%; position:fixed; inset:0; background:var(--bg-dark); z-index:150; align-items:center; justify-content:center; flex-direction:column; text-align:center;">
            <div id="mm-loading-icon" style="font-size: 80px; margin-bottom: 20px; animation: pulse 1s infinite alternate;">⚔️</div>
            <h1 id="mm-loading-title" style="color: var(--boss-red); margin: 0; font-size: 40px;">Finding Opponent...</h1>
            <p id="mm-loading-objective" style="color: white; font-size: 24px; margin-top: 10px;">Objective Title</p>
            <p id="mm-loading-mode" style="color: #94a3b8; font-size: 16px; margin-bottom: 40px;">Compete Online (PvP)</p>
            <button class="btn" style="border-color: var(--locked-grey);" onclick="cancelCurriculumMatchmaking()">Cancel Matchmaking</button>
        </div>

        <div id="screen-coop" class="screen" style="width:100%; height:100%; position:fixed; inset:0; background:var(--bg-dark); z-index:150; overflow-y:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:15px 30px; background:rgba(0,0,0,0.8); border-bottom:1px solid var(--accent-blue);">
                <div style="display:flex; gap: 20px; align-items: center;">
                    <span style="color:var(--accent-blue); font-weight:bold; font-size: 18px;" id="coop-my-name">Player 1</span>
                    <span style="color:white; font-size: 24px;">🤝</span>
                    <span style="color:#fbbf24; font-weight:bold; font-size: 18px;" id="coop-opp-name">Player 2</span>
                </div>
                <button class="btn" style="border-color:var(--boss-red); color:var(--boss-red);" onclick="forfeitCurriculumMatch()">Leave Session</button>
            </div>
            <div style="max-width:900px; margin: 40px auto; padding: 20px; display: grid; grid-template-columns: 2fr 1fr; gap: 30px;">
                <div>
                    <div style="background:var(--bg-card); padding:30px; border-radius:16px; border:2px solid var(--accent-blue); text-align:center; margin-bottom: 30px;">
                        <h4 id="coop-objective-name" style="color: #94a3b8; margin-top: 0;">Objective Title</h4>
                        <h2 id="coop-question-text" style="color:white; font-size:32px;">Loading Problem...</h2>
                        <p id="coop-status-msg" style="color: #cbd5e1; font-size: 16px; font-weight: bold; margin-bottom: 0;">Synchronizing connection...</p>
                    </div>
                    <div id="coop-options-container" style="display:flex; flex-wrap:wrap; justify-content:center; gap:15px;"></div>
                </div>
                <div style="background: rgba(0,0,0,0.5); border: 1px solid var(--locked-grey); border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; height: 500px;">
                    <div style="background: #1e293b; padding: 15px; text-align: center; border-bottom: 1px solid var(--locked-grey); font-weight: bold; color: white;">Team Comm-Link</div>
                    <div id="coop-chat-box" style="flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 10px;"></div>
                    <div style="padding: 15px; background: #1e293b; display: flex; gap: 10px; border-top: 1px solid var(--locked-grey);">
                        <input type="text" id="coop-chat-input" placeholder="Type a message..." style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #475569; background: var(--bg-dark); color: white; outline: none;">
                        <button class="btn btn-primary" onclick="sendCoopChat()">Send</button>
                    </div>
                </div>
            </div>
        </div>

        <div id="screen-pvp" class="screen" style="width:100%; height:100%; position:fixed; inset:0; background:var(--bg-dark); z-index:150; overflow-y:auto; text-align:center;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:15px 30px; background:rgba(0,0,0,0.8); border-bottom:2px solid var(--boss-red);">
                <button class="btn" style="border-color:var(--boss-red); color:var(--boss-red);" onclick="forfeitCurriculumMatch()">Flee Match</button>
                <div style="color:var(--boss-red); font-size: 24px; font-weight: bold;" id="pvp-timer">⏱️ 45s</div>
            </div>
            <div style="max-width: 800px; margin: 40px auto; padding: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px;">
                    <div style="text-align: left;">
                        <div style="color: #94a3b8; font-size: 14px;">YOU</div>
                        <div id="pvp-my-name" style="color: var(--accent-blue); font-size: 20px; font-weight: bold;">Player 1</div>
                        <div id="pvp-my-score" style="color: white; font-size: 48px; font-weight: bold;">0</div>
                    </div>
                    <div style="font-size: 40px;">⚔️</div>
                    <div style="text-align: right;">
                        <div style="color: #94a3b8; font-size: 14px;">OPPONENT</div>
                        <div id="pvp-opp-name" style="color: var(--boss-red); font-size: 20px; font-weight: bold;">Player 2</div>
                        <div id="pvp-opp-score" style="color: white; font-size: 48px; font-weight: bold;">0</div>
                    </div>
                </div>
                <h4 id="pvp-objective-name" style="color: #94a3b8; margin-bottom: 20px;">Objective Title</h4>
                <h1 id="pvp-question-text" style="color: white; font-size: 50px; margin-bottom: 40px; transition: transform 0.2s;">WAITING...</h1>
                <div id="pvp-options-container" style="display:flex; flex-wrap:wrap; justify-content:center; gap:15px;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(arenaDiv);
}

// 🚀 Fire the HTML Injector the millisecond the file loads!
document.addEventListener('DOMContentLoaded', () => {
    injectArenaHTML();
    buildNumpad(); 
});


// ==========================================
// 🎮 CORE GAMEPLAY ENGINE 
// ==========================================
export function setGameMode(mode) {
    window.gameMode = mode;
    let pracBtn = document.getElementById('btn-mode-practice'); if(pracBtn) pracBtn.className = mode === 'practice' ? 'btn btn-primary' : 'btn';
    let troBtn = document.getElementById('btn-mode-trophies'); if(troBtn) troBtn.className = mode === 'trophies' ? 'btn btn-primary' : 'btn';
    if (typeof window.redrawCurrentMap === 'function') window.redrawCurrentMap();
}
window.setGameMode = setGameMode;

export function startQuestionTimer() {
    document.getElementById('ready-overlay').style.display = 'none';
    if (window.gameMode === 'trophies') {
        window.timeLeft = window.currentStepTimeLimit;
        document.getElementById('game-val-timer').style.display = 'inline';
        document.getElementById('game-val-timer').innerText = `⏱️ ${window.timeLeft}s`;
        
        window.questionTimer = setInterval(() => {
            window.timeLeft--;
            document.getElementById('game-val-timer').innerText = `⏱️ ${window.timeLeft}s`;
            if (window.timeLeft <= 0) {
                clearInterval(window.questionTimer);
                const q = currentMissionQuestions[activeQuestionIndex];
                const step = q.steps[activeStepIndex];
                processAnswer("TIMEOUT_ERROR", step.correct_answer, step.ai_hint, q.question_id, true);
            }
        }, 1000);
    } else { document.getElementById('game-val-timer').style.display = 'none'; }
}
window.startQuestionTimer = startQuestionTimer;

export function openMission(nodeId, title, desc, prereqNodeId = null) { 
    const nodeElement = document.getElementById(nodeId);
    if (!window.currentUserId.startsWith("guest_") && !nodeElement.classList.contains("unlocked") && !nodeElement.classList.contains("completed")) { 
        return alert("This area is locked! Complete previous nodes."); 
    }
    
    currentMissionIsBoss = nodeElement.classList.contains("boss");
    document.getElementById("modal-title").innerText = title; 
    document.getElementById("modal-desc").innerText = desc; 
    let rawObjective = desc.replace("Objective: ", "");
    document.getElementById("play-btn").onclick = () => startDynamicMission(rawObjective, prereqNodeId);
    document.getElementById("mission-modal").style.display = "flex"; 
}
window.openMission = openMission;

export function startDynamicMission(objectiveTitle, prereqNodeId) {
    if(typeof window.mockDatabase !== 'undefined') { currentMissionQuestions = window.mockDatabase.filter(q => q.atomic_objective === objectiveTitle); }
    if(!currentMissionQuestions || currentMissionQuestions.length === 0) return alert("Database empty for this objective.");

    currentObjectiveTitle = objectiveTitle; currentPrereqId = prereqNodeId;
    mistakeMadeThisMission = false;
    hintsUsedThisMission = 0;

    let storageKey = window.CURRICULUM_CONFIG.storageKey;
    let masteredList = JSON.parse(localStorage.getItem(storageKey) || "[]");
    window.isMastered = masteredList.includes(objectiveTitle);
    
    window.globalFloor = masteredList.length * 100;

    if (!window.isMastered && window.gameMode === 'trophies') {
        let activePartial = localStorage.getItem(`${storageKey}_active_partial`);
        if (activePartial && activePartial !== objectiveTitle) {
            window.currentTrophies = window.globalFloor;
            localStorage.setItem(`${storageKey}_trophies`, window.currentTrophies);
            
            if (window.currentUserId && !window.currentUserId.startsWith("guest_")) {
                try { updateDoc(doc(window.db, "users", window.currentUserId), { [`curriculums.${storageKey}.trophies`]: window.currentTrophies }); } catch(e){}
            }
            if (typeof window.showToast === 'function') window.showToast("⚠️ Switched Objectives! Unsaved partial trophies were reset.");
            if(window.updateGlobalRankAndBanner) window.updateGlobalRankAndBanner();
        }
        localStorage.setItem(`${storageKey}_active_partial`, objectiveTitle);
    }

    window.targetTrophies = window.isMastered ? window.currentTrophies : window.globalFloor + 100;
    shuffleArray(currentMissionQuestions);
    activeQuestionIndex = 0; activeStepIndex = 0;
    document.getElementById("mission-modal").style.display = "none";
    window.switchScreen('screen-game');
    loadCurrentStep();
}
window.startDynamicMission = startDynamicMission;

function updateGameHUD() {
    let progressText = document.getElementById('progress-text');
    let progressBar = document.getElementById('game-progress');
    
    if (window.gameMode === 'practice') {
        progressText.innerText = `Practice Mode: Question ${activeQuestionIndex + 1} of ${currentMissionQuestions.length}`;
        progressBar.style.width = `${((activeQuestionIndex) / currentMissionQuestions.length) * 100}%`;
    } else if (window.isMastered) {
        progressText.innerText = `Objective Mastered! (Review Mode Active - 0 Trophies Yielded)`;
        progressBar.style.width = `100%`;
    } else {
        progressText.innerText = `Checkpoint Target: ${window.currentTrophies} / ${window.targetTrophies} 🏆`;
        let percent = ((window.currentTrophies - window.globalFloor) / 100) * 100;
        progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
}
window.updateGameHUD = updateGameHUD;

// ==========================================
// 📱 UPGRADED TACTILE NUMPAD LOGIC
// ==========================================
function buildNumpad() {
    const pad = document.getElementById('dynamic-numpad');
    if (!pad) return;
    
    pad.innerHTML = '';
    pad.className = 'math-numpad'; 
    
    const keys = ['1','2','3','4','5','6','7','8','9','-','0','⌫'];
    
    const bindTap = (btn, action) => {
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, {passive: false});
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); action(); });
    };

    keys.forEach(k => {
        let btn = document.createElement('button');
        btn.type = 'button';
        let extraClass = (k === '⌫' || k === '-' || k === '.') ? 'action-btn' : '';
        btn.className = `numpad-btn ${extraClass}`;
        btn.innerText = k;
        bindTap(btn, () => pressKey(k));
        pad.appendChild(btn);
    });
    
    let subBtn = document.createElement('button');
    subBtn.type = 'button';
    subBtn.className = 'numpad-btn submit-btn'; 
    subBtn.innerText = 'SUBMIT ANSWER';
    bindTap(subBtn, () => submitNumpadAnswer());
    pad.appendChild(subBtn);
}

export function pressKey(key) {
    if (key === '⌫') {
        currentNumpadValue = currentNumpadValue.slice(0, -1);
    } else if (key === 'C') { 
        currentNumpadValue = "";
    } else if (key === '-') {
        currentNumpadValue = currentNumpadValue.startsWith('-') ? currentNumpadValue.substring(1) : '-' + currentNumpadValue;
    } else {
        currentNumpadValue += key;
    }
    document.getElementById('numpad-display').innerText = currentNumpadValue || "_";
}
window.pressKey = pressKey;

export function submitNumpadAnswer() {
    const q = currentMissionQuestions[activeQuestionIndex];
    const step = q.steps[activeStepIndex];
    processAnswer(currentNumpadValue, step.correct_answer, step.ai_hint, q.question_id);
}
window.submitNumpadAnswer = submitNumpadAnswer;

function loadCurrentStep() {
    stepAttemptedThisRound = false; 
    document.getElementById('hint-container').style.display = 'none';
    
    let summonBtn = document.getElementById('summon-ai-btn');
    if (summonBtn) summonBtn.style.display = 'block';

    document.getElementById('ai-chat-history').innerHTML = `
        <div class="chat-bubble-ai">
            <strong>🤖 Initial Hint:</strong>
            <span id="ai-hint-text">Analyzing problem...</span>
        </div>`; 
        
    clearInterval(window.questionTimer);
    document.getElementById('ready-overlay').style.display = 'flex';
    
    const q = currentMissionQuestions[activeQuestionIndex];
    const step = q.steps[activeStepIndex];

    window.currentStepTimeLimit = step.time_limit || 20;
    document.getElementById('game-val-timer').innerText = `⏱️ ${window.currentStepTimeLimit}s`;
    
    let oldBtn = document.getElementById('show-answer-btn');
    if(oldBtn) oldBtn.remove();
    updateGameHUD();

    document.getElementById('original-question').innerText = q.original_question_text;
    document.getElementById('step-instruction').innerText = step.step_instruction;
    document.getElementById('step-instruction').style.color = "var(--accent-blue)";

    const inputZone = document.getElementById('input-zone');
    const numpad = document.getElementById('dynamic-numpad');
    inputZone.innerHTML = ''; 

    if (step.input_type === "multiple_choice") {
        numpad.style.display = "none";
        let options = [step.correct_answer, ...step.distractors];
        shuffleArray(options);
        options.forEach(opt => {
            let btn = document.createElement('button'); 
            btn.type = 'button';
            btn.className = "mcq-btn"; btn.innerText = opt;
            btn.onclick = () => processAnswer(opt, step.correct_answer, step.ai_hint, q.question_id);
            inputZone.appendChild(btn);
        });
    } else if (step.input_type === "numpad_exact") {
        numpad.style.display = "grid"; currentNumpadValue = "";
        let displayBox = document.createElement('div'); displayBox.id = "numpad-display"; displayBox.className = "numpad-display-box"; displayBox.innerText = "_";
        displayBox.style.background = 'rgba(0,0,0,0.8)'; displayBox.style.padding = '15px 30px'; displayBox.style.fontSize = '32px'; displayBox.style.borderRadius = '12px'; displayBox.style.border = '2px solid var(--accent-blue)'; displayBox.style.minWidth = '150px';
        inputZone.appendChild(displayBox);
    }
}

// ==========================================
// 🎇 FLOATING REWARD ANIMATION
// ==========================================
function spawnFloatingReward(text, color, x, y) {
    let el = document.createElement('div');
    el.innerText = text; el.style.position = 'fixed'; el.style.left = (x - 20) + 'px'; el.style.top = y + 'px'; el.style.color = color;
    el.style.fontWeight = '900'; el.style.fontSize = '24px'; el.style.textShadow = '0 2px 5px rgba(0,0,0,0.8)'; el.style.pointerEvents = 'none'; el.style.zIndex = '9999'; el.style.transition = 'all 1s cubic-bezier(0.25, 1, 0.5, 1)';
    document.body.appendChild(el);
    setTimeout(() => { el.style.transform = `translateY(-80px) scale(1.3) rotate(${Math.random() * 20 - 10}deg)`; el.style.opacity = '0'; }, 50);
    setTimeout(() => el.remove(), 1000);
}

async function processAnswer(userAnswer, correctAnswer, aiHint, questionId, isTimeout = false) {
    clearInterval(window.questionTimer);
    const isCorrect = !isTimeout && (String(userAnswer).trim() === String(correctAnswer).trim());

    if (!stepAttemptedThisRound) {
        stepAttemptedThisRound = true; 
        if (isCorrect) {
            window.currentStreak++; window.globalXP += 10; 
            let inputRect = document.getElementById('input-zone').getBoundingClientRect();
            spawnFloatingReward('+10 🪙', '#fbbf24', inputRect.left + (inputRect.width / 2) + 40, inputRect.top);
            if (window.currentStreak > 1) setTimeout(() => spawnFloatingReward('🔥 STREAK!', '#f97316', inputRect.left + (inputRect.width / 2) - 40, inputRect.top + 20), 200);

            if (window.gameMode === 'trophies' && !window.isMastered) {
                let earned = randTrophies(); window.currentTrophies = Math.min(window.currentTrophies + earned, window.targetTrophies);
                if (window.currentUserId && !window.currentUserId.startsWith("guest_")) {
                    try { await updateDoc(doc(window.db, "users", window.currentUserId), { "economy.gold": increment(10), "economy.global_xp": increment(10) }); } catch(e){}
                    let newGold = parseInt(localStorage.getItem('mockGold') || "0") + 10; localStorage.setItem('mockGold', newGold); 
                    document.getElementById('game-val-gold').innerText = newGold;
                }
            }
        } else {
            window.currentStreak = 0; mistakeMadeThisMission = true; window.flawlessMissionsInARow = 0; localStorage.setItem('flawlessMissions', "0"); hintsUsedThisMission++; 
            if (window.gameMode === 'trophies' && !window.isMastered) {
                let lost = randTrophies(); window.currentTrophies = Math.max(window.currentTrophies - lost, window.globalFloor); 
                if (window.currentUserId && !window.currentUserId.startsWith("guest_")) {
                    try { await updateDoc(doc(window.db, "users", window.currentUserId), { [`mistakes`]: arrayUnion(questionId) }); } catch(e){}
                }
            }
        }
        
        document.getElementById('game-val-streak').innerText = "🔥 " + window.currentStreak;
        
        if (window.gameMode === 'trophies') {
            localStorage.setItem(`${window.CURRICULUM_CONFIG.storageKey}_trophies`, window.currentTrophies);
            if (window.currentUserId && !window.currentUserId.startsWith("guest_")) { try { await updateDoc(doc(window.db, "users", window.currentUserId), { [`curriculums.${window.CURRICULUM_CONFIG.storageKey}.trophies`]: window.currentTrophies }); } catch(e){} }
        }
        
        updateGameHUD(); if(window.updateGlobalRankAndBanner) window.updateGlobalRankAndBanner();
    }

    if (isCorrect) {
        document.getElementById('step-instruction').style.color = "var(--completed-green)";
        if (window.currentStreak > 0 && window.currentStreak % 3 === 0) setTimeout(() => { if(window.triggerStoryNode) window.triggerStoryNode(); else progressEngine(); }, 500);
        else setTimeout(() => { document.getElementById('step-instruction').style.color = "var(--accent-blue)"; progressEngine(); }, 800);
    } else {
        document.getElementById('step-instruction').style.color = "var(--boss-red)";
        document.getElementById('step-instruction').innerText = isTimeout ? "⏰ Time's Up! Review the hint below." : "Incorrect! Review the hint below.";
        document.getElementById('ai-hint-text').innerText = aiHint; 
        document.getElementById('hint-container').style.display = 'block';
        
        let summonBtn = document.getElementById('summon-ai-btn'); if (summonBtn) summonBtn.style.display = 'none'; 
        if (document.getElementById('numpad-display')) {
            document.getElementById('numpad-display').style.borderColor = "var(--boss-red)";
            setTimeout(() => { document.getElementById('numpad-display').style.borderColor = "var(--accent-blue)"; pressKey('C'); }, 1000);
        }
        let saBtn = document.getElementById('show-answer-btn');
        if (!saBtn) {
            saBtn = document.createElement('button'); saBtn.id = 'show-answer-btn'; saBtn.className = 'btn';
            saBtn.style.marginTop = '15px'; saBtn.style.width = '100%'; saBtn.style.borderColor = 'var(--accent-blue)';
            saBtn.innerText = '👁️ Show Answer'; saBtn.onclick = () => { saBtn.innerText = `Correct Answer: ${correctAnswer}`; };
            document.querySelector('.ai-chat-wrapper').appendChild(saBtn);
        }
    }
}

function triggerGameplayAchievements() {
    if (window.gameMode === 'trophies' && !window.isMastered) {
        if (!mistakeMadeThisMission) { window.flawlessMissionsInARow++; localStorage.setItem('flawlessMissions', window.flawlessMissionsInARow.toString()); }
        if (window.checkAchievements) window.checkAchievements('mission_complete', { bossDefeated: currentMissionIsBoss, flawlessCount: window.flawlessMissionsInARow, noHintsUsed: (hintsUsedThisMission === 0), difficulty: 3 });
        mistakeMadeThisMission = false; hintsUsedThisMission = 0;
    }
}

export async function progressEngine() {
    try {
        if (window.gameMode === 'trophies' && !window.isMastered && window.currentTrophies >= window.targetTrophies) {
            let storageKey = window.CURRICULUM_CONFIG.storageKey;
            let masteredList = JSON.parse(localStorage.getItem(storageKey) || "[]");
            if (!masteredList.includes(currentObjectiveTitle)) {
                masteredList.push(currentObjectiveTitle); localStorage.setItem(storageKey, JSON.stringify(masteredList));
                localStorage.removeItem(`${storageKey}_active_partial`);

                let newBadge = null; if (window.currentTrophies >= window.CURRICULUM_CONFIG.maxTrophies) newBadge = `badge_mastered_${storageKey}_complete`;
                try {
                    if (window.currentUserId && !window.currentUserId.startsWith("guest_")) {
                        let safeTitle = currentObjectiveTitle.replace(/[.#$/\[\]]/g, "_"); let updates = { [`analytics.${storageKey}.${safeTitle}.mastered`]: true };
                        if (newBadge) updates["inventory.badges"] = arrayUnion(newBadge);
                        await updateDoc(doc(window.db, "users", window.currentUserId), updates);
                    }
                } catch (dbErr) { console.warn("Background Save Warning:", dbErr); }
            }
            triggerGameplayAchievements(); 
            alert("🎯 Checkpoint Mastered! Generating Trophy Road Rewards..."); // Temporary Fallback for Victory Modal
            window.exitTraining(); if(window.redrawCurrentMap) window.redrawCurrentMap(); return; 
        }

        const q = currentMissionQuestions[activeQuestionIndex];
        if (activeStepIndex < q.steps.length - 1) { activeStepIndex++; loadCurrentStep(); } 
        else {
            activeQuestionIndex++;
            if (activeQuestionIndex >= currentMissionQuestions.length) {
                triggerGameplayAchievements(); 
                if (window.gameMode === 'trophies' && !window.isMastered && window.currentTrophies < window.targetTrophies) {
                    document.getElementById('original-question').style.color = "var(--accent-blue)";
                    document.getElementById('original-question').innerText = "Looping... Let's grind to the Checkpoint!";
                    setTimeout(() => {
                        document.getElementById('original-question').style.color = "white";
                        let lastQuestionSeen = currentMissionQuestions[currentMissionQuestions.length - 1]; shuffleArray(currentMissionQuestions); 
                        if (currentMissionQuestions.length > 1 && currentMissionQuestions[0] === lastQuestionSeen) { [currentMissionQuestions[0], currentMissionQuestions[1]] = [currentMissionQuestions[1], currentMissionQuestions[0]]; }
                        activeQuestionIndex = 0; loadCurrentStep();
                    }, 1500);
                } else if (window.gameMode === 'practice') { alert("🎯 Practice Run Complete! Great job."); window.exitTraining(); if(window.redrawCurrentMap) window.redrawCurrentMap(); } 
                else if (window.isMastered) { alert("🔄 Review Complete! You're keeping your logic sharp."); window.exitTraining(); if(window.redrawCurrentMap) window.redrawCurrentMap(); }
            } else { activeStepIndex = 0; loadCurrentStep(); }
        }
    } catch (e) { console.error("Engine Fallback Triggered:", e); window.exitTraining(); }
}
window.progressEngine = progressEngine;

// ==========================================
// 🧠 UPGRADED ADAPTIVE AI TUTOR
// ==========================================
export async function sendChatMessage() {
    const inputEl = document.getElementById('ai-chat-input'); const msg = inputEl.value.trim(); if(!msg) return;
    hintsUsedThisMission++; const chatHistory = document.getElementById('ai-chat-history');
    
    chatHistory.innerHTML += `<div class="chat-bubble-user">${msg}</div>`;
    inputEl.value = ""; chatHistory.scrollTop = chatHistory.scrollHeight;

    const thinkId = "ai-think-" + Date.now();
    chatHistory.innerHTML += `<div id="${thinkId}" class="chat-bubble-ai" style="opacity: 0.6; font-style: italic;">🤖 Interfacing with Neural Network...</div>`;
    chatHistory.scrollTop = chatHistory.scrollHeight;

    const currentQ = currentMissionQuestions[activeQuestionIndex]; const currentStep = currentQ.steps[activeStepIndex];
    let playstyle = JSON.parse(localStorage.getItem('logicLordsPlaystyle') || '{"ai_preference":"breadcrumb"}');
    let pref = playstyle.ai_preference; let personality = "";
    
    if (pref === 'breadcrumb') personality = "You are a Socratic tutor. Give only a tiny, cryptic hint to nudge them. DO NOT give the final answer.";
    else if (pref === 'procedural') personality = "You are a highly structured tutor. Break the problem down into simple, numbered steps.";
    else if (pref === 'conceptual') personality = "You are an applied-math tutor. Always explain the concept using a real-world, highly engaging analogy.";
    else if (pref === 'direct') personality = "You are a pragmatic tutor. Show them the exact steps to reach the solution clearly.";

    const prompt = `System Instructions: ${personality}\n\nProblem Context: "${currentQ.original_question_text}". The student is stuck on this step: "${currentStep.step_instruction}". The student's message is: "${msg}". DO NOT give the final correct answer (${currentStep.correct_answer}) unless explicitly instructed by the system. Keep it brief.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) 
        });
        const data = await response.json(); document.getElementById(thinkId).remove();
        let aiText = data.candidates[0].content.parts[0].text;
        let formattedText = aiText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
        chatHistory.innerHTML += `<div class="chat-bubble-ai"><strong>🤖 AI Tutor:</strong>${formattedText}</div>`;
        chatHistory.scrollTop = chatHistory.scrollHeight;
    } catch (error) { 
        document.getElementById(thinkId).remove(); chatHistory.innerHTML += `<div style="color:var(--boss-red); margin-top:5px; font-weight:bold;">⚠️ Error: Could not connect to Neural Network.</div>`; 
    }
}
window.sendChatMessage = sendChatMessage;