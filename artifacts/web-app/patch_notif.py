path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\views\NotificationsView.tsx'
with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# Add import for acceptJoinRequest
old_import = "import { listenChallengeState, respondToChallenge, respondToLogicGameChallenge } from '@/lib/gameSessionService';"
new_import = old_import + "\nimport { acceptJoinRequest } from '@/lib/lobbyService';"
code = code.replace(old_import, new_import)

# Add handleJoinRequest before handleLobbyInvite
new_handler = """  async function handleJoinRequest(n: AppNotification, accept: boolean) {
    if (!user) return;
    if (accept && n.lobbyId && n.fromUid) {
      await acceptJoinRequest({
        leaderUid: user.uid,
        lobbyId: n.lobbyId,
        requesterUid: n.fromUid,
        requesterUsername: n.fromUsername,
        requesterEmoji: (n as any).fromEmoji || '\U0001f60e',
      });
    }
    await setGlobalDoc(`notifications:${user.uid}`, n.id, {
      resolved: true,
      resolvedAt: new Date().toISOString(),
      read: true,
    } as any, true);
  }

  async function handleLobbyInvite"""

code = code.replace("  async function handleLobbyInvite", new_handler)

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)
print("Done")
