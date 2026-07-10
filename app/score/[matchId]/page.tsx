"use client"

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  MdRemove,
  MdSave,
  MdArrowBackIos,
  MdSync,
  MdSyncDisabled,
  MdQrCodeScanner,
  MdEditNote,
  MdCheckCircle,
  MdErrorOutline,
  MdLocationOn,
  MdUndo,
  MdEmojiEvents
} from 'react-icons/md';
import { GiShuttlecock } from 'react-icons/gi';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

// --- Types ---
interface Player { id: string; name: string; role: 'starter' | 'substitute'; }
interface ScoreState { s1a: number; s1b: number; s2a: number; s2b: number; }
interface MatchData {
  id: string; category: string; group: string; court: string;
  teamA: { university: string; players: Player[] };
  teamB: { university: string; players: Player[] };
  score: ScoreState;
  isFinished: boolean;
  isBye?: boolean;
  byeWinner?: 'a' | 'b' | null;
}

interface UpdateScorePayload {
  matchId: string;
  score: ScoreState;
  isFinished: boolean;
  isBye?: boolean;
  byeWinner?: 'a' | 'b' | null;
}

function getSetWinner(a: number, b: number): 'a' | 'b' | null {
  if (a === 21) return 'a';
  if (b === 21) return 'b';
  return null;
}

function getEffectiveSetWinner(
  a: number,
  b: number,
  isBye?: boolean,
  byeWinner?: 'a' | 'b' | null
): 'a' | 'b' | null {
  const real = getSetWinner(a, b);
  if (real) return real;
  if (isBye && byeWinner) return byeWinner;
  return null;
}

function vibrate(pattern: number | number[]) {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}

const EMIT_DEBOUNCE_MS = 150;
const IGNORE_SERVER_SYNC_MS = 2000; // ป้องกัน Echo ดีดกลับเป็นเวลา 2 วินาทีหลังกด

