// Suggested location: app/court-status/page.tsx
// วัตถุประสงค์: หน้าเครื่องมือสำหรับแอดมิน/ผู้ประกาศ (ไม่ใช่สำหรับผู้ชม)
// ต่อสนามจะโชว์ 4 ส่วน: เพิ่งจบ -> คู่ที่กำลังแข่งอยู่ตอนนี้ (พร้อมสกอร์สด) -> คิวที่ต้องประกาศตอนนี้ (ถ้ายังไม่เริ่ม) -> คิวถัดไปอีก

"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaBullhorn, FaCheckCircle, FaFilter, FaCircle } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { getMatchWinner, isNoResult } from '../../lib/scoring';

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

interface CourtInfo {
  court: string;
  lastFinished: Match | null;
  current: Match | null;   // คู่แรกที่ยังไม่จบของสนามนี้ (อาจกำลังแข่งอยู่ หรือรอประกาศ)
  currentInProgress: boolean; // current มีสกอร์เริ่มเข้ามาแล้วหรือยัง (กำลังแข่งจริง)
  next: Match | null;      // คิวถัดจาก current อีกหนึ่งคู่ (ดูล่วงหน้า)
  moreCount: number;       // จำนวนคิวที่เหลือถัดจาก next
}

const EXHIBITION_CATEGORIES = ['คู่กิตติมศักดิ์'];

// เช็คว่าแมตช์เริ่มมีสกอร์เข้ามาแล้วหรือยัง (ใช้แยกระหว่าง "กำลังแข่งอยู่" กับ "ยังไม่เริ่ม/รอประกาศ")
function hasScoreStarted(score: Score): boolean {
  return score.s1a > 0 || score.s1b > 0 || score.s2a > 0 || score.s2b > 0;
}

