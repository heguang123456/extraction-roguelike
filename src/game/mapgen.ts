// 搜打撤 roguelike 离线版 - 随机地图生成（v4.1 §4：先放物后验证，BFS 连通，预设兜底）

import type { MapData, CellType, Enemy, Crate, EnemyKind, ItemInstance } from './types';
import {
  GRID_W,
  GRID_H,
  ROOM_COUNT_MIN,
  ROOM_COUNT_MAX,
  ROOM_SIZE_MIN,
  ROOM_SIZE_MAX,
  MAP_RETRY_LIMIT,
  GOLD_CRATE_CHANCE,
  ENEMY_DEFS,
} from './config';
import { makeItem } from './balance';

interface Room {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const ALL_TEMPLATES = ['pistol', 'shotgun', 'rifle', 'light_armor', 'heavy_armor', 'bandage', 'medkit', 'parts', 'chip', 'coin_stack'];
const GEAR_TEMPLATES = ['pistol', 'shotgun', 'rifle', 'light_armor', 'heavy_armor', 'parts', 'chip', 'coin_stack'];

// 生成一局地图（带重试与兜底）
export function generateMap(): MapData {
  for (let attempt = 0; attempt < MAP_RETRY_LIMIT; attempt++) {
    const rooms = placeRooms();
    if (!rooms) continue;
    const map = buildMap(rooms);
    if (map && verifyConnectivity(map)) return map;
  }
  return buildFallbackMap();
}

// 放置房间：随机数量/尺寸/位置，间隔 ≥1 格墙
function placeRooms(): Room[] | null {
  const cells: CellType[][] = Array.from({ length: GRID_H }, () => Array<CellType>(GRID_W).fill('wall'));
  const rooms: Room[] = [];
  const roomCount = rand(ROOM_COUNT_MIN, ROOM_COUNT_MAX);
  let attempts = 0;
  while (rooms.length < roomCount && attempts < 200) {
    attempts++;
    const w = rand(ROOM_SIZE_MIN, ROOM_SIZE_MAX);
    const h = rand(ROOM_SIZE_MIN, ROOM_SIZE_MAX);
    const x = rand(1, GRID_W - w - 2);
    const y = rand(1, GRID_H - h - 2);
    const room: Room = {
      x1: x,
      y1: y,
      x2: x + w - 1,
      y2: y + h - 1,
      cx: Math.floor((x + x + w - 1) / 2),
      cy: Math.floor((y + y + h - 1) / 2),
    };
    // 与已有房间至少 1 格墙间隔
    const tooClose = rooms.some(
      (r) => !(room.x2 + 1 < r.x1 - 1 || room.x1 - 1 > r.x2 + 1 || room.y2 + 1 < r.y1 - 1 || room.y1 - 1 > r.y2 + 1),
    );
    if (tooClose) continue;
    for (let yy = room.y1; yy <= room.y2; yy++) {
      for (let xx = room.x1; xx <= room.x2; xx++) {
        cells[yy][xx] = 'floor';
      }
    }
    rooms.push(room);
  }
  return rooms.length >= ROOM_COUNT_MIN ? rooms : null;
}

// 由房间构造完整地图（放物失败返回 null）
function buildMap(rooms: Room[]): MapData | null {
  const cells: CellType[][] = Array.from({ length: GRID_H }, () => Array<CellType>(GRID_W).fill('wall'));
  rooms.forEach((room) => {
    for (let yy = room.y1; yy <= room.y2; yy++) {
      for (let xx = room.x1; xx <= room.x2; xx++) {
        cells[yy][xx] = 'floor';
      }
    }
  });
  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(cells, rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy);
  }

  const firstRoom = rooms[0];
  const lastRoom = rooms[rooms.length - 1];
  const playerStart = { x: firstRoom.cx, y: firstRoom.cy };
  const extract = { x: lastRoom.cx, y: lastRoom.cy };

  // 金箱：80% 概率，放房间顺序靠后（≥ 第 2 房间）的角落格
  const goldCrateRoomIdx = Math.random() < GOLD_CRATE_CHANCE ? rand(1, rooms.length - 1) : -1;

  const crates: Crate[] = [];
  const enemies: Enemy[] = [];
  const occupied: { x: number; y: number }[] = [{ ...playerStart }, { ...extract }];

  const tryPlace = (room: Room, avoid: (p: { x: number; y: number }) => boolean): { x: number; y: number } | null => {
    for (let t = 0; t < 12; t++) {
      const px = rand(room.x1, room.x2);
      const py = rand(room.y1, room.y2);
      if (avoid({ x: px, y: py })) continue;
      return { x: px, y: py };
    }
    return null;
  };
  const avoidOcc = (p: { x: number; y: number }) => occupied.some((o) => o.x === p.x && o.y === p.y);

