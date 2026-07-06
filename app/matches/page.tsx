"use client"

import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaCheckCircle, FaMapMarkerAlt, FaTimes, FaExternalLinkAlt } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

export default function MatchesPage() {
  const [matches, setMatches] = useState<any[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [baseUrl, setBaseUrl] = useState('');
  const [qrMatch, setQrMatch] = useState<{ id: string; url: string } | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    socketRef.current = io();
    socketRef.current.on('data-updated', (data) => {
      if (data?.matches) setMatches(data.matches);
    });
    return () => { socketRef.current?.disconnect(); };
  }, []);

  const categories = ['All', ...new Set(matches.map(m => m.category))];
  const filteredMatches = filterCategory === 'All' ? matches : matches.filter(m => m.category === filterCategory);

  const liveCount = matches.filter(m => !m.isFinished).length;

  const calculateSetScore = (score: any) => {
    let setsA = 0; let setsB = 0;
    if (score.s1a === 21) setsA++; else if (score.s1b === 21) setsB++;
    if (score.s2a === 21) setsA++; else if (score.s2b === 21) setsB++;
    return { setsA, setsB };
  };

  const handleGlobalNameUpdate = (matchId: string, teamKey: 'teamA' | 'teamB', playerIdx: number, newName: string) => {
    if (!socketRef.current) return;
    const sourceMatch = matches.find(m => m.id === matchId);
    if (!sourceMatch) return;
    const targetUniversity = sourceMatch[teamKey].university;
    const targetCategory = sourceMatch.category;
    const targetGroup = sourceMatch.group;

    const updatedMatches = matches.map(m => {
      let newMatch = { ...m };
      if (m.teamA.university === targetUniversity && m.category === targetCategory && m.group === targetGroup) {
        const newPlayers = [...m.teamA.players];
        newPlayers[playerIdx].name = newName;
        newMatch.teamA = { ...m.teamA, players: newPlayers };
      }
      if (m.teamB.university === targetUniversity && m.category === targetCategory && m.group === targetGroup) {
        const newPlayers = [...m.teamB.players];
        newPlayers[playerIdx].name = newName;
        newMatch.teamB = { ...m.teamB, players: newPlayers };
      }
      return newMatch;
    });
    socketRef.current.emit('import-excel', updatedMatches);
  };

  const handleCourtUpdate = (matchId: string, newCourt: string) => {
    socketRef.current?.emit('update-score', { matchId, court: newCourt });
  };

  return (
    <main className="h-screen bg-[#05070d] text-white font-sans flex flex-col overflow-hidden">

      {/* Header */}
      <nav className="z-50 bg-white/[0.03] backdrop-blur-xl border-b border-white/10 px-8 py-3.5 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600/15 border border-blue-500/30 rounded-xl p-2">
              <GiShuttlecock className="text-blue-400 text-2xl" />
            </div>
            <div className="leading-tight">
              <h1 className="text-xl font-black uppercase tracking-tight">Tournament Live</h1>
              <p className="text-[9px] font-bold uppercase tracking-[3px] text-slate-500">Match Control Board</p>
            </div>
          </div>

          {/* Status summary */}
          <div className="hidden md:flex items-center gap-2 pl-8 border-l border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse" />
            <span className="text-xs font-bold text-slate-400"><span className="text-amber-400 font-black">{liveCount}</span> live now</span>
            <span className="text-xs font-bold text-slate-600">/ {matches.length} total</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Category tabs */}
          <div className="flex items-center gap-1 bg-white/[0.03] border border-white/10 rounded-xl p-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${
                  filterCategory === cat
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <Link href="/" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
            Ranking →
          </Link>
        </div>
      </nav>

      {/* Match List */}
      <div className="flex-1 p-4 space-y-3 overflow-y-auto scrollbar-hide">
        <AnimatePresence mode='popLayout'>
          {filteredMatches.map((m) => {
            const { setsA, setsB } = calculateSetScore(m.score);
            const scoreUrl = `${baseUrl}/score/${encodeURIComponent(m.id)}`;
            const isLive = !m.isFinished;

            return (
              <motion.div
                key={m.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="relative bg-white/[0.03] rounded-2xl border border-white/10 shadow-lg overflow-hidden h-[calc((100vh-150px)/5)] min-h-[132px] flex"
              >
                {/* Status accent bar */}
                <div className={`w-1.5 shrink-0 ${isLive ? 'bg-amber-400' : 'bg-emerald-500'}`} />

                {/* Court chip */}
                <div className="flex flex-col items-center justify-center gap-1 px-5 border-r border-white/5 shrink-0 w-24">
                  <span className="text-[8px] font-black uppercase tracking-[2px] text-slate-600">Court</span>
                  <input
                    type="text"
                    defaultValue={m.court}
                    onBlur={(e) => handleCourtUpdate(m.id, e.target.value)}
                    className="bg-transparent w-12 text-center text-3xl font-black text-blue-400 focus:text-white focus:outline-none tabular-nums"
                  />
                </div>

                {/* Body */}
                <div className="flex-1 grid grid-cols-12 items-center gap-3 px-6 py-3 min-w-0">

                  {/* Team A */}
                  <div className="col-span-4 text-right overflow-hidden">
                    <h3 className="text-3xl 2xl:text-4xl font-black uppercase text-white tracking-tight leading-none truncate">
                      {m.teamA.university}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap justify-end gap-x-2 gap-y-0.5">
                      {m.teamA.players.slice(0, 3).map((p: any, idx: number) => (
                        <input
                          key={p.id}
                          type="text"
                          defaultValue={p.name}
                          onBlur={(e) => handleGlobalNameUpdate(m.id, 'teamA', idx, e.target.value)}
                          className="bg-transparent text-right text-[10px] font-bold focus:text-blue-400 focus:outline-none border-b border-transparent focus:border-blue-400/40 w-24 transition-all text-slate-500 hover:text-slate-300"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Score */}
                  <div className="col-span-4 flex flex-col items-center gap-1.5">
                    <div className="w-full bg-black/40 py-2.5 px-4 rounded-2xl border border-white/10 flex flex-col items-center">
                      <div className="flex items-center gap-4 text-5xl 2xl:text-6xl font-black tabular-nums leading-none tracking-tighter">
                        <span className={setsA >= setsB ? 'text-blue-400' : 'text-slate-600'}>{setsA}</span>
                        <span className="text-slate-700 text-3xl">–</span>
                        <span className={setsB >= setsA ? 'text-red-400' : 'text-slate-600'}>{setsB}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-[11px] font-bold tabular-nums tracking-wider">
                        <span className={`px-2 py-0.5 rounded-md ${m.score.s1a === 21 || m.score.s1b === 21 ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'}`}>
                          {m.score.s1a}-{m.score.s1b}
                        </span>
                        <span className="text-slate-700">SET 1</span>
                        <span className="w-px h-3 bg-white/10" />
                        <span className="text-slate-700">SET 2</span>
                        <span className={`px-2 py-0.5 rounded-md ${m.score.s2a === 21 || m.score.s2b === 21 ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500'}`}>
                          {m.score.s2a}-{m.score.s2b}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Team B */}
                  <div className="col-span-4 text-left overflow-hidden">
                    <h3 className="text-3xl 2xl:text-4xl font-black uppercase text-white tracking-tight leading-none truncate">
                      {m.teamB.university}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      {m.teamB.players.slice(0, 3).map((p: any, idx: number) => (
                        <input
                          key={p.id}
                          type="text"
                          defaultValue={p.name}
                          onBlur={(e) => handleGlobalNameUpdate(m.id, 'teamB', idx, e.target.value)}
                          className="bg-transparent text-left text-[10px] font-bold focus:text-red-400 focus:outline-none border-b border-transparent focus:border-red-400/40 w-24 transition-all text-slate-500 hover:text-slate-300"
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right rail: category / status / QR */}
                <div className="flex flex-col items-end justify-between py-3 px-4 border-l border-white/5 shrink-0 w-48">
                  <div className="flex flex-col items-end gap-1">
                    {isLive ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-400/10 border border-amber-400/30 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Live</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full">
                        <FaCheckCircle className="text-emerald-500 text-[9px]" />
                        <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Finished</span>
                      </span>
                    )}
                    <div className="flex gap-1 text-[9px] font-bold uppercase">
                      <span className="text-blue-400/80">รุ่น {m.category}</span>
                      <span className="text-slate-700">·</span>
                      <span className="text-amber-500/80">สาย {m.group}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/score/${encodeURIComponent(m.id)}`}
                      className="flex items-center gap-1.5 text-slate-500 hover:text-blue-400 transition-colors group"
                      title="เปิดหน้าคีย์คะแนนของแมตช์นี้"
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">Open</span>
                      <div className="bg-white/5 group-hover:bg-blue-500/20 border border-white/10 group-hover:border-blue-400/40 p-2 rounded-md transition-colors">
                        <FaExternalLinkAlt size={13} />
                      </div>
                    </Link>

                    <button
                      onClick={() => setQrMatch({ id: m.id, url: scoreUrl })}
                      className="flex items-center gap-1.5 text-slate-500 hover:text-blue-400 transition-colors group"
                      title="แสดง QR ให้สแกนด้วยมือถือ"
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">Scan</span>
                      <div className="bg-white p-1 rounded-md">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(scoreUrl)}&bgcolor=ffffff`}
                          alt="QR"
                          className="w-8 h-8"
                        />
                      </div>
                    </button>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* QR Overlay */}
      <AnimatePresence>
        {qrMatch && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setQrMatch(null)}
            className="fixed inset-0 bg-slate-950/95 z-50 flex flex-col items-center justify-center p-8 backdrop-blur-sm"
          >
            <button className="absolute top-8 right-8 text-slate-500 hover:text-white p-3">
              <FaTimes size={22} />
            </button>
            <div className="bg-white p-6 rounded-[2.5rem] shadow-[0_0_50px_rgba(59,130,246,0.3)]">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrMatch.url)}&bgcolor=ffffff`}
                alt="QR"
                className="w-72 h-72"
              />
            </div>
            <p className="mt-8 font-black text-lg text-blue-400 uppercase tracking-widest text-center">Scan to open scorer</p>
            <p className="mt-2 text-slate-600 text-[10px] font-bold uppercase tracking-widest">Tap anywhere to close</p>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #05070d; overflow: hidden; }
        h1, h3, .font-black { font-family: 'Orbitron', sans-serif; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </main>
  );
}
