// app/page.tsx

"use client"

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { FaTrophy, FaMedal, FaAward } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { getMatchWinner, isNoResult } from '../lib/scoring';
import { useIsAdmin } from '@/lib/useIsAdmin';

interface Rank {
  university: string;
  points: number;
  matchPoints: number;
  win: number;
  pointsWon: number;
  pointsConceded: number;
}

const UNIVERSITIES = ['CU', 'KU', 'KKU', 'PSU', 'CMU'];
const EXHIBITION_CATEGORIES = ['กิตติมศักดิ์'];

const RankBadge = ({ index }: { index: number }) => {
  switch (index) {
    case 0: return <FaTrophy className="text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.7)] text-2xl sm:text-3xl md:text-4xl 2xl:text-5xl" />;
    case 1: return <FaMedal className="text-slate-300 drop-shadow-[0_0_10px_rgba(203,213,225,0.5)] text-xl sm:text-2xl md:text-3xl 2xl:text-4xl" />;
    case 2: return <FaAward className="text-orange-400 drop-shadow-[0_0_10px_rgba(251,146,60,0.5)] text-xl sm:text-2xl md:text-3xl 2xl:text-4xl" />;
    default: return <span className="text-blue-400/40 font-black text-base sm:text-xl md:text-2xl 2xl:text-3xl tabular-nums">{index + 1}</span>;
  }
};

