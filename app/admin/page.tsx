"use client"

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { io, Socket } from 'socket.io-client';
import {
  FaFileExcel, FaTrash, FaSave, FaRunning,
  FaExclamationTriangle, FaCheckCircle,
  FaGripVertical, FaLayerGroup, FaMapMarkerAlt, FaUsers, FaMinus, FaPlus
} from 'react-icons/fa';
import { MdOutlineCleaningServices } from 'react-icons/md';
import { motion, AnimatePresence, Reorder } from 'framer-motion';

interface Player { id: string; name: string; role: 'starter' | 'substitute'; }
interface TeamEntry { university: string; category: string; group: string; players: Player[]; }

const VALID_UNIVERSITIES = ['CU', 'KU', 'KKU', 'PSU', 'CMU'];
const CATEGORY_MAP: { [key: string]: string } = {
  'ทั่วไป': 'general', '70': '70', '80': '80', '90': '90',
  '100': '100', '110': '110', '120': '120', '130': '130'
};

export default function AdminPage() {
  const [entries, setEntries] = useState<TeamEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [courtCount, setCourtCount] = useState<number>(18);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    socketRef.current = io();
    return () => { socketRef.current?.disconnect(); };
  }, []);

  useEffect(() => {
    const uniqueCats = Array.from(new Set(entries.map(e => e.category)));
    setCategories(prev => {
      const newCats = uniqueCats.filter(c => !prev.includes(c));
      return [...prev.filter(c => uniqueCats.includes(c)), ...newCats];
    });
  }, [entries]);

  // Auto-dismiss toasts so they don't linger and clutter the screen
  useEffect(() => {
    if (!success && !error) return;
    const t = setTimeout(() => { setSuccess(null); setError(null); }, 4000);
    return () => clearTimeout(t);
  }, [success, error]);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'array' });
        const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        processData(data);
        setSuccess("นำเข้าข้อมูลนักกีฬาเรียบร้อย");
      } catch (err) {
        setError("ไฟล์ Excel ไม่ถูกต้อง กรุณาตรวจสอบรูปแบบไฟล์");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const processData = (rawData: any[]) => {
    const current = [...entries];
    rawData.forEach(row => {
      if (!VALID_UNIVERSITIES.includes(row.University)) return;
      let idx = current.findIndex(e => e.university === row.University && e.category === String(row.Category) && e.group === String(row.Group));
      if (idx === -1) {
        current.push({ university: row.University, category: String(row.Category), group: String(row.Group), players: [] });
        idx = current.length - 1;
      }
      const playerList = [
        { n: row.Player1, r: 'starter' },
        { n: row.Player2, r: 'starter' },
        { n: row.Substitute, r: 'substitute' }
      ];
      playerList.forEach(p => {
        if (p.n && !current[idx].players.some(ep => ep.name === p.n)) {
          current[idx].players.push({
            id: Math.random().toString(36).substr(2, 9),
            name: String(p.n),
            role: p.r as any
          });
        }
      });
    });
    setEntries(current);
  };

  // Pure preview calculation — mirrors generateMatches' pairing logic so the admin
  // can see the outcome (how many matches, per category) before committing.
  const matchPreview = useMemo(() => {
    let total = 0;
    const perCategory: { category: string; count: number }[] = [];
    categories.forEach(cat => {
      let catTotal = 0;
      ['A', 'B'].forEach(grp => {
        const n = entries.filter(e => e.category === cat && e.group === grp).length;
        catTotal += (n * (n - 1)) / 2;
      });
      perCategory.push({ category: cat, count: catTotal });
      total += catTotal;
    });
    return { total, perCategory };
  }, [entries, categories]);

  const generateMatches = () => {
    if (entries.length === 0) { setError("ยังไม่มีข้อมูลนักกีฬา กรุณา Import Excel ก่อน"); return; }
    if (courtCount < 1) { setError("จำนวนสนามต้องมากกว่า 0"); return; }

    const allMatches: any[] = [];
    let matchCounter = 0;

    categories.forEach(cat => {
      const groupsInCat = ['A', 'B'];
      groupsInCat.forEach(grp => {
        const teams = entries.filter(e => e.category === cat && e.group === grp);
        const catSlug = CATEGORY_MAP[cat] || encodeURIComponent(cat);

        for (let i = 0; i < teams.length; i++) {
          for (let j = i + 1; j < teams.length; j++) {
            const assignedCourt = (matchCounter % courtCount) + 1;
            allMatches.push({
              id: `M_${catSlug}_${grp}_${teams[i].university}_${teams[j].university}`,
              category: cat,
              group: grp,
              court: assignedCourt.toString(),
              teamA: teams[i],
              teamB: teams[j],
              score: { s1a: 0, s1b: 0, s2a: 0, s2b: 0 },
              isFinished: false
            });
            matchCounter++;
          }
        }
      });
    });

    socketRef.current?.emit('import-excel', allMatches);
    setSuccess(`สร้างตารางแข่งขันสำเร็จ ${allMatches.length} คู่ กระจายลง ${courtCount} สนาม`);
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
            </div>

            {/* Live stats */}
            <div className="flex items-center gap-6 pl-0 lg:pl-6 lg:border-l border-white/10">
              <Stat label="ทีมที่นำเข้า" value={teamCount} icon={<FaUsers size={12} />} />
              <Stat label="นักกีฬา" value={playerCount} icon={<FaUsers size={12} />} />
              <Stat label="รุ่นทั้งหมด" value={categories.length} icon={<FaLayerGroup size={12} />} />
              <Stat label="คู่ที่จะสร้าง" value={matchPreview.total} icon={<FaSave size={12} />} accent="amber" />
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
              <button
                onClick={() => { if (confirm('ล้างข้อมูลทั้งหมด?')) { setEntries([]); socketRef.current?.emit('import-excel', []); } }}
                className="w-full mt-2 px-5 py-2.5 bg-white/[0.02] text-slate-500 border border-white/10 rounded-xl text-xs font-bold hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all flex items-center justify-center gap-2"
              >
                <MdOutlineCleaningServices size={14} /> ล้างข้อมูลทั้งหมด
              </button>
            </WorkflowCard>

            {/* Step 2 — Courts */}
            <WorkflowCard step={2} title="ตั้งค่าจำนวนสนาม" accent="blue">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCourtCount(c => Math.max(1, c - 1))}
                  className="w-11 h-11 shrink-0 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center transition-colors"
                >
                  <FaMinus size={12} />
                </button>
                <div className="flex-1 bg-black/40 border border-white/10 rounded-2xl py-3 flex items-center justify-center gap-2">
                  <FaMapMarkerAlt className="text-blue-500" size={14} />
                  <input
                    type="number"
                    min={1}
                    value={courtCount}
                    onChange={(e) => setCourtCount(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 bg-transparent text-center text-3xl font-black text-blue-400 focus:outline-none tabular-nums"
                  />
                </div>
                <button
                  onClick={() => setCourtCount(c => c + 1)}
                  className="w-11 h-11 shrink-0 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center transition-colors"
                >
                  <FaPlus size={12} />
                </button>
              </div>
              <p className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-3 text-center">แมตช์จะถูกกระจายลงสนามแบบวนรอบ</p>
            </WorkflowCard>

            {/* Step 3 — Category order */}
            <WorkflowCard step={3} title="ลำดับการแข่งรุ่น" accent="amber">
              <p className="text-[10px] text-slate-500 mb-3 font-bold uppercase tracking-wide">ลากเพื่อสลับลำดับ</p>
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

            {/* Step 4 — Generate */}
            <button
              onClick={generateMatches}
              disabled={entries.length === 0}
              className={`w-full py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all shadow-xl ${
                entries.length === 0
                  ? 'bg-white/5 text-slate-600 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-500 active:scale-[0.98] shadow-blue-500/30'
              }`}
            >
              <FaSave /> สร้างตารางแข่ง{matchPreview.total > 0 ? ` (${matchPreview.total} คู่)` : ''}
            </button>
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
