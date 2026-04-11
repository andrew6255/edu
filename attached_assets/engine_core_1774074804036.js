import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, arrayUnion, collection, addDoc, query, where, getDocs, onSnapshot, limit, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = { 
    apiKey: "AIzaSyBaNWmSxGWq3q3G7qm78Aj-npdGTaAy3tM", 
    authDomain: "logiclords-mvp.firebaseapp.com", 
    projectId: "logiclords-mvp" 
};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp(); 
window.db = getFirestore(app); 

window.networkMode = 'solo';
window.onlineSubMode = 'study';
window.activeMultiplayerObjective = null;

window.currentUserId = localStorage.getItem('logicLordsGuestId') || localStorage.getItem('logicLordsUserId');
window.curriculumData = null;
window.activeChapterId = null;
window.mockDatabase = [];
window.currentTrophies = 0; 
window.globalXP = 0;
window.currentStreak = 0;
window.playerUsername = localStorage.getItem('logicLordsUsername') || "Student";
window.rawDbTrophies = 0;
window.rawAnalytics = {};

// ==========================================
// 1. STATE RECONCILIATION & BOOTLOADER
// ==========================================
export function reconcileTrophies(storageKey, rawTrophies, masteredList) {
    let rt = parseInt(rawTrophies) || 0;
    let floor = masteredList.length * 100;
    let ceiling = floor + 99;
    if (rt < floor || rt > ceiling) {
        localStorage.setItem(`${storageKey}_trophies`, floor);
        if (window.currentUserId && !window.currentUserId.startsWith("guest_")) {
            try { updateDoc(doc(window.db, "users", window.currentUserId), { [`curriculums.${storageKey}.trophies`]: floor }); } catch(e){}
        }
        return floor;
    }
    return rt;
}
window.reconcileTrophies = reconcileTrophies;

