import { NodeDef, WeaponDef, CharDef, EventCardDef } from './types';

/* ============================================================
 * THE BIG CON: BATTLE ROYALE — game data
 * Exhibits, weapons, market events, characters, room codes.
 * Prices / incomes / effects are carried over from the board game
 * (v1.5) wherever the FPS frame allows it.
 * ============================================================ */

/* ---- 28 exhibits on the board (was 70 corkboard photos; the
 * con has been condensed into one skyline) ---- */
export const NODES: NodeDef[] = [
  /* BANK — the big four stick together */
  { id: 'citi', name: 'CITI TOWER', sub: 'too big to fail · 007 on payroll', type: 'BANK', income: 3, cost: 8, img: '/exhibits/citi-tower.png', x: 0, z: -260, district: 'CBD', synergy: '+$1 income per CORPORATE exhibit held' },
  { id: 'commbank', name: 'COMMONWEALTH BANK', sub: "can't be beat? we'll see", type: 'BANK', income: 2, cost: 6, img: '/exhibits/cba.png', x: -90, z: -180, district: 'CBD', synergy: '+$2 income while you hold any other BANK' },
  { id: 'westpac', name: 'WESTPAC', sub: 'sat through every inquiry', type: 'BANK', income: 2, cost: 6, img: '/exhibits/westpac.png', x: 80, z: -170, district: 'CBD', synergy: '+$1 income per REGULATOR exhibit held' },
  { id: 'bond', name: 'THE BOND DESK', sub: 'banker. sort of.', type: 'BANK', income: 3, cost: 8, img: '/exhibits/james-bond.png', x: -160, z: -265, district: 'CBD', synergy: '+$2 income · collects when BONDMAGEDDON hits' },

  /* REGULATOR — fair & furious */
  { id: 'rba', name: 'RESERVE BANK OF AUSTRALIA', sub: 'the cash rate is a lifestyle', type: 'REGULATOR', income: 2, cost: 10, img: '/exhibits/rba.png', x: 250, z: -230, district: 'THE RESERVE', neverInflates: true, synergy: '−1 Cortisol per quarter · your hostile takeovers stay list price' },
  { id: 'asic', name: 'ASIC', sub: 'unlocks the audit', type: 'REGULATOR', income: 1, cost: 5, img: '/exhibits/asic.png', x: 310, z: -130, district: 'THE RESERVE', synergy: 'your hits add +1 Cortisol to the victim' },
  { id: 'accc', name: 'ACCC', sub: 'reviews everything, eventually', type: 'REGULATOR', income: 1, cost: 5, img: '/exhibits/accc.png', x: 180, z: -70, district: 'THE RESERVE', synergy: 'rivals pay you +$2 review fee when they take one of YOUR exhibits' },

  /* CHART — the yield complex */
  { id: 'us', name: 'US TREASURY YIELD', sub: 'the global mood ring', type: 'CHART', income: 0, cost: 2, img: '/exhibits/us-treasury-yeild.png', x: 150, z: -320, district: 'CBD', synergy: '+$2 whenever TRUMP TWEETS' },
  { id: 'tenyear', name: '10-YEAR MASTER CHART', sub: 'the one everyone watches', type: 'CHART', income: 1, cost: 4, img: '/exhibits/government-bond-comparison.png', x: 60, z: -335, district: 'CBD', synergy: '+$3 income per other CHART exhibit held' },
  { id: 'infl', name: 'INFLATION DATA', sub: 'indexed to your feelings', type: 'CHART', income: 1, cost: 3, img: '/exhibits/inflation-data.png', x: 320, z: -300, district: 'THE RESERVE', synergy: 'salary $4 instead of $3' },
  { id: 'cash', name: 'CASH RATE GRAPH', sub: 'watch the dot', type: 'CHART', income: 1, cost: 3, img: '/exhibits/cash-rate-graph.png', x: 390, z: -220, district: 'THE RESERVE', synergy: '+$2 on RBA CASH-RATE DECISION' },

  /* COMMODITY — the dirt economy */
  { id: 'oil', name: 'CRUDE OIL PIT', sub: 'pays like a penalty rate', type: 'COMMODITY', income: 8, cost: 12, img: '/exhibits/wti-crude.png', x: 330, z: 40, district: 'THE DOCKS', synergy: 'pays $8 a quarter · +$6 whenever OIL SPIKES' },
  { id: 'tanker', name: 'TANKER FLEET', sub: 'just parked here, officer', type: 'COMMODITY', income: 2, cost: 5, img: '/exhibits/tanker-fleet.png', x: 370, z: -70, district: 'THE DOCKS', synergy: '+$3 on OIL SPIKES and COAL RUSH' },
  { id: 'gold', name: 'GOLD', sub: 'shiny. suspiciously shiny.', type: 'COMMODITY', income: 2, cost: 5, img: '/exhibits/gold-coloured-coin.png', x: -60, z: 320, district: 'THE OUTBACK', synergy: '+$5 on GOLD RUSH' },
  { id: 'train', name: 'THE COAL TRAIN', sub: 'never late, never clean', type: 'COMMODITY', income: 2, cost: 5, img: '/exhibits/coal-train.png', x: -110, z: 240, district: 'THE OUTBACK', synergy: '+15% sprint speed while held' },
  { id: 'coal', name: 'COAL CORP HQ', sub: 'the CEO has a private jet', type: 'COMMODITY', income: 3, cost: 7, img: '/exhibits/coal-corp-hq.png', x: -190, z: 175, district: 'THE OUTBACK', synergy: '+$2 income with THE COAL TRAIN held' },

  /* CORPORATE — the register */
  { id: 'quik', name: 'QUIKSTOP', sub: 'the servo that wanders', type: 'CORPORATE', income: 2, cost: 5, img: '/exhibits/quikstop.png', x: -240, z: -30, district: 'INNER WEST', synergy: 'every rival pays you $1 when OIL SPIKES · +$4 on PROFIT WARNING' },
  { id: 'market', name: 'MARKETPLACE LEICHARDT', sub: 'coffee, charcuterie, vibes', type: 'CORPORATE', income: 2, cost: 5, img: '/exhibits/marketplace.png', x: -310, z: -110, district: 'INNER WEST', synergy: '+$2 income while you hold QUIKSTOP' },
  { id: 'qantas', name: 'QANTAS', sub: 'the spirit of redeployment', type: 'CORPORATE', income: 2, cost: 20, img: '/exhibits/qantas.png', x: -330, z: 40, district: 'INNER WEST', neverInflates: true, synergy: 'K — redeploy from the skies (45s cooldown)' },

  /* MEDIA — the machine */
  { id: 'press', name: 'PRESS ROOM', sub: 'all the newspapers', type: 'MEDIA', income: 2, cost: 6, img: '/exhibits/all-the-newspapers.png', x: -170, z: 70, district: 'INNER WEST', synergy: '−1 extra Cortisol per quarter' },
  { id: 'fox', name: 'FOX BUSINESS', sub: 'fair & furious', type: 'MEDIA', income: 2, cost: 10, img: '/exhibits/fox-business.png', x: 230, z: 170, district: 'MEDIA ROW', synergy: '−2 extra Cortisol per quarter' },
  { id: 'leak', name: 'THE LEAK', sub: "it's only insider trading if you're on the outside", type: 'MEDIA', income: 2, cost: 6, img: '/exhibits/insider-trading-graphic.png', x: -90, z: 60, district: 'INNER WEST', synergy: '+1 Intel when you seize it · +$2 on BONDMAGEDDON' },
  { id: 'bigshort', name: 'THE BIG SHORT', sub: 'they explained it with a Jenga tower', type: 'MEDIA', income: 1, cost: 4, img: '/exhibits/the-big-short.png', x: 250, z: -10, district: 'THE DOCKS', synergy: '+$3 whenever a crash event lands' },

  /* WILD — the unexplained */
  { id: 'back', name: 'BACKROOM DEALS', sub: 'lanyards, panels, fondue', type: 'WILD', income: 1, cost: 4, img: '/exhibits/backroom-deals.png', x: -150, z: -140, district: 'CBD', synergy: 'seizure shortfalls auto-covered with Intel ($1 per 🛈)' },
  { id: 'term', name: 'THE TERMINAL', sub: 'two screens, zero sleep', type: 'WILD', income: 1, cost: 4, img: '/exhibits/bloomberg-terminal.png', x: -70, z: -320, district: 'CBD', synergy: 'see the next market event, privately' },
  { id: 'jt', name: 'JTPORTAL', sub: "quite frankly, that never happened", type: 'WILD', income: 1, cost: 9, img: '/exhibits/jt-portal.png', x: 380, z: 90, district: 'THE DOCKS', synergy: '+1 Intel per quarter · hold V during an event to deny it (once per game)' },
  { id: 'made', name: 'MADE', sub: 'the purple graphic. NOBODY knows why.', type: 'WILD', income: 2, cost: 7, img: '/exhibits/made-logo.png', x: -320, z: 130, district: 'INNER WEST', neverInflates: true, synergy: '33% per quarter: +$10 & +1 Intel for you; rivals −$3 & +1 Cortisol' },
  { id: 'sisy', name: 'SISYPHUS BOULDER', sub: 'it always rolls back down', type: 'WILD', income: 0, cost: 4, img: '/exhibits/sisyphus.png', x: 40, z: 230, district: 'THE OUTBACK', synergy: '+$3 income and +1 Cortisol every quarter. Repeatable. Forever.' },
];

