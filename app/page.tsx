"use client"

import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaTrophy, FaMedal, FaAward } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { getMatchWinner, isNoResult } from '../lib/scoring';

interface Rank {
  university: string;
  points: number;       // คะแนนรวมสถาบัน (5, 4, 3, 2, 1) จากทุกรุ่น
  matchPoints: number;  // คะแนนดิบรวม (ชนะ 2, เสมอ 1)
  win: number;          // จำนวนแมตช์ที่ชนะรวม
  pointsConceded: number; // แต้มเสียรวม
}

const UNIVERSITIES = ['CU', 'KU', 'KKU', 'PSU', 'CMU'];
const EXHIBITION_CATEGORIES = ['คู่กิตติมศักดิ์'];

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
        // 1. กรองเฉพาะแมตช์ที่คิดคะแนนได้ (ไม่เอากิตติมศักดิ์)
        const scorableMatches = data.matches.filter(m => !EXHIBITION_CATEGORIES.includes(m.category));

        // 2. เตรียมโครงสร้างเก็บคะแนนรวมของแต่ละมหาวิทยาลัย
        const schoolStats: Record<string, Rank> = {};
        UNIVERSITIES.forEach(u => {
          schoolStats[u] = { university: u, points: 0, matchPoints: 0, win: 0, pointsConceded: 0 };
        });

        // 3. จัดกลุ่มแมตช์ตาม รุ่น (Category) และ สาย (Group)
        // เช่น "ทั่วไป-A", "ชายคู่-B"
        const groupKeys = [...new Set(scorableMatches.map(m => `${m.category}-${m.group}`))];

        groupKeys.forEach(key => {
          // กรองแมตช์ในกลุ่มนี้ที่ "แข่งเสร็จแล้ว" เท่านั้น
          const finishedMatchesInGroup = scorableMatches.filter(
            m => `${m.category}-${m.group}` === key && m.isFinished
          );

          // ถ้ากลุ่มนี้ยังไม่มีคู่ไหนแข่งเสร็จเลย ข้ามการแจกแต้ม 5,4,3,2,1 ในกลุ่มนี้ไปก่อน
          if (finishedMatchesInGroup.length === 0) return;

          // คำนวณอันดับภายในกลุ่ม (Internal Ranking)
          const internalStats: Record<string, any> = {};

          finishedMatchesInGroup.forEach(m => {
            const unis = [m.teamA.university, m.teamB.university];
            unis.forEach(u => {
              if (!internalStats[u]) {
                internalStats[u] = { university: u, mPts: 0, wins: 0, pConceded: 0 };
              }
            });

            // ถ้าเป็น No Result (เช่น Double Walkover) ไม่นับแต้ม
            if (isNoResult(m)) return;

            const s1a = Number(m.score.s1a) || 0;
            const s1b = Number(m.score.s1b) || 0;
            const s2a = Number(m.score.s2a) || 0;
            const s2b = Number(m.score.s2b) || 0;

            // สะสมแต้มเสีย
            internalStats[m.teamA.university].pConceded += (s1b + s2b);
            internalStats[m.teamB.university].pConceded += (s1a + s2a);

            // คำนวณผู้ชนะ
            const winner = getMatchWinner(m);
            if (winner === 'a') {
              internalStats[m.teamA.university].mPts += 2;
              internalStats[m.teamA.university].wins += 1;
            } else if (winner === 'b') {
              internalStats[m.teamB.university].mPts += 2;
              internalStats[m.teamB.university].wins += 1;
            } else {
              // กรณีเสมอ (ถ้ามี)
              internalStats[m.teamA.university].mPts += 1;
              internalStats[m.teamB.university].mPts += 1;
            }
          });

          // เรียงลำดับในกลุ่ม: แต้มแมตช์ > จำนวนที่ชนะ > แต้มเสีย (น้อยกว่าดีกว่า)
          const sortedInternal = Object.values(internalStats).sort((a: any, b: any) => {
            if (b.mPts !== a.mPts) return b.mPts - a.mPts;
            if (b.wins !== a.wins) return b.wins - a.wins;
            return a.pConceded - b.pConceded;
          });

          // 4. แจกแต้มสถาบัน (5, 4, 3, 2, 1) ตามลำดับที่ได้ ณ ปัจจุบัน
          sortedInternal.forEach((stat: any, idx) => {
            const teamAward = Math.max(1, 5 - idx);
            if (schoolStats[stat.university]) {
              schoolStats[stat.university].points += teamAward;
              schoolStats[stat.university].matchPoints += stat.mPts;
              schoolStats[stat.university].win += stat.wins;
              schoolStats[stat.university].pointsConceded += stat.pConceded;
            }
          });
        });

        // 5. จัดอันดับมหาลัยทั้งหมดเพื่อแสดงผล
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
      {/* Header */}
      <header className="shrink-0 flex flex-col md:flex-row justify-between items-center gap-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-4">
          <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 4 }}
            className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.15)]"
          >
            <GiShuttlecock className="text-blue-400 text-3xl" />
          </motion.div>
          <div className="leading-tight">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight italic uppercase">5 GEAR</h1>
            <p className="text-blue-300/80 tracking-[4px] uppercase font-bold text-[10px] mt-0.5">Badminton Tournament</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/matches" className="px-5 py-2.5 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl hover:bg-blue-600 transition-all font-bold tracking-widest uppercase text-xs">Matches</Link>
          <Link href="/admin" className="px-5 py-2.5 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl hover:bg-slate-700 transition-all font-bold tracking-widest text-white/60 uppercase text-xs">Admin</Link>
        </div>
      </header>

      {/* Rankings List */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 max-w-7xl mx-auto w-full">
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
                className={`relative overflow-hidden flex-1 min-h-[80px] flex items-center justify-between px-6 md:px-10 rounded-[1.75rem] border-2 transition-all duration-500 backdrop-blur-xl ${
                  isTop1
                    ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/10 border-yellow-400/80 shadow-[0_0_40px_rgba(250,204,21,0.2)]'
                    : 'bg-white/[0.03] border-white/10'
                }`}
              >
                {/* Left Side: Rank & Name */}
                <div className="flex items-center gap-4 md:gap-8 min-w-0">
                  <div className="w-12 md:w-16 flex justify-center items-center shrink-0">
                    <RankBadge index={idx} />
                  </div>
                  <div className="w-14 h-14 md:w-16 md:h-16 bg-slate-900/80 rounded-2xl flex items-center justify-center border border-white/10 text-lg md:text-xl font-black shrink-0 shadow-inner">
                    {rank.university.substring(0, 3)}
                  </div>
                  <div className="min-w-0">
                    <h2 className={`text-4xl md:text-5xl 2xl:text-7xl font-black italic tracking-tighter leading-none pr-2 ${isTop1 ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' : 'text-white'}`}>
                      {rank.university}
                    </h2>
                    <div className="flex gap-4 mt-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Wins <span className="text-emerald-400">{rank.win}</span></span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Conceded <span className="text-red-400">{rank.pointsConceded}</span></span>
                    </div>
                  </div>
                </div>

                {/* Right Side: Score */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right mr-2 hidden sm:block">
                    <p className={`text-[10px] font-black uppercase tracking-widest ${isTop1 ? 'text-yellow-400/60' : 'text-blue-500/60'}`}>Total Points</p>
                    <p className="text-[9px] font-bold text-slate-600 uppercase italic">Rank Points</p>
                  </div>
                  <motion.span
                    key={rank.points}
                    initial={{ scale: 1.2, filter: "blur(4px)" }}
                    animate={{ scale: 1, filter: "blur(0px)" }}
                    className={`text-6xl md:text-7xl 2xl:text-9xl font-black leading-none tracking-tighter tabular-nums ${isTop1 ? 'text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.6)]' : 'text-blue-500'}`}
                  >
                    {rank.points}
                  </motion.span>
                </div>

                {/* Decorative Icon for Top 1 */}
                {isTop1 && (
                  <div className="absolute -right-8 -bottom-8 opacity-[0.07] pointer-events-none text-yellow-400 rotate-12">
                    <FaTrophy size={180} />
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {rankings.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center opacity-20">
            <GiShuttlecock size={80} className="mb-6 animate-bounce text-blue-400" />
            <p className="text-2xl md:text-3xl font-black uppercase tracking-[8px]">Waiting for Matches</p>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <footer className="shrink-0 text-center py-2">
        <p className="text-[9px] text-slate-600 font-bold uppercase tracking-[4px]">
          Points calculated from finished matches only (5, 4, 3, 2, 1 per category group)
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