// THE FIX: This replaces DOMContentLoaded so it only runs when Router tells it to!
window.bootCurriculumEngine = async function() {
    if (!window.CURRICULUM_CONFIG) return;
    
    // 1. Set dynamic trophies based on JSON size
    let storageKey = window.CURRICULUM_CONFIG.storageKey;
    let totalObjectives = 0; 
    let validObjectives = []; 
    
    if (window.curriculumData && window.curriculumData.sectors) {
        window.curriculumData.sectors.forEach(sector => {
            sector.chapters.forEach(chapter => {
                totalObjectives += chapter.objectives.length; 
                chapter.objectives.forEach(obj => validObjectives.push(obj.desc.replace("Objective: ", "")));
            });
        });
        window.CURRICULUM_CONFIG.maxTrophies = totalObjectives * 100;
        localStorage.setItem(`${storageKey}_maxTrophies`, window.CURRICULUM_CONFIG.maxTrophies);
    }

    // 2. Ghost Purge & Reconcile
    let cleanMasteredList = [];
    let safeToOriginalMap = {};
    validObjectives.forEach(v => { safeToOriginalMap[v.replace(/[.#$/\[\]]/g, "_")] = v; });

    let rawAnalytics = window.currentUserData?.analytics?.[storageKey] || {};
    let rawDbTrophies = window.currentUserData?.curriculums?.[storageKey]?.trophies || 0;

    if (window.currentUserId && !window.currentUserId.startsWith("guest_")) {
        for (let key in rawAnalytics) {
            if (rawAnalytics[key].mastered && safeToOriginalMap[key]) cleanMasteredList.push(safeToOriginalMap[key]);
        }
    } else {
        let guestMastered = JSON.parse(localStorage.getItem(storageKey) || "[]");
        cleanMasteredList = guestMastered.filter(t => validObjectives.includes(t));
    }
    localStorage.setItem(storageKey, JSON.stringify(cleanMasteredList));
    window.currentTrophies = reconcileTrophies(storageKey, Math.max(rawDbTrophies, parseInt(localStorage.getItem(`${storageKey}_trophies`) || "0")), cleanMasteredList);
    
    // 3. Load Question Bank
    try { 
        const res = await fetch(window.CURRICULUM_CONFIG.bankUrl); 
        window.mockDatabase = await res.json(); 
    } catch (error) { console.error("Could not load question bank:", error); }

    // Update HUD and start listening
    if(window.updateGlobalRankAndBanner) window.updateGlobalRankAndBanner();
    window.startInviteListener();
};

// ==========================================
// 2. ACHIEVEMENTS & SCREEN MANAGEMENT
// ==========================================
export async function checkAchievements(triggerEvent, payload = {}) {
    if (window.currentUserId && window.currentUserId.startsWith("guest_")) return; 
    let inventory = JSON.parse(localStorage.getItem('unlockedBadges') || "[]");
    let newlyUnlocked = [];
    const award = (badgeId) => { if (!inventory.includes(badgeId)) { inventory.push(badgeId); newlyUnlocked.push(badgeId); localStorage.setItem('unlockedBadges', JSON.stringify(inventory)); } };

    if (triggerEvent === 'login' || triggerEvent === 'mission_complete') { let streak = window.currentStreak || 0; if (streak >= 3) award('badge_streak_3'); if (streak >= 7) award('badge_streak_7'); if (streak >= 30) award('badge_streak_30'); }
    if (triggerEvent === 'gold_update' || triggerEvent === 'login') { let g = parseInt(localStorage.getItem('mockGold') || "0"); if (g >= 10000) award('badge_hoarder'); }
    if (triggerEvent === 'buy_banner') award('badge_fashionista');
    if (triggerEvent === 'rank_up') { let currentRankName = payload.rankName || ""; if (currentRankName.includes("Gold") || currentRankName.includes("Platinum") || currentRankName.includes("Diamond") || currentRankName.includes("Master")) award('badge_gold_scholar'); if (currentRankName === "Logic Lord") award('badge_logic_lord'); }
    if (triggerEvent === 'mission_complete') { if (payload.bossDefeated) award('badge_boss_slayer'); if (payload.flawlessCount >= 5) award('badge_flawless_5'); if (payload.noHintsUsed && payload.difficulty >= 3) award('badge_no_hints'); }

    if (newlyUnlocked.length > 0) {
        if (!window.currentUserId.startsWith("guest_")) { try { await updateDoc(doc(window.db, "users", window.currentUserId), { "inventory.badges": arrayUnion(...newlyUnlocked) }); } catch(e){} }
        newlyUnlocked.forEach((bId, idx) => { setTimeout(() => { showAchievementPopup(bId); }, idx * 3000); });
    }
}
window.checkAchievements = checkAchievements;

function showAchievementPopup(badgeId) {
    let popup = document.createElement('div'); popup.className = 'achievement-popup';
    let emoji = window.getBadgeEmoji ? window.getBadgeEmoji(badgeId) : '🎖️';
    popup.innerHTML = `<div style="font-size:36px; text-shadow:0 0 10px rgba(255,255,255,0.5);">${emoji}</div><div style="text-align:left;"><div style="color:var(--completed-green); font-size:12px; font-weight:bold; text-transform:uppercase; letter-spacing:1px;">Achievement Unlocked</div><div style="color:white; font-size:16px; font-weight:bold;">New Badge Added to Inventory!</div></div>`;
    document.body.appendChild(popup); setTimeout(() => popup.classList.add('show'), 100); setTimeout(() => { popup.classList.remove('show'); setTimeout(() => popup.remove(), 500); }, 2800);
}

export function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); 
    let target = document.getElementById(screenId);
    if(target) target.classList.add('active');
    
    let mainHud = document.getElementById('main-hud');
    if(mainHud) { 
        if (screenId === 'screen-game' || screenId === 'screen-coop' || screenId === 'screen-pvp' || screenId === 'screen-matchmaking') { mainHud.style.display = 'none'; } 
        else { mainHud.style.display = 'flex'; } 
    }
}
window.switchScreen = switchScreen;

export function exitTraining() { clearInterval(window.questionTimer); let hc = document.getElementById('hint-container'); if(hc) hc.style.display = 'none'; switchScreen('screen-dynamic-map'); }
window.exitTraining = exitTraining;

// ==========================================
// 3. CORE MAP DRAWER (DYNAMIC THEME BRANCHING)
// ==========================================
export function openChapterMap(chapterId) {
    window.activeChapterId = chapterId; let targetChapter = null;
    window.curriculumData.sectors.forEach(sec => { let found = sec.chapters.find(c => c.chapter_id === chapterId); if(found) targetChapter = found; }); if(!targetChapter) return;
    
    let titleEl = document.getElementById('dynamic-map-title');
    if (titleEl) titleEl.innerText = targetChapter.chapter_title.toUpperCase(); 
    
    const treeContainer = document.getElementById('dynamic-skill-tree'); 
    if(!treeContainer) return;
    treeContainer.innerHTML = '';
    
    let objectives = targetChapter.objectives; let mastered = JSON.parse(localStorage.getItem(window.CURRICULUM_CONFIG.storageKey) || "[]"); let objStates = []; let previousMastered = true; 
    
    for(let k = 0; k < objectives.length; k++) { 
        let rawTitle = objectives[k].desc.replace("Objective: ", ""); 
        if (window.networkMode === 'online') { objStates[k] = "unlocked"; } 
        else {
            if (mastered.includes(rawTitle)) { objStates[k] = "completed"; previousMastered = true; } 
            else if (previousMastered || window.gameMode === 'practice') { objStates[k] = "unlocked"; previousMastered = false; } 
            else { objStates[k] = "locked"; } 
        }
    }
    
    // --- THEME BRANCHING LOGIC ---
    let equippedTheme = localStorage.getItem('equippedMapTheme') || 'theme-standard';
    
    if (equippedTheme === 'theme-hex') {
        drawHexMap(objectives, objStates, treeContainer);
    } else {
        drawStandardPadlockMap(objectives, objStates, treeContainer);
    }

    if (window.updateGlobalRankAndBanner) window.updateGlobalRankAndBanner();
    switchScreen('screen-dynamic-map');
}
window.openChapterMap = openChapterMap;
window.redrawCurrentMap = () => { if (window.activeChapterId) window.openChapterMap(window.activeChapterId); };

// --- THE CLASSIC PADLOCK MAP ---
function drawStandardPadlockMap(objectives, objStates, treeContainer) {
    for (let i = objectives.length - 1; i >= 0; i--) {
        let obj = objectives[i]; let prereqId = (i > 0) ? "node_" + objectives[i-1].id : null; let safeNodeId = "node_" + obj.id; let positionClass = "center";
        if (!obj.is_boss) positionClass = (i % 2 === 0) ? "left" : "right"; let statusClass = objStates[i]; let icon = "🔒";
        if (statusClass === "completed") icon = "✔️"; if (statusClass === "unlocked") icon = "⚔️"; if (obj.is_boss) icon = (statusClass === "locked") ? "🔒" : "☠️";
        
        let safeTitle = obj.title.replace(/'/g, "\\'"); let safeDesc = obj.desc.replace(/'/g, "\\'");
        let clickAction = (window.networkMode === 'online') ? `openMultiplayerSetup('${safeNodeId}', '${safeTitle}', '${safeDesc}')` : `openMission('${safeNodeId}', '${safeTitle}', '${safeDesc}', '${prereqId}')`;

        let nodeHtml = `<div class="node-wrapper ${positionClass} ${obj.is_boss ? 'boss-wrapper' : ''}" style="cursor: pointer;" onclick="${clickAction}"><div class="node ${obj.is_boss ? 'boss' : ''} ${statusClass}" id="${safeNodeId}"><span class="icon-${statusClass}">${icon}</span></div><div class="node-label-side" ${obj.is_boss ? 'style="color: var(--boss-red); border-color: var(--boss-red);"' : ''}>${obj.is_boss ? obj.title : 'Obj ' + (i+1) + ': ' + obj.title}</div></div>`;
        if (i < objectives.length - 1) { let lineActive = (objStates[i] === "completed" && window.networkMode === 'solo') ? "active" : ""; treeContainer.innerHTML += `<div class="path-line ${lineActive}"></div>`; }
        treeContainer.innerHTML += nodeHtml;
    }
}

// --- THE HEX SVG MAP (NOW WITH PANZOOM & PERFECT CENTERING) ---
function drawHexMap(objectives, objStates, treeContainer) {
    // 1. Inject a massive 3000x3000 canvas for dragging
    treeContainer.innerHTML = `
        <div id="hex-map-window" style="position: relative; width: 100%; height: 100vh; overflow: hidden;">
            <div id="hex-map-canvas" style="position: absolute; width: 3000px; height: 3000px; transform-origin: 0 0;">
                <svg id="connectors" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none;"></svg>
                <div id="nodes-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 2;"></div>
            </div>
        </div>
    `;

    const nodesContainer = document.getElementById('nodes-container');
    const svgConnectors = document.getElementById('connectors');
    let nodesHtml = ''; let svgHtml = '';
    
    // 2. Draw nodes starting at exact Top-Center of the 3000px canvas
    let currentX = 1500 - 50; // Dead center minus half the node width
    let currentY = 400;       // Start 400px down from the top
    let points = []; 

    for (let i = 0; i < objectives.length; i++) {
        let obj = objectives[i]; let prereqId = (i > 0) ? "node_" + objectives[i-1].id : null; let safeNodeId = "node_" + obj.id;
        points.push({ x: currentX + 50, y: currentY + 50, status: objStates[i] });

        let icon = "🔒"; let stateClass = "state-locked";
        if (objStates[i] === "completed") { icon = "✔️"; stateClass = "state-completed"; }
        else if (objStates[i] === "unlocked") { icon = "⚔️"; stateClass = "state-unlocked"; }
        
        if (obj.is_boss && objStates[i] === "locked") { icon = "🔒"; stateClass = "state-boss locked"; } 
        else if (obj.is_boss && objStates[i] === "unlocked") { icon = "☠️"; stateClass = "state-boss"; }

        let shapeClass = obj.is_boss ? "boss-node" : "hex-node";
        let safeTitle = obj.title.replace(/'/g, "\\'"); let safeDesc = obj.desc.replace(/'/g, "\\'");
        
        // Touch-friendly bypass for Panzoom dragging
        let clickAction = (window.networkMode === 'online') 
            ? `if(!window.isDraggingMap) openMultiplayerSetup('${safeNodeId}', '${safeTitle}', '${safeDesc}')` 
            : `if(!window.isDraggingMap) openMission('${safeNodeId}', '${safeTitle}', '${safeDesc}', '${prereqId}')`;

        nodesHtml += `
            <div class="${shapeClass} ${stateClass}" style="position: absolute; left: ${currentX}px; top: ${currentY}px; z-index: 10; cursor: pointer;" 
                 onpointerdown="window.isDraggingMap=false;" 
                 onpointermove="window.isDraggingMap=true;" 
                 onpointerup="${clickAction}">
                <div class="node-icon" style="font-size: 30px; text-align: center; margin-top: ${obj.is_boss ? '30px' : '20px'};">${icon}</div>
                <div class="node-label" style="position: absolute; top: 110%; left: 50%; transform: translateX(-50%); width: 150px; text-align: center; color: white; background: rgba(0,0,0,0.8); padding: 5px; border-radius: 8px; font-size: 12px; border: 1px solid #475569;">${obj.title}</div>
            </div>
        `;

        if (i % 2 === 0) { currentX += 120; currentY += 100; } else { currentX -= 120; currentY += 100; }
    }

    for (let i = 0; i < points.length - 1; i++) {
        let p1 = points[i]; let p2 = points[i+1];
        let strokeColor = p1.status === "completed" ? "#10b981" : "#334155";
        let strokeWidth = p1.status === "completed" ? "6" : "4";
        svgHtml += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;
    }

    nodesContainer.innerHTML = nodesHtml;
    svgConnectors.innerHTML = svgHtml;
    
    // 3. Attach Panzoom and Center exactly on the FIRST node!
    setTimeout(() => {
        let canvas = document.getElementById('hex-map-canvas');
        if (!canvas) return;

        if (window.objectivePanzoom) window.objectivePanzoom.dispose();
        let pz = panzoom(canvas, { maxZoom: 2, minZoom: 0.3 });
        
        let zoomLevel = 1.2; // 👈 Perfect size for objectives
        
        // Target Node 1 is at X:1500, Y:400. 
        let panX = (window.innerWidth / 2) - (1500 * zoomLevel);
        let panY = (window.innerHeight / 3) - (400 * zoomLevel); // Puts the first node 1/3 down the screen
        
        pz.zoomAbs(0, 0, zoomLevel);
        pz.moveTo(panX, panY);
        
        window.objectivePanzoom = pz;
    }, 150);
}

// ==========================================
// 4. STORY ENGINE
// ==========================================
window.storyDatabase = { "season_1": [{ image: "🧑‍🚀", text: "Planet Zero is unstable. We need to repair the logic drive, fast!" }, { image: "☄️", text: "Meteor shower incoming!" }] };
export async function triggerStoryNode() {
    clearInterval(window.questionTimer); 
    let currentStory = localStorage.getItem('equippedStory') || "season_1"; 
    let progressObj = JSON.parse(localStorage.getItem('storyProgress') || '{"season_1": 0}');
    let progressIndex = progressObj[currentStory] || 0; 
    let storyArray = window.storyDatabase[currentStory] || window.storyDatabase["season_1"];
    if (progressIndex >= storyArray.length) progressIndex = storyArray.length - 1; 
    
    let node = storyArray[progressIndex];
    let imgEl = document.getElementById('story-image'); if(imgEl) imgEl.innerText = node.image; 
    let txtEl = document.getElementById('story-text'); if(txtEl) txtEl.innerText = node.text; 
    
    let overlay = document.getElementById('story-overlay');
    if(overlay) {
        overlay.style.display = 'flex';
        let continueBtn = overlay.querySelector('button');
        if (continueBtn) { continueBtn.onclick = (e) => { e.preventDefault(); window.resumeFromStory(); }; }
    }

    progressObj[currentStory] = progressIndex + 1; 
    localStorage.setItem('storyProgress', JSON.stringify(progressObj));
    if (window.currentUserId && !window.currentUserId.startsWith("guest_")) { try { await updateDoc(doc(window.db, "users", window.currentUserId), { [`story_progress.${currentStory}`]: progressObj[currentStory] }); } catch(e){} }
}
window.triggerStoryNode = triggerStoryNode;

export function resumeFromStory() { 
    let overlay = document.getElementById('story-overlay'); if (overlay) overlay.style.display = 'none'; 
    if (typeof window.progressEngine === 'function') window.progressEngine(); 
}
window.resumeFromStory = resumeFromStory;

// ==========================================
// 5. MULTIPLAYER MATCHMAKING LOGIC
// ==========================================
window.toggleNetworkMode = function(mode) {
    window.networkMode = mode;
    let soloBtn = document.getElementById('btn-net-solo'); let onlineBtn = document.getElementById('btn-net-online');
    if(soloBtn && onlineBtn) {
        if (mode === 'solo') {
            soloBtn.style.background = 'var(--accent-blue)'; soloBtn.style.color = 'white'; soloBtn.style.boxShadow = '0 0 15px rgba(59, 130, 246, 0.6)'; soloBtn.style.opacity = '1';
            onlineBtn.style.background = 'transparent'; onlineBtn.style.color = '#cbd5e1'; onlineBtn.style.boxShadow = 'none'; onlineBtn.style.opacity = '0.5';
            document.getElementById('solo-action-buttons').style.display = 'flex'; document.getElementById('online-action-buttons').style.display = 'none';
        } else {
            onlineBtn.style.background = 'var(--completed-green)'; onlineBtn.style.color = 'white'; onlineBtn.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.6)'; onlineBtn.style.opacity = '1';
            soloBtn.style.background = 'transparent'; soloBtn.style.color = '#cbd5e1'; soloBtn.style.boxShadow = 'none'; soloBtn.style.opacity = '0.5';
            document.getElementById('solo-action-buttons').style.display = 'none'; document.getElementById('online-action-buttons').style.display = 'flex';
        }
    }
    window.redrawCurrentMap();
};

window.setOnlineMode = function(subMode) {
    window.onlineSubMode = subMode;
    let studyBtn = document.getElementById('btn-mode-study'); let competeBtn = document.getElementById('btn-mode-compete');
    if(studyBtn && competeBtn) {
        if (subMode === 'study') {
            studyBtn.style.background = 'var(--accent-blue)'; studyBtn.style.color = 'white'; studyBtn.style.boxShadow = '0 0 20px rgba(59, 130, 246, 0.6)'; studyBtn.style.transform = 'scale(1.05)'; studyBtn.style.opacity = '1';
            competeBtn.style.background = 'rgba(0,0,0,0.5)'; competeBtn.style.color = 'var(--boss-red)'; competeBtn.style.boxShadow = 'none'; competeBtn.style.transform = 'scale(1)'; competeBtn.style.opacity = '0.5';
        } else {
            competeBtn.style.background = 'var(--boss-red)'; competeBtn.style.color = 'white'; competeBtn.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.6)'; competeBtn.style.transform = 'scale(1.05)'; competeBtn.style.opacity = '1';
            studyBtn.style.background = 'rgba(0,0,0,0.5)'; studyBtn.style.color = 'var(--accent-blue)'; studyBtn.style.boxShadow = 'none'; studyBtn.style.transform = 'scale(1)'; studyBtn.style.opacity = '0.5';
        }
    }
};

window.openMultiplayerSetup = function(nodeId, title, desc) {
    window.activeMultiplayerObjective = { id: nodeId, title: title, desc: desc };
    let isStudy = (window.onlineSubMode === 'study');
    let mIcon = document.getElementById('mp-modal-icon'); if(mIcon) mIcon.innerText = isStudy ? '🤝' : '⚔️';
    let mTitle = document.getElementById('mp-modal-title'); if(mTitle) { mTitle.innerText = isStudy ? 'Study Online' : 'Compete Online'; mTitle.style.color = isStudy ? 'var(--accent-blue)' : 'var(--boss-red)'; }
    let mDesc = document.getElementById('mp-modal-desc'); if(mDesc) mDesc.innerText = `Objective: ${title}`;
    let modal = document.getElementById('multiplayer-modal'); if(modal) modal.style.display = 'flex';
};

window.currentCurriculumMatchId = null;
window.currMatchListener = null;

window.startCurriculumMatchmaking = async function(type) {
    document.getElementById('multiplayer-modal').style.display = 'none';
    let isStudy = (window.onlineSubMode === 'study');
    
    let loadIcon = document.getElementById('mm-loading-icon'); if(loadIcon) loadIcon.innerText = isStudy ? '🤝' : '⚔️';
    let loadTitle = document.getElementById('mm-loading-title'); if(loadTitle) { loadTitle.innerText = isStudy ? 'Finding Partner...' : 'Finding Opponent...'; loadTitle.style.color = isStudy ? 'var(--accent-blue)' : 'var(--boss-red)'; }
    let loadObj = document.getElementById('mm-loading-objective'); if(loadObj) loadObj.innerText = window.activeMultiplayerObjective.title;
    
    switchScreen('screen-matchmaking');

    try {
        const matchesRef = collection(window.db, "matchmaking");
        const q = query(matchesRef, where("type", "==", "curriculum"), where("objectiveId", "==", window.activeMultiplayerObjective.id), where("mode", "==", window.onlineSubMode), where("status", "==", "waiting"), limit(1));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            let matchDoc = snap.docs[0]; window.currentCurriculumMatchId = matchDoc.id;
            await updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { player2: window.currentUserId, player2Name: window.playerUsername, status: "playing" });
            listenToCurriculumMatch(window.currentCurriculumMatchId);
        } else {
            const newMatch = await addDoc(matchesRef, { type: "curriculum", objectiveId: window.activeMultiplayerObjective.id, objectiveTitle: window.activeMultiplayerObjective.title, mode: window.onlineSubMode, player1: window.currentUserId, player1Name: window.playerUsername, player2: null, player2Name: null, status: "waiting", timestamp: new Date() });
            window.currentCurriculumMatchId = newMatch.id;
            listenToCurriculumMatch(window.currentCurriculumMatchId);
        }
    } catch (e) { console.error("Matchmaking error:", e); alert("Error connecting to matchmaking servers."); switchScreen('screen-dynamic-map'); }
};

window.openCurriculumFriendInvite = function() {
    document.getElementById('multiplayer-modal').style.display = 'none';
    let err = document.getElementById('curr-invite-error'); if (err) err.style.display = 'none';
    let input = document.getElementById('curriculum-friend-input'); if (input) input.value = "";
    document.getElementById('friend-invite-modal').style.display = 'flex';
};

window.sendCurriculumFriendChallenge = async function() {
    let targetName = document.getElementById('curriculum-friend-input').value.trim();
    let errorMsg = document.getElementById('curr-invite-error');
    if (!targetName) { errorMsg.innerText = "Please enter a username."; errorMsg.style.display = "block"; return; }
    if (targetName.toLowerCase() === window.playerUsername.toLowerCase()) { errorMsg.innerText = "You can't challenge yourself!"; errorMsg.style.display = "block"; return; }

    errorMsg.style.display = "none"; document.getElementById('friend-invite-modal').style.display = 'none';

    try {
        const q = query(collection(window.db, "users"), where("username", "==", targetName), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) { alert("User not found! Check spelling."); return window.openCurriculumFriendInvite(); }
        
        let friendId = snap.docs[0].id; let isStudy = (window.onlineSubMode === 'study');
        let loadTitle = document.getElementById('mm-loading-title'); if(loadTitle) loadTitle.innerText = `Waiting for ${targetName}...`;
        let loadObj = document.getElementById('mm-loading-objective'); if(loadObj) loadObj.innerText = window.activeMultiplayerObjective.title;
        switchScreen('screen-matchmaking');

        const newMatch = await addDoc(collection(window.db, "matchmaking"), { type: "curriculum", objectiveId: window.activeMultiplayerObjective.id, objectiveTitle: window.activeMultiplayerObjective.title, mode: window.onlineSubMode, player1: window.currentUserId, player1Name: window.playerUsername, player2: null, player2Name: null, status: "waiting_friend", timestamp: new Date() });
        window.currentCurriculumMatchId = newMatch.id;

        await addDoc(collection(window.db, "invites"), { senderId: window.currentUserId, senderName: window.playerUsername, targetId: friendId, matchId: window.currentCurriculumMatchId, gameId: "curriculum_map", gameName: window.activeMultiplayerObjective.title, status: "pending", timestamp: new Date() });
        listenToCurriculumMatch(window.currentCurriculumMatchId);
    } catch (e) { console.error("Invite error:", e); alert("Something went wrong sending the invite."); switchScreen('screen-dynamic-map'); }
};

window.activeIncomingInvite = null;
window.startInviteListener = function() {
    if (!window.currentUserId || window.currentUserId.startsWith("guest_")) return;
    const invitesRef = collection(window.db, "invites");
    const q = query(invitesRef, where("targetId", "==", window.currentUserId), where("status", "==", "pending"));
    onSnapshot(q, (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === "added") {
                let invite = change.doc.data(); window.activeIncomingInvite = { id: change.doc.id, ...invite };
                let sName = document.getElementById('invite-sender-name'); if(sName) sName.innerText = invite.senderName;
                let gName = document.getElementById('invite-game-name'); if(gName) gName.innerText = invite.gameName;
                let mod = document.getElementById('incoming-invite-modal'); if(mod) mod.style.display = 'flex';
            }
        });
    });
};

