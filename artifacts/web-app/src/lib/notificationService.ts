import { respondToFriendRequest, AppNotification } from '@/lib/userService';
import { setGlobalDoc } from '@/lib/supabaseDocStore';
import { respondToChallenge, respondToLogicGameChallenge } from '@/lib/gameSessionService';
import { acceptJoinRequest } from '@/lib/lobbyService';

/**
 * Handles accepting a notification.
 */
export async function acceptAppNotification(n: AppNotification, userUid: string) {
  if (n.type === 'friendRequest') {
    await respondToFriendRequest(userUid, n.fromUid, true);
    await setGlobalDoc(`notifications:${userUid}`, n.id, {
      message: `You are now friends with ${n.fromUsername}.`,
      type: 'system',
      resolved: true,
      resolvedAt: new Date().toISOString(),
      read: true,
    } as any, true);
  } else if (n.type === 'challenge') {
    if (!n.challengeId || !n.gameId) return;
    const isLogicGame = (n as any).kind === 'logicGame' || String(n.gameId || '').startsWith('logicGame:');

    if (isLogicGame) {
      const { getUserData } = await import('@/lib/userService');
      const ud = await getUserData(userUid);
      const res = await respondToLogicGameChallenge(
        n.challengeId,
        true,
        userUid,
        ud?.username || userUid
      );
      if (res?.matchId) {
        localStorage.setItem('ll:logicGameFriendMatchId', res.matchId);
        if ((n as any).logicGameNodeId) localStorage.setItem('ll:logicGameNodeId', String((n as any).logicGameNodeId));
        window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'logic' } }));
      }
    } else {
      const { getUserData } = await import('@/lib/userService');
      const ud = await getUserData(userUid);
      const session = await respondToChallenge(
        n.challengeId,
        true,
        userUid,
        ud?.username || userUid
      );

      if (session) {
        window.dispatchEvent(new CustomEvent('ll:setPendingSession', { detail: { session, gameId: n.gameId } }));
        window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'warmup' } }));
      }
    }
    
    await setGlobalDoc(`notifications:${userUid}`, n.id, {
      resolved: true,
      resolvedAt: new Date().toISOString(),
      read: true,
    } as any, true);
  } else if (n.type === 'lobbyJoinRequest') {
    if (n.lobbyId && n.fromUid) {
      await acceptJoinRequest({
        leaderUid: userUid,
        lobbyId: n.lobbyId,
        requesterUid: n.fromUid,
        requesterUsername: n.fromUsername,
        requesterEmoji: (n as any).fromEmoji || '😎',
      });
    }
    await setGlobalDoc(`notifications:${userUid}`, n.id, {
      resolved: true,
      resolvedAt: new Date().toISOString(),
      read: true,
    } as any, true);
  } else if (n.type === 'lobbyInvite') {
    if (n.lobbyId) {
      localStorage.setItem('ll:pendingLobbyId', n.lobbyId);
      window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'lobby' } }));
    }
    await setGlobalDoc(`notifications:${userUid}`, n.id, {
      resolved: true,
      resolvedAt: new Date().toISOString(),
      read: true,
    } as any, true);
  }
}

/**
 * Handles dismissing a notification without explicit rejection if possible, 
 * or just marks it read so it doesn't pop up again.
 */
export async function dismissAppNotification(n: AppNotification, userUid: string) {
  // We just mark it read so it stops triggering the new notification toast.
  // The user can still respond to it later in the Notifications view.
  await setGlobalDoc(`notifications:${userUid}`, n.id, {
    read: true,
  } as any, true);
}
