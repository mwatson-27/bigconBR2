/* THE BIG CON: BATTLE ROYALE — PeerJS networking
 * Same multiplayer library and architecture as the board game:
 * host-authoritative star topology, buzzword room codes, session
 * playerId reconnection, heartbeats, exponential-backoff rejoin.
 */
import Peer, { DataConnection } from 'peerjs';
import { BIGCON_ICE_CONFIG, ROOM_CODES, slugCode, matchCode } from './data';
import { GuestMsg, HostMsg, LobbyPlayer } from './types';

const PFX = 'bigcon-fps-';
const HEARTBEAT_MS = 4000;
const CONN_TIMEOUT_MS = 16000;

export type NetStatus =
  | 'idle' | 'contacting' | 'hosting' | 'joining'
  | 'connected' | 'error' | 'closed';

export interface NetEvents {
  onStatus: (s: NetStatus, detail?: string) => void;
  onLobby: (roster: LobbyPlayer[], goal: number) => void;
  onChat: (s: string, who: string, col: string, n: number) => void;
  onHostMsg: (m: HostMsg) => void;                    // guests: full message bus
  onGuestMsg: (idx: number, m: GuestMsg) => void;     // host: intent channel
  onPeerOpen: (idx: number) => void;                  // host: connection established
  onPeerClose: (idx: number) => void;                 // host: connection lost
}

export class Net {
  peer: Peer | null = null;
  role: 'host' | 'guest' | 'idle' = 'idle';
  roomCode = '';
  myIdx = 0;
  myName = '';
  playerId = '';
  status: NetStatus = 'idle';

  /* host state */
  roster: LobbyPlayer[] = [];
  conns: (DataConnection | null)[] = [];
  goal = 100;
  chatLog: { n: number; s: string; who: string; col: string }[] = [];
  chatN = 0;
  inGame = false;
  jtVetoUsed = false;

  /* guest state */
  private conn: DataConnection | null = null;
  private lastSeen = 0;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private joinCode = '';

  private ev: NetEvents;
  constructor(ev: NetEvents) { this.ev = ev; }

  private setStatus(s: NetStatus, d?: string) {
    this.status = s;
    this.ev.onStatus(s, d);
  }

