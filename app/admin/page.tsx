// app/admin/page.tsx

"use client"

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { io, Socket } from 'socket.io-client';
import {
  FaFileExcel, FaTrash, FaSave, FaRunning,
  FaExclamationTriangle, FaCheckCircle,
  FaGripVertical, FaLayerGroup, FaMapMarkerAlt, FaUsers,
  FaRandom, FaSlidersH, FaUndo
} from 'react-icons/fa';
import { MdOutlineCleaningServices } from 'react-icons/md';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import Link from 'next/link';

interface Player { id: string; name: string; role: 'starter' | 'substitute'; }
interface TeamEntry { university: string; category: string; group: string; players: Player[]; }

interface ComboInfo {
  key: string;          // `${category}__${group}`
  category: string;
  group: string;
  teamCount: number;
  matchCount: number;
  autoCourt: number;
  court: number;
}

type CourtMode = 'auto' | 'manual';

// สถานะห้องทำงานของ Admin ทั้งหมด — ก้อนเดียวที่ sync กับ server ผ่าน
// event "update-roster" / "roster-updated" และถูกเก็บถาวรใน data.json
// (แทนที่ localStorage เดิม ซึ่งทำให้ข้อมูลหายเมื่อ refresh หรือสลับเครื่อง)
interface RosterState {
  entries: TeamEntry[];
  categories: string[];
  courtMode: CourtMode;
  manualCourts: Record<string, number>;
}

// รายชื่อสถาบันที่รับเข้าระบบ — แก้ไข/เพิ่มได้ตามต้องการ
const VALID_UNIVERSITIES = ['CU', 'KU', 'KKU', 'PSU', 'CMU'];

// ใช้แค่ทำ "slug" สำหรับสร้าง id คู่แข่งขันให้อ่านง่าย ไม่ใช่ตัวกำหนดว่ามีรุ่นอะไรบ้าง
// รุ่นทั้งหมดมาจากคอลัมน์ Category ใน Excel ล้วนๆ ไม่ต้อง hardcode ที่นี่
const CATEGORY_SLUG_MAP: { [key: string]: string } = {
  'ทั่วไป': 'general', '70': 'a70', '80': 'a80', '90': 'a90',
  '100': 'a100', '110': 'a110', '120': 'a120', '130': 'a130'
};

// รอนานแค่ไหนหลังพิมพ์/แก้ไข ก่อนส่งค่าล่าสุดขึ้น server (กันการยิง event ถี่เกินไป
// ตอนพิมพ์เลขสนามในช่อง input)
const ROSTER_SYNC_DEBOUNCE_MS = 400;

