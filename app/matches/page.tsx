// app/matches/page.tsx

"use client"

import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaCheckCircle, FaMapMarkerAlt, FaTimes, FaExternalLinkAlt, FaTrophy } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { calculateEffectiveSets } from '../../lib/scoring';

interface Player { id: string; name: string; role: 'starter' | 'substitute'; }

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
    socketRef.current.on('action-error', (err: { message?: string }) => {
      if (err?.message) alert(err.message);
    });
    return () => { socketRef.current?.disconnect(); };
  }, []);

  const categories = ['All', ...new Set(matches.map(m => m.category))];
  const filteredMatches = filterCategory === 'All' ? matches : matches.filter(m => m.category === filterCategory);

  const liveCount = matches.filter(m => !m.isFinished).length;

  // Renames a player once, and it takes effect everywhere that player appears: every
  // match for the same team (university + category + group) AND the admin roster
  // itself, via a dedicated server event — so the correction also survives the next
  // time the admin regenerates the schedule (e.g. after importing more players).
  const handleGlobalNameUpdate = (matchId: string, teamKey: 'teamA' | 'teamB', playerId: string, newName: string) => {
    if (!socketRef.current) return;
    const trimmed = newName.trim();
    if (!trimmed) return; // ignore accidental empty edits, keep the previous name shown
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

  // Updates the court for the entire category+group, not just this one match — every
  // pairing in the same รุ่น/สาย always plays on the same court, so a single-match edit
  // used to silently desync the rest of that group's schedule.
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

      {/* Header */}
      <nav className="z-50 bg-white/[0.03] backdrop-blur-xl border-b border-white/10 px-4 lg:px-8 py-3 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 shrink-0">

        {/* Row 1 (mobile) / left group (desktop): logo + status summary */}
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

          {/* Nav links — shown here on mobile (row 1), moved to the right group on desktop */}
          <div className="lg:hidden flex items-center gap-2 shrink-0">
            <Link href="/live" className="px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl font-bold transition-all text-[10px] uppercase tracking-wider text-amber-400">
              Live Board
            </Link>
            <Link href="/" className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[10px] uppercase tracking-wider text-slate-300">
              Ranking →
            </Link>
          </div>

          {/* Status summary */}
          <div className="hidden md:flex items-center gap-2 pl-8 border-l border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse" />
            <span className="text-xs font-bold text-slate-400"><span className="text-amber-400 font-black">{liveCount}</span> live now</span>
            <span className="text-xs font-bold text-slate-600">/ {matches.length} total</span>
          </div>
        </div>

        {/* Row 2 (mobile) / right group (desktop): category tabs + nav links */}
        <div className="flex items-center gap-3 lg:gap-6 min-w-0">
          {/* Category tabs — horizontally scrollable so they never overflow the screen */}
          <div className="flex items-center gap-1 bg-white/[0.03] border border-white/10 rounded-xl p-1 overflow-x-auto scrollbar-hide max-w-full">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`shrink-0 px-3.5 lg:px-4 py-1.5 rounded-lg text-[10px] lg:text-[11px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                  filterCategory === cat
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="hidden lg:flex items-center gap-2 shrink-0">
            <Link href="/admin" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              ← Admin
            </Link>
            <Link href="/live" className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-amber-400">
              Live Board
            </Link>
            <Link href="/" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-slate-300">
              Ranking →
            </Link>
          </div>
        </div>
      </nav>

      {/* Match List */}
      <div className="flex-1 p-4 space-y-3 overflow-y-auto scrollbar-hide">
        <AnimatePresence mode='popLayout'>
          {filteredMatches.map((m) => {
            const { setsA, setsB } = calculateEffectiveSets(m);
            const scoreUrl = `${baseUrl}/score/${encodeURIComponent(m.id)}`;
            const isLive = !m.isFinished;
            const isWalkover = !!m.isBye;
            const walkoverWinnerName = m.byeWinner === 'a' ? m.teamA.university : m.byeWinner === 'b' ? m.teamB.university : null;

            return (
              <motion.div
                key={m.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="relative bg-white/[0.03] rounded-2xl border border-white/10 shadow-lg overflow-hidden flex flex-wrap lg:flex-nowrap lg:min-h-[140px]"
              >
                {/* Status accent bar — top strip on mobile, left rail on desktop */}
                <div className={`w-full h-1 lg:w-1.5 lg:h-auto shrink-0 ${isLive ? 'bg-amber-400' : isWalkover ? 'bg-amber-500' : 'bg-emerald-500'}`} />

                {/* Court chip */}
                <div className="flex flex-row lg:flex-col items-center justify-center gap-2 lg:gap-1 px-4 lg:px-5 py-2 lg:py-0 border-b lg:border-b-0 lg:border-r border-white/5 shrink-0 w-1/2 lg:w-24">
                  <span className="text-[8px] font-black uppercase tracking-[2px] text-slate-600">Court</span>
                  <input
                    type="text"
                    defaultValue={m.court}
                    onBlur={(e) => handleCourtUpdate(m.id, e.target.value)}
                    className="bg-transparent w-10 lg:w-12 text-center text-2xl lg:text-3xl font-black text-blue-400 focus:text-white focus:outline-none tabular-nums"
                  />
                </div>

                {/* Status + category — mobile-only compact block, paired with court chip to form row 1 */}
                <div className="flex lg:hidden w-1/2 items-center justify-end gap-2 px-4 py-2 border-b border-white/5">
                  <StatusBadge isLive={isLive} isWalkover={isWalkover} walkoverWinnerName={walkoverWinnerName} />
                </div>

                {/* Body: teams + score. grid-cols-2 on mobile lets 1-span team cells sit side by side while
                    the 2-span score cell auto-wraps to its own full-width row underneath — no extra markup needed. */}
                <div className="w-full lg:flex-1 grid grid-cols-2 lg:grid-cols-12 items-center gap-2 lg:gap-3 px-4 lg:px-6 py-3 min-w-0">

                  {/* Team A */}
                  <div className="col-span-1 lg:col-span-4 min-w-0 text-right">
                    <h3 className="text-xl sm:text-2xl lg:text-3xl 2xl:text-4xl font-black uppercase text-white tracking-tight leading-none truncate">
                      {m.teamA.university}
                    </h3>
                    <TeamPlayers
                      players={m.teamA.players}
                      align="right"
                      focusClass="focus:text-blue-400 focus:border-blue-400/40"
                      onNameBlur={(playerId, name) => handleGlobalNameUpdate(m.id, 'teamA', playerId, name)}
                    />
                  </div>

                  {/* Score */}
                  <div className="col-span-2 lg:col-span-4 flex flex-col items-center gap-1.5 mt-2 lg:mt-0">
                    <div className="w-full bg-black/40 py-2 lg:py-2.5 px-4 rounded-2xl border border-white/10 flex flex-col items-center">
                      <div className="flex items-center gap-3 lg:gap-4 text-4xl sm:text-5xl lg:text-5xl 2xl:text-6xl font-black tabular-nums leading-none tracking-tighter">
                        <span className={setsA >= setsB ? 'text-blue-400' : 'text-slate-600'}>{setsA}</span>
                        <span className="text-slate-700 text-2xl lg:text-3xl">–</span>
                        <span className={setsB >= setsA ? 'text-red-400' : 'text-slate-600'}>{setsB}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 lg:gap-3 text-[10px] lg:text-[11px] font-bold tabular-nums tracking-wider">
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
                      {isWalkover && (
                        <div className="mt-1.5 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-amber-400">
                          <FaTrophy size={9} />
                          {walkoverWinnerName ? `Walkover · ${walkoverWinnerName} ชนะ` : 'Double Walkover · ไม่มีผู้ชนะ'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Team B */}
                  <div className="col-span-1 lg:col-span-4 min-w-0 text-left">
                    <h3 className="text-xl sm:text-2xl lg:text-3xl 2xl:text-4xl font-black uppercase text-white tracking-tight leading-none truncate">
                      {m.teamB.university}
                    </h3>
                    <TeamPlayers
                      players={m.teamB.players}
                      align="left"
                      focusClass="focus:text-red-400 focus:border-red-400/40"
                      onNameBlur={(playerId, name) => handleGlobalNameUpdate(m.id, 'teamB', playerId, name)}
                    />
                  </div>
                </div>

                {/* Mobile-only footer row: category tags + action icons (desktop shows these in the right rail instead) */}
                <div className="flex lg:hidden w-full items-center justify-between gap-2 px-4 py-2 border-t border-white/5">
                  <div className="flex gap-1 text-[9px] font-bold uppercase">
                    <span className="text-blue-400/80">รุ่น {m.category}</span>
                    <span className="text-slate-700">·</span>
                    <span className="text-amber-500/80">สาย {m.group}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href={`/score/${encodeURIComponent(m.id)}`} className="text-slate-500 hover:text-blue-400 transition-colors" title="เปิดหน้าคีย์คะแนนของแมตช์นี้">
                      <div className="bg-white/5 border border-white/10 p-1.5 rounded-md">
                        <FaExternalLinkAlt size={11} />
                      </div>
                    </Link>
                    <button onClick={() => setQrMatch({ id: m.id, url: scoreUrl })} className="text-slate-500 hover:text-blue-400 transition-colors" title="แสดง QR ให้สแกนด้วยมือถือ">
                      <div className="bg-white p-1 rounded-md">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(scoreUrl)}&bgcolor=ffffff`}
                          alt="QR"
                          className="w-7 h-7"
                        />
                      </div>
                    </button>
                  </div>
                </div>

                {/* Right rail: category / status / QR — desktop only */}
                <div className="hidden lg:flex flex-col items-end justify-between py-3 px-4 border-l border-white/5 shrink-0 w-48">
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge isLive={isLive} isWalkover={isWalkover} walkoverWinnerName={walkoverWinnerName} />
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

