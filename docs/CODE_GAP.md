# 代码现状审查：现有实现 vs GAME_DESIGN.md v4.1 差异表

> 基线：`GAME_DESIGN.md` v4.1（2026-10-15 冻结）。
> 核对对象：`src/game/types.ts`、`src/game/config.ts`、`src/game/mapgen.ts`、`src/game/storage.ts`、`src/pages/game/game.tsx`、`src/pages/index/index.tsx`（以及 icons.ts / CSS，未逐行展开）。
> 结论：现有代码为 **v1 骨架**（静态检查通过、可跑通一局），但与 v4.1 规格存在系统性差距。以下按文件列出「现状 → 规格要求 → 改造动作」。本表是修改指引，不代表任何功能已实现。

---

## 1. src/game/types.ts

| 项 | 现状（v1） | v4.1 要求 | 改造动作 |
|---|---|---|---|
| 物品模型 | `ItemType = weapon/armor/medkit/junk/coin`；物品 = `id: string`（模板引用，无实例） | `ItemInstance`：`instanceId/templateId/rarity/affixes/value/count`；`category = weapon/armor/med/junk`；coin 并入 junk | 新增 `Rarity`、`AffixDef`、`ItemInstance`、`ItemCategory`；`ItemDef` 保留为模板（无品质） |
| 品质 | 无 | white/green/blue/purple/gold + 词条 + 价值系数 | 新增品质枚举与词条类型 |
| Crate | `{x, y, loot: string[], searched: boolean}` | `{id, kind, state, openTicks, loot: ItemInstance[], x, y}`（unopened/opening/opened） | 重写 Crate 类型，去掉 searched |
| Enemy | `{id, kind, x, y, hp, maxHp, damage, range, cooldown}` | 同上 + 行为由运行时规则驱动（无需新字段） | 基本保留，可加 `state`（elite 冲锋预警标记，可选） |
| Profile | `{hp, maxHp, weaponId, armorId, stash: string[], money, runs, extractions, deaths}` | 增加 `version`、`upgrades{inv,hp,money,supply}`、`milestones`、`claimed`、`settledRunIds[]`、`pendingStartRunId`、`floorApplyRunId`；`stash` 改 `ItemInstance[]`；`weaponId/armorId` 改 `ItemInstance|null` | 重写 Profile 结构 + 版本迁移 |
| RunState | `{map, player, enemies, status: playing/extracted/dead, extractedLoot, extractProgress, createdAt}` | 增加 `runId`、`result`、`settlement`、`startSnapshot`、`pausedAt`、`modalPause`、`killStats{elite}`；**移除 extractedLoot**；status 改 `playing/extracting/settled`；`deadline`（倒计时绝对时间戳） | 重写 RunState |
| Settlement / StartSnapshot | 无 | 见 §11.4/§11.5 | 新增两个类型 |

## 2. src/game/config.ts

| 项 | 现状（v1） | v4.1 要求 | 改造动作 |
|---|---|---|---|
| 时间 | `TICK_MS=120`、`ENEMY_TICK_MS=420`、`ATTACK_COOLDOWN_MS=700`、`HEAL_COOLDOWN_MS=600`（ms 制混用） | 全 tick 制：`ENEMY_TICK=4`、武器间隔 6/8/7 tick、治疗 5 tick、速射作用于 tick | 删除 ms 冷却常量；新增 tick 常量；冷却计算统一 §6.4 |
| 倒计时 | `EXTRACT_SECONDS=3`（被当作撤离引导 3s，**无 240s 限时倒计时**） | `EXTRACT_SECONDS=240`（限时）+ `EXTRACT_CHANNEL_MS=3000`（撤离引导） | 拆分两个常量；game.tsx 增加 deadline 逻辑 |
| 品质/词条 | 无 | §6.1 品质概率表 + §6.3 词条表 + 公式 | 新增 `RARITY_DEFS`、`AFFIX_DEFS`、`QUALITY_TABLE`（普通/金箱） |
| 商店/升级/成就 | 无 | §10.3 商店、§10.5 升级、§10.6 成就 | 新增 `SHOP_ITEMS`、`UPGRADE_DEFS`、`ACHIEVEMENTS` |
| 资金底线 | 无 | `BASE_MONEY_FLOOR=150` + 升级加成 | 新增常量 |
| 金箱 | 无 | `OPEN_CRATE_TICKS=17`、金箱 80% 概率、品质上移 | 新增常量与逻辑 |
| 地图参数 | 房间 `rand(5,6)`、尺寸 `rand(3,5)` | 房间 2–4、尺寸 4–6 | 修正常量 |
| 敌人 | `ENEMY_DEFS` 数值与 v4.1 一致（25/18/60、8/6/15、1/4/1） | 相同 | 无需改数值；分布与位置规则在 mapgen |

