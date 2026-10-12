/* THE BIG CON: BATTLE ROYALE — shared types
 * An FPS adaptation of the Big Con board game (waxmotson/bigcon).
 * Host-authoritative PeerJS networking, same protocol style as the board game.
 */

export type NodeType =
  | 'BANK' | 'REGULATOR' | 'CHART' | 'COMMODITY' | 'CORPORATE' | 'MEDIA' | 'WILD';

export type Mood = 'CALM' | 'BOOM' | 'PANIC' | 'FRENZY';

export type Phase = 'lobby' | 'drop' | 'live' | 'ended';

export interface NodeDef {
  id: string;
  name: string;
  sub: string;            // satirical subtitle, verbatim vibe from the board game
  type: NodeType;
  income: number;         // $ per quarter
  cost: number;           // list price to seize
  img: string;            // /exhibits/xxx.png billboard image
  x: number; z: number;   // world position (meters)
  district: string;
  neverInflates?: boolean; // RBA, QANTAS, MADE — takeovers stay list price
  synergy?: string;       // passive description shown on HUD
}

export interface WeaponDef {
  id: string;
  name: string;
  sub: string;
  dmg: number;
  pellets: number;        // >1 for shotgun
  mag: number;
  reserveMax: number;
  rof: number;            // seconds between shots
  reload: number;         // seconds
  range: number;          // meters (hitscan falloff clamp)
  spread: number;         // radians at range
  zoom: number;           // ADS fov multiplier (1 = none)
  tier: number;           // loot rarity 1 common, 3 rare
  recoil: number;
}

export interface CharDef {
  id: string;
  name: string;
  img: string;
  sub: string;
}

export interface EventCardDef {
  id: string;
  name: string;
  icon: string;           // emoji (DOM only — never in 3D text)
  desc: string;
  mood: Mood | 'KEEP';
  kind: string;           // sim dispatcher key
}

export interface LobbyPlayer {
  name: string;
  playerId: string;
  char: string | null;    // character id
  ready: boolean;
  dc: boolean;
}

export interface PlayerPub {      // per-player state broadcast to everyone
  name: string;
  char: string;
  color: string;
  hp: number;
  money: number;
  intel: number;
  cor: number;            // cortisol 0..10
  dead: boolean;
  dc: boolean;
  markedUntil: number;    // raid beacon expiry (sim time)
  kills: number;
  nodes: string[];
  weapon: string;
  bugCount: number;
}

export interface NodePub {
  id: string;
  owner: number | null;   // player index
  takeovers: number;      // price inflation counter
  bugBy: number | null;   // player index skimming $1/quarter
}

export interface ZonePub {
  cx: number; cz: number; r: number;
  phase: number;          // 0 = grace, 1..N shrinking
  nextAt: number;         // sim seconds until next transition
}

export interface FxEvent {
  k: 'shot' | 'hit' | 'kill' | 'boom' | 'pickup' | 'seize' | 'income' | 'raid' | 'text' | 'marker';
  a?: number; b?: number; // attacker / victim indexes
  x?: number; y?: number; z?: number;
  n?: string;             // text / node id / weapon id
  v?: number;             // amount
  s?: string;             // style key for text fx
  id?: number;            // dedupe id
}

export interface Snapshot {      // full-ish state, 2Hz
  phase: Phase;
  t: number;                      // sim seconds since match start
  qNum: number; qEnd: number;     // quarter number / seconds to next income
  evEnd: number;                  // seconds to next event
  evCount: number;                // cards remaining (reshuffles)
  mood: Mood;
  players: PlayerPub[];
  nodes: NodePub[];
  zone: ZonePub;
  goal: number;
  winner: number | null;
  winMsg: string;
  logTail: { n: number; s: string }[];
  chatTail: { n: number; s: string; who: string; col: string }[];
  pickups: (readonly [number, string, number, number, number, string])[]; // [id, kind, x, z, v, w]
}

/* ---- wire protocol ---- */
export type GuestMsg =
  | { t: 'hello'; name: string; playerId: string }
  | { t: 'pick'; char: string }
  | { t: 'chat'; text: string }
  | { t: 'pose'; x: number; y: number; z: number; ry: number; p: number; mv: number }
  | { t: 'shot'; wpn: string; hit: number | null; dmg: number; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }
  | { t: 'seize'; node: string }
  | { t: 'oil'; x: number; z: number }
  | { t: 'ability'; kind: 'favor' | 'leak' | 'spy' | 'bug' | 'redeploy' | 'jtdeny' }
  | { t: 'pickup'; id: number }
  | { t: 'weapon'; slot: number }
  | { t: 'reload' }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number };

export type HostMsg =
  | { t: 'welcome'; idx: number; roster: LobbyPlayer[]; goal: number; chat: { n: number; s: string; who: string; col: string }[] }
  | { t: 'lobby'; roster: LobbyPlayer[]; goal: number }
  | { t: 'begin'; snap: Snapshot; idx: number; seed: number; spawns: number[] }
  | { t: 'state'; snap: Snapshot }
  | { t: 'poses'; arr: number[] }   // flat [idx,x,y,z,ry,p,mv]×N
  | { t: 'fx'; fx: FxEvent[] }
  | { t: 'event'; card: { name: string; icon: string; desc: string; mood: string } }
  | { t: 'sys'; msg: string; kind?: 'info' | 'bad' | 'good' }
  | { t: 'log'; lines: string[] }
  | { t: 'chat'; s: string; who: string; col: string; n: number }
  | { t: 'end'; snap: Snapshot }
  | { t: 'reload' }
  | { t: 'kick'; reason: string }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number };

export const COLORS = {
  bg: '#1d201f',
  panel: '#111413',
  teal: '#168388',
  tealDim: '#08383a',
  tealHot: '#7ff6fb',
  tealHover: '#0e5c60',
  text: '#f2f2f2',
  muted: '#d8d8d8',
  label: '#9ad',
  danger: '#ff6b5e',
  money: '#7fe08d',
  intel: '#55c1ff',
  cortisol: '#ffa94d',
  gold: '#f5c542',
  marker: '#d92b1f',
} as const;

export const TYPE_COLORS: Record<NodeType, string> = {
  BANK: '#a87511',
  COMMODITY: '#c05621',
  MEDIA: '#b5308c',
  CORPORATE: '#1f6f8b',
  REGULATOR: '#5c6b73',
  CHART: '#2e8b57',
  WILD: '#6b4fa0',
};

export const MOOD_COLORS: Record<Mood, string> = {
  CALM: '#8fbf7f',
  BOOM: '#f5c542',
  PANIC: '#ff6b5e',
  FRENZY: '#e19bff',
};

export const PCOLORS = [
  '#f5c542', '#55c1ff', '#e19bff', '#7fe08d',
  '#ff5e9c', '#ffffff', '#00e5c0', '#ffa94d',
];

/* tuning */
export const TICK = 1 / 30;            // host sim tick (seconds)
export const QUARTER_SEC = 12;         // income tick
export const EVENT_SEC = 24;           // market event cadence
export const POSE_HZ = 20;
export const MAP_R = 400;              // world half-extent (800×800m)
export const ZONE_START = 100;         // grace before THE PANIC closes in
export const WIN_TYPES: NodeType[] = ['BANK', 'REGULATOR', 'CHART', 'COMMODITY', 'CORPORATE', 'MEDIA', 'WILD'];