  // 普通箱：每房间 1-2 个
  rooms.forEach((room, ri) => {
    const count = rand(1, 2);
    for (let i = 0; i < count; i++) {
      const p = tryPlace(room, (q) => avoidOcc(q) || (q.x === playerStart.x && q.y === playerStart.y) || (q.x === extract.x && q.y === extract.y));
      if (!p) return null;
      occupied.push(p);
      const lootCount = rand(1, 3);
      const loot: ItemInstance[] = [];
      for (let k = 0; k < lootCount; k++) {
        loot.push(makeItem(pick(ALL_TEMPLATES), 'normal'));
      }
      crates.push({ id: `crate_${p.x}_${p.y}`, kind: 'normal', state: 'unopened', openTicks: 0, loot, x: p.x, y: p.y });
    }
    void ri;
  });

  // 金箱：角落格，靠后房间
  if (goldCrateRoomIdx >= 0) {
    const room = rooms[goldCrateRoomIdx];
    const corners = [
      { x: room.x1, y: room.y1 },
      { x: room.x2, y: room.y1 },
      { x: room.x1, y: room.y2 },
      { x: room.x2, y: room.y2 },
    ];
    let goldPos: { x: number; y: number } | null = null;
    for (const c of corners) {
      if (!avoidOcc(c) && !(c.x === playerStart.x && c.y === playerStart.y) && !(c.x === extract.x && c.y === extract.y)) {
        goldPos = c;
        break;
      }
    }
    if (!goldPos) return null;
    occupied.push(goldPos);
    const lootCount = rand(1, 2);
    const loot: ItemInstance[] = [];
    for (let k = 0; k < lootCount; k++) {
      loot.push(makeItem(pick(GEAR_TEMPLATES), 'gold'));
    }
    crates.push({ id: `crate_${goldPos.x}_${goldPos.y}`, kind: 'gold', state: 'unopened', openTicks: 0, loot, x: goldPos.x, y: goldPos.y });
  }

  // 普通敌人：rooms×2，金箱房 1 名远程守卫计入配额
  let eid = 1;
  const totalNormal = rooms.length * 2;
  const goldRoom = goldCrateRoomIdx >= 0 ? rooms[goldCrateRoomIdx] : null;
  // 守卫
  if (goldRoom) {
    const p = tryPlace(goldRoom, (q) => avoidOcc(q) || dist(q, playerStart) < 3);
    if (!p) return null;
    occupied.push(p);
    enemies.push(makeEnemy(eid++, 'range', p.x, p.y));
  }
  // 其余普通敌人
  let remaining = totalNormal - (goldRoom ? 1 : 0);
  let guard = 0;
  while (remaining > 0 && guard < 200) {
    guard++;
    const room = pick(rooms);
    const kind: EnemyKind = Math.random() < 0.65 ? 'melee' : 'range';
    const p = tryPlace(room, (q) => avoidOcc(q) || dist(q, playerStart) < 3 || (q.x === extract.x && q.y === extract.y));
    if (!p) continue;
    occupied.push(p);
    enemies.push(makeEnemy(eid++, kind, p.x, p.y));
    remaining--;
  }
  if (remaining > 0) return null;

  // 精英：恒 1 个；有金箱放金箱房，否则最后房间
  const eliteRoom = goldRoom ?? lastRoom;
  const p = tryPlace(eliteRoom, (q) => avoidOcc(q) || dist(q, playerStart) < 3 || (q.x === extract.x && q.y === extract.y));
  if (!p) return null;
  occupied.push(p);
  enemies.push(makeEnemy(eid++, 'elite', p.x, p.y));

  return {
    width: GRID_W,
    height: GRID_H,
    cells,
    crates,
    enemies,
    extract,
    playerStart,
  };
}

function makeEnemy(id: number, kind: EnemyKind, x: number, y: number): Enemy {
  const def = ENEMY_DEFS[kind];
  return { id, kind, x, y, hp: def.hp, maxHp: def.hp, damage: def.damage, range: def.range, cooldown: 0 };
}

function carveCorridor(cells: CellType[][], x1: number, y1: number, x2: number, y2: number) {
  let cx = x1;
  let cy = y1;
  while (cx !== x2) {
    cells[cy][cx] = 'floor';
    cx += cx < x2 ? 1 : -1;
  }
  while (cy !== y2) {
    cells[cy][cx] = 'floor';
    cy += cy < y2 ? 1 : -1;
  }
  cells[cy][cx] = 'floor';
}

