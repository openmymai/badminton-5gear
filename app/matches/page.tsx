// app/matches/page.tsx

"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GiShuttlecock } from 'react-icons/gi';
import { FaCheckCircle, FaTimes, FaExternalLinkAlt, FaTrophy, FaBullhorn, FaHourglassHalf } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
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
  // ลำดับคิวภายในสนามนี้ ตามที่หน้า Admin จัดไว้ด้วย scheduleAvoidingBackToBack
  // (ให้แต่ละทีมได้พักระหว่างคู่มากที่สุด) — ใช้ sort คิวในหน้านี้แทนการพึ่งลำดับ
  // array ที่ได้รับผ่าน socket ตรงๆ ซึ่งอาจถูกต่อท้ายผิดลำดับตอน merge event
  // "match-updated"/"matches-updated" เข้ามาทีหลัง แมตช์เก่าที่ยังไม่มีค่านี้
  // (สร้างก่อนมีการเปลี่ยนแปลงนี้) จะ fallback เป็น 0 ในตอนคำนวณ
  order?: number;
}

interface TeamPlayersProps {
  players: Player[];
  focusClass: string;
  onNameBlur: (playerId: string, name: string) => void;
}

// สถานะของคู่แข่งขันในบริบทของ "คิวคอร์ท"
// announce = คู่แรกที่ยังไม่จบของคอร์ทนี้ (ต้องประกาศ / กำลังแข่ง)
// queued  = ยังไม่จบ แต่ไม่ใช่คิวแรกของคอร์ท (รอคิวอยู่)
// finished = จบแล้ว
type CourtMatchStatus = 'announce' | 'queued' | 'finished';

interface CourtSummary {
  court: string;
  list: Match[];
  announceMatch: Match | null;
  allFinished: boolean;
}

interface HighlightTarget {
  id: string;
  tone: 'purple' | 'green';
}

// รวม array ของแมตช์ที่อัปเดตเข้ากับ state เดิม โดยแทนที่เฉพาะรายการที่ id ตรงกัน
// แมตช์อื่นที่ไม่เกี่ยวข้องคง reference เดิมไว้ — ใช้กับทั้ง "match-updated" (แมตช์
// เดียว จากหน้า Score ที่กรรมการกดคะแนน) และ "matches-updated" (หลายแมตช์พร้อมกัน
// เช่นแก้สนามทั้งรุ่น/สาย หรือแก้ชื่อนักกีฬาที่หน้านี้เองก็เป็นคนส่ง event ไป)
const mergeMatchUpdates = (prev: Match[], updates: Match[]): Match[] => {
  if (updates.length === 0) return prev;
  const map = new Map(prev.map(m => [m.id, m]));
  updates.forEach(m => {
    if (m && m.id) map.set(m.id, m);
  });
  return Array.from(map.values());
};

// จัดกลุ่มแมตช์ตามสนาม แล้วเรียงลำดับ "ภายในแต่ละสนาม" ตาม field order ที่หน้า
// Admin ติดมาให้เสมอ (ดูคอมเมนต์ที่ interface Match ด้านบน) แทนที่จะพึ่งลำดับที่
// แมตช์เหล่านั้นบังเอิญเรียงอยู่ใน array `matches` ของ state ตอนนั้น — เพราะลำดับ
// array อาจไม่ตรงกับคิวจริงอีกต่อไปหลังมี match-updated/matches-updated เข้ามา
// merge ทับ (event ใหม่ที่ยังไม่เคยเห็น id จะถูกต่อท้าย ไม่ได้แทรกตามคิวที่ถูกต้อง)
// แมตช์ที่ยังไม่มี order (ข้อมูลเก่าก่อน deploy ฟีเจอร์นี้) จะ fallback เป็น 0 —
// การ sort เป็นแบบ stable จึงยังคงลำดับเดิมไว้ให้เหมือนพฤติกรรมก่อนหน้า
const groupMatchesByCourtOrdered = (list: Match[]): Record<string, Match[]> => {
  const byCourt: Record<string, Match[]> = {};
  list.forEach(m => {
    if (!byCourt[m.court]) byCourt[m.court] = [];
    byCourt[m.court].push(m);
  });
  Object.values(byCourt).forEach(arr => {
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  });
  return byCourt;
};