// Live / Walkover / Finished — one badge, three possible states. Walkover takes
// priority over the plain "Finished" look since it's the more informative state.
function StatusBadge({ isLive, isWalkover, walkoverWinnerName }: { isLive: boolean; isWalkover: boolean; walkoverWinnerName: string | null }) {
  if (isLive) {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-400/10 border border-amber-400/30 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Live</span>
      </span>
    );
  }
  if (isWalkover) {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded-full" title={walkoverWinnerName ? `${walkoverWinnerName} ชนะแบบ Walkover` : 'ไม่มีผู้ชนะ (Double Walkover)'}>
        <FaTrophy className="text-amber-400 text-[9px]" />
        <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Walkover</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full">
      <FaCheckCircle className="text-emerald-500 text-[9px]" />
      <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Finished</span>
    </span>
  );
}

// Renders a team's starters (bold, prominent) and ALL substitutes (dimmer, each
// labeled "สำรอง") as clearly separated rows. Uses .filter() rather than .find()
// so every substitute shows up, not just the first one. Fields are wide enough,
// and don't truncate, so the full name is always visible instead of being clipped.
function TeamPlayers({
  players,
  align,
  focusClass,
  onNameBlur
}: {
  players: Player[];
  align: 'left' | 'right';
  focusClass: string;
  onNameBlur: (playerId: string, name: string) => void;
}) {
  const starters = players.filter(p => p.role === 'starter');
  const substitutes = players.filter(p => p.role === 'substitute');
  const alignItems = align === 'right' ? 'items-end' : 'items-start';
  const justify = align === 'right' ? 'justify-end' : 'justify-start';
  const textAlign = align === 'right' ? 'text-right' : 'text-left';

  return (
    <div className={`mt-1.5 flex flex-col gap-1 ${alignItems}`}>
      {starters.length > 0 && (
        <div className={`flex flex-wrap gap-x-2 gap-y-0.5 ${justify}`}>
          {starters.map(p => (
            <input
              key={p.id}
              type="text"
              defaultValue={p.name}
              onBlur={(e) => onNameBlur(p.id, e.target.value)}
              size={Math.max(8, p.name.length + 1)}
              className={`bg-transparent ${textAlign} text-[10px] lg:text-[11px] font-bold ${focusClass} focus:outline-none border-b border-transparent transition-all min-w-[5rem] max-w-[14rem] text-slate-300 hover:text-white`}
            />
          ))}
        </div>
      )}
      {substitutes.map(sub => (
        <div key={sub.id} className={`flex items-center gap-1.5 ${justify}`}>
          <span className="text-[7px] lg:text-[8px] font-black uppercase tracking-wider text-slate-700 shrink-0">สำรอง</span>
          <input
            type="text"
            defaultValue={sub.name}
            onBlur={(e) => onNameBlur(sub.id, e.target.value)}
            size={Math.max(8, sub.name.length + 1)}
            className={`bg-transparent ${textAlign} text-[9px] lg:text-[10px] italic ${focusClass} focus:outline-none focus:not-italic border-b border-transparent transition-all min-w-[4rem] max-w-[12rem] text-slate-600 hover:text-slate-400`}
          />
        </div>
      ))}
    </div>
  );
}