export default function AdminPage() {
  const [entries, setEntries] = useState<TeamEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [courtMode, setCourtMode] = useState<CourtMode>('auto');
  const [manualCourts, setManualCourts] = useState<Record<string, number>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  // ใช้แสดงลิงก์ไปหน้า Matches / Live หลังจากสร้างตารางแข่งสำเร็จในเซสชันนี้
  const [matchesGenerated, setMatchesGenerated] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // ใช้เทียบว่าค่าปัจจุบันต่างจากค่าล่าสุดที่ได้รับ/ส่งไปให้ server แล้วหรือไม่
  // เพื่อไม่ให้เกิด loop (รับข้อมูลจาก server -> setState -> useEffect ยิงกลับไปหา
  // server ใหม่ทั้งที่ค่าเดิม)
  const lastRosterSignatureRef = useRef<string>('');
  // ยังไม่ส่งอะไรขึ้น server จนกว่าจะได้รับสถานะเริ่มต้นจาก server ก่อน
  // (กันไม่ให้ state เปล่าตอนเปิดหน้าไปทับข้อมูลจริงที่มีอยู่แล้ว)
  const hasLoadedRosterRef = useRef(false);

  // --- Socket lifecycle ---
  useEffect(() => {
    const s = io();
    socketRef.current = s;
    s.on('connect', () => setSocketConnected(true));
    s.on('disconnect', () => setSocketConnected(false));
    s.on('connect_error', () => setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบเครือข่าย'));

    // สถานะห้องทำงาน (ทีม/นักกีฬา, ลำดับรุ่น, โหมด/ค่าสนาม) มาจาก server เสมอ —
    // ทุกครั้งที่เปิดหน้านี้ (รวมถึงหลัง refresh) หรือมี Admin เครื่องอื่นแก้ไข
    // จะได้รับ event นี้และเห็นข้อมูลชุดล่าสุดตรงกันทันที
    s.on('roster-updated', (roster: RosterState) => {
      if (!roster) return;
      const signature = JSON.stringify(roster);
      lastRosterSignatureRef.current = signature;
      hasLoadedRosterRef.current = true;
      setEntries(roster.entries || []);
      setCategories(roster.categories || []);
      setCourtMode(roster.courtMode || 'auto');
      setManualCourts(roster.manualCourts || {});
    });

    return () => { s.disconnect(); };
  }, []);

  // --- Derive category list (order preserved via drag-reorder) from imported data ---
  useEffect(() => {
    const uniqueCats = Array.from(new Set(entries.map(e => e.category)));
    setCategories(prev => {
      const kept = prev.filter(c => uniqueCats.includes(c));
      const newCats = uniqueCats.filter(c => !prev.includes(c));
      return [...kept, ...newCats];
    });
  }, [entries]);

  // Prune stale manual-court entries when the underlying combos change (e.g. category removed)
  // (คำนวณจาก courtCombos ด้านล่าง — ประกาศ useEffect นี้ไว้หลัง courtCombos)

  // --- Sync roster state to the server (debounced) so it survives refresh
  // and is shared across every admin screen in real-time ---
  useEffect(() => {
    if (!hasLoadedRosterRef.current) return; // รอรับสถานะเริ่มต้นจาก server ก่อน

    const roster: RosterState = { entries, categories, courtMode, manualCourts };
    const signature = JSON.stringify(roster);
    if (signature === lastRosterSignatureRef.current) return; // ไม่มีอะไรเปลี่ยนจริง

    const t = setTimeout(() => {
      socketRef.current?.emit('update-roster', roster);
      lastRosterSignatureRef.current = signature;
    }, ROSTER_SYNC_DEBOUNCE_MS);

    return () => clearTimeout(t);
  }, [entries, categories, courtMode, manualCourts]);

  // Auto-dismiss toasts so they don't linger and clutter the screen
  useEffect(() => {
    if (!success && !error) return;
    const t = setTimeout(() => { setSuccess(null); setError(null); }, 4500);
    return () => clearTimeout(t);
  }, [success, error]);

  // --- Excel import ---
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();

    reader.onerror = () => setError('ไม่สามารถอ่านไฟล์ได้ กรุณาลองใหม่อีกครั้ง');

    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'array' });
        if (!wb.SheetNames.length) {
          setError('ไฟล์ Excel ไม่มีชีทข้อมูล');
          return;
        }
        const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        if (!data.length) {
          setError('ไฟล์ Excel ไม่มีข้อมูล กรุณาตรวจสอบไฟล์');
          return;
        }
        const stats = processData(data);
        let msg = `นำเข้าข้อมูลสำเร็จ · เพิ่มนักกีฬาใหม่ ${stats.added} คน`;
        if (stats.skippedRows > 0) msg += ` · ข้ามแถวไม่ถูกต้อง ${stats.skippedRows} แถว`;
        if (stats.duplicatePlayers > 0) msg += ` · ข้ามชื่อซ้ำ ${stats.duplicatePlayers} คน`;
        setSuccess(msg);
      } catch (err) {
        console.error(err);
        setError('ไฟล์ Excel ไม่ถูกต้อง กรุณาตรวจสอบรูปแบบไฟล์ (คอลัมน์ University, Category, Group, Player1, Player2, Substitute)');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // Merges newly parsed Excel rows into existing roster.
  // - Skips rows with an unrecognized university code or missing Category/Group.
  // - Skips player names already present within the same team (no duplicates).
  const processData = (rawData: any[]) => {
    const current = [...entries];
    let added = 0;
    let skippedRows = 0;
    let duplicatePlayers = 0;

    rawData.forEach(row => {
      const uni = String(row?.University ?? '').trim().toUpperCase();
      const cat = String(row?.Category ?? '').trim();
      const grp = String(row?.Group ?? '').trim();

      if (!VALID_UNIVERSITIES.includes(uni) || !cat || !grp) {
        skippedRows++;
        return;
      }

      let idx = current.findIndex(e => e.university === uni && e.category === cat && e.group === grp);
      if (idx === -1) {
        current.push({ university: uni, category: cat, group: grp, players: [] });
        idx = current.length - 1;
      }

      const playerList: { n: any; r: 'starter' | 'substitute' }[] = [
        { n: row.Player1, r: 'starter' },
        { n: row.Player2, r: 'starter' },
        { n: row.Substitute, r: 'substitute' }
      ];

      playerList.forEach(p => {
        const name = p.n !== undefined && p.n !== null ? String(p.n).trim() : '';
        if (!name) return;
        if (current[idx].players.some(ep => ep.name === name)) {
          duplicatePlayers++;
          return;
        }
        current[idx].players.push({
          id: Math.random().toString(36).substr(2, 9),
          name,
          role: p.r
        });
        added++;
      });
    });

    setEntries(current);
    return { added, skippedRows, duplicatePlayers };
  };

  // --- Court combos: one fixed court per (category, group) ---
  // Order follows the admin-defined `categories` order, then groups sorted within each category.
  const courtCombos: ComboInfo[] = useMemo(() => {
    const combos: ComboInfo[] = [];
    let autoIndex = 0;
    categories.forEach(cat => {
      const groupsForCat = Array.from(
        new Set(entries.filter(e => e.category === cat).map(e => e.group))
      ).sort();
      groupsForCat.forEach(grp => {
        autoIndex += 1;
        const key = `${cat}__${grp}`;
        const teamCount = entries.filter(e => e.category === cat && e.group === grp).length;
        const matchCount = (teamCount * (teamCount - 1)) / 2;
        const manualVal = manualCourts[key];
        const court = courtMode === 'manual' && manualVal ? manualVal : autoIndex;
        combos.push({ key, category: cat, group: grp, teamCount, matchCount, autoCourt: autoIndex, court });
      });
    });
    return combos;
  }, [categories, entries, courtMode, manualCourts]);

  // Prune stale manual-court entries when the underlying combos change (e.g. category removed)
  useEffect(() => {
    const validKeys = new Set(courtCombos.map(c => c.key));
    setManualCourts(prev => {
      let changed = false;
      const next: Record<string, number> = {};
      Object.keys(prev).forEach(k => {
        if (validKeys.has(k)) next[k] = prev[k]; else changed = true;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courtCombos.map(c => c.key).join(',')]);

  const courtDuplicates = useMemo(() => {
    const counts: Record<number, number> = {};
    courtCombos.forEach(c => { counts[c.court] = (counts[c.court] || 0) + 1; });
    return new Set(Object.entries(counts).filter(([, v]) => v > 1).map(([k]) => Number(k)));
  }, [courtCombos]);

  const hasDuplicateCourts = courtMode === 'manual' && courtDuplicates.size > 0;
  const courtsUsed = useMemo(() => new Set(courtCombos.map(c => c.court)).size, [courtCombos]);
  const matchTotal = useMemo(() => courtCombos.reduce((sum, c) => sum + c.matchCount, 0), [courtCombos]);

  const generateMatches = () => {
    if (entries.length === 0) { setError("ยังไม่มีข้อมูลนักกีฬา กรุณา Import Excel ก่อน"); return; }
    if (courtCombos.length === 0) { setError("ไม่พบรุ่นการแข่งขันจากข้อมูลที่นำเข้า"); return; }
    if (hasDuplicateCourts) {
      setError("มีสนามถูกกำหนดซ้ำกันมากกว่า 1 รุ่น กรุณาแก้ไขให้ไม่ซ้ำก่อนสร้างตาราง");
      return;
    }
    const invalidCourt = courtCombos.find(c => !c.court || c.court < 1);
    if (invalidCourt) {
      setError(`กรุณากำหนดสนามให้รุ่น ${invalidCourt.category} สาย ${invalidCourt.group}`);
      return;
    }

    const allMatches: any[] = [];
    courtCombos.forEach(combo => {
      const teams = entries.filter(e => e.category === combo.category && e.group === combo.group);
      const catIndex = categories.indexOf(combo.category);
      const catSlug = CATEGORY_SLUG_MAP[combo.category] || `cat${catIndex >= 0 ? catIndex : 0}`;

      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          allMatches.push({
            id: `M_${catSlug}_${combo.group}_${teams[i].university}_${teams[j].university}`,
            category: combo.category,
            group: combo.group,
            court: combo.court.toString(),
            teamA: teams[i],
            teamB: teams[j],
            score: { s1a: 0, s1b: 0, s2a: 0, s2b: 0 },
            isFinished: false
          });
        }
      }
    });

    if (allMatches.length === 0) {
      setError("ไม่มีคู่แข่งขันให้สร้าง (แต่ละรุ่น/สาย ต้องมีอย่างน้อย 2 ทีม)");
      return;
    }

    if (!socketConnected) {
      setError("ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์ กรุณารอสักครู่แล้วลองใหม่");
      return;
    }

    socketRef.current?.emit('import-excel', allMatches);
    setMatchesGenerated(true);
    setSuccess(`สร้างตารางแข่งขันสำเร็จ ${allMatches.length} คู่ กระจายลง ${courtsUsed} สนาม (คะแนนคู่ที่มีผลอยู่แล้วจะไม่ถูกล้าง)`);
  };

  const teamCount = entries.length;
  const playerCount = entries.reduce((sum, e) => sum + e.players.length, 0);

  return (
    <main className="min-h-screen bg-[#05070d] text-white font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header className="bg-white/[0.03] backdrop-blur-xl p-7 rounded-3xl border border-white/10 shadow-xl">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3.5 bg-blue-600/15 border border-blue-500/30 rounded-2xl">
                <FaRunning size={26} className="text-blue-400" />
              </div>
              <div>
                <h1 className="text-2xl font-black uppercase tracking-tight leading-none">Admin Panel</h1>
                <p className="text-blue-400/80 font-bold text-[10px] uppercase tracking-[3px] mt-1.5">Tournament Orchestrator</p>
              </div>
              <span className={`ml-2 w-2 h-2 rounded-full ${socketConnected ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-red-500 shadow-[0_0_6px_#ef4444]'}`} title={socketConnected ? 'เชื่อมต่อแล้ว' : 'ขาดการเชื่อมต่อ'} />
            </div>

            {/* Live stats */}
            <div className="flex flex-wrap items-center gap-6 pl-0 lg:pl-6 lg:border-l border-white/10">
              <Stat label="ทีมที่นำเข้า" value={teamCount} icon={<FaUsers size={12} />} />
              <Stat label="นักกีฬา" value={playerCount} icon={<FaUsers size={12} />} />
              <Stat label="รุ่นทั้งหมด" value={categories.length} icon={<FaLayerGroup size={12} />} />
              <Stat label="สนามที่ใช้" value={courtsUsed} icon={<FaMapMarkerAlt size={12} />} accent="amber" />
              <Stat label="คู่ที่จะสร้าง" value={matchTotal} icon={<FaSave size={12} />} accent="amber" />
            </div>

            {/* Nav — jump straight to the boards that read the schedule this page generates */}
            <div className="flex items-center gap-2 pl-0 lg:pl-6 lg:border-l border-white/10">
              <Link href="/matches" className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-blue-400">
                ตารางแข่งขัน →
              </Link>
              <Link href="/live" className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-amber-400">
                Live Board →
              </Link>
            </div>
          </div>
        </header>

        {/* Toasts */}
        <AnimatePresence>
          {success && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center gap-3 font-bold text-sm">
              <FaCheckCircle /> {success}
            </motion.div>
          )}
          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl flex items-center gap-3 font-bold text-sm">
              <FaExclamationTriangle /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* LEFT: Workflow / Config */}
          <div className="lg:col-span-4 space-y-6">

            {/* Step 1 — Import */}
            <WorkflowCard step={1} title="นำเข้ารายชื่อนักกีฬา" accent="emerald">
              <label className="w-full px-5 py-4 bg-emerald-600/15 border border-emerald-500/30 rounded-2xl font-bold cursor-pointer hover:bg-emerald-600/25 transition-all flex items-center justify-center gap-2 text-emerald-400">
                <FaFileExcel /> Import Excel
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
              </label>
              <p className="text-[10px] text-slate-600 font-bold mt-2 text-center">
                คอลัมน์: University, Category, Group, Player1, Player2, Substitute
              </p>
              <button
                onClick={() => {
                  if (confirm('ล้างข้อมูลทั้งหมด?')) {
                    setEntries([]);
                    setManualCourts({});
                    socketRef.current?.emit('import-excel', []);
                  }
                }}
                className="w-full mt-2 px-5 py-2.5 bg-white/[0.02] text-slate-500 border border-white/10 rounded-xl text-xs font-bold hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all flex items-center justify-center gap-2"
              >
                <MdOutlineCleaningServices size={14} /> ล้างข้อมูลทั้งหมด
              </button>
            </WorkflowCard>

            {/* Step 2 — Category order */}
            <WorkflowCard step={2} title="ลำดับการแข่งรุ่น" accent="amber">
              <p className="text-[10px] text-slate-500 mb-3 font-bold uppercase tracking-wide">ลากเพื่อสลับลำดับ (มีผลต่อการจัดสนามอัตโนมัติ)</p>
              {categories.length === 0 ? (
                <p className="text-xs text-slate-600 italic py-4 text-center">ยังไม่มีรุ่นจากข้อมูลที่นำเข้า</p>
              ) : (
                <Reorder.Group axis="y" values={categories} onReorder={setCategories} className="space-y-2">
                  {categories.map((cat, idx) => (
                    <Reorder.Item key={cat} value={cat}>
                      <div className="bg-black/30 p-3 rounded-xl border border-white/5 flex justify-between items-center cursor-grab active:cursor-grabbing hover:border-amber-500/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-md bg-amber-400/10 border border-amber-400/30 text-amber-400 text-[11px] font-black flex items-center justify-center">{idx + 1}</span>
                          <span className="font-bold text-sm">รุ่น {cat}</span>
                        </div>
                        <FaGripVertical className="text-slate-600" size={13} />
                      </div>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              )}
            </WorkflowCard>

            {/* Step 3 — Court assignment */}
            <WorkflowCard step={3} title="จัดสรรสนามแข่งขัน" accent="blue">
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => setCourtMode('auto')}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all flex items-center justify-center gap-2 ${
                    courtMode === 'auto' ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-500 hover:bg-white/10'
                  }`}
                >
                  <FaRandom size={11} /> อัตโนมัติ
                </button>
                <button
                  onClick={() => setCourtMode('manual')}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all flex items-center justify-center gap-2 ${
                    courtMode === 'manual' ? 'bg-amber-500 text-black' : 'bg-white/5 text-slate-500 hover:bg-white/10'
                  }`}
                >
                  <FaSlidersH size={11} /> กำหนดเอง
                </button>
              </div>

              {courtMode === 'manual' && (
                <button
                  onClick={() => setManualCourts({})}
                  className="w-full mb-3 px-4 py-2 bg-white/[0.02] text-slate-500 border border-white/10 rounded-xl text-[10px] font-bold hover:bg-white/5 transition-all flex items-center justify-center gap-2"
                >
                  <FaUndo size={10} /> รีเซ็ตกลับเป็นอัตโนมัติ
                </button>
              )}

              {hasDuplicateCourts && (
                <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-[10px] font-bold text-red-400 flex items-center gap-2">
                  <FaExclamationTriangle size={11} /> มีสนามถูกใช้ซ้ำกัน — ต้องแก้ไขก่อนจึงจะสร้างตารางได้
                </div>
              )}

              {courtCombos.length === 0 ? (
                <p className="text-xs text-slate-600 italic py-4 text-center">ยังไม่มีรุ่นจากข้อมูลที่นำเข้า</p>
              ) : (
                <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
                  {courtCombos.map(combo => {
                    const isDup = courtMode === 'manual' && courtDuplicates.has(combo.court);
                    return (
                      <div
                        key={combo.key}
                        className={`flex items-center justify-between gap-3 bg-black/30 px-3 py-2.5 rounded-xl border transition-colors ${
                          isDup ? 'border-red-500/50' : 'border-white/5'
                        }`}
                      >
                        <div className="leading-tight min-w-0">
                          <p className="text-xs font-bold truncate">รุ่น {combo.category}</p>
                          <p className="text-[9px] text-amber-500 font-bold uppercase mt-0.5">
                            สาย {combo.group} · {combo.teamCount} ทีม · {combo.matchCount} คู่
                          </p>
                        </div>
                        {courtMode === 'auto' ? (
                          <span className="shrink-0 w-11 h-10 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 font-black flex items-center justify-center text-sm tabular-nums">
                            {combo.court}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={1}
                            value={manualCourts[combo.key] ?? combo.autoCourt}
                            onChange={(e) => {
                              const v = Math.max(1, Number(e.target.value) || 1);
                              setManualCourts(prev => ({ ...prev, [combo.key]: v }));
                            }}
                            className={`w-14 h-10 shrink-0 rounded-lg bg-black/40 border text-center font-black text-sm focus:outline-none tabular-nums ${
                              isDup ? 'border-red-500/60 text-red-400' : 'border-white/10 text-blue-400'
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </WorkflowCard>

            {/* Step 4 — Generate */}
            <button
              onClick={generateMatches}
              disabled={entries.length === 0 || hasDuplicateCourts}
              className={`w-full py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all shadow-xl ${
                entries.length === 0 || hasDuplicateCourts
                  ? 'bg-white/5 text-slate-600 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-500 active:scale-[0.98] shadow-blue-500/30'
              }`}
            >
              <FaSave /> สร้างตารางแข่ง{matchTotal > 0 ? ` (${matchTotal} คู่)` : ''}
            </button>

            {/* Post-generate shortcut — appears once a schedule has been created this
                session, so the admin doesn't have to hunt for the nav links up top. */}
            {matchesGenerated && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-2"
              >
                <Link
                  href="/matches"
                  className="flex-1 text-center px-4 py-3 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 rounded-xl font-black text-xs uppercase tracking-wider text-blue-400 transition-all"
                >
                  ไปที่ตารางแข่งขัน →
                </Link>
                <Link
                  href="/live"
                  className="flex-1 text-center px-4 py-3 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-xl font-black text-xs uppercase tracking-wider text-amber-400 transition-all"
                >
                  เปิด Live Board →
                </Link>
              </motion.div>
            )}
          </div>

          {/* RIGHT: Roster */}
          <div className="lg:col-span-8">
            <section className="bg-white/[0.03] backdrop-blur-xl p-7 rounded-3xl border border-white/10 shadow-xl min-h-[600px]">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                  <span className="w-1.5 h-6 bg-blue-500 rounded-full" /> รายชื่อนักกีฬาที่นำเข้า
                </h2>
                {entries.length > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{teamCount} ทีม · {playerCount} คน</span>
                )}
              </div>

              {entries.length === 0 ? (
                <div className="h-[480px] flex flex-col items-center justify-center text-slate-700">
                  <FaFileExcel size={64} className="mb-4 opacity-30" />
                  <p className="font-bold uppercase tracking-widest text-sm text-slate-600">รอไฟล์ Excel</p>
                  <p className="text-[11px] text-slate-700 mt-1">นำเข้าไฟล์รายชื่อนักกีฬาเพื่อเริ่มต้น</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {entries.map((entry, eIdx) => (
                    <div key={`${entry.university}-${entry.category}-${entry.group}`} className="bg-black/30 rounded-2xl border border-white/5 overflow-hidden group hover:border-blue-500/30 transition-all">
                      <div className="bg-white/[0.03] px-4 py-3 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <span className="bg-blue-600/90 text-white font-black px-2.5 py-1 rounded-lg text-xs">{entry.university}</span>
                          <div className="leading-tight">
                            <p className="text-xs font-bold">รุ่น {entry.category}</p>
                            <p className="text-[9px] text-amber-500 font-bold uppercase mt-0.5">สาย {entry.group}</p>
                          </div>
                        </div>
                        <button onClick={() => setEntries(entries.filter((_, i) => i !== eIdx))} className="text-slate-600 hover:text-red-500 transition-colors p-1">
                          <FaTrash size={12} />
                        </button>
                      </div>
                      <div className="p-3 space-y-1.5">
                        {entry.players.length === 0 && (
                          <p className="text-[10px] text-slate-700 italic px-2 py-1">ไม่มีรายชื่อนักกีฬา</p>
                        )}
                        {entry.players.map(p => (
                          <div key={p.id} className="flex justify-between items-center bg-white/[0.02] px-3 py-1.5 rounded-lg border border-white/5 group/p">
                            <div className="flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full ${p.role === 'starter' ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-orange-500'}`} />
                              <span className="text-[11px] font-bold text-slate-300">{p.name}</span>
                            </div>
                            <button onClick={() => {
                              const up = [...entries];
                              up[eIdx] = { ...up[eIdx], players: up[eIdx].players.filter(pl => pl.id !== p.id) };
                              setEntries(up);
                            }} className="opacity-0 group-hover/p:opacity-100 text-slate-500 hover:text-red-500 transition-all">
                              <FaTrash size={9} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #05070d; }
        .font-black { font-family: 'Orbitron', sans-serif; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      `}</style>
    </main>
  );
}

// --- Sub-components ---

function Stat({ label, value, icon, accent = 'blue' }: { label: string; value: number; icon: React.ReactNode; accent?: 'blue' | 'amber' }) {
  const color = accent === 'amber' ? 'text-amber-400' : 'text-blue-400';
  return (
    <div className="flex items-center gap-2">
      <span className={`${color} opacity-60`}>{icon}</span>
      <div className="leading-tight">
        <p className={`text-lg font-black tabular-nums ${color}`}>{value}</p>
        <p className="text-[8px] font-bold uppercase tracking-widest text-slate-600">{label}</p>
      </div>
    </div>
  );
}

function WorkflowCard({ step, title, accent, children }: { step: number; title: string; accent: 'emerald' | 'blue' | 'amber'; children: React.ReactNode }) {
  const palette = {
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30' },
    blue: { text: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30' },
    amber: { text: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/30' },
  }[accent];

  return (
    <section className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl">
      <div className="flex items-center gap-3 mb-5">
        <span className={`w-7 h-7 rounded-lg ${palette.bg} border ${palette.border} ${palette.text} text-xs font-black flex items-center justify-center shrink-0`}>
          {step}
        </span>
        <h2 className="text-sm font-black uppercase tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}
