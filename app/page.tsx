"use client"

import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaTrophy, FaMedal, FaAward } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

interface Rank {
  university: string;
  points: number;       // คะแนนรวมสถาบัน (5, 4, 3, 2, 1)
  matchPoints: number;  // คะแนนดิบจากแมตช์ (ชนะ 2, เสมอ 1)
  win: number;
  pointsConceded: number;
}

const UNIVERSITIES = ['CU', 'KU', 'KKU', 'PSU', 'CMU'];

const RankBadge = ({ index }: { index: number }) => {
  switch (index) {
    case 0: return <FaTrophy className="text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.7)] text-4xl 2xl:text-5xl" />;
    case 1: return <FaMedal className="text-slate-300 drop-shadow-[0_0_10px_rgba(203,213,225,0.5)] text-3xl 2xl:text-4xl" />;
    case 2: return <FaAward className="text-orange-400 drop-shadow-[0_0_10px_rgba(251,146,60,0.5)] text-3xl 2xl:text-4xl" />;
    default: return <span className="text-blue-400/40 font-black text-2xl 2xl:text-3xl tabular-nums">{index + 1}</span>;
  }
};

export default function LeaderboardPage() {
  const [rankings, setRankings] = useState<Rank[]>([]);

  useEffect(() => {
    const socket = io();
    socket.on('data-updated', (data: { matches: any[] }) => {
      if (data?.matches) {
        // 1. ตรวจสอบว่าสถาบันไหน "มีการเข้าร่วมแข่งจริง" (มีชื่อในแมตช์)
        const activeUnis = UNIVERSITIES.filter(u =>
          data.matches.some(m => m.teamA.university === u || m.teamB.university === u)
        );

        const schoolStats: Record<string, Rank> = {};
        activeUnis.forEach(u => {
          schoolStats[u] = {
            university: u, points: 0, matchPoints: 0, win: 0, pointsConceded: 0
          };
        });

        // 2. จัดกลุ่มแมตช์ตามรุ่นและสาย
        const catGroupKeys = [...new Set(data.matches.map(m => `${m.category}-${m.group}`))];

        catGroupKeys.forEach(key => {
          const matchesInGroup = data.matches.filter(m => `${m.category}-${m.group}` === key);
          const isCategoryStarted = matchesInGroup.some(m => m.isFinished);

          // ถ้าในรุ่นนี้ยังไม่มีใครแข่งจบเลย ให้ข้ามการแจกแต้ม 5,4,3,2,1 ไปก่อน
          if (!isCategoryStarted) return;

          // คำนวณอันดับภายในรุ่น
          const groupInternalStats: any = {};
          activeUnis.forEach(u => {
            groupInternalStats[u] = { university: u, mPts: 0, wins: 0, pConceded: 0, playedInCat: false };
          });

          matchesInGroup.forEach(m => {
            // มาร์คว่าสถาบันนี้ส่งแข่งในรุ่นนี้
            groupInternalStats[m.teamA.university].playedInCat = true;
            groupInternalStats[m.teamB.university].playedInCat = true;

            if (m.isFinished) {
              const s1a = Number(m.score.s1a) || 0;
              const s1b = Number(m.score.s1b) || 0;
              const s2a = Number(m.score.s2a) || 0;
              const s2b = Number(m.score.s2b) || 0;

              let setsA = 0, setsB = 0;
              if (s1a === 21) setsA++; else if (s1b === 21) setsB++;
              if (s2a === 21) setsA++; else if (s2b === 21) setsB++;

              groupInternalStats[m.teamA.university].pConceded += (s1b + s2b);
              groupInternalStats[m.teamB.university].pConceded += (s1a + s2a);

              if (setsA > setsB) {
                groupInternalStats[m.teamA.university].mPts += 2;
                groupInternalStats[m.teamA.university].wins += 1;
              } else if (setsB > setsA) {
                groupInternalStats[m.teamB.university].mPts += 2;
                groupInternalStats[m.teamB.university].wins += 1;
              } else {
                groupInternalStats[m.teamA.university].mPts += 1;
                groupInternalStats[m.teamB.university].mPts += 1;
              }
            }
          });

          // จัดลำดับ 1-5 ภายในรุ่น
          const sortedInGroup = Object.values(groupInternalStats)
            .filter((s: any) => s.playedInCat) // เอาเฉพาะทีมที่ส่งแข่งรุ่นนี้จริงๆ
            .sort((a: any, b: any) => {
              if (b.mPts !== a.mPts) return b.mPts - a.mPts;
              if (b.wins !== a.wins) return b.wins - a.wins;
              return a.pConceded - b.pConceded;
            });

          // 3. แจกแต้มสถาบัน (5, 4, 3, 2, 1)
          sortedInGroup.forEach((stat: any, idx) => {
            const teamAward = Math.max(1, 5 - idx); // 0=5, 1=4, 2=3, 3=2, 4=1
            schoolStats[stat.university].points += teamAward;
            schoolStats[stat.university].matchPoints += stat.mPts;
            schoolStats[stat.university].win += stat.wins;
            schoolStats[stat.university].pointsConceded += stat.pConceded;
          });
        });

        // 4. จัดอันดับสถาบันสุดท้ายเพื่อแสดงผล
        const finalRankings = Object.values(schoolStats).sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
          return a.pointsConceded - b.pointsConceded;
        });

        setRankings(finalRankings);
      }
    });
    return () => { socket.disconnect(); };
  }, []);

  return (
    <main className="h-screen w-full bg-[#05070d] text-white flex flex-col overflow-hidden p-4 md:p-6 gap-4">

      {/* Header — compact and fixed height so rows below always have full remaining space */}
      <header className="shrink-0 flex flex-col md:flex-row justify-between items-center gap-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-4">
          <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 4 }}
            className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.15)]"
          >
            <GiShuttlecock className="text-blue-400 text-3xl" />
          </motion.div>
          <div className="leading-tight">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight italic uppercase">5 GEAR</h1>
            <p className="text-blue-300/80 tracking-[4px] uppercase font-bold text-[10px] mt-0.5">Tournament Ranking</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/matches" className="px-5 py-2.5 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl hover:bg-blue-600 transition-all font-bold tracking-widest uppercase text-xs">Matches</Link>
          <Link href="/admin" className="px-5 py-2.5 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl hover:bg-slate-700 transition-all font-bold tracking-widest text-white/60 uppercase text-xs">Admin</Link>
        </div>
      </header>

      {/* Rankings — each row is flex-1 so N institutions always fill the screen exactly, no scroll */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="popLayout">
          {rankings.map((rank, idx) => {
            const isTop1 = idx === 0;
            return (
              <motion.div
                key={rank.university}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className={`relative overflow-hidden flex-1 min-h-0 flex items-center justify-between px-6 md:px-10 rounded-[1.75rem] border-2 transition-all duration-500 backdrop-blur-xl ${
                  isTop1
                    ? 'bg-gradient-to-r from-yellow-500/15 to-orange-500/10 border-yellow-400/80 shadow-[0_0_30px_rgba(250,204,21,0.15)]'
                    : 'bg-white/[0.03] border-white/10 hover:border-blue-400/40'
                }`}
              >
                {/* Left: rank + identity */}
                <div className="flex items-center gap-4 md:gap-8 min-w-0">
                  <div className="w-12 md:w-16 flex justify-center items-center shrink-0">
                    <RankBadge index={idx} />
                  </div>
                  <div className="w-14 h-14 md:w-16 md:h-16 bg-slate-900/80 rounded-2xl flex items-center justify-center border border-white/10 text-lg md:text-xl font-black shrink-0">
                    {rank.university.substring(0, 3)}
                  </div>
                  <div className="min-w-0">
                    <h2 className={`text-4xl md:text-5xl 2xl:text-6xl font-black italic tracking-tighter leading-none pr-2 ${isTop1 ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.4)]' : 'text-white'}`}>
                      {rank.university}
                    </h2>
                    <div className="flex gap-4 mt-2">
                      <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest">Wins <span className="text-emerald-400">{rank.win}</span></span>
                      <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest">Conceded <span className="text-red-400">{rank.pointsConceded}</span></span>
                    </div>
                  </div>
                </div>

                {/* Right: institution points */}
                <div className="flex items-center gap-3 shrink-0">
                  <motion.span
                    key={rank.points}
                    initial={{ scale: 1.15 }}
                    animate={{ scale: 1 }}
                    className={`text-6xl md:text-7xl 2xl:text-8xl font-black leading-none tracking-tighter tabular-nums ${isTop1 ? 'text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.5)]' : 'text-blue-500'}`}
                  >
                    {rank.points}
                  </motion.span>
                  <div className="hidden sm:flex flex-col items-start leading-tight">
                    <span className={`text-sm md:text-base font-bold uppercase ${isTop1 ? 'text-yellow-400/60' : 'text-blue-500/60'}`}>Points</span>
                    <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Awarded</span>
                  </div>
                </div>

                {isTop1 && <div className="absolute -right-6 -bottom-6 opacity-[0.06] pointer-events-none text-yellow-400"><FaTrophy size={150} /></div>}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {rankings.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center opacity-20">
            <GiShuttlecock size={80} className="mb-6 animate-bounce" />
            <p className="text-2xl md:text-3xl font-black uppercase tracking-[8px]">Waiting for Matches</p>
          </div>
        )}
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #05070d; overflow: hidden; }
        h1, h2, .font-black { font-family: 'Orbitron', sans-serif; }
      `}</style>
    </main>
  );
}