window.acceptCurriculumInvite = async function() {
    if (!window.activeIncomingInvite) return;
    document.getElementById('incoming-invite-modal').style.display = 'none';
    let matchId = window.activeIncomingInvite.matchId; let inviteId = window.activeIncomingInvite.id;

    try {
        await updateDoc(doc(window.db, "matchmaking", matchId), { player2: window.currentUserId, player2Name: window.playerUsername, status: "playing" });
        await updateDoc(doc(window.db, "invites", inviteId), { status: "accepted" });
        window.currentCurriculumMatchId = matchId; window.activeMultiplayerObjective = { id: "invite", title: window.activeIncomingInvite.gameName };
        listenToCurriculumMatch(matchId);
    } catch(e) { console.error("Error accepting invite:", e); }
};

window.declineCurriculumInvite = async function() {
    if (!window.activeIncomingInvite) return;
    document.getElementById('incoming-invite-modal').style.display = 'none';
    try { await updateDoc(doc(window.db, "invites", window.activeIncomingInvite.id), { status: "declined" }); } catch(e){}
    window.activeIncomingInvite = null;
};

function listenToCurriculumMatch(mId) {
    if (window.currMatchListener) window.currMatchListener(); 
    window.currMatchListener = onSnapshot(doc(window.db, "matchmaking", mId), (docSnap) => {
        if (!docSnap.exists()) return;
        let data = docSnap.data();
        if (data.status === "playing") {
            if (window.currMatchListener) window.currMatchListener();
            let loadIcon = document.getElementById('mm-loading-icon'); if(loadIcon) loadIcon.innerText = "✅";
            let loadTitle = document.getElementById('mm-loading-title'); if(loadTitle) { loadTitle.innerText = "MATCH FOUND!"; loadTitle.style.color = "var(--completed-green)"; }
            setTimeout(() => { if(window.initMultiplayerArena) window.initMultiplayerArena(data); }, 1000);
        }
    });
}

