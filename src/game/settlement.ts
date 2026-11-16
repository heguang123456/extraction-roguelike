// 搜打撤 roguelike 离线版 - 结算计算与应用（v4.1 §12.3）

import type { Profile, RunState, Settlement, ItemInstance } from './types';
import { ACHIEVEMENTS } from './config';
import { itemCategory, mergeStack } from './balance';

// §12.3 步骤1：计算 Settlement（纯内存，含成就判定）
export function computeSettlement(run: RunState, profile: Profile): Settlement {
  const allItems: ItemInstance[] = [...run.inventory];
  if (run.weapon) allItems.push(run.weapon);
  if (run.armor) allItems.push(run.armor);

  let moneyDelta = 0;
  let keptItems: ItemInstance[] = [];
  let destroyedCount = 0;
  let totalValue = 0;

  if (run.result === 'success') {
    for (const item of allItems) {
      const cat = itemCategory(item);
      totalValue += item.value * item.count;
      if (cat === 'junk') {
        moneyDelta += item.value * item.count; // 杂物变现
      } else {
        keptItems = mergeStack(keptItems, item); // 装备/医疗入库（先聚到临时列表）
      }
    }
  } else {
    destroyedCount = allItems.reduce((s, i) => s + i.count, 0);
  }

  // 成就判定（依据 Profile 累计 + 本局增量 + 本局条件）
  const milestoneAwards: Record<string, number> = {};
  const nextExtractions = profile.extractions + (run.result === 'success' ? 1 : 0);
  const nextElite = (profile.milestones.eliteKills || 0) + run.killStats.elite;
  const hasGold = run.result === 'success' && allItems.some((i) => i.rarity === 'gold');

  if (!profile.claimed.first_taste && nextExtractions >= 5) milestoneAwards.first_taste = ACHIEVEMENTS.first_taste.reward;
  if (!profile.claimed.hunter && nextElite >= 3) milestoneAwards.hunter = ACHIEVEMENTS.hunter.reward;
  if (!profile.claimed.rich_haul && run.result === 'success' && totalValue >= 500) milestoneAwards.rich_haul = ACHIEVEMENTS.rich_haul.reward;
  if (!profile.claimed.gold_legend && hasGold) milestoneAwards.gold_legend = ACHIEVEMENTS.gold_legend.reward;

  moneyDelta += Object.values(milestoneAwards).reduce((s, v) => s + v, 0);

  return {
    runId: run.runId,
    result: run.result === 'success' ? 'success' : run.result === 'dead' ? 'dead' : 'mia',
    moneyDelta,
    keptItems,
    destroyedCount,
    extras: {
      extractions: nextExtractions,
      deaths: profile.deaths + (run.result === 'dead' || run.result === 'mia' ? 1 : 0),
      runs: profile.runs + 1,
    },
    milestoneAwards,
    totalValue,
  };
}

// §12.3 步骤3：单快照应用结算到 Profile（a–g 在一次对象构造+一次写入完成）
export function applySettlement(profile: Profile, settlement: Settlement, eliteDelta: number): Profile {
  const next: Profile = {
    ...profile,
    money: profile.money + settlement.moneyDelta,
    extractions: settlement.extras.extractions,
    deaths: settlement.extras.deaths,
    runs: settlement.extras.runs,
    stash: [...profile.stash],
    claimed: { ...profile.claimed },
    milestones: { ...profile.milestones },
    settledRunIds: [...profile.settledRunIds, settlement.runId],
    pendingStartRunId: null,
  };
  for (const item of settlement.keptItems) {
    next.stash = mergeStack(next.stash, item);
  }
  for (const key of Object.keys(settlement.milestoneAwards)) {
    next.claimed[key] = true;
  }
  if (eliteDelta > 0) {
    next.milestones.eliteKills = (next.milestones.eliteKills || 0) + eliteDelta;
  }
  next.milestones.bestHaul = Math.max(next.milestones.bestHaul || 0, settlement.totalValue);
  return next;
}

// §10.4：营地阶段补足（每个营地阶段一次）
export function applyFloorTopUp(profile: Profile, floor: number, stageId: string): Profile {
  if (profile.floorApplyRunId === stageId) return profile;
  const next = { ...profile, floorApplyRunId: stageId };
  if (next.money < floor) next.money = floor;
  return next;
}
