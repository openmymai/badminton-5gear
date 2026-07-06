"use client"

import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { io, Socket } from 'socket.io-client';
import { 
  FaFileExcel, FaTrash, FaSave, FaRunning, 
  FaExclamationTriangle, FaCheckCircle, 
  FaArrowUp, FaArrowDown, FaLayerGroup, FaMapMarkerAlt 
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
        setError("ไฟล์ Excel ไม่ถูกต้อง");
      }
    };
    reader.readAsArrayBuffer(file);
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
        {n: row.Player1, r: 'starter'}, 
        {n: row.Player2, r: 'starter'}, 
        {n: row.Substitute, r: 'substitute'}
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

  const generateMatches = () => {
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

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white font-sans p-6 overflow-x-hidden">
      <div className="max-w-7xl mx-auto">
        
        {/* Header Section */}
        <header className="flex flex-col lg:flex-row justify-between items-center mb-10 bg-white/5 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white/10 shadow-2xl gap-6">
          <div className="flex items-center gap-6">
            <div className="p-4 bg-blue-600 rounded-3xl shadow-[0_0_30px_rgba(37,99,235,0.4)]">
              <FaRunning size={40} />
            </div>
            <div>
              <h1 className="text-4xl font-black italic tracking-tight uppercase leading-none">Admin Panel</h1>
              <p className="text-blue-400 font-bold text-xs uppercase tracking-[4px] mt-2">Tournament Orchestrator</p>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <button 
              onClick={() => {if(confirm('ล้างข้อมูลทั้งหมด?')) {setEntries([]); socketRef.current?.emit('import-excel', []);}}} 
              className="px-6 py-3 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl font-bold hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"
            >
              <MdOutlineCleaningServices /> ล้างข้อมูล
            </button>
            <label className="px-6 py-3 bg-green-600 rounded-2xl font-black cursor-pointer hover:bg-green-500 transition-all flex items-center gap-2 shadow-lg shadow-green-900/20">
              <FaFileExcel /> IMPORT EXCEL
              <input type="file" className="hidden" onChange={handleImport} />
            </label>
            <button 
              onClick={generateMatches} 
              className="px-8 py-3 bg-blue-600 rounded-2xl font-black hover:bg-blue-500 transition-all flex items-center gap-2 shadow-lg shadow-blue-500/40"
            >
              <FaSave /> สร้างตารางแข่ง
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          <div className="lg:col-span-4 space-y-8">
            <section className="bg-white/5 backdrop-blur-xl p-6 rounded-[2rem] border border-white/10 shadow-xl">
              <h2 className="text-xl font-black mb-6 flex items-center gap-3 uppercase italic text-blue-400">
                <FaMapMarkerAlt /> ตั้งค่าสนามแข่ง
              </h2>
              <div className="space-y-4">
                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">จำนวนสนามที่ใช้งานได้</p>
                <input 
                  type="number" 
                  value={courtCount} 
                  onChange={(e) => setCourtCount(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-white/10 rounded-2xl px-6 py-4 text-3xl font-black text-blue-500 focus:outline-none focus:border-blue-500 transition-all"
                />
              </div>
            </section>

            <section className="bg-white/5 backdrop-blur-xl p-6 rounded-[2rem] border border-white/10 shadow-xl">
              <h2 className="text-xl font-black mb-6 flex items-center gap-3 uppercase italic text-amber-400">
                <FaLayerGroup /> ลำดับการแข่งรุ่น
              </h2>
              <p className="text-[10px] text-slate-500 mb-4 font-bold uppercase italic">ลากเพื่อสลับลำดับรุ่น</p>
              
              <Reorder.Group axis="y" values={categories} onReorder={setCategories} className="space-y-2">
                {categories.map((cat) => (
                  <Reorder.Item key={cat} value={cat}>
                    <div className="bg-slate-900/80 p-4 rounded-xl border border-white/5 flex justify-between items-center cursor-grab active:cursor-grabbing hover:bg-slate-800 transition-colors">
                      <span className="font-bold">รุ่น {cat}</span>
                      <div className="flex gap-2 text-slate-600">
                        <FaArrowUp size={12} /> <FaArrowDown size={12} />
                      </div>
                    </div>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </section>
          </div>

          <div className="lg:col-span-8">
            <section className="bg-white/5 backdrop-blur-xl p-8 rounded-[3rem] border border-white/10 shadow-xl min-h-[600px]">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black uppercase italic tracking-tight flex items-center gap-4">
                   <div className="w-2 h-8 bg-blue-500 rounded-full" /> รายชื่อนักกีฬาที่นำเข้า
                </h2>
              </div>

              <AnimatePresence>
                {success && (
                  <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-6 p-4 bg-green-500/20 border border-green-500/40 text-green-400 rounded-2xl flex items-center gap-3 font-bold">
                    <FaCheckCircle /> {success}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {entries.map((entry, eIdx) => (
                  <div key={`${entry.university}-${entry.category}-${entry.group}`} className="bg-slate-950/50 rounded-3xl border border-white/5 overflow-hidden group hover:border-blue-500/30 transition-all">
                    <div className="bg-white/5 p-4 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="bg-blue-600 text-white font-black px-3 py-1 rounded-lg text-sm">{entry.university}</span>
                        <div>
                          <p className="text-sm font-bold leading-none">รุ่น {entry.category}</p>
                          <p className="text-[10px] text-amber-500 font-bold uppercase mt-1">สาย {entry.group}</p>
                        </div>
                      </div>
                      <button onClick={() => setEntries(entries.filter((_, i) => i !== eIdx))} className="text-slate-600 hover:text-red-500 transition-colors">
                        <FaTrash size={14} />
                      </button>
                    </div>
                    <div className="p-4 space-y-2">
                      {entry.players.map(p => (
                        <div key={p.id} className="flex justify-between items-center bg-white/5 p-2 rounded-xl border border-white/5 group/p">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${p.role === 'starter' ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-orange-500'}`} />
                            <span className="text-xs font-bold text-slate-300">{p.name}</span>
                          </div>
                          <button onClick={() => {
                            const up = [...entries];
                            up[eIdx].players = up[eIdx].players.filter(pl => pl.id !== p.id);
                            setEntries(up);
                          }} className="opacity-0 group-hover/p:opacity-100 text-slate-500 hover:text-red-500 transition-all">
                            <FaTrash size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {entries.length === 0 && (
                <div className="h-[400px] flex flex-col items-center justify-center text-slate-600">
                  <FaFileExcel size={80} className="mb-4 opacity-20" />
                  <p className="font-bold uppercase tracking-widest italic">Waiting for Excel Data...</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Rajdhani:wght@600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background-color: #020617; }
        .font-black { font-family: 'Orbitron', sans-serif; }
      `}</style>
    </main>
  );
}