export default function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [baseUrl, setBaseUrl] = useState('');
  const [qrMatch, setQrMatch] = useState<{ id: string; url: string } | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // ref เก็บ DOM node ของแต่ละการ์ดคู่แข่งขัน ไว้ใช้ scrollIntoView
  const matchRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // การ์ดที่กำลังถูกไฮไลต์อยู่ตอนนี้ (หลังจากกด pill ในแผงสรุปด่วน)
  const [highlight, setHighlight] = useState<HighlightTarget | null>(null);
  // เป้าหมายที่รอ scroll ไปหา (ใช้ตอน filter ยังไม่ re-render เสร็จ)
  const [pendingScroll, setPendingScroll] = useState<HighlightTarget | null>(null);

  // --- Flash highlight สำหรับแผงประกาศด่วน ---
  // เก็บ "ลายเซ็น" สถานะล่าสุดของแต่ละคอร์ท (คู่ที่ต้องประกาศ + ครบหรือยัง)
  // เพื่อเทียบกับรอบก่อนหน้า ถ้าเปลี่ยน แปลว่ามีคู่จบใหม่ / คิวขยับ ให้กระพริบเตือน admin
  // ค้างกระพริบไว้จนกว่า admin จะกดการ์ดนั้นเพื่อไปประกาศคู่ต่อไป (ไม่หายไปเอง)
  const prevCourtSignatureRef = useRef<Record<string, string>>({});
  const hasMountedCourtRef = useRef(false);
  const [flashCourts, setFlashCourts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setBaseUrl(window.location.origin);
    socketRef.current = io();

    // ทั้งชุด — ตอนเชื่อมต่อครั้งแรก และตอน import Excel / ล้างข้อมูลทั้งหมด
    socketRef.current.on('data-updated', (data: { matches: Match[] }) => {
      if (data?.matches) setMatches(data.matches);
    });

    // คะแนน/สถานะของแมตช์เดียวเปลี่ยน — เกิดถี่ที่สุด เพราะทุกครั้งที่กรรมการกด
    // คะแนนในหน้า Score จะยิง event นี้มาที่นี่ด้วย (แทนที่ data-updated เดิม)
    socketRef.current.on('match-updated', (updatedMatch: Match) => {
      if (!updatedMatch?.id) return;
      setMatches(prev => mergeMatchUpdates(prev, [updatedMatch]));
    });

    // แก้สนามทั้งรุ่น/สาย หรือแก้ชื่อนักกีฬาที่กระทบหลายแมตช์พร้อมกัน (รวมถึงตอน
    // ที่หน้านี้เองเป็นคนส่ง update-group-court / update-player-name ไป — server
    // จะ broadcast event นี้กลับมาหาทุกคนรวมถึงตัวเองด้วย ทำให้ state ตรงกันเสมอ
    // โดยไม่ต้อง setState เองที่ handler ฝั่ง client)
    socketRef.current.on('matches-updated', (updatedMatches: Match[]) => {
      if (!Array.isArray(updatedMatches) || updatedMatches.length === 0) return;
      setMatches(prev => mergeMatchUpdates(prev, updatedMatches));
    });

    socketRef.current.on('action-error', (err: { message?: string }) => {
      if (err?.message) alert(err.message);
    });
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const categories = ['All', ...new Set(matches.map(m => m.category))];
  const filteredMatches = filterCategory === 'All' ? matches : matches.filter(m => m.category === filterCategory);

  // คำนวณสถานะของแต่ละคู่ โดยยึดลำดับคิวจริงต่อคอร์ท (field `order` ที่ admin
  // จัดพักทีมไว้) แทนลำดับ array เดิม — ดู groupMatchesByCourtOrdered ด้านบน
  const matchStatusMap = useMemo(() => {
    const map: Record<string, CourtMatchStatus> = {};
    const byCourt = groupMatchesByCourtOrdered(matches);
    Object.values(byCourt).forEach(list => {
      let announced = false;
      list.forEach(m => {
        if (m.isFinished) {
          map[m.id] = 'finished';
        } else if (!announced) {
          map[m.id] = 'announce';
          announced = true;
        } else {
          map[m.id] = 'queued';
        }
      });
    });
    return map;
  }, [matches]);

  // สรุปสถานะรายคอร์ท ใช้แสดงในแผงประกาศด่วนด้านบน — group เดียวกับ matchStatusMap
  // (เรียงตามคิวจริง) เพื่อให้ "คู่ถัดไปที่ต้องประกาศ" ตรงกับสถานะที่คำนวณไว้เป๊ะ
  const courtSummaries: CourtSummary[] = useMemo(() => {
    const byCourt = groupMatchesByCourtOrdered(matches);
    return Object.entries(byCourt)
      .map(([court, list]) => {
        const announceMatch = list.find(m => matchStatusMap[m.id] === 'announce') ?? null;
        const allFinished = list.length > 0 && list.every(m => m.isFinished);
        return { court, list, announceMatch, allFinished };
      })
      .sort((a, b) => {
        const na = parseInt(a.court, 10);
        const nb = parseInt(b.court, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.court.localeCompare(b.court);
      });
  }, [matches, matchStatusMap]);

  // ตรวจจับการเปลี่ยนแปลงสถานะรายคอร์ท เพื่อกระพริบเตือน admin ในแผงประกาศด่วน
  // (ข้ามการ flash ในการ render ครั้งแรกที่ข้อมูลเพิ่งโหลดเข้ามา)
  useEffect(() => {
    const prev = prevCourtSignatureRef.current;
    const next: Record<string, string> = {};

    courtSummaries.forEach(({ court, announceMatch, allFinished }) => {
      const signature = `${announceMatch?.id ?? 'none'}|${allFinished}`;
      next[court] = signature;

      const prevSignature = prev[court];
      const changed = hasMountedCourtRef.current && prevSignature !== undefined && prevSignature !== signature;

      if (changed) {
        // ค้างกระพริบไว้ตรงนี้ - จะถูกเคลียร์ก็ต่อเมื่อ admin กดการ์ดนี้ (ดู handleAcknowledgeCourt)
        setFlashCourts(f => ({ ...f, [court]: true }));
      }
    });

    prevCourtSignatureRef.current = next;
    hasMountedCourtRef.current = true;
  }, [courtSummaries]);

  // เลื่อนจอไปหาการ์ดคู่ที่เลือก + เปิดไฮไลต์ชั่วคราว
  const handleJumpToMatch = (matchId: string, tone: 'purple' | 'green') => {
    setFilterCategory('All');
    setPendingScroll({ id: matchId, tone });
  };

  // กดการ์ดคอร์ทในแผงประกาศด่วน = admin รับทราบแล้วว่าต้องไปประกาศ/เช็คคอร์ทนี้
  // เคลียร์ flash ของคอร์ทนั้นทิ้ง แล้วค่อย jump ไปหา match card ตามปกติ
  const handleAcknowledgeCourt = (court: string, matchId: string, tone: 'purple' | 'green') => {
    setFlashCourts(f => {
      if (!f[court]) return f;
      const copy = { ...f };
      delete copy[court];
      return copy;
    });
    handleJumpToMatch(matchId, tone);
  };

  useEffect(() => {
    if (!pendingScroll) return;
    const el = matchRefs.current[pendingScroll.id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlight(pendingScroll);
      setPendingScroll(null);
      const t = setTimeout(() => setHighlight(null), 2500);
      return () => clearTimeout(t);
    }
  }, [pendingScroll, filteredMatches]);

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
            <div className="leading-tight min-w-0">
              <h1 className="text-base lg:text-xl font-black uppercase tracking-tight truncate">Tournament Live</h1>
              <p className="text-[8px] lg:text-[9px] font-bold uppercase tracking-[3px] text-slate-500 truncate">Match Control Board</p>
            </div>
          </div>
          <div className="lg:hidden flex items-center gap-2">
            <Link href="/live" className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg font-bold text-[10px] text-amber-400">LIVE</Link>
            <Link href="/live-score" className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg font-bold text-[10px] text-slate-400">LIVE SCORE</Link>
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

      {/* Announcement Panel - fix อยู่เสมอ ไม่เลื่อนหาย เพราะอยู่นอกโซนที่ scroll */}
      <div className="z-40 bg-white/[0.03] backdrop-blur-xl border-b border-white/10 px-4 lg:px-8 py-3 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <FaBullhorn className="text-purple-400 text-[10px]" />
          <span className="text-[9px] font-black uppercase tracking-[3px] text-slate-500">สถานะคอร์ท - แผงประกาศด่วน</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {courtSummaries.length === 0 && (
            <span className="text-[11px] text-slate-600 font-bold">ยังไม่มีข้อมูลคอร์ท</span>
          )}
          {courtSummaries.map(({ court, list, announceMatch, allFinished }) => {
            const isFlashing = !!flashCourts[court];

            if (announceMatch) {
              return (
                <button
                  key={court}
                  onClick={() => handleAcknowledgeCourt(court, announceMatch.id, 'purple')}
                  className={`shrink-0 flex items-center gap-3 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/40 rounded-2xl px-4 py-2 transition-all active:scale-95 ${
                    isFlashing ? 'court-flash-purple' : ''
                  }`}
                >
                  <span className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center font-black text-sm text-purple-300 shrink-0">
                    {court}
                  </span>
                  <div className="flex flex-col items-start leading-tight">
                    <span className="text-[8px] font-black text-purple-400 uppercase tracking-widest">ต้องประกาศคู่ถัดไป</span>
                    <span className="text-[11px] font-bold text-white truncate max-w-[220px]">
                      {announceMatch.teamA.university} <span className="text-purple-400">vs</span> {announceMatch.teamB.university}
                    </span>
                    <span className="text-[9px] font-bold text-purple-300/70 uppercase truncate max-w-[220px]">
                      {announceMatch.category} · สาย {announceMatch.group}
                    </span>
                  </div>
                </button>
              );
            }
            if (allFinished && list.length > 0) {
              const lastMatch = list[list.length - 1];
              return (
                <button
                  key={court}
                  onClick={() => handleAcknowledgeCourt(court, lastMatch.id, 'green')}
                  className={`shrink-0 flex items-center gap-3 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 rounded-2xl px-4 py-2 transition-all active:scale-95 ${
                    isFlashing ? 'court-flash-green' : ''
                  }`}
                >
                  <span className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center font-black text-sm text-emerald-300 shrink-0">
                    {court}
                  </span>
                  <div className="flex flex-col items-start leading-tight">
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">แข่งครบแล้ว</span>
                    <span className="text-[9px] font-bold text-emerald-300/70 uppercase truncate max-w-[220px]">
                      {lastMatch.category} · สาย {lastMatch.group}
                    </span>
                  </div>
                </button>
              );
            }
            return null;
          })}
        </div>
      </div>

      {/* Match List Area */}
      <div className="flex-1 p-3 lg:p-6 space-y-4 overflow-y-auto scrollbar-hide">
        <AnimatePresence mode='popLayout'>
          {filteredMatches.map((m) => {
            const { setsA, setsB } = calculateEffectiveSets(m);
            const scoreUrl = `${baseUrl}/score/${encodeURIComponent(m.id)}`;
            const isWalkover = !!m.isBye;
            const walkoverWinnerName = m.byeWinner === 'a' ? m.teamA.university : m.byeWinner === 'b' ? m.teamB.university : null;
            const courtStatus: CourtMatchStatus = matchStatusMap[m.id] ?? 'finished';
            const isHighlighted = highlight?.id === m.id;

            return (
              <motion.div
                layout
                key={m.id}
                ref={(el: HTMLDivElement | null) => { matchRefs.current[m.id] = el; }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-white/[0.02] rounded-[2rem] border shadow-2xl overflow-hidden transition-all duration-500 ${
                  isHighlighted
                    ? highlight?.tone === 'purple'
                      ? 'border-purple-500/70 ring-4 ring-purple-500/40 ring-offset-2 ring-offset-[#05070d]'
                      : 'border-emerald-500/70 ring-4 ring-emerald-500/40 ring-offset-2 ring-offset-[#05070d]'
                    : 'border-white/10'
                }`}
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
                  <StatusBadge status={courtStatus} isWalkover={isWalkover} walkoverWinnerName={walkoverWinnerName} />
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

        /* Flash highlight สำหรับการ์ดคอร์ทในแผงประกาศด่วน เมื่อสถานะเปลี่ยน (มีคู่จบใหม่ / คิวขยับ) */
        @keyframes courtFlashPurple {
          0%, 100% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.55); transform: scale(1); }
          50% { box-shadow: 0 0 0 10px rgba(168, 85, 247, 0); transform: scale(1.05); }
        }
        @keyframes courtFlashGreen {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.55); transform: scale(1); }
          50% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); transform: scale(1.05); }
        }
        .court-flash-purple { animation: courtFlashPurple 1.1s ease-in-out infinite; }
        .court-flash-green { animation: courtFlashGreen 1.1s ease-in-out infinite; }
      `}</style>
    </main>
  );
}

// --- Status Badge Component ---
// status: announce (ต้องประกาศ/กำลังแข่ง - ม่วง) / queued (รอคิว - เทา) / finished (จบแล้ว - เขียว)
function StatusBadge({ status, isWalkover, walkoverWinnerName }: { status: CourtMatchStatus; isWalkover: boolean; walkoverWinnerName: string | null }) {
  if (isWalkover) return (
    <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded-lg">
      <FaTrophy className="text-amber-500 text-[10px]" />
      <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Walkover</span>
    </div>
  );

  if (status === 'announce') return (
    <div className="flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-lg shadow-[0_0_10px_rgba(168,85,247,0.15)]">
      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse shadow-[0_0_8px_#c084fc]" />
      <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">ต้องประกาศ</span>
    </div>
  );

  if (status === 'queued') return (
    <div className="flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-lg">
      <FaHourglassHalf className="text-slate-500 text-[9px]" />
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">รอคิว</span>
    </div>
  );

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
      <FaCheckCircle className="text-emerald-500 text-[10px]" />
      <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">จบแล้ว</span>
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
