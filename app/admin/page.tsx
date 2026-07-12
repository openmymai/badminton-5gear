// app/admin/page.tsx

"use client"

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { io, Socket } from 'socket.io-client';
import {
  FaFileExcel, FaTrash, FaSave, FaRunning,
  FaExclamationTriangle, FaCheckCircle,
  FaGripVertical, FaLayerGroup, FaMapMarkerAlt, FaUsers,
  FaRandom, FaSlidersH, FaUndo, FaHistory, FaCloudUploadAlt,
  FaSyncAlt, FaDatabase
} from 'react-icons/fa';
import { MdOutlineCleaningServices } from 'react-icons/md';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { useIsAdmin } from '@/lib/useIsAdmin';

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

// สรุปคู่แข่งขันที่ server แจ้งว่า "จะหายไป" ถ้ายืนยันสร้างตารางใหม่ทับของเดิม
// (มาจาก event "import-would-drop-matches" — teamA/teamB ถูกย่อเหลือแค่ชื่อ
// มหาลัยแล้วโดย server เพื่อไม่ต้องส่งข้อมูลทีมทั้งก้อนกลับมา)
interface DroppedMatchInfo {
  id: string;
  category: string;
  group: string;
  teamA?: string;
  teamB?: string;
  isFinished?: boolean;
}

interface DropWarningState {
  droppedMatches: DroppedMatchInfo[];
  droppedCount: number;
  pendingMatches: any[];
}

// ไฟล์ backup ที่ได้จาก GET /api/backups (ชื่อไฟล์ล้วนๆ เช่น
// "manual_2026-07-11T10-23-45-123Z.json", "auto_2026-07-11T10-23-45-123Z.json"
// หรือ "pre-restore_1699999999999.json")
type BackupFileName = string;

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

// ลำดับการแสดงผลรุ่น/สาย ที่ admin ต้องการเวลาตรวจสอบรายชื่อ — ไม่ใช่ลำดับการแข่ง
// (อันนั้นคุมด้วย `categories` ที่ลาก reorder ได้ในหน้านี้) แต่เป็นลำดับคงที่สำหรับ
// "กรอง/เรียงดู" รายชื่อนักกีฬาให้หาเจอง่าย โดยเรียงเป็น key `category|group`
//
// หมายเหตุสำคัญ: processData() ด้านล่างจะข้ามแถวที่คอลัมน์ Group ว่างเปล่าไปเลย
// (ดูเงื่อนไข `!grp` ในฟังก์ชันนั้น) ดังนั้นรุ่นที่ไม่มีสาย A/B แยก (กิตติมศักดิ์,
// 130, หญิงคู่ทั่วไป, อาวุโสหญิง 70+) จึงต้องมีค่าในคอลัมน์ Group ของ Excel ด้วย
// เสมอ — ที่นี่สมมติว่าใช้เครื่องหมาย "-" เป็นค่า placeholder ถ้าไฟล์ Excel จริง
// ใช้ค่าอื่น (เช่น "A" เดี่ยวๆ หรือคำว่า "รวม") ให้แก้ไข '-' ด้านล่างให้ตรงกับที่ใช้จริง
const CATEGORY_GROUP_ORDER: string[] = [
  'กิตติมศักดิ์|-', 'ทั่วไป|A', 'ทั่วไป|B',
  '70|A', '70|B', '80|A', '80|B', '90|A', '90|B',
  '100|A', '100|B', '110|A', '110|B', '120|A', '120|B',
  '130|-', 'หญิงคู่ทั่วไป|-', 'อาวุโสหญิง 70+|-'
];

// คืนลำดับ (rank) ของ entry ตาม CATEGORY_GROUP_ORDER ด้านบน — รุ่น/สายที่ไม่ตรง
// กับลิสต์ที่กำหนดไว้เลย (เช่น สาย C หรือรุ่นที่เพิ่งเพิ่มใหม่ยังไม่ได้ใส่ในลิสต์)
// จะได้ rank ท้ายสุดเสมอ (Infinity) เพื่อไม่ให้หายไปจากลิสต์ แค่ไปต่อท้าย
function getCategoryGroupRank(category: string, group: string): number {
  const exactIdx = CATEGORY_GROUP_ORDER.indexOf(`${category}|${group}`);
  if (exactIdx !== -1) return exactIdx;
  // รุ่นเดียวกันแต่สายไม่ตรง (เช่นมีสาย C เพิ่มมาโดยไม่ได้อยู่ในลิสต์) — จัดให้อยู่
  // ถัดจากสายสุดท้ายที่รู้จักของรุ่นนั้น แทนที่จะกระโดดไปท้ายสุดทั้งลิสต์
  const catIdx = CATEGORY_GROUP_ORDER.findIndex(k => k.startsWith(`${category}|`));
  if (catIdx !== -1) {
    let lastIdx = catIdx;
    for (let i = catIdx; i < CATEGORY_GROUP_ORDER.length; i++) {
      if (CATEGORY_GROUP_ORDER[i].startsWith(`${category}|`)) lastIdx = i; else break;
    }
    return lastIdx + 0.5;
  }
  return Infinity;
}

// ระยะพักขั้นต่ำ (นับเป็นจำนวน "คู่" ที่ต้องคั่นในสนามเดียวกัน) ก่อนที่ทีมใดทีมหนึ่ง
// จะถูกจัดให้ลงเล่นอีกครั้ง — ตั้งไว้ที่ 1 หมายถึง "ต้องมีอีกอย่างน้อย 1 คู่คั่นก่อน"
// ไม่ใช่แค่ห้ามลงเล่นติดกันทันที เพื่อความปลอดภัยของนักกีฬา (งานนี้เน้นกระชับมิตร
// ไม่ใช่แข่งเอาเป็นเอาตาย) ถ้าอยากให้พักยาวกว่านี้ ปรับตัวเลขนี้เพิ่มได้
// หมายเหตุ: สายที่มีทีมน้อย (3 ทีม) จะพักครบตามนี้ไม่ได้เสมอไปตามหลักคณิตศาสตร์ของ
// round-robin — อัลกอริทึมจะ fallback ไปเลือกคู่ที่ทำให้พักได้มากที่สุดเท่าที่เป็นไปได้แทน
const MIN_REST_GAP = 1;

