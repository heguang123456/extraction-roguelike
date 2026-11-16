// 搜打撤 roguelike 离线版 - 物品/属性/堆叠工具（v4.1 §6.4）

import {
  ITEMS,
  RARITY_DEFS,
  AFFIX_DEFS,
  CRATE_RARITY_TABLE,
  FIST_DAMAGE,
  FIST_RANGE,
  FIST_ATTACK_TICKS,
  PLAYER_ATTACK_TICKS,
} from './config';
import type { ItemInstance, Rarity, ItemDef, AffixDef } from './types';

let seq = 0;
export function makeInstanceId(templateId: string): string {
  seq += 1;
  return `${templateId}_${Date.now()}_${seq}`;
}

export function itemDef(item: ItemInstance): ItemDef {
  return ITEMS[item.templateId];
}

export function itemCategory(item: ItemInstance): ItemDef['category'] {
  return itemDef(item).category;
}

// 品质掷取
export function rollRarity(source: 'normal' | 'gold'): Rarity {
  const table = CRATE_RARITY_TABLE[source];
  const r = Math.random();
  let acc = 0;
  for (const row of table) {
    acc += row.chance;
    if (r <= acc) return row.rarity;
  }
  return 'white';
}

export function rollAffixes(def: ItemDef, rarity: Rarity): string[] {
  const rd = RARITY_DEFS[rarity];
  const n = rd.affixMin + (rd.affixMax > rd.affixMin && Math.random() < 0.5 ? 1 : 0);
  const pool = Object.values(AFFIX_DEFS).filter((a: AffixDef) => a.appliesTo === def.category);
  const picked: string[] = [];
  const available = [...pool];
  for (let i = 0; i < n && available.length > 0; i++) {
    const idx = Math.floor(Math.random() * available.length);
    picked.push(available[idx].key);
    available.splice(idx, 1);
  }
  return picked;
}

// 创建物品实例（来源决定品质表）
export function makeItem(templateId: string, source: 'normal' | 'gold'): ItemInstance {
  const def = ITEMS[templateId];
  const rarity = rollRarity(source);
  return buildInstance(def, rarity);
}

// 创建物品实例（指定品质，用于保底/商店）
export function makeItemWithRarity(templateId: string, rarity: Rarity): ItemInstance {
  return buildInstance(ITEMS[templateId], rarity);
}

function buildInstance(def: ItemDef, rarity: Rarity): ItemInstance {
  const affixes = rollAffixes(def, rarity);
  const value = Math.round(def.baseValue * RARITY_DEFS[rarity].valueMul);
  return { instanceId: makeInstanceId(def.id), templateId: def.id, rarity, affixes, value, count: 1 };
}

// 属性公式（§6.4）；武器/护甲为空时按徒手计算
export function finalDamage(item: ItemInstance | null): number {
  if (!item) return FIST_DAMAGE;
  const def = itemDef(item);
  if (!def.damage) return FIST_DAMAGE;
  const base = def.damage * RARITY_DEFS[item.rarity].dmgMul;
  const perc = item.affixes.reduce((s, k) => s + (AFFIX_DEFS[k]?.kind === 'percent' ? AFFIX_DEFS[k].value : 0), 0);
  return Math.floor(base * (1 + perc));
}

export function finalRange(item: ItemInstance | null): number {
  if (!item) return FIST_RANGE;
  const def = itemDef(item);
  if (!def.range) return FIST_RANGE;
  const plus = item.affixes.reduce((s, k) => s + (AFFIX_DEFS[k]?.key === 'longbarrel' ? AFFIX_DEFS[k].value : 0), 0);
  return def.range + plus;
}

export function finalCooldownTicks(item: ItemInstance | null): number {
  if (!item) return FIST_ATTACK_TICKS;
  const def = itemDef(item);
  if (!def.damage) return FIST_ATTACK_TICKS;
  const base = PLAYER_ATTACK_TICKS[item.templateId] ?? 6;
  let keep = 1;
  for (const k of item.affixes) {
    const a = AFFIX_DEFS[k];
    if (a?.kind === 'cdr') keep *= 1 - a.value;
  }
  const reduction = Math.min(0.4, 1 - keep); // 总缩减上限 40%
  return Math.max(4, Math.ceil(base * (1 - reduction)));
}

export function finalDefense(item: ItemInstance | null): number {
  if (!item) return 0;
  const def = itemDef(item);
  if (!def.defense) return 0;
  const base = def.defense * RARITY_DEFS[item.rarity].defMul;
  const flat = item.affixes.reduce((s, k) => s + (AFFIX_DEFS[k]?.key === 'sturdy' ? AFFIX_DEFS[k].value : 0), 0);
  return Math.floor(base + flat);
}

export function vitalityBonus(item: ItemInstance | null): number {
  if (!item) return 0;
  return item.affixes.reduce((s, k) => s + (AFFIX_DEFS[k]?.key === 'vitality' ? AFFIX_DEFS[k].value : 0), 0);
}

export function lifestealBonus(item: ItemInstance | null): number {
  if (!item) return 0;
  return item.affixes.reduce((s, k) => s + (AFFIX_DEFS[k]?.key === 'lifesteal' ? AFFIX_DEFS[k].value : 0), 0);
}

export function sellPrice(item: ItemInstance): number {
  return Math.floor(item.value * 0.5);
}

// 堆叠：同模板同品质合并
export function mergeStack(target: ItemInstance[], item: ItemInstance): ItemInstance[] {
  if (itemCategory(item) !== 'med' || item.count < 1) {
    return [...target, item];
  }
  const idx = target.findIndex((t) => t.templateId === item.templateId && t.rarity === item.rarity);
  if (idx >= 0) {
    const next = [...target];
    next[idx] = { ...next[idx], count: next[idx].count + item.count };
    return next;
  }
  return [...target, item];
}

// 拆分：从 item 中拆出 takeCount 数量，返回剩余与拆出部分
export function splitStack(item: ItemInstance, takeCount: number): { remain: ItemInstance; taken: ItemInstance } {
  const remainCount = item.count - takeCount;
  const remain = { ...item, count: remainCount };
  const taken = { ...item, instanceId: makeInstanceId(item.templateId), count: takeCount };
  return { remain, taken };
}

// 从列表中移除指定 instanceId（返回新数组）
export function removeById(list: ItemInstance[], instanceId: string): ItemInstance[] {
  return list.filter((i) => i.instanceId !== instanceId);
}

export function totalValue(list: ItemInstance[]): number {
  return list.reduce((s, i) => s + i.value * i.count, 0);
}
