import { View, Text, Image } from '@tarojs/components';
import { Button } from '@/components/ui/button';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';
import {
  ITEMS,
  SHOP_ITEMS,
  UPGRADE_DEFS,
  ACHIEVEMENTS,
  RARITY_DEFS,
  INVENTORY_LIMIT,
  PLAYER_MAX_HP,
} from '@/game/config';
import { loadProfile, saveProfile, startRun, floorFor } from '@/game/storage';
import { iconOf } from '@/game/icons';
import {
  itemDef,
  itemCategory,
  sellPrice,
  makeItemWithRarity,
  finalDamage,
  finalRange,
  finalCooldownTicks,
  finalDefense,
  vitalityBonus,
} from '@/game/balance';
import { applyFloorTopUp } from '@/game/settlement';
import type { Profile, ItemInstance } from '@/game/types';
import './index.css';

const IndexPage = () => {
  const [profile, setProfile] = useState<Profile | null>(null);

  const applyProfile = (next: Profile) => {
    setProfile({ ...next });
    saveProfile(next);
  };

  useDidShow(() => {
    let p = loadProfile();
    // 营地休息：HP 恢复满
    if (p.hp !== p.maxHp) p = { ...p, hp: p.maxHp };
    // 迁移/新档补足一次（旧档 floorApplyRunId 为空）
    if (p.floorApplyRunId === '') {
      p = applyFloorTopUp(p, floorFor(p), 'initial');
    }
    applyProfile(p);
  });

  const buyItem = (templateId: string, price: number) => {
    if (!profile) return;
    if (profile.money < price) {
      Taro.showToast({ title: '资金不足', icon: 'none' });
      return;
    }
    const item = makeItemWithRarity(templateId, 'white');
    applyProfile({ ...profile, money: profile.money - price, stash: [...profile.stash, item] });
  };

  const equip = (item: ItemInstance) => {
    if (!profile) return;
    const cat = itemCategory(item);
    if (cat !== 'weapon' && cat !== 'armor') return;
    const next = { ...profile, stash: profile.stash.filter((i) => i.instanceId !== item.instanceId) };
    if (cat === 'weapon') {
      const old = next.weapon;
      next.weapon = item;
      if (old) next.stash.push(old);
    } else {
      const old = next.armor;
      next.armor = item;
      if (old) next.stash.push(old);
    }
    applyProfile(next);
  };

  const unequip = (cat: 'weapon' | 'armor') => {
    if (!profile) return;
    const next = { ...profile };
    const item = next[cat];
    if (!item) return;
    next[cat] = null;
    next.stash = [...next.stash, item];
    applyProfile(next);
  };

  const confirmSell = (item: ItemInstance) => {
    if (!profile) return;
    Taro.showModal({
      title: '确认出售',
      content: `出售 ${RARITY_DEFS[item.rarity].name}${itemDef(item).name}（${item.count > 1 ? `×${item.count} ` : ''}价值 ${item.value}）得 ${sellPrice(item)} 资金？`,
      success: (res) => {
        if (!res.confirm || !profile) return;
        applyProfile({
          ...profile,
          money: profile.money + sellPrice(item),
          stash: profile.stash.filter((i) => i.instanceId !== item.instanceId),
        });
      },
    });
  };

  const confirmDiscard = (item: ItemInstance) => {
    if (!profile) return;
    Taro.showModal({
      title: '确认丢弃',
      content: `丢弃 ${RARITY_DEFS[item.rarity].name}${itemDef(item).name}（价值 ${item.value}）？丢弃后无法找回。`,
      success: (res) => {
        if (!res.confirm || !profile) return;
        applyProfile({ ...profile, stash: profile.stash.filter((i) => i.instanceId !== item.instanceId) });
      },
    });
  };

  const upgrade = (id: keyof Profile['upgrades']) => {
    if (!profile) return;
    const def = UPGRADE_DEFS[id];
    const lv = profile.upgrades[id];
    if (lv >= def.maxLevel) return;
    const cost = def.cost[lv];
    if (profile.money < cost) {
      Taro.showToast({ title: '资金不足', icon: 'none' });
      return;
    }
    const next = { ...profile, money: profile.money - cost, upgrades: { ...profile.upgrades, [id]: lv + 1 } };
    if (id === 'hp') {
      next.maxHp = PLAYER_MAX_HP + next.upgrades.hp * 10;
      next.hp = next.maxHp;
    }
    applyProfile(next);
  };

  const goRun = () => {
    if (!profile) return;
    const hasWeapon = !!profile.weapon || profile.stash.some((i) => itemCategory(i) === 'weapon');
    const doStart = () => {
      if (!profile) return;
      const res = startRun(profile);
      applyProfile(res.profile);
      Taro.navigateTo({ url: '/pages/game/index' });
    };
    if (!hasWeapon) {
      Taro.showModal({
        title: '徒手出发',
        content: '你没有可用武器，只能徒手战斗（伤害 4，射程 1）。确定出发？',
        success: (res) => {
          if (res.confirm) doStart();
        },
      });
    } else {
      doStart();
    }
  };

  if (!profile) {
    return (
      <View className="camp-loading">
        <Text>加载营地...</Text>
      </View>
    );
  }

  const stashLimit = INVENTORY_LIMIT + profile.upgrades.inv * 2;
  const floor = floorFor(profile);
  const achItems = [
    { id: 'first_taste', prog: profile.extractions, need: 5 },
    { id: 'hunter', prog: profile.milestones.eliteKills || 0, need: 3 },
    { id: 'rich_haul', prog: profile.claimed.rich_haul ? 1 : 0, need: 1 },
    { id: 'gold_legend', prog: profile.claimed.gold_legend ? 1 : 0, need: 1 },
  ];

  return (
    <View className="camp-root">
      {/* 营地信息 */}
      <View className="camp-header">
        <View className="camp-stats">
          <Text className="stat-chip">HP {profile.hp}/{profile.maxHp}</Text>
          <Text className="stat-chip stat-money">💰 {profile.money}</Text>
          <Text className="stat-chip">撤离 {profile.extractions}</Text>
          <Text className="stat-chip">阵亡 {profile.deaths}</Text>
          <Text className="stat-chip">局数 {profile.runs}</Text>
          <Text className="stat-chip stat-floor">资金底线 {floor}</Text>
        </View>
      </View>

      {/* 装备栏 */}
      <View className="camp-section">
        <Text className="section-title">装备</Text>
        <View className="equip-row">
          <View className="equip-slot">
            <Text className="equip-label">武器</Text>
            {profile.weapon ? (
              <View className="equip-item" onClick={() => unequip('weapon')}>
                <View className="equip-icon" style={{ borderColor: RARITY_DEFS[profile.weapon.rarity].color }}>
                  <Image className="equip-img" src={iconOf(itemDef(profile.weapon).iconKey)} mode="aspectFill" />
                </View>
                <Text className="equip-name" style={{ color: RARITY_DEFS[profile.weapon.rarity].color }}>
                  {RARITY_DEFS[profile.weapon.rarity].name}{itemDef(profile.weapon).name}
                </Text>
                <Text className="equip-stat">
                  伤 {finalDamage(profile.weapon)} · 距 {finalRange(profile.weapon)} · 冷却 {finalCooldownTicks(profile.weapon)}t
                </Text>
                {profile.weapon.affixes.length > 0 && (
                  <Text className="equip-affix">{profile.weapon.affixes.join(' · ')}</Text>
                )}
                <Text className="equip-action">点击卸下</Text>
              </View>
            ) : (
              <View className="equip-empty">
                <Text>未装备武器</Text>
                <Text className="equip-empty-sub">徒手伤害 4 · 射程 1</Text>
              </View>
            )}
          </View>
          <View className="equip-slot">
            <Text className="equip-label">护甲</Text>
            {profile.armor ? (
              <View className="equip-item" onClick={() => unequip('armor')}>
                <View className="equip-icon" style={{ borderColor: RARITY_DEFS[profile.armor.rarity].color }}>
                  <Image className="equip-img" src={iconOf(itemDef(profile.armor).iconKey)} mode="aspectFill" />
                </View>
                <Text className="equip-name" style={{ color: RARITY_DEFS[profile.armor.rarity].color }}>
                  {RARITY_DEFS[profile.armor.rarity].name}{itemDef(profile.armor).name}
                </Text>
                <Text className="equip-stat">
                  防 {finalDefense(profile.armor)}{vitalityBonus(profile.armor) > 0 ? ` · 活力 +${vitalityBonus(profile.armor)}` : ''}
                </Text>
                {profile.armor.affixes.length > 0 && (
                  <Text className="equip-affix">{profile.armor.affixes.join(' · ')}</Text>
                )}
                <Text className="equip-action">点击卸下</Text>
              </View>
            ) : (
              <View className="equip-empty">
                <Text>未装备护甲</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* 仓库 */}
      <View className="camp-section">
        <Text className="section-title">仓库（{profile.stash.length}/{stashLimit}）</Text>
        {profile.stash.length === 0 ? (
          <Text className="section-empty">仓库为空，去商店购买或进入行动搜刮</Text>
        ) : (
          <View className="stash-list">
            {profile.stash.map((item) => (
              <View key={item.instanceId} className="stash-row">
                <View className="stash-icon" style={{ borderColor: RARITY_DEFS[item.rarity].color }}>
                  <Image className="stash-img" src={iconOf(itemDef(item).iconKey)} mode="aspectFill" />
                </View>
                <View className="stash-info">
                  <Text className="stash-name" style={{ color: RARITY_DEFS[item.rarity].color }}>
                    {RARITY_DEFS[item.rarity].name}{itemDef(item).name}
                    {item.count > 1 ? ` ×${item.count}` : ''}
                  </Text>
                  <Text className="stash-desc">{itemDef(item).desc}</Text>
                  {item.affixes.length > 0 && <Text className="stash-affix">{item.affixes.join(' · ')}</Text>}
                  <Text className="stash-value">价值 {item.value} · 出售得 {sellPrice(item)}</Text>
                </View>
                <View className="stash-actions">
                  {(itemCategory(item) === 'weapon' || itemCategory(item) === 'armor') && (
                    <Button className="mini-btn" onClick={() => equip(item)}>
                      装备
                    </Button>
                  )}
                  <Button className="mini-btn mini-sell" onClick={() => confirmSell(item)}>
                    出售
                  </Button>
                  <Button className="mini-btn mini-discard" onClick={() => confirmDiscard(item)}>
                    丢弃
                  </Button>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 商店 */}
      <View className="camp-section">
        <Text className="section-title">商店（品质固定普通）</Text>
        <View className="shop-list">
          {SHOP_ITEMS.map((s) => {
            const def = ITEMS[s.templateId];
            return (
              <View key={s.templateId} className="shop-row">
                <View className="shop-icon">
                  <Image className="shop-img" src={iconOf(def.iconKey)} mode="aspectFill" />
                </View>
                <View className="shop-info">
                  <Text className="shop-name">{def.name}</Text>
                  <Text className="shop-desc">{def.desc}</Text>
                </View>
                <Button className={`mini-btn${profile.money < s.price ? ' mini-btn-disabled' : ''}`} onClick={() => buyItem(s.templateId, s.price)}>
                  {s.price}
                </Button>
              </View>
            );
          })}
        </View>
      </View>

      {/* 升级 */}
      <View className="camp-section">
        <Text className="section-title">营地升级</Text>
        {(Object.keys(UPGRADE_DEFS) as Array<keyof Profile['upgrades']>).map((id) => {
          const def = UPGRADE_DEFS[id];
          const lv = profile.upgrades[id];
          const maxed = lv >= def.maxLevel;
          const cost = maxed ? 0 : def.cost[lv];
          return (
            <View key={id} className="upgrade-row">
              <View className="upgrade-info">
                <Text className="upgrade-name">{def.name} Lv.{lv}/{def.maxLevel}</Text>
                <Text className="upgrade-desc">{def.desc(lv)}</Text>
              </View>
              <Button
                className={`mini-btn${maxed ? ' mini-btn-disabled' : ''}${!maxed && profile.money < cost ? ' mini-btn-disabled' : ''}`}
                onClick={() => upgrade(id)}
              >
                {maxed ? '已满级' : `${cost} 升级`}
              </Button>
            </View>
          );
        })}
      </View>

      {/* 成就 */}
      <View className="camp-section">
        <Text className="section-title">成就（奖励已随撤离结算发放）</Text>
        {achItems.map((a) => {
          const def = ACHIEVEMENTS[a.id];
          const done = a.prog >= a.need;
          const pct = Math.min(100, Math.round((a.prog / a.need) * 100));
          return (
            <View key={a.id} className="ach-row">
              <View className="ach-info">
                <Text className="ach-name">{def.name}{done ? ' ✓' : ''}</Text>
                <Text className="ach-desc">{def.desc} · 奖励 {def.reward}</Text>
              </View>
              <View className="ach-bar">
                <View className="ach-bar-fill" style={{ width: `${pct}%` }} />
              </View>
            </View>
          );
        })}
      </View>

      {/* 出发 */}
      <View className="camp-footer">
        <Button className="go-btn" onClick={goRun}>
          开始行动
        </Button>
        <Text className="go-tip">行动超时未撤离将损失带入的全部装备（徒手可出发）</Text>
      </View>
    </View>
  );
};

export default IndexPage;
