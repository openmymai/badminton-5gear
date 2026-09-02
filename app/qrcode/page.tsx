// app/qrcode/page.tsx

"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  MdPrint,
  MdSearch,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdSelectAll,
  MdDeselect,
  MdQrCode2,
  MdSyncDisabled
} from 'react-icons/md';

// --- Types (kept in sync with app/score/[matchId]/page.tsx) ---
interface Player { id: string; name: string; role: 'starter' | 'substitute'; }
interface MatchData {
  id: string; category: string; group: string; court: string;
  teamA: { university: string; players: Player[] };
  teamB: { university: string; players: Player[] };
  isFinished: boolean;
  isBye?: boolean;
  version?: number;
}

export default function QrCodeSheetPage() {
  const [matches, setMatches] = useState<MatchData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [origin, setOrigin] = useState('');
  const [search, setSearch] = useState('');
  const [courtFilter, setCourtFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setOrigin(window.location.origin);
    const socket: Socket = io();

    socket.on('connect', () => {
      setIsConnected(true);
      // Ask the server for the full match list, same payload shape as the
      // 'data-updated' broadcast used everywhere else in the app.
      socket.emit('get-all-matches');
    });

    socket.on('disconnect', () => setIsConnected(false));

    const applyMatches = (data: { matches: MatchData[] }) => {
      const list = data.matches ?? [];
      setMatches(list);
      // Select everything by default so the first print run covers all
      // matches — the organizer can then narrow down with checkboxes.
      setSelectedIds(prev => {
        if (prev.size > 0) return prev; // don't clobber a manual selection
        return new Set(list.map(m => m.id));
      });
    };

    // Response to our explicit request.
    socket.on('all-matches', applyMatches);
    // Also accept the general broadcast (e.g. after an Excel import while
    // this page is open) so the sheet stays current without a refresh.
    socket.on('data-updated', applyMatches);

    return () => { socket.disconnect(); };
  }, []);

  const courts = useMemo(() => {
    const set = new Set(matches.map(m => m.court).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  }, [matches]);

  const filteredMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return matches
      .filter(m => courtFilter === 'all' || m.court === courtFilter)
      .filter(m => {
        if (!q) return true;
        const haystack = [
          m.id, m.court, m.category, m.group,
          m.teamA.university, m.teamB.university,
          ...m.teamA.players.map(p => p.name),
          ...m.teamB.players.map(p => p.name)
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) =>
        a.court.localeCompare(b.court, 'th', { numeric: true }) ||
        a.category.localeCompare(b.category, 'th') ||
        a.id.localeCompare(b.id)
      );
  }, [matches, search, courtFilter]);

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      filteredMatches.forEach(m => next.add(m.id));
      return next;
    });
  };

  const deselectAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      filteredMatches.forEach(m => next.delete(m.id));
      return next;
    });
  };

  const selectedCount = filteredMatches.filter(m => selectedIds.has(m.id)).length;

  return (
    <div className="min-h-screen bg-slate-950 print:bg-white">
      {/* --- On-screen toolbar (hidden when printing) --- */}
      <div className="print:hidden sticky top-0 z-20 bg-slate-950/95 backdrop-blur-md border-b border-white/10 px-4 py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-lg font-black text-white uppercase tracking-wider">
            <MdQrCode2 size={24} className="text-blue-400" />
            รวม QR Code การแข่งขัน
          </h1>
          {!isConnected && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400 uppercase tracking-wide">
              <MdSyncDisabled size={14} /> กำลังเชื่อมต่อ...
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[180px] flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5">
            <MdSearch size={18} className="text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาสนาม, รุ่น, ทีม, ชื่อนักกีฬา..."
              className="bg-transparent outline-none text-sm text-white placeholder:text-slate-500 flex-1"
            />
          </div>

          <select
            value={courtFilter}
            onChange={e => setCourtFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-2xl px-3 py-2.5 text-sm text-white outline-none"
          >
            <option value="all">ทุกสนาม</option>
            {courts.map(c => (
              <option key={c} value={c}>สนาม {c}</option>
            ))}
          </select>

          <button
            onClick={selectAllVisible}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-xs font-bold text-slate-200 bg-white/5 border border-white/10 active:scale-95 transition-all"
          >
            <MdSelectAll size={16} /> เลือกทั้งหมด
          </button>
          <button
            onClick={deselectAllVisible}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-xs font-bold text-slate-200 bg-white/5 border border-white/10 active:scale-95 transition-all"
          >
            <MdDeselect size={16} /> ไม่เลือกเลย
          </button>

          <button
            onClick={() => window.print()}
            disabled={selectedCount === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-black text-white bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all disabled:opacity-30 disabled:active:scale-100"
          >
            <MdPrint size={18} /> พิมพ์ ({selectedCount})
          </button>
        </div>

        <p className="text-[11px] text-slate-500">
          ติ๊กเลือกใบที่ต้องการก่อนกดพิมพ์ — ใบที่ไม่ได้เลือกจะไม่ถูกพิมพ์ออกมา ให้กรรมการแต่ละสนามสแกน QR
          บนใบของตัวเองเพื่อเปิดหน้าคีย์คะแนน
        </p>
      </div>

      {/* --- Match sheet grid --- */}
      <main className="px-4 py-6 print:p-0">
        {matches.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-16 print:hidden">
            {isConnected ? 'ยังไม่มีข้อมูลการแข่งขัน' : 'กำลังโหลดข้อมูลการแข่งขัน...'}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-4 gap-4 print:gap-2">
          {filteredMatches.map(match => {
            const selected = selectedIds.has(match.id);
            const scoreUrl = `${origin}/score/${encodeURIComponent(match.id)}`;
            const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=6&data=${encodeURIComponent(scoreUrl)}&bgcolor=ffffff`;

            return (
              <div
                key={match.id}
                className={`${selected ? '' : 'print:hidden'} rounded-[2rem] border p-5 flex flex-col items-center gap-3 break-inside-avoid
                  ${selected ? 'border-blue-500/40 bg-white/[0.03]' : 'border-white/5 bg-white/[0.01] opacity-50'}
                  print:rounded-none print:border print:border-black print:bg-white print:opacity-100 print:p-2 print:gap-1.5`}
              >
                {/* Select checkbox — screen only */}
                <button
                  onClick={() => toggleSelected(match.id)}
                  className="print:hidden self-end -mt-1 -mr-1 text-slate-300"
                  aria-label="เลือกใบนี้"
                >
                  {selected
                    ? <MdCheckBox size={22} className="text-blue-400" />
                    : <MdCheckBoxOutlineBlank size={22} />}
                </button>

                {/* Header: court / category / group */}
                <div className="text-center print:text-black">
                  <p className="text-[11px] print:text-[9px] font-black uppercase tracking-[3px] print:tracking-wider text-blue-400 print:text-black">
                    สนาม {match.court || '-'}
                  </p>
                  <p className="text-sm print:text-[10px] font-bold text-slate-200 print:text-black print:leading-tight">
                    {match.category} {match.group ? `· สาย ${match.group}` : ''}
                  </p>
                  {match.isBye && (
                    <p className="text-[10px] print:text-[8px] font-black uppercase text-amber-400 print:text-black">Walkover / Bye</p>
                  )}
                </div>

                {/* Teams */}
                <div className="w-full grid grid-cols-2 gap-2 print:gap-1 text-center">
                  <TeamBlock team={match.teamA} color="blue" />
                  <TeamBlock team={match.teamB} color="red" />
                </div>

                {/* QR code */}
                <div className="bg-white p-3 print:p-1 rounded-2xl print:rounded-none print:border print:border-black">
                  <img src={qrSrc} alt={`QR สำหรับแมตช์ ${match.id}`} className="w-40 h-40 print:w-24 print:h-24" />
                </div>

                <p className="text-center text-[12px] print:text-[8px] font-black uppercase tracking-wider print:tracking-normal text-slate-300 print:text-black print:leading-tight">
                  สแกนเพื่อบันทึกคะแนนแมตช์นี้
                </p>
                <p className="text-center text-[9px] print:text-[6px] text-slate-500 print:text-black break-all">
                  {match.id}
                </p>
              </div>
            );
          })}
        </div>
      </main>

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}

// Compact team block for the printed card — university name in large,
// easy-to-read type plus the starting/substitute player list underneath,
// sized so it's still legible at arm's length when handed to a referee.
function TeamBlock({ team, color }: { team: { university: string; players: Player[] }; color: 'blue' | 'red' }) {
  const textColor = color === 'blue' ? 'text-blue-300' : 'text-red-300';
  return (
    <div className="print:text-black">
      <p className={`text-[13px] print:text-[8px] font-black uppercase leading-tight ${textColor} print:text-black`}>
        {team.university}
      </p>
      <div className="mt-1 print:mt-0.5 space-y-0.5">
        {team.players.map(p => (
          <p key={p.id} className="text-[10px] print:text-[6.5px] font-bold text-slate-400 print:text-black print:leading-tight">
            {p.name}
          </p>
        ))}
      </div>
    </div>
  );
}