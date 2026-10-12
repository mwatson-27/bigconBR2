/* THE BIG CON: BATTLE ROYALE — host-authoritative simulation
 * Runs on the host only. Receives guest intents, ticks the match,
 * and emits snapshots + fx. Mirrors the board game rules where the
 * FPS frame allows: income quarters replace turn income, the rumor
 * deck still fires, cortisol still raids at 8, MADE still pays.
 */
import { NODES, NMAP, WMAP, EVENTS } from './data';
import {
  FxEvent, Mood, NodePub, PlayerPub, Snapshot, ZonePub,
  QUARTER_SEC, EVENT_SEC, TICK, MAP_R, ZONE_START, PCOLORS, WIN_TYPES,
} from './types';

interface SimPlayer extends PlayerPub {
  lastPose: { x: number; y: number; z: number; ry: number; p: number; mv: number };
  ammo: Record<string, number>;
  mag: Record<string, number>;
  lastShot: number;
  redeployAt: number;
  jtDenyUsed: boolean;
  hpF: number;          // fractional hp accumulator
  moneyF: number;
  oilCount: number;
  inZoneDmg: boolean;
}

interface Pickup {
  id: number;
  kind: 'money' | 'intel' | 'med' | 'ammo' | 'weapon' | 'oil';
  x: number; z: number;
  v: number;            // money amount / weapon id string as index into WK
  w?: string;           // weapon id when kind==='weapon'
  taken: boolean;
  respawnAt: number;
}

const ZONE_PHASES = [
  { r: 400, hold: ZONE_START, shrinkTo: 240 },
  { r: 240, hold: 40, shrinkTo: 150 },
  { r: 150, hold: 35, shrinkTo: 85 },
  { r: 85, hold: 30, shrinkTo: 40 },
  { r: 40, hold: 25, shrinkTo: 14 },
  { r: 14, hold: 20, shrinkTo: 6 },
  { r: 6, hold: 9999, shrinkTo: 6 },
];

export class Sim {
  players: SimPlayer[] = [];
  nodes: NodePub[] = [];
  zone: ZonePub = { cx: 0, cz: 0, r: 400, phase: 0, nextAt: ZONE_START };
  zoneTarget: { cx: number; cz: number; r: number } | null = null;
  mood: Mood = 'CALM';
  t = 0;
  qNum = 0;
  qEnd = QUARTER_SEC;
  evEnd = EVENT_SEC;
  deck: number[] = [];
  log: string[] = [];
  logN = 0;
  chatTail: { n: number; s: string; who: string; col: string }[] = [];
  winner: number | null = null;
  winMsg = '';
  goal = 100;
  phase: 'drop' | 'live' | 'ended' = 'drop';
  fxOut: FxEvent[] = [];
  fxId = 1;
  pickups: Pickup[] = [];
  pickupId = 1;
  private lastFullState = 0;
  onEnd: (() => void) | null = null;

  constructor(readonly roster: { name: string; char: string | null }[], goal: number, private sendFx: (fx: FxEvent[]) => void, private sendSys: (idx: number, msg: string, kind?: 'info' | 'bad' | 'good') => void, private sendEvent: (card: { name: string; icon: string; desc: string; mood: string }) => void, private chatSink: { s: string; who: string; col: string; n: number }[]) {}

  start(seed: number) {
    const rnd = mulberry(seed);
    /* shuffle deck + seating colors are fixed by index */
    this.deck = EVENTS.map((_, i) => i);
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
    this.players = this.roster.map((r, i) => ({
      name: r.name, char: r.char || 'markwatson', color: PCOLORS[i % PCOLORS.length],
      hp: 100, money: 15, intel: 2, cor: 0, dead: false, dc: false,
      markedUntil: -1, kills: 0, nodes: [], weapon: 'ppk', bugCount: 0,
      lastPose: { x: dropX(rnd), y: 260, z: dropZ(rnd), ry: 0, p: 0, mv: 0 },
      ammo: { ppk: 96, auditor: 0, bondmageddon: 0, tweet: 0, boulder: 0, dossier: 0 },
      mag: { ppk: 12, auditor: 0, bondmageddon: 0, tweet: 0, boulder: 0, dossier: 0 },
      lastShot: -9, redeployAt: -9, jtDenyUsed: false, hpF: 100, moneyF: 15,
      oilCount: 1, inZoneDmg: false,
    }));
    this.nodes = NODES.map(n => ({ id: n.id, owner: null, takeovers: 0, bugBy: null }));
    this.spawnPickups(rnd);
    this.logLine(`✈️ THE CON IS LIVE — ${this.players.length} at the table. Everyone starts with $15, 2 Intel and one PPK.`);
    this.logLine(`🏆 WIN: first to $${this.goal} holding one exhibit of every type — or the last con standing.`);
    this.logLine('🔥 Cortisol hits 8 and the regulators raid you. No dice. The dice were rigged from the start.');
    /* drop phase: 8 seconds of sky */
    this.phase = 'drop';
    this.qEnd = QUARTER_SEC + 8;
    this.evEnd = EVENT_SEC + 8;
  }

  /* ---------- main tick ---------- */
  tick(dt: number) {
    if (this.phase === 'ended') return;
    this.t += dt;
    this.resolveEventIfDue();

    if (this.phase === 'drop' && this.t >= 8) {
      this.phase = 'live';
      this.players.forEach((p, i) => { if (p.lastPose.y > 4) p.lastPose.y = Math.min(p.lastPose.y, 30); });
      this.logLine('🪂 Down safe. The loot is on the street. Start talking your book.');
    }

    /* quarter timer */
    if (this.t >= this.qEnd) {
      this.qEnd = this.t + QUARTER_SEC;
      this.qNum++;
      this.quarter();
    }
    /* event timer */
    if (this.t >= this.evEnd) {
      this.evEnd = this.t + EVENT_SEC;
      this.drawEvent();
    }
    /* zone */
    this.tickZone(dt);
    /* zone damage + passive drains */
    this.players.forEach((p, i) => {
      if (p.dead) return;
      const { x, z } = p.lastPose;
      const d = Math.hypot(x - this.zone.cx, z - this.zone.cz);
      if (d > this.zone.r && this.phase === 'live') {
        const dps = 3 + this.zone.phase * 1.5;
        p.hpF -= dps * dt;
        if (!p.inZoneDmg) {
          p.inZoneDmg = true;
          this.sendSys(i, '🔥 OUTSIDE THE PANIC — the market is eating you', 'bad');
          this.fxText(i, x, 3, z, 'THE PANIC', 'danger');
        }
        if (p.moneyF > 0) p.moneyF = Math.max(0, p.moneyF - 1 * dt);
        p.money = Math.floor(p.moneyF);
        if (p.hpF <= 0) this.killPlayer(i, null, 'the market');
      } else if (p.inZoneDmg && d <= this.zone.r) {
        p.inZoneDmg = false;
      }
      p.hp = Math.max(0, Math.round(p.hpF));
      p.money = Math.max(0, Math.floor(p.moneyF));
    });

    /* full state 2Hz */
    if (this.t - this.lastFullState > 0.5) {
      this.lastFullState = this.t;
    }
  }

