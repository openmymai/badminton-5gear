"use client"

import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaCheckCircle, FaTimes, FaExternalLinkAlt, FaTrophy } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { calculateEffectiveSets } from '../../lib/scoring';

// --- Interfaces ---
interface Player {
  id: string;
  name: string;
  role: 'starter' | 'substitute';
}

interface Team {
  university: string;
  players: Player[];
}

interface Score {
  s1a: number;
  s1b: number;
  s2a: number;
  s2b: number;
}

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

interface TeamPlayersProps {
  players: Player[];
  focusClass: string;
  onNameBlur: (playerId: string, name: string) => void;
}

export default function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [baseUrl, setBaseUrl] = useState('');
  const [qrMatch, setQrMatch] = useState<{ id: string; url: string } | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    socketRef.current = io();
    socketRef.current.on('data-updated', (data: { matches: Match[] }) => {
      if (data?.matches) setMatches(data.matches);
    });
    socketRef.current.on('action-error', (err: { message?: string }) => {
      if (err?.message) alert(err.message);
    });
    return () => { socketRef.current?.disconnect(); };
  }, []);

  const categories = ['All', ...new Set(matches.map(m => m.category))];
  const filteredMatches = filterCategory === 'All' ? matches : matches.filter(m => m.category === filterCategory);
  const liveCount = matches.filter(m => !m.isFinished).length;

  const handleGlobalNameUpdate = (matchId: string, teamKey: 'teamA' | 'teamB', playerId: string, newName: string) => {
    if (!socketRef.current) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    const sourceMatch = matches.find(m => m.id === matchId);
    if (!sourceMatch) return;

    socketRef.current.emit('update-player-name', {
      university: sourceMatch[teamKey].university,
      category: sourceMatch.category,
      group: sourceMatch.group,
      playerId,
      newName: trimmed
    });
  };

  const handleCourtUpdate = (matchId: string, newCourt: string) => {
    const trimmed = newCourt.trim();
    if (!trimmed) return;
    const sourceMatch = matches.find(m => m.id === matchId);
    if (!sourceMatch) return;

    socketRef.current?.emit('update-group-court', {
      category: sourceMatch.category,
      group: sourceMatch.group,
      court: trimmed
    });
  };

  return (
    <main className="h-screen bg-[#05070d] text-white font-sans flex flex-col overflow-hidden">
      
      {/* Navigation Bar */}
      <nav className="z-50 bg-white/[0.03] backdrop-blur-xl border-b border-white/10 px-4 lg:px-8 py-3 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 shrink-0">
        <div className="flex items-center justify-between lg:justify-start gap-4 lg:gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-blue-600/15 border border-blue-500/30 rounded-xl p-2 shrink-0">
              <GiShuttlecock className="text-blue-400 text-xl lg:text-2xl" />
            </div>
            <div className="leading-tight min-w-0">
              <h1 className="text-base lg:text-xl font-black uppercase tracking-tight truncate">Tournament Live</h1>
              <p className="text-[8px] lg:text-[9px] font-bold uppercase tracking-[3px] text-slate-500 truncate">Match Control Board</p>
            </div>
          </div>
          <div className="lg:hidden flex items-center gap-2">
            <Link href="/live" className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg font-bold text-[10px] text-amber-400">LIVE</Link>
            <Link href="/admin" className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg font-bold text-[10px] text-slate-400">ADMIN</Link>
          </div>
        </div>

        <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`shrink-0 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                  filterCategory === cat ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Match List Area */}
      <div className="flex-1 p-3 lg:p-6 space-y-4 overflow-y-auto scrollbar-hide">
        <AnimatePresence mode='popLayout'>
          {filteredMatches.map((m) => {
            const { setsA, setsB } = calculateEffectiveSets(m);
            const scoreUrl = `${baseUrl}/score/${encodeURIComponent(m.id)}`;
            const isLive = !m.isFinished;
            const isWalkover = !!m.isBye;
            const walkoverWinnerName = m.byeWinner === 'a' ? m.teamA.university : m.byeWinner === 'b' ? m.teamB.university : null;

            return (
              <motion.div
                layout
                key={m.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/[0.02] rounded-[2rem] border border-white/10 shadow-2xl overflow-hidden"
              >
                {/* 1. Header Row: Court, Group and Status */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-white/[0.01]">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Court</span>
                      <input
                        type="text"
                        defaultValue={m.court}
                        onBlur={(e) => handleCourtUpdate(m.id, e.target.value)}
                        className="bg-blue-500/10 text-blue-400 w-9 h-9 rounded-xl text-center font-black text-base border border-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      />
                    </div>
                    <div className="h-4 w-px bg-white/10" />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-blue-400/80 uppercase leading-none">{m.category}</span>
                      <span className="text-[9px] font-bold text-amber-500/60 uppercase mt-1 leading-none">สาย {m.group}</span>
                    </div>
                  </div>
                  <StatusBadge isLive={isLive} isWalkover={isWalkover} walkoverWinnerName={walkoverWinnerName} />
                </div>

                {/* 2. Body Area: Stacked Scoreboard for Teams */}
                <div className="flex flex-col lg:flex-row">
                  
                  {/* Teams and Main Score */}
                  <div className="flex-1 p-5 lg:p-8 space-y-5">
                    
                    {/* Team A Row */}
                    <div className="flex items-center justify-between gap-6">
                      <div className="min-w-0 flex-1">
                        <h3 className={`text-2xl lg:text-4xl font-black uppercase truncate leading-tight tracking-tight ${setsA > setsB ? 'text-white' : 'text-slate-500'}`}>
                          {m.teamA.university}
                        </h3>
                        <TeamPlayers 
                          players={m.teamA.players} 
                          focusClass="focus:text-blue-400" 
                          onNameBlur={(pId: string, name: string) => handleGlobalNameUpdate(m.id, 'teamA', pId, name)} 
                        />
                      </div>
                      <div className={`w-14 h-14 lg:w-20 lg:h-20 flex items-center justify-center rounded-2xl border-2 font-black text-3xl lg:text-5xl shrink-0 transition-all duration-500 ${
                        setsA > setsB ? 'bg-blue-600/20 border-blue-500/50 text-blue-400 shadow-[0_0_25px_rgba(59,130,246,0.2)]' : 'bg-white/5 border-white/10 text-slate-700'
                      }`}>
                        {setsA}
                      </div>
                    </div>

                    {/* VS / Divider Line */}
                    <div className="flex items-center gap-4 py-1">
                      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                      <span className="text-[8px] font-black text-slate-800 uppercase tracking-[6px]">VERSUS</span>
                      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                    </div>

                    {/* Team B Row */}
                    <div className="flex items-center justify-between gap-6">
                      <div className="min-w-0 flex-1">
                        <h3 className={`text-2xl lg:text-4xl font-black uppercase truncate leading-tight tracking-tight ${setsB > setsA ? 'text-white' : 'text-slate-500'}`}>
                          {m.teamB.university}
                        </h3>
                        <TeamPlayers 
                          players={m.teamB.players} 
                          focusClass="focus:text-red-400" 
                          onNameBlur={(pId: string, name: string) => handleGlobalNameUpdate(m.id, 'teamB', pId, name)} 
                        />
                      </div>
                      <div className={`w-14 h-14 lg:w-20 lg:h-20 flex items-center justify-center rounded-2xl border-2 font-black text-3xl lg:text-5xl shrink-0 transition-all duration-500 ${
                        setsB > setsA ? 'bg-red-600/20 border-red-500/50 text-red-400 shadow-[0_0_25px_rgba(239,68,68,0.2)]' : 'bg-white/5 border-white/10 text-slate-700'
                      }`}>
                        {setsB}
                      </div>
                    </div>
                  </div>

                  {/* 3. Detail & Actions Panel */}
                  <div className="bg-black/30 lg:w-72 border-t lg:border-t-0 lg:border-l border-white/5 p-5 flex flex-col justify-center items-center gap-5">
                    
                    {/* Per-Set Score Details */}
                    <div className="w-full flex items-center justify-around bg-white/5 rounded-2xl border border-white/10 p-3">
                      <div className="text-center">
                        <p className="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Set 1</p>
                        <p className={`text-base font-black tabular-nums ${m.score.s1a >= 21 || m.score.s1b >= 21 ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {m.score.s1a} - {m.score.s1b}
                        </p>
                      </div>
                      <div className="w-px h-8 bg-white/10" />
                      <div className="text-center">
                        <p className="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Set 2</p>
                        <p className={`text-base font-black tabular-nums ${m.score.s2a >= 21 || m.score.s2b >= 21 ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {m.score.s2a} - {m.score.s2b}
                        </p>
                      </div>
                    </div>

                    {/* Main Action Buttons */}
                    <div className="flex gap-3 w-full">
                      <Link 
                        href={`/score/${encodeURIComponent(m.id)}`} 
                        className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl transition-all shadow-xl active:scale-95 group"
                      >
                        <FaExternalLinkAlt size={14} className="text-white/80 group-hover:scale-110 transition-transform" />
                        <span className="text-[11px] font-black uppercase tracking-wider">Score Control</span>
                      </Link>
                      <button 
                        onClick={() => setQrMatch({ id: m.id, url: scoreUrl })} 
                        className="bg-white p-3 rounded-2xl hover:bg-slate-100 transition-all active:scale-95 shadow-lg shrink-0"
                      >
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(scoreUrl)}&bgcolor=ffffff`} 
                          className="w-7 h-7" 
                          alt="QR" 
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Walkover / Special Tag Overlay */}
                {isWalkover && (
                  <div className="bg-amber-500/10 border-t border-amber-500/20 py-2.5 px-6 flex items-center justify-center gap-3">
                    <FaTrophy className="text-amber-500 text-[11px]" />
                    <span className="text-[10px] font-black text-amber-500 uppercase tracking-[4px]">
                      {walkoverWinnerName ? `${walkoverWinnerName} WIN BY WALKOVER` : 'DOUBLE WALKOVER'}
                    </span>
                  </div>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* QR Code Modal */}
      <AnimatePresence>
        {qrMatch && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            onClick={() => setQrMatch(null)} 
            className="fixed inset-0 bg-slate-950/98 z-[100] flex flex-col items-center justify-center p-8 backdrop-blur-md"
          >
            <button className="absolute top-10 right-10 text-slate-500 hover:text-white transition-colors">
              <FaTimes size={30} />
            </button>
            <div className="bg-white p-8 rounded-[3.5rem] shadow-[0_0_80px_rgba(59,130,246,0.3)]">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrMatch.url)}&bgcolor=ffffff`} 
                alt="QR" 
                className="w-80 h-80" 
              />
            </div>
            <p className="mt-12 font-black text-2xl text-blue-400 uppercase tracking-[8px] text-center">SCAN TO SCORE</p>
            <p className="mt-4 text-slate-600 text-[11px] font-bold uppercase tracking-widest">Tap anywhere to return</p>
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

// --- Status Badge Component ---
function StatusBadge({ isLive, isWalkover, walkoverWinnerName }: { isLive: boolean; isWalkover: boolean; walkoverWinnerName: string | null }) {
  if (isLive) return (
    <div className="flex items-center gap-2 px-3 py-1 bg-amber-400/10 border border-amber-400/30 rounded-lg shadow-[0_0_10px_rgba(251,191,36,0.1)]">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_#fbbf24]" />
      <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Live Now</span>
    </div>
  );
  if (isWalkover) return (
    <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded-lg">
      <FaTrophy className="text-amber-500 text-[10px]" />
      <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Walkover</span>
    </div>
  );
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
      <FaCheckCircle className="text-emerald-500 text-[10px]" />
      <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Finished</span>
    </div>
  );
}

// --- Team Players Component ---
function TeamPlayers({ players, focusClass, onNameBlur }: TeamPlayersProps) {
  const starters = players.filter(p => p.role === 'starter');
  const subs = players.filter(p => p.role === 'substitute');
  
  return (
    <div className="mt-2 space-y-1">
      {/* Starters Row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {starters.map(p => (
          <input 
            key={p.id} 
            type="text" 
            defaultValue={p.name} 
            onBlur={(e) => onNameBlur(p.id, e.target.value)} 
            className={`bg-transparent text-[11px] lg:text-[13px] font-bold text-slate-400 focus:outline-none border-b border-transparent hover:border-white/20 transition-all w-32 focus:w-40 ${focusClass}`} 
          />
        ))}
      </div>
      
      {/* Substitutes Row */}
      {subs.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-white/5">
          {subs.map(p => (
            <div key={p.id} className="flex items-center gap-1.5 group">
              <span className="text-[8px] font-black text-slate-700 uppercase tracking-tighter">SUB</span>
              <input 
                type="text" 
                defaultValue={p.name} 
                onBlur={(e) => onNameBlur(p.id, e.target.value)}
                className={`bg-transparent text-[10px] lg:text-[11px] font-medium text-slate-500 italic focus:not-italic focus:outline-none border-b border-transparent hover:border-white/10 transition-all w-28 ${focusClass}`} 
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}