export default function ScorerPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = decodeURIComponent(params.matchId as string);

  const socketRef = useRef<Socket | null>(null);
  const [match, setMatch] = useState<MatchData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- Refs for Performance & Sync ---
  const scoreRef = useRef<ScoreState | null>(null);
  const emitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEmitRef = useRef<UpdateScorePayload | null>(null);
  const lastTapTimeRef = useRef<number>(0); 

  const cancelPendingEmit = useCallback(() => {
    if (emitTimeoutRef.current) {
      clearTimeout(emitTimeoutRef.current);
      emitTimeoutRef.current = null;
    }
    pendingEmitRef.current = null;
  }, []);

  const flushPendingEmit = useCallback(() => {
    if (emitTimeoutRef.current) {
      clearTimeout(emitTimeoutRef.current);
      emitTimeoutRef.current = null;
    }
    if (pendingEmitRef.current) {
      socketRef.current?.emit('update-score', pendingEmitRef.current);
      pendingEmitRef.current = null;
    }
  }, []);

  const scheduleEmit = useCallback((payload: UpdateScorePayload) => {
    pendingEmitRef.current = payload;
    if (emitTimeoutRef.current) clearTimeout(emitTimeoutRef.current);
    emitTimeoutRef.current = setTimeout(() => {
      emitTimeoutRef.current = null;
      if (pendingEmitRef.current) {
        socketRef.current?.emit('update-score', pendingEmitRef.current);
        pendingEmitRef.current = null;
      }
    }, EMIT_DEBOUNCE_MS);
  }, []);

  const historyRef = useRef<ScoreState[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [server, setServer] = useState<{ s1: 'a' | 'b'; s2: 'a' | 'b' }>({ s1: 'a', s2: 'a' });
  const [byeMode, setByeMode] = useState(false);

  useEffect(() => {
    setCurrentUrl(window.location.href);
    socketRef.current = io();

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      socketRef.current?.emit('get-match-details', matchId);
    });

    socketRef.current.on('disconnect', () => setIsConnected(false));

    socketRef.current.on('data-updated', (data: { matches: MatchData[] }) => {
      const currentMatch = data.matches.find(m => m.id === matchId);
      if (currentMatch) {
        // --- RACE CONDITION FIX ---
        // ถ้าเพิ่งมีการกดแต้มในเครื่องนี้ (ไม่เกิน 2 วิ) ห้ามเอาเลขจาก server มาทับ
        const isRecentlyTapped = Date.now() - lastTapTimeRef.current < IGNORE_SERVER_SYNC_MS;
        
        if (isRecentlyTapped && scoreRef.current) {
          setMatch(prev => (prev ? {
            ...currentMatch,
            score: scoreRef.current! 
          } : currentMatch));
        } else {
          scoreRef.current = currentMatch.score;
          setMatch(currentMatch);
        }
      }
    });

    socketRef.current.on('match-data', (data: MatchData) => {
      scoreRef.current = data.score;
      setMatch(data);
    });

    return () => {
      flushPendingEmit();
      socketRef.current?.disconnect();
    };
  }, [matchId, flushPendingEmit]);

  const pushHistory = useCallback((prev: ScoreState) => {
    historyRef.current = [...historyRef.current.slice(-9), prev];
    setCanUndo(true);
  }, []);

  const updateScore = (field: keyof ScoreState, delta: number) => {
    if (!match || !scoreRef.current) return;
    setErrorMsg(null);

    // บันทึกเวลาที่เปลี่ยนแต้ม
    lastTapTimeRef.current = Date.now();

    const baseScore = scoreRef.current;
    pushHistory(baseScore);

    const newScore: ScoreState = {
      ...baseScore,
      [field]: Math.min(Math.max(0, baseScore[field] + delta), 21)
    };

    scoreRef.current = newScore;
    setMatch(prev => (prev ? { ...prev, score: newScore } : prev));

    scheduleEmit({
      matchId: match.id,
      score: newScore,
      isFinished: match.isFinished
    });

    vibrate(delta > 0 ? 12 : 25);
  };

  const handleUndo = () => {
    if (!match || historyRef.current.length === 0) return;
    const prevScore = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    setCanUndo(historyRef.current.length > 0);
    setErrorMsg(null);
    vibrate([10, 40, 10]);

    lastTapTimeRef.current = Date.now();
    scoreRef.current = prevScore;
    setMatch(prev => (prev ? { ...prev, score: prevScore } : prev));

    cancelPendingEmit();
    socketRef.current?.emit('update-score', {
      matchId: match.id,
      score: prevScore,
      isFinished: match.isFinished
    });
  };

  const validateMatch = (): boolean => {
    if (!match) return false;
    const { s1a, s1b, s2a, s2b } = match.score;
    const isValidSet = (a: number, b: number) => {
      if (a === 21 && b === 21) return { valid: false, msg: "แต้มต้องไม่เป็น 21 เท่ากัน" };
      if (a < 21 && b < 21) return { valid: false, msg: "ต้องมีฝ่ายใดฝ่ายหนึ่งได้ 21 แต้ม" };
      return { valid: true };
    };
    const set1 = isValidSet(s1a, s1b);
    if (!set1.valid) { setErrorMsg(`Set 1: ${set1.msg}`); return false; }
    const set2 = isValidSet(s2a, s2b);
    if (!set2.valid) { setErrorMsg(`Set 2: ${set2.msg}`); return false; }
    return true;
  };

  const handleUpdateStatus = (finish: boolean) => {
    if (finish) {
      if (!validateMatch()) { vibrate([20, 30, 20, 30, 20]); return; }
      if (!confirm('ยืนยันบันทึกผลการแข่งขัน?')) return;
    } else {
      if (!confirm('ต้องการแก้ไขสถานะเป็นกำลังแข่งขัน?')) return;
    }

    const updated: MatchData | null = match
      ? finish
        ? { ...match, isFinished: true }
        : { ...match, isFinished: false, isBye: false, byeWinner: null }
      : null;

    if (updated) setMatch(updated);

    cancelPendingEmit();
    socketRef.current?.emit('update-score', {
      matchId: matchId,
      score: updated?.score ?? match?.score,
      isFinished: finish,
      isBye: updated?.isBye ?? false,
      byeWinner: updated?.byeWinner ?? null
    });

    if (finish) {
      vibrate([15, 40, 15, 40, 60]);
      alert("บันทึกผลสำเร็จ!");
      router.push('/matches');
    } else {
      vibrate(15);
    }
  };

  const handleByeWin = (winner: 'a' | 'b' | null) => {
    if (!match) return;
    const winnerName = winner === 'a' ? match.teamA.university : winner === 'b' ? match.teamB.university : null;
    const confirmMsg = winnerName ? `ยืนยันให้ "${winnerName}" ชนะแบบ Walkover?` : `ยืนยัน "ไม่มีผู้ชนะ"?`;
    if (!confirm(confirmMsg)) return;

    setErrorMsg(null);
    setMatch({ ...match, isFinished: true, isBye: true, byeWinner: winner });

    cancelPendingEmit();
    socketRef.current?.emit('update-score', {
      matchId: match.id,
      score: match.score,
      isFinished: true,
      isBye: true,
      byeWinner: winner
    });

    setByeMode(false);
    vibrate([15, 40, 15, 40, 60]);
    alert("บันทึกผลสำเร็จ!");
    router.push('/matches');
  };

  if (!match) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
      <GiShuttlecock className="animate-bounce text-blue-500 mb-4" size={60} />
      <p className="text-xl font-bold animate-pulse uppercase tracking-[5px]">Connecting...</p>
    </div>
  );

  const set1Winner = getEffectiveSetWinner(match.score.s1a, match.score.s1b, match.isBye, match.byeWinner);
  const set2Winner = getEffectiveSetWinner(match.score.s2a, match.score.s2b, match.isBye, match.byeWinner);
  const setsWonA = [set1Winner, set2Winner].filter(w => w === 'a').length;
  const setsWonB = [set1Winner, set2Winner].filter(w => w === 'b').length;
  const leadingA = match.isBye ? match.byeWinner === 'a' : setsWonA > setsWonB;
  const leadingB = match.isBye ? match.byeWinner === 'b' : setsWonB > setsWonA;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-blue-950 text-white font-sans pb-10">

      <header className="bg-white/5 backdrop-blur-xl sticky top-0 z-40 border-b border-white/10 p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <Link href="/matches" className="text-slate-400 p-2 hover:bg-white/5 rounded-xl transition-colors">
            <MdArrowBackIos size={20} />
          </Link>
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <div className="bg-blue-600 px-3 py-1 rounded-lg border border-blue-400/50 flex items-center gap-2 shadow-[0_0_15px_rgba(37,99,235,0.4)]">
                <MdLocationOn className="text-white text-xs" />
                <span className="text-sm font-black uppercase tracking-tighter">Court {match.court || '-'}</span>
              </div>
            </div>
            <div className="flex gap-2 justify-center">
              <span className="text-[9px] text-blue-400 font-bold uppercase tracking-widest">{match.category}</span>
              <span className="text-[9px] text-slate-500 font-bold uppercase">|</span>
              <span className="text-[9px] text-amber-500 font-bold uppercase tracking-widest">สาย {match.group}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowQR(true)} className="text-blue-400 p-2 bg-blue-400/10 rounded-xl border border-blue-400/20"><MdQrCodeScanner size={18} /></button>
            {isConnected ? <MdSync className="text-green-500 animate-spin-slow" size={18} /> : <MdSyncDisabled className="text-red-500" />}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className={`flex items-center justify-center gap-2 rounded-xl py-1.5 border transition-colors ${leadingA ? 'bg-blue-500/15 border-blue-400/40' : 'bg-white/5 border-white/10'}`}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-300 truncate max-w-[90px]">{match.teamA.university}</span>
            <span className="text-lg font-black text-blue-300 tabular-nums">{setsWonA}</span>
          </div>
          <div className={`flex items-center justify-center gap-2 rounded-xl py-1.5 border transition-colors ${leadingB ? 'bg-red-500/15 border-red-400/40' : 'bg-white/5 border-white/10'}`}>
            <span className="text-lg font-black text-red-300 tabular-nums">{setsWonB}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-300 truncate max-w-[90px]">{match.teamB.university}</span>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {errorMsg && (
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }}
            className="mx-4 mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-2xl flex items-center gap-3 text-red-200 shadow-lg">
            <MdErrorOutline size={24} />
            <p className="text-sm font-bold">{errorMsg}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-md mx-auto p-4 space-y-5">
        <div className="grid grid-cols-2 bg-white/5 backdrop-blur-md rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden divide-x divide-white/5">
          <TeamDisplay team={match.teamA} color="text-blue-400" won={setsWonA} align="left" isMatchWinner={match.isFinished && leadingA} />
          <TeamDisplay team={match.teamB} color="text-red-400" won={setsWonB} align="right" isMatchWinner={match.isFinished && leadingB} />
        </div>

        {match.isBye && (
          <div className="flex items-center justify-center gap-2 bg-amber-400/10 border border-amber-400/30 rounded-2xl py-2.5">
            <MdEmojiEvents className="text-amber-400" size={16} />
            <span className="text-[11px] font-black text-amber-400 uppercase tracking-[3px]">
              {match.byeWinner ? `Walkover — ${match.byeWinner === 'a' ? match.teamA.university : match.teamB.university} ชนะ` : 'Double Walkover'}
            </span>
          </div>
        )}

        {(['1', '2'] as const).map((s) => {
          const aKey = `s${s}a` as keyof ScoreState;
          const bKey = `s${s}b` as keyof ScoreState;
          const scoreA = match.score[aKey];
          const scoreB = match.score[bKey];
          const winner = s === '1' ? set1Winner : set2Winner;
          const isDecided = winner !== null;
          const leader = scoreA > scoreB ? 'a' : scoreB > scoreA ? 'b' : null;
          const leadScore = Math.max(scoreA, scoreB);
          const serverKey = s === '1' ? 's1' : 's2';

          return (
            <div key={s} className={`relative rounded-[3rem] p-6 border shadow-2xl transition-all ${isDecided ? 'bg-white/[0.02] border-white/5 opacity-60' : 'bg-white/5 border-white/10'}`}>
              <div className="flex items-center justify-center gap-2 mb-4">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[4px]">Set {s}</span>
                {isDecided && <MdCheckCircle className="text-green-500" size={14} />}
                {!isDecided && leadScore >= 20 && (
                  <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full animate-pulse">
                    <MdEmojiEvents size={11} /> {leadScore >= 29 ? 'Final Point' : 'Game Point'}
                  </span>
                )}
              </div>
              <div className="flex justify-around items-start relative z-10">
                {/* 
                  จุดแก้ไขสำคัญ: ปุ่ม ScoreControl จะ disable เฉพาะเมื่อ "จบแมตช์ (match.isFinished)" เท่านั้น
                  แม้จะจบเซ็ต (isDecided) ก็ยังยอมให้กดเพื่อแก้ไขความผิดพลาดได้
                */}
                <ScoreControl 
                  value={scoreA} 
                  color="blue" 
                  disabled={match.isFinished} 
                  isServing={!isDecided && server[serverKey] === 'a'} 
                  onTap={() => setServer(v => ({ ...v, [serverKey]: 'a' }))} 
                  onUp={() => updateScore(aKey, 1)} 
                  onDown={() => updateScore(aKey, -1)} 
                />
                <div className="h-24 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent mt-6" />
                <ScoreControl 
                  value={scoreB} 
                  color="red" 
                  disabled={match.isFinished} 
                  isServing={!isDecided && server[serverKey] === 'b'} 
                  onTap={() => setServer(v => ({ ...v, [serverKey]: 'b' }))} 
                  onUp={() => updateScore(bKey, 1)} 
                  onDown={() => updateScore(bKey, -1)} 
                />
              </div>
            </div>
          );
        })}

        <button onClick={handleUndo} disabled={!canUndo} className={`w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 border transition-all ${canUndo ? 'bg-white/5 border-white/15 text-slate-200 active:scale-95' : 'bg-white/[0.02] border-white/5 text-slate-600 cursor-not-allowed'}`}>
          <MdUndo size={18} /> ย้อนกลับแต้มล่าสุด
        </button>

        {!match.isFinished && (
          <div className="space-y-3">
            {!byeMode ? (
              <button onClick={() => setByeMode(true)} className="w-full py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 border border-amber-400/25 bg-amber-400/5 text-amber-400 active:scale-95 transition-all"><MdEmojiEvents size={16} /> บันทึกผลแบบ Walkover / Bye</button>
            ) : (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="bg-amber-400/5 border border-amber-400/25 rounded-[2rem] p-4 space-y-3">
                <p className="text-center text-[10px] font-black text-amber-400 uppercase tracking-[3px]">เลือกทีมที่ชนะการแข่งขัน</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => handleByeWin('a')} className="py-4 rounded-2xl font-black text-sm bg-blue-500/15 border border-blue-400/30 text-blue-300 active:scale-95 transition-all">{match.teamA.university}</button>
                  <button onClick={() => handleByeWin('b')} className="py-4 rounded-2xl font-black text-sm bg-red-500/15 border border-red-400/30 text-red-300 active:scale-95 transition-all">{match.teamB.university}</button>
                </div>
                <button onClick={() => handleByeWin(null)} className="w-full py-3 rounded-2xl font-black text-xs bg-slate-500/10 border border-slate-400/25 text-slate-300 active:scale-95 transition-all">ไม่มีผู้ชนะ (Double Walkover)</button>
                <button onClick={() => setByeMode(false)} className="w-full py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">ยกเลิก</button>
              </motion.div>
            )}
          </div>
        )}

        <div className="pt-1">
          {!match.isFinished ? (
            <button onClick={() => handleUpdateStatus(true)} className="w-full bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all py-6 rounded-[2.5rem] font-black text-xl flex items-center justify-center gap-3 shadow-xl border-b-8 border-blue-800">
              <MdSave size={28} /> บันทึกและจบการแข่งขัน
            </button>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/30 p-8 rounded-[3rem] text-center flex flex-col items-center">
                {match.isBye ? <MdEmojiEvents size={60} className="text-amber-400 mb-2" /> : <MdCheckCircle size={60} className="text-green-500 mb-2 shadow-[0_0_15px_rgba(34,197,94,0.5)]" />}
                <p className="text-2xl font-black text-green-400 uppercase italic">RESULTS FILED</p>
              </div>
              <button onClick={() => handleUpdateStatus(false)} className="w-full bg-white/5 hover:bg-white/10 py-4 rounded-3xl font-bold text-slate-400 border border-white/10 flex items-center justify-center gap-2 transition-all">
                <MdEditNote size={20} /> กลับไปแก้ไขสถานะ
              </button>
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {showQR && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowQR(false)}
            className="fixed inset-0 bg-slate-950/95 z-50 flex flex-col items-center justify-center p-8 backdrop-blur-sm">
            <div className="bg-white p-6 rounded-[3rem] shadow-2xl">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentUrl)}&bgcolor=ffffff`} alt="QR" className="w-64 h-64" />
            </div>
            <p className="mt-8 font-black text-xl text-blue-400 uppercase tracking-widest text-center">Scan to help scoring</p>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; }
        .font-black { font-family: 'Orbitron', sans-serif; }
      `}</style>
    </div>
  );
}