  private tickZone(dt: number) {
    if (this.phase === 'drop') return;
    const ph = ZONE_PHASES[Math.min(this.zone.phase, ZONE_PHASES.length - 1)];
    if (this.zoneTarget) {
      /* shrinking */
      const speed = (ph.r - ph.shrinkTo) / 15; /* 15s shrink */
      const nr = Math.max(ph.shrinkTo, this.zone.r - speed * dt);
      this.zone.r = nr;
      if (nr <= ph.shrinkTo + 0.01) {
        this.zone.r = ph.shrinkTo;
        this.zoneTarget = null;
        this.zone.nextAt = this.t + ph.hold;
      }
      return;
    }
    if (this.t >= this.zone.nextAt) {
      this.zone.phase++;
      const next = ZONE_PHASES[Math.min(this.zone.phase, ZONE_PHASES.length - 1)];
      if (next.hold > 9000) return;
      this.zoneTarget = { cx: this.zone.cx, cz: this.zone.cz, r: this.zone.r };
      /* drift center toward a random offset that keeps new circle inside old */
      const maxShift = this.zone.r - next.shrinkTo;
      if (maxShift > 4) {
        const ang = Math.random() * Math.PI * 2;
        const mag = Math.random() * maxShift * 0.7;
        this.zone.cx += Math.cos(ang) * mag;
        this.zone.cz += Math.sin(ang) * mag;
      }
      this.zone.nextAt = this.t + 15;
      this.logLine(`🚨 THE PANIC CLOSES IN — phase ${this.zone.phase}. Get inside the threads.`);
      this.fxText(-1, this.zone.cx, 8, this.zone.cz, 'THE PANIC', 'danger');
    }
  }

  /* ---------- income quarter ---------- */
  private quarter() {
    const lines: string[] = [];
    this.players.forEach((p, i) => {
      if (p.dead) return;
      let salary = 3;
      if (this.has(i, 'infl')) salary = 4;
      let holdings = 0;
      let synergies = 0;
      for (const nid of p.nodes) {
        const n = NMAP[nid];
        if (!n) continue;
        holdings += n.income;
      }
      /* mood modifiers — straight from the board */
      if (this.mood === 'BOOM') holdings += p.nodes.filter(nid => NMAP[nid]?.type === 'COMMODITY').length * 1;
      if (this.mood === 'FRENZY') holdings += p.nodes.filter(nid => NMAP[nid]?.type === 'MEDIA').length * 1;
      if (this.mood === 'PANIC') holdings -= p.nodes.filter(nid => NMAP[nid]?.type === 'BANK').length * 1;

      /* synergies (board set, condensed) */
      const count = (pred: (id: string) => boolean) => p.nodes.filter(pred).length;
      if (this.has(i, 'citi')) synergies += count(nid => NMAP[nid]?.type === 'CORPORATE');
      if (this.has(i, 'commbank') && p.nodes.some(nid => NMAP[nid]?.type === 'BANK' && nid !== 'commbank')) synergies += 2;
      if (this.has(i, 'westpac')) synergies += count(nid => NMAP[nid]?.type === 'REGULATOR');
      if (this.has(i, 'tenyear')) synergies += count(nid => nid !== 'tenyear' && NMAP[nid]?.type === 'CHART');
      if (this.has(i, 'coal') && this.has(i, 'train')) synergies += 2;
      if (this.has(i, 'market') && this.has(i, 'quik')) synergies += 2;
      if (this.has(i, 'bond') && this.mood === 'PANIC') synergies += 1;
      if (this.has(i, 'accc')) { /* handled on seizure */ }

      /* the boulder: pays, and costs */
      if (this.has(i, 'sisy')) { synergies += 3; p.cor = Math.min(10, p.cor + 1); }

      /* bug skims */
      const bugIncome = this.nodes.filter(n => n.bugBy === i).length * (this.mood === 'FRENZY' ? 2 : 1);
      synergies += bugIncome;

      const total = salary + holdings + synergies;
      p.moneyF += total;
      p.money = Math.floor(p.moneyF);

      /* passive intel */
      let intelGain = 0;
      if (this.has(i, 'term')) intelGain += 0; /* terminal = event peek, delivered via sys */
      if (this.has(i, 'jt')) intelGain += 1;
      if (this.has(i, 'made')) intelGain += 0;
      p.intel += intelGain;

      /* cortisol decay: baseline −1, press −1, fox −2, rba −1 */
      let decay = 1;
      if (this.has(i, 'press')) decay += 1;
      if (this.has(i, 'fox')) decay += 2;
      if (this.has(i, 'rba')) decay += 1;
      p.cor = Math.max(0, p.cor - decay);

      this.fxText(i, p.lastPose.x, 2.6, p.lastPose.z, `+$${total}`, 'money');
      lines.push(`💵 ${p.name} collects $${total} (salary $${salary} + holdings $${holdings} + synergies $${synergies}) — now $${p.money}.`);
      p.nodes.forEach(() => { /* node income displayed via fx per node */ });
    });

    /* bug intel delivery: terminal owner sees next event */
    const termOwner = this.nodeOwnerIdx('term');
    if (termOwner !== null && !this.players[termOwner].dead && this.deck.length) {
      const next = EVENTS[this.deck[0]];
      this.sendSys(termOwner, `📈 THE TERMINAL — next event: ${next.icon} ${next.name}`, 'good');
    }

    /* MADE: 33% per quarter */
    if (Math.random() < 0.34) this.madePay();
    /* ACCC: industry concentration check */
    this.acccCheck();

    /* RAID check — cortisol >= 8 */
    this.players.forEach((p, i) => {
      if (p.dead || p.cor < 8) return;
      this.raid(i);
    });

    /* win check after income — same as board */
    this.winCheck();

    if (this.qNum % 1 === 0) {
      lines.forEach(l => this.logLine(l));
      this.logLine(`— QUARTER ${this.qNum} SETTLED · MARKET: ${this.mood} —`);
    }
  }

