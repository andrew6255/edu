import { Router, type IRouter, type Request, type Response } from 'express';
import { callServiceRpc, verifySupabaseToken } from '../../lib/supabaseServer';
import { gradePublishedQuestion, parseProgramAnswer } from './programGrading';

const router: IRouter = Router();
const studyWindows = new Map<string, { startedAt: number; count: number }>();
const curriculumObjectiveXp: Record<string, number> = {
  'cambridge_y9:number:n1':50,'cambridge_y9:number:n2':50,'cambridge_y9:number:n3':60,'cambridge_y9:number:n4':60,
  'cambridge_y9:number:n5':50,'cambridge_y9:number:n6':40,'cambridge_y9:number:n7':60,'cambridge_y9:number:n8':60,
  'cambridge_y9:algebra:a1':50,'cambridge_y9:algebra:a2':60,'cambridge_y9:algebra:a3':70,'cambridge_y9:algebra:a4':50,
  'cambridge_y9:algebra:a5':60,'cambridge_y9:algebra:a6':70,'cambridge_y9:algebra:a7':60,'cambridge_y9:algebra:a8':60,
  'cambridge_y9:algebra:a9':70,'cambridge_y9:algebra:a10':80,
  'cambridge_y9:geometry:g1':50,'cambridge_y9:geometry:g2':60,'cambridge_y9:geometry:g3':60,'cambridge_y9:geometry:g4':70,
  'cambridge_y9:geometry:g5':60,'cambridge_y9:geometry:g6':70,'cambridge_y9:geometry:g7':70,'cambridge_y9:geometry:g8':80,
  'cambridge_y9:statistics:s1':50,'cambridge_y9:statistics:s2':50,'cambridge_y9:statistics:s3':60,
  'cambridge_y9:statistics:s4':60,'cambridge_y9:statistics:s5':50,'cambridge_y9:statistics:s6':70,
  'cambridge_y9:boss_algebra:b1':100,'cambridge_y9:boss_algebra:b2':120,'cambridge_y9:boss_algebra:b3':100,
  'cambridge_y9:boss_algebra:b4':120,'cambridge_y9:boss_algebra:b5':150,
};

function consumeStudyRateLimit(userId: string): boolean {
  const now = Date.now();
  const current = studyWindows.get(userId);
  if (!current || now - current.startedAt >= 60_000) {
    studyWindows.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 60) return false;
  current.count += 1;
  return true;
}

function safeSourceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 520 ? trimmed : null;
}

router.post('/economy/daily-energy', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const day = new Date().toISOString().slice(0, 10);
    const result = await callServiceRpc<{ applied: boolean; balance: Record<string, number> }>('economy_grant_event', {
      p_user_id: user.id,
      p_event_key: 'daily_energy:' + day,
      p_event_type: 'daily_energy',
      p_source_id: day,
      p_gold: 0,
      p_xp: 0,
      p_energy: 5,
      p_gems: 0,
      p_metadata: { refill: 5 },
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Daily Energy claim failed.' });
  }
});