window.cancelCurriculumMatchmaking = async function() {
    if (window.currMatchListener) window.currMatchListener();
    if (window.currentCurriculumMatchId) { try { await deleteDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId)); } catch(e){} }
    window.currentCurriculumMatchId = null; switchScreen('screen-dynamic-map');
};

// ==========================================
// 6. CO-OP & PVP GAME STATE LOGIC
// ==========================================
window.amIPlayer1 = false;
window.initMultiplayerArena = function(matchData) {
    window.amIPlayer1 = (matchData.player1 === window.currentUserId);
    let myName = window.amIPlayer1 ? matchData.player1Name : matchData.player2Name;
    let oppName = window.amIPlayer1 ? matchData.player2Name : matchData.player1Name;
    
    let cMy = document.getElementById('coop-my-name'); if(cMy) cMy.innerText = myName; 
    let cOpp = document.getElementById('coop-opp-name'); if(cOpp) cOpp.innerText = oppName; 
    let cObj = document.getElementById('coop-objective-name'); if(cObj) cObj.innerText = matchData.objectiveTitle;
    let pMy = document.getElementById('pvp-my-name'); if(pMy) pMy.innerText = myName; 
    let pOpp = document.getElementById('pvp-opp-name'); if(pOpp) pOpp.innerText = oppName; 
    let pObj = document.getElementById('pvp-objective-name'); if(pObj) pObj.innerText = matchData.objectiveTitle;
    
    if (matchData.mode === 'study') switchScreen('screen-coop'); else switchScreen('screen-pvp');

    if (window.amIPlayer1 && !matchData.questions) {
        let allQs = window.mockDatabase.filter(q => q.atomic_objective === window.activeMultiplayerObjective.title);
        if (allQs.length === 0) allQs = [{ question: "7 × 8?", answer: "56", options: ["54", "56", "62", "64"] }, { question: "3x = 21, x = ?", answer: "7", options: ["6", "7", "8", "9"] }, { question: "15% of 200?", answer: "30", options: ["15", "25", "30", "35"] }];
        
        let updateData = {};
        if (matchData.mode === 'study') {
            updateData.questions = allQs.sort(() => 0.5 - Math.random()).slice(0, 3);
            updateData.currentQuestionIndex = 0; updateData.p1Answer = null; updateData.p2Answer = null;
        } else {
            updateData.questions = allQs.sort(() => 0.5 - Math.random()).slice(0, 30);
            updateData.p1Score = 0; updateData.p2Score = 0;
            updateData.matchStartTime = Date.now() + 3000; 
        }
        updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), updateData);
    }

    window.currMatchListener = onSnapshot(doc(window.db, "matchmaking", window.currentCurriculumMatchId), (docSnap) => {
        if (!docSnap.exists()) { alert("Match was closed!"); window.forfeitCurriculumMatch(); return; }
        let liveData = docSnap.data();
        
        if (liveData.status === "forfeited") { 
            if (liveData.mode === 'compete' && window.isPvPActive) { let oS = document.getElementById('pvp-opp-score'); if(oS) oS.innerText = "FLED"; window.pvpMyScore += 999; window.endPvPMatch(); } 
            else { alert("Opponent left the session!"); window.forfeitCurriculumMatch(); }
            return; 
        }
        
        if (liveData.mode === 'study') {
            if (liveData.chatLog) window.renderCoopChat(liveData.chatLog);
            if (liveData.questions && liveData.questions.length > 0) window.handleCoopGameState(liveData);
        } else if (liveData.mode === 'compete') {
            if (liveData.questions && liveData.questions.length > 0) window.handlePvPGameState(liveData);
        }
    });
};

