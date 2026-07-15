// app/live/page.tsx

"use client"

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaMapMarkerAlt, FaClock } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { calculateEffectiveSets } from '../../lib/scoring';

interface Player { id: string; name: string; role: 'starter' | 'substitute'; }
interface Team { university: string; category: string; group: string; players: Player[]; }
interface Score { s1a: number; s1b: number; s2a: number; s2b: number; }
interface Match {
  id: string;
  category: string;
  group: string;
  court: string;
  teamA: Team;
  teamB: Team;
  score: Score;
  isFinished: boolean;
  // Walkover / bye tag — carried through so scoring stays consistent everywhere,
  // even though a match with isBye is also isFinished and so won't normally
  // appear as the "current" match on this board.
  isBye?: boolean;
  byeWinner?: 'a' | 'b' | null;
  // ลำดับคิวภายในสนามนี้ ตามที่หน้า Admin จัดไว้ด้วย scheduleAvoidingBackToBack
  // (ให้แต่ละทีมได้พักระหว่างคู่มากที่สุด) — ใช้ sort คิวในหน้านี้แทนการพึ่งลำดับ
  // array ที่ได้รับผ่าน socket ตรงๆ ซึ่งอาจถูกต่อท้ายผิดลำดับตอน merge event
  // "match-updated"/"matches-updated" เข้ามาทีหลัง แมตช์เก่าที่ยังไม่มีค่านี้
  // (สร้างก่อนมีการเปลี่ยนแปลงนี้) จะ fallback เป็น 0 ในตอนคำนวณ
  order?: number;
}

// รวม array ของแมตช์ที่อัปเดตเข้ากับ state เดิม โดยแทนที่เฉพาะรายการที่ id ตรงกัน
// แมตช์อื่นที่ไม่เกี่ยวข้องคง reference เดิมไว้ — ใช้กับทั้ง "match-updated" (แมตช์
// เดียว) และ "matches-updated" (หลายแมตช์พร้อมกัน เช่นแก้สนามทั้งรุ่น/สาย)
const mergeMatchUpdates = (prev: Match[], updates: Match[]): Match[] => {
  if (updates.length === 0) return prev;
  const map = new Map(prev.map(m => [m.id, m]));
  updates.forEach(m => {
    if (m && m.id) map.set(m.id, m);
  });
  return Array.from(map.values());
};

// ทุกกี่วินาทีให้ dynamic mode หมุนไปคิวถัดไปทีละคู่ (ต่อสนาม)
const DYNAMIC_ROTATE_MS = 4000;

type DisplayMode = 'static' | 'dynamic';

