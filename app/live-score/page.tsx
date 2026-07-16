// app/live-score/page.tsx

"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaFilter } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
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

interface H2HEntry {
  category: string;
  group: string;
  sets: [number, number][];
}

interface Standing {
  university: string;
  points: number;        
  matchPoints: number;    
  setsWon: number;
  setsLost: number;
  pointsWon: number;
  pointsConceded: number;
  h2h: Record<string, H2HEntry[]>;
}

interface CategoryGroupOption {
  key: string;
  category: string;
  group: string;
  label: string;
}

const NON_SCORING_CATEGORIES = ['กิตติมศักดิ์'];

const CATEGORY_ORDER = [
  'กิตติมศักดิ์',
  'ทั่วไป',
  '70',
  '80',
  '90',
  '100',
  '110',
  '120',
  '130',
  'หญิงคู่ทั่วไป',
  'อาวุโสหญิง 70+',
];

const categoryOrderIndex = (category: string) => {
  const idx = CATEGORY_ORDER.indexOf(category);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
};

// รวม array ของแมตช์ที่อัปเดตเข้ากับ state เดิม โดย "แทนที่เฉพาะรายการที่ id ตรงกัน"
// ส่วนแมตช์อื่นที่ไม่เกี่ยวข้องจะไม่ถูกแตะต้องเลย (คง reference เดิมไว้ ไม่ re-render
// โดยไม่จำเป็น) ถ้ามี id ใหม่ที่ยังไม่เคยเห็น จะถูกเพิ่มต่อท้าย — กรณีนี้แทบไม่เกิดขึ้น
// เพราะแมตช์ใหม่ทั้งหมดมาจาก import-excel ซึ่งยังคงส่ง "data-updated" (ทั้งชุด) อยู่
const mergeMatchUpdates = (prev: Match[], updates: Match[]): Match[] => {
  if (updates.length === 0) return prev;
  const map = new Map(prev.map(m => [m.id, m]));
  updates.forEach(m => {
    if (m && m.id) map.set(m.id, m);
  });
  return Array.from(map.values());
};

type MatchStatusFilter = 'ALL' | 'LIVE' | 'FINISHED';