window.sendCoopChat = async function() {
    let inputEl = document.getElementById('coop-chat-input'); let msg = inputEl.value.trim();
    if (!msg || !window.currentCurriculumMatchId) return; inputEl.value = ""; 
    let chatPacket = { senderId: window.currentUserId, senderName: window.playerUsername, text: msg, timestamp: Date.now() };
    try {
        await updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { chatLog: arrayUnion(chatPacket) });
        if (msg.includes("?") || msg.toLowerCase().includes("help") || msg.toLowerCase().includes("ai")) window.triggerCoopAITutor(msg);
    } catch(e) { console.error("Chat error:", e); }
};

window.renderCoopChat = function(chatArray) {
    let box = document.getElementById('coop-chat-box'); if(!box) return;
    let isScrolledToBottom = box.scrollHeight - box.clientHeight <= box.scrollTop + 10;
    let html = `<div style="text-align: center; color: var(--completed-green); font-size: 12px; margin-bottom: 10px;">🔒 Secure peer-to-peer connection established.<br>The AI Tutor is actively monitoring this chat to help you!</div>`;
    
    chatArray.forEach(msg => {
        let isMe = (msg.senderId === window.currentUserId); let isAI = (msg.senderId === "ai_tutor");
        if (isAI) html += `<div style="display: flex; flex-direction: column; align-items: center; margin: 10px 0;"><div style="background: rgba(59, 130, 246, 0.2); border: 1px solid var(--accent-blue); padding: 10px 15px; border-radius: 12px; max-width: 80%; color: #e2e2e2; font-size: 14px; text-align: center;"><strong style="color: var(--accent-blue);">🤖 AI Tutor:</strong><br>${msg.text}</div></div>`;
        else if (isMe) html += `<div style="display: flex; flex-direction: column; align-items: flex-end;"><span style="font-size: 10px; color: #64748b; margin-bottom: 2px;">You</span><div style="background: var(--accent-blue); color: white; padding: 10px 15px; border-radius: 12px 12px 0 12px; max-width: 75%; font-size: 15px;">${msg.text}</div></div>`;
        else html += `<div style="display: flex; flex-direction: column; align-items: flex-start;"><span style="font-size: 10px; color: #fbbf24; margin-bottom: 2px;">${msg.senderName}</span><div style="background: #334155; color: white; padding: 10px 15px; border-radius: 12px 12px 12px 0; max-width: 75%; font-size: 15px; border: 1px solid #475569;">${msg.text}</div></div>`;
    });
    box.innerHTML = html; if (isScrolledToBottom) box.scrollTop = box.scrollHeight;
};

