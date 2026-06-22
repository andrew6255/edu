path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\views\LobbyView.tsx'
with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

old = """  // \u2500\u2500 On mount: restore or create lobby \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  useEffect(() => {
    if (!myUid) return;

    async function init() {
      setInitializing(true);

      // 1. Check for a pending join from a notification
      const pendingLobbyId = localStorage.getItem('ll:pendingLobbyId');
      if (pendingLobbyId) {
        localStorage.removeItem('ll:pendingLobbyId');
        const doc = await getLobbyDoc(pendingLobbyId);
        if (doc && doc.state === 'waiting' && doc.players.length < LOBBY_MAX_PLAYERS) {
          const emoji = DEFAULT_EMOJI_LIST[Math.floor(Math.random() * DEFAULT_EMOJI_LIST.length)];
          const result = await joinLobby({ lobbyId: pendingLobbyId, uid: myUid, username: myUsername, emoji });
          if (result.success) {
            await setUserLobby(myUid, pendingLobbyId);
            setLobbyId(pendingLobbyId);
            setLaunchHandled(false);
            setInitializing(false);
            return;
          }
        }
      }

      // 2. Check if user is already in a lobby (from userPresence)
      const existingId = await getUserLobbyId(myUid);
      if (existingId) {
        const doc = await getLobbyDoc(existingId);
        if (doc && doc.players.some(p => p.uid === myUid)) {
          setLobbyId(existingId);
          setLaunchHandled(false);
          setInitializing(false);
          return;
        }
      }

      // 3. Create a fresh personal lobby
      const emoji = DEFAULT_EMOJI_LIST[0];
      const doc = await createLobby({ uid: myUid, username: myUsername, emoji });
      await setUserLobby(myUid, doc.id);
      setLobbyId(doc.id);
      setLaunchHandled(false);
      setInitializing(false);
    }

    init().catch(() => setInitializing(false));
  }, [myUid]);"""

new = """  // \u2500\u2500 On mount: restore or create lobby \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  useEffect(() => {
    if (!myUid) return;

    async function init() {
      setInitializing(true);

      // 1. Check for a pending join from a notification
      const pendingLobbyId = localStorage.getItem('ll:pendingLobbyId');
      if (pendingLobbyId) {
        localStorage.removeItem('ll:pendingLobbyId');
        const pendingDoc = await getLobbyDoc(pendingLobbyId);
        const alreadyIn = pendingDoc?.players.some(p => p.uid === myUid);

        if (pendingDoc && !alreadyIn && pendingDoc.state === 'waiting' && pendingDoc.players.length < LOBBY_MAX_PLAYERS) {
          // Leave current solo lobby first
          const currentId = await getUserLobbyId(myUid);
          if (currentId && currentId !== pendingLobbyId) {
            await leaveLobby(currentId, myUid).catch(() => {});
          }
          const emoji = DEFAULT_EMOJI_LIST[Math.floor(Math.random() * DEFAULT_EMOJI_LIST.length)];
          const result = await joinLobby({ lobbyId: pendingLobbyId, uid: myUid, username: myUsername, emoji });
          if (result.success) {
            await setUserLobby(myUid, pendingLobbyId);
            setLobbyId(pendingLobbyId);
            setLaunchHandled(false);
            setInitializing(false);
            return;
          }
        } else if (alreadyIn && pendingDoc) {
          await setUserLobby(myUid, pendingLobbyId);
          setLobbyId(pendingLobbyId);
          setLaunchHandled(false);
          setInitializing(false);
          return;
        }
      }

      // 2. Check if user is already in a lobby (from userPresence)
      const existingId = await getUserLobbyId(myUid);
      if (existingId) {
        const doc = await getLobbyDoc(existingId);
        if (doc && doc.players.some(p => p.uid === myUid)) {
          setLobbyId(existingId);
          setLaunchHandled(false);
          setInitializing(false);
          return;
        }
      }

      // 3. Create a fresh personal lobby
      const emoji = DEFAULT_EMOJI_LIST[0];
      const doc = await createLobby({ uid: myUid, username: myUsername, emoji });
      await setUserLobby(myUid, doc.id);
      setLobbyId(doc.id);
      setLaunchHandled(false);
      setInitializing(false);
    }

    init().catch(() => setInitializing(false));
  }, [myUid]);"""

if old in code:
    code = code.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(code)
    print("Done")
else:
    print("NOT FOUND - checking init section:")
    idx = code.find('On mount: restore')
    if idx >= 0:
        print(repr(code[idx:idx+200]))