function TeamDisplay({ team, color, won, align, isMatchWinner }: any) {
  return (
    <div className="p-6 text-center space-y-3">
      <div className={`flex items-center justify-center gap-2 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <h3 className={`text-4xl font-black italic tracking-tighter ${color} drop-shadow-sm leading-none`}>{team.university}</h3>
        {isMatchWinner ? (
          <MdEmojiEvents className="text-amber-400" size={18} />
        ) : won > 0 && (
          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md border ${color} border-current/30`}>{won}</span>
        )}
      </div>
      <div className="space-y-1">
        {team.players.map((p: any) => (
          <div key={p.id} className="flex items-center justify-center gap-1.5 opacity-60">
            <div className={`w-1 h-1 rounded-full ${p.role === 'starter' ? 'bg-green-400' : 'bg-orange-400'}`} />
            <span className="text-[10px] font-bold uppercase truncate max-w-[80px]">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreControl({ value, onUp, onDown, onTap, color, disabled, isServing }: any) {
  const palette = color === 'blue'
    ? { text: 'text-blue-300', ring: 'border-blue-500/30', bg: 'bg-blue-500/20', hover: 'hover:bg-blue-500' }
    : { text: 'text-red-300', ring: 'border-red-500/30', bg: 'bg-red-500/20', hover: 'hover:bg-red-500' };

  return (
    <div className="text-center flex flex-col items-center gap-3 flex-1">
      <button onClick={onTap} disabled={disabled} className={`h-6 flex items-center justify-center transition-opacity ${isServing ? 'opacity-100' : 'opacity-20 hover:opacity-50'}`}>
        <GiShuttlecock className={palette.text} size={18} />
      </button>
      <motion.button
        key={value}
        initial={{ scale: 0.85, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} whileTap={{ scale: 0.92 }}
        onClick={onUp} disabled={disabled}
        className={`w-full text-[5.5rem] leading-none font-black tabular-nums py-2 rounded-[2rem] transition-colors ${palette.text} ${disabled ? 'opacity-40' : 'active:bg-white/5'}`}
      >
        {value}
      </motion.button>
      <button onClick={onDown} disabled={disabled} className={`flex items-center gap-1.5 px-5 py-2.5 rounded-full border ${palette.ring} ${palette.bg} ${palette.hover} hover:text-white transition-all active:scale-90 disabled:opacity-30 disabled:active:scale-100`}>
        <MdRemove size={18} />
        <span className="text-xs font-black uppercase tracking-wider">-1</span>
      </button>
    </div>
  );
}