window.triggerCoopAITutor = async function(userMsg) {
    setTimeout(async () => {
        let aiPacket = { senderId: "ai_tutor", senderName: "AI Tutor", text: "I am analyzing the current objective data to help you with that...", timestamp: Date.now() };
        try { await updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { chatLog: arrayUnion(aiPacket) }); } catch(e) {}
    }, 1500); 
};

window.forfeitCurriculumMatch = async function() {
    if (window.currMatchListener) window.currMatchListener();
    if (window.currentCurriculumMatchId) { try { await updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { status: "forfeited" }); } catch(e){} }
    window.currentCurriculumMatchId = null; switchScreen('screen-dynamic-map');
};

window.handleCoopGameState = function(data) {
    let qIndex = data.currentQuestionIndex; let statusEl = document.getElementById('coop-status-msg'); let container = document.getElementById('coop-options-container');
    if (qIndex >= data.questions.length) {
        let qEl = document.getElementById('coop-question-text'); if(qEl) { qEl.innerText = "🎉 Objective Mastered! 🎉"; qEl.style.color = "var(--completed-green)"; }
        if(statusEl) { statusEl.innerText = "Excellent teamwork!"; statusEl.style.color = "white"; }
        if(container) container.innerHTML = `<button class="btn btn-primary" style="font-size: 20px; padding: 15px 40px;" onclick="finishCoopMatch()">Claim Rewards & Exit</button>`;
        return;
    }

    let q = data.questions[qIndex]; let qEl = document.getElementById('coop-question-text'); if(qEl) { qEl.innerText = q.question; qEl.style.color = "white"; }
    let myAnswer = window.amIPlayer1 ? data.p1Answer : data.p2Answer; let oppAnswer = window.amIPlayer1 ? data.p2Answer : data.p1Answer;

    if (!myAnswer && !oppAnswer) { if(statusEl){ statusEl.innerText = "Discuss and select an answer."; statusEl.style.color = "#cbd5e1"; } } 
    else if (myAnswer && !oppAnswer) { if(statusEl){ statusEl.innerText = "Waiting for partner to answer..."; statusEl.style.color = "#fbbf24"; } } 
    else if (!myAnswer && oppAnswer) { if(statusEl){ statusEl.innerText = "Partner selected an answer. Your turn!"; statusEl.style.color = "#fbbf24"; } } 
    else if (myAnswer && oppAnswer) {
        if (myAnswer === oppAnswer) {
            if (myAnswer === q.answer) {
                if(statusEl){ statusEl.innerText = "✅ Both agreed! Correct!"; statusEl.style.color = "var(--completed-green)"; }
                if (window.amIPlayer1) setTimeout(() => { updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { currentQuestionIndex: qIndex + 1, p1Answer: null, p2Answer: null }); }, 2000);
            } else {
                if(statusEl){ statusEl.innerText = "❌ Both agreed, but it's incorrect! Try again."; statusEl.style.color = "var(--boss-red)"; }
                if (window.amIPlayer1) setTimeout(() => { updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { p1Answer: null, p2Answer: null }); }, 2500);
            }
        } else {
            if(statusEl){ statusEl.innerText = "⚠️ Answers don't match! Discuss and try again."; statusEl.style.color = "var(--boss-red)"; }
            if (window.amIPlayer1) setTimeout(() => { updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { p1Answer: null, p2Answer: null }); }, 2500);
        }
    }

    let opts = q.options || [q.answer, q.answer + "1", "0", "None"]; if(container) container.innerHTML = "";
    opts.forEach(opt => {
        let btn = document.createElement('button'); btn.className = "btn"; btn.style.cssText = "font-size: 20px; padding: 15px 30px; min-width: 150px; font-weight: bold;"; btn.innerText = opt;
        if (myAnswer === opt) { btn.style.background = "var(--accent-blue)"; btn.style.color = "white"; btn.style.borderColor = "var(--accent-blue)"; } 
        else if (oppAnswer === opt) { btn.style.boxShadow = "0 0 15px #fbbf24"; btn.style.borderColor = "#fbbf24"; btn.style.color = "#fbbf24"; }
        btn.onclick = () => window.submitCoopAnswer(opt);
        if(container) container.appendChild(btn);
    });
};

