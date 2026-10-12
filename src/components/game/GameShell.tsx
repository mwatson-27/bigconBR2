'use client';

/* THE BIG CON: BATTLE ROYALE — orchestrator
 * Screens: splash → setup → lobby → game (HUD) → end modal.
 * Owns the Net (PeerJS) and Engine (Three.js) lifecycles and, when
 * hosting, runs the authoritative sim loop and broadcasts snapshots.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Net, NetStatus } from '@/game/net';
import { Sim } from '@/game/sim';
import { Engine, HudState, SeizeHudState } from '@/game/engine';
import { CHARS, ROOM_CODES, WMAP, NODES } from '@/game/data';
import { Snapshot, FxEvent, GuestMsg, HostMsg, LobbyPlayer, MOOD_COLORS, WIN_TYPES } from '@/game/types';
import { Sfx, unlockAudio, setMuted, isMuted } from '@/game/audio';
import './game.css';

type Screen = 'splash' | 'setup' | 'lobby' | 'game';

interface Toast { id: number; msg: string; kind: string }
interface ChatLine { n: number; s: string; who: string; col: string }
interface FeedLine { id: number; text: string }

let engineCreateCount = 0;

export default function GameShell() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [status, setStatus] = useState<NetStatus>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [roster, setRoster] = useState<LobbyPlayer[]>([]);
  const [goal, setGoal] = useState(100);
  const [myName, setMyName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'choose' | 'host' | 'join'>('choose');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [eventCard, setEventCard] = useState<{ name: string; icon: string; desc: string; mood: string } | null>(null);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [endSnap, setEndSnap] = useState<Snapshot | null>(null);
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [seize, setSeize] = useState<SeizeHudState | null>(null);
  const [snapRef, setSnapRef] = useState<Snapshot | null>(null);
  const [record, setRecord] = useState<string[]>([]);
  const [muted, setMutedUi] = useState(false);
  const [netRole, setNetRole] = useState<'host' | 'guest' | 'idle'>('idle');
  const [netIdx, setNetIdx] = useState(0);
  const [roomCode, setRoomCode] = useState('');

  const netRef = useRef<Net | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const simRef = useRef<Sim | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSnapRef = useRef<Snapshot | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const pendingBeginRef = useRef<{ snap: Snapshot; idx: number; spawns: number[] } | null>(null);
  const pendingHostSpawnRef = useRef<number[] | null>(null);
  const toastId = useRef(1);
  const feedId = useRef(1);
  const recordRef = useRef<string[]>([]);

  /* ---------- helpers ---------- */

  const toast = useCallback((msg: string, kind = 'info') => {
    const id = toastId.current++;
    setToasts(t => [...t.slice(-3), { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3600);
  }, []);

  const appendRecord = useCallback((lines: string[]) => {
    if (!lines.length) return;
    recordRef.current = [...recordRef.current, ...lines].slice(-60);
    setRecord(recordRef.current);
  }, []);

  const appendRecordHost = useCallback((snap: Snapshot) => {
    const lines = diffRecord(recordRef.current, snap.logTail.map(l => l.s));
    if (lines.length) appendRecord(lines);
  }, [appendRecord]);

  const pushFeed = useCallback((text: string) => {
    const id = feedId.current++;
    setFeed(f => [...f.slice(-5), { id, text }]);
    setTimeout(() => setFeed(f => f.filter(x => x.id !== id)), 6200);
  }, []);

  /* ---------- intent routing (host side) ---------- */

  const hostHandleIntent = useCallback((idx: number, m: GuestMsg) => {
    const sim = simRef.current;
    const net = netRef.current;
    if (!net) return;
    switch (m.t) {
      case 'pick': net.hostSetChar(idx, m.char); break;
      case 'pose': if (sim) sim.pose(idx, m.x, m.y, m.z, m.ry, m.p, m.mv); break;
      case 'shot': if (sim) sim.shot(idx, m.wpn, m.hit, m.dmg, { x: m.ox, y: m.oy, z: m.oz }, { x: m.dx, y: m.dy, z: m.dz }); break;
      case 'seize': {
        if (!sim) break;
        const res = sim.trySeize(idx, m.node);
        if (res !== 'ok') net.sendTo(idx, { t: 'sys', msg: `⚠️ ${res}`, kind: 'bad' });
        break;
      }
      case 'oil': if (sim) sim.oilThrow(idx, m.x, m.z); break;
      case 'ability': {
        if (!sim) break;
        if (m.kind === 'jtdeny') { sim.jtDenyRequest(idx); break; }
        const res = sim.ability(idx, m.kind);
        if (res !== 'ok' && res !== 'unknown') net.sendTo(idx, { t: 'sys', msg: `⚠️ ${res}`, kind: 'bad' });
        break;
      }
      case 'weapon': if (sim) sim.weaponSwitch(idx, m.slot); break;
      case 'reload': if (sim) sim.reload(idx); break;
      case 'pickup': if (sim) sim.pickupTake(idx, m.id); break;
      case 'chat': net.hostChat(idx, m.text); break;
    }
  }, []);

  /* ---------- host loop ---------- */

  const extractFeed = useCallback((fx: FxEvent[]) => {
    const snap = lastSnapRef.current;
    if (!snap) return;
    for (const f of fx) {
      if (f.k === 'kill') {
        const a = f.a !== null && f.a !== undefined && f.a >= 0 ? snap.players[f.a]?.name : null;
        const b = f.b !== undefined ? snap.players[f.b]?.name : '?';
        const cause = f.n || 'the market';
        pushFeed(a ? `☠️ ${a} LIQUIDATED ${b} · ${cause}` : `☠️ ${b} was liquidated by ${cause}`);
      }
    }
  }, [pushFeed]);

  const startHostLoop = useCallback(() => {
    if (hostLoopRef.current) clearInterval(hostLoopRef.current);
    let last = performance.now();
    let lastSnapAt = 0;
    hostLoopRef.current = setInterval(() => {
      const sim = simRef.current;
      const net = netRef.current;
      const eng = engineRef.current;
      if (!sim || !net || !eng) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      sim.tick(dt);
      /* poses 20Hz: host from engine, guests from sim.lastPose */
      const arr: number[] = [];
      sim.players.forEach((p, i) => {
        if (i === net.myIdx) {
          const e = eng.getPos();
          arr.push(i, Math.round(e.x * 100) / 100, Math.round(e.y * 100) / 100, Math.round(e.z * 100) / 100, 0, 0, 0);
          sim.pose(i, e.x, e.y, e.z, 0, 0, 0);
        } else {
          arr.push(i, Math.round(p.lastPose.x * 100) / 100, Math.round(p.lastPose.y * 100) / 100, Math.round(p.lastPose.z * 100) / 100, Math.round(p.lastPose.ry * 100) / 100, Math.round(p.lastPose.p * 100) / 100, p.lastPose.mv);
        }
      });
      net.broadcast({ t: 'poses', arr });
      eng.applyPoses(arr); /* host also renders remote avatars from the same stream */
      /* snapshot 2Hz */
      if (now - lastSnapAt > 500) {
        lastSnapAt = now;
        const snap = sim.snapshot();
        net.broadcast({ t: 'state', snap });
        eng.applySnapshot(snap);
        lastSnapRef.current = snap;
        setSnapRef(snap);
        appendRecordHost(snap);
      }
    }, 50);
  }, [appendRecordHost]);

  const stopHostLoop = useCallback(() => {
    if (hostLoopRef.current) { clearInterval(hostLoopRef.current); hostLoopRef.current = null; }
  }, []);

  /* ---------- host message → local effects ---------- */

  useEffect(() => {
    const net = new Net({
      onStatus: (s, d) => {
        setStatus(s); setStatusDetail(d || '');
        if (s === 'hosting' && d) setRoomCode(d);
        if (s === 'connected' && d) setRoomCode(d);
      },
      onLobby: (r, g) => { setRoster(r.slice()); setGoal(g); },
      onChat: (s, who, col, n) => {
        setChat(c => [...c.slice(-60), { n, s, who, col }]);
      },
      onHostMsg: (m: HostMsg) => {
        const eng = engineRef.current;
        switch (m.t) {
          case 'welcome':
            netRef.current!.myIdx = m.idx;
            setNetIdx(m.idx);
            setChat(m.chat.slice());
            break;
          case 'lobby':
            setRoster(m.roster.slice());
            setGoal(m.goal);
            break;
          case 'begin': {
            netRef.current!.myIdx = m.idx;
            setNetIdx(m.idx);
            pendingBeginRef.current = { snap: m.snap, idx: m.idx, spawns: m.spawns };
            setScreen('game');
            setPaused(true);
            setEndSnap(null);
            break;
          }
          case 'state':
            lastSnapRef.current = m.snap;
            setSnapRef(m.snap);
            eng?.applySnapshot(m.snap);
            appendRecord(diffRecord(recordRef.current, m.snap.logTail.map(l => l.s)));
            break;
          case 'poses': eng?.applyPoses(m.arr); break;
          case 'fx':
            extractFeed(m.fx);
            eng?.applyFxHost(m.fx);
            break;
          case 'event':
            setEventCard(m.card);
            Sfx.event();
            setTimeout(() => setEventCard(null), 6000);
            break;
          case 'sys': toast(m.msg, m.kind || 'info'); if (m.kind === 'bad' && m.msg.includes('$')) engineRef.current?.setSeizeError(m.msg); break;
          case 'log': appendRecord(m.lines); break;
          case 'end':
            lastSnapRef.current = m.snap;
            setSnapRef(m.snap);
            eng?.applySnapshot(m.snap);
            setEndSnap(m.snap);
            setPaused(false);
            Sfx.win();
            break;
          case 'reload': window.location.reload(); break;
          case 'kick': toast(`🚪 ${m.reason}`, 'bad'); netRef.current?.destroy(); setScreen('setup'); break;
        }
      },
      onGuestMsg: (idx, m) => hostHandleIntent(idx, m),
      onPeerOpen: (idx) => {
        /* mid-game rejoin: resume the guest straight into the live con */
        const sim = simRef.current;
        const net = netRef.current;
        if (sim && net && net.inGame && idx !== net.myIdx) {
          const snap = sim.snapshot();
          const spawns = sim.getSpawns();
          try {
            net.sendTo(idx, { t: 'begin', snap, idx, seed: 0, spawns });
            sim.logLine(`🔔 ${sim.players[idx]?.name || 'a con'} reconnected — the seat was held.`);
          } catch { /* ignore */ }
        }
      },
      onPeerClose: (idx) => {
        const sim = simRef.current;
        if (sim && sim.players[idx]) {
          sim.players[idx].dc = true;
          appendRecord([`🔕 ${sim.players[idx].name} lost connection — seat is being held.`]);
        }
      },
    });
    netRef.current = net;
    return () => { net.destroy(); };
  }, [hostHandleIntent, appendRecord, toast, extractFeed]);

  /* ---------- engine lifecycle (game screen) ---------- */

  useEffect(() => {
    if (screen !== 'game' || !containerRef.current) return;
    const net = netRef.current!;
    const eng = new Engine(containerRef.current, {
      onToast: (msg, kind) => toast(msg, kind),
      onSeize: (s) => setSeize(s),
      onPointerLock: (l) => setPaused(!l),
    }, {
      sendPose: (x, y, z, ry, p, mv) => {
        if (net.role === 'host') hostHandleIntent(net.myIdx, { t: 'pose', x, y, z, ry, p, mv });
        else net.guestSend({ t: 'pose', x, y, z, ry, p, mv });
      },
      sendShot: (wpn, hit, dmg, ox, oy, oz, dx, dy, dz) => {
        if (net.role === 'host') hostHandleIntent(net.myIdx, { t: 'shot', wpn, hit, dmg, ox, oy, oz, dx, dy, dz });
        else net.guestSend({ t: 'shot', wpn, hit, dmg, ox, oy, oz, dx, dy, dz });
      },
      sendSeize: (node) => {
        if (net.role === 'host') hostHandleIntent(net.myIdx, { t: 'seize', node });
        else net.guestSend({ t: 'seize', node });
      },
      sendOil: (x, z) => {
        if (net.role === 'host') hostHandleIntent(net.myIdx, { t: 'oil', x, z });
        else net.guestSend({ t: 'oil', x, z });
      },
      sendAbility: (kind) => {
        if (net.role === 'host') hostHandleIntent(net.myIdx, { t: 'ability', kind: kind as 'favor' });
        else net.guestSend({ t: 'ability', kind: kind as 'favor' });
      },
      sendWeapon: (slot) => {
        if (net.role === 'host') hostHandleIntent(net.myIdx, { t: 'weapon', slot });
        else net.guestSend({ t: 'weapon', slot });
      },
      sendReload: () => {
        if (net.role === 'host') hostHandleIntent(net.myIdx, { t: 'reload' });
        else net.guestSend({ t: 'reload' });
      },
      sendPickup: (id) => {
        if (net.role === 'host') hostHandleIntent(net.myIdx, { t: 'pickup', id });
        else net.guestSend({ t: 'pickup', id });
      },
    });
    engineRef.current = eng;
    eng.init();
    eng.start();
    (window as unknown as { __bcgEngine?: Engine }).__bcgEngine = eng; /* debug/testing hook */
    (window as unknown as { __bcgDebug?: unknown }).__bcgDebug = {
      get engine() { return engineRef.current; },
      get sim() { return simRef.current; },
      engineCount: ++engineCreateCount,
    };
    /* apply pending begin info (guests) or host sim state */
    if (net.role === 'guest' && pendingBeginRef.current) {
      const pb = pendingBeginRef.current;
      pendingBeginRef.current = null;
      eng.setMyIdx(pb.idx);
      const sx = pb.spawns[pb.idx * 3] || 0, sy = pb.spawns[pb.idx * 3 + 1] || 260, sz = pb.spawns[pb.idx * 3 + 2] || 0;
      eng.setSpawn(sx, sy, sz);
      eng.applySnapshot(pb.snap);
      lastSnapRef.current = pb.snap;
      setSnapRef(pb.snap);
    }
    if (net.role === 'host' && simRef.current) {
      const sim = simRef.current;
      /* pristine spawn coords captured at match start — sim.getSpawns()
       * can be contaminated by live engine poses by effect time */
      const spawns = pendingHostSpawnRef.current || sim.getSpawns();
      pendingHostSpawnRef.current = null;
      eng.setMyIdx(net.myIdx);
      eng.setSpawn(spawns[net.myIdx * 3] || 0, spawns[net.myIdx * 3 + 1] || 260, spawns[net.myIdx * 3 + 2] || 0);
      const snap0 = sim.snapshot();
      eng.applySnapshot(snap0);
      lastSnapRef.current = snap0;
      setSnapRef(snap0);
      startHostLoop();
    }
    /* HUD poll 10Hz */
    const hudTimer = setInterval(() => setHud({ ...eng.hud }), 100);
    /* chat: Enter to open */
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && !chatOpen) {
        e.preventDefault();
        setChatOpen(true);
        setTimeout(() => chatInputRef.current?.focus(), 30);
        if (document.pointerLockElement) document.exitPointerLock();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearInterval(hudTimer);
      stopHostLoop();
      eng.dispose();
      engineRef.current = null;
    };
  }, [screen]);

  /* ---------- actions ---------- */

  const doHost = () => {
    unlockAudio();
    const name = sanitizeName(myName);
    if (!name) { toast('Pick a name for the record.', 'bad'); return; }
    netRef.current!.hostCreate(name);
    setNetRole('host');
    setScreen('lobby');
  };

  const doJoin = () => {
    unlockAudio();
    const name = sanitizeName(myName);
    if (!name) { toast('Pick a name for the record.', 'bad'); return; }
    if (!joinCode.trim()) { toast('Type the room buzzword.', 'bad'); return; }
    netRef.current!.guestJoin(name, joinCode.trim());
    setNetRole('guest');
    setScreen('lobby');
  };

  const pickChar = (charId: string) => {
    const net = netRef.current!;
    if (net.role === 'host') {
      const taken = roster.some((r, i) => i !== net.myIdx && r.char === charId);
      if (taken) return;
      net.hostSetChar(net.myIdx, charId);
    } else {
      const taken = roster.some((r, i) => i !== net.myIdx && r.char === charId);
      if (taken) return;
      net.guestSend({ t: 'pick', char: charId });
    }
  };

  /* guest picks send 'pick' intents; host applies + pushes lobby updates */

  const startMatch = () => {
    const net = netRef.current!;
    if (net.role !== 'host') return;
    const active = roster.filter(r => !r.dc);
    if (!active.length) return;
    if (active.length >= 2 && active.some(r => !r.char)) { toast('Everyone must pick a face.', 'bad'); return; }
    unlockAudio();
    const seed = Math.floor(Math.random() * 1e9);
    const sim = new Sim(
      roster.filter(r => !r.dc).map(r => ({ name: r.name, char: r.char })),
      goal,
      (fx) => {
        net.broadcast({ t: 'fx', fx });
        engineRef.current?.applyFxHost(fx);
      },
      (idx, msg, kind) => {
        if (idx === net.myIdx) toast(msg, kind);
        else net.sendTo(idx, { t: 'sys', msg, kind });
      },
      (card) => {
        net.broadcast({ t: 'event', card });
        setEventCard(card);
        Sfx.event();
        setTimeout(() => setEventCard(null), 6000);
      },
      []
    );
    sim.onEnd = () => {
      const snap = sim.snapshot();
      net.broadcast({ t: 'end', snap });
      setEndSnap(snap);
      setPaused(false);
      Sfx.win();
    };
    sim.start(seed);
    simRef.current = sim;
    pendingHostSpawnRef.current = sim.getSpawns();
    net.inGame = true;
    const snap = sim.snapshot();
    const spawns = sim.getSpawns();
    /* per-seat begin messages with correct idx */
    net.conns.forEach((c, i) => {
      if (c && c.open) {
        try { c.send({ t: 'begin', snap, idx: i, spawns }); } catch { /* ignore */ }
      }
    });
    /* local enter game — engine effect handles spawn + loop */
    setScreen('game');
    setPaused(true);
    setEndSnap(null);
  };

  const sendChat = () => {
    const net = netRef.current!;
    const text = chatDraft.trim();
    if (text) {
      if (net.role === 'host') net.hostChat(net.myIdx, text);
      else net.guestSend({ t: 'chat', text });
    }
    setChatDraft('');
    setChatOpen(false);
    chatInputRef.current?.blur();
  };

  const runItBack = () => {
    const net = netRef.current!;
    if (net.role === 'host') {
      net.broadcast({ t: 'reload' });
      setTimeout(() => window.location.reload(), 150);
    } else {
      window.location.reload();
    }
  };

  const leaveTable = () => {
    stopHostLoop();
    simRef.current = null;
    netRef.current?.destroy();
    setNetRole('idle');
    setNetIdx(0);
    setRoomCode('');
    setScreen('setup');
    setEndSnap(null);
    setSnapRef(null);
    recordRef.current = [];
    setRecord([]);
  };

  const toggleMute = () => {
    const m = !isMuted();
    setMuted(m);
    setMutedUi(m);
  };

  /* ---------- derived ---------- */

  const myIdx = netIdx;
  const snap = snapRef;
  const amHost = netRole === 'host';
  const canStart = amHost && roster.filter(r => !r.dc).length >= 1
    && (roster.filter(r => !r.dc).length < 2 || roster.filter(r => !r.dc).every(r => r.char));
  const solo = roster.filter(r => !r.dc).length < 2;

  /* ---------- render ---------- */

  return (
    <div className="bcg-root">
      {/* splash */}
      {screen === 'splash' && <Splash onDone={() => { unlockAudio(); setScreen('setup'); }} />}

      {/* setup */}
      {screen === 'setup' && (
        <SetupScreen
          mode={mode} setMode={setMode}
          myName={myName} setMyName={setMyName}
          joinCode={joinCode} setJoinCode={setJoinCode}
          onHost={doHost} onJoin={doJoin}
          status={status} statusDetail={statusDetail}
        />
      )}

      {/* lobby */}
      {screen === 'lobby' && (
        <Lobby
          roster={roster} goal={goal} onGoal={g => { setGoal(g); netRef.current?.hostSetGoal(g); }}
          amHost={amHost} roomCode={roomCode}
          myIdx={myIdx}
          status={status} statusDetail={statusDetail}
          onPick={pickChar}
          onStart={startMatch}
          canStart={!!canStart} solo={solo}
          chat={chat}
          chatDraft={chatDraft} setChatDraft={setChatDraft}
          onSendChat={() => {
            const net = netRef.current!;
            const text = chatDraft.trim();
            if (text) {
              if (net.role === 'host') net.hostChat(net.myIdx, text);
              else net.guestSend({ t: 'chat', text });
            }
            setChatDraft('');
          }}
          onLeave={leaveTable}
        />
      )}

      {/* game */}
      {screen === 'game' && (
        <>
          <div ref={containerRef} className="absolute inset-0" style={{ position: 'absolute', inset: 0 }} />
          <div className="bcg-scan" />
          {hud && (
            <Hud
              hud={hud} snap={snap} myIdx={myIdx}
              record={record}
              chat={chat} chatOpen={chatOpen} setChatOpen={setChatOpen}
              chatDraft={chatDraft} setChatDraft={setChatDraft}
              onSendChat={sendChat}
              chatInputRef={chatInputRef}
              feed={feed}
              seize={seize}
              eventCard={eventCard}
              getEngine={() => engineRef.current}
              onResume={() => {
                engineRef.current?.requestLock();
                /* environments that block pointer lock: fall back to drag-look after a beat */
                setTimeout(() => { if (!document.pointerLockElement) setPaused(false); }, 700);
              }}
              paused={paused && !endSnap}
              onLeave={leaveTable}
              muted={muted} onToggleMute={toggleMute}
            />
          )}
          {endSnap && <EndModal snap={endSnap} myIdx={myIdx} onAgain={runItBack} onLeave={leaveTable} />}
        </>
      )}

      {/* toasts */}
      <div style={{ position: 'fixed', top: 54, left: '50%', transform: 'translateX(-50%)', zIndex: 95, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        {toasts.map(t => (
          <div key={t.id} className={`bcg-toast show ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

/* ================= sub components ================= */

function Splash({ onDone }: { onDone: () => void }) {
  const [gif, setGif] = useState(true);
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setGif(false), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="bcg-splash">
      <div className="bcg-splash-logo">
        {imgOk ? (
          <img src={gif ? '/logo.gif' : '/logo.png'} alt="THE BIG CON" onError={() => setImgOk(false)} />
        ) : (
          <div className="bcg-title" style={{ fontSize: 64 }}>THE BIG CON</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div className="bcg-title" style={{ fontSize: 30 }}>BATTLE ROYALE</div>
        <span className="bcg-tag" style={{ fontSize: 18 }}>the con goes first-person</span>
      </div>
      <button className="bcg-btn primary" style={{ marginTop: 22, fontSize: 17, padding: '14px 34px' }} onClick={onDone}>
        🔥 PULL UP A CHAIR
      </button>
      <div style={{ marginTop: 14, fontSize: 11.5, color: '#9ad', letterSpacing: 1.5, textAlign: 'center' }}>
        28 exhibits · 6 weapons · 24 market events · THE PANIC closes in · no dice (they were rigged) · online 1–8
      </div>
    </div>
  );
}

function SetupScreen(props: {
  mode: 'choose' | 'host' | 'join';
  setMode: (m: 'choose' | 'host' | 'join') => void;
  myName: string; setMyName: (s: string) => void;
  joinCode: string; setJoinCode: (s: string) => void;
  onHost: () => void; onJoin: () => void;
  status: NetStatus; statusDetail: string;
}) {
  return (
    <div className="bcg-splash">
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 4 }}>
        <div className="bcg-title">THE BIG CON</div>
        <div className="bcg-title" style={{ background: '#000', border: '2px solid #168388', color: '#7ff6fb', fontSize: 26 }}>BATTLE ROYALE</div>
      </div>
      <div className="bcg-setupcard">
        <div className="bcg-label">THE SYNDICATE — SIGN-IN</div>
        <div style={{ margin: '12px 0 18px' }}>
          <input
            className="bcg-input"
            placeholder="name for the record (≤16 chars)"
            maxLength={16}
            value={props.myName}
            onChange={e => props.setMyName(e.target.value)}
          />
        </div>
        {props.mode === 'choose' && (
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="bcg-btn primary" style={{ flex: 1 }} onClick={() => props.setMode('host')}>🏛️ HOST THE TABLE</button>
            <button className="bcg-btn" style={{ flex: 1 }} onClick={() => props.setMode('join')}>🔗 JOIN A CON</button>
          </div>
        )}
        {props.mode === 'host' && (
          <div>
            <div className="bcg-intro">
              You host the table. Your browser runs the market, the quarters and the regulators —
              share the buzzword with the syndicate. Up to 8 cons, P2P via PeerJS, no servers, no mercy.
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button className="bcg-btn primary" style={{ flex: 1 }} onClick={props.onHost}>🔥 OPEN THE TABLE</button>
              <button className="bcg-btn" onClick={() => props.setMode('choose')}>BACK</button>
            </div>
          </div>
        )}
        {props.mode === 'join' && (
          <div>
            <div className="bcg-intro">
              Type the room buzzword. It knows what you did last quarter.
            </div>
            <div style={{ margin: '12px 0 4px' }}>
              <input
                className="bcg-input"
                list="bcg-rooms"
                placeholder="e.g. JTPORTAL, LOW CORTISOL, WORLD ECONOMIC FORUM…"
                value={props.joinCode}
                onChange={e => props.setJoinCode(e.target.value.toUpperCase())}
                maxLength={32}
              />
              <datalist id="bcg-rooms">
                {ROOM_CODES.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
              <button className="bcg-btn primary" style={{ flex: 1 }} onClick={props.onJoin}>🤝 TAKE A SEAT</button>
              <button className="bcg-btn" onClick={() => props.setMode('choose')}>BACK</button>
            </div>
          </div>
        )}
        {(props.status === 'error' || props.status === 'closed') && (
          <div style={{ marginTop: 14, color: '#ff6b5e', fontWeight: 700, fontSize: 13 }}>⚠️ {props.statusDetail}</div>
        )}
      </div>
      <div style={{ marginTop: 16, fontSize: 11.5, color: '#9ad', letterSpacing: 1.5, textAlign: 'center', maxWidth: 640, lineHeight: 1.7 }}>
        FPS · seize exhibits · collect quarters · watch cortisol · the regulators raid at 8 · THE PANIC shrinks ·
        first to the money target holding one of every exhibit type — or the last con standing.
      </div>
    </div>
  );
}

function Lobby(props: {
  roster: LobbyPlayer[]; goal: number; onGoal: (g: number) => void;
  amHost: boolean; roomCode: string; myIdx: number;
  status: NetStatus; statusDetail: string;
  onPick: (charId: string) => void;
  onStart: () => void; canStart: boolean; solo: boolean;
  chat: ChatLine[];
  chatDraft: string; setChatDraft: (s: string) => void;
  onSendChat: () => void;
  onLeave: () => void;
}) {
  const net = { status: props.status };
  return (
    <div className="bcg-lobby">
      <div className="bcg-panel" style={{ maxWidth: 900, width: '100%', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="bcg-label">THE TABLE — ROOM CODE</div>
            <div className="bcg-codebig" style={{ marginTop: 8 }}>{props.roomCode}</div>
            <div className="bcg-tag" style={{ marginTop: 8, fontSize: 14 }}>share the buzzword · they&apos;ll know what to do</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="bcg-label">NET</div>
            <div style={{ color: net.status === 'hosting' || net.status === 'connected' ? '#7ff6fb' : '#ffa94d', fontWeight: 700, fontSize: 13, marginTop: 4 }}>
              {props.statusDetail || props.status}
            </div>
            <button className="bcg-btn" style={{ marginTop: 10, fontSize: 11, padding: '6px 12px' }} onClick={props.onLeave}>LEAVE</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1.1fr) minmax(260px, 1fr)', gap: 20, marginTop: 20 }}>
          <div>
            <div className="bcg-label">PICK A FACE — ONE PLAYER PER CHARACTER</div>
            <div className="bcg-faces" style={{ marginTop: 10 }}>
              {CHARS.map(c => {
                const takenBy = props.roster.find(r => r.char === c.id);
                const mine = props.roster[props.myIdx]?.char === c.id;
                return (
                  <div
                    key={c.id}
                    className={`bcg-face ${takenBy && !mine ? 'taken' : ''} ${mine ? 'mine' : ''}`}
                    onClick={() => !takenBy || mine ? props.onPick(c.id) : undefined}
                  >
                    <img src={c.img} alt={c.name} />
                    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, marginTop: 6 }}>{c.name}</div>
                    <div style={{ fontSize: 9.5, color: 'burlywood', fontStyle: 'italic' }}>{takenBy ? takenBy.name : c.sub}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="bcg-label">THE SYNDICATE — {props.roster.filter(r => !r.dc).length} AT THE TABLE</div>
            <div style={{ marginTop: 8, border: '1px solid #168388', background: '#0b0e0d' }}>
              {props.roster.map((r, i) => (
                <div key={i} className="bcg-lrow">
                  <span className="lh">{String(i + 1).padStart(2, '0')}</span>
                  {r.char && <img src={CHARS.find(c => c.id === r.char)?.img} alt="" style={{ width: 26, height: 26, objectFit: 'cover' }} />}
                  <span style={{ fontWeight: 800, color: i === props.myIdx ? '#f5c542' : '#f2f2f2' }}>{r.name}{i === props.myIdx ? ' (you)' : ''}</span>
                  {r.dc && <span style={{ color: '#ff6b5e', fontSize: 11 }}>· connection lost</span>}
                </div>
              ))}
            </div>

            {props.amHost && (
              <div style={{ marginTop: 14 }}>
                <div className="bcg-label">WIN TARGET — FIRST TO $X</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <span className="bcg-serif" style={{ fontSize: 26, color: '#7fe08d', fontWeight: 900 }}>$</span>
                  <input
                    className="bcg-input"
                    type="number" min={20} max={999}
                    value={props.goal}
                    onChange={e => {
                      const v = Math.max(20, Math.min(999, Number(e.target.value) || 100));
                      props.onGoal(v);
                    }}
                    style={{ width: 120 }}
                  />
                </div>
              </div>
            )}

            {/* THE WIRE — lobby chat */}
            <div style={{ marginTop: 14 }}>
              <div className="bcg-label">THE WIRE</div>
              <div style={{ height: 130, overflowY: 'auto', background: '#04100f', border: '1px solid #168388', padding: '8px 10px', marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
                {props.chat.map((c, i) => (
                  <div key={c.n || i}><span style={{ color: c.col || '#55c1ff', fontWeight: 700 }}>{c.who ? `${c.who}: ` : ''}</span>{c.s}</div>
                ))}
                {!props.chat.length && <div style={{ color: '#456' }}>talk your book before the con starts…</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  className="bcg-input"
                  style={{ fontSize: 12, padding: '7px 10px' }}
                  placeholder="talk your book…"
                  maxLength={140}
                  value={props.chatDraft}
                  onChange={e => props.setChatDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') props.onSendChat(); }}
                />
                <button className="bcg-btn" style={{ padding: '7px 14px', fontSize: 11 }} onClick={props.onSendChat}>SEND</button>
              </div>
            </div>
          </div>
        </div>

        {props.amHost && (
          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <button className="bcg-btn primary" style={{ fontSize: 16, padding: '13px 32px' }} disabled={!props.canStart} onClick={props.onStart}>
              {props.solo ? '🎯 START THE SOLO DRILL' : '🔥 START THE CON'}
            </button>
            {props.solo && <div style={{ fontSize: 11, color: 'burlywood', fontStyle: 'italic', marginTop: 8 }}>share the room code — others can join before the drop… or run the drill alone</div>}
          </div>
        )}
        {!props.amHost && (
          <div style={{ marginTop: 18, textAlign: 'center', color: '#9ad', fontSize: 12, letterSpacing: 1.5 }}>
            WAITING FOR THE HOST TO START THE CON · make sure you picked a face
          </div>
        )}
      </div>
    </div>
  );
}

/* in-game HUD */
function Hud(props: {
  hud: HudState; snap: Snapshot | null; myIdx: number;
  record: string[];
  chat: ChatLine[]; chatOpen: boolean; setChatOpen: (b: boolean) => void;
  chatDraft: string; setChatDraft: (s: string) => void;
  onSendChat: () => void;
  chatInputRef: React.RefObject<HTMLInputElement | null>;
  feed: FeedLine[];
  seize: SeizeHudState | null;
  eventCard: { name: string; icon: string; desc: string; mood: string } | null;
  getEngine: () => Engine | null;
  onResume: () => void;
  paused: boolean;
  onLeave: () => void;
  muted: boolean; onToggleMute: () => void;
}) {
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const { hud, snap } = props;

  /* minimap draw */
  useEffect(() => {
    const cvs = mapCanvasRef.current;
    const eng = props.getEngine();
    if (!cvs || !eng) return;
    const ctx = cvs.getContext('2d')!;
    const draw = () => {
      const d = eng.minimapData();
      const W = cvs.width, H = cvs.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#04100f';
      ctx.fillRect(0, 0, W, H);
      const toPx = (x: number, z: number) => [W / 2 + (x / 830) * (W / 2 - 6), H / 2 + (z / 830) * (H / 2 - 6)];
      /* zone */
      if (d.zone) {
        const [zx, zz] = toPx(d.zone.cx, d.zone.cz);
        ctx.strokeStyle = '#ff6b5e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(zx, zz, Math.max(4, (d.zone.r / 830) * (W / 2 - 6)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,107,94,0.08)';
        ctx.fill();
      }
      /* nodes */
      for (const n of d.nodes) {
        const [x, y] = toPx(n.x, n.z);
        ctx.fillStyle = n.owner === null ? 'rgba(154,170,187,0.5)' : (snap?.players[n.owner]?.color || '#fff');
        ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      }
      /* players: marked only (the raid beacon broadcasts position) */
      d.players.forEach((p) => {
        if (p.x === null || p.z === null || p.dead || !p.marked) return;
        const [x, y] = toPx(p.x, p.z);
        ctx.fillStyle = '#ff6b5e';
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      });
      /* me */
      const [mx, my] = toPx(d.me.x, d.me.z);
      ctx.fillStyle = '#f5c542';
      ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
      /* view cone */
      ctx.strokeStyle = 'rgba(245,197,66,0.5)';
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - Math.sin(d.me.yaw) * 12, my - Math.cos(d.me.yaw) * 12);
      ctx.stroke();
    };
    draw();
    const t = setInterval(draw, 200);
    return () => clearInterval(t);
  }, [props.getEngine, snap]);

  const mood = snap?.mood || 'CALM';
  const moodCol = MOOD_COLORS[mood];
  const wdef = WMAP[hud.weapon];
  const crossSpread = 10 + hud.spread * 900;

  /* compass letters */
  const yawDeg = ((-hud.compass * 180 / Math.PI) % 360 + 360) % 360;
  const compassText = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const zoneBearingDeg = ((hud.zoneBearing * 180 / Math.PI) % 360 + 360) % 360;
  const zoneDelta = zoneBearingDeg - yawDeg;

  const flashOn = performance.now() / 1000 - hud.hurtAt < 0.6;

  return (
    <div className="bcg-hud">
      {/* hurt flash */}
      <div className="bcg-flash" style={{ opacity: flashOn ? 1 : 0 }} />
      {!hud.inZone && <div className="bcg-zonevig" />}

      {/* net strip */}
      <div className="bcg-netstrip">
        <span>THE BIG CON: BATTLE ROYALE</span>
        <span>
          Q{snap?.qNum ?? 0} · {Math.max(0, Math.ceil(snap?.qEnd ?? 0))}s to settlement ·
          {' '}{Math.max(0, Math.ceil(snap?.evEnd ?? 0))}s to rumor ·
          {' '}GOAL ${snap?.goal ?? 0}
        </span>
      </div>

      {/* mood ticker */}
      <div className="bcg-mood">
        <div className="m" style={{ color: moodCol }}>MARKET: {mood}</div>
        <div className="sub">
          {snap?.phase === 'drop' ? 'DROP IN PROGRESS' :
            hud.inZone ? `PANIC PHASE ${hud.zonePhase} · ZONE SHRINKS IN ${Math.max(0, Math.ceil(hud.zoneNext))}s` :
              `⚠️ OUTSIDE THE PANIC · ${hud.zoneDist}m TO SAFETY`}
        </div>
      </div>

      {/* compass */}
      <div className="bcg-compass">
        <div className="strip" style={{ left: '50%', transform: `translateX(-${yawDeg * 2.2}px)` }}>
          {Array.from({ length: 36 }, (_, i) => {
            const deg = i * 10;
            const lab = deg % 45 === 0 ? compassText[(deg / 45) % 8] : deg % 90 === 0 ? String(deg) : '·';
            return <span key={i} style={{ display: 'inline-block', width: 22, textAlign: 'center', color: deg % 45 === 0 ? '#9ad' : '#456' }}>{lab}</span>;
          })}
        </div>
        <div className="mark" style={{ left: `calc(50% + ${Math.max(-140, Math.min(140, zoneDelta * 2.2))}px)` }}>◆</div>
      </div>

      {/* syndicate */}
      <div className="bcg-synd">
        <div className="bcg-label">THE SYNDICATE</div>
        {(snap?.players || []).map((p, i) => (
          <div key={i} className={`prow ${i === props.myIdx ? 'me' : ''} ${p.dead ? 'dead' : ''}`}>
            <span className="dot" style={{ background: p.color }} />
            <span style={{ fontWeight: 700 }}>{p.name}</span>
            <span className="stats">
              ${p.money} · {p.intel}i · {p.cor}🔥{p.bugCount ? ` · ${p.bugCount}🐛` : ''}
              <div className="hpbar"><i style={{ width: `${p.hp}%`, background: p.hp > 40 ? '#7fe08d' : '#ff6b5e' }} /></div>
            </span>
          </div>
        ))}
      </div>

      {/* type checklist */}
      <div className="bcg-types">
        <div className="bcg-label" style={{ marginBottom: 4 }}>THE CON — TYPES HELD</div>
        {WIN_TYPES.map(t => {
          const on = hud.nodeTypesHeld[t];
          return (
            <div key={t} className={`t ${on ? 'on' : ''}`}>
              <span>{t}</span>
              <span>{on ? '■' : '□'}</span>
            </div>
          );
        })}
        <div style={{ fontSize: 9.5, color: '#8a7a5f', marginTop: 4, fontFamily: 'Times New Roman, serif', fontStyle: 'italic' }}>
          ${hud.money}/{snap?.goal ?? 100} + all 7 = the con pays out
        </div>
      </div>

      {/* kill feed */}
      <div className="bcg-feed">
        {props.feed.map(f => <div key={f.id} className="k">{f.text}</div>)}
      </div>

      {/* minimap */}
      <div className="bcg-map">
        <div className="bcg-label" style={{ marginBottom: 4 }}>THE BOARD</div>
        <canvas ref={mapCanvasRef} width={164} height={164} />
      </div>

      {/* record */}
      <div className="bcg-record">
        <div className="bcg-label">THE RECORD</div>
        <div className="body">
          {props.record.slice(-9).map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>

      {/* wire */}
      <div className="bcg-wire">
        <div className="bcg-label">THE WIRE {props.chatOpen ? '— LIVE' : '[ENTER]'}</div>
        <div className="body">
          {props.chat.slice(-8).map((c, i) => (
            <div key={c.n || i}><span style={{ color: '#55c1ff', fontWeight: 700 }}>{c.who ? `${c.who}: ` : ''}</span>{c.s}</div>
          ))}
        </div>
        {props.chatOpen ? (
          <input
            ref={props.chatInputRef}
            value={props.chatDraft}
            onChange={e => props.setChatDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); props.onSendChat(); }
              if (e.key === 'Escape') { props.setChatDraft(''); props.setChatOpen(false); (e.target as HTMLInputElement).blur(); }
            }}
            placeholder="talk your book…"
            maxLength={140}
            autoFocus
          />
        ) : (
          <div style={{ fontSize: 10.5, color: '#456', letterSpacing: 1.5 }}>press ENTER to talk your book</div>
        )}
      </div>

      {/* stats */}
      <div className="bcg-stats">
        <div className="bcg-chip">
          <div className="k">COMPOSURE</div>
          <div className="bcg-hpwrap"><i style={{ width: `${hud.hp}%`, background: hud.hp > 40 ? '#7fe08d' : '#ff6b5e' }} /></div>
          <div className="v" style={{ fontSize: 18 }}>{Math.round(hud.hp)}</div>
        </div>
        <div className="bcg-chip money"><div className="k">MONEY</div><div className="v">${hud.money}</div></div>
        <div className="bcg-chip intel"><div className="k">INTEL</div><div className="v">{hud.intel}🛈</div></div>
        <div className="bcg-chip cor">
          <div className="k">CORTISOL {hud.cor >= 6 ? '· RAID AT 8' : ''}</div>
          <div className="v" style={{ animation: hud.cor >= 6 ? 'bcgBlink 1s infinite' : undefined }}>{hud.cor}🔥</div>
        </div>
        <div className="bcg-chip wpn">
          <div className="k">{wdef?.name || '—'} {hud.reloading ? '· RELOADING' : ''}</div>
          <div className="v">{hud.mag} / {hud.ammo}{hud.oil > 0 ? ` · 🛢️${hud.oil}` : ''}</div>
        </div>
      </div>
      <style>{`@keyframes bcgBlink { 50% { opacity: 0.35; } }`}</style>

      {/* crosshair */}
      {!hud.dead && (
        <>
          <div className="bcg-xh" />
          <div className="bcg-xh-ring" style={{ width: crossSpread, height: crossSpread }} />
        </>
      )}

      {/* seize prompt */}
      {props.seize && !hud.dead && (
        <div className={`bcg-seize ${props.seize.hostile ? 'hostile' : ''}`}>
          <div className="nm">{props.seize.name}</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            {props.seize.hostile
              ? <>HOSTILE TAKEOVER — <span className="cost">${props.seize.cost}</span> · old owner {props.seize.ownerName} pockets list price · +2 Cortisol</>
              : <>SEIZE — <span className="cost">${props.seize.cost}</span> · +1 Cortisol</>}
          </div>
          <div className="bar"><i style={{ width: `${props.seize.progress * 100}%` }} /></div>
          <div style={{ fontSize: 11.5, color: '#9ad', letterSpacing: 1.5, marginTop: 6 }}>
            {props.seize.progress > 0 ? 'SEIZING…' : 'HOLD [E] TO TAKE IT'}
          </div>
          {props.seize.error && <div className="err">{props.seize.error}</div>}
        </div>
      )}

      {/* event banner */}
      {props.eventCard && (
        <div className="bcg-event">
          <div className="head">
            <span>{props.eventCard.icon} {props.eventCard.name}</span>
            <span className="mood" style={{ color: MOOD_COLORS[props.eventCard.mood as keyof typeof MOOD_COLORS] || '#fff' }}>
              {props.eventCard.mood !== 'KEEP' ? props.eventCard.mood : '??'}
            </span>
          </div>
          <div className="body">{props.eventCard.desc}</div>
        </div>
      )}

      {/* drop overlay */}
      {hud.phase === 'drop' && !hud.dead && (
        <div className="bcg-drop">
          <div className="big">✈️ FLY THE JET</div>
          <div style={{ color: '#9ad', letterSpacing: 3, fontSize: 12, marginTop: 6 }}>
            ALTITUDE {hud.altitude}m · WASD TO STEER · CHUTE AUTO-DEPLOYS
          </div>
        </div>
      )}

      {/* dead overlay */}
      {hud.dead && (
        <div style={{ position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
          <div className="bcg-serif" style={{ fontSize: 44, fontWeight: 900, color: '#ff6b5e', letterSpacing: 6 }}>LIQUIDATED</div>
          <div style={{ color: '#9ad', fontSize: 12, letterSpacing: 3, marginTop: 10 }}>SPECTATING — the con goes on without you</div>
        </div>
      )}

      {/* drag-look fallback hint */}
      {!hud.locked && !props.paused && !hud.dead && (
        <div className="bcg-wirehint" style={{ bottom: 200, right: 12, color: '#ffa94d' }}>
          POINTER LOCK OFF — HOLD LMB TO LOOK &amp; FIRE
        </div>
      )}

      {/* pause menu */}
      {props.paused && !hud.dead && (
        <div className="bcg-pause">
          <div className="bcg-panel" style={{ padding: 26, maxWidth: 560 }}>
            <div className="bcg-title" style={{ fontSize: 28, marginBottom: 14 }}>PAUSED (THE CON ISN&apos;T)</div>
            <div className="bcg-keys">
              <div><b>WASD</b> move · <b>SHIFT</b> sprint · <b>SPACE</b> jump · <b>LMB</b> fire · <b>RMB</b> aim</div>
              <div><b>E</b> hold to seize exhibit · <b>R</b> reload · <b>1–6</b>/wheel weapons · <b>G</b> crude oil bomb</div>
              <div><b>F</b> favor (1 Intel, +40 HP) · <b>V</b> leak dirt (2 Intel, +2🔥 nearest rival)</div>
              <div><b>C</b> spy on deck (2 Intel) · <b>B</b> plant bug in rival exhibit · <b>K</b> Qantas redeploy · <b>J</b> JTPortal deny</div>
              <div><b>ENTER</b> talk your book · income settles every quarter — check THE RECORD</div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="bcg-btn primary" style={{ flex: 1 }} onClick={props.onResume}>RESUME THE CON</button>
              <button className="bcg-btn" onClick={props.onToggleMute}>{props.muted ? '🔇 UNMUTE' : '🔊 MUTE'}</button>
              <button className="bcg-btn" style={{ borderColor: '#d92b1f', color: '#ff6b5e' }} onClick={props.onLeave}>LEAVE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EndModal(props: { snap: Snapshot; myIdx: number; onAgain: () => void; onLeave: () => void }) {
  const { snap } = props;
  const winner = snap.winner;
  const winName = winner !== null && winner >= 0 ? snap.players[winner]?.name : 'NOBODY';
  const isMe = winner === props.myIdx;
  const charImg = winner !== null && winner >= 0 ? `/characters/${snap.players[winner]?.char || 'markwatson'}.png` : '/logo.png';
  return (
    <div className="bcg-endwrap">
      <div className="bcg-panel bcg-endcard">
        <div className="head">🏆 THE BIG CON PAYS OUT</div>
        <div className="body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, justifyContent: 'center' }}>
            <img src={charImg} alt="winner" style={{ width: 84, height: 84, objectFit: 'cover', border: '2px solid #168388' }} />
            <div>
              <div className="bcg-serif" style={{ fontSize: 30, fontWeight: 900, color: isMe ? '#f5c542' : '#fff' }}>{winName}</div>
              <div style={{ color: '#9ad', fontSize: 11, letterSpacing: 2, marginTop: 2 }}>{isMe ? 'YOU PULLED OFF THE CON' : 'WALKS AWAY WITH IT'}</div>
            </div>
          </div>
          <div className="msg">{snap.winMsg}</div>
          <table className="bcg-score">
            <thead>
              <tr><th>PLAYER</th><th>MONEY</th><th>INTEL</th><th>HEAT</th><th>EXHIBITS</th><th>LIQUIDATIONS</th></tr>
            </thead>
            <tbody>
              {snap.players.map((p, i) => {
                const types = new Set(p.nodes.map(n => NODES.find(nn => nn.id === n)?.type).filter(Boolean));
                return (
                  <tr key={i} className={i === winner ? 'win' : ''}>
                    <td>
                      <span style={{ color: p.color, fontWeight: 800 }}>{p.name}</span>
                      {p.dead && <span style={{ color: '#ff6b5e', fontSize: 10, marginLeft: 6 }}>LIQUIDATED</span>}
                      <span style={{ color: '#8a7a5f', fontSize: 10, marginLeft: 8 }}>{types.size}/7 types</span>
                    </td>
                    <td className="money">${p.money}</td>
                    <td>{p.intel}</td>
                    <td>{p.cor}🔥</td>
                    <td>{p.nodes.length}</td>
                    <td>{p.kills}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
            <button className="bcg-btn primary" style={{ flex: 1 }} onClick={props.onAgain}>🔁 RUN IT BACK</button>
            <button className="bcg-btn" onClick={props.onLeave}>LEAVE THE TABLE</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* helpers */
function sanitizeName(s: string): string {
  return s.replace(/[^\w \-'.]/g, '').trim().slice(0, 16);
}

function diffRecord(prev: string[], incoming: string[]): string[] {
  if (!prev.length) return incoming.slice(-12);
  const last = prev[prev.length - 1];
  const idx = incoming.lastIndexOf(last);
  if (idx === -1) return [...prev, ...incoming.slice(-8)].slice(-60);
  return incoming.slice(idx + 1);
}