export const NMAP: Record<string, NodeDef> = Object.fromEntries(NODES.map(n => [n.id, n]));

/* ---- weapons (satire, but they do shoot) ---- */
export const WEAPONS: WeaponDef[] = [
  { id: 'ppk', name: 'THE PPK', sub: '007 on payroll', dmg: 22, pellets: 1, mag: 12, reserveMax: 96, rof: 0.22, reload: 1.2, range: 120, spread: 0.012, zoom: 1.25, tier: 1, recoil: 1.1 },
  { id: 'auditor', name: 'THE AUDITOR', sub: 'goes through everything, line by line', dmg: 14, pellets: 1, mag: 30, reserveMax: 180, rof: 0.085, reload: 1.6, range: 90, spread: 0.03, zoom: 1.2, tier: 2, recoil: 0.8 },
  { id: 'bondmageddon', name: 'BONDMAGEDDON', sub: 'all of it, at once', dmg: 11, pellets: 8, mag: 6, reserveMax: 36, rof: 0.85, reload: 2.2, range: 45, spread: 0.09, zoom: 1, tier: 2, recoil: 3.2 },
  { id: 'tweet', name: 'THE TWEET', sub: 'devastating.', dmg: 38, pellets: 1, mag: 10, reserveMax: 60, rof: 0.5, reload: 1.8, range: 200, spread: 0.005, zoom: 1.8, tier: 2, recoil: 2.1 },
  { id: 'boulder', name: 'THE BOULDER', sub: 'it always rolls back down', dmg: 20, pellets: 1, mag: 60, reserveMax: 240, rof: 0.1, reload: 3.2, range: 160, spread: 0.038, zoom: 1.15, tier: 3, recoil: 1.3 },
  { id: 'dossier', name: 'THE DOSSIER', sub: 'three pages of receipts per shot', dmg: 95, pellets: 1, mag: 4, reserveMax: 20, rof: 1.35, reload: 2.6, range: 420, spread: 0.001, zoom: 4.5, tier: 3, recoil: 4.0 },
];
export const WMAP: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