  private madePay() {
    const owner = this.nodeOwnerIdx('made');
    if (owner === null || this.players[owner].dead) return;
    const p = this.players[owner];
    p.moneyF += 10; p.money = Math.floor(p.moneyF);
    p.intel += 1;
    this.players.forEach((q, i) => {
      if (i === owner || q.dead) return;
      q.moneyF = Math.max(0, q.moneyF - 3); q.money = Math.floor(q.moneyF);
      q.cor = Math.min(10, q.cor + 1);
      this.sendSys(i, '🟣 MADE paid out. Nobody knows why. NOBODY. (−$3, +1 Cortisol)', 'bad');
    });
    this.logLine(`🟣 MADE PAYS OUT — ${p.name} +$10 & +1 Intel. Every rival −$3 and +1 Cortisol. NOBODY knows why.`);
    this.fxText(owner, p.lastPose.x, 3, p.lastPose.z, 'MADE +$10', 'gold');
  }

  private acccCheck() {
    const INDUSTRIES: Record<string, string[]> = {
      BANKING: ['citi', 'commbank', 'westpac', 'bond'],
      REGULATORS: ['rba', 'asic', 'accc'],
      OIL: ['oil', 'tanker'],
      COAL: ['coal', 'train'],
      SERVO: ['quik', 'market'],
      WIRE: ['press', 'fox', 'leak'],
    };
    this.players.forEach((p, i) => {
      if (p.dead) return;
      for (const [ind, ids] of Object.entries(INDUSTRIES)) {
        const held = p.nodes.filter(nid => ids.includes(nid));
        if (held.length > 2 && Math.random() < 0.34) {
          held.forEach(nid => this.stripNode(nid));
          p.nodes = this.nodesOf(i);
          this.logLine(`🚨 MONOPOLY ALERT — the ACCC strips ${p.name}'s entire ${ind} book (${held.length} exhibits).`);
          this.sendSys(i, '🚨 The ACCC divested your ' + ind + ' book. Too concentrated.', 'bad');
          this.fxText(i, p.lastPose.x, 3, p.lastPose.z, 'ACCC DIVEST', 'danger');
        }
      }
    });
  }

  private raid(i: number) {
    const p = this.players[i];
    /* lose two highest-income exhibits */
    const sorted = p.nodes.slice().sort((a, b) => (NMAP[b]?.income || 0) - (NMAP[a]?.income || 0));
    const lost = sorted.slice(0, 2);
    lost.forEach(nid => this.stripNode(nid));
    const fine = Math.max(5, Math.floor(p.money * 0.3));
    p.moneyF = Math.max(0, p.moneyF - fine); p.money = Math.floor(p.moneyF);
    p.intel = Math.min(p.intel, 1);
    p.cor = 0;
    p.markedUntil = this.t + 20;
    p.nodes = this.nodesOf(i);
    this.players.forEach((q, qi) => {
      if (this.has(qi, 'hedge')) { q.moneyF += 3; q.money = Math.floor(q.moneyF); }
    });
    this.logLine(`🚨 REGULATOR RAID! ${p.name} — stripped of ${lost.map(l => NMAP[l]?.name || l).join(' and ') || 'nothing'}, fined $${fine}, Intel burned. Cameras everywhere.`);
    this.fxOut.push({ k: 'raid', a: i, x: p.lastPose.x, y: 3, z: p.lastPose.z, id: this.fxId++ });
    this.sendFx(this.fxOut); this.fxOut = [];
  }

  /* ---------- market events ---------- */
  pendingEvent: { kind: string; resolveAt: number; name: string } | null = null;
  private jtDenyWindow: { idx: number; until: number } | null = null;

  private drawEvent() {
    if (this.pendingEvent) return; /* previous still resolving — skip beat */
    if (!this.deck.length) {
      this.deck = EVENTS.map((_, i) => i);
      for (let i = this.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
      }
      this.logLine('🃏 The rumor deck is reshuffled.');
    }
    const idx = this.deck.shift()!;
    const card = EVENTS[idx];
    this.sendEvent({ name: card.name, icon: card.icon, desc: card.desc, mood: card.mood });
    this.logLine(`🃏 ${card.icon} ${card.name} — ${card.desc}`);
    /* 4s window before resolution — JTPortal can still deny it */
    this.pendingEvent = { kind: card.kind, resolveAt: this.t + 4, name: card.name };
    /* who holds JT? they get a deny window */
    const jtOwner = this.nodeOwnerIdx('jt');
    if (jtOwner !== null && !this.players[jtOwner].dead && !this.players[jtOwner].jtDenyUsed) {
      this.jtDenyWindow = { idx: jtOwner, until: this.t + 4 };
      this.sendSys(jtOwner, "🌐 JTPORTAL — press J to deny this event ('Quite frankly, that never happened.'), once per game", 'info');
    }
  }

  /* returns true if a pending event was denied */
  jtDenyRequest(i: number): boolean {
    if (!this.pendingEvent || !this.jtDenyWindow || this.jtDenyWindow.idx !== i) return false;
    if (this.players[i].jtDenyUsed) return false;
    this.players[i].jtDenyUsed = true;
    this.pendingEvent = null;
    this.jtDenyWindow = null;
    this.logLine(`🌐 JTPortal: 'Quite frankly, that never happened.' The event vanishes.`);
    this.players.forEach((_, qi) => this.sendSys(qi, `🌐 JTPortal: 'Quite frankly, that never happened.' The event vanishes.`, 'info'));
    return true;
  }

