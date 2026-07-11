// Suggested location: app/live-score/page.tsx

"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaFilter } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { getMatchWinner, isNoResult, calculateEffectiveSets } from '../../lib/scoring';

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
  isBye?: boolean;
  byeWinner?: 'a' | 'b' | null;
}

interface UniStat {
  university: string;
  setsWon: number;
  setsLost: number;
  pointsWon: number;
  pointsConceded: number;
  matchesPlayed: number;
}

const UNIVERSITIES = ['CU', 'KU', 'KKU', 'PSU', 'CMU'];
const EXHIBITION_CATEGORIES = ['คู่กิตติมศักดิ์'];

export default function LiveScorePage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [connected, setConnected] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  useEffect(() => {
    const s: Socket = io();
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('data-updated', (data) => {
      if (data?.matches && Array.isArray(data.matches)) setMatches(data.matches);
    });
    return () => { s.disconnect(); };
  }, []);

  // รุ่นทั้งหมดที่มีในข้อมูล (ไม่รวมคู่กิตติมศักดิ์)
  const categories = useMemo(() => {
    const set = new Set(matches.map(m => m.category).filter(c => !EXHIBITION_CATEGORIES.includes(c)));
    return Array.from(set).sort();
  }, [matches]);

  const scorableMatches = useMemo(
    () => matches.filter(m => !EXHIBITION_CATEGORIES.includes(m.category)),
    [matches]
  );

  const filteredMatches = useMemo(() => {
    if (selectedCategory === 'ALL') return scorableMatches;
    return scorableMatches.filter(m => m.category === selectedCategory);
  }, [scorableMatches, selectedCategory]);

  // สรุปสถิติรายสถาบัน (เฉพาะแมตช์ที่แข่งจบแล้ว และไม่ใช่ No Result) ตามรุ่นที่เลือก
  const uniStats = useMemo(() => {
    const stats: Record<string, UniStat> = {};
    UNIVERSITIES.forEach(u => {
      stats[u] = { university: u, setsWon: 0, setsLost: 0, pointsWon: 0, pointsConceded: 0, matchesPlayed: 0 };
    });

    filteredMatches.forEach(m => {
      if (!m.isFinished || isNoResult(m)) return;

      const s1a = Number(m.score.s1a) || 0;
      const s1b = Number(m.score.s1b) || 0;
      const s2a = Number(m.score.s2a) || 0;
      const s2b = Number(m.score.s2b) || 0;

      const uniA = m.teamA.university;
      const uniB = m.teamB.university;
      if (!stats[uniA]) stats[uniA] = { university: uniA, setsWon: 0, setsLost: 0, pointsWon: 0, pointsConceded: 0, matchesPlayed: 0 };
      if (!stats[uniB]) stats[uniB] = { university: uniB, setsWon: 0, setsLost: 0, pointsWon: 0, pointsConceded: 0, matchesPlayed: 0 };

      stats[uniA].matchesPlayed += 1;
      stats[uniB].matchesPlayed += 1;

      stats[uniA].pointsWon += s1a + s2a;
      stats[uniA].pointsConceded += s1b + s2b;
      stats[uniB].pointsWon += s1b + s2b;
      stats[uniB].pointsConceded += s1a + s2a;

      // เซตที่ 1
      if (s1a > s1b) { stats[uniA].setsWon += 1; stats[uniB].setsLost += 1; }
      else if (s1b > s1a) { stats[uniB].setsWon += 1; stats[uniA].setsLost += 1; }

      // เซตที่ 2
      if (s2a > s2b) { stats[uniA].setsWon += 1; stats[uniB].setsLost += 1; }
      else if (s2b > s2a) { stats[uniB].setsWon += 1; stats[uniA].setsLost += 1; }
    });

    return Object.values(stats).sort((a, b) => {
      if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon;
      return a.pointsConceded - b.pointsConceded;
    });
  }, [filteredMatches]);

  // รายการแมตช์ (ทั้ง live และจบแล้ว) เรียง live ขึ้นก่อน แล้วตามด้วยเลขสนาม
  const matchList = useMemo(() => {
    return [...filteredMatches].sort((a, b) => {
      if (a.isFinished !== b.isFinished) return a.isFinished ? 1 : -1;
      return a.court.localeCompare(b.court, undefined, { numeric: true });
    });
  }, [filteredMatches]);

  return (
    <main className="min-h-screen bg-[#05070d] text-white font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl">
              <GiShuttlecock className="text-emerald-400 text-2xl" />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none">Live Score</h1>
              <p className="text-emerald-400/80 font-bold text-[10px] uppercase tracking-[3px] mt-1.5">สรุปคะแนนแยกตามสถาบันและรุ่น</p>
            </div>
            <span className={`ml-1 w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-red-500 shadow-[0_0_6px_#ef4444]'}`} />
          </div>

          <div className="flex items-center gap-3">
            <Link href="/live" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              ← Live Board
            </Link>
            <Link href="/leaderboard" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              Leaderboard →
            </Link>
          </div>
        </header>

        {/* Category filter buttons */}
        <div className="flex flex-wrap items-center gap-2 bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3">
          <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 mr-2">
            <FaFilter size={10} /> รุ่น
          </span>
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all ${
              selectedCategory === 'ALL'
                ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            ทั้งหมด
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all ${
                selectedCategory === cat
                  ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* University stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <AnimatePresence mode="popLayout">
            {uniStats.map((s, idx) => (
              <motion.div
                key={s.university}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`rounded-2xl border p-4 backdrop-blur-xl ${
                  idx === 0 && s.setsWon > 0
                    ? 'bg-emerald-500/10 border-emerald-400/40 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                    : 'bg-white/[0.03] border-white/10'
                }`}
              >
                <h3 className="text-xl font-black uppercase tracking-tight">{s.university}</h3>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <span>Sets Won</span>
                    <span className="text-emerald-400 text-sm tabular-nums">{s.setsWon}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <span>Sets Lost</span>
                    <span className="text-slate-400 text-sm tabular-nums">{s.setsLost}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <span>Points Won</span>
                    <span className="text-blue-400 text-sm tabular-nums">{s.pointsWon}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <span>Conceded</span>
                    <span className="text-red-400 text-sm tabular-nums">{s.pointsConceded}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Per-match set score breakdown */}
        <div className="bg-white/[0.03] border border-white/10 rounded-3xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">
              รายละเอียดแต้มแต่ละเซต{selectedCategory !== 'ALL' && <span className="text-emerald-400"> · {selectedCategory}</span>}
            </h2>
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">{matchList.length} แมตช์</span>
          </div>

          {matchList.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-700">
              <GiShuttlecock size={40} className="mb-3 opacity-30" />
              <p className="font-bold uppercase tracking-widest text-xs text-slate-600">ไม่มีข้อมูลแมตช์ในรุ่นนี้</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {matchList.map(m => {
                const live = !m.isFinished;
                const eff = live ? calculateEffectiveSets(m) : null;

                return (
                  <div key={m.id} className="px-5 py-3.5 flex items-start gap-4">
                    <div className="w-20 shrink-0 pt-0.5">
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">สนาม {m.court}</p>
                      <p className="text-[9px] font-bold text-slate-500 truncate">{m.category} · {m.group}</p>
                    </div>

                    <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                      <TeamNames team={m.teamA} align="right" color="text-blue-400" />

                      <div className="shrink-0 flex items-center gap-1.5 tabular-nums pt-0.5">
                        <ScorePair a={m.score.s1a} b={m.score.s1b} />
                        <span className="w-px h-3 bg-white/10" />
                        <ScorePair a={m.score.s2a} b={m.score.s2b} />
                      </div>

                      <TeamNames team={m.teamB} align="left" color="text-red-400" />
                    </div>

                    <div className="w-20 shrink-0 text-right pt-0.5">
                      {live ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-400/10 border border-amber-400/30 rounded-full text-[8px] font-black text-amber-400 uppercase tracking-widest">
                            <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" /> Live
                          </span>
                          {eff && (
                            <span className="text-[9px] font-black tabular-nums text-slate-500">
                              Sets {eff.setsA}-{eff.setsB}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">จบแล้ว</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #05070d; }
        h1, h2, h3, .font-black { font-family: 'Orbitron', sans-serif; }
      `}</style>
    </main>
  );
}

// TeamNames: university code + starters (bold) + all substitutes (dim, labeled) —
// same "show every substitute" convention used on the Matches/Live board pages.
function TeamNames({ team, align, color }: { team: Team; align: 'left' | 'right'; color: string }) {
  const starters = team.players?.filter(p => p.role === 'starter') ?? [];
  const substitutes = team.players?.filter(p => p.role === 'substitute') ?? [];
  const alignItems = align === 'right' ? 'items-end text-right' : 'items-start text-left';

  return (
    <div className={`flex-1 min-w-0 flex flex-col ${alignItems}`}>
      <span className={`text-xs font-black uppercase tracking-tight truncate max-w-full ${color}`}>
        {team.university}
      </span>
      {starters.length > 0 && (
        <p className="mt-0.5 text-[9px] font-bold text-slate-400 leading-snug break-words max-w-[9rem]">
          {starters.map(p => p.name).join(' · ')}
        </p>
      )}
      {substitutes.length > 0 && (
        <p className="mt-0.5 text-[8px] italic text-slate-600 leading-snug break-words max-w-[9rem]">
          สำรอง: {substitutes.map(p => p.name).join(' · ')}
        </p>
      )}
    </div>
  );
}

// ScorePair: shows the score of a single set with the winning side highlighted
function ScorePair({ a, b }: { a: number; b: number }) {
  const aWin = a > b;
  const bWin = b > a;
  return (
    <span className="flex items-center gap-0.5 text-[11px] font-black">
      <span className={aWin ? 'text-blue-400' : 'text-slate-600'}>{a}</span>
      <span className="text-slate-700">-</span>
      <span className={bWin ? 'text-red-400' : 'text-slate-600'}>{b}</span>
    </span>
  );
}