window.submitCoopAnswer = async function(ans) {
    if (!window.currentCurriculumMatchId) return;
    let status = document.getElementById('coop-status-msg'); if(status && (status.innerText.includes("Answers don't match") || status.innerText.includes("incorrect"))) return;
    let field = window.amIPlayer1 ? "p1Answer" : "p2Answer";
    try { await updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { [field]: ans }); } catch(e) {}
};

window.finishCoopMatch = async function() {
    window.globalXP += 250; let gold = parseInt(localStorage.getItem('mockGold') || "0") + 50; localStorage.setItem('mockGold', gold);
    if (window.currentUserId && !window.currentUserId.startsWith("guest_")) { try { await updateDoc(doc(window.db, "users", window.currentUserId), { "economy.global_xp": window.globalXP, "economy.gold": gold }); } catch(e) {} }
    alert("Teamwork makes the dream work! (+250 XP, +50 Gold)"); if(window.updateGlobalHUD) window.updateGlobalHUD(); window.forfeitCurriculumMatch(); 
};

window.pvpMyScore = 0; window.pvpQuestionIndex = 0; window.pvpTimerInterval = null; window.pvpTimeLeft = 45; window.isPvPActive = false; window.pvpQuestions = [];

window.handlePvPGameState = function(data) {
    window.pvpQuestions = data.questions; let oppScore = window.amIPlayer1 ? data.p2Score : data.p1Score;
    let oS = document.getElementById('pvp-opp-score'); if(oS) oS.innerText = oppScore || 0;
    
    if (!window.isPvPActive && data.matchStartTime) {
        let delay = data.matchStartTime - Date.now();
        if (delay > 0) { let qEl = document.getElementById('pvp-question-text'); if(qEl) qEl.innerText = "GET READY..."; setTimeout(() => window.startPvPClient(), delay); } 
        else { window.startPvPClient(); }
    }
};

