// app/live/page.tsx

"use client"

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaMapMarkerAlt, FaClock } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
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
}

export default function LiveBoardPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = io();
    socketRef.current = s;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('data-updated', (data) => {
      if (data?.matches && Array.isArray(data.matches)) setMatches(data.matches);
    });
    return () => { s.disconnect(); };
  }, []);

  // Clock — set only on the client to avoid SSR hydration mismatches
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Group non-finished matches by their court. Courts with everything finished
  // (or no matches at all) simply don't appear — nothing left to watch there.
  const courtGroups = useMemo(() => {
    const map = new Map<string, Match[]>();
    matches.forEach(m => {
      if (m.isFinished) return;
      const list = map.get(m.court) || [];
      list.push(m);
      map.set(m.court, list);
    });
    return Array.from(map.entries())
      .map(([court, ms]) => ({ court, matches: ms }))
      .sort((a, b) => {
        const na = Number(a.court);
        const nb = Number(b.court);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return a.court.localeCompare(b.court);
      });
  }, [matches]);

  const totalLiveMatches = useMemo(() => matches.filter(m => !m.isFinished).length, [matches]);

  return (
    <main className="min-h-screen bg-[#05070d] text-white font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-amber-500/15 border border-amber-500/30 rounded-2xl">
              <GiShuttlecock className="text-amber-400 text-2xl" />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none">Live Board</h1>
              <p className="text-amber-400/80 font-bold text-[10px] uppercase tracking-[3px] mt-1.5">สนามที่กำลังแข่งขัน</p>
            </div>
            <span className={`ml-1 w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-red-500 shadow-[0_0_6px_#ef4444]'}`} />
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse" />
              <span className="text-sm font-bold text-slate-400">
                <span className="text-amber-400 font-black text-lg">{courtGroups.length}</span> สนาม ·{' '}
                <span className="text-amber-400 font-black text-lg">{totalLiveMatches}</span> คู่ Live
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-slate-500 font-bold text-sm tabular-nums">
              <FaClock size={12} />
              {now ? now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}
            </div>
            <Link href="/admin" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              ← Admin
            </Link>
            <Link href="/matches" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              Control Board →
            </Link>
          </div>
        </header>

        {/* Court grid */}
        {courtGroups.length === 0 ? (
          <div className="h-[420px] flex flex-col items-center justify-center text-slate-700 bg-white/[0.02] rounded-3xl border border-white/10">
            <GiShuttlecock size={64} className="mb-4 opacity-30" />
            <p className="font-bold uppercase tracking-widest text-sm text-slate-600">ยังไม่มีสนามที่กำลังแข่งขัน</p>
            <p className="text-[11px] text-slate-700 mt-1">รอตารางแข่งขันหรือคู่แข่งขันถัดไป</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            <AnimatePresence mode="popLayout">
              {courtGroups.map(group => {
                const [current, ...queued] = group.matches;
                const { setsA, setsB } = calculateEffectiveSets(current);

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
                      <p className="text-[9px] font-black uppercase tracking-widest text-blue-400/80 mb-3">
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

                    {/* Queue for this court */}
                    {queued.length > 0 && (
                      <div className="px-5 py-3 border-t border-white/5 bg-black/20">
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-600 mb-2">คิวถัดไป ({queued.length})</p>
                        <div className="space-y-1.5">
                          {queued.map(m => (
                            <div key={m.id} className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                              <span className="truncate">{m.teamA.university} <span className="text-slate-700">vs</span> {m.teamB.university}</span>
                              <span className="text-slate-700 shrink-0 ml-2">รุ่น {m.category} · สาย {m.group}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #05070d; }
        h1, h3, .font-black { font-family: 'Orbitron', sans-serif; }
      `}</style>
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
