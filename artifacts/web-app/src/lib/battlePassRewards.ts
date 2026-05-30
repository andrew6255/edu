import type { BattlePassReward, BattlePassSeasonDoc } from '@/types/battlePass';
import { addCredits } from '@/lib/inventoryService';
import { addBattlePassEnergy } from '@/lib/battlePassService';
import { updateEconomy } from '@/lib/userService';
import { addOwnedTitle } from '@/lib/inventoryService';
import { getUserRealmUpgrades } from '@/lib/realmUpgradesService';

function applyUpgradeEffects(purchased: string[], currency: string, amount: number): number {
  let amt = amount;

  // Chrono Coins
  if (currency === 'chrono_coins') {
    if (purchased.includes('ren_workbench_1')) amt += 10;
    if (purchased.includes('ren_workbench_2')) amt = Math.round(amt * 1.1);
    if (purchased.includes('ind_foundry_2')) amt = Math.round(amt * 1.2);
  }

  // Relics
  if (currency === 'relics') {
    if (purchased.includes('ind_foundry_1')) amt += 1;
    if (purchased.includes('sp_lab_2')) amt += 1;
  }

  // Energy
  if (currency === 'energy') {
    if (purchased.includes('sp_lab_1')) amt = Math.round(amt * 1.1);
    if (purchased.includes('sp_lab_2')) amt = Math.round(amt * 1.15);
  }

  return Math.max(0, Math.floor(amt));
}

export async function grantReward(uid: string, seasonId: string, reward: BattlePassReward): Promise<void> {
  const payload = reward.payload;
  if (!payload) return;
  if (payload.kind === 'currency') {
    const baseAmt = Number(payload.amount) || 0;
    let amt = baseAmt;
    try {
      const up = await getUserRealmUpgrades(uid);
      const purchased = up?.purchased ?? [];
      amt = applyUpgradeEffects(purchased as any, payload.currency, baseAmt);
    } catch {
      // ignore upgrade effects
    }
    if (payload.currency === 'credits') {
      await addCredits(uid, amt);
      return;
    }
    if (payload.currency === 'insight') {
      // Insight is stored in inventory doc
      const { addInsight } = await import('@/lib/inventoryService');
      await addInsight(uid, amt);
      return;
    }
    if (payload.currency === 'chrono_coins') {
      const { addChronoCoins } = await import('@/lib/inventoryService');
      await addChronoCoins(uid, amt);
      return;
    }
    if (payload.currency === 'relics') {
      const { addRelics } = await import('@/lib/inventoryService');
      await addRelics(uid, amt);
      return;
    }
    if (payload.currency === 'gold') {
      await updateEconomy(uid, { gold: amt });
      return;
    }
    if (payload.currency === 'energy') {
      await addBattlePassEnergy(uid, seasonId, amt);
      return;
    }
  }

  if (payload.kind === 'item') {
    if (reward.type === 'title') {
      await addOwnedTitle(uid, payload.itemId);
    }
    return;
  }
}

export function findTierReward(season: BattlePassSeasonDoc, tier: number): { free?: BattlePassReward; premium?: BattlePassReward } {
  const t = season.tiers.find((x) => x.tier === tier);
  return { free: t?.free, premium: t?.premium };
}