window.startPvPClient = function() {
    if (window.isPvPActive) return; window.isPvPActive = true; window.pvpMyScore = 0; window.pvpQuestionIndex = 0; window.pvpTimeLeft = 45;
    let mS = document.getElementById('pvp-my-score'); if(mS) mS.innerText = window.pvpMyScore;
    window.renderPvPQuestion();
    
    if (window.pvpTimerInterval) clearInterval(window.pvpTimerInterval);
    window.pvpTimerInterval = setInterval(() => {
        window.pvpTimeLeft--; let tEl = document.getElementById('pvp-timer'); if(tEl) tEl.innerText = `⏱️ ${window.pvpTimeLeft}s`;
        if (window.pvpTimeLeft <= 0) { window.endPvPMatch(); }
    }, 1000);
};

window.renderPvPQuestion = function() {
    if (window.pvpQuestionIndex >= window.pvpQuestions.length) window.pvpQuestionIndex = 0; 
    let q = window.pvpQuestions[window.pvpQuestionIndex]; let qEl = document.getElementById('pvp-question-text');
    if(qEl) { qEl.innerText = q.question; qEl.style.color = "white"; qEl.style.transform = "scale(1)"; }
    
    let container = document.getElementById('pvp-options-container'); if(container) container.innerHTML = "";
    let opts = q.options || [q.answer, q.answer + "1", "0", "None"]; opts = [...opts].sort(() => 0.5 - Math.random());
    
    opts.forEach(opt => {
        let btn = document.createElement('button'); btn.className = "btn"; btn.style.cssText = "font-size: 20px; padding: 15px 30px; min-width: 150px; font-weight: bold; background: rgba(0,0,0,0.5);"; btn.innerText = opt;
        btn.onclick = () => window.submitPvPAnswer(opt, q.answer); if(container) container.appendChild(btn);
    });
};

window.submitPvPAnswer = function(selected, correct) {
    if (!window.isPvPActive) return;
    let qEl = document.getElementById('pvp-question-text');
    if (selected === correct) { window.pvpMyScore++; if(qEl) qEl.style.color = "var(--completed-green)"; } 
    else { window.pvpMyScore--; if(qEl) qEl.style.color = "var(--boss-red)"; }
    
    if(qEl) qEl.style.transform = "scale(1.1)"; 
    let mS = document.getElementById('pvp-my-score'); if(mS) mS.innerText = window.pvpMyScore;
    
    let field = window.amIPlayer1 ? "p1Score" : "p2Score";
    try { updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { [field]: window.pvpMyScore }); } catch(e){}
    
    window.pvpQuestionIndex++; setTimeout(() => window.renderPvPQuestion(), 150); 
};

window.endPvPMatch = function() {
    window.isPvPActive = false; clearInterval(window.pvpTimerInterval);
    let c = document.getElementById('pvp-options-container'); if(c) c.innerHTML = "";
    
    let oppScoreText = document.getElementById('pvp-opp-score')?.innerText || "0"; let oppScore = oppScoreText === "FLED" ? -999 : parseInt(oppScoreText);
    let qEl = document.getElementById('pvp-question-text');
    
    if (window.pvpMyScore > oppScore) {
        if(qEl) { qEl.innerText = "VICTORY!"; qEl.style.color = "var(--completed-green)"; } window.globalXP += 100;
        let gold = parseInt(localStorage.getItem('mockGold') || "0") + 50; localStorage.setItem('mockGold', gold);
        if (window.currentUserId && !window.currentUserId.startsWith("guest_")) { try { updateDoc(doc(window.db, "users", window.currentUserId), { "economy.global_xp": window.globalXP, "economy.gold": gold }); } catch(e) {} }
        alert("You Won! (+100 XP, +50 Gold)");
    } else if (window.pvpMyScore < oppScore) {
        if(qEl) { qEl.innerText = "DEFEAT"; qEl.style.color = "var(--boss-red)"; } alert("You Lost! Better luck next time.");
    } else {
        if(qEl) { qEl.innerText = "DRAW!"; qEl.style.color = "white"; } alert("It's a Tie!");
    }
    
    if(window.updateGlobalHUD) window.updateGlobalHUD(); setTimeout(() => { window.forfeitCurriculumMatch(); }, 2000);
};

window.addEventListener('beforeunload', (e) => {
    if (window.currentCurriculumMatchId) { try { updateDoc(doc(window.db, "matchmaking", window.currentCurriculumMatchId), { status: "forfeited" }); } catch(err){} }
});