// รวม array ของแมตช์ที่อัปเดต (จาก "match-updated" / "matches-updated") เข้ากับ
// state เดิม โดยแทนที่เฉพาะรายการที่ id ตรงกัน — ใช้กับ currentMatches ด้านล่าง
// ซึ่งหน้านี้ใช้แค่พรีวิว "จะมีคู่เดิมหายไปกี่คู่" ก่อนสร้างตารางใหม่ทับ ไม่ได้ใช้
// render คะแนนสด จึงไม่จำเป็นต้อง merge ลึกไปกว่านี้ (any[] พอ)
const mergeMatchesById = (prev: any[], updates: any[]): any[] => {
  if (!updates || updates.length === 0) return prev;
  const map = new Map(prev.map((m: any) => [m.id, m]));
  updates.forEach((m: any) => {
    if (m && m.id) map.set(m.id, m);
  });
  return Array.from(map.values());
};

// จัดลำดับคู่แข่งขัน "ภายในสนามเดียวกัน" (court เดียวใช้ทั้งรุ่น/สาย) ใหม่ ให้แต่ละ
// ทีม (ตัวแทนสถาบัน) ได้พักระหว่างคู่ของตัวเองให้มากที่สุดเท่าที่เป็นไปได้ ไม่ต้องถูก
// เรียกลงเล่นถี่เกินไป — เพื่อความปลอดภัยของนักกีฬา ไม่ใช่เพื่อความได้เปรียบเสียเปรียบ
// ในการแข่งขัน (งานนี้เป็นกระชับมิตร ไม่มีเงินรางวัล)
//
// วิธีเดิม (loop i,j ตรงๆ ตามลำดับตัวอักษรมหาลัย) ทำให้ทีมแรกในลิสต์โดนเรียกลงเล่น
// ทุกคู่ของตัวเองก่อนใครเพื่อนเลย ไม่แฟร์เรื่องการพัก — ฟังก์ชันนี้จัดใหม่แบบ greedy:
// ทุกก้าวเลือกคู่ที่ทำให้ทั้งสองทีมได้พักครบตาม MIN_REST_GAP ก่อนเสมอถ้าเลือกได้
// (ให้คะแนนก้อนใหญ่ตัดหน้า) แล้วในกลุ่มที่เลือกได้ ให้ priority กับทีมที่ "รอมานาน
// ที่สุด" (ยังไม่ได้ลงเล่นนานสุด) เพื่อกระจายจำนวนรอบพักให้เท่ากันทุกทีม
//
// สุ่มเลือกในกลุ่มที่คะแนนเท่ากัน (แก้ปัญหา CMU vs CU ขึ้นก่อนทุกรุ่น): ตอนเริ่มต้น
// ของแต่ละสนาม ทุกคู่ยังไม่มีใครลงเล่นเลย จึงได้คะแนนเท่ากันหมด (gap เป็น Infinity
// เท่ากันทุกคู่) เดิมโค้ดใช้ `>` เทียบ ทำให้คู่แรกที่เจอ (index 0) ชนะเสมอ — และ
// เพราะ comboMatches ถูกสร้างด้วย loop i<j บนทีมที่ sort ตามตัวอักษรชื่อมหาลัย
// (CMU มาก่อน CU เสมอ) คู่แรกจึงเป็น CMU vs CU ทุกรุ่นไปโดยไม่ได้ตั้งใจ
// ตอนนี้เก็บ "ทุก index ที่ได้คะแนนสูงสุด" แล้วสุ่มเลือกหนึ่งในนั้น ทำให้ทั้งคู่เริ่ม
// ต้นของแต่ละรุ่น และการเลือกคู่ในทุกๆ ก้อนคะแนนเท่ากันตลอดทั้งตาราง มีความสุ่มจริง
// โดยยังคงกติกาการพักเท่าเดิมทุกประการ (ยังให้ความสำคัญกับคู่ที่พักครบ/รอนานที่สุด
// ก่อนเสมอ แค่สุ่มเมื่อคะแนนเท่ากันเป๊ะเท่านั้น)
//
// ข้อจำกัดทางคณิตศาสตร์: ถ้าสายมี 3 ทีม (round-robin มี 3 คู่ ทุกทีมเล่น 2 ใน 3 คู่)
// จะพิสูจน์ได้ว่ามีอย่างน้อย 1 ทีมที่ต้องเล่นติดกันเสมอ ไม่ใช่ bug ของอัลกอริทึม แต่
// เป็นข้อจำกัดของ round-robin บนสนามเดียวเมื่อทีมน้อย — กรณีนี้ยอมรับสภาพ ให้ทีมที่
// เกี่ยวข้องดูแลจัดสรรพักกันเอง
function scheduleAvoidingBackToBack<T extends { teamA: TeamEntry; teamB: TeamEntry }>(matches: T[]): T[] {
  const remaining = [...matches];
  const schedule: T[] = [];
  const lastPlayedAt: Record<string, number> = {}; // university -> index ล่าสุดที่ลงเล่นใน schedule นี้

  const scoreOf = (m: T): number => {
    const teams = [m.teamA.university, m.teamB.university];
    // ระยะห่างจากคู่ล่าสุดที่แต่ละทีมเคยลงเล่น (ยังไม่เคยเล่นเลย = ห่างเต็มที่)
    const gaps = teams.map(t => (lastPlayedAt[t] === undefined ? Infinity : schedule.length - lastPlayedAt[t]));
    const minGap = Math.min(...gaps);
    const satisfiesRest = minGap > MIN_REST_GAP; // พักครบตามที่กำหนดหรือยัง
    const waited = Math.min(...gaps.map(g => (g === Infinity ? schedule.length : g)));
    // พักครบ > ยังไม่ครบแต่พักได้มากกว่า (กันชนกรณีสาย 3-4 ทีมที่พักครบเป๊ะไม่ได้จริง)
    return (satisfiesRest ? 100000 : 0) + waited;
  };

  while (remaining.length > 0) {
    const scores = remaining.map(scoreOf);
    const bestScore = Math.max(...scores);
    // เก็บทุก index ที่ได้คะแนนสูงสุดเท่ากัน แล้วสุ่มเลือกหนึ่งในนั้น แทนที่จะเลือก
    // ตัวแรกที่เจอเสมอ — นี่คือจุดที่ทำให้คู่เริ่มต้น/การจัดลำดับมีความสุ่มจริง
    const bestIndices: number[] = [];
    scores.forEach((s, i) => { if (s === bestScore) bestIndices.push(i); });
    const chosenIdx = bestIndices[Math.floor(Math.random() * bestIndices.length)];

    const [chosen] = remaining.splice(chosenIdx, 1);
    schedule.push(chosen);
    const idx = schedule.length - 1;
    lastPlayedAt[chosen.teamA.university] = idx;
    lastPlayedAt[chosen.teamB.university] = idx;
  }

  return schedule;
}