  static getPlayerId(): string {
    try {
      let id = sessionStorage.getItem('bigcon-fps-player-id');
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem('bigcon-fps-player-id', id);
      }
      return id;
    } catch { return Math.random().toString(36).slice(2, 12); }
  }

  /* ================= HOST ================= */

  hostCreate(name: string, requestedCode?: string) {
    this.role = 'host';
    this.myName = name;
    this.playerId = Net.getPlayerId();
    this.myIdx = 0;
    this.roster = [{ name, playerId: this.playerId, char: null, ready: false, dc: false }];
    this.conns = [null];
    this.goal = 100;
    this.chatLog = []; this.chatN = 0;
    const code = requestedCode && matchCode(requestedCode) ? matchCode(requestedCode)! : ROOM_CODES[Math.floor(Math.random() * ROOM_CODES.length)];
    this.roomCode = code;
    this.hostOpenPeer();
    this.startHostHeartbeat();
  }

  private hostOpenPeer() {
    const code = this.roomCode;
    const old = this.peer;
    if (old && !old.destroyed) { try { old.destroy(); } catch { /* ignore */ } }
    const p = new Peer(PFX + slugCode(code), { config: BIGCON_ICE_CONFIG, debug: 0, pingInterval: 5000 });
    this.peer = p;
    this.setStatus('contacting');
    let opened = false;
    p.on('open', () => {
      if (this.peer !== p) return;
      opened = true;
      this.setStatus('hosting', code);
      this.pushLobby();
    });
    p.on('connection', (c: DataConnection) => {
      if (this.peer !== p) { c.close(); return; }
      this.hostAttach(c);
    });
    p.on('error', (err: { type?: string }) => {
      if (this.peer !== p) return;
      const t = err?.type || '';
      if (t === 'unavailable-id') {
        /* code collision — regenerate and re-register */
        this.roomCode = ROOM_CODES[Math.floor(Math.random() * ROOM_CODES.length)];
        this.hostOpenPeer();
      } else if (t === 'network' || t.startsWith('socket') || t === 'server-error') {
        if (!opened) this.setStatus('error', 'matchmaker unreachable — retrying…');
        setTimeout(() => { if (this.role === 'host' && !this.inGame) this.hostOpenPeer(); }, 3000);
      } else if (t !== 'peer-unavailable') {
        /* transient — guests reconnect on their own */
      }
    });
  }

  private hostAttach(c: DataConnection) {
    let idx = -1;
    c.on('open', () => {
      c.send({ t: 'ping', ts: Date.now() });
    });
    c.on('data', (raw: unknown) => {
      const m = raw as GuestMsg;
      if (!m || typeof m !== 'object' || !('t' in m)) return;
      if (m.t === 'hello') {
        /* seat assignment: reclaim by playerId, else reuse a dc seat, else append */
        let seat = this.roster.findIndex(r => r.playerId === m.playerId);
        if (seat === -1) {
          seat = this.roster.findIndex(r => r.dc);
          if (seat !== -1) {
            this.roster[seat] = { name: m.name, playerId: m.playerId, char: null, ready: false, dc: false };
          }
        }
        if (seat === -1) {
          if (this.roster.length >= 8) { c.send({ t: 'kick', reason: 'the table is full (8 max)' }); setTimeout(() => c.close(), 400); return; }
          if (this.inGame) { c.send({ t: 'kick', reason: 'the con is already live — wait for the next one' }); setTimeout(() => c.close(), 400); return; }
          seat = this.roster.length;
          this.roster.push({ name: m.name, playerId: m.playerId, char: null, ready: false, dc: false });
          this.conns.push(null);
        } else if (this.conns[seat] && this.conns[seat]!.open) {
          c.send({ t: 'kick', reason: 'that face is already connected elsewhere' });
          setTimeout(() => c.close(), 400);
          return;
        } else if (this.inGame) {
          /* mid-game rejoin: the seat is held, the con continues */
          this.roster[seat].dc = false;
          this.roster[seat].name = m.name;
          idx = seat;
          this.conns[seat] = c;
          (c as unknown as { _seat: number })._seat = seat;
          c.send({ t: 'welcome', idx: seat, roster: this.roster, goal: this.goal, chat: this.chatLog.slice(-25) } satisfies HostMsg);
          this.ev.onPeerOpen(seat);
          return;
        } else {
          this.roster[seat].dc = false;
          this.roster[seat].name = m.name;
        }
        idx = seat;
        this.conns[seat] = c;
        (c as unknown as { _seat: number })._seat = seat;
        c.send({ t: 'welcome', idx: seat, roster: this.roster, goal: this.goal, chat: this.chatLog.slice(-25) } satisfies HostMsg);
        this.pushLobby();
        this.hostLogChat(`🛈 ${m.name} pulled up a chair.`, 'sys');
        this.ev.onPeerOpen(seat);
      }
      if (idx === -1) idx = (c as unknown as { _seat?: number })._seat ?? -1;
      if (m.t === 'ping') { c.send({ t: 'pong', ts: (m as { ts: number }).ts }); return; }
      if (m.t === 'pong') return;
      if (idx >= 0) this.ev.onGuestMsg(idx, m);
    });
    c.on('close', () => { if (idx >= 0) this.hostPeerDown(idx); });
    c.on('error', () => { if (idx >= 0) this.hostPeerDown(idx); });
  }

  private hostPeerDown(idx: number) {
    const c = this.conns[idx];
    if (c) { try { c.close(); } catch { /* ignore */ } this.conns[idx] = null; }
    if (this.roster[idx] && !this.roster[idx].dc) {
      this.roster[idx].dc = true;
      this.ev.onPeerClose(idx);
      this.pushLobby();
    }
  }

  hostKick(idx: number, reason: string) {
    const c = this.conns[idx];
    if (c && c.open) { try { c.send({ t: 'kick', reason } satisfies HostMsg); } catch { /* ignore */ } setTimeout(() => c.close(), 300); }
  }

  hostSetGoal(g: number) { this.goal = g; this.pushLobby(); }
  hostSetChar(idx: number, char: string | null) { this.roster[idx].char = char; this.pushLobby(); }
  hostLogChat(s: string, who: string) {
    this.chatLog.push({ n: ++this.chatN, s, who, col: who === 'sys' ? '#9ad' : '#55c1ff' });
    if (this.chatLog.length > 60) this.chatLog.shift();
    this.broadcast({ t: 'chat', s, who: who === 'sys' ? '' : who, col: '#55c1ff', n: this.chatN });
  }

  pushLobby() {
    this.broadcast({ t: 'lobby', roster: this.roster, goal: this.goal });
    this.ev.onLobby(this.roster.slice(), this.goal);
  }

  broadcast(m: HostMsg) {
    for (const c of this.conns) {
      if (c && c.open) { try { c.send(m); } catch { /* ignore */ } }
    }
  }

  sendTo(idx: number, m: HostMsg) {
    const c = this.conns[idx];
    if (c && c.open) { try { c.send(m); } catch { /* ignore */ } }
  }

  hostChat(idx: number, text: string) {
    const clean = text.slice(0, 140);
    const who = this.roster[idx]?.name || '???';
    this.hostLogChat(clean, who);
  }

  private startHostHeartbeat() {
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.hbTimer = setInterval(() => {
      const now = Date.now();
      this.conns.forEach((c, i) => {
        if (c && c.open) { try { c.send({ t: 'ping', ts: now }); } catch { this.hostPeerDown(i); } }
      });
    }, HEARTBEAT_MS);
  }

  /* ================= GUEST ================= */

  guestJoin(name: string, code: string) {
    this.role = 'guest';
    this.myName = name;
    this.playerId = Net.getPlayerId();
    this.joinCode = code;
    this.guestConnect();
  }

  private guestConnect() {
    const matched = matchCode(this.joinCode);
    if (!matched) { this.setStatus('error', 'no such room — check the buzzword'); return; }
    this.roomCode = matched;
    const old = this.peer;
    if (old && !old.destroyed) { try { old.destroy(); } catch { /* ignore */ } }
    const p = new Peer({ config: BIGCON_ICE_CONFIG, debug: 0, pingInterval: 5000 });
    this.peer = p;
    this.setStatus('joining', matched);
    let opened = false;

    p.on('open', () => {
      if (this.peer !== p) return;
      const c = p.connect(PFX + slugCode(matched), { reliable: true, serialization: 'json' });
      this.conn = c;
      let dataOpen = false;
      const to = setTimeout(() => {
        if (!dataOpen) this.scheduleReconnect();
      }, CONN_TIMEOUT_MS);
      c.on('open', () => {
        dataOpen = true;
        clearTimeout(to);
        opened = true;
        this.reconnectDelay = 1000;
        this.lastSeen = Date.now();
        this.setStatus('connected', matched);
        c.send({ t: 'hello', name: this.myName, playerId: this.playerId } satisfies GuestMsg);
        if (this.hbTimer) clearInterval(this.hbTimer);
        this.hbTimer = setInterval(() => {
          if (this.conn && this.conn.open) {
            this.conn.send({ t: 'ping', ts: Date.now() } satisfies GuestMsg);
            if (Date.now() - this.lastSeen > CONN_TIMEOUT_MS) this.scheduleReconnect();
          }
        }, HEARTBEAT_MS);
      });
      c.on('data', (raw: unknown) => {
        const m = raw as HostMsg;
        if (!m || typeof m !== 'object' || !('t' in m)) return;
        this.lastSeen = Date.now();
        if (m.t === 'ping') { c.send({ t: 'pong', ts: m.ts } satisfies GuestMsg); return; }
        if (m.t === 'pong') return;
        if (m.t === 'kick') { this.destroy(); this.setStatus('error', m.reason); return; }
        if (m.t === 'chat') { this.ev.onChat(m.s, m.who, m.col, m.n); }
        if (m.t === 'reload') { window.location.reload(); return; }
        this.ev.onHostMsg(m);
      });
      c.on('close', () => { clearTimeout(to); this.scheduleReconnect(); });
      c.on('error', () => { clearTimeout(to); this.scheduleReconnect(); });
    });
    p.on('error', (err: { type?: string }) => {
      if (this.peer !== p) return;
      const t = err?.type || '';
      if (t === 'peer-unavailable') { this.setStatus('error', 'room not found — is the host still at the table?'); return; }
      if (!opened) this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.role !== 'guest') return;
    if (this.conn) { try { this.conn.close(); } catch { /* ignore */ } this.conn = null; }
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    if (this.reconnectTimer) return;
    this.setStatus('closed', 'connection lost — reconnecting…');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.role !== 'guest') return;
      this.reconnectDelay = Math.min(8000, this.reconnectDelay * 2);
      this.guestConnect();
    }, this.reconnectDelay);
  }

  guestSend(m: GuestMsg) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(m); } catch { this.scheduleReconnect(); }
    } else if (this.role === 'guest') {
      this.scheduleReconnect();
    }
  }

  destroy() {
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.conn) { try { this.conn.close(); } catch { /* ignore */ } this.conn = null; }
    if (this.peer) { try { this.peer.destroy(); } catch { /* ignore */ } this.peer = null; }
    this.role = 'idle';
    this.conns = [];
    this.roster = [];
    this.inGame = false;
    this.setStatus('idle');
  }
}
