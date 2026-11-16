// 搜打撤 roguelike 离线版 - 平衡配置（v4.1）

import type { ItemDef, EnemyKind, Rarity, AffixDef } from './types';

export const ITEMS: Record<string, ItemDef> = {
  pistol: { id: 'pistol', name: '手枪', category: 'weapon', iconKey: 'item_weapon', baseValue: 120, desc: '基础武器，射程3格', damage: 10, range: 3 },
  shotgun: { id: 'shotgun', name: '霰弹枪', category: 'weapon', iconKey: 'item_weapon', baseValue: 260, desc: '近距爆发，射程2格', damage: 20, range: 2 },
  rifle: { id: 'rifle', name: '突击步枪', category: 'weapon', iconKey: 'item_weapon', baseValue: 400, desc: '均衡强火力，射程4格', damage: 16, range: 4 },
  light_armor: { id: 'light_armor', name: '轻型护甲', category: 'armor', iconKey: 'item_armor', baseValue: 150, desc: '减伤2点', defense: 2 },
  heavy_armor: { id: 'heavy_armor', name: '重型护甲', category: 'armor', iconKey: 'item_armor', baseValue: 350, desc: '减伤4点', defense: 4 },
  bandage: { id: 'bandage', name: '绷带', category: 'med', iconKey: 'item_medkit', baseValue: 40, desc: '恢复15点生命', heal: 15 },
  medkit: { id: 'medkit', name: '急救包', category: 'med', iconKey: 'item_medkit', baseValue: 100, desc: '恢复35点生命', heal: 35 },
  parts: { id: 'parts', name: '机械零件', category: 'junk', iconKey: 'item_junk', baseValue: 50, desc: '可出售换资金' },
  chip: { id: 'chip', name: '电子元件', category: 'junk', iconKey: 'item_junk', baseValue: 120, desc: '稀有物资，价值高' },
  coin_stack: { id: 'coin_stack', name: '金币堆', category: 'junk', iconKey: 'item_coin', baseValue: 30, desc: '直接兑换资金' },
};

// 品质定义
export const RARITY_DEFS: Record<Rarity, { name: string; color: string; dmgMul: number; defMul: number; affixMin: number; affixMax: number; valueMul: number }> = {
  white: { name: '普通', color: '#cfd3dc', dmgMul: 1.0, defMul: 1.0, affixMin: 0, affixMax: 0, valueMul: 1.0 },
  green: { name: '优良', color: '#4caf50', dmgMul: 1.15, defMul: 1.1, affixMin: 1, affixMax: 1, valueMul: 1.5 },
  blue: { name: '精良', color: '#2196f3', dmgMul: 1.3, defMul: 1.2, affixMin: 1, affixMax: 2, valueMul: 2.5 },
  purple: { name: '史诗', color: '#9c27b0', dmgMul: 1.5, defMul: 1.3, affixMin: 2, affixMax: 2, valueMul: 4.0 },
  gold: { name: '传说', color: '#ffc107', dmgMul: 1.8, defMul: 1.4, affixMin: 3, affixMax: 3, valueMul: 7.0 },
};

// 掉落品质概率（普通箱 / 金箱）
export const CRATE_RARITY_TABLE: Record<'normal' | 'gold', Array<{ rarity: Rarity; chance: number }>> = {
  normal: [
    { rarity: 'white', chance: 0.45 },
    { rarity: 'green', chance: 0.3 },
    { rarity: 'blue', chance: 0.17 },
    { rarity: 'purple', chance: 0.06 },
    { rarity: 'gold', chance: 0.02 },
  ],
  gold: [
    { rarity: 'white', chance: 0.1 },
    { rarity: 'green', chance: 0.1 },
    { rarity: 'blue', chance: 0.4 },
    { rarity: 'purple', chance: 0.3 },
    { rarity: 'gold', chance: 0.1 },
  ],
};

// 词条
export const AFFIX_DEFS: Record<string, AffixDef> = {
  sharp: { key: 'sharp', name: '锋锐', appliesTo: 'weapon', kind: 'percent', value: 0.2, maxStacks: 3 },
  longbarrel: { key: 'longbarrel', name: '长管', appliesTo: 'weapon', kind: 'flat', value: 1, maxStacks: 2 },
  rapid: { key: 'rapid', name: '速射', appliesTo: 'weapon', kind: 'cdr', value: 0.15, maxStacks: 2 },
  lifesteal: { key: 'lifesteal', name: '吸血', appliesTo: 'weapon', kind: 'lifesteal', value: 2, maxStacks: 2 },
  sturdy: { key: 'sturdy', name: '坚固', appliesTo: 'armor', kind: 'flat', value: 2, maxStacks: 2 },
  vitality: { key: 'vitality', name: '活力', appliesTo: 'armor', kind: 'vitality', value: 10, maxStacks: 2 },
};