  private resolveEventIfDue() {
    const pe = this.pendingEvent;
    if (!pe) return;
    if (this.t >= pe.resolveAt) {
      this.pendingEvent = null;
      this.jtDenyWindow = null;
      const card = EVENTS.find(e => e.kind === pe.kind);
      if (card && card.mood !== 'KEEP') this.mood = card.mood;
      this.runEvent(pe.kind);
      this.winCheck();
    }
  }

  private payOwner(nodeId: string, amt: number, label: string) {
    const o = this.nodeOwnerIdx(nodeId);
    if (o === null || this.players[o].dead) return false;
    this.players[o].moneyF += amt;
    this.players[o].money = Math.floor(this.players[o].moneyF);
    this.fxText(o, this.players[o].lastPose.x, 2.8, this.players[o].lastPose.z, `+$${amt}`, 'money');
    this.logLine(`   ${label}: ${this.players[o].name} +$${amt}.`);
    return true;
  }

  private forEachAlive(fn: (i: number) => void) {
    this.players.forEach((p, i) => { if (!p.dead) fn(i); });
  }

  private chargeAll(amt: number, label: string, except?: (i: number) => boolean) {
    this.forEachAlive(i => {
      if (except && except(i)) return;
      const p = this.players[i];
      p.moneyF = Math.max(0, p.moneyF - amt);
      p.money = Math.floor(p.moneyF);
      this.sendSys(i, `${label} (−$${amt})`, 'bad');
    });
  }

  private runEvent(kind: string) {
    const owned = (i: number, id: string) => this.has(i, id);
    switch (kind) {
      case 'oilspikes': {
        this.payOwner('oil', 6, '🛢️ crude windfall');
        this.payOwner('tanker', 3, '🛢️ tanker freight');
        const qo = this.nodeOwnerIdx('quik');
        if (qo !== null) {
          this.forEachAlive(i => {
            if (i === qo) return;
            const p = this.players[i];
            p.moneyF = Math.max(0, p.moneyF - 1); p.money = Math.floor(p.moneyF);
          });
          this.players[qo].moneyF += this.players.filter(p => !p.dead).length - 1;
          this.players[qo].money = Math.floor(this.players[qo].moneyF);
          this.logLine(`⛽ Fuel costs — everyone pays the QUIKSTOP register.`);
        } else {
          this.chargeAll(1, '⛽ fuel costs', i => owned(i, 'qantas'));
        }
        break;
      }
      case 'coalrush': {
        this.payOwner('coal', 3, '🚃 coal rush');
        this.payOwner('train', 2, '🚃 the train runs all night');
        this.payOwner('tanker', 3, '🚃 freight up');
        break;
      }
      case 'rbarate': {
        this.chargeAll(2, '🏛️ cost of money', i => owned(i, 'rba') || owned(i, 'cash'));
        this.payOwner('cash', 2, '📈 cash chart');
        break;
      }
      case 'bondmageddon': {
        const bo = this.nodeOwnerIdx('bond');
        this.forEachAlive(i => {
          const banks = this.players[i].nodes.filter(nid => NMAP[nid]?.type === 'BANK').length;
          if (banks && bo !== null && i !== bo) {
            const amt = banks * 2;
            const p = this.players[i];
            p.moneyF = Math.max(0, p.moneyF - amt); p.money = Math.floor(p.moneyF);
            this.players[bo].moneyF += amt; this.players[bo].money = Math.floor(this.players[bo].moneyF);
          }
        });
        this.payOwner('tenyear', 2, '📈 master chart');
        this.payOwner('bigshort', 3, '🎬 somebody was short');
        break;
      }
      case 'ceophoto': {
        const o = this.nodeOwnerIdx('coal');
        if (o !== null) {
          this.players[o].cor = Math.min(10, this.players[o].cor + 3);
          this.sendSys(o, '📸 Your CEO, a blender, and a set of books that needed cooking. +3 Cortisol.', 'bad');
          this.logLine(`📸 Coal Corp CEO photo leaks. ${this.players[o].name} +3 Cortisol.`);
        } else this.logLine('📸 The photo leaks. Nobody owns Coal Corp. Awkward.');
        break;
      }
      case 'trumptweets': {
        this.chargeAll(1, '🦅 tariffs', i => owned(i, 'us'));
        this.payOwner('us', 2, '🦈 the flight to safety');
        break;
      }
      case 'bessent': {
        this.payOwner('bond', 2, '🎤 the desk');
        this.payOwner('tenyear', 2, '🎤 the ten-year');
        break;
      }
      case 'budget': {
        this.chargeAll(1, '📰 return to sender (taxes)', i => owned(i, 'infl'));
        this.payOwner('infl', 1, '📊 indexed');
        break;
      }
      case 'mpc': {
        this.forEachAlive(i => {
          const p = this.players[i];
          p.moneyF += 2; p.money = Math.floor(p.moneyF);
          if (p.nodes.some(nid => NMAP[nid]?.type === 'CHART')) p.intel += 1;
        });
        this.logLine('🏆 Everyone +$2. Chart holders +1 Intel. The Diploma Programme does not grade on charisma.');
        break;
      }
      case 'boulder': {
        let maxNodes = 0;
        this.forEachAlive(i => { maxNodes = Math.max(maxNodes, this.players[i].nodes.length); });
        this.forEachAlive(i => {
          if (this.players[i].nodes.length === maxNodes && maxNodes > 0 && !owned(i, 'sisy')) {
            const p = this.players[i];
            p.moneyF = Math.max(0, p.moneyF - 2); p.money = Math.floor(p.moneyF);
            this.sendSys(i, '🪨 The boulder rolls back down. −$2.', 'bad');
          }
        });
        break;
      }
      case 'goldrush': {
        this.payOwner('gold', 5, '🪙 shiny');
        this.chargeAll(1, '🪙 inflation bites', i => owned(i, 'gold'));
        break;
      }
      case 'rockcooks': {
        this.forEachAlive(i => {
          const p = this.players[i];
          p.hpF = Math.min(100, p.hpF + 25); p.hp = Math.round(p.hpF);
        });
        this.logLine('💪 The Rock cooks. Everyone +25 composure. It smells like recovery.');
        break;
      }
      case 'davos': {
        this.nodes.forEach(n => {
          if (n.bugBy !== null) {
            const p = this.players[n.bugBy];
            if (!p.dead) { p.moneyF += 2; p.money = Math.floor(p.moneyF); }
          }
        });
        this.logLine('🏔️ Davos. Lanyards, panels, fondue. Every planted bug pays double.');
        break;
      }
      case 'quikrob': {
        const qo = this.nodeOwnerIdx('quik');
        if (qo !== null) {
          const p = this.players[qo];
          p.moneyF = Math.max(0, p.moneyF - 2); p.money = Math.floor(p.moneyF);
        }
        this.payOwner('bond', 2, '🎭 he was there in disguise (allegedly)');
        break;
      }
      case 'ibexams': {
        this.forEachAlive(i => {
          const p = this.players[i];
          if (p.nodes.some(nid => NMAP[nid]?.type === 'CHART')) p.intel += 1;
          else p.intel = Math.max(0, p.intel - 1);
        });
        this.logLine('📝 IB exams. Chart holders did the reading (+1 Intel). Others did not (−1).');
        break;
      }
      case 'profitwarn': this.payOwner('quik', 4, '⛽ snack economics'); break;
      case 'quietq': {
        this.forEachAlive(i => { const p = this.players[i]; p.moneyF += 2; p.money = Math.floor(p.moneyF); });
        this.logLine('🌙 A quiet quarter. Everyone +$2.');
        break;
      }
      case 'snoop': {
        this.forEachAlive(i => {
          const p = this.players[i];
          if (p.cor >= 6) { p.cor = Math.min(10, p.cor + 1); this.sendSys(i, '🔍 The regulators knocked politely. +1 Cortisol.', 'bad'); }
        });
        break;
      }
      case 'anontip': {
        this.forEachAlive(i => { this.players[i].intel += 1; });
        this.logLine('✉️ A manila envelope, no return address. Everyone +1 Intel.');
        break;
      }
      case 'mediafrenzy': {
        /* the press torches the rival with the most money */
        const fo = this.nodeOwnerIdx('fox') ?? this.nodeOwnerIdx('press');
        if (fo !== null) {
          let target = -1, best = -1;
          this.forEachAlive(i => { if (i !== fo && this.players[i].money > best) { best = this.players[i].money; target = i; } });
          if (target >= 0) {
            this.players[target].cor = Math.min(10, this.players[target].cor + 2);
            this.sendSys(target, `🗣️ MEDIA FRENZY — ${this.players[fo].name}'s press roasted you. +2 Cortisol.`, 'bad');
            this.logLine(`🗣️ ${this.players[fo].name}'s press room torches ${this.players[target].name}. +2 Cortisol.`);
          }
        }
        break;
      }
      case 'monopoly': {
        let maxCor = 0;
        this.forEachAlive(i => { maxCor = Math.max(maxCor, this.players[i].cor); });
        if (maxCor > 0) {
          this.forEachAlive(i => {
            if (this.players[i].cor === maxCor) {
              const p = this.players[i];
              p.moneyF = Math.max(0, p.moneyF - 4); p.money = Math.floor(p.moneyF);
              this.sendSys(i, '🚨 Concentration fine. −$4.', 'bad');
            }
          });
        }
        this.payOwner('bigshort', 3, '🎬 somebody was positioned');
        break;
      }
      case 'tapes': {
        this.forEachAlive(i => {
          const p = this.players[i];
          if (owned(i, 'term') || owned(i, 'jt')) p.intel += 2;
          else p.intel = Math.max(0, p.intel - 1);
        });
        this.logLine('🗑️ The tapes go missing. The terminal kept copies (+2 Intel). Everyone else −1.');
        break;
      }
      case 'shortscreen': {
        this.payOwner('bigshort', 3, '🎬 the screening');
        this.payOwner('bond', 2, '🎬 the desk was there');
        break;
      }
      case 'madepay': if (Math.random() < 0.33) this.madePay(); break;
    }
  }

