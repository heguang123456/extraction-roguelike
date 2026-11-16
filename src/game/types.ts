// 搜打撤 roguelike 离线版 - 类型定义（v4.1）

export type Rarity = 'white' | 'green' | 'blue' | 'purple' | 'gold';

export type ItemCategory = 'weapon' | 'armor' | 'med' | 'junk';

// 物品实例（唯一归属：stash | weapon | armor | run.inventory | run.weapon/armor）
export interface ItemInstance {
  instanceId: string;   // `${templateId}_${timestamp}_${seq}`
  templateId: string;
  rarity: Rarity;
  affixes: string[];
  value: number;        // 单件价值（§6.4）
  count: number;        // 堆叠数量（仅 bandage/medkit 可 >1，默认 1）
}

// 模板定义（无品质，品质体现在实例上）
export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  iconKey: string;
  baseValue: number;
  desc: string;
  damage?: number;   // 武器基础伤害
  range?: number;    // 武器基础射程（曼哈顿格）
  defense?: number;  // 护甲基础减伤
  heal?: number;     // 药品回复量
}

export interface AffixDef {
  key: string;
  name: string;
  appliesTo: 'weapon' | 'armor';
  kind: 'percent' | 'flat' | 'cdr' | 'lifesteal' | 'vitality';
  value: number;
  maxStacks: number;
}

export type EnemyKind = 'melee' | 'range' | 'elite';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  cooldown: number;       // 剩余攻击冷却（tick）
  chargeCd?: number;      // 精英：冲锋冷却（敌人行动回合数）
  charging?: boolean;     // 精英：预警回合（下回合冲锋）
  chargeDir?: { x: number; y: number }; // 精英：冲锋方向
}

export interface Crate {
  id: string;
  kind: 'normal' | 'gold';
  state: 'unopened' | 'opening' | 'opened';
  openTicks: number;      // 金箱引导进度（0..17）
  loot: ItemInstance[];
  x: number;
  y: number;
}

export type CellType = 'wall' | 'floor';

export interface MapData {
  width: number;
  height: number;
  cells: CellType[][];
  crates: Crate[];
  enemies: Enemy[];
  extract: { x: number; y: number };
  playerStart: { x: number; y: number };
}

export type RunStatus = 'playing' | 'extracting' | 'settled';
export type RunResult = 'success' | 'dead' | 'mia' | null;

export interface StartSnapshot {
  runId: string;
  movedItemIds: string[]; // 从 Profile 移入局内的物品 instanceId（武器/护甲/补给）
}

export interface Settlement {
  runId: string;
  result: 'success' | 'dead' | 'mia';
  moneyDelta: number;        // 净资金变化（SUCCESS 变现合计 + 成就奖励；DEAD/MIA 成就奖励或 0）
  keptItems: ItemInstance[]; // SUCCESS：入库物品；DEAD/MIA：空
  destroyedCount: number;    // 销毁物品计数
  extras: { extractions: number; deaths: number; runs: number };
  milestoneAwards: Record<string, number>; // 本次成就奖励
  totalValue: number;        // 本局结算物品总 value（「满载而归」判定依据）
}

export interface RunState {
  version: 1;
  runId: string;
  status: RunStatus;
  result: RunResult;
  hp: number;
  maxHp: number;
  pos: { x: number; y: number };
  map: MapData;
  enemies: Enemy[];
  inventory: ItemInstance[];
  weapon: ItemInstance | null;
  armor: ItemInstance | null;
  deadline: number;             // 倒计时绝对时间戳（ms）
  pausedAt: number | null;      // 暂停开始时刻（暂停态非空，§15.3）
  modalPause: boolean;          // 弹层暂停标志
  killStats: { elite: number };
  startSnapshot: StartSnapshot | null;
  settlement: Settlement | null;
  extractProgress: number;
  createdAt: number;
}

// 营地存档（跨局持久）
export interface Profile {
  version: 1;
  hp: number;                    // 营地生命（结算后回满）
  maxHp: number;                 // 最大生命（100 + 升级）
  money: number;
  stash: ItemInstance[];
  weapon: ItemInstance | null;
  armor: ItemInstance | null;
  extractions: number;
  deaths: number;
  runs: number;
  upgrades: { inv: number; hp: number; money: number; supply: number };
  milestones: Record<string, number>;
  claimed: Record<string, boolean>;
  settledRunIds: string[];
  pendingStartRunId: string | null;
  floorApplyRunId: string;
}