// 敌人定义
export const ENEMY_DEFS: Record<EnemyKind, { hp: number; damage: number; range: number }> = {
  melee: { hp: 25, damage: 8, range: 1 },
  range: { hp: 18, damage: 6, range: 4 },
  elite: { hp: 60, damage: 15, range: 1 },
};

// 地图
export const GRID_W = 13;
export const GRID_H = 13;
export const ROOM_COUNT_MIN = 2;
export const ROOM_COUNT_MAX = 4;
export const ROOM_SIZE_MIN = 4;
export const ROOM_SIZE_MAX = 6;
export const MAP_RETRY_LIMIT = 50;
export const GOLD_CRATE_CHANCE = 0.8;

// 玩家
export const PLAYER_MAX_HP = 100;
export const INVENTORY_LIMIT = 10;
export const FIST_DAMAGE = 4;
export const FIST_RANGE = 1;
export const FIST_ATTACK_TICKS = 6;
export const HEAL_TICK = 5;

// 时间（全 tick 制，1 tick = 120ms）
export const TICK_MS = 120;
export const ENEMY_TICK = 4; // 敌人每 4 tick 行动一次（480ms）
export const PLAYER_ATTACK_TICKS: Record<string, number> = { pistol: 6, shotgun: 8, rifle: 7 };

// 撤离与金箱
export const EXTRACT_SECONDS = 240;      // 限时撤离倒计时（秒）
export const EXTRACT_CHANNEL_MS = 3000;  // 撤离引导（毫秒，渲染用）
export const EXTRACT_HIT_REGRESS = 0.5;  // 受击回退 50%
export const OPEN_CRATE_TICKS = 17;      // 金箱引导 tick（2040ms）

// 资金保护
export const BASE_MONEY_FLOOR = 150;

// 精英冲锋
export const ELITE_CHARGE_RANGE = 3;     // 触发距离（曼哈顿）
export const ELITE_CHARGE_INTERVAL = 3;  // 每 3 个敌人回合一次
export const ELITE_CHARGE_DIST = 2;      // 冲锋移动格数

// 商店（固定 white）
export const SHOP_ITEMS: { templateId: string; price: number }[] = [
  { templateId: 'bandage', price: 40 },
  { templateId: 'medkit', price: 100 },
  { templateId: 'pistol', price: 120 },
  { templateId: 'light_armor', price: 150 },
  { templateId: 'shotgun', price: 260 },
  { templateId: 'rifle', price: 400 },
];

// 升级树
export const UPGRADE_DEFS: Record<'inv' | 'hp' | 'money' | 'supply', { name: string; maxLevel: number; cost: number[]; desc: (lv: number) => string }> = {
  inv: { name: '背包扩容', maxLevel: 5, cost: [200, 500, 1200, 2500, 5000], desc: (lv) => `背包上限 +2 格/级（当前 ${INVENTORY_LIMIT + lv * 2}）` },
  hp: { name: '生命强化', maxLevel: 5, cost: [150, 400, 900, 2000, 4000], desc: (lv) => `最大生命 +10/级（当前 ${PLAYER_MAX_HP + lv * 10}）` },
  money: { name: '初始资金', maxLevel: 5, cost: [100, 250, 600, 1500, 3000], desc: (lv) => `资金底线 +100/级（当前 ${BASE_MONEY_FLOOR + lv * 100}）` },
  supply: { name: '初始补给', maxLevel: 3, cost: [150, 400, 1000], desc: (lv) => `开局医疗品 +1/级（当前 ${lv}）` },
};

// 成就
export const ACHIEVEMENTS: Record<string, { name: string; desc: string; reward: number }> = {
  first_taste: { name: '初露锋芒', desc: '累计撤离 5 次', reward: 300 },
  hunter: { name: '猎杀者', desc: '累计击杀精英 3 次', reward: 300 },
  rich_haul: { name: '满载而归', desc: '单局结算物品价值 ≥500', reward: 400 },
  gold_legend: { name: '传说收藏家', desc: '携带传说装备撤离成功', reward: 500 },
};