/* ---- characters (the table) ---- */
export const CHARS: CharDef[] = [
  { id: 'markwatson', name: 'MARK WATSON', img: '/characters/markwatson.png', sub: 'coal adjacent' },
  { id: 'tomkins', name: 'TOMKINS', img: '/characters/tomkins.png', sub: 'the diploma' },
  { id: 'jimchalmers', name: 'JIM CHALMERS', img: '/characters/jimchalmers.png', sub: 'delivers the budget' },
  { id: 'bessock', name: 'BESSOCK', img: '/characters/bessock.png', sub: 'big bessent energy' },
  { id: 'calvinathanasius', name: 'CALVIN ATHANASIUS', img: '/characters/calvinathanasius.png', sub: 'the MPC finals' },
  { id: 'denialswan', name: 'DENIAL SWAN', img: '/characters/denialswan.png', sub: 'not a bond' },
  { id: 'japsnchen', name: 'JAPSN CHEN', img: '/characters/japsnchen.png', sub: 'risk is a construct' },
  { id: 'thousandyardwax', name: 'THOUSAND YARD WAX', img: '/characters/thousandyardwax.png', sub: 'has seen the tape' },
];
export const CMAP: Record<string, CharDef> = Object.fromEntries(CHARS.map(c => [c.id, c]));

