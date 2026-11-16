// 搜打撤 roguelike 离线版 - 本地存档 / 出发事务 / 统一恢复（v4.1 §11 §15）

import Taro from '@tarojs/taro';
import type { Profile, RunState, ItemInstance } from './types';
import { PLAYER_MAX_HP, BASE_MONEY_FLOOR, EXTRACT_SECONDS } from './config';
import { makeItemWithRarity, removeById, splitStack, vitalityBonus, itemCategory } from './balance';
import { generateMap } from './mapgen';
import { computeSettlement, applySettlement, applyFloorTopUp } from './settlement';

const PROFILE_KEY = 'scsc_profile_v1';
const RUN_KEY = 'scsc_run_v1';
const CORRUPT_KEY = 'scsc_profile_corrupt';

export function makeRunId(): string {
  return `run_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export function floorFor(profile: Profile): number {
  return BASE_MONEY_FLOOR + 100 * profile.upgrades.money;
}

export function defaultProfile(): Profile {
  const pistol = makeItemWithRarity('pistol', 'white');
  const bandage = makeItemWithRarity('bandage', 'white');
  bandage.count = 2;
  return {
    version: 1,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    money: 0,
    stash: [bandage],
    weapon: pistol,
    armor: null,
    extractions: 0,
    deaths: 0,
    runs: 0,
    upgrades: { inv: 0, hp: 0, money: 0, supply: 0 },
    milestones: {},
    claimed: {},
    settledRunIds: [],
    pendingStartRunId: null,
    floorApplyRunId: '',
  };
}

// 兼容旧 v1 存档：string[] 物品转 white 实例
function migrateItem(v: unknown): ItemInstance | null {
  if (typeof v === 'string') {
    return makeItemWithRarity(v, 'white');
  }
  if (v && typeof v === 'object' && typeof (v as ItemInstance).templateId === 'string') {
    return v as ItemInstance;
  }
  return null;
}

export function loadProfile(): Profile {
  try {
    const v = Taro.getStorageSync(PROFILE_KEY);
    if (!v || typeof v !== 'object') return defaultProfile();
    const base = defaultProfile();
    if (typeof (v as Profile).maxHp !== 'number' || (v as Profile).version !== 1) {
      // 结构非法：备份后重置
      try {
        Taro.setStorageSync(CORRUPT_KEY, v);
      } catch {
        // 备份失败不阻塞
      }
      return defaultProfile();
    }
    const p = { ...base, ...v } as Profile;
    p.stash = Array.isArray(p.stash) ? p.stash.map(migrateItem).filter((x): x is ItemInstance => !!x) : [];
    p.weapon = migrateItem(p.weapon);
    p.armor = migrateItem(p.armor);
    p.milestones = p.milestones && typeof p.milestones === 'object' ? p.milestones : {};
    p.claimed = p.claimed && typeof p.claimed === 'object' ? p.claimed : {};
    p.settledRunIds = Array.isArray(p.settledRunIds) ? p.settledRunIds : [];
    p.upgrades = p.upgrades && typeof p.upgrades === 'object' ? { ...base.upgrades, ...p.upgrades } : base.upgrades;
    return p;
  } catch (e) {
    try {
      const raw = Taro.getStorageSync(PROFILE_KEY);
      Taro.setStorageSync(CORRUPT_KEY, raw);
    } catch {
      // ignore
    }
    return defaultProfile();
  }
}

export function saveProfile(p: Profile) {
  try {
    Taro.setStorageSync(PROFILE_KEY, p);
  } catch (e) {
    // 忽略写入失败
  }
}

export function loadRun(): RunState | null {
  try {
    const v = Taro.getStorageSync(RUN_KEY);
    if (v && typeof v === 'object' && typeof (v as RunState).runId === 'string' && (v as RunState).map) {
      return v as RunState;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export function saveRun(r: RunState) {
  try {
    Taro.setStorageSync(RUN_KEY, r);
  } catch (e) {
    // ignore
  }
}

export function clearRun() {
  try {
    Taro.removeStorageSync(RUN_KEY);
  } catch (e) {
    // ignore
  }
}

// §15.4 出发事务：构造局内状态并完成跨存档物品转移（先落 RunState，再落 Profile）
export function startRun(profile: Profile): { run: RunState; profile: Profile } {
  const runId = makeRunId();
  const map = generateMap();

  // 装配：手动优先，未装备才自动装配仓库 value 最高
  let weapon = profile.weapon ? { ...profile.weapon } : null;
  let armor = profile.armor ? { ...profile.armor } : null;
  let stash = [...profile.stash];
  const movedItemIds: string[] = [];
  if (!weapon) {
    const best = stash
      .filter((i) => itemCategory(i) === 'weapon')
      .sort((a, b) => b.value - a.value)[0];
    if (best) {
      weapon = best;
      stash = removeById(stash, best.instanceId);
      movedItemIds.push(best.instanceId);
    }
  } else {
    movedItemIds.push(weapon.instanceId);
  }
  if (!armor) {
    const best = stash
      .filter((i) => itemCategory(i) === 'armor')
      .sort((a, b) => b.value - a.value)[0];
    if (best) {
      armor = best;
      stash = removeById(stash, best.instanceId);
      movedItemIds.push(best.instanceId);
    }
  } else {
    movedItemIds.push(armor.instanceId);
  }

  // 补给：supply 级数个医疗品（绷带优先，堆叠拆分）
  const supplyCount = profile.upgrades.supply;
  const inventory: ItemInstance[] = [];
  for (let s = 0; s < supplyCount; s++) {
    let idx = stash.findIndex((i) => itemCategory(i) === 'med' && i.templateId === 'bandage');
    if (idx < 0) idx = stash.findIndex((i) => itemCategory(i) === 'med');
    if (idx < 0) break;
    const src = stash[idx];
    if (src.count > 1) {
      const { remain, taken } = splitStack(src, 1);
      stash = [...stash.slice(0, idx), remain, ...stash.slice(idx + 1)];
      inventory.push(taken);
      movedItemIds.push(taken.instanceId);
    } else {
      stash = removeById(stash, src.instanceId);
      inventory.push(src);
      movedItemIds.push(src.instanceId);
    }
  }

  const maxHp = profile.maxHp + vitalityBonus(armor);
  const run: RunState = {
    version: 1,
    runId,
    status: 'playing',
    result: null,
    hp: maxHp,
    maxHp,
    pos: { ...map.playerStart },
    map,
    enemies: map.enemies.map((e) => ({ ...e })),
    inventory,
    weapon,
    armor,
    deadline: Date.now() + EXTRACT_SECONDS * 1000,
    pausedAt: null,
    modalPause: false,
    killStats: { elite: 0 },
    startSnapshot: { runId, movedItemIds },
    settlement: null,
    extractProgress: 0,
    createdAt: Date.now(),
  };

  saveRun(run);
  // 同一快照扣除装配物品
  const nextProfile: Profile = {
    ...profile,
    stash,
    weapon: null,
    armor: null,
    pendingStartRunId: runId,
  };
  saveProfile(nextProfile);
  return { run, profile: nextProfile };
}

// §12.3 结算事务（完整四步），返回应用后的 Profile
export function finishRun(run: RunState, profile: Profile, result: 'success' | 'dead' | 'mia'): Profile {
  run.result = result;
  const settlement = computeSettlement(run, profile);
  run.settlement = settlement;
  run.status = 'settled';
  saveRun(run);

  let nextProfile = applySettlement(profile, settlement, run.killStats.elite);
  nextProfile = applyFloorTopUp(nextProfile, floorFor(nextProfile), run.runId);
  saveProfile(nextProfile);
  clearRun();
  return nextProfile;
}

export type RestoreResult =
  | { action: 'new'; run: RunState; profile: Profile }
  | { action: 'resume'; run: RunState; profile: Profile }
  | { action: 'settled'; run: RunState; profile: Profile };

// §15.2 统一恢复入口（顺序固定：读档→无档生成→settled 重放→出发补偿→暂停补偿→倒计时判定→恢复）
export function restoreRun(): RestoreResult {
  const run = loadRun();
  const profile = loadProfile();

  if (!run) {
    const r = startRun(profile);
    return { action: 'new', ...r };
  }

  if (run.status === 'settled') {
    if (profile.settledRunIds.includes(run.runId)) {
      return { action: 'settled', run, profile };
    }
    if (run.settlement) {
      let next = applySettlement(profile, run.settlement, run.killStats.elite);
      next = applyFloorTopUp(next, floorFor(next), run.runId);
      saveProfile(next);
      return { action: 'settled', run, profile: next };
    }
    // settled 但无 settlement 快照：异常，重建新局
    clearRun();
    const r = startRun(profile);
    return { action: 'new', ...r };
  }

  // 未 settled：出发事务恢复
  let nextProfile = profile;
  if (run.startSnapshot && profile.pendingStartRunId !== run.runId) {
    const moved = new Set(run.startSnapshot.movedItemIds);
    nextProfile = {
      ...profile,
      stash: profile.stash.filter((i) => !moved.has(i.instanceId)),
      pendingStartRunId: run.runId,
    };
    if (nextProfile.weapon && moved.has(nextProfile.weapon.instanceId)) nextProfile.weapon = null;
    if (nextProfile.armor && moved.has(nextProfile.armor.instanceId)) nextProfile.armor = null;
    saveProfile(nextProfile);
  }

  // 暂停补偿
  if (run.pausedAt != null) {
    const paused = run.pausedAt;
    run.deadline += Date.now() - paused;
    run.pausedAt = null;
    saveRun(run);
  }

  // 倒计时判定
  if (run.deadline <= Date.now()) {
    const settledProfile = finishRun(run, nextProfile, 'mia');
    return { action: 'settled', run, profile: settledProfile };
  }

  return { action: 'resume', run, profile: nextProfile };
}
