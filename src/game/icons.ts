// 素材图标映射（集中管理 import，保证 Taro 打包处理）
import player from '../assets/images/player.jpg';
import enemyMelee from '../assets/images/enemy_melee.jpg';
import enemyRange from '../assets/images/enemy_range.jpg';
import enemyElite from '../assets/images/enemy_elite.jpg';
import extract from '../assets/images/extract.jpg';
import crate from '../assets/images/crate.jpg';
import itemMedkit from '../assets/images/item_medkit.jpg';
import itemWeapon from '../assets/images/item_weapon.jpg';
import itemArmor from '../assets/images/item_armor.jpg';
import itemJunk from '../assets/images/item_junk.jpg';
import itemCoin from '../assets/images/item_coin.jpg';

export const ICONS: Record<string, string> = {
  player,
  enemyMelee,
  enemyRange,
  enemyElite,
  extract,
  crate,
  item_medkit: itemMedkit,
  item_weapon: itemWeapon,
  item_armor: itemArmor,
  item_junk: itemJunk,
  item_coin: itemCoin,
};

export function iconOf(key: string): string {
  return ICONS[key] || ICONS.item_junk;
}