export default function CourtStatusPage() {
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

  const categories = useMemo(() => {
    const set = new Set(matches.map(m => m.category));
    return Array.from(set).sort();
  }, [matches]);

  const filteredMatches = useMemo(() => {
    if (selectedCategory === 'ALL') return matches;
    return matches.filter(m => m.category === selectedCategory);
  }, [matches, selectedCategory]);

  // จัดกลุ่มตามสนาม โดยรักษาลำดับเดิมของข้อมูล (ถือว่าเป็นลำดับตารางแข่งของสนามนั้นตาม matches array)
  const courtInfos: CourtInfo[] = useMemo(() => {
    const map = new Map<string, Match[]>();
    filteredMatches.forEach(m => {
      const list = map.get(m.court) || [];
      list.push(m);
      map.set(m.court, list);
    });

    const infos = Array.from(map.entries()).map(([court, ms]) => {
      // ms รักษาลำดับตามที่พบใน matches array (ลำดับตารางแข่งของสนามนี้) อยู่แล้ว เพราะ push ตามลำดับเดิม
      const finished = ms.filter(m => m.isFinished);
      const pending = ms.filter(m => !m.isFinished);
      const current = pending[0] || null;
      return {
        court,
        lastFinished: finished.length > 0 ? finished[finished.length - 1] : null,
        current,
        currentInProgress: current ? hasScoreStarted(current.score) : false,
        next: pending[1] || null,
        moreCount: Math.max(0, pending.length - 2),
      };
    });

    return infos
      .filter(info => info.lastFinished || info.current || info.next) // ตัดสนามที่ไม่มีข้อมูลเลยทิ้ง
      .sort((a, b) => {
        const na = Number(a.court);
        const nb = Number(b.court);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return a.court.localeCompare(b.court);
      });
  }, [filteredMatches]);

  const readyToAnnounceCount = useMemo(
    () => courtInfos.filter(c => c.current && !c.currentInProgress).length,
    [courtInfos]
  );

  const inProgressCount = useMemo(
    () => courtInfos.filter(c => c.currentInProgress).length,
    [courtInfos]
  );

  return (
    <main className="min-h-screen bg-[#05070d] text-white font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-violet-500/15 border border-violet-500/30 rounded-2xl">
              <FaBullhorn className="text-violet-400 text-xl" />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none">Court Status</h1>
              <p className="text-violet-400/80 font-bold text-[10px] uppercase tracking-[3px] mt-1.5">สำหรับแอดมิน/ผู้ประกาศ · เตรียมประกาศชื่อผู้เล่น</p>
            </div>
            <span className={`ml-1 w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-red-500 shadow-[0_0_6px_#ef4444]'}`} />
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[11px] font-bold text-slate-400">
              <span className="text-red-400 font-black text-base">{inProgressCount}</span> สนามกำลังแข่ง
            </span>
            <span className="text-[11px] font-bold text-slate-400">
              <span className="text-violet-400 font-black text-base">{readyToAnnounceCount}</span> สนามพร้อมประกาศ
            </span>
            <Link href="/live" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              Live Board
            </Link>
            <Link href="/admin" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              Admin →
            </Link>
          </div>
        </header>

        {/* Category filter */}
        <div className="flex flex-wrap items-center gap-2 bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3">
          <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 mr-2">
            <FaFilter size={10} /> รุ่น
          </span>
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all ${
              selectedCategory === 'ALL'
                ? 'bg-violet-500 text-black shadow-[0_0_15px_rgba(139,92,246,0.4)]'
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
                  ? 'bg-violet-500 text-black shadow-[0_0_15px_rgba(139,92,246,0.4)]'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Court cards */}
        {courtInfos.length === 0 ? (
          <div className="h-[420px] flex flex-col items-center justify-center text-slate-700 bg-white/[0.02] rounded-3xl border border-white/10">
            <GiShuttlecock size={64} className="mb-4 opacity-30" />
            <p className="font-bold uppercase tracking-widest text-sm text-slate-600">ยังไม่มีข้อมูลสนาม</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <AnimatePresence mode="popLayout">
              {courtInfos.map(info => (
                <motion.div
                  key={info.court}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className={`rounded-3xl border shadow-xl overflow-hidden ${
                    info.currentInProgress
                      ? 'bg-red-500/[0.06] border-red-500/30'
                      : info.current
                      ? 'bg-violet-500/[0.06] border-violet-500/30'
                      : 'bg-white/[0.03] border-white/10'
                  }`}
                >
                  {/* Court header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <span className={`w-11 h-11 rounded-2xl border font-black text-lg flex items-center justify-center tabular-nums ${
                        info.currentInProgress
                          ? 'bg-red-500/10 border-red-500/30 text-red-400'
                          : 'bg-violet-500/10 border-violet-500/30 text-violet-400'
                      }`}>
                        {info.court}
                      </span>
                      <p className="text-xs font-bold text-slate-400">สนามที่ {info.court}</p>
                    </div>
                    {info.currentInProgress ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/30 rounded-full">
                        <FaCircle size={7} className="text-red-500 animate-pulse" />
                        <span className="text-[9px] font-black text-red-400 uppercase tracking-widest">กำลังแข่งขัน</span>
                      </span>
                    ) : info.current ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-violet-400/10 border border-violet-400/30 rounded-full">
                        <FaBullhorn size={9} className="text-violet-400" />
                        <span className="text-[9px] font-black text-violet-400 uppercase tracking-widest">ประกาศ</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-slate-700/20 border border-slate-600/30 rounded-full text-[9px] font-black text-slate-500 uppercase tracking-widest">
                        แข่งครบแล้ว
                      </span>
                    )}
                  </div>

                  {/* เพิ่งจบ */}
                  {info.lastFinished && (
                    <div className="px-5 py-3 border-b border-white/5 bg-black/20">
                      <p className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-emerald-500/70 mb-1.5">
                        <FaCheckCircle size={8} /> เพิ่งจบ · รุ่น {info.lastFinished.category} · สาย {info.lastFinished.group}
                      </p>
                      <FinishedSummary match={info.lastFinished} />
                    </div>
                  )}

                  {/* คู่ที่กำลังแข่ง / คู่ที่ต้องประกาศ */}
                  {info.current ? (
                    <div className="px-5 py-5">
                      <div className="flex items-center justify-between mb-3">
                        <p className={`text-[9px] font-black uppercase tracking-widest ${info.currentInProgress ? 'text-red-400' : 'text-violet-400'}`}>
                          รุ่น {info.current.category} · สาย {info.current.group} · สนาม {info.current.court}
                        </p>
                        {info.currentInProgress && <LiveScorePill score={info.current.score} />}
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <AnnounceBlock team={info.current.teamA} align="right" color="text-blue-400" />
                        <span className="shrink-0 text-slate-700 font-black text-lg pt-1">VS</span>
                        <AnnounceBlock team={info.current.teamB} align="left" color="text-red-400" />
                      </div>
                    </div>
                  ) : (
                    <div className="px-5 py-6 text-center">
                      <p className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">ไม่มีคิวเหลือสำหรับสนามนี้</p>
                    </div>
                  )}

                  {/* คิวถัดไปอีก (ดูล่วงหน้า) */}
                  {info.next && (
                    <div className="px-5 py-3 border-t border-white/5">
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-600 mb-1.5">
                        คิวถัดไป{info.moreCount > 0 && <span> (และอีก {info.moreCount} คิว)</span>}
                      </p>
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                        <span className="truncate">{info.next.teamA.university} <span className="text-slate-700">vs</span> {info.next.teamB.university}</span>
                        <span className="text-slate-700 shrink-0 ml-2">รุ่น {info.next.category} · สาย {info.next.group}</span>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #05070d; }
        h1, .font-black { font-family: 'Orbitron', sans-serif; }
      `}</style>
    </main>
  );
}

// LiveScorePill: สกอร์สดของคู่ที่กำลังแข่งอยู่ (Set 1 / Set 2)
function LiveScorePill({ score }: { score: Score }) {
  return (
    <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1">
      <span className="text-[9px] font-black text-red-400/70 uppercase tracking-widest">Live</span>
      <span className="text-[11px] font-black text-red-300 tabular-nums">
        {score.s1a}-{score.s1b} · {score.s2a}-{score.s2b}
      </span>
    </div>
  );
}

// AnnounceBlock: ชื่อผู้เล่นตัวใหญ่ อ่านง่ายสำหรับประกาศสด — ตัวจริงตัวหนา, ตัวสำรองแสดงครบพร้อม label
function AnnounceBlock({ team, align, color }: { team: Team; align: 'left' | 'right'; color: string }) {
  const starters = team.players?.filter(p => p.role === 'starter') ?? [];
  const substitutes = team.players?.filter(p => p.role === 'substitute') ?? [];
  const alignItems = align === 'right' ? 'items-end text-right' : 'items-start text-left';

  return (
    <div className={`flex-1 min-w-0 flex flex-col ${alignItems}`}>
      <h3 className={`text-xl sm:text-2xl font-black uppercase tracking-tight leading-none truncate max-w-full ${color}`}>
        {team.university}
      </h3>
      {starters.length > 0 && (
        <p className="mt-1.5 text-sm font-bold text-white leading-snug break-words max-w-[14rem]">
          {starters.map(p => p.name).join(' · ')}
        </p>
      )}
      {substitutes.length > 0 && (
        <p className="mt-1 text-[10px] italic text-slate-500 leading-snug break-words max-w-[14rem]">
          สำรอง: {substitutes.map(p => p.name).join(' · ')}
        </p>
      )}
    </div>
  );
}

// FinishedSummary: สรุปผลแมตช์ที่เพิ่งจบแบบย่อ (ทีม vs ทีม, สกอร์เซต, ผู้ชนะ)
function FinishedSummary({ match }: { match: Match }) {
  if (isNoResult(match)) {
    return (
      <p className="text-[11px] font-bold text-slate-500">
        {match.teamA.university} <span className="text-slate-700">vs</span> {match.teamB.university}
        <span className="ml-2 text-slate-600 italic">No Result</span>
      </p>
    );
  }

  const winner = getMatchWinner(match);
  const aWon = winner === 'a';
  const bWon = winner === 'b';

  return (
    <div className="flex items-center justify-between text-[11px] font-bold">
      <span className={aWon ? 'text-emerald-400' : 'text-slate-500'}>
        {match.teamA.university}{aWon && ' ✓'}
      </span>
      <span className="text-slate-600 tabular-nums text-[10px] mx-2">
        {match.score.s1a}-{match.score.s1b} · {match.score.s2a}-{match.score.s2b}
      </span>
      <span className={bWon ? 'text-emerald-400' : 'text-slate-500'}>
        {bWon && '✓ '}{match.teamB.university}
      </span>
    </div>
  );
}