## 3. src/game/mapgen.ts

| 项 | 现状（v1） | v4.1 要求 | 改造动作 |
|---|---|---|---|
| 房间数/尺寸 | 5–6 房间、3–5 尺寸（与 13×13 配合拥挤） | 2–4 房间、4–6 尺寸、间隔 ≥1 格 | 改常量；overlap 判断复核（现有 while 条件存在运算符优先级问题） |
| 放物顺序 | 先建房间 → 放箱子/敌人 → 无连通性验证 | 先放物（箱子/金箱/敌人/精英）→ BFS 连通性验证 → 重试上限 50 → 预设兜底 | 重写 generateMap 主流程；新增 BFS、重试、预设地图 |
| 金箱 | 无 | 0–1 个（80%）、房间靠后、金箱房=1 精英+1 远程守卫（计入配额） | 新增金箱生成与守卫逻辑 |
| 箱子 | 每房 1–2 个、`LOOT_POOL` 随机 1–3 件、排除出生/撤离点（while 条件有 bug，可能死循环） | 普通箱品质掷取（1–3 件）、金箱品质上移；`Crate` 状态字段 | 重写箱子生成；掉落走品质表；修复排除逻辑 |
| 敌人 | `rooms × rand(2,3)`（≈10–18 敌）、精英仅在 ≥5 房间时存在、无分布约束 | `rooms × 2` 普通（近战 65%/远程 35%）+ **恒 1 精英**（金箱房/最后房间）、出生点 3 格外、撤离点格排除 | 重写敌人放置 |
| 连通性 | 无验证 | 全部关键格 BFS 可达；重试率 <5%；备用图使用率 0 | 新增验证与验收计数 |

## 4. src/game/storage.ts

| 项 | 现状（v1） | v4.1 要求 | 改造动作 |
|---|---|---|---|
| Profile 默认 | v1 结构、`stash: ['pistol','bandage']`（直接模板 id） | v4.1 结构：白手枪实例 + 绷带×2 堆叠 + 锚点默认值 | 重写 defaultProfile（物品实例化） |
| 版本迁移 | 合并默认值，无 version 字段 | `version=1` + 缺字段补默认 + 损坏备份重置 | 重写 loadProfile/saveProfile |
| RunState | load/save/clear 基础 OK | 增加 runId/result/settlement 等字段读写 | 重写 loadRun/saveRun 校验 |
| 出发/恢复 | 无（startRun 逻辑在 index.tsx 手写、无崩溃恢复） | §15.4 出发事务 + §15.2 restoreRun 统一入口 | 新增 startRun/restoreRun |
| 堆叠 | 无 | 堆叠合并/拆分、计数守恒 | 新增工具函数 |

## 5. src/pages/game/game.tsx（局内页，差距最大）

| 项 | 现状（v1） | v4.1 要求 | 改造动作 |
|---|---|---|---|
| 开局 | useLoad 内联生成地图+带入装备（无 runId/事务） | `restoreRun()` 统一五步（读档/重放/补暂停/判倒计时/恢复）+ `startRun()` 出发事务 | 重写 useLoad 逻辑 |
| 倒计时 | **无**（EXTRACT_SECONDS=3 被当作撤离引导 3 秒） | `deadline` 绝对时间戳 + 240s；暂停/恢复补偿 | 新增 deadline、倒计时渲染、MIA 判定 |
| 主循环 | setInterval(TICK_MS) 单定时器；敌人 4 tick 触发（计算一致但常量错位） | 单定时器 tick 制；`ENEMY_TICK=4` | 改用 tick 常量；逻辑基本可沿用 |
| 敌人行为 | 距离≤range 即攻击（**无视墙**）；无远程后退；无精英冲锋 | 视线判定（同行/同列无墙）；远程「贴脸后退→攻击→接近」优先级；精英蓄力冲锋（预警+方向+遇墙取消） | 重写敌人行动分支；新增视线/BFS 后退/冲锋 |
| 玩家攻击 | 距离≤range 即选中（无视墙）；无 HP 最低次选；无品质/词条 | 射程+视线+距离最近→HP 最低；品质/词条公式 §6.4 | 重写 doAttack |
| 开箱 | 踩格自动全拾（放得下才放，放不下直接丢弃） | 普通即时 / 金箱 17 tick 引导；替换弹层；未领取物品保留在 `Crate.loot` | 重写搜刮；新增金箱引导与替换弹层 |
| 撤离 | 3 秒引导；离开清零（OK）；无受击回退 | 3 秒引导；受击回退 50%；离开清零；先判 SUCCESS 再判 MIA | 调整引导时长来源；新增受击回退 |
| 结算 | finishRun 内联：extractedLoot 全部计入 money **又** 入库（**重复计账**），武器/护甲直接丢弃；DEAD 仅置 profile 装备 null | §12.3 幂等结算：Settlement 计算 → 落 RunState → **单快照**应用 Profile（变现/入库/成就/补足/settledRunIds）→ clearRun | 重写 finishRun 为 §12.3 四步；结算弹层数据来源 Settlement |
| 暂停 | 无（onHide/onShow 未处理；无弹层暂停） | §15.3 统一 pauseGame/resumeGame（弹层 + onHide/onShow） | 新增暂停钩子与补偿 |
| 渲染 | 每 tick setState 全量（性能风险） | 模拟 useRef + 节流快照（默认 2 tick） | 重构状态管理 |