// ---- Backup filename parsing helpers ----
// แปลงชื่อไฟล์ backup ให้อ่านง่าย พร้อมระบุประเภท (สร้างเอง / อัตโนมัติ / ก่อน Restore)
//
// รูปแบบชื่อไฟล์ที่ต้องรองรับ (ดู server.js):
//   - manual_<ISO-with-dashes>.json       สร้างเองจากปุ่ม "สร้าง Backup ตอนนี้"
//   - auto_<ISO-with-dashes>.json         สร้างอัตโนมัติจาก performAutoBackup()
//                                         (ทุก 5 นาทีที่ไม่มีการแก้ไข หรืออย่างช้า
//                                         ทุก 15 นาทีถ้ามีการแก้ไขต่อเนื่องไม่หยุด)
//   - pre-restore_<epoch-ms>.json         สำรองอัตโนมัติก่อนกด "กู้คืน" ทุกครั้ง
function parseBackupLabel(filename: BackupFileName): { typeLabel: string; typeAccent: 'blue' | 'amber' | 'emerald'; dateLabel: string } {
  let typeLabel = 'Backup';
  let typeAccent: 'blue' | 'amber' | 'emerald' = 'blue';
  let dateSource: Date | null = null;

  if (filename.startsWith('manual_')) {
    typeLabel = 'สร้างเอง';
    typeAccent = 'blue';
    const raw = filename.replace('manual_', '').replace('.json', '');
    // ISO string ที่แทน ":" และ "." ด้วย "-" ตอนสร้างไฟล์ -> แปลงกลับ
    const isoGuess = raw.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');
    const d = new Date(isoGuess);
    if (!isNaN(d.getTime())) dateSource = d;
  } else if (filename.startsWith('pre-restore_')) {
    typeLabel = 'ก่อน Restore';
    typeAccent = 'amber';
    const raw = filename.replace('pre-restore_', '').replace('.json', '');
    const ms = Number(raw);
    if (!isNaN(ms)) dateSource = new Date(ms);
  } else if (filename.startsWith('auto_')) {
    // สร้างจาก performAutoBackup() ใน server.js — ใช้ timestamp รูปแบบเดียวกับ
    // manual_ (ISO string ที่แทน ":" และ "." ด้วย "-") จึงแปลงกลับด้วยวิธีเดียวกัน
    typeLabel = 'อัตโนมัติ';
    typeAccent = 'emerald';
    const raw = filename.replace('auto_', '').replace('.json', '');
    const isoGuess = raw.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');
    const d = new Date(isoGuess);
    if (!isNaN(d.getTime())) dateSource = d;
  }

  const dateLabel = dateSource
    ? dateSource.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'medium' })
    : filename;

  return { typeLabel, typeAccent, dateLabel };
}

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
  const { logout } = useIsAdmin();

  // ตารางแข่งขัน "ปัจจุบัน" ตามที่ server รายงานล่าสุด — ใช้พรีวิวว่าถ้าสร้าง
  // ตารางใหม่ตอนนี้ จะมีคู่เดิมคู่ไหนหายไปบ้าง ก่อนกดปุ่มจริง
  // อัปเดตจากทั้ง "data-updated" (ทั้งชุด ตอน connect/import/clear) และ
  // "match-updated"/"matches-updated" (เฉพาะคู่ที่เปลี่ยน เช่น มีคนกดคะแนนอยู่
  // ระหว่างที่ admin เปิดหน้านี้ค้างไว้) เพื่อให้พรีวิวไม่ค้างข้อมูลเก่า
  const [currentMatches, setCurrentMatches] = useState<any[]>([]);

  // เปิดอยู่เมื่อ server ตอบกลับ "import-would-drop-matches" — แปลว่าตารางใหม่
  // ที่กำลังจะบันทึกจะทำให้คู่เดิมบางคู่ (อาจมีผลการแข่งขันบันทึกไว้แล้ว) หายไป
  // ยังไม่ถูกบันทึกจนกว่าจะกดยืนยัน
  const [dropWarning, setDropWarning] = useState<DropWarningState | null>(null);
  // เก็บชุด matches ที่เพิ่งส่งไปรอ server ตรวจสอบไว้ชั่วคราว เผื่อต้องส่งซ้ำ
  // พร้อม confirmDrop: true ถ้า admin ยืนยันจะแทนที่
  const pendingImportRef = useRef<any[] | null>(null);

  // ---- Backup / Restore state ----
  const [backups, setBackups] = useState<BackupFileName[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringFile, setRestoringFile] = useState<string | null>(null);

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

    // ตารางแข่งขันปัจจุบันแบบเต็มชุดจาก server — เกิดตอนเชื่อมต่อครั้งแรก และ
    // ตอน import Excel / ล้างข้อมูลทั้งหมด (กรณีที่รูปร่างตารางเปลี่ยนจริงๆ)
    s.on('data-updated', (data: { matches?: any[] }) => {
      if (data && Array.isArray(data.matches)) setCurrentMatches(data.matches);
    });

    // มีคนกดคะแนน/แก้แมตช์เดียวที่อื่น (เช่นหน้า Score หรือ Matches) ระหว่างที่
    // admin เปิดหน้านี้ค้างไว้ — merge เข้า currentMatches เพื่อให้พรีวิวจำนวน
    // คู่ที่จะหายไปยังคงถูกต้อง ไม่ใช้ข้อมูลเก่าค้าง
    s.on('match-updated', (updatedMatch: any) => {
      if (!updatedMatch?.id) return;
      setCurrentMatches(prev => mergeMatchesById(prev, [updatedMatch]));
    });
    s.on('matches-updated', (updatedMatches: any[]) => {
      if (!Array.isArray(updatedMatches) || updatedMatches.length === 0) return;
      setCurrentMatches(prev => mergeMatchesById(prev, updatedMatches));
    });

    // Server ตรวจพบว่าตารางที่กำลังจะบันทึกจะทำให้คู่เดิมบางคู่หายไป และยังไม่
    // ได้บันทึก — เปิด dialog เตือนให้ admin เลือกยกเลิกหรือยืนยันแทนที่
    s.on('import-would-drop-matches', (payload: { droppedMatches: DroppedMatchInfo[]; droppedCount: number }) => {
      setSuccess(null);
      setDropWarning({
        droppedMatches: payload?.droppedMatches || [],
        droppedCount: payload?.droppedCount || 0,
        pendingMatches: pendingImportRef.current || [],
      });
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

  // --- Backups: fetch list ---
  const fetchBackups = useCallback(async () => {
    setBackupsLoading(true);
    try {
      const res = await fetch('/api/backups');
      const data = await res.json();
      if (data?.success) setBackups(data.files || []);
      else setError('โหลดรายการ Backup ไม่สำเร็จ');
    } catch (err) {
      console.error(err);
      setError('เชื่อมต่อเพื่อโหลดรายการ Backup ไม่ได้');
    } finally {
      setBackupsLoading(false);
    }
  }, []);

  useEffect(() => { fetchBackups(); }, [fetchBackups]);

  // --- Backups: create manual snapshot of the current data.json ---
  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    setError(null);
    try {
      const res = await fetch('/api/backups', { method: 'POST' });
      const data = await res.json();
      if (data?.success) {
        setSuccess('สร้าง Backup สำเร็จ');
        fetchBackups();
      } else {
        setError('ไม่พบข้อมูล data.json ปัจจุบัน ไม่สามารถสร้าง Backup ได้');
      }
    } catch (err) {
      console.error(err);
      setError('สร้าง Backup ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setCreatingBackup(false);
    }
  };

  // --- Backups: restore a chosen snapshot back into data.json ---
  const handleRestore = async (filename: string) => {
    const { dateLabel } = parseBackupLabel(filename);
    const ok = confirm(
      `กู้คืนข้อมูลจาก Backup นี้?\n\n${dateLabel}\n\nระบบจะสำรองข้อมูลปัจจุบันไว้ก่อนโดยอัตโนมัติ แต่ข้อมูลทีม/ตารางแข่งที่มีอยู่ตอนนี้จะถูกแทนที่ทันที`
    );
    if (!ok) return;

    setRestoringFile(filename);
    setError(null);
    try {
      const res = await fetch('/api/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (data?.success) {
        setSuccess('กู้คืนข้อมูลสำเร็จ กำลังโหลดข้อมูลใหม่...');
        fetchBackups();
        // data.json ถูกแทนที่แล้ว — reload หน้าเพื่อให้ socket ต่อใหม่และรับ
        // roster-updated ชุดที่ตรงกับไฟล์ที่เพิ่ง restore จาก server
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setError('ไม่พบไฟล์ Backup นี้ หรือกู้คืนไม่สำเร็จ');
      }
    } catch (err) {
      console.error(err);
      setError('กู้คืนข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setRestoringFile(null);
    }
  };

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

  // สร้างรายชื่อคู่แข่งขันทั้งหมดจาก courtCombos ปัจจุบัน — ใช้ทั้งตอนพรีวิว
  // (เทียบว่าจะมีคู่เดิมหายไปกี่คู่ ก่อนกดสร้างจริง) และตอนกดสร้างตารางจริง
  //
  // ทีมถูก sort ตามชื่อมหาลัยก่อนจับคู่เสมอ (teams[i]/teams[j]) เพื่อให้ id ของ
  // แต่ละคู่คงที่ ไม่ขึ้นกับลำดับที่ทีมถูก insert เข้ามาใน roster — กันปัญหา id
  // เปลี่ยนไปมาเวลาลำดับแถวใน Excel เปลี่ยน ซึ่งจะทำให้คู่เดิม (พร้อมผลที่บันทึก
  // ไว้แล้ว) ดูเหมือนหายไปทั้งที่จริงๆ เป็นทีมชุดเดิม
  //
  // หลังสร้างคู่ทั้งหมดของแต่ละ combo (id คำนวณคงที่เหมือนเดิมทุกประการ) จะจัด
  // ลำดับการลงเล่นใหม่ผ่าน scheduleAvoidingBackToBack เพื่อให้แต่ละทีมได้พัก
  // ระหว่างคู่มากที่สุดเท่าที่เป็นไปได้ (และตอนนี้สุ่มคู่เริ่มต้น/คู่ที่คะแนนเท่ากัน
  // ด้วย — ดูคอมเมนต์ในฟังก์ชันนั้น) — ไม่กระทบ id เลย จึง preview "คู่เดิมจะ
  // หายไป" ยังทำงานถูกต้องเหมือนเดิมทุกกรณี
  //
  // "order" ถูกติดไปกับแต่ละแมตช์ตรงๆ (ลำดับคิวภายในสนามนี้ 0,1,2,...) เพื่อให้
  // ทุกหน้าที่ต้องคำนวณ "คู่ไหนต้องเล่นก่อน/รอคิว" (Matches, Live) sort ตามค่านี้
  // ได้เสมอ แทนที่จะพึ่งลำดับ array ที่ได้รับผ่าน socket ซึ่งอาจถูกต่อท้ายผิดลำดับ
  // ตอน merge match-updated/matches-updated เข้ามาทีหลัง (เช่นกรรมการกดคะแนน
  // ระหว่างที่หน้าอื่นเปิดค้างไว้) — มี field นี้ติดตัวแมตช์แล้ว ไม่ว่าจะ merge
  // ยังไงก็เรียงกลับมาถูกต้องเสมอ
  const buildAllMatches = useCallback(() => {
    const allMatches: any[] = [];
    courtCombos.forEach(combo => {
      const teams = entries
        .filter(e => e.category === combo.category && e.group === combo.group)
        .slice()
        .sort((a, b) => a.university.localeCompare(b.university));
      const catIndex = categories.indexOf(combo.category);
      const catSlug = CATEGORY_SLUG_MAP[combo.category] || `cat${catIndex >= 0 ? catIndex : 0}`;

      const comboMatches: any[] = [];
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          comboMatches.push({
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

      // จัดลำดับคู่ภายในสนามนี้ใหม่ ให้แต่ละทีมได้พักระหว่างคู่มากที่สุดเท่าที่ทำได้
      // (การสุ่มเมื่อคะแนนเท่ากันอยู่ในฟังก์ชันนี้แล้ว ไม่ต้อง shuffle comboMatches
      // ก่อนส่งเข้าไปเอง)
      const scheduledCombo = scheduleAvoidingBackToBack(comboMatches);
      // ติด "order" (ลำดับคิวภายในสนามนี้) ไปกับแมตช์แต่ละคู่ตรงๆ เพื่อให้หน้าอื่นๆ
      // sort คิวตามลำดับที่พักสลับกันแล้วนี้ได้เสมอ ไม่ต้องพึ่งลำดับ array ที่ได้รับ
      // ผ่าน socket (ซึ่งอาจถูกต่อท้ายผิดลำดับตอน merge match-updated/matches-updated
      // เข้ามา)
      scheduledCombo.forEach((m, idx) => { m.order = idx; });
      allMatches.push(...scheduledCombo);
    });
    return allMatches;
  }, [courtCombos, entries, categories]);

  // พรีวิว: ถ้าตารางที่กำลังจะสร้างใหม่ทำให้คู่ที่มีอยู่แล้วบน server บางคู่
  // หายไป (เพราะ id ไม่ตรงกับชุดใหม่อีกต่อไป) ให้เตือนไว้ล่วงหน้าก่อนกดปุ่มจริง
  const previewDroppedCount = useMemo(() => {
    if (currentMatches.length === 0) return 0;
    const newIds = new Set(buildAllMatches().map(m => m.id));
    return currentMatches.filter((m: any) => !newIds.has(m.id)).length;
  }, [currentMatches, buildAllMatches]);

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

    const allMatches = buildAllMatches();

    if (allMatches.length === 0) {
      setError("ไม่มีคู่แข่งขันให้สร้าง (แต่ละรุ่น/สาย ต้องมีอย่างน้อย 2 ทีม)");
      return;
    }

    if (!socketConnected) {
      setError("ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์ กรุณารอสักครู่แล้วลองใหม่");
      return;
    }

    // ส่งแบบฟอร์แมตใหม่ { matches, confirmDrop: false } เสมอ — ถ้า server ตรวจพบ
    // ว่ามีคู่เดิมที่จะหายไป จะยังไม่บันทึกทันที แต่ยิง "import-would-drop-matches"
    // กลับมาให้ยืนยันก่อน (ดู handleConfirmDrop / handleCancelDrop ด้านล่าง)
    pendingImportRef.current = allMatches;
    socketRef.current?.emit('import-excel', { matches: allMatches, confirmDrop: false });
    setMatchesGenerated(true);
    setSuccess(`สร้างตารางแข่งขันสำเร็จ ${allMatches.length} คู่ กระจายลง ${courtsUsed} สนาม (คะแนนคู่ที่มีผลอยู่แล้วจะไม่ถูกล้าง)`);
  };

  // Admin ยืนยันแล้วว่ายอมให้คู่เดิมที่แจ้งเตือนไว้ถูกแทนที่/ลบออก — ส่งชุดเดิมซ้ำ
  // พร้อม confirmDrop: true เพื่อให้ server บันทึกจริง
  const handleConfirmDrop = () => {
    if (!dropWarning) return;
    socketRef.current?.emit('import-excel', { matches: dropWarning.pendingMatches, confirmDrop: true });
    setMatchesGenerated(true);
    setSuccess(`สร้างตารางแข่งขันสำเร็จ (ยืนยันแทนที่คู่เดิมที่หายไป ${dropWarning.droppedCount} คู่)`);
    setDropWarning(null);
    pendingImportRef.current = null;
  };

  // Admin ยกเลิก — ไม่ส่งอะไรเพิ่ม ข้อมูลบน server ยังเป็นชุดเดิม (ยังไม่ถูกบันทึก)
  const handleCancelDrop = () => {
    setDropWarning(null);
    pendingImportRef.current = null;
  };

  const teamCount = entries.length;
  const playerCount = entries.reduce((sum, e) => sum + e.players.length, 0);

  // --- Roster filter/sort for the checking view (right panel) ---
  // ใช้ CATEGORY_GROUP_ORDER คงที่ด้านบน ไม่เกี่ยวกับลำดับการแข่ง (categories ที่
  // ลาก reorder ได้) — อันนี้มีไว้เพื่อให้ admin ไล่ตรวจรายชื่อนักกีฬาได้ง่ายเป็น
  // ระเบียบเดียวกันทุกครั้ง ไม่ว่าจะ import Excel มาลำดับไหนก็ตาม
  const [rosterFilter, setRosterFilter] = useState<string>('all');

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const rankA = getCategoryGroupRank(a.category, a.group);
      const rankB = getCategoryGroupRank(b.category, b.group);
      if (rankA !== rankB) return rankA - rankB;
      return a.university.localeCompare(b.university);
    });
  }, [entries]);

  // ตัวเลือกใน dropdown filter — เอาเฉพาะรุ่น/สายที่มีข้อมูลจริงอยู่ในระบบ เรียงตาม
  // ลำดับคงที่เดียวกัน ไม่โชว์ตัวเลือกที่ยังไม่มีทีมนำเข้ามาให้สับสน
  const rosterFilterOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { key: string; label: string }[] = [];
    sortedEntries.forEach(e => {
      const key = `${e.category}|${e.group}`;
      if (seen.has(key)) return;
      seen.add(key);
      opts.push({ key, label: (e.group && e.group !== '-') ? `รุ่น ${e.category} สาย ${e.group}` : `รุ่น ${e.category}` });
    });
    return opts;
  }, [sortedEntries]);

  const displayedEntries = useMemo(() => {
    if (rosterFilter === 'all') return sortedEntries;
    return sortedEntries.filter(e => `${e.category}|${e.group}` === rosterFilter);
  }, [sortedEntries, rosterFilter]);

  // เคลียร์ filter อัตโนมัติถ้ารุ่น/สายที่เลือกไว้ไม่มีข้อมูลเหลืออยู่แล้ว (เช่นลบทีม
  // สุดท้ายของสายนั้นออกไป) กันหน้าจอค้างว่างเปล่าโดยไม่รู้สาเหตุ
  useEffect(() => {
    if (rosterFilter === 'all') return;
    if (!rosterFilterOptions.some(o => o.key === rosterFilter)) setRosterFilter('all');
  }, [rosterFilterOptions, rosterFilter]);

  // ลบทีม/นักกีฬาต้องอ้างอิงด้วย "ตัวตนของ entry" (university+category+group) แทน
  // index เดิม เพราะ displayedEntries ผ่านการ sort/filter แล้ว ลำดับไม่ตรงกับ
  // entries ต้นฉบับอีกต่อไป — ใช้ฟังก์ชันนี้แทน index ทุกจุดในส่วน roster ด้านล่าง
  const removeTeam = (entry: TeamEntry) => {
    setEntries(prev => prev.filter(e => !(e.university === entry.university && e.category === entry.category && e.group === entry.group)));
  };
  const removePlayer = (entry: TeamEntry, playerId: string) => {
    setEntries(prev => prev.map(e => {
      if (e.university === entry.university && e.category === entry.category && e.group === entry.group) {
        return { ...e, players: e.players.filter(p => p.id !== playerId) };
      }
      return e;
    }));
  };

  // แก้ไขชื่อผู้เล่นจากหน้า Admin — ยิง event เดียวกับหน้า Matches ("update-player-name")
  // เพื่อให้ server อัปเดตทั้ง roster (ส่งกลับมาที่หน้านี้ผ่าน "roster-updated") และ
  // matches ที่มีผู้เล่นคนนี้อยู่ (ถ้าสร้างตารางแข่งไปแล้ว) ให้ตรงกันโดยอัตโนมัติ
  // ไม่ setEntries เองที่นี่ เพราะ server จะ broadcast "roster-updated" กลับมา
  // ทำให้ state ของทุกหน้า (รวมถึงหน้านี้เอง) sync กันโดยไม่ต้อง handle เองซ้ำซ้อน
  const handlePlayerNameUpdate = (entry: TeamEntry, playerId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    socketRef.current?.emit('update-player-name', {
      university: entry.university,
      category: entry.category,
      group: entry.group,
      playerId,
      newName: trimmed
    });
  };

  return (
    <main className="min-h-screen bg-[#05070d] text-white font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header className="bg-white/[0.03] backdrop-blur-xl p-7 rounded-3xl border border-white/10 shadow-xl">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
            <div className="flex items-center gap-4">
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
                Matches
              </Link>
              <Link href="/live" className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-amber-400">
                Live Board
              </Link>
              <Link href="/live-score" className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-amber-400">
                Live Score
              </Link>
              <button
                onClick={logout}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl font-bold transition-all text-[11px] uppercase tracking-wider text-red-400"
              >
                Logout
              </button>
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

        {/* Drop-confirmation dialog — server found existing matches (possibly with
            recorded scores) that would disappear under the new schedule/id set */}
        <AnimatePresence>
          {dropWarning && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
            >
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                className="w-full max-w-lg bg-[#0a0d16] border border-red-500/30 rounded-3xl shadow-2xl p-7"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 shrink-0">
                    <FaExclamationTriangle size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-black uppercase tracking-tight text-red-400">
                      คู่แข่งขันเดิมจะหายไป {dropWarning.droppedCount} คู่
                    </h3>
                    <p className="text-[11px] text-slate-500 font-bold mt-0.5 leading-relaxed">
                      ตารางใหม่ไม่มีคู่เหล่านี้อยู่แล้ว — หากยืนยัน คู่เหล่านี้ (รวมคะแนนที่บันทึกไว้) จะถูกลบออก
                    </p>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto space-y-1.5 mb-5 pr-1">
                  {dropWarning.droppedMatches.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-3 bg-black/30 px-3 py-2.5 rounded-xl border border-white/5">
                      <div className="leading-tight min-w-0">
                        <p className="text-xs font-bold truncate">
                          {m.teamA || '?'} vs {m.teamB || '?'}
                        </p>
                        <p className="text-[9px] text-amber-500 font-bold uppercase mt-0.5">
                          รุ่น {m.category} · สาย {m.group}
                        </p>
                      </div>
                      {m.isFinished && (
                        <span className="shrink-0 text-[9px] font-black uppercase tracking-wide px-2 py-1 rounded-md bg-red-500/15 border border-red-500/30 text-red-400">
                          มีผลแล้ว
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCancelDrop}
                    className="flex-1 px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl font-bold text-sm transition-all"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={handleConfirmDrop}
                    className="flex-1 px-5 py-3 bg-red-600 hover:bg-red-500 active:scale-[0.98] rounded-2xl font-black text-sm transition-all shadow-lg shadow-red-500/30"
                  >
                    ยืนยัน แทนที่ตาราง
                  </button>
                </div>
              </motion.div>
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

            {/* Preview warning — computed client-side from the last known server
                schedule, before the admin even clicks "generate" */}
            {previewDroppedCount > 0 && (
              <p className="text-[10px] text-red-400 font-bold text-center flex items-center justify-center gap-1.5">
                <FaExclamationTriangle size={10} />
                คู่เดิม {previewDroppedCount} คู่จะหายไปถ้าสร้างตารางนี้
              </p>
            )}

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

            {/* Backup & Restore — separate from the setup workflow above; lets the
                admin snapshot data.json and roll back to an earlier point in time. */}
            <WorkflowCard icon={<FaDatabase size={13} />} title="สำรอง / กู้คืนข้อมูล" accent="purple">
              <button
                onClick={handleCreateBackup}
                disabled={creatingBackup}
                className={`w-full px-5 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 text-sm transition-all border ${
                  creatingBackup
                    ? 'bg-white/[0.02] text-slate-600 border-white/10 cursor-not-allowed'
                    : 'bg-purple-600/15 hover:bg-purple-600/25 border-purple-500/30 text-purple-300'
                }`}
              >
                {creatingBackup ? (
                  <FaSyncAlt className="animate-spin" size={13} />
                ) : (
                  <FaCloudUploadAlt size={14} />
                )}
                {creatingBackup ? 'กำลังสร้าง Backup...' : 'สร้าง Backup ตอนนี้'}
              </button>

              <div className="flex items-center justify-between mt-4 mb-2">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide flex items-center gap-1.5">
                  <FaHistory size={10} /> ประวัติ Backup ({backups.length})
                </p>
                <button
                  onClick={fetchBackups}
                  disabled={backupsLoading}
                  title="รีเฟรชรายการ"
                  className="text-slate-500 hover:text-purple-300 transition-colors disabled:opacity-40"
                >
                  <FaSyncAlt size={11} className={backupsLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              {backupsLoading && backups.length === 0 ? (
                <p className="text-xs text-slate-600 italic py-4 text-center">กำลังโหลดรายการ Backup...</p>
              ) : backups.length === 0 ? (
                <p className="text-xs text-slate-600 italic py-4 text-center">ยังไม่มี Backup — กด &ldquo;สร้าง Backup ตอนนี้&rdquo; เพื่อเริ่มสำรองข้อมูล</p>
              ) : (
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                  {backups.map(filename => {
                    const { typeLabel, typeAccent, dateLabel } = parseBackupLabel(filename);
                    const isRestoringThis = restoringFile === filename;
                    const chipColor = typeAccent === 'amber'
                      ? 'bg-amber-400/10 border-amber-400/30 text-amber-400'
                      : typeAccent === 'emerald'
                      ? 'bg-emerald-400/10 border-emerald-400/30 text-emerald-400'
                      : 'bg-blue-400/10 border-blue-400/30 text-blue-400';
                    return (
                      <div
                        key={filename}
                        className="flex items-center justify-between gap-3 bg-black/30 px-3 py-2.5 rounded-xl border border-white/5 hover:border-purple-500/30 transition-colors"
                      >
                        <div className="leading-tight min-w-0">
                          <span className={`inline-block px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wide ${chipColor}`}>
                            {typeLabel}
                          </span>
                          <p className="text-[11px] font-bold text-slate-300 mt-1 truncate">{dateLabel}</p>
                        </div>
                        <button
                          onClick={() => handleRestore(filename)}
                          disabled={restoringFile !== null}
                          className={`shrink-0 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide flex items-center gap-1.5 transition-all ${
                            isRestoringThis
                              ? 'bg-purple-500/20 text-purple-300 cursor-wait'
                              : restoringFile !== null
                              ? 'bg-white/5 text-slate-600 cursor-not-allowed'
                              : 'bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300'
                          }`}
                        >
                          {isRestoringThis ? (
                            <FaSyncAlt className="animate-spin" size={10} />
                          ) : (
                            <FaHistory size={10} />
                          )}
                          {isRestoringThis ? 'กำลังกู้คืน' : 'กู้คืน'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[9px] text-slate-600 font-bold mt-3 text-center leading-relaxed">
                ระบบจะสำรองข้อมูลปัจจุบันไว้อัตโนมัติทุกครั้งก่อนกู้คืน (ไฟล์ &ldquo;ก่อน Restore&rdquo;) และจะสำรองข้อมูลให้เองเป็นระยะระหว่างวัน (ไฟล์ &ldquo;อัตโนมัติ&rdquo;)
              </p>
            </WorkflowCard>
          </div>

          {/* RIGHT: Roster */}
          <div className="lg:col-span-8">
            <section className="bg-white/[0.03] backdrop-blur-xl p-7 rounded-3xl border border-white/10 shadow-xl min-h-[600px]">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-6">
                <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-3">
                  <span className="w-1.5 h-6 bg-blue-500 rounded-full" /> รายชื่อนักกีฬาที่นำเข้า
                </h2>
                <div className="flex items-center gap-3">
                  {entries.length > 0 && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 whitespace-nowrap">
                      {displayedEntries.length === teamCount ? `${teamCount} ทีม · ${playerCount} คน` : `${displayedEntries.length}/${teamCount} ทีม`}
                    </span>
                  )}
                  {/* Filter — เรียงตามลำดับคงที่ กิตติมศักดิ์ / ทั่วไป A-B / 70-130 / หญิงคู่ทั่วไป /
                      อาวุโสหญิง 70+ เพื่อให้ admin ไล่ตรวจรายชื่อทีละรุ่นได้สะดวก */}
                  {rosterFilterOptions.length > 0 && (
                    <select
                      value={rosterFilter}
                      onChange={(e) => setRosterFilter(e.target.value)}
                      className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-[11px] font-bold text-slate-300 focus:outline-none focus:border-blue-500/40"
                    >
                      <option value="all">ทุกรุ่น/สาย</option>
                      {rosterFilterOptions.map(o => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {entries.length === 0 ? (
                <div className="h-[480px] flex flex-col items-center justify-center text-slate-700">
                  <FaFileExcel size={64} className="mb-4 opacity-30" />
                  <p className="font-bold uppercase tracking-widest text-sm text-slate-600">รอไฟล์ Excel</p>
                  <p className="text-[11px] text-slate-700 mt-1">นำเข้าไฟล์รายชื่อนักกีฬาเพื่อเริ่มต้น</p>
                </div>
              ) : displayedEntries.length === 0 ? (
                <div className="h-[480px] flex flex-col items-center justify-center text-slate-700">
                  <FaUsers size={64} className="mb-4 opacity-30" />
                  <p className="font-bold uppercase tracking-widest text-sm text-slate-600">ไม่พบทีมในรุ่น/สายนี้</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {displayedEntries.map((entry) => (
                    <div key={`${entry.university}-${entry.category}-${entry.group}`} className="bg-black/30 rounded-2xl border border-white/5 overflow-hidden group hover:border-blue-500/30 transition-all">
                      <div className="bg-white/[0.03] px-4 py-3 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <span className="bg-blue-600/90 text-white font-black px-2.5 py-1 rounded-lg text-xs">{entry.university}</span>
                          <div className="leading-tight">
                            <p className="text-xs font-bold">รุ่น {entry.category}</p>
                            {entry.group && entry.group !== '-' && (
                              <p className="text-[9px] text-amber-500 font-bold uppercase mt-0.5">สาย {entry.group}</p>
                            )}
                          </div>
                        </div>
                        <button onClick={() => removeTeam(entry)} className="text-slate-600 hover:text-red-500 transition-colors p-1">
                          <FaTrash size={12} />
                        </button>
                      </div>
                      <div className="p-3 space-y-1.5">
                        {entry.players.length === 0 && (
                          <p className="text-[10px] text-slate-700 italic px-2 py-1">ไม่มีรายชื่อนักกีฬา</p>
                        )}
                        {entry.players.map(p => (
                          <div key={p.id} className="flex justify-between items-center bg-white/[0.02] px-3 py-1.5 rounded-lg border border-white/5 group/p">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.role === 'starter' ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-orange-500'}`} />
                              <input
                                key={`${p.id}-${p.name}`}
                                type="text"
                                defaultValue={p.name}
                                onBlur={(e) => handlePlayerNameUpdate(entry, p.id, e.target.value)}
                                className="bg-transparent text-[11px] font-bold text-slate-300 focus:outline-none border-b border-transparent hover:border-white/20 focus:border-blue-400 transition-all min-w-0 w-full"
                              />
                            </div>
                            <button onClick={() => removePlayer(entry, p.id)} className="opacity-0 group-hover/p:opacity-100 text-slate-500 hover:text-red-500 transition-all shrink-0 ml-2">
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

function WorkflowCard({
  step, icon, title, accent, children
}: {
  step?: number;
  icon?: React.ReactNode;
  title: string;
  accent: 'emerald' | 'blue' | 'amber' | 'purple';
  children: React.ReactNode;
}) {
  const palette = {
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30' },
    blue: { text: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30' },
    amber: { text: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/30' },
    purple: { text: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/30' },
  }[accent];

  return (
    <section className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-xl">
      <div className="flex items-center gap-3 mb-5">
        <span className={`w-7 h-7 rounded-lg ${palette.bg} border ${palette.border} ${palette.text} text-xs font-black flex items-center justify-center shrink-0`}>
          {step !== undefined ? step : icon}
        </span>
        <h2 className="text-sm font-black uppercase tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}
