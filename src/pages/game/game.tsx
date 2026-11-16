import { View, Text, Image } from '@tarojs/components';
import type { TouchEventFunction } from '@tarojs/components/types/common';
import { Button } from '@/components/ui/button';
import Taro, { useLoad, useDidHide, useDidShow } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import {
  ITEMS,
  GRID_W,
  GRID_H,
  TICK_MS,
  ENEMY_TICK,
  HEAL_TICK,
  EXTRACT_CHANNEL_MS,
  EXTRACT_HIT_REGRESS,
  OPEN_CRATE_TICKS,
  INVENTORY_LIMIT,
  ELITE_CHARGE_RANGE,
  ELITE_CHARGE_INTERVAL,
  ELITE_CHARGE_DIST,
  RARITY_DEFS,
} from '@/game/config';
import { isWalkable, hasLineOfSight, findStep } from '@/game/mapgen';
import { restoreRun, saveRun, finishRun } from '@/game/storage';
import { iconOf } from '@/game/icons';
import {
  finalDamage,
  finalRange,
  finalCooldownTicks,
  finalDefense,
  itemCategory,
  itemDef,
  totalValue,
  splitStack,
  makeItem,
  makeItemWithRarity,
  rollRarity,
} from '@/game/balance';
import type { RunState, Profile, ItemInstance, Enemy } from '@/game/types';
import './game.css';

const DROP_ALL = ['pistol', 'shotgun', 'rifle', 'light_armor', 'heavy_armor', 'bandage', 'medkit', 'parts', 'chip', 'coin_stack'];
const DROP_GEAR = ['pistol', 'shotgun', 'rifle', 'light_armor', 'heavy_armor'];