export default function LeaderboardPage() {
  const [rankings, setRankings] = useState<Rank[]>([]);
  const { isAdmin, logout } = useIsAdmin();

  // เก็บ "สำเนาทั้งชุด" ของ matches ไว้ใน ref เสมอ ไม่ว่าจะมาจาก data-updated
  // (ทั้งชุด) หรือ match-updated/matches-updated (บางส่วน) ก็ merge เข้าตัวนี้
  // ก่อน แล้วค่อยคำนวณ ranking ใหม่จากสำเนาล่าสุดทุกครั้ง — ไม่งั้นถ้าคำนวณ
  // จาก payload บางส่วนตรงๆ อันดับจะหายไปเพราะเห็นแค่บางแมตช์ที่เพิ่งอัปเดต
  const matchesRef = useRef<any[]>([]);

  const computeRankings = useCallback((matches: any[]) => {
    const scorableMatches = matches.filter(m => !EXHIBITION_CATEGORIES.includes(m.category));

    const schoolStats: Record<string, Rank> = {};
    UNIVERSITIES.forEach(u => {
      schoolStats[u] = { university: u, points: 0, matchPoints: 0, win: 0, pointsWon: 0, pointsConceded: 0 };
    });

    const groupKeys = [...new Set(scorableMatches.map(m => `${m.category}-${m.group}`))];

    groupKeys.forEach(key => {
      const finishedMatchesInGroup = scorableMatches.filter(
        m => `${m.category}-${m.group}` === key && m.isFinished
      );

      if (finishedMatchesInGroup.length === 0) return;

      const internalStats: Record<string, any> = {};

      finishedMatchesInGroup.forEach(m => {
        const unis = [m.teamA.university, m.teamB.university];
        unis.forEach(u => {
          if (!internalStats[u]) {
            internalStats[u] = { university: u, mPts: 0, pWon: 0, pConceded: 0, setsWon: 0 };
          }
        });

        if (isNoResult(m)) return;

        const s1a = Number(m.score.s1a) || 0;
        const s1b = Number(m.score.s1b) || 0;
        const s2a = Number(m.score.s2a) || 0;
        const s2b = Number(m.score.s2b) || 0;

        internalStats[m.teamA.university].pWon += (s1a + s2a);
        internalStats[m.teamA.university].pConceded += (s1b + s2b);
        internalStats[m.teamB.university].pWon += (s1b + s2b);
        internalStats[m.teamB.university].pConceded += (s1a + s2a);

        if (s1a > s1b) internalStats[m.teamA.university].setsWon += 1;
        else if (s1b > s1a) internalStats[m.teamB.university].setsWon += 1;

        if (s2a > s2b) internalStats[m.teamA.university].setsWon += 1;
        else if (s2b > s2a) internalStats[m.teamB.university].setsWon += 1;

        const winner = getMatchWinner(m);
        if (winner === 'a') {
          internalStats[m.teamA.university].mPts += 2;
        } else if (winner === 'b') {
          internalStats[m.teamB.university].mPts += 2;
        } else {
          internalStats[m.teamA.university].mPts += 1;
          internalStats[m.teamB.university].mPts += 1;
        }
      });

      const sortedInternal = Object.values(internalStats).sort((a: any, b: any) => {
        if (b.mPts !== a.mPts) return b.mPts - a.mPts;
        if (b.pWon !== a.pWon) return b.pWon - a.pWon;
        return a.pConceded - b.pConceded;
      });

      sortedInternal.forEach((stat: any, idx) => {
        const teamAward = Math.max(1, 5 - idx);
        if (schoolStats[stat.university]) {
          schoolStats[stat.university].points += teamAward;
          schoolStats[stat.university].matchPoints += stat.mPts;
          schoolStats[stat.university].win += stat.setsWon;
          schoolStats[stat.university].pointsWon += stat.pWon;
          schoolStats[stat.university].pointsConceded += stat.pConceded;
        }
      });
    });

    const finalRankings = Object.values(schoolStats).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
      if (b.pointsWon !== a.pointsWon) return b.pointsWon - a.pointsWon;
      return a.pointsConceded - b.pointsConceded;
    });

    setRankings(finalRankings);
  }, []);

  useEffect(() => {
    const socket = io();

    // Snapshot เต็มชุด — ยิงตอน connect ครั้งแรก และตอน import-excel/ล้างข้อมูล
    // (ดู server.js: io.emit('data-updated', ...) ใน import-excel handler)
    socket.on('data-updated', (data: { matches: any[] }) => {
      if (data?.matches) {
        matchesRef.current = data.matches;
        computeRankings(matchesRef.current);
      }
    });

    // อัปเดตเฉพาะแมตช์เดียว — ยิงมาจาก update-score ทุกครั้งที่มีคนกดคะแนน
    // (ดู server.js: socket.broadcast.emit('match-updated', current))
    // นี่คือ event หลักที่ทำให้ leaderboard เห็นคะแนนสดๆ โดยไม่ต้องรอ
    // import ตารางใหม่ ถ้าไม่ฟัง event นี้ leaderboard จะค้างจนกว่าจะมีการ
    // import-excel หรือ clear ครั้งถัดไป
    socket.on('match-updated', (updatedMatch: any) => {
      const idx = matchesRef.current.findIndex(m => m.id === updatedMatch.id);
      matchesRef.current = idx === -1
        ? [...matchesRef.current, updatedMatch]
        : matchesRef.current.map(m => (m.id === updatedMatch.id ? updatedMatch : m));
      computeRankings(matchesRef.current);
    });

    // อัปเดตหลายแมตช์พร้อมกัน — ยิงมาจาก update-group-court (แก้สนามทั้งรุ่น/สาย)
    // หรือ update-player-name (แก้ชื่อนักกีฬาที่กระทบหลายแมตช์ในรุ่น/สายเดียวกัน)
    // (ดู server.js: io.emit('matches-updated', affectedMatches))
    socket.on('matches-updated', (updatedMatches: any[]) => {
      const updatedById = new Map(updatedMatches.map(m => [m.id, m]));
      matchesRef.current = matchesRef.current.map(m => updatedById.get(m.id) ?? m);
      computeRankings(matchesRef.current);
    });

    return () => { socket.disconnect(); };
  }, [computeRankings]);

  return (
    <main className="relative h-screen w-full bg-[#05070d] text-white flex flex-col overflow-y-auto md:overflow-hidden p-3 sm:p-4 md:p-6 gap-3 sm:gap-4">
      
      {/* Header */}
      <header className="relative z-10 shrink-0 flex flex-col md:flex-row justify-between items-center gap-3 sm:gap-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="relative w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-2xl overflow-hidden shrink-0 shadow-lg border border-white">
            <Image
              src="/5gearlogo.jpg"
              alt="5 Gear Logo"
              fill
              className="object-cover"
              priority
              sizes="(max-width: 640px) 48px, 56px"
            />
          </div>
          <div className="leading-tight text-center md:text-left">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight italic uppercase">5 GEAR</h1>
            <p className="text-blue-300/80 tracking-[2px] sm:tracking-[4px] uppercase font-bold text-[9px] sm:text-[10px] mt-0.5">Badminton Tournament</p>
          </div>
        </div>
        <div className="flex gap-2 sm:gap-3">
          <Link href="/live" className="px-3.5 py-2 sm:px-5 sm:py-2.5 bg-amber-500/10 backdrop-blur-md border border-amber-500/30 rounded-xl hover:bg-amber-500/20 transition-all font-bold tracking-widest uppercase text-[10px] sm:text-xs text-amber-400">Live</Link>
          <Link href="/live-score" className="px-3.5 py-2 sm:px-5 sm:py-2.5 bg-amber-500/10 backdrop-blur-md border border-amber-500/30 rounded-xl hover:bg-amber-500/20 transition-all font-bold tracking-widest uppercase text-[10px] sm:text-xs text-amber-400">Live Score</Link>

          {isAdmin && (
            <>
              <Link href="/matches" className="px-3.5 py-2 sm:px-5 sm:py-2.5 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl hover:bg-blue-600 transition-all font-bold tracking-widest uppercase text-[10px] sm:text-xs">Matches</Link>
              <Link href="/admin" className="px-3.5 py-2 sm:px-5 sm:py-2.5 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl hover:bg-slate-700 transition-all font-bold tracking-widest text-white/60 uppercase text-[10px] sm:text-xs">Admin</Link>
              <button onClick={logout} className="px-3.5 py-2 sm:px-5 sm:py-2.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl hover:bg-red-500/20 transition-all font-bold tracking-widest uppercase text-[10px] sm:text-xs">
                Logout
              </button>
            </>
          )}
        </div>
      </header>

      {/* Rankings List - wrapped in z-10 */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col gap-2 sm:gap-3 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="popLayout">
          {rankings.map((rank, idx) => {
            const isTop1 = idx === 0;
            return (
              <motion.div
                key={rank.university}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className={`relative overflow-hidden flex-none md:flex-1 min-h-[88px] sm:min-h-[96px] md:min-h-[80px] flex flex-col sm:flex-row items-stretch sm:items-center justify-center sm:justify-between gap-2 sm:gap-0 px-4 sm:px-6 md:px-10 py-3 sm:py-0 rounded-2xl sm:rounded-[1.75rem] border-2 transition-all duration-500 backdrop-blur-xl ${
                  isTop1
                    ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/10 border-yellow-400/80 shadow-[0_0_40px_rgba(250,204,21,0.2)]'
                    : 'bg-white/[0.03] border-white/10'
                }`}
              >
                <div className="flex items-center gap-2.5 sm:gap-4 md:gap-8 min-w-0 w-full sm:w-auto">
                  <div className="w-7 sm:w-10 md:w-16 flex justify-center items-center shrink-0">
                    <RankBadge index={idx} />
                  </div>
                  <div className="w-9 h-9 sm:w-12 sm:h-12 md:w-16 md:h-16 bg-slate-900/80 rounded-lg sm:rounded-xl md:rounded-2xl flex items-center justify-center border border-white/10 text-[11px] sm:text-sm md:text-xl font-black shrink-0 shadow-inner">
                    {rank.university.substring(0, 3)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className={`text-xl sm:text-3xl md:text-5xl 2xl:text-7xl font-black italic tracking-tighter leading-none pr-3 sm:pr-4 whitespace-nowrap ${isTop1 ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' : 'text-white'}`}>
                      {rank.university}
                    </h2>
                    <div className="flex gap-2.5 sm:gap-4 mt-1 sm:mt-2">
                      <span className="text-[8px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Won <span className="text-emerald-400">{rank.pointsWon}</span></span>
                      <span className="text-[8px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">Conceded <span className="text-red-400">{rank.pointsConceded}</span></span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 shrink-0 w-full sm:w-auto justify-end">
                  <div className="text-right mr-1 sm:mr-2 hidden md:block">
                    <p className={`text-[10px] font-black uppercase tracking-widest ${isTop1 ? 'text-yellow-400/60' : 'text-blue-500/60'}`}>Total Points</p>
                    <p className="text-[9px] font-bold text-slate-600 uppercase italic">Rank Points</p>
                  </div>
                  <motion.span
                    key={rank.points}
                    initial={{ scale: 1.2, filter: "blur(4px)" }}
                    animate={{ scale: 1, filter: "blur(0px)" }}
                    className={`text-3xl sm:text-5xl md:text-7xl 2xl:text-9xl font-black leading-none tracking-tighter tabular-nums ${isTop1 ? 'text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.6)]' : 'text-blue-500'}`}
                  >
                    {rank.points}
                  </motion.span>
                </div>

                {isTop1 && (
                  <div className="absolute -right-6 -bottom-6 sm:-right-8 sm:-bottom-8 opacity-[0.07] pointer-events-none text-yellow-400 rotate-12">
                    <FaTrophy size={110} className="sm:w-[180px] sm:h-[180px]" />
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {rankings.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center py-10">
            <p className="text-lg sm:text-2xl md:text-3xl font-black uppercase tracking-[4px] sm:tracking-[8px] text-center px-4 opacity-40">Waiting for Matches</p>
          </div>
        )}
      </div>

      <footer className="relative z-10 shrink-0 text-center py-1 sm:py-2">
        <p className="text-[8px] sm:text-[9px] text-slate-600 font-bold uppercase tracking-[2px] sm:tracking-[4px] px-2">
          Points calculated by: Rank Points &gt; Match Points &gt; Points Won &gt; Points Conceded (lower is better)
        </p>
      </footer>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #05070d; overflow: hidden; }
        h1, h2, .font-black { font-family: 'Orbitron', sans-serif; }
      `}</style>
    </main>
  );
}