## 6. src/pages/index/index.tsx（营地页）

| 项 | 现状（v1） | v4.1 要求 | 改造动作 |
|---|---|---|---|
| 商店/升级/成就 | 无 | §10.3/§10.5/§10.6 | 新增三个区块 |
| 出售 | 按 full value | `sellPrice = floor(value×0.5)` + 二次确认 | 改价格与确认 |
| 丢弃 | 无确认直接删 | 二次确认 | 加确认 |
| 物品展示 | 模板 id + 名称/价值 | 品质色 + 词条 + 堆叠数（count） | 改渲染（ItemInstance） |
| 装备 | 手动装备/卸下（OK）；**无自动装配** | 手动优先；未装备才自动装配仓库 value 最高 | startRun 时补自动装配 |
| 出发 | startRun 手写：只扣 meds，武器/护甲不从 Profile 移除（**物品归属违反 v4.1**） | §15.4 出发事务：装配物品移入 RunState、Profile 单快照扣除、`pendingStartRunId` 锚点 | 改用 storage.startRun |
| 补足 | 无 | §10.4 营地阶段补足一次（`floorApplyRunId`） | 加载/结算回营地时执行 |
| 物品 key | `Math.random()` | `instanceId` | 修正 |

## 7. 其他

| 项 | 现状 | v4.1 要求 | 改造动作 |
|---|---|---|---|
| icons.ts | 11 张素材映射（OK） | 金箱样式可用 CSS 类（不需新素材） | 基本保留 |
| CSS | 基础样式 | 品质色、金箱、弹层、预警、倒计时样式 | 补样式 |
| 武器/护甲实例化 | 模板 id 直接引用 | ItemInstance（品质/词条影响数值） | 全链路替换 |

---

## 影响面汇总

- **类型层（types.ts）**：全量重写 —— 引入 ItemInstance 是整个改造的根，后续所有模块依赖它。
- **配置层（config.ts）**：新增品质/词条/商店/升级/成就/金箱/资金底线/tick 常量；删除 ms 冷却。
- **算法层（mapgen.ts）**：重写主流程（先放物后验证、金箱、精英恒 1、BFS、兜底）。
- **数据层（storage.ts）**：重写 Profile/RunState 读写 + 版本迁移 + startRun/restoreRun + 堆叠。
- **局内页（game.tsx）**：重构时间模型（deadline）、敌人行为、攻击、开箱、结算事务、暂停、渲染节流。
- **营地页（index.tsx）**：新增商店/升级/成就/补足/自动装配，修正出售与出发事务。

## 建议改造顺序（对应阶段 01+02）

1. types.ts（ItemInstance/Profile/RunState/Settlement/StartSnapshot/Crate）
2. config.ts（常量与表）
3. mapgen.ts（地图/金箱/精英/BFS/兜底）
4. storage.ts（版本迁移 + startRun/restoreRun + 堆叠）
5. game.tsx（主循环/敌人/攻击/开箱/撤离/结算/暂停）
6. index.tsx（商店/升级/成就/补足/装配）
7. CSS/渲染细节

> 每完成一个模块按 §17 对应验收条件补测试/验证；不一次性生成全部代码。