const GamePage = () => {
  const [view, setView] = useState<RunState | null>(null);
  const [loading, setLoading] = useState(true);
  const [attackCd, setAttackCd] = useState(0);
  const [healCd, setHealCd] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [replaceItem, setReplaceItem] = useState<{ crateId: string; item: ItemInstance } | null>(null);
  const [dir, setDir] = useState({ x: 0, y: 0 });

  const runRef = useRef<RunState | null>(null);
  const profileRef = useRef<Profile | null>(null);
  const dirRef = useRef({ x: 0, y: 0 });
  const enemyTicks = useRef(0);
  const tickCount = useRef(0);
  const replaceRef = useRef<typeof replaceItem>(null);
  const joyCenter = useRef<{ cx: number; cy: number; r: number } | null>(null);

  const sysInfo = Taro.getSystemInfoSync();
  const mapPx = Math.min(sysInfo.windowWidth, 380) - 12;
  const cell = mapPx / GRID_W;

  const syncView = () => {
    const r = runRef.current;
    if (r) setView({ ...r });
  };

  const pauseGame = (run: RunState) => {
    if (run.pausedAt == null) run.pausedAt = Date.now();
    saveRun(run);
  };

  const resumeGame = (run: RunState) => {
    if (run.pausedAt != null) {
      run.deadline += Date.now() - run.pausedAt;
      run.pausedAt = null;
      saveRun(run);
    }
    syncView();
  };

  const finishBy = (result: 'success' | 'dead' | 'mia') => {
    const run = runRef.current;
    const profile = profileRef.current;
    if (!run || !profile || run.status === 'settled') return;
    const nextProfile = finishRun(run, profile, result);
    profileRef.current = nextProfile;
    setView({ ...run });
    setShowResult(true);
  };

  useLoad(() => {
    const res = restoreRun();
    runRef.current = res.run;
    profileRef.current = res.profile;
    setView(res.run);
    if (res.action === 'settled') setShowResult(true);
    setLoading(false);
  });

  useDidHide(() => {
    const run = runRef.current;
    if (run && run.status !== 'settled') pauseGame(run);
  });

  useDidShow(() => {
    const run = runRef.current;
    if (run && run.status !== 'settled' && run.pausedAt != null && !replaceRef.current) {
      resumeGame(run);
    }
  });

  // 主循环（tick 制）
  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => {
      const run = runRef.current;
      if (!run || run.status === 'settled') return;
      if (run.pausedAt != null) return; // 暂停冻结
      const now = Date.now();

      setAttackCd((c) => Math.max(0, c - 1));
      setHealCd((c) => Math.max(0, c - 1));

      // 敌人行动节拍
      enemyTicks.current += 1;
      const enemyTurn = enemyTicks.current >= ENEMY_TICK;
      if (enemyTurn) enemyTicks.current = 0;

      // 玩家移动
      const d = dirRef.current;
      if (d.x !== 0 || d.y !== 0) {
        tryMove(run, d.x, d.y);
      }

      // 撤离引导
      const onExtract = run.pos.x === run.map.extract.x && run.pos.y === run.map.extract.y;
      if (onExtract) {
        run.extractProgress += (TICK_MS / EXTRACT_CHANNEL_MS) * 100;
        if (run.extractProgress >= 100) {
          finishBy('success');
          return;
        }
      } else {
        run.extractProgress = 0;
      }

      // 开箱状态
      updateCrates(run);

      // 拾取
      tryPickups(run);

      // 敌人行动
      if (enemyTurn) {
        actEnemies(run);
      }

      // 结算判定
      if (run.hp <= 0) {
        finishBy('dead');
        return;
      }
      if (run.deadline <= now) {
        finishBy('mia');
        return;
      }

      // 节流渲染
      tickCount.current += 1;
      if (tickCount.current >= 2) {
        tickCount.current = 0;
        syncView();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const updateCrates = (run: RunState) => {
    for (const crate of run.map.crates) {
      const onCrate = crate.x === run.pos.x && crate.y === run.pos.y;
      if (crate.kind === 'gold') {
        if (crate.state === 'opening') {
          if (!onCrate) {
            crate.state = 'unopened';
            crate.openTicks = 0;
          } else {
            crate.openTicks += 1;
            if (crate.openTicks >= OPEN_CRATE_TICKS) crate.state = 'opened';
          }
        } else if (crate.state === 'unopened' && onCrate) {
          crate.state = 'opening';
        }
      } else if (crate.state === 'unopened' && onCrate) {
        crate.state = 'opened';
      }
    }
  };

  const tryPickups = (run: RunState) => {
    const limit = INVENTORY_LIMIT + (profileRef.current?.upgrades.inv || 0) * 2;
    for (const crate of run.map.crates) {
      if (crate.state !== 'opened' || crate.loot.length === 0) continue;
      if (crate.x !== run.pos.x || crate.y !== run.pos.y) continue;
      while (crate.loot.length > 0) {
        if (run.inventory.length >= limit) {
          replaceRef.current = { crateId: crate.id, item: crate.loot[0] };
          setReplaceItem(replaceRef.current);
          pauseGame(run);
          return;
        }
        run.inventory.push(crate.loot[0]);
        crate.loot.splice(0, 1);
      }
    }
  };

  const dropReplace = () => {
    const r = replaceRef.current;
    const run = runRef.current;
    if (!r || !run) return;
    const crate = run.map.crates.find((c) => c.id === r.crateId);
    if (crate) crate.loot = crate.loot.filter((i) => i.instanceId !== r.item.instanceId);
    replaceRef.current = null;
    setReplaceItem(null);
    resumeGame(run);
    saveRun(run);
  };

  const doReplace = (idx: number) => {
    const r = replaceRef.current;
    const run = runRef.current;
    if (!r || !run) return;
    const old = run.inventory[idx];
    const crate = run.map.crates.find((c) => c.id === r.crateId);
    if (!old || !crate) return;
    // 丢弃旧物、拾取新物
    run.inventory.splice(idx, 1);
    run.inventory.push(r.item);
    crate.loot = crate.loot.filter((i) => i.instanceId !== r.item.instanceId);
    replaceRef.current = null;
    setReplaceItem(null);
    resumeGame(run);
    saveRun(run);
  };

  const actEnemies = (run: RunState) => {
    for (const e of run.enemies) {
      e.cooldown = Math.max(0, e.cooldown - 1);
      if (e.kind === 'elite') actElite(run, e);
      else if (e.kind === 'range') actRanged(run, e);
      else actMelee(run, e);
    }
    saveRun(run);
  };

  const actMelee = (run: RunState, e: Enemy) => {
    const d = manhattan(e, run.pos);
    if (d <= e.range) {
      if (e.cooldown <= 0) {
        hitPlayer(run, e);
        e.cooldown = ENEMY_TICK * 2;
      }
    } else {
      const step = findStep(run.map, run.enemies, e, run.pos);
      if (step) {
        e.x = step.x;
        e.y = step.y;
      }
    }
  };

  const actRanged = (run: RunState, e: Enemy) => {
    const d = manhattan(e, run.pos);
    const los = hasLineOfSight(run.map, e, run.pos);
    if (d < 2 && los) {
      const back = retreatStep(run, e);
      if (back) {
        e.x = back.x;
        e.y = back.y;
      }
    } else if (d <= e.range && los) {
      if (e.cooldown <= 0) {
        hitPlayer(run, e);
        e.cooldown = ENEMY_TICK * 2;
      }
    } else {
      const step = findStep(run.map, run.enemies, e, run.pos);
      if (step) {
        e.x = step.x;
        e.y = step.y;
      }
    }
  };

  const actElite = (run: RunState, e: Enemy) => {
    if (e.charging) {
      // 执行冲锋
      e.charging = false;
      e.chargeCd = ELITE_CHARGE_INTERVAL;
      const chargeDirLocal = e.chargeDir;
      if (chargeDirLocal) {
        let cx = e.x;
        let cy = e.y;
        let moved = false;
        for (let i = 0; i < ELITE_CHARGE_DIST; i++) {
          const nx = cx + chargeDirLocal.x;
          const ny = cy + chargeDirLocal.y;
          if (!isWalkable(run.map, nx, ny)) break;
          if (run.enemies.some((o) => o !== e && o.x === nx && o.y === ny)) break;
          if (nx === run.pos.x && ny === run.pos.y) {
            hitPlayer(run, e);
            moved = true;
            break;
          }
          cx = nx;
          cy = ny;
          moved = true;
        }
        if (moved) {
          e.x = cx;
          e.y = cy;
        }
      }
    } else {
      if (e.chargeCd == null) e.chargeCd = ELITE_CHARGE_INTERVAL;
      e.chargeCd -= 1;
      const d = manhattan(e, run.pos);
      if (d <= ELITE_CHARGE_RANGE && e.chargeCd <= 0) {
        e.charging = true;
        e.chargeDir = chargeDir(e, run.pos);
      } else if (d <= e.range) {
        if (e.cooldown <= 0) {
          hitPlayer(run, e);
          e.cooldown = ENEMY_TICK * 2;
        }
      } else {
        const step = findStep(run.map, run.enemies, e, run.pos);
        if (step) {
          e.x = step.x;
          e.y = step.y;
        }
      }
    }
  };

  const hitPlayer = (run: RunState, e: Enemy) => {
    const armorDef = finalDefense(run.armor);
    const dmg = Math.max(1, e.damage - armorDef);
    run.hp = Math.max(0, run.hp - dmg);
    if (run.extractProgress > 0) {
      run.extractProgress = Math.max(0, run.extractProgress - EXTRACT_HIT_REGRESS * 100);
    }
    for (const crate of run.map.crates) {
      if (crate.kind === 'gold' && crate.state === 'opening') {
        crate.state = 'unopened';
        crate.openTicks = 0;
      }
    }
    syncView();
  };

  const doAttack = () => {
    const run = runRef.current;
    if (!run || run.status === 'settled' || run.pausedAt != null) return;
    if (attackCd > 0) return;
    const range = finalRange(run.weapon);
    const dmg = finalDamage(run.weapon);
    const cd = finalCooldownTicks(run.weapon);

    let target: Enemy | null = null;
    let bestD = Infinity;
    let bestHp = Infinity;
    for (const e of run.enemies) {
      const d = Math.abs(e.x - run.pos.x) + Math.abs(e.y - run.pos.y);
      if (d > range) continue;
      if (!hasLineOfSight(run.map, run.pos, e)) continue;
      if (d < bestD || (d === bestD && e.hp < bestHp)) {
        bestD = d;
        bestHp = e.hp;
        target = e;
      }
    }

    if (target) {
      target.hp -= dmg;
      if (target.hp <= 0) {
        const drop = rollEnemyDrop(target.kind);
        const limit = INVENTORY_LIMIT + (profileRef.current?.upgrades.inv || 0) * 2;
        if (drop && run.inventory.length < limit) run.inventory.push(drop);
        if (target.kind === 'elite') run.killStats.elite += 1;
        run.enemies = run.enemies.filter((x) => x !== target);
        syncView();
      }
    }
    setAttackCd(cd);
    saveRun(run);
    syncView();
  };

  const doHeal = () => {
    const run = runRef.current;
    if (!run || run.status === 'settled' || run.pausedAt != null) return;
    if (healCd > 0) return;
    const idx = run.inventory.findIndex((i) => itemCategory(i) === 'med');
    if (idx < 0 || run.hp >= run.maxHp) return;
    const med = itemDef(run.inventory[idx]);
    run.hp = Math.min(run.maxHp, run.hp + (med.heal || 0));
    const src = run.inventory[idx];
    if (src.count > 1) {
      const { remain } = splitStack(src, 1);
      run.inventory = [...run.inventory.slice(0, idx), remain, ...run.inventory.slice(idx + 1)];
    } else {
      run.inventory.splice(idx, 1);
    }
    setHealCd(HEAL_TICK);
    saveRun(run);
    syncView();
  };

  // 摇杆
  const queryJoy = () => {
    if (joyCenter.current) return;
    Taro.createSelectorQuery()
      .select('#joy')
      .boundingClientRect((rect) => {
        const r = Array.isArray(rect) ? rect[0] : rect;
        if (r) {
          joyCenter.current = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
        }
      })
      .exec();
  };
  const handleJoyMove: TouchEventFunction = (e) => {
    const t = e.touches && e.touches[0];
    const c = joyCenter.current;
    if (!t || !c) return;
    const dx = (t.clientX - c.cx) / (c.r * 0.6);
    const dy = (t.clientY - c.cy) / (c.r * 0.6);
    const sx = Math.abs(dx) > 0.25 ? Math.sign(dx) : 0;
    const sy = Math.abs(dy) > 0.25 ? Math.sign(dy) : 0;
    dirRef.current = { x: sx, y: sy };
    setDir({ x: sx, y: sy });
  };
  const handleJoyEnd = () => {
    dirRef.current = { x: 0, y: 0 };
    setDir({ x: 0, y: 0 });
  };

  if (loading || !view) {
    return (
      <View className="game-loading">
        <Text>加载行动数据...</Text>
      </View>
    );
  }

  const run = view;
  const player = run.pos;
  const weapon = run.weapon ? ITEMS[run.weapon.templateId] : null;
  const medCount = run.inventory.filter((i) => itemCategory(i) === 'med').length;
  const hpPct = Math.max(0, Math.min(100, (run.hp / run.maxHp) * 100));
  const extracting = run.pos.x === run.map.extract.x && run.pos.y === run.map.extract.y;
  const remainSec = Math.max(0, Math.ceil((run.deadline - Date.now()) / 1000));
  const lootValue = totalValue(run.inventory);

  return (
    <View className="game-root">
      {/* HUD */}
      <View className="game-hud">
        <View className="hud-hp-row">
          <Text className="hud-label">HP</Text>
          <View className="hud-hp-bar">
            <View className="hud-hp-fill" style={{ width: `${hpPct}%` }} />
          </View>
          <Text className="hud-hp-text">
            {run.hp}/{run.maxHp}
          </Text>
        </View>
        <View className="hud-info">
          <Text className={`hud-item hud-time${remainSec <= 30 ? ' hud-time-warn' : ''}`}>倒计时 {remainSec}s</Text>
          <Text className="hud-item">武器：{weapon ? weapon.name : '徒手'}</Text>
          <Text className="hud-item">背包：{run.inventory.length}/{INVENTORY_LIMIT + (profileRef.current?.upgrades.inv || 0) * 2}</Text>
          <Text className="hud-item">药品：{medCount}</Text>
          <Text className="hud-item">战利品估值：{lootValue}</Text>
        </View>
      </View>

      {/* 地图 */}
      <View className="map-wrap" style={{ width: mapPx, height: mapPx }}>
        <View
          className="map-grid"
          style={{ gridTemplateColumns: `repeat(${GRID_W}, ${cell}px)`, gridTemplateRows: `repeat(${GRID_H}, ${cell}px)` }}
        >
          {run.map.cells.map((row, y) =>
            row.map((c, x) => (
              <View key={`${x}-${y}`} className={c === 'wall' ? 'cell cell-wall' : 'cell cell-floor'} style={{ width: cell, height: cell }} />
            )),
          )}
        </View>

        {/* 撤离点 */}
        <View className="entity" style={{ left: run.map.extract.x * cell, top: run.map.extract.y * cell, width: cell, height: cell }}>
          <View className="extract-glow" />
          <Image className="entity-icon" src={iconOf('extract')} mode="aspectFill" />
          <Text className="entity-tag">撤离点</Text>
        </View>

        {/* 箱子 */}
        {run.map.crates.map((c) => (
          <View key={c.id} className="entity" style={{ left: c.x * cell, top: c.y * cell, width: cell, height: cell }}>
            <View className={c.state === 'opened' ? 'crate-dim' : ''}>
              <View className={c.kind === 'gold' ? 'crate-gold' : ''}>
                <Image className="entity-icon" src={iconOf('crate')} mode="aspectFill" />
              </View>
            </View>
            {c.kind === 'gold' && c.state === 'opening' && (
              <View className="crate-progress">
                <View className="crate-progress-fill" style={{ width: `${(c.openTicks / OPEN_CRATE_TICKS) * 100}%` }} />
              </View>
            )}
            {c.state === 'unopened' && <View className="loot-ping" />}
            {c.kind === 'gold' && c.state === 'unopened' && <View className="gold-glow" />}
          </View>
        ))}

        {/* 敌人 */}
        {run.enemies.map((e) => (
          <View key={e.id} className="entity" style={{ left: e.x * cell, top: e.y * cell, width: cell, height: cell }}>
            <Image
              className={`entity-icon enemy-icon${e.kind === 'elite' ? ' enemy-elite' : ''}${e.charging ? ' enemy-charging' : ''}`}
              src={iconOf(e.kind === 'melee' ? 'enemyMelee' : e.kind === 'range' ? 'enemyRange' : 'enemyElite')}
              mode="aspectFill"
            />
            <View className="enemy-hp">
              <View className="enemy-hp-fill" style={{ width: `${(e.hp / e.maxHp) * 100}%` }} />
            </View>
            {e.charging && <View className="charge-warn">!</View>}
          </View>
        ))}

        {/* 玩家 */}
        <View className="entity" style={{ left: player.x * cell, top: player.y * cell, width: cell, height: cell }}>
          <View className="player-glow" />
          <Image className="entity-icon player-icon" src={iconOf('player')} mode="aspectFill" />
        </View>
      </View>

      {/* 撤离进度 */}
      {extracting && run.status !== 'settled' && (
        <View className="extract-bar-row">
          <View className="extract-bar">
            <View className="extract-bar-fill" style={{ width: `${Math.min(100, run.extractProgress)}%` }} />
          </View>
          <Text className="extract-bar-text">撤离中 {Math.min(100, Math.floor(run.extractProgress))}%</Text>
        </View>
      )}

      {/* 控制区 */}
      <View className="game-controls">
        <View
          id="joy"
          className="joy"
          onTouchStart={queryJoy}
          onTouchMove={handleJoyMove}
          onTouchEnd={handleJoyEnd}
        >
          <View className="joy-dot" style={{ transform: `translate(${dir.x * 14}px, ${dir.y * 14}px)` }} />
        </View>
        <View className="ctrl-right">
          <Button className={`ctrl-btn ctrl-heal${healCd > 0 || medCount === 0 ? ' ctrl-disabled' : ''}`} onClick={doHeal}>
            治疗
          </Button>
          <Button className={`ctrl-btn ctrl-attack${attackCd > 0 ? ' ctrl-disabled' : ''}`} onClick={doAttack}>
            攻击
          </Button>
        </View>
      </View>

      {/* 替换弹层 */}
      {replaceItem && (
        <View className="result-mask">
          <View className="result-modal replace-modal">
            <Text className="result-title">背包已满</Text>
            <Text className="result-sub">拾取新物品需替换一件背包物品</Text>
            <View className="replace-new">
              <View className="replace-new-icon" style={{ borderColor: RARITY_DEFS[replaceItem.item.rarity].color }}>
                <Image className="replace-item-icon" src={iconOf(itemDef(replaceItem.item).iconKey)} mode="aspectFill" />
              </View>
              <View className="replace-new-info">
                <Text className="replace-new-name" style={{ color: RARITY_DEFS[replaceItem.item.rarity].color }}>
                  {RARITY_DEFS[replaceItem.item.rarity].name} {itemDef(replaceItem.item).name}
                </Text>
                <Text className="replace-new-value">价值 {replaceItem.item.value}</Text>
              </View>
            </View>
            <View className="replace-list">
              {run.inventory.map((item, i) => (
                <View key={item.instanceId} className="replace-item-row" onClick={() => doReplace(i)}>
                  <Image className="replace-item-icon" src={iconOf(itemDef(item).iconKey)} mode="aspectFill" />
                  <Text className="replace-item-name">{itemDef(item).name}{item.count > 1 ? ` ×${item.count}` : ''}</Text>
                  <Text className="replace-item-action">替换</Text>
                </View>
              ))}
            </View>
            <Button className="result-btn result-btn-ghost" onClick={dropReplace}>
              放弃新物品
            </Button>
          </View>
        </View>
      )}

      {/* 结算弹层 */}
      {showResult && run.settlement && (
        <View className="result-mask">
          <View className="result-modal">
            {run.settlement.result === 'success' ? (
              <>
                <Text className="result-title result-win">撤离成功</Text>
                <Text className="result-sub">
                  入库 {run.settlement.keptItems.length} 件 · 变现 +{run.settlement.moneyDelta} · 销毁 0
                </Text>
                {run.settlement.keptItems.length > 0 && (
                  <View className="result-loot">
                    {run.settlement.keptItems.map((item) => (
                      <View key={item.instanceId} className="result-loot-item">
                        <Image className="result-loot-icon" src={iconOf(itemDef(item).iconKey)} mode="aspectFill" />
                        <Text className="result-loot-name" style={{ color: RARITY_DEFS[item.rarity].color }}>
                          {RARITY_DEFS[item.rarity].name} {itemDef(item).name}
                          {item.count > 1 ? ` ×${item.count}` : ''}
                        </Text>
                        <Text className="result-loot-value">入库</Text>
                      </View>
                    ))}
                  </View>
                )}
                {Object.keys(run.settlement.milestoneAwards).length > 0 && (
                  <Text className="result-sub result-achieve">成就奖励 +{Object.values(run.settlement.milestoneAwards).reduce((a, b) => a + b, 0)}</Text>
                )}
              </>
            ) : (
              <>
                <Text className="result-title result-dead">{run.settlement.result === 'mia' ? '撤离超时' : '阵亡'}</Text>
                <Text className="result-sub">带入的武器、护甲与药品全部遗失（销毁 {run.settlement.destroyedCount} 件）</Text>
                {Object.keys(run.settlement.milestoneAwards).length > 0 && (
                  <Text className="result-sub result-achieve">成就奖励 +{Object.values(run.settlement.milestoneAwards).reduce((a, b) => a + b, 0)}</Text>
                )}
              </>
            )}
            <Button className="result-btn" onClick={() => Taro.navigateBack()}>
              返回营地
            </Button>
          </View>
        </View>
      )}
    </View>
  );
};

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chargeDir(e: Enemy, player: { x: number; y: number }): { x: number; y: number } {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  if (dx === 0) return { x: 0, y: Math.sign(dy) };
  if (dy === 0) return { x: Math.sign(dx), y: 0 };
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
}

function retreatStep(run: RunState, e: Enemy): { x: number; y: number } | null {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let best: { x: number; y: number } | null = null;
  let bestD = -1;
  for (const [dx, dy] of dirs) {
    const nx = e.x + dx;
    const ny = e.y + dy;
    if (!isWalkable(run.map, nx, ny)) continue;
    if (run.enemies.some((o) => o.x === nx && o.y === ny)) continue;
    if (nx === run.pos.x && ny === run.pos.y) continue;
    const d = Math.abs(nx - run.pos.x) + Math.abs(ny - run.pos.y);
    if (d > bestD) {
      bestD = d;
      best = { x: nx, y: ny };
    }
  }
  return best;
}

function rollEnemyDrop(kind: Enemy['kind']): ItemInstance | null {
  if (Math.random() > 0.2) return null;
  if (kind === 'elite') {
    let rarity = rollRarity('gold');
    if (rarity === 'white' || rarity === 'green') rarity = 'blue';
    return makeItemWithRarity(DROP_GEAR[Math.floor(Math.random() * DROP_GEAR.length)], rarity);
  }
  return makeItem(DROP_ALL[Math.floor(Math.random() * DROP_ALL.length)], 'normal');
}

function tryMove(run: RunState, dx: number, dy: number) {
  const blocked = (x: number, y: number) =>
    !isWalkable(run.map, x, y) ||
    run.enemies.some((e) => e.x === x && e.y === y) ||
    (run.pos.x === x && run.pos.y === y);
  if (dx !== 0 && !blocked(run.pos.x + dx, run.pos.y)) {
    run.pos.x += dx;
    return;
  }
  if (dy !== 0 && !blocked(run.pos.x, run.pos.y + dy)) {
    run.pos.y += dy;
    return;
  }
  if (dx !== 0 && dy !== 0 && !blocked(run.pos.x + dx, run.pos.y + dy)) {
    run.pos.x += dx;
    run.pos.y += dy;
  }
}

export default GamePage;