  /* ---------- combat & actions (host-validated) ---------- */

  pose(i: number, x: number, y: number, z: number, ry: number, p: number, mv: number) {
    const pl = this.players[i];
    if (!pl || pl.dead) return;
    const cl = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    pl.lastPose = { x: cl(x, MAP_R + 30), y: Math.max(0, Math.min(400, y)), z: cl(z, MAP_R + 30), ry, p, mv };
  }

  shot(i: number, wpnId: string, hit: number | null, dmg: number, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }) {
    const pl = this.players[i];
    const w = WMAP[wpnId];
    if (!pl || pl.dead || !w) return;
    /* fire-rate sanity (host clock) */
    if (this.t - pl.lastShot < w.rof * 0.75) return;
    pl.lastShot = this.t;
    this.fxOut.push({ k: 'shot', a: i, x: o.x, y: o.y, z: o.z, n: wpnId, id: this.fxId++ });
    /* also register direction for tracer: pack into n? we send separate dir via x2? keep simple: fx shot carries origin; guest uses attacker aim */
    if (hit === null || hit === i) { this.flushFx(); return; }
    const v = this.players[hit];
    if (!v || v.dead) { this.flushFx(); return; }
    /* range sanity from host-known poses */
    const dist = Math.hypot(pl.lastPose.x - v.lastPose.x, pl.lastPose.y - v.lastPose.y, pl.lastPose.z - v.lastPose.z);
    if (dist > w.range * 1.35) { this.flushFx(); return; }
    const dmgOk = Math.max(1, Math.min(w.dmg * w.pellets * 1.05, dmg));
    this.damage(hit, dmgOk, i, w.id);
    this.flushFx();
  }

  private flushFx() {
    if (this.fxOut.length) { this.sendFx(this.fxOut); this.fxOut = []; }
  }

  damage(vi: number, dmg: number, ai: number | null, wId: string) {
    const v = this.players[vi];
    if (!v || v.dead) return;
    v.hpF -= dmg;
    v.hp = Math.max(0, Math.round(v.hpF));
    this.fxOut.push({ k: 'hit', a: ai ?? -1, b: vi, x: v.lastPose.x, y: v.lastPose.y, z: v.lastPose.z, v: Math.round(dmg), id: this.fxId++ });
    if (ai !== null) {
      const a = this.players[ai];
      /* ASIC: audits on every hit */
      if (this.has(ai, 'asic')) v.cor = Math.min(10, v.cor + 1);
    }
    if (v.hpF <= 0) this.killPlayer(vi, ai, wId);
    this.flushFx();
  }

  killPlayer(vi: number, ai: number | null, cause: string) {
    const v = this.players[vi];
    if (!v || v.dead) return;
    v.dead = true;
    v.hp = 0;
    const drop = Math.max(2, Math.floor(v.money / 2));
    v.moneyF = Math.max(0, v.moneyF - drop);
    v.money = v.moneyF;
    /* liquidate: exhibits go neutral, bugs die with the planter */
    const lost = v.nodes.slice();
    lost.forEach(nid => {
      const n = this.nodes.find(nn => nn.id === nid);
      if (n) { n.owner = null; }
    });
    v.nodes = [];
    this.nodes.forEach(n => { if (n.bugBy === vi) n.bugBy = null; });
    /* drop pickups at death spot */
    const parts = Math.min(3, Math.max(1, Math.floor(drop / 3)));
    for (let k = 0; k < parts; k++) {
      this.pickups.push({ id: this.pickupId++, kind: 'money', x: v.lastPose.x + (Math.random() - 0.5) * 6, z: v.lastPose.z + (Math.random() - 0.5) * 6, v: Math.max(1, Math.floor(drop / parts)), taken: false, respawnAt: -1 });
    }
    if (v.intel > 0) this.pickups.push({ id: this.pickupId++, kind: 'intel', x: v.lastPose.x + 2, z: v.lastPose.z + 2, v: Math.min(3, v.intel), taken: false, respawnAt: -1 });
    this.fxOut.push({ k: 'kill', a: ai ?? -1, b: vi, x: v.lastPose.x, y: 2, z: v.lastPose.z, n: cause, id: this.fxId++ });
    if (ai !== null) {
      const a = this.players[ai];
      a.kills += 1;
      a.moneyF += 5; a.money = Math.floor(a.moneyF);
      a.cor = Math.min(10, a.cor + 2);
      this.logLine(`☠️ ${a.name} LIQUIDATES ${v.name} (${cause}) — +$5, +2 Cortisol. The assets spill onto the street.`);
      this.sendSys(ai, `☠️ You liquidated ${v.name}. +$5, +2 Cortisol.`, 'good');
    } else {
      this.logLine(`☠️ ${v.name} was liquidated by ${cause}. The assets spill onto the street.`);
    }
    this.sendSys(vi, '💀 LIQUIDATED — you are out of the con. Spectating.', 'bad');
    this.flushFx();
    this.winCheck(true);
  }

  /* seizures — the core of the con */
  trySeize(i: number, nodeId: string): string {
    const pl = this.players[i];
    const def = NMAP[nodeId];
    const n = this.nodes.find(nn => nn.id === nodeId);
    if (!pl || pl.dead || !def || !n) return 'no such exhibit';
    const d = Math.hypot(pl.lastPose.x - def.x, pl.lastPose.z - def.z);
    if (d > 10) return 'too far from the exhibit';
    if (n.owner === i) return 'already yours';
    const isHostile = n.owner !== null;
    let cost = def.cost;
    if (this.has(i, 'golf')) cost = Math.max(1, cost - 1);
    if (isHostile) {
      const inflate = def.neverInflates ? 1 : Math.pow(2, Math.max(1, n.takeovers));
      cost = cost * inflate;
      /* RBA holder: their takeovers stay list price (attack) */
    }
    if (pl.moneyF < cost) {
      /* backroom deals: cover shortfall with intel */
      if (this.has(i, 'back')) {
        const short = cost - pl.moneyF;
        const cover = Math.min(pl.intel, Math.floor(short));
        if (cover >= Math.floor(short) && cover > 0) {
          pl.intel -= cover;
          pl.moneyF += cover;
          this.logLine(`🤝 ${pl.name} covers a $${Math.floor(short)} shortfall with ${cover} Intel at the Backroom. Lanyards were shown.`);
        }
      }
      if (pl.moneyF < cost) return `need $${Math.floor(cost)} — you have $${Math.floor(pl.moneyF)}`;
    }
    pl.moneyF -= cost; pl.money = Math.floor(pl.moneyF);
    if (isHostile) {
      const old = n.owner!;
      const oldP = this.players[old];
      const buyout = def.cost; /* list price, as the board pays out */
      oldP.moneyF += buyout; oldP.money = Math.floor(oldP.moneyF);
      pl.cor = Math.min(10, pl.cor + 2);
      if (this.has(old, 'accc')) {
        pl.moneyF = Math.max(0, pl.moneyF - 2);
        this.players[old].moneyF += 2;
        this.players[old].money = Math.floor(this.players[old].moneyF);
        this.sendSys(i, '⚖️ ACCC review fee paid to the old owner: $2.', 'bad');
      }
      n.takeovers = def.neverInflates ? 0 : n.takeovers + 1;
      this.logLine(`⚔️ HOSTILE TAKEOVER — ${pl.name} takes ${def.name} from ${oldP.name} for $${Math.floor(cost)}. ${oldP.name} pockets $${buyout}.`);
      this.sendSys(old, `⚔️ ${pl.name} took ${def.name} off you. You pocketed $${buyout}.`, 'bad');
    } else {
      pl.cor = Math.min(10, pl.cor + 1);
      this.logLine(`📌 ${pl.name} seizes ${def.name} for $${Math.floor(cost)} (+1 Cortisol).`);
    }
    n.owner = i;
    n.bugBy = null;
    pl.nodes = this.nodesOf(i);
    if (nodeId === 'bond') { pl.intel += 2; this.sendSys(i, '🛈 The desk slides you 2 Intel.', 'good'); }
    if (nodeId === 'leak') { pl.intel += 1; this.sendSys(i, '🛈 The leak drips 1 Intel.', 'good'); }
    this.fxOut.push({ k: 'seize', a: i, x: def.x, y: 3, z: def.z, n: nodeId, id: this.fxId++ });
    this.flushFx();
    this.winCheck();
    return 'ok';
  }

  plantBug(i: number): string {
    const pl = this.players[i];
    if (!pl || pl.dead) return 'no';
    if (pl.intel < 1) return 'need 1 Intel';
    /* find a rival-owned node at player's position */
    const here = NODES.find(n => Math.hypot(pl.lastPose.x - n.x, pl.lastPose.z - n.z) < 10 && this.nodeOwnerIdx(n.id) !== null && this.nodeOwnerIdx(n.id) !== i);
    if (!here) return 'stand in a rival exhibit';
    const n = this.nodes.find(nn => nn.id === here.id)!;
    if (n.bugBy !== null) return 'already bugged';
    pl.intel -= 1;
    n.bugBy = i;
    pl.bugCount++;
    this.logLine(`🐛 ${pl.name} plants a bug at ${here.name}. The skim starts next quarter.`);
    return 'ok';
  }

  ability(i: number, kind: string): string {
    const pl = this.players[i];
    if (!pl || pl.dead) return 'no';
    switch (kind) {
      case 'favor': {
        if (pl.intel < 1) return 'need 1 Intel';
        pl.intel -= 1;
        pl.hpF = Math.min(100, pl.hpF + 40);
        pl.hp = Math.round(pl.hpF);
        this.fxText(i, pl.lastPose.x, 2.6, pl.lastPose.z, '+40', 'good');
        this.sendSys(i, '🛈 A favor called in. +40 composure.', 'good');
        return 'ok';
      }
      case 'leak': {
        if (pl.intel < 2) return 'need 2 Intel';
        let target = -1, bd = 70;
        this.players.forEach((q, qi) => {
          if (qi === i || q.dead) return;
          const d = Math.hypot(pl.lastPose.x - q.lastPose.x, pl.lastPose.z - q.lastPose.z);
          if (d < bd) { bd = d; target = qi; }
        });
        if (target < 0) return 'no rival in 70m';
        pl.intel -= 2;
        this.players[target].cor = Math.min(10, this.players[target].cor + 2);
        this.sendSys(target, `🛈 Dirt leaked: ${pl.name} mailed your file. +2 Cortisol.`, 'bad');
        this.sendSys(i, `🛈 The leak lands on ${this.players[target].name}. +2 Cortisol to them.`, 'good');
        return 'ok';
      }
      case 'spy': {
        if (pl.intel < 2) return 'need 2 Intel';
        if (!this.deck.length) return 'deck empty';
        pl.intel -= 2;
        const next = EVENTS[this.deck[0]];
        this.sendSys(i, `🛈 SPY ON THE DECK — next event: ${next.icon} ${next.name} (${next.desc})`, 'good');
        return 'ok';
      }
      case 'redeploy': {
        if (!this.has(i, 'qantas')) return 'need QANTAS';
        if (this.t - pl.redeployAt < 45) return 'jet refueling';
        pl.redeployAt = this.t;
        pl.lastPose.y = 200;
        this.sendSys(i, '✈️ QANTAS redeploy — steer to a new drop.', 'good');
        return 'ok';
      }
    }
    return 'unknown';
  }

  jtDenyRequest2(i: number) { return this.jtDenyRequest(i); }

  weaponSwitch(i: number, slot: number) {
    const pl = this.players[i];
    if (!pl || pl.dead) return;
    const ids = Object.keys(pl.ammo);
    const id = ids[Math.max(0, Math.min(ids.length - 1, slot))];
    if (pl.ammo[id] + pl.mag[id] > 0) pl.weapon = id;
  }

  reload(i: number) {
    /* handled client-side; host just trusts mag counts from next pose cycle */
    void i;
  }

  oilThrow(i: number, x: number, z: number) {
    const pl = this.players[i];
    if (!pl || pl.dead || pl.oilCount <= 0) return;
    const cl = (v: number) => Math.max(-MAP_R, Math.min(MAP_R, v));
    pl.oilCount--;
    this.fxOut.push({ k: 'boom', a: i, x: cl(x), y: 1, z: cl(z), n: 'oil', id: this.fxId++ });
    /* burn damage over 4s in 5m radius */
    const victims = this.players.map((p, pi) => ({ p, pi })).filter(({ p, pi }) => {
      if (p.dead || pi === i) return false;
      const pl = this.players[pi];
      return Math.hypot(pl.lastPose.x - cl(x), pl.lastPose.z - cl(z)) < 6;
    });
    victims.forEach(({ pi }) => {
      this.damage(pi, 30, i, 'oil');
      this.players[pi].cor = Math.min(10, this.players[pi].cor + 1);
    });
    this.flushFx();
  }

  pickupTake(i: number, id: number): boolean {
    const pl = this.players[i];
    if (!pl || pl.dead) return false;
    const p = this.pickups.find(pp => pp.id === id);
    if (!p || p.taken) return false;
    const d = Math.hypot(pl.lastPose.x - p.x, pl.lastPose.z - p.z);
    if (d > 6) return false;
    p.taken = true;
    switch (p.kind) {
      case 'money': pl.moneyF += p.v; pl.money = Math.floor(pl.moneyF); break;
      case 'intel': pl.intel += p.v; break;
      case 'med': pl.hpF = Math.min(100, pl.hpF + p.v); pl.hp = Math.round(pl.hpF); break;
      case 'ammo': {
        const w = pl.weapon;
        pl.ammo[w] = Math.min(WMAP[w].reserveMax, pl.ammo[w] + Math.ceil(WMAP[w].reserveMax * 0.4));
        pl.oilCount = Math.min(2, pl.oilCount + 1);
        break;
      }
      case 'weapon': {
        if (p.w && pl.ammo[p.w] !== undefined) {
          pl.ammo[p.w] = Math.max(pl.ammo[p.w], Math.floor(WMAP[p.w].mag * 2.5));
          pl.mag[p.w] = Math.max(pl.mag[p.w], WMAP[p.w].mag);
          pl.weapon = p.w;
        }
        break;
      }
      case 'oil': pl.oilCount = Math.min(2, pl.oilCount + 1); break;
    }
    const fxKind = p.kind === 'weapon' ? 'w:' + (p.w || '') : p.kind;
    this.fxOut.push({ k: 'pickup', a: i, b: i, x: p.x, y: 1.5, z: p.z, n: fxKind, v: p.v, id: this.fxId++ });
    this.flushFx();
    return true;
  }

  private spawnPickups(rnd: () => number) {
    const kinds: { kind: Pickup['kind']; v: number; w?: string }[] = [
      { kind: 'money', v: 3 }, { kind: 'money', v: 5 }, { kind: 'money', v: 8 },
      { kind: 'intel', v: 1 }, { kind: 'intel', v: 2 },
      { kind: 'med', v: 50 },
      { kind: 'ammo', v: 1 },
      { kind: 'weapon', v: 1, w: 'auditor' }, { kind: 'weapon', v: 1, w: 'bondmageddon' },
      { kind: 'weapon', v: 1, w: 'tweet' }, { kind: 'weapon', v: 1, w: 'boulder' },
      { kind: 'weapon', v: 1, w: 'dossier' }, { kind: 'weapon', v: 1, w: 'ppk' },
      { kind: 'oil', v: 1 },
    ];
    const shuffled = kinds.slice();
    for (let i = 0; i < 130; i++) {
      const k = shuffled[Math.floor(rnd() * shuffled.length)];
      const x = (rnd() * 2 - 1) * (MAP_R - 30);
      const z = (rnd() * 2 - 1) * (MAP_R - 30);
      /* keep pickups off exhibit capture pads */
      const nearNode = NODES.some(n => Math.hypot(n.x - x, n.z - z) < 12);
      if (nearNode) continue;
      this.pickups.push({ id: this.pickupId++, kind: k.kind, x, z, v: k.kind === 'money' ? k.v + Math.floor(rnd() * 4) : k.v, w: k.w, taken: false, respawnAt: -1 });
    }
    /* guaranteed starter weapon near spawn districts */
    ['auditor', 'bondmageddon'].forEach(w => {
      for (let k = 0; k < 4; k++) {
        const x = (rnd() * 2 - 1) * 200;
        const z = (rnd() * 2 - 1) * 200;
        this.pickups.push({ id: this.pickupId++, kind: 'weapon', x, z, v: 1, w, taken: false, respawnAt: -1 });
      }
    });
  }

  getPickupList() {
    return this.pickups.filter(p => !p.taken).slice(0, 160).map(p => [p.id, p.kind, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, p.v, p.w || ''] as const);
  }

  /* ---------- win ---------- */
  private winCheck(afterKill = false) {
    if (this.winner !== null) return;
    /* economic con */
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.dead) continue;
      if (p.money >= this.goal && WIN_TYPES.every(ty => p.nodes.some(nid => NMAP[nid]?.type === ty))) {
        this.endGame(i, `💰 ${p.name} walks away with $${p.money}, past the table's target of $${this.goal}, holding one of every exhibit type. The market was rigged. It was rigged by them.`);
        return;
      }
    }
    if (afterKill) {
      const alive = this.players.map((p, i) => ({ p, i })).filter(({ p }) => !p.dead && !p.dc);
      if (alive.length === 1 && this.players.length > 1) {
        this.endGame(alive[0].i, `🏆 ${alive[0].p.name} is the last con at the table. Everyone else was liquidated.`);
      } else if (alive.length === 0) {
        this.endGame(-1, '💀 The table is empty. The regulators win. Nobody walks away.');
      }
    }
  }

  endGame(winner: number, msg: string) {
    this.winner = winner;
    this.winMsg = msg;
    this.phase = 'ended';
    this.logLine(`🏆 THE BIG CON PAYS OUT — ${msg.replace(/^[🏆💰💀]\s*/, '')}`);
    this.onEnd?.();
  }

  /* ---------- helpers ---------- */
  has(i: number, nodeId: string) { return this.players[i]?.nodes.includes(nodeId) ?? false; }
  nodesOf(i: number) { return this.nodes.filter(n => n.owner === i).map(n => n.id); }
  nodeOwnerIdx(nodeId: string): number | null { return this.nodes.find(n => n.id === nodeId)?.owner ?? null; }
  stripNode(nodeId: string) {
    const n = this.nodes.find(nn => nn.id === nodeId);
    if (n) { n.owner = null; n.bugBy = null; }
  }
  logLine(s: string) {
    this.log.push(s);
    this.logN++;
    if (this.log.length > 120) this.log.shift();
    if (this.chatSink) {
      /* also mirror into chat sink for wire delivery */
    }
  }
  fxText(target: number, x: number, y: number, z: number, text: string, style: string) {
    this.fxOut.push({ k: 'text', a: target, x, y, z, n: text, s: style, id: this.fxId++ });
  }

  snapshot(): Snapshot {
    return {
      phase: this.phase,
      t: this.t,
      qNum: this.qNum,
      qEnd: this.qEnd - this.t,
      evEnd: this.evEnd - this.t,
      evCount: this.deck.length,
      mood: this.mood,
      players: this.players.map(p => ({
        name: p.name, char: p.char, color: p.color, hp: p.hp, money: p.money, intel: p.intel,
        cor: p.cor, dead: p.dead, dc: p.dc, markedUntil: p.markedUntil, kills: p.kills,
        nodes: p.nodes, weapon: p.weapon,
        bugCount: this.nodes.filter(n => n.bugBy !== null && this.players[n.bugBy]?.name === p.name).length,
      })),
      nodes: this.nodes.map(n => ({ id: n.id, owner: n.owner, takeovers: n.takeovers, bugBy: n.bugBy })),
      zone: this.zone,
      goal: this.goal,
      winner: this.winner,
      winMsg: this.winMsg,
      logTail: this.log.slice(-40).map((s, i) => ({ n: this.logN - Math.min(40, this.log.length) + i, s })),
      chatTail: [],
      pickups: this.getPickupList(),
    };
  }

  getSpawns(): number[] {
    const out: number[] = [];
    this.players.forEach(p => out.push(p.lastPose.x, p.lastPose.y, p.lastPose.z));
    return out;
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dropX(rnd: () => number) { return (rnd() * 2 - 1) * 260; }
function dropZ(rnd: () => number) { return (rnd() * 2 - 1) * 260; }