// BFS 连通性：出生点 → 撤离点、全部箱子格、全部敌人格
function verifyConnectivity(map: MapData): boolean {
  const targets = [map.extract, ...map.crates.map((c) => ({ x: c.x, y: c.y })), ...map.enemies.map((e) => ({ x: e.x, y: e.y }))];
  const visited = bfs(map, map.playerStart);
  return targets.every((t) => visited[t.y]?.[t.x]);
}

export function bfs(map: MapData, start: { x: number; y: number }): boolean[][] {
  const visited: boolean[][] = Array.from({ length: map.height }, () => Array<boolean>(map.width).fill(false));
  const queue: { x: number; y: number }[] = [start];
  visited[start.y][start.x] = true;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (visited[ny][nx]) continue;
      if (map.cells[ny][nx] !== 'floor') continue;
      visited[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  return visited;
}

// 敌人寻路：BFS 取路径第一步（全图可通行，不走其他敌人格）
export function findStep(map: MapData, enemies: Enemy[], from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } | null {
  if (from.x === to.x && from.y === to.y) return null;
  const occupied = new Set(enemies.filter((e) => !(e.x === from.x && e.y === from.y)).map((e) => `${e.x},${e.y}`));
  const prev: Record<string, string> = {};
  const visited: boolean[][] = Array.from({ length: map.height }, () => Array<boolean>(map.width).fill(false));
  const queue: { x: number; y: number }[] = [from];
  visited[from.y][from.x] = true;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.x === to.x && cur.y === to.y) {
      // 回溯第一步
      let key = `${to.x},${to.y}`;
      while (prev[key] && prev[key] !== `${from.x},${from.y}`) {
        const parts = prev[key].split(',');
        key = `${parts[0]},${parts[1]}`;
      }
      if (!prev[key]) return null;
      const parts = key.split(',');
      return { x: Number(parts[0]), y: Number(parts[1]) };
    }
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (visited[ny][nx]) continue;
      if (map.cells[ny][nx] !== 'floor') continue;
      if (occupied.has(`${nx},${ny}`)) continue;
      visited[ny][nx] = true;
      prev[`${nx},${ny}`] = `${cur.x},${cur.y}`;
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

// 视线：同行或同列且中间无墙
export function hasLineOfSight(map: MapData, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  if (a.x === b.x) {
    const step = b.y > a.y ? 1 : -1;
    for (let y = a.y + step; y !== b.y; y += step) {
      if (map.cells[y][a.x] === 'wall') return false;
    }
    return true;
  }
  if (a.y === b.y) {
    const step = b.x > a.x ? 1 : -1;
    for (let x = a.x + step; x !== b.x; x += step) {
      if (map.cells[a.y][x] === 'wall') return false;
    }
    return true;
  }
  return false;
}

export function isWalkable(map: MapData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.cells[y][x] === 'floor';
}

// 预设兜底地图（固定 3 房间，保证可用）
function buildFallbackMap(): MapData {
  const rooms: Room[] = [
    { x1: 1, y1: 1, x2: 5, y2: 5, cx: 3, cy: 3 },
    { x1: 7, y1: 1, x2: 11, y2: 5, cx: 9, cy: 3 },
    { x1: 7, y1: 7, x2: 11, y2: 11, cx: 9, cy: 9 },
  ];
  const map = buildMap(rooms);
  // 兜底路径不重试：若构造意外失败，直接手工兜底单房间图
  if (map) return map;
  return buildEmergencyMap();
}

// 极端兜底：单房间全连通图
function buildEmergencyMap(): MapData {
  const cells: CellType[][] = Array.from({ length: GRID_H }, () => Array<CellType>(GRID_W).fill('wall'));
  for (let y = 3; y <= 9; y++) {
    for (let x = 3; x <= 9; x++) {
      cells[y][x] = 'floor';
    }
  }
  const playerStart = { x: 6, y: 4 };
  const extract = { x: 6, y: 8 };
  const crate: Crate = {
    id: 'crate_4_6',
    kind: 'normal',
    state: 'unopened',
    openTicks: 0,
    loot: [makeItem('bandage', 'normal'), makeItem('parts', 'normal')],
    x: 4,
    y: 6,
  };
  const enemy: Enemy = makeEnemy(1, 'melee', 8, 6);
  return { width: GRID_W, height: GRID_H, cells, crates: [crate], enemies: [enemy], extract, playerStart };
}