/* ---- the rumor deck: 24 cards, same names as the board ---- */
export const EVENTS: EventCardDef[] = [
  { id: 'oilspikes', name: 'OIL SPIKES — WTI +12%', icon: '🛢️', desc: 'The barrel is angry. Everyone pays the servo.', mood: 'BOOM', kind: 'oilspikes' },
  { id: 'coalrush', name: 'COAL RUSH', icon: '🚃', desc: 'The train runs all night. So does the money.', mood: 'BOOM', kind: 'coalrush' },
  { id: 'rbarate', name: 'RBA CASH-RATE DECISION', icon: '🏛️', desc: 'Governor Bullock leans into the microphone. Money gets expensive — for everyone but the insiders.', mood: 'CALM', kind: 'rbarate' },
  { id: 'bondmageddon', name: 'BONDMAGEDDON', icon: '💥', desc: 'All of it, at once. The desk collects.', mood: 'PANIC', kind: 'bondmageddon' },
  { id: 'ceophoto', name: 'CEO PHOTO LEAKS — COAL CORP', icon: '📸', desc: 'A gym, a blender, a set of books that needed cooking.', mood: 'FRENZY', kind: 'ceophoto' },
  { id: 'trumptweets', name: 'TRUMP TWEETS TARIFFS', icon: '🦅', desc: 'ALL CAPS. Exclamation points. Global markets do a synchronized swan dive.', mood: 'PANIC', kind: 'trumptweets' },
  { id: 'bessent', name: 'BIG BESSENT SPEAKS', icon: '🎤', desc: 'Nobody remembers what was said. Everyone remembers the haircut.', mood: 'CALM', kind: 'bessent' },
  { id: 'budget', name: 'THE JIM DELIVERS THE BUDGET', icon: '📰', desc: 'Return to sender (taxes).', mood: 'CALM', kind: 'budget' },
  { id: 'mpc', name: 'MONETARY POLICY COMPETITION FINALS', icon: '🏆', desc: 'Papers, calculators, despair. The Diploma Programme does not grade on charisma.', mood: 'BOOM', kind: 'mpc' },
  { id: 'boulder', name: 'THE BOULDER ROLLS BACK DOWN', icon: '🪨', desc: 'The player with the most exhibits pays for the privilege.', mood: 'CALM', kind: 'boulder' },
  { id: 'goldrush', name: 'GOLD RUSH', icon: '🪙', desc: 'Paper money suddenly looks like a rumor.', mood: 'BOOM', kind: 'goldrush' },
  { id: 'rockcooks', name: 'THE ROCK COOKS', icon: '💪', desc: 'A meal for the whole table. Composure restored.', mood: 'CALM', kind: 'rockcooks' },
  { id: 'davos', name: 'DAVOS', icon: '🏔️', desc: 'Lanyards, panels, fondue. Every planted bug pays double.', mood: 'FRENZY', kind: 'davos' },
  { id: 'quikrob', name: 'QUIKSTOP ROBBERY', icon: '🎭', desc: 'A ski mask, a shopping bag, an empty register. The tapes are… missing.', mood: 'CALM', kind: 'quikrob' },
  { id: 'ibexams', name: 'IB EXAMS', icon: '📝', desc: 'Those who did the reading get smarter. Others did not.', mood: 'CALM', kind: 'ibexams' },
  { id: 'profitwarn', name: 'PROFIT WARNING… FOR OTHERS', icon: '⛽', desc: 'Snack economics. The servo wins again.', mood: 'CALM', kind: 'profitwarn' },
  { id: 'quietq', name: 'A QUIET QUARTER', icon: '🌙', desc: 'Nothing happens. Everyone collects anyway.', mood: 'CALM', kind: 'quietq' },
  { id: 'snoop', name: 'REGULATORS SNOOP AROUND', icon: '🔍', desc: 'A polite knock for whoever is running hot.', mood: 'CALM', kind: 'snoop' },
  { id: 'anontip', name: 'ANONYMOUS TIP', icon: '✉️', desc: 'A manila envelope, no return address.', mood: 'CALM', kind: 'anontip' },
  { id: 'mediafrenzy', name: 'MEDIA FRENZY', icon: '🗣️', desc: 'The press room picks a target and torches them.', mood: 'FRENZY', kind: 'mediafrenzy' },
  { id: 'monopoly', name: 'MONOPOLY ALERT', icon: '🚨', desc: 'The ACCC has feelings about concentration.', mood: 'PANIC', kind: 'monopoly' },
  { id: 'tapes', name: 'THE TAPES GO MISSING', icon: '🗑️', desc: 'Somehow the terminal kept copies.', mood: 'CALM', kind: 'tapes' },
  { id: 'shortscreen', name: 'THE BIG SHORT SCREENING', icon: '🎬', desc: 'Somebody was short the whole time.', mood: 'FRENZY', kind: 'shortscreen' },
  { id: 'madepay', name: 'MADE PAYS OUT… PROBABLY', icon: '🟣', desc: 'Nobody knows why. NOBODY.', mood: 'KEEP', kind: 'madepay' },
];