router.post('/economy/study-answer', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const sourceId = safeSourceId((req.body as Record<string, unknown> | null)?.sourceId);
    const answer = parseProgramAnswer((req.body as Record<string, unknown> | null)?.answer);
    const match = sourceId?.match(/^program:(.{1,200}):solo:(.{3,300})$/);
    if (!sourceId || !match || !answer) { res.status(400).json({ error: 'A published solo-program question and answer are required.' }); return; }
    if (!consumeStudyRateLimit(user.id)) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'Too many study reward requests. Please wait a minute.' }); return; }
    const grade = await gradePublishedQuestion(match[1]!, match[2]!, answer);
    if (grade.status !== 'graded') { res.status(409).json({ error: 'This answer requires verified review.', grade }); return; }
    const result = await callServiceRpc<{ applied: boolean; balance: Record<string, number> }>('economy_record_solo_program_answer', {
      p_user_id: user.id,
      p_program_id: match[1],
      p_question_id: match[2],
      p_correct: grade.correct,
    });
    res.json({ ...result, grade });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Study reward failed.';
    res.status(/not found|not part|invalid/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/ranked-program-answer', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const programId = typeof body?.programId === 'string' ? body.programId.trim() : '';
    const questionId = typeof body?.questionId === 'string' ? body.questionId.trim() : '';
    const answer = parseProgramAnswer(body?.answer);
    if (!programId || programId.length > 200 || questionId.length < 3 || questionId.length > 300 || !answer) {
      res.status(400).json({ error: 'A valid ranked program answer is required.' }); return;
    }
    if (!consumeStudyRateLimit(user.id)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Too many study reward requests. Please wait a minute.' }); return;
    }
    const grade = await gradePublishedQuestion(programId, questionId, answer);
    if (grade.status !== 'graded') { res.status(409).json({ error: 'This answer requires verified review.', grade }); return; }
    const result = await callServiceRpc<Record<string, unknown>>('economy_record_ranked_program_answer', {
      p_user_id: user.id, p_program_id: programId, p_question_id: questionId, p_correct: grade.correct,
    });
    res.json({ ...result, grade });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ranked answer failed.';
    res.status(/not found|not part|invalid/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/program-grade', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const programId = typeof body?.programId === 'string' ? body.programId.trim() : '';
    const questionId = typeof body?.questionId === 'string' ? body.questionId.trim() : '';
    const answer = parseProgramAnswer(body?.answer);
    if (!programId || programId.length > 200 || questionId.length < 3 || questionId.length > 300 || !answer) {
      res.status(400).json({ error: 'A valid published-program answer is required.' }); return;
    }
    if (!consumeStudyRateLimit(user.id)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Too many grading requests. Please wait a minute.' }); return;
    }
    const grade = await gradePublishedQuestion(programId, questionId, answer, { gradeFreeform: true });
    res.json({ grade });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Program grading failed.';
    res.status(/not found|not part|deterministic|invalid/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/roadmap-reward', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const programId = typeof body?.programId === 'string' ? body.programId.trim() : '';
    const milestone = body?.milestone;
    if (!programId || programId.length > 200 || !Number.isInteger(milestone) || (milestone as number) <= 0 || (milestone as number) % 100 !== 0) {
      res.status(400).json({ error: 'A valid program and roadmap milestone are required.' });
      return;
    }
    const result = await callServiceRpc<{ applied: boolean; balance: Record<string, number>; reward: { gold: number } }>('economy_claim_roadmap_reward', {
      p_user_id: user.id,
      p_program_id: programId,
      p_milestone: milestone,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Roadmap reward claim failed.';
    const status = /already claimed|not reached/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/economy/chrono-task', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const taskId = typeof (req.body as Record<string, unknown> | null)?.taskId === 'string'
      ? String((req.body as Record<string, unknown>).taskId).trim()
      : '';
    if (!/^[dwl]_[a-z0-9_]{3,60}$/.test(taskId)) {
      res.status(400).json({ error: 'A valid Chrono task is required.' });
      return;
    }
    const result = await callServiceRpc<{ applied: boolean; balance: Record<string, number>; reward: Record<string, number> }>('economy_claim_chrono_task', {
      p_user_id: user.id,
      p_task_id: taskId,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chrono task claim failed.';
    const status = /already claimed|not completed|unknown/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/economy/chrono/card-upgrade', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const cardId = typeof (req.body as Record<string, unknown> | null)?.cardId === 'string'
      ? String((req.body as Record<string, unknown>).cardId).trim()
      : '';
    if (!/^b\d{3,4}_(geo|foo|ent|his)_[1-3]$/.test(cardId)) {
      res.status(400).json({ error: 'A valid Chrono card is required.' });
      return;
    }
    const result = await callServiceRpc<Record<string, unknown>>('economy_purchase_card_upgrade', {
      p_user_id: user.id,
      p_card_id: cardId,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Card upgrade failed.';
    const status = /not owned|maximum|not enough|insufficient|invalid/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/economy/chrono/token-purchase', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const tokenId = typeof (req.body as Record<string, unknown> | null)?.tokenId === 'string'
      ? String((req.body as Record<string, unknown>).tokenId).trim()
      : '';
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(tokenId)) {
      res.status(400).json({ error: 'A valid Chrono token is required.' });
      return;
    }
    const result = await callServiceRpc<Record<string, unknown>>('economy_purchase_chrono_token', {
      p_user_id: user.id,
      p_token_id: tokenId,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token purchase failed.';
    const status = /already owned|unknown|insufficient/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/economy/chrono/wheel-spin', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const spinId = typeof (req.body as Record<string, unknown> | null)?.spinId === 'string'
      ? String((req.body as Record<string, unknown>).spinId).trim()
      : '';
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(spinId)) {
      res.status(400).json({ error: 'A valid wheel spin identifier is required.' });
      return;
    }
    const result = await callServiceRpc<Record<string, unknown>>('economy_spin_chrono_wheel', {
      p_user_id: user.id,
      p_spin_id: spinId,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wheel spin failed.';
    const status = /insufficient|inventory|invalid/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/economy/chrono/pack-purchase', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const packId = typeof body?.packId === 'string' ? body.packId.trim() : '';
    const purchaseId = typeof body?.purchaseId === 'string' ? body.purchaseId.trim() : '';
    if (!['pack_basic', 'pack_premium', 'pack_elite'].includes(packId) || !/^[A-Za-z0-9_-]{8,80}$/.test(purchaseId)) {
      res.status(400).json({ error: 'A valid card pack and purchase identifier are required.' });
      return;
    }
    const result = await callServiceRpc<Record<string, unknown>>('economy_purchase_chrono_pack', {
      p_user_id: user.id,
      p_pack_id: packId,
      p_purchase_id: purchaseId,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Card pack purchase failed.';
    const status = /insufficient|inventory|unknown|invalid/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/economy/chrono/energy-gift', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const toUserId = typeof (req.body as Record<string, unknown> | null)?.toUserId === 'string'
      ? String((req.body as Record<string, unknown>).toUserId).trim()
      : '';
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(toUserId)) {
      res.status(400).json({ error: 'A valid friend is required.' });
      return;
    }
    const result = await callServiceRpc<Record<string, unknown>>('economy_send_chrono_energy_gift', {
      p_from_user_id: user.id,
      p_to_user_id: toUserId,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Energy gift failed.';
    const status = /already sent|not mutual|not found|yourself/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/economy/chrono/idle-vault-claim', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('economy_claim_idle_vault', { p_user_id: user.id }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Idle vault claim failed.';
    res.status(/no idle|warmup/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/chrono/reward-chest-claim', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('economy_claim_chrono_reward_chest', { p_user_id: user.id }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reward chest claim failed.';
    res.status(/cooling|answer more|inventory/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/chrono/collection-set-claim', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const setId = typeof (req.body as Record<string, unknown> | null)?.setId === 'string' ? String((req.body as Record<string, unknown>).setId).trim() : '';
    if (!/^set_\d+_(geography|food|entertainment|history)$/.test(setId)) { res.status(400).json({ error: 'A valid collection set is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('economy_claim_collection_set', { p_user_id: user.id, p_set_id: setId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Collection set claim failed.';
    res.status(/incomplete|already|unknown|invalid/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/chrono/gem-milestone-claim', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const milestoneId = typeof (req.body as Record<string, unknown> | null)?.milestoneId === 'string' ? String((req.body as Record<string, unknown>).milestoneId).trim() : '';
    if (!/^gm_\d+_(cards|set|upgrade|booths)$/.test(milestoneId)) { res.status(400).json({ error: 'A valid gem milestone is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('economy_claim_gem_milestone', { p_user_id: user.id, p_milestone_id: milestoneId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gem milestone claim failed.';
    res.status(/incomplete|already|unknown|invalid/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/chrono/battle-pass-claim', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const tier = (req.body as Record<string, unknown> | null)?.tier;
    if (!Number.isInteger(tier) || (tier as number) < 1 || (tier as number) > 20) { res.status(400).json({ error: 'A valid battle pass tier is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('economy_claim_chrono_battle_pass_tier', { p_user_id: user.id, p_tier: tier }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Battle pass claim failed.';
    res.status(/not unlocked|already claimed|unknown/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/multiplayer-reward', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const sessionId = typeof (req.body as Record<string, unknown> | null)?.sessionId === 'string' ? String((req.body as Record<string, unknown>).sessionId).trim() : '';
    if (!/^[A-Za-z0-9_-]{5,80}$/.test(sessionId)) { res.status(400).json({ error: 'A valid game session is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('economy_claim_multiplayer_reward', { p_user_id: user.id, p_session_id: sessionId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Multiplayer reward failed.';
    res.status(/not found|not complete|not a participant/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/matchmaking/start', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const gameId = typeof body?.gameId === 'string' ? body.gameId.trim() : '';
    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId.trim() : '';
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(gameId) || !/^[A-Za-z0-9_-]{8,80}$/.test(attemptId)) { res.status(400).json({ error: 'A valid matchmaking request is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('economy_start_matchmaking', { p_user_id:user.id,p_game_id:gameId,p_attempt_id:attemptId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Matchmaking failed.';
    res.status(/insufficient|invalid|profile/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/matchmaking/cancel', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const gameId = typeof body?.gameId === 'string' ? body.gameId.trim() : '';
    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId.trim() : '';
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(gameId) || !/^[A-Za-z0-9_-]{8,80}$/.test(attemptId)) { res.status(400).json({ error: 'A valid matchmaking cancellation is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('economy_cancel_matchmaking', { p_user_id:user.id,p_game_id:gameId,p_attempt_id:attemptId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Matchmaking cancellation failed.';
    res.status(/not found|mismatch|already created|fee not found/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/matchmaking/bot', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const gameId = typeof body?.gameId === 'string' ? body.gameId.trim() : '';
    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId.trim() : '';
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(gameId) || !/^[A-Za-z0-9_-]{8,80}$/.test(attemptId)) {
      res.status(400).json({ error: 'A valid bot matchmaking request is required.' });
      return;
    }
    res.json(await callServiceRpc<Record<string, unknown>>('economy_start_bot_match', {
      p_user_id: user.id,
      p_game_id: gameId,
      p_attempt_id: attemptId,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bot matchmaking failed.';
    res.status(/not found|mismatch|missing|fee|invalid|profile/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/multiplayer/challenge/accept', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const challengeId = typeof (req.body as Record<string, unknown> | null)?.challengeId === 'string'
      ? String((req.body as Record<string, unknown>).challengeId).trim() : '';
    if (!/^[A-Za-z0-9_-]{5,100}$/.test(challengeId)) { res.status(400).json({ error: 'A valid challenge is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('game_session_accept_challenge', { p_user_id: user.id, p_challenge_id: challengeId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Challenge acceptance failed.';
    res.status(/not found|mismatch|pending|invalid|profile|warmup/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/multiplayer/challenge/send', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const toUsername = typeof body?.toUsername === 'string' ? body.toUsername.trim() : '';
    const gameId = typeof body?.gameId === 'string' ? body.gameId.trim() : '';
    const gameLabel = typeof body?.gameLabel === 'string' ? body.gameLabel.trim() : '';
    if (!toUsername || toUsername.length > 80 || !/^[A-Za-z0-9_-]{2,80}$/.test(gameId) || !gameLabel || gameLabel.length > 100) {
      res.status(400).json({ error: 'A valid challenge request is required.' }); return;
    }
    res.json(await callServiceRpc<Record<string, unknown>>('game_session_send_challenge', {
      p_user_id: user.id, p_to_username: toUsername, p_game_id: gameId, p_game_label: gameLabel,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Challenge creation failed.';
    res.status(/not found|yourself|invalid|profile/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/multiplayer/challenge/cancel', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const challengeId = typeof (req.body as Record<string, unknown> | null)?.challengeId === 'string'
      ? String((req.body as Record<string, unknown>).challengeId).trim() : '';
    if (!/^[A-Za-z0-9_-]{5,100}$/.test(challengeId)) { res.status(400).json({ error: 'A valid challenge is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('game_session_cancel_challenge', { p_user_id: user.id, p_challenge_id: challengeId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Challenge cancellation failed.';
    res.status(/not found|mismatch|warmup/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/multiplayer/challenge/decline', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const challengeId = typeof (req.body as Record<string, unknown> | null)?.challengeId === 'string'
      ? String((req.body as Record<string, unknown>).challengeId).trim() : '';
    if (!/^[A-Za-z0-9_-]{5,100}$/.test(challengeId)) { res.status(400).json({ error: 'A valid challenge is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('game_session_decline_challenge', { p_user_id: user.id, p_challenge_id: challengeId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Challenge decline failed.';
    res.status(/not found|mismatch|warmup/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/multiplayer/score', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const round = body?.round;
    const score = body?.score;
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId) || !Number.isInteger(round) || !Number.isInteger(score) || (score as number) < 0 || (score as number) > 10_000_000) {
      res.status(400).json({ error: 'A valid round score is required.' }); return;
    }
    res.json(await callServiceRpc<Record<string, unknown>>('game_session_submit_score', { p_user_id: user.id, p_session_id: sessionId, p_round: round, p_score: score }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Score submission failed.';
    res.status(/not found|participant|complete|already|round|invalid/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/multiplayer/resolve', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const round = body?.round;
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId) || !Number.isInteger(round)) { res.status(400).json({ error: 'A valid round is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('game_session_resolve_round', { p_user_id: user.id, p_session_id: sessionId, p_round: round }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Round resolution failed.';
    res.status(/not found|participant|scores|round|invalid/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/multiplayer/forfeit', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const sessionId = typeof (req.body as Record<string, unknown> | null)?.sessionId === 'string'
      ? String((req.body as Record<string, unknown>).sessionId) : '';
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) { res.status(400).json({ error: 'A valid game session is required.' }); return; }
    res.json(await callServiceRpc<Record<string, unknown>>('game_session_forfeit', { p_user_id: user.id, p_session_id: sessionId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Forfeit failed.';
    res.status(/not found|participant|invalid/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/multiplayer/quick-chat', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body = req.body as Record<string, unknown> | null;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const messageText = typeof body?.text === 'string' ? body.text : '';
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId) || messageText.length < 1 || messageText.length > 30) {
      res.status(400).json({ error: 'A valid quick chat message is required.' }); return;
    }
    res.json(await callServiceRpc<Record<string, unknown>>('game_session_quick_chat', { p_user_id: user.id, p_session_id: sessionId, p_text: messageText }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quick chat failed.';
    res.status(/not found|participant|invalid|unavailable|rate limit/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/economy/chrono/board-roll', async (req: Request, res: Response) => {
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const body=req.body as Record<string,unknown>|null;
    const boardId=body?.boardId; const payBail=body?.payBail; const turnId=typeof body?.turnId==='string'?body.turnId.trim():'';
    if (!Number.isInteger(boardId)||(boardId as number)<100||(boardId as number)>3000||(boardId as number)%100!==0||typeof payBail!=='boolean'||!/^[A-Za-z0-9_-]{8,80}$/.test(turnId)) { res.status(400).json({error:'A valid board turn is required.'}); return; }
    res.json(await callServiceRpc<Record<string,unknown>>('economy_roll_chrono_board',{p_user_id:user.id,p_board_id:boardId,p_pay_bail:payBail,p_turn_id:turnId}));
  } catch(error) {
    const message=error instanceof Error?error.message:'Board roll failed.';
    res.status(/invalid|not currently active|insufficient/i.test(message)?409:500).json({error:message});
  }
});

router.post('/economy/curriculum-objective', async (req: Request, res: Response) => {
  try {
    const user=await verifySupabaseToken(req.header('authorization'));
    if(!user){res.status(401).json({error:'Authentication required.'});return;}
    const body=req.body as Record<string,unknown>|null;
    const curriculumId=typeof body?.curriculumId==='string'?body.curriculumId.trim():'';
    const chapterId=typeof body?.chapterId==='string'?body.chapterId.trim():'';
    const objectiveId=typeof body?.objectiveId==='string'?body.objectiveId.trim():'';
    const xp=curriculumObjectiveXp[`${curriculumId}:${chapterId}:${objectiveId}`];
    if(!xp){res.status(400).json({error:'Unknown curriculum objective.'});return;}
    res.json(await callServiceRpc<Record<string,unknown>>('economy_complete_curriculum_objective',{p_user_id:user.id,p_curriculum_id:curriculumId,p_chapter_id:chapterId,p_objective_id:objectiveId,p_xp:xp}));
  }catch(error){const message=error instanceof Error?error.message:'Objective completion failed.';res.status(/already completed|unknown|invalid/i.test(message)?409:500).json({error:message});}
});

router.post('/economy/arena/start',async(req:Request,res:Response)=>{try{const user=await verifySupabaseToken(req.header('authorization'));if(!user){res.status(401).json({error:'Authentication required.'});return;}const enemyId=typeof(req.body as Record<string,unknown>|null)?.enemyId==='string'?String((req.body as Record<string,unknown>).enemyId):'';res.json(await callServiceRpc<Record<string,unknown>>('economy_start_arena_battle',{p_user_id:user.id,p_enemy_id:enemyId}));}catch(error){const message=error instanceof Error?error.message:'Arena start failed.';res.status(/unknown|requires level/i.test(message)?409:500).json({error:message});}});

router.post('/economy/arena/complete',async(req:Request,res:Response)=>{try{const user=await verifySupabaseToken(req.header('authorization'));if(!user){res.status(401).json({error:'Authentication required.'});return;}const body=req.body as Record<string,unknown>|null;const sessionId=typeof body?.sessionId==='string'?body.sessionId:'';const won=body?.won;const stats=body?.stats;if(!/^[a-f0-9]{24}$/.test(sessionId)||typeof won!=='boolean'||!stats||typeof stats!=='object'){res.status(400).json({error:'A valid Arena result is required.'});return;}res.json(await callServiceRpc<Record<string,unknown>>('economy_complete_arena_battle',{p_user_id:user.id,p_session_id:sessionId,p_won:won,p_stats:stats}));}catch(error){const message=error instanceof Error?error.message:'Arena completion failed.';res.status(/not found|already completed|duration|statistics/i.test(message)?409:500).json({error:message});}});

router.post('/economy/admin-adjust',async(req:Request,res:Response)=>{try{const user=await verifySupabaseToken(req.header('authorization'));if(!user){res.status(401).json({error:'Authentication required.'});return;}const b=req.body as Record<string,unknown>|null;const userId=typeof b?.userId==='string'?b.userId:'';const reason=typeof b?.reason==='string'?b.reason.trim():'';const deltas=(b?.deltas&&typeof b.deltas==='object'?b.deltas:{}) as Record<string,unknown>;const nums=['gold','xp','energy','streak'].map(k=>Number.isInteger(deltas[k])?deltas[k] as number:NaN);if(!/^[A-Za-z0-9_-]{8,100}$/.test(userId)||reason.length<3||nums.some(n=>!Number.isFinite(n))){res.status(400).json({error:'A target, integer deltas, and reason are required.'});return;}const adjustmentId=crypto.randomUUID();res.json(await callServiceRpc<Record<string,unknown>>('economy_admin_adjust',{p_actor_id:user.id,p_user_id:userId,p_adjustment_id:adjustmentId,p_gold:nums[0],p_xp:nums[1],p_energy:nums[2],p_streak:nums[3],p_reason:reason}));}catch(error){const message=error instanceof Error?error.message:'Economy adjustment failed.';res.status(/permission|required|limit|negative/i.test(message)?403:500).json({error:message});}});

router.post('/economy/admin-reconciliation',async(req:Request,res:Response)=>{try{const user=await verifySupabaseToken(req.header('authorization'));if(!user){res.status(401).json({error:'Authentication required.'});return;}res.json(await callServiceRpc<Record<string,unknown>>('economy_reconciliation_report',{p_actor_id:user.id}));}catch(error){const message=error instanceof Error?error.message:'Economy reconciliation failed.';res.status(/permission/i.test(message)?403:500).json({error:message});}});

export default router;