export default function LiveScorePage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [connected, setConnected] = useState(false);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<MatchStatusFilter>('ALL');

  // เก็บ timestamp ล่าสุดที่แต่ละแมตช์ถูกอัปเดต (จาก match-updated / matches-updated)
  // ใช้เพื่อจัดเรียงให้แมตช์ที่กรรมการเพิ่งกดคะแนนล่าสุด "ลอย" ขึ้นบนสุดของกลุ่ม Live
  // เหมือน feed ข่าว ส่วนแมตช์ที่ยังไม่เคยมี event เข้ามาเลยจะไม่มี key นี้ (fallback เรียงตามสนาม)
  const [lastUpdatedMap, setLastUpdatedMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const s: Socket = io();
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    // "data-updated" ตอนนี้ยิงเฉพาะตอน: (1) เพิ่งเชื่อมต่อครั้งแรก และ
    // (2) มีการ import Excel / ล้างข้อมูลทั้งหมดจากหน้า Admin — ซึ่งเป็นกรณีที่
    // รูปร่างของตารางทั้งชุดเปลี่ยนจริงๆ จึงจำเป็นต้อง replace ทั้งหมด
    // ไม่แตะ lastUpdatedMap ตรงนี้ เพราะเป็นการโหลดข้อมูลตั้งต้น ไม่ใช่การอัปเดตคะแนนจริง
    s.on('data-updated', (data) => {
      if (data?.matches && Array.isArray(data.matches)) setMatches(data.matches);
    });

    // "match-updated" — คะแนน/สถานะของแมตช์เดียวเปลี่ยน (เกิดถี่ที่สุด เช่น
    // ทุกครั้งที่กดคะแนน +1/-1) อัปเดตเฉพาะแมตช์นั้นในตาราง ไม่ต้องรอ/แทนที่ทั้งชุด
    // พร้อมบันทึกเวลาล่าสุดของแมตช์นี้ เพื่อใช้จัดเรียงลอยขึ้นบนสุด
    s.on('match-updated', (updatedMatch: Match) => {
      if (!updatedMatch?.id) return;
      setMatches(prev => mergeMatchUpdates(prev, [updatedMatch]));
      setLastUpdatedMap(prev => ({ ...prev, [updatedMatch.id]: Date.now() }));
    });

    // "matches-updated" — แก้สนามทั้งรุ่น/สาย หรือแก้ชื่อนักกีฬาที่กระทบหลายแมตช์
    // พร้อมกัน อัปเดตเฉพาะแมตช์ที่อยู่ใน payload พร้อมบันทึกเวลาล่าสุดของทุกแมตช์ในชุดนี้
    s.on('matches-updated', (updatedMatches: Match[]) => {
      if (!Array.isArray(updatedMatches) || updatedMatches.length === 0) return;
      setMatches(prev => mergeMatchUpdates(prev, updatedMatches));
      setLastUpdatedMap(prev => {
        const next = { ...prev };
        const now = Date.now();
        updatedMatches.forEach(m => {
          if (m?.id) next[m.id] = now;
        });
        return next;
      });
    });

    return () => { s.disconnect(); };
  }, []);

  const categoryGroups = useMemo<CategoryGroupOption[]>(() => {
    const map = new Map<string, CategoryGroupOption>();
    matches.forEach(m => {
      const key = `${m.category}__${m.group}`;
      if (!map.has(key)) {
        map.set(key, { key, category: m.category, group: m.group, label: `${m.category}${m.group}` });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      const ao = categoryOrderIndex(a.category);
      const bo = categoryOrderIndex(b.category);
      if (ao !== bo) return ao - bo;
      if (a.category !== b.category) return a.category.localeCompare(b.category, 'th');
      return a.group.localeCompare(b.group, 'th');
    });
  }, [matches]);

  const selectedOption = useMemo(
    () => categoryGroups.find(g => g.key === selectedGroupKey) ?? null,
    [categoryGroups, selectedGroupKey]
  );

  const filteredMatches = useMemo(() => {
    if (selectedGroupKey === 'ALL' || !selectedOption) return matches;
    return matches.filter(
      m => m.category === selectedOption.category && m.group === selectedOption.group
    );
  }, [matches, selectedGroupKey, selectedOption]);

  const isNonScoringView = useMemo(() => {
    return selectedOption && NON_SCORING_CATEGORIES.includes(selectedOption.category);
  }, [selectedOption]);

  const standings = useMemo(() => {
    const stats: Record<string, Standing> = {};
    const ensure = (u: string): Standing => {
      if (!stats[u]) {
        stats[u] = {
          university: u, points: 0, matchPoints: 0,
          setsWon: 0, setsLost: 0, pointsWon: 0, pointsConceded: 0, h2h: {},
        };
      }
      return stats[u];
    };

    const groupKeys = Array.from(new Set(filteredMatches.map(m => `${m.category}-${m.group}`)));

    groupKeys.forEach(key => {
      const finishedInGroup = filteredMatches.filter(
        m => `${m.category}-${m.group}` === key && m.isFinished
      );
      if (finishedInGroup.length === 0) return;

      const currentCategory = finishedInGroup[0].category;
      const isNonScoring = NON_SCORING_CATEGORIES.includes(currentCategory);

      // internal เก็บ pWon เพิ่มเพื่อใช้ในการตัดสิน
      const internal: Record<string, { mPts: number; pWon: number; pConceded: number }> = {};
      const ensureInternal = (u: string) => {
        if (!internal[u]) internal[u] = { mPts: 0, pWon: 0, pConceded: 0 };
        return internal[u];
      };

      finishedInGroup.forEach(m => {
        const uniA = m.teamA.university;
        const uniB = m.teamB.university;
        ensureInternal(uniA);
        ensureInternal(uniB);
        const a = ensure(uniA);
        const b = ensure(uniB);

        if (isNoResult(m)) return;

        const s1a = Number(m.score.s1a) || 0;
        const s1b = Number(m.score.s1b) || 0;
        const s2a = Number(m.score.s2a) || 0;
        const s2b = Number(m.score.s2b) || 0;

        const winner = getMatchWinner(m);

        // สะสมคะแนนภายในกลุ่มเพื่อจัดอันดับ
        internal[uniA].pWon += s1a + s2a;
        internal[uniA].pConceded += s1b + s2b;
        internal[uniB].pWon += s1b + s2b;
        internal[uniB].pConceded += s1a + s2a;

        if (winner === 'a') internal[uniA].mPts += 2;
        else if (winner === 'b') internal[uniB].mPts += 2;
        else { internal[uniA].mPts += 1; internal[uniB].mPts += 1; }

        // สะสมคะแนนรวมของสถาบัน
        a.pointsWon += s1a + s2a; a.pointsConceded += s1b + s2b;
        b.pointsWon += s1b + s2b; b.pointsConceded += s1a + s2a;
        a.matchPoints += winner === 'a' ? 2 : winner === 'b' ? 0 : 1;
        b.matchPoints += winner === 'b' ? 2 : winner === 'a' ? 0 : 1;

        if (s1a > s1b) { a.setsWon += 1; b.setsLost += 1; }
        else if (s1b > s1a) { b.setsWon += 1; a.setsLost += 1; }
        if (s2a > s2b) { a.setsWon += 1; b.setsLost += 1; }
        else if (s2b > s2a) { b.setsWon += 1; a.setsLost += 1; }

        if (!a.h2h[uniB]) a.h2h[uniB] = [];
        if (!b.h2h[uniA]) b.h2h[uniA] = [];
        a.h2h[uniB].push({ category: m.category, group: m.group, sets: [[s1a, s1b], [s2a, s2b]] });
        b.h2h[uniA].push({ category: m.category, group: m.group, sets: [[s1b, s1a], [s2b, s2a]] });
      });

      // จัดอันดับแจกแต้ม 5-4-3-2-1
      if (!isNonScoring) {
        const sortedInternal = Object.entries(internal).sort(([, x], [, y]) => {
          // 1. ดูคะแนนแมตช์ก่อน (2, 1, 0)
          if (y.mPts !== x.mPts) return y.mPts - x.mPts;
          // 2. ถ้าเท่ากัน ดูคะแนนที่ทำได้ (pWon) - ใครมากกว่าอยู่บน
          if (y.pWon !== x.pWon) return y.pWon - x.pWon;
          // 3. ถ้ายังเท่ากัน ดูคะแนนที่เสีย (pConceded) - ใครน้อยกว่าอยู่บน
          return x.pConceded - y.pConceded;
        });
        sortedInternal.forEach(([uni], idx) => {
          stats[uni].points += Math.max(1, 5 - idx);
        });
      }
    });

    return Object.values(stats).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
      if (b.pointsWon !== a.pointsWon) return b.pointsWon - a.pointsWon; // เพิ่ม tie-break ตรงนี้ด้วย
      return a.pointsConceded - b.pointsConceded;
    });
  }, [filteredMatches]);

  const standingUnis = useMemo(() => standings.map(s => s.university), [standings]);

  const statusCounts = useMemo(() => {
    let live = 0;
    let finished = 0;
    filteredMatches.forEach(m => {
      if (m.isFinished) finished += 1;
      else live += 1;
    });
    return { live, finished, all: filteredMatches.length };
  }, [filteredMatches]);

  const matchList = useMemo(() => {
    const byStatus = filteredMatches.filter(m => {
      if (statusFilter === 'LIVE') return !m.isFinished;
      if (statusFilter === 'FINISHED') return m.isFinished;
      return true;
    });

    const byCourt = (a: Match, b: Match) =>
      a.court.localeCompare(b.court, undefined, { numeric: true });

    // เรียงกลุ่ม Live ด้วยกันเอง: แมตช์ที่มี event อัปเดตล่าสุด (เวลามากกว่า) ลอยขึ้นบนสุดก่อน
    // เหมือน feed ข่าว ส่วนแมตช์ที่ยังไม่เคยมี event เข้ามาเลย (ไม่มีใน lastUpdatedMap ค่า
    // จะเป็น 0) จะตกไปอยู่ท้ายกลุ่ม Live และเรียงตามเลขสนามกันเองเป็น fallback
    const byRecencyThenCourt = (a: Match, b: Match) => {
      const at = lastUpdatedMap[a.id] ?? 0;
      const bt = lastUpdatedMap[b.id] ?? 0;
      if (at !== bt) return bt - at;
      return byCourt(a, b);
    };

    // แยก live/finished ออกจากกันก่อน เพื่อการันตีว่าแมตช์ live อยู่บนสุดของทั้งรายการเสมอ
    // ไม่ว่าจำนวนแมตช์จะเปลี่ยนแปลงแค่ไหน ส่วนกลุ่มที่จบแล้วยังคงเรียงตามสนามตามปกติ
    const live = byStatus.filter(m => !m.isFinished).sort(byRecencyThenCourt);
    const finished = byStatus.filter(m => m.isFinished).sort(byCourt);

    return [...live, ...finished];
  }, [filteredMatches, statusFilter, lastUpdatedMap]);

  const selectedLabel = selectedOption?.label ?? null;

  return (
    <main className="min-h-screen bg-[#05070d] text-white font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-4">
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
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none">Live Score</h1>
              <p className="text-emerald-400/80 font-bold text-[10px] uppercase tracking-[3px] mt-1.5">สรุปคะแนนแยกตามสถาบันและรุ่น-สาย</p>
            </div>
            <span className={`ml-1 w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-red-500 shadow-[0_0_6px_#ef4444]'}`} />
          </div>

          <div className="flex items-center gap-3">
            <Link href="/" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              Leaderboard
            </Link>
            <Link href="/live" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              Live Board
            </Link>
          </div>
        </header>

        {/* Category-Group filter buttons */}
        <div className="flex flex-wrap items-center gap-2 bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3">
          <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 mr-2">
            <FaFilter size={10} /> รุ่น-สาย
          </span>
          <button
            onClick={() => setSelectedGroupKey('ALL')}
            className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all ${
              selectedGroupKey === 'ALL'
                ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            ทั้งหมด
          </button>
          {categoryGroups.map(g => (
            <button
              key={g.key}
              onClick={() => setSelectedGroupKey(g.key)}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all ${
                selectedGroupKey === g.key
                  ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Head-to-head standings table */}
        <div className="bg-white/[0.03] border border-white/10 rounded-3xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">
              ตารางคะแนนพบกันตัวต่อตัว{selectedLabel && <span className="text-emerald-400"> · {selectedLabel}</span>}
            </h2>
            <p className="text-[9px] font-bold text-slate-600 mt-1 leading-relaxed">
              {isNonScoringView 
                ? "รุ่นกิตติมศักดิ์: แสดงสถิติการแข่งขันและผลพบกันตัวต่อตัว (ไม่นำแต้มสถาบันมาคำนวณในตารางอันดับรวม)"
                : "แต้มสถาบัน 5-4-3-2-1 คำนวณตาม: คะแนนแมตช์ > คะแนนที่ได้ > คะแนนที่เสีย (น้อยกว่าดีกว่า)"}
            </p>
          </div>

          {standings.length === 0 ? (
            <div className="py-10 flex flex-col items-center justify-center text-slate-700">
              <p className="font-bold uppercase tracking-widest text-xs text-slate-600">
                ยังไม่มีผลการแข่งขันในรุ่น-สายนี้
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[720px]">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="sticky left-0 bg-[#0b0f19] px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500 z-10">
                      สถาบัน
                    </th>
                    {!isNonScoringView && (
                      <th className="px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500 text-center">แต้ม</th>
                    )}
                    <th className="px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500 text-center">เซตชนะ-แพ้</th>
                    {standingUnis.map(u => (
                      <th key={u} className="px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500 text-center whitespace-nowrap">
                        vs {u}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-500 text-center whitespace-nowrap">
                      คะแนนดิบรวม
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {standings.map((row, idx) => (
                    <tr key={row.university} className={idx === 0 ? 'bg-emerald-500/[0.04]' : ''}>
                      <td className="sticky left-0 bg-[#0b0f19] px-4 py-3 font-black text-sm">
                        {row.university}
                      </td>
                      {!isNonScoringView && (
                        <td className="px-3 py-3 text-center">
                          <span className={`text-lg font-black tabular-nums ${idx === 0 ? 'text-emerald-400' : 'text-blue-400'}`}>
                            {row.points}
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-3 text-center text-xs font-bold tabular-nums text-slate-300">
                        {row.setsWon}-{row.setsLost}
                      </td>
                      {standingUnis.map(u => {
                        if (u === row.university) {
                          return <td key={u} className="px-3 py-3 text-center text-slate-700">—</td>;
                        }
                        const meetings = row.h2h[u] || [];
                        return (
                          <td key={u} className="px-3 py-3 text-center">
                            {meetings.length === 0 ? (
                              <span className="text-slate-700 text-xs">-</span>
                            ) : (
                              <div className="flex flex-col items-center gap-1.5">
                                {meetings.map((mm, mi) => (
                                  <div key={mi} className="flex flex-col items-center">
                                    {!selectedLabel && (
                                      <span className="text-[7px] text-slate-600 uppercase tracking-wide truncate max-w-[6rem]">
                                        {mm.category}{mm.group}
                                      </span>
                                    )}
                                    <div className="flex items-center gap-1 tabular-nums text-[11px] font-black">
                                      {mm.sets.map((set, si) => (
                                        <span
                                          key={si}
                                          className={`px-1.5 py-0.5 rounded ${
                                            set[0] > set[1]
                                              ? 'bg-emerald-500/10 text-emerald-400'
                                              : set[1] > set[0]
                                                ? 'bg-red-500/10 text-red-400'
                                                : 'text-slate-500'
                                          }`}
                                        >
                                          {set[0]}-{set[1]}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap">
                        <span className="text-emerald-400 font-black text-sm">{row.pointsWon}</span>
                        <span className="text-slate-600 mx-1">-</span>
                        <span className="text-red-400 font-black text-sm">{row.pointsConceded}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Per-match set score breakdown */}
        <div className="bg-white/[0.03] border border-white/10 rounded-3xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-300">
              รายละเอียดแต้มแต่ละเซต{selectedLabel && <span className="text-emerald-400"> · {selectedLabel}</span>}
            </h2>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide transition-all ${
                  statusFilter === 'ALL'
                    ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                ทั้งหมด ({statusCounts.all})
              </button>
              <button
                onClick={() => setStatusFilter('LIVE')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide transition-all ${
                  statusFilter === 'LIVE'
                    ? 'bg-amber-400 text-black shadow-[0_0_15px_rgba(251,191,36,0.4)]'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === 'LIVE' ? 'bg-black' : 'bg-amber-400 animate-pulse'}`} />
                กำลังแข่ง ({statusCounts.live})
              </button>
              <button
                onClick={() => setStatusFilter('FINISHED')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide transition-all ${
                  statusFilter === 'FINISHED'
                    ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                จบแล้ว ({statusCounts.finished})
              </button>
            </div>
          </div>

          {matchList.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-700">
              <GiShuttlecock size={40} className="mb-3 opacity-30" />
              <p className="font-bold uppercase tracking-widest text-xs text-slate-600">
                {statusFilter === 'FINISHED' ? 'ยังไม่มีแมตช์ที่แข่งจบในรุ่น-สายนี้' :
                 statusFilter === 'LIVE' ? 'ไม่มีแมตช์ที่กำลังแข่งในรุ่น-สายนี้' :
                 'ไม่มีข้อมูลแมตช์ในรุ่น-สายนี้'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {matchList.map(m => {
                const live = !m.isFinished;
                const eff = live ? calculateEffectiveSets(m) : null;

                return (
                  <div key={m.id}>
                    <div className="hidden sm:flex px-5 py-3.5 items-start gap-4">
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

                    <div className="sm:hidden px-4 py-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">สนาม {m.court}</p>
                          <p className="text-[9px] font-bold text-slate-500 truncate">{m.category} · {m.group}</p>
                        </div>
                        {live ? (
                          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-400/10 border border-amber-400/30 rounded-full text-[8px] font-black text-amber-400 uppercase tracking-widest">
                            <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" /> Live
                          </span>
                        ) : (
                          <span className="shrink-0 text-[8px] font-black text-slate-600 uppercase tracking-widest">จบแล้ว</span>
                        )}
                      </div>

                      <MobileTeamRow
                        team={m.teamA}
                        color="text-blue-400"
                        mySet1={m.score.s1a}
                        oppSet1={m.score.s1b}
                        mySet2={m.score.s2a}
                        oppSet2={m.score.s2b}
                      />
                      <MobileTeamRow
                        team={m.teamB}
                        color="text-red-400"
                        mySet1={m.score.s1b}
                        oppSet1={m.score.s1a}
                        mySet2={m.score.s2b}
                        oppSet2={m.score.s2a}
                      />

                      {live && eff && (
                        <p className="text-[9px] font-black tabular-nums text-slate-500 text-right pt-0.5">
                          Sets {eff.setsA}-{eff.setsB}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #05070d; }
        h1, h2, h3, .font-black { font-family: 'Orbitron', sans-serif; }
      `}</style> */}
    </main>
  );
}

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

// FlashScore: แสดงตัวเลขคะแนน เมื่อค่าเปลี่ยน (เทียบกับ prev value ผ่าน useRef)
// จะเล่นแอนิเมชัน scale 1 -> 1.4 -> 1 พร้อมเปลี่ยนเป็นสีเขียว + glow shadow
// เป็นเวลา 0.5 วินาที ก่อนกลับไปใช้สีปกติ (colorClass ที่ส่งเข้ามา) — ให้ความรู้สึก
// เหมือนกระดานคะแนน NBA เวลามีการทำแต้ม
function FlashScore({
  value,
  colorClass,
  className = '',
}: {
  value: number;
  colorClass: string;
  className?: string;
}) {
  const prevValueRef = useRef(value);
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    if (prevValueRef.current !== value) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 500);
      prevValueRef.current = value;
      return () => clearTimeout(timer);
    }
    prevValueRef.current = value;
  }, [value]);

  return (
    <motion.span
      className={`inline-block tabular-nums ${className} ${
        isFlashing ? 'text-emerald-400' : colorClass
      }`}
      animate={isFlashing ? { scale: [1, 1.4, 1] } : { scale: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut', times: [0, 0.4, 1] }}
      style={
        isFlashing
          ? { textShadow: '0 0 10px rgba(16,185,129,0.9), 0 0 20px rgba(16,185,129,0.5)' }
          : undefined
      }
    >
      {value}
    </motion.span>
  );
}

function ScorePair({ a, b }: { a: number; b: number }) {
  const aWin = a > b;
  const bWin = b > a;
  return (
    <span className="flex items-center gap-0.5 text-[11px] font-black">
      <FlashScore value={a} colorClass={aWin ? 'text-blue-400' : 'text-slate-600'} />
      <span className="text-slate-700">-</span>
      <FlashScore value={b} colorClass={bWin ? 'text-red-400' : 'text-slate-600'} />
    </span>
  );
}

function MobileTeamRow({
  team,
  color,
  mySet1,
  oppSet1,
  mySet2,
  oppSet2,
}: {
  team: Team;
  color: string;
  mySet1: number;
  oppSet1: number;
  mySet2: number;
  oppSet2: number;
}) {
  const starters = team.players?.filter(p => p.role === 'starter') ?? [];
  const substitutes = team.players?.filter(p => p.role === 'substitute') ?? [];
  const set1Win = mySet1 > oppSet1;
  const set2Win = mySet2 > oppSet2;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <span className={`text-xs font-black uppercase tracking-tight ${color}`}>{team.university}</span>
        {starters.length > 0 && (
          <p className="text-[9px] font-bold text-slate-400 leading-snug break-words">
            {starters.map(p => p.name).join(' · ')}
          </p>
        )}
        {substitutes.length > 0 && (
          <p className="text-[8px] italic text-slate-600 leading-snug break-words">
            สำรอง: {substitutes.map(p => p.name).join(' · ')}
          </p>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2 tabular-nums pl-2">
        <FlashScore
          value={mySet1}
          colorClass={set1Win ? color : 'text-slate-600'}
          className="text-[13px] font-black"
        />
        <span className="w-px h-3 bg-white/10" />
        <FlashScore
          value={mySet2}
          colorClass={set2Win ? color : 'text-slate-600'}
          className="text-[13px] font-black"
        />
      </div>
    </div>
  );
}