/* ---- room codes: the buzzword ledger, carried over verbatim ---- */
export const ROOM_CODES = [
  'WORLD ECONOMIC FORUM', 'NESA', 'JAKE TOMKINS', 'ELIJAH SON', 'SETH WEGRZYN',
  'AIDAN NEWLING', 'DANIEL SWAIN', 'TOKTIMER', 'RBA', 'BIG BESSENT',
  'NEW LAKEMBA', 'JTPORTAL', 'MCMETRO', 'CEO OF COAL', 'INKDIN',
  'HORMUZ', 'PYONGYANG UNIVERSITY', 'LOW CORTISOL',
];

export function slugCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function matchCode(input: string): string | null {
  const q = slugCode(input);
  if (!q) return null;
  const exact = ROOM_CODES.find(c => slugCode(c) === q);
  if (exact) return exact;
  const prefix = ROOM_CODES.filter(c => slugCode(c).startsWith(q));
  if (prefix.length === 1) return prefix[0];
  return null;
}

export function randomCode(): string {
  return ROOM_CODES[Math.floor(Math.random() * ROOM_CODES.length)];
}

/* ICE servers carried over from the board game's PeerJS setup */
export const BIGCON_ICE_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478', 'turn:eu-0.turn.peerjs.com:3478?transport=tcp', 'turn:us-0.turn.peerjs.com:3478?transport=tcp'], username: 'peerjs', credential: 'peerjsp' },
    { urls: ['turns:eu-0.turn.peerjs.com:5349', 'turns:us-0.turn.peerjs.com:5349'], username: 'peerjs', credential: 'peerjsp' },
  ],
  sdpSemantics: 'unified-plan',
  iceCandidatePoolSize: 4,
};