export default function LiveBoardPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // static = แสดงคิวทั้งหมดพร้อมกัน, dynamic = หมุนแสดงทีละคู่ต่อสนาม วนตามลำดับ
  const [displayMode, setDisplayMode] = useState<DisplayMode>('dynamic');
  // ตัวนับรอบสำหรับ dynamic mode — เพิ่มค่าเรื่อยๆ ทุก DYNAMIC_ROTATE_MS แล้วแต่ละ
  // สนามใช้ tick % queued.length ของตัวเองในการเลือกว่าจะโชว์คิวลำดับไหน จึงวนครบ
  // รอบตามจำนวนคิวจริงของสนามนั้นๆ โดยไม่ต้องมี state แยกรายสนาม
  const [dynamicTick, setDynamicTick] = useState(0);

  useEffect(() => {
    const s = io();
    socketRef.current = s;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    // ทั้งชุด — ตอนเชื่อมต่อครั้งแรก และตอน import Excel / ล้างข้อมูลทั้งหมด
    s.on('data-updated', (data) => {
      if (data?.matches && Array.isArray(data.matches)) setMatches(data.matches);
    });

    // คะแนน/สถานะของแมตช์เดียวเปลี่ยน (เกิดถี่ที่สุด) — merge เฉพาะแมตช์นั้น
    s.on('match-updated', (updatedMatch: Match) => {
      if (!updatedMatch?.id) return;
      setMatches(prev => mergeMatchUpdates(prev, [updatedMatch]));
    });

    // แก้สนามทั้งรุ่น/สาย หรือแก้ชื่อนักกีฬาที่กระทบหลายแมตช์พร้อมกัน
    s.on('matches-updated', (updatedMatches: Match[]) => {
      if (!Array.isArray(updatedMatches) || updatedMatches.length === 0) return;
      setMatches(prev => mergeMatchUpdates(prev, updatedMatches));
    });

    return () => { s.disconnect(); };
  }, []);

  // Clock — set only on the client to avoid SSR hydration mismatches
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Rotator สำหรับ dynamic mode — ทำงานเฉพาะตอนเลือกโหมดนี้เท่านั้น เพื่อไม่ให้
  // re-render โดยไม่จำเป็นตอนอยู่ static mode
  useEffect(() => {
    if (displayMode !== 'dynamic') return;
    const t = setInterval(() => setDynamicTick(tick => tick + 1), DYNAMIC_ROTATE_MS);
    return () => clearInterval(t);
  }, [displayMode]);

  // Group non-finished matches by their court, then sort each court's list by the
  // `order` field the Admin page attaches when it builds the rest-friendly
  // schedule (scheduleAvoidingBackToBack). Without this, "current" (matches[0]
  // per court) and the queue below it just reflected whatever order the matches
  // happened to sit in the `matches` state array — which drifts from the intended
  // schedule as soon as a match-updated/matches-updated event appends a
  // previously-unseen match to the end instead of inserting it at its real queue
  // position. That's what caused same-institution matches to line up back-to-back
  // here even though Admin had spaced them out. Matches created before this field
  // existed fall back to order 0, so they keep behaving as before (stable sort).
  //
  // Courts with everything finished (or no matches at all) simply don't appear —
  // nothing left to watch there.
  const courtGroups = useMemo(() => {
    const map = new Map<string, Match[]>();
    matches.forEach(m => {
      if (m.isFinished) return;
      const list = map.get(m.court) || [];
      list.push(m);
      map.set(m.court, list);
    });
    return Array.from(map.entries())
      .map(([court, ms]) => ({
        court,
        matches: [...ms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      }))
      .sort((a, b) => {
        const na = Number(a.court);
        const nb = Number(b.court);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return a.court.localeCompare(b.court);
      });
  }, [matches]);

  const totalLiveMatches = useMemo(() => matches.filter(m => !m.isFinished).length, [matches]);

  return (
    <main className="min-h-screen bg-[#05070d] text-white font-sans p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header className="bg-white/[0.03] backdrop-blur-xl p-4 sm:p-6 rounded-3xl border border-white/10 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">

          {/* Logo row. On mobile the live-count badge rides along on the right of this
              same row (so it's visible without any scrolling); on desktop it moves into
              the right-hand cluster instead, see below. */}
          <div className="flex items-center justify-between w-full lg:w-auto gap-3">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div className="relative w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-2xl overflow-hidden shrink-0 shadow-lg border border-white">
                <Image 
                  src="/5gearlogo.jpg" 
                  alt="5 Gear Logo" 
                  fill 
                  /* 2. object-cover จะทำให้รูปขยายเต็มกรอบพอดี ถ้าสัดส่วนไม่พอดีมันจะตัดขอบเล็กน้อยแต่ไม่เหลือที่ว่าง */
                  className="object-cover" 
                  priority
                  sizes="(max-width: 640px) 48px, 56px"
                />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight leading-none truncate">Live Board</h1>
                <p className="text-amber-400/80 font-bold text-[9px] sm:text-[10px] uppercase tracking-[3px] mt-1.5 truncate">สนามที่กำลังแข่งขัน</p>
              </div>
              <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-red-500 shadow-[0_0_6px_#ef4444]'}`} />
            </div>

            <div className="flex lg:hidden items-center gap-1.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse" />
              <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">
                <span className="text-amber-400 font-black">{courtGroups.length}</span> สนาม ·{' '}
                <span className="text-amber-400 font-black">{totalLiveMatches}</span> Live
              </span>
            </div>
          </div>

          {/* Right-hand cluster: display-mode toggle, live count (desktop only, mobile
              shows it above instead), clock, and nav links. Nav links scroll
              horizontally on narrow screens instead of wrapping or overflowing. */}
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-6 w-full lg:w-auto min-w-0">

            {/* Static / Dynamic toggle — controls how the queue section of every
                court card renders (see courtGroups.map below) */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 shrink-0">
              <button
                type="button"
                onClick={() => setDisplayMode('static')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                  displayMode === 'static'
                    ? 'bg-amber-400 text-black shadow'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Static
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('dynamic')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                  displayMode === 'dynamic'
                    ? 'bg-amber-400 text-black shadow'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Dynamic
              </button>
            </div>

            <div className="hidden lg:flex items-center gap-2 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse" />
              <span className="text-sm font-bold text-slate-400">
                <span className="text-amber-400 font-black text-lg">{courtGroups.length}</span> สนาม ·{' '}
                <span className="text-amber-400 font-black text-lg">{totalLiveMatches}</span> คู่ Live
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-slate-500 font-bold text-sm tabular-nums shrink-0">
              <FaClock size={12} />
              {now ? now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide w-full lg:w-auto">
              <Link href="/" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
                Leaderboard
              </Link>
              <Link href="/live-score" className="shrink-0 px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-300 whitespace-nowrap">
                Live Score
              </Link>
            </div>
          </div>
        </header>

        {/* Court grid — fluid auto-fit columns instead of a fixed 1/2/3-column breakpoint
            cap, so cards stretch to fill the full width available at any screen size
            (a wide monitor can show more than 3 across, a tablet gets exactly what fits). */}
        {courtGroups.length === 0 ? (
          <div className="h-[420px] flex flex-col items-center justify-center text-slate-700 bg-white/[0.02] rounded-3xl border border-white/10">
            <GiShuttlecock size={64} className="mb-4 opacity-30" />
            <p className="font-bold uppercase tracking-widest text-sm text-slate-600">ยังไม่มีสนามที่กำลังแข่งขัน</p>
            <p className="text-[11px] text-slate-700 mt-1">รอตารางแข่งขันหรือคู่แข่งขันถัดไป</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4 sm:gap-5">
            <AnimatePresence mode="popLayout">
              {courtGroups.map(group => {
                const [current, ...queued] = group.matches;
                const { setsA, setsB } = calculateEffectiveSets(current);

                // Dynamic mode: pick a single queued match to show, rotating through
                // the court's own queue length so each court cycles through all of
                // its upcoming matches independently even though the tick is shared.
                const dynamicIndex = queued.length > 0 ? dynamicTick % queued.length : 0;
                const dynamicMatch = queued.length > 0 ? queued[dynamicIndex] : null;

                return (
                  <motion.div
                    key={group.court}
                    layout
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    className="bg-white/[0.03] rounded-3xl border border-amber-500/20 shadow-xl overflow-hidden"
                  >
                    {/* Court header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                      <div className="flex items-center gap-3">
                        <span className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-black text-lg flex items-center justify-center tabular-nums">
                          {group.court}
                        </span>
                        <div className="leading-tight">
                          <p className="text-[8px] font-black uppercase tracking-[2px] text-slate-600 flex items-center gap-1">
                            <FaMapMarkerAlt size={8} /> Court
                          </p>
                          <p className="text-xs font-bold text-slate-400">สนามที่ {group.court}</p>
                        </div>
                      </div>
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-400/10 border border-amber-400/30 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Live</span>
                      </span>
                    </div>

                    {/* Current match */}
                    <div className="px-5 py-5">
                      {/* รุ่น/สาย ของคู่ปัจจุบัน — ขยายขนาด font ให้เด่นชัดขึ้น */}
                      <p className="text-base sm:text-lg font-black uppercase tracking-wide text-blue-400/90 mb-4">
                        รุ่น {current.category} · สาย {current.group}
                      </p>

                      <div className="flex items-center justify-between gap-3">
                        <TeamBlock team={current.teamA} align="right" color="text-blue-400" />

                        <div className="shrink-0 bg-black/40 border border-white/10 rounded-2xl px-4 py-2 flex flex-col items-center">
                          <div className="flex items-center gap-2 text-3xl font-black tabular-nums leading-none">
                            <span className={setsA >= setsB ? 'text-blue-400' : 'text-slate-600'}>{setsA}</span>
                            <span className="text-slate-700 text-lg">–</span>
                            <span className={setsB >= setsA ? 'text-red-400' : 'text-slate-600'}>{setsB}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold tabular-nums text-slate-600">
                            <span>{current.score.s1a}-{current.score.s1b}</span>
                            <span className="w-px h-2.5 bg-white/10" />
                            <span>{current.score.s2a}-{current.score.s2b}</span>
                          </div>
                        </div>

                        <TeamBlock team={current.teamB} align="left" color="text-red-400" />
                      </div>
                    </div>

                    {/* Queue for this court — layout depends on displayMode.
                        static: full list, each row numbered 1..n.
                        dynamic: one row at a time, crossfading every DYNAMIC_ROTATE_MS,
                        with a "ลำดับที่ X จาก Y" badge showing its real queue position. */}
                    {queued.length > 0 && (
                      <div className="px-5 py-4 border-t border-white/5 bg-black/20">
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-600 mb-2.5">
                          คิวถัดไป ({queued.length})
                        </p>

                        {displayMode === 'static' ? (
                          <div className="space-y-2">
                            {queued.map((m, i) => (
                              <div key={m.id} className="flex items-center gap-2.5">
                                <span className="shrink-0 w-5 h-5 rounded-full bg-white/5 border border-white/10 text-amber-400 text-[10px] font-black flex items-center justify-center tabular-nums">
                                  {i + 1}
                                </span>
                                <span className="truncate text-xs sm:text-sm font-bold text-slate-400">
                                  {m.teamA.university} <span className="text-slate-700">vs</span> {m.teamB.university}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <AnimatePresence mode="wait">
                            {dynamicMatch && (
                              <motion.div
                                key={dynamicMatch.id}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.3 }}
                                className="flex items-center gap-3"
                              >
                                <span className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-400 text-[10px] font-black tabular-nums whitespace-nowrap">
                                  ลำดับที่ {dynamicIndex + 1}/{queued.length}
                                </span>
                                <span className="truncate text-sm sm:text-base font-bold text-slate-300">
                                  {dynamicMatch.teamA.university} <span className="text-slate-600">vs</span> {dynamicMatch.teamB.university}
                                </span>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #05070d; }
        h1, h3, .font-black { font-family: 'Orbitron', sans-serif; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style> */}
    </main>
  );
}

// Read-only team display: university code + starters (bold) + ALL substitutes (dim,
// labeled) — matches the same "show every substitute" behavior as the Matches page,
// instead of silently dropping every substitute after the first one. Names wrap onto
// extra lines instead of being clipped, so the full name is always visible to
// spectators — no inputs here, this page is for spectators, not editing.
function TeamBlock({ team, align, color }: { team: Team; align: 'left' | 'right'; color: string }) {
  const starters = team.players.filter(p => p.role === 'starter');
  const substitutes = team.players.filter(p => p.role === 'substitute');
  const alignItems = align === 'right' ? 'items-end text-right' : 'items-start text-left';

  return (
    <div className={`flex-1 min-w-0 flex flex-col ${alignItems}`}>
      <h3 className={`text-2xl sm:text-3xl font-black uppercase tracking-tight leading-none truncate max-w-full ${color}`}>
        {team.university}
      </h3>
      {starters.length > 0 && (
        <p className="mt-1 text-[10px] font-bold text-slate-400 leading-snug break-words max-w-[10rem]">
          {starters.map(p => p.name).join(' · ')}
        </p>
      )}
      {substitutes.length > 0 && (
        <p className="mt-0.5 text-[9px] italic text-slate-600 leading-snug break-words max-w-[10rem]">
          สำรอง: {substitutes.map(p => p.name).join(' · ')}
        </p>
      )}
    </div>
  );
}
