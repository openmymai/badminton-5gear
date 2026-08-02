// app/report/page.tsx

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import * as d3 from "d3";
// ต้องติดตั้งเพิ่ม: npm install d3-sankey  (และถ้าใช้ TS เข้มงวด: npm install -D @types/d3-sankey)
import {
  sankey,
  sankeyLinkHorizontal,
  SankeyGraph,
  SankeyNodeMinimal,
  SankeyLinkMinimal,
} from "d3-sankey";
import { GiShuttlecock, GiTrophyCup } from "react-icons/gi";
import Link from "next/link";
import Image from "next/image";
import { getMatchWinner, isNoResult } from "../../lib/scoring";

/* ---------------------------------------------------------------------
   Types — คัดลอกมาจาก app/live-score/page.tsx เพื่อให้หน้านี้ทำงานได้แบบ
   standalone ถ้าต้องการใช้ร่วมกันในหลายหน้า แนะนำย้ายไป lib/types.ts
--------------------------------------------------------------------- */
interface Player {
  id: string;
  name: string;
  role: "starter" | "substitute";
}
interface Team {
  university: string;
  category: string;
  group: string;
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
  byeWinner?: "a" | "b" | null;
}

interface UniStanding {
  university: string;
  totalPoints: number;
  matchPoints: number;
  setsWon: number;
  setsLost: number;
  pointsWon: number;
  pointsConceded: number;
  matchesPlayed: number;
}

interface CategoryProgress {
  category: string;
  total: number;
  finished: number;
}

/* ---------------------------------------------------------------------
   Sankey — สถาบัน (uni) -> รุ่น-สาย (cat), ความหนาของเส้น = คะแนนที่ได้
--------------------------------------------------------------------- */
interface FlowNodeExtra {
  id: string;
  name: string;
  kind: "uni" | "cat";
  // ลำดับที่ต้องการให้แสดงในคอลัมน์ของตัวเอง — สถาบันเรียงตามตัวอักษร (เดิม)
  // ส่วนรุ่น-สายเรียงตาม CATEGORY_ORDER/heatmapRows (ทั่วไป, 70, 80, ... แยก A/B)
  // แทนการเรียงตามตัวอักษรของชื่อ ซึ่งจะสลับ 100/110/... ผิดที่
  order: number;
}
interface FlowLinkExtra {
  value: number;
}
type FlowNodeInput = FlowNodeExtra;
type FlowLinkInput = { source: string; target: string } & FlowLinkExtra;
type FlowNode = SankeyNodeMinimal<FlowNodeExtra, FlowLinkExtra> & FlowNodeExtra;
type FlowLink = SankeyLinkMinimal<FlowNodeExtra, FlowLinkExtra> & FlowLinkExtra;

const NON_SCORING_CATEGORIES = ["กิตติมศักดิ์"];

const CATEGORY_ORDER = [
  "กิตติมศักดิ์",
  "ทั่วไป",
  "70",
  "80",
  "90",
  "100",
  "110",
  "120",
  "130",
  "หญิงคู่ทั่วไป",
  "อาวุโสหญิง 70+",
];
const categoryOrderIndex = (category: string) => {
  const idx = CATEGORY_ORDER.indexOf(category);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
};

const UNIVERSITY_PALETTE = [
  "#34d399",
  "#38bdf8",
  "#fbbf24",
  "#fb7185",
  "#a78bfa",
  "#f472b6",
  "#2dd4bf",
];

// สีประจำสถาบัน (fix ตายตัว) — ถ้ามีสถาบันอื่นนอกเหนือจากนี้ จะ fallback ไปใช้
// UNIVERSITY_PALETTE แบบ ordinal ตามเดิม
const UNIVERSITY_COLOR_MAP: Record<string, string> = {
  CMU: "#a78bfa", // ม่วง
  CU: "#f472b6", // ชมพู
  KKU: "#c2542c", // ดินแดง
  KU: "#4ade80", // เขียวใบไม้
  PSU: "#2563eb", // น้ำเงิน
};

const mergeMatchUpdates = (prev: Match[], updates: Match[]): Match[] => {
  if (updates.length === 0) return prev;
  const map = new Map(prev.map((m) => [m.id, m]));
  updates.forEach((m) => {
    if (m && m.id) map.set(m.id, m);
  });
  return Array.from(map.values());
};

export default function ReportPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s: Socket = io();
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("data-updated", (data) => {
      if (data?.matches && Array.isArray(data.matches)) setMatches(data.matches);
    });
    s.on("match-updated", (updatedMatch: Match) => {
      if (!updatedMatch?.id) return;
      setMatches((prev) => mergeMatchUpdates(prev, [updatedMatch]));
    });
    s.on("matches-updated", (updatedMatches: Match[]) => {
      if (!Array.isArray(updatedMatches) || updatedMatches.length === 0) return;
      setMatches((prev) => mergeMatchUpdates(prev, updatedMatches));
    });
    return () => {
      s.disconnect();
    };
  }, []);

  /* -------------------------------------------------------------------
     Aggregation — คำนวณ ranking รวมทุกรุ่น-สาย, matrix คะแนนต่อรุ่น x
     สถาบัน, และผลต่าง set ต่อสถาบัน โดยใช้กติกาแจกแต้ม 5-4-3-2-1 แบบ
     เดียวกับหน้า Live Score (ดู standings useMemo ในไฟล์นั้น)
  ------------------------------------------------------------------- */
  const {
    universities,
    categories,
    heatmapRows,
    categoryPointsMatrix,
    uniStandings,
    categoryProgress,
    totalMatches,
    totalFinished,
  } = useMemo(() => {
    const categoriesSet = new Set<string>();
    const universitiesSet = new Set<string>();
    matches.forEach((m) => {
      categoriesSet.add(m.category);
      universitiesSet.add(m.teamA.university);
      universitiesSet.add(m.teamB.university);
    });
    const categories = Array.from(categoriesSet).sort(
      (a, b) => categoryOrderIndex(a) - categoryOrderIndex(b) || a.localeCompare(b, "th")
    );
    const universities = Array.from(universitiesSet).sort((a, b) => a.localeCompare(b, "th"));

    // เช็คว่ารุ่นไหนมีสาย A/B (กลุ่ม round-robin) บ้าง — ใช้ร่วมกันทั้งกราฟ
    // "ความคืบหน้าการแข่งขัน" และ heatmap "คะแนนแยกตามรุ่น x สถาบัน"
    const categoryGroupsSet: Record<string, Set<string>> = {};
    matches.forEach((m) => {
      if (!categoryGroupsSet[m.category]) categoryGroupsSet[m.category] = new Set();
      categoryGroupsSet[m.category].add((m.group || "").trim().toUpperCase());
    });
    const categoryHasAB = (c: string) => {
      const g = categoryGroupsSet[c];
      return !!g && (g.has("A") || g.has("B"));
    };

    // แถวของ heatmap: รุ่นที่มีสาย A/B จะถูกแยกเป็น "70 A" / "70 B" สองแถว
    // ส่วนรุ่นที่ไม่มีสาย A/B ให้เป็นแถวเดียวตามเดิม
    const heatmapRows: string[] = [];
    categories.forEach((c) => {
      if (categoryHasAB(c)) {
        (["A", "B"] as const).forEach((g) => {
          if (categoryGroupsSet[c].has(g)) heatmapRows.push(`${c} ${g}`);
        });
      } else {
        heatmapRows.push(c);
      }
    });

    const uniMap: Record<string, UniStanding> = {};
    const ensureUni = (u: string): UniStanding => {
      if (!uniMap[u]) {
        uniMap[u] = {
          university: u,
          totalPoints: 0,
          matchPoints: 0,
          setsWon: 0,
          setsLost: 0,
          pointsWon: 0,
          pointsConceded: 0,
          matchesPlayed: 0,
        };
      }
      return uniMap[u];
    };
    universities.forEach(ensureUni);

    const matrix: Record<string, Record<string, number>> = {};
    universities.forEach((u) => {
      matrix[u] = {};
      heatmapRows.forEach((r) => {
        matrix[u][r] = 0;
      });
    });

    const groupKeys = Array.from(new Set(matches.map((m) => `${m.category}__${m.group}`)));

    groupKeys.forEach((key) => {
      const sepIdx = key.indexOf("__");
      const category = key.slice(0, sepIdx);
      const group = key.slice(sepIdx + 2);
      const finishedInGroup = matches.filter(
        (m) => m.category === category && m.group === group && m.isFinished
      );
      if (finishedInGroup.length === 0) return;

      const isNonScoring = NON_SCORING_CATEGORIES.includes(category);
      const internal: Record<string, { mPts: number; pWon: number; pConceded: number }> = {};
      const ensureInternal = (u: string) => {
        if (!internal[u]) internal[u] = { mPts: 0, pWon: 0, pConceded: 0 };
        return internal[u];
      };

      finishedInGroup.forEach((m) => {
        const uniA = m.teamA.university;
        const uniB = m.teamB.university;
        ensureInternal(uniA);
        ensureInternal(uniB);
        const a = ensureUni(uniA);
        const b = ensureUni(uniB);
        a.matchesPlayed += 1;
        b.matchesPlayed += 1;

        if (isNoResult(m)) return;

        const s1a = Number(m.score.s1a) || 0;
        const s1b = Number(m.score.s1b) || 0;
        const s2a = Number(m.score.s2a) || 0;
        const s2b = Number(m.score.s2b) || 0;
        const winner = getMatchWinner(m);

        internal[uniA].pWon += s1a + s2a;
        internal[uniA].pConceded += s1b + s2b;
        internal[uniB].pWon += s1b + s2b;
        internal[uniB].pConceded += s1a + s2a;
        if (winner === "a") internal[uniA].mPts += 2;
        else if (winner === "b") internal[uniB].mPts += 2;
        else {
          internal[uniA].mPts += 1;
          internal[uniB].mPts += 1;
        }

        a.pointsWon += s1a + s2a;
        a.pointsConceded += s1b + s2b;
        b.pointsWon += s1b + s2b;
        b.pointsConceded += s1a + s2a;
        a.matchPoints += winner === "a" ? 2 : winner === "b" ? 0 : 1;
        b.matchPoints += winner === "b" ? 2 : winner === "a" ? 0 : 1;

        if (s1a > s1b) {
          a.setsWon += 1;
          b.setsLost += 1;
        } else if (s1b > s1a) {
          b.setsWon += 1;
          a.setsLost += 1;
        }
        if (s2a > s2b) {
          a.setsWon += 1;
          b.setsLost += 1;
        } else if (s2b > s2a) {
          b.setsWon += 1;
          a.setsLost += 1;
        }
      });

      if (!isNonScoring) {
        const sortedInternal = Object.entries(internal).sort(([, x], [, y]) => {
          if (y.mPts !== x.mPts) return y.mPts - x.mPts;
          if (y.pWon !== x.pWon) return y.pWon - x.pWon;
          return x.pConceded - y.pConceded;
        });
        sortedInternal.forEach(([uni], idx) => {
          const pts = Math.max(1, 5 - idx);
          uniMap[uni].totalPoints += pts;
          const rowLabel = categoryHasAB(category)
            ? `${category} ${group.trim().toUpperCase()}`
            : category;
          matrix[uni][rowLabel] = (matrix[uni][rowLabel] || 0) + pts;
        });
      }
    });

    const uniStandings = Object.values(uniMap).sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        b.matchPoints - a.matchPoints ||
        b.pointsWon - a.pointsWon ||
        a.pointsConceded - b.pointsConceded
    );

    const progressMap: Record<string, { total: number; finished: number }> = {};
    matches.forEach((m) => {
      if (!progressMap[m.category]) progressMap[m.category] = { total: 0, finished: 0 };
      progressMap[m.category].total += 1;
      if (m.isFinished) progressMap[m.category].finished += 1;
    });

    const categoryProgress: CategoryProgress[] = [];
    categories.forEach((c) => {
      if (categoryHasAB(c)) {
        (["A", "B"] as const).forEach((g) => {
          if (!categoryGroupsSet[c].has(g)) return;
          const inGroup = matches.filter(
            (m) => m.category === c && (m.group || "").trim().toUpperCase() === g
          );
          categoryProgress.push({
            category: `${c} ${g}`,
            total: inGroup.length,
            finished: inGroup.filter((m) => m.isFinished).length,
          });
        });
      } else {
        categoryProgress.push({
          category: c,
          total: progressMap[c]?.total ?? 0,
          finished: progressMap[c]?.finished ?? 0,
        });
      }
    });

    return {
      universities,
      categories,
      heatmapRows,
      categoryPointsMatrix: matrix,
      uniStandings,
      categoryProgress,
      totalMatches: matches.length,
      totalFinished: matches.filter((m) => m.isFinished).length,
    };
  }, [matches]);

  const colorScale = useMemo(() => {
    const unmapped = universities.filter((u) => !UNIVERSITY_COLOR_MAP[u.trim().toUpperCase()]);
    const fallback = d3.scaleOrdinal<string, string>().domain(unmapped).range(UNIVERSITY_PALETTE);
    return (u: string) => UNIVERSITY_COLOR_MAP[u.trim().toUpperCase()] ?? fallback(u);
  }, [universities]);

  // เตรียมข้อมูลสำหรับ Sankey: สถาบัน (ซ้าย) -> รุ่น-สาย (ขวา) โดยความหนาของ
  // เส้นคือคะแนนที่สถาบันนั้นทำได้ในรุ่นนั้น ๆ (ใช้ตัวเลขชุดเดียวกับ heatmap)
  const sankeyData = useMemo<{ nodes: FlowNodeInput[]; links: FlowLinkInput[] }>(() => {
    const links: FlowLinkInput[] = [];
    const usedUnis = new Set<string>();
    const usedCats = new Set<string>();

    universities.forEach((u) => {
      heatmapRows.forEach((row) => {
        const value = categoryPointsMatrix[u]?.[row] ?? 0;
        if (value <= 0) return;
        links.push({ source: `uni:${u}`, target: `cat:${row}`, value });
        usedUnis.add(u);
        usedCats.add(row);
      });
    });

    const nodes: FlowNodeInput[] = [
      ...universities
        .filter((u) => usedUnis.has(u))
        .map((u, i) => ({ id: `uni:${u}`, name: u, kind: "uni" as const, order: i })),
      // heatmapRows เรียงตาม CATEGORY_ORDER อยู่แล้ว (ทั่วไป A/B, 70 A/B, 80, ...)
      // filter แล้วยังคงลำดับเดิม จึงใช้ index ตรง ๆ เป็น order ได้เลย
      ...heatmapRows
        .filter((r) => usedCats.has(r))
        .map((r, i) => ({ id: `cat:${r}`, name: r, kind: "cat" as const, order: i })),
    ];

    return { nodes, links };
  }, [universities, heatmapRows, categoryPointsMatrix]);

  return (
    <main className="min-h-screen bg-[#05070d] p-6 font-sans text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <header className="flex flex-col items-start justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-xl backdrop-blur-xl lg:flex-row lg:items-center">
          <div className="flex items-center gap-4">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-white bg-white shadow-lg sm:h-14 sm:w-14">
              <Image
                src="/5gearlogo.jpg"
                alt="5 Gear Logo"
                fill
                className="object-cover"
                priority
                sizes="(max-width: 640px) 48px, 56px"
              />
            </div>
            <div>
              <h1 className="text-2xl leading-none font-black tracking-tight uppercase">Report</h1>
              <p className="mt-1.5 text-[10px] font-bold tracking-[3px] text-emerald-400/80 uppercase">
                รายงานสรุปผลการแข่งขันรวมทุกรุ่น-สาย
              </p>
            </div>
            <span
              className={`ml-1 h-2 w-2 rounded-full ${connected ? "bg-emerald-500 shadow-[0_0_6px_#10b981]" : "bg-red-500 shadow-[0_0_6px_#ef4444]"}`}
            />
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold tracking-wider text-slate-300 uppercase transition-all hover:bg-white/10"
            >
              Leaderboard
            </Link>
            <Link
              href="/live-score"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold tracking-wider text-slate-300 uppercase transition-all hover:bg-white/10"
            >
              Live Score
            </Link>
            <Link
              href="/live"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold tracking-wider text-slate-300 uppercase transition-all hover:bg-white/10"
            >
              Live Board
            </Link>
          </div>
        </header>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="คู่ทั้งหมด"
            value={totalMatches}
            icon={<GiShuttlecock size={18} />}
            accent="text-slate-300"
          />
          <StatCard
            label="แข่งจบแล้ว"
            value={totalFinished}
            icon={<GiShuttlecock size={18} />}
            accent="text-emerald-400"
          />
          <StatCard
            label="กำลังแข่ง"
            value={totalMatches - totalFinished}
            icon={<GiShuttlecock size={18} />}
            accent="text-amber-400"
          />
          <StatCard
            label="สถาบันที่เข้าร่วม"
            value={universities.length}
            icon={<GiTrophyCup size={18} />}
            accent="text-sky-400"
          />
        </div>

        {/* University color legend */}
        {universities.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="mr-1 text-[10px] font-black tracking-widest text-slate-500 uppercase">
              สถาบัน
            </span>
            {universities.map((u) => (
              <span
                key={u}
                className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-black tracking-wide text-slate-300 uppercase"
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorScale(u) }} />
                {u}
              </span>
            ))}
          </div>
        )}

        {matches.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03] py-16 text-slate-600">
            <GiShuttlecock size={28} className="mb-3 opacity-40" />
            <p className="text-[11px] font-bold tracking-widest uppercase">
              ยังไม่มีข้อมูลการแข่งขัน
            </p>
          </div>
        ) : (
          <>
            {/* Overall ranking */}
            <ChartCard
              title="อันดับรวมทุกรุ่น-สาย"
              subtitle="คะแนนสะสมจากระบบแจกแต้ม 5-4-3-2-1 ของทุกรุ่น-สาย"
            >
              <RankingBarChart data={uniStandings} colorScale={colorScale} />
            </ChartCard>

            {/* Sankey — เส้นทางคะแนนจากสถาบันไปยังแต่ละรุ่น */}
            <ChartCard
              title="เส้นทางคะแนนสู่แต่ละรุ่น"
              subtitle="คะแนนที่แต่ละสถาบันทำได้ ไหลไปยังรุ่น-สายที่ทำคะแนนนั้น (แยกสาย A/B ถ้ามี)"
            >
              <div className="overflow-x-auto">
                <SankeyFlowChart data={sankeyData} colorScale={colorScale} />
              </div>
            </ChartCard>

            {/* Category x university heatmap */}
            <ChartCard
              title="คะแนนแยกตามรุ่น x สถาบัน"
              subtitle="ยิ่งสีเข้ม ยิ่งได้คะแนนมากในรุ่นนั้น (แยกสาย A/B ถ้ามี)"
            >
              <div className="overflow-x-auto">
                <CategoryHeatmap
                  categories={heatmapRows}
                  universities={universities}
                  matrix={categoryPointsMatrix}
                  colorScale={colorScale}
                />
              </div>
            </ChartCard>

            {/* Match progress by category — เต็มความกว้างจอ, แยกสาย A/B ถ้ารุ่นนั้นมี */}
            <ChartCard
              title="ความคืบหน้าการแข่งขัน"
              subtitle="สัดส่วนคู่ที่แข่งจบแล้วในแต่ละรุ่น (แยกสาย A/B ถ้ามี)"
            >
              <ProgressDonuts data={categoryProgress} />
            </ChartCard>

            {/* Sets differential — ย้ายลงมาล่างสุด, เต็มความกว้างจอ */}
            <ChartCard title="ผลต่างเซตชนะ-แพ้" subtitle="ต่อสถาบัน รวมทุกรุ่น-สาย">
              <SetsDiffChart data={uniStandings} colorScale={colorScale} />
            </ChartCard>
          </>
        )}
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------------
   Layout helpers
--------------------------------------------------------------------- */
function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className={`shrink-0 ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-2xl leading-none font-black tabular-nums">{value}</p>
        <p className="mt-1 text-[9px] font-bold tracking-widest text-slate-500 uppercase">
          {label}
        </p>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/5 px-5 py-4">
        <h2 className="text-sm font-black tracking-widest text-slate-300 uppercase">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[10px] font-bold text-slate-600">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   D3 — Overall ranking, horizontal bar chart
--------------------------------------------------------------------- */
function RankingBarChart({
  data,
  colorScale,
}: {
  data: UniStanding[];
  colorScale: (university: string) => string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const svg = d3.select(ref.current);

    const width = 760;
    const height = Math.max(160, data.length * 56);
    const margin = { top: 8, right: 60, bottom: 8, left: 116 };
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%");

    const maxPoints = Math.max(1, d3.max(data, (d) => d.totalPoints) ?? 1);
    const x = d3
      .scaleLinear()
      .domain([0, maxPoints])
      .nice()
      .range([margin.left, width - margin.right]);
    const y = d3
      .scaleBand()
      .domain(data.map((d) => d.university))
      .range([margin.top, height - margin.bottom])
      .padding(0.35);

    // Reuse the same <g> across renders instead of wiping the SVG each time —
    // this lets D3 match existing elements (by key) to the incoming data so it
    // can transition attributes smoothly rather than delete + recreate them.
    let g = svg.select<SVGGElement>("g.root");
    if (g.empty()) g = svg.append("g").attr("class", "root");

    const isFirstRender = !initializedRef.current;
    const dur = isFirstRender ? 700 : 500;

    g.selectAll<SVGRectElement, UniStanding>("rect.track")
      .data(data, (d: any) => d.university)
      .join(
        (enter) =>
          enter
            .append("rect")
            .attr("class", "track")
            .attr("x", margin.left)
            .attr("y", (d) => y(d.university)!)
            .attr("width", width - margin.left - margin.right)
            .attr("height", y.bandwidth())
            .attr("rx", 10)
            .attr("fill", "rgba(255,255,255,0.03)")
            .style("opacity", 0)
            .call((enter) => enter.transition().duration(dur).style("opacity", 1)),
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(dur)
              .ease(d3.easeCubicOut)
              .attr("y", (d) => y(d.university)!)
              .attr("height", y.bandwidth())
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );

    g.selectAll<SVGRectElement, UniStanding>("rect.bar")
      .data(data, (d: any) => d.university)
      .join(
        (enter) =>
          enter
            .append("rect")
            .attr("class", "bar")
            .attr("x", margin.left)
            .attr("y", (d) => y(d.university)!)
            .attr("height", y.bandwidth())
            .attr("rx", 10)
            .attr("fill", (d) => colorScale(d.university))
            .attr("width", 0)
            .call((enter) =>
              enter
                .transition()
                .duration(dur)
                .ease(d3.easeCubicOut)
                .attr("width", (d) => Math.max(3, x(d.totalPoints) - margin.left))
            ),
        (update) =>
          update.call((update) =>
            update
              .transition()
              .duration(dur)
              .ease(d3.easeCubicOut)
              .attr("y", (d) => y(d.university)!)
              .attr("height", y.bandwidth())
              .attr("fill", (d) => colorScale(d.university))
              .attr("width", (d) => Math.max(3, x(d.totalPoints) - margin.left))
          ),
        (exit) => exit.transition().duration(300).attr("width", 0).remove()
      );

    g.selectAll<SVGTextElement, UniStanding>("text.label")
      .data(data, (d: any) => d.university)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "label")
            .attr("x", margin.left - 12)
            .attr("y", (d) => y(d.university)! + y.bandwidth() / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("fill", "#cbd5e1")
            .attr("font-size", 12.5)
            .attr("font-weight", 900)
            .style("text-transform", "uppercase")
            .style("letter-spacing", "0.04em")
            .style("opacity", 0)
            .text((d) => d.university)
            .call((enter) => enter.transition().duration(dur).style("opacity", 1)),
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(dur)
              .attr("y", (d) => y(d.university)! + y.bandwidth() / 2)
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );

    g.selectAll<SVGTextElement, UniStanding>("text.value")
      .data(data, (d: any) => d.university)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "value")
            .attr("x", (d) => x(d.totalPoints) + 10)
            .attr("y", (d) => y(d.university)! + y.bandwidth() / 2)
            .attr("dy", "0.35em")
            .attr("fill", (d) => colorScale(d.university))
            .attr("font-size", 13)
            .attr("font-weight", 900)
            .style("opacity", 0)
            .text((d) => d.totalPoints)
            .call((enter) =>
              enter
                .transition()
                .delay(dur - 250)
                .duration(300)
                .style("opacity", 1)
            ),
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(dur)
              .attr("x", (d) => x(d.totalPoints) + 10)
              .attr("y", (d) => y(d.university)! + y.bandwidth() / 2)
              .attr("fill", (d) => colorScale(d.university))
              .textTween(function (d) {
                const node = this as SVGTextElement;
                const prev = Number(node.textContent) || d.totalPoints;
                const interpolateValue = d3.interpolateRound(prev, d.totalPoints);
                return (t: number) => String(interpolateValue(t));
              })
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );

    initializedRef.current = true;
  }, [data, colorScale]);

  return <svg ref={ref} className="w-full" />;
}

/* ---------------------------------------------------------------------
   D3 — Sankey: สถาบัน (ซ้าย) -> รุ่น-สาย (ขวา), ความหนาเส้น = คะแนนที่ได้
--------------------------------------------------------------------- */
function SankeyFlowChart({
  data,
  colorScale,
}: {
  data: { nodes: FlowNodeInput[]; links: FlowLinkInput[] };
  colorScale: (university: string) => string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!ref.current || data.nodes.length === 0 || data.links.length === 0) return;
    const svg = d3.select(ref.current);

    const width = 760;
    const uniCount = data.nodes.filter((n) => n.kind === "uni").length;
    const catCount = data.nodes.filter((n) => n.kind === "cat").length;
    const rowCount = Math.max(uniCount, catCount, 1);
    const height = Math.max(220, rowCount * 34);
    const margin = { top: 10, right: 130, bottom: 10, left: 96 };
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%");

    // d3-sankey เขียนทับ x0/x1/y0/y1 ลงใน object ตรง ๆ — ต้อง clone ข้อมูลใหม่
    // ทุกครั้งที่ render ไม่งั้น layout เก่าจากรอบก่อนจะตกค้างข้ามการอัปเดต
    const sankeyGen = sankey<FlowNodeExtra, FlowLinkExtra>()
      .nodeId((d) => d.id)
      .nodeWidth(12)
      .nodePadding(14)
      .nodeSort((a, b) => a.order - b.order)
      .extent([
        [margin.left, margin.top],
        [width - margin.right, height - margin.bottom],
      ]);

    const graph = sankeyGen({
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.links.map((l) => ({ ...l })),
    });

    const linkPath = sankeyLinkHorizontal<FlowNodeExtra, FlowLinkExtra>();
    const linkColor = (d: FlowLink) => colorScale((d.source as FlowNode).name);

    // Reuse the same <g> across renders (เหมือนกราฟอื่น ๆ ในหน้านี้) เพื่อให้ D3
    // จับคู่ element เดิมด้วย key แล้ว transition ค่าต่าง ๆ แบบ smooth แทนที่จะ
    // ลบ-สร้างใหม่ทุกครั้งที่ข้อมูลอัปเดต
    let g = svg.select<SVGGElement>("g.root");
    if (g.empty()) g = svg.append("g").attr("class", "root");

    const isFirstRender = !initializedRef.current;
    const dur = isFirstRender ? 700 : 500;

    g.selectAll<SVGPathElement, FlowLink>("path.link")
      .data(graph.links, (d: any) => `${d.source.id}->${d.target.id}`)
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("class", "link")
            .attr("fill", "none")
            .attr("stroke", (d) => linkColor(d))
            .attr("stroke-width", (d) => Math.max(1, d.width ?? 0))
            .attr("d", (d) => linkPath(d))
            .style("mix-blend-mode", "screen")
            .attr("stroke-opacity", 0)
            .call((enter) =>
              enter.transition().duration(dur).ease(d3.easeCubicOut).attr("stroke-opacity", 0.32)
            ),
        (update) =>
          update.attr("stroke-opacity", 0.32).call((update) =>
            update
              .transition()
              .duration(dur)
              .ease(d3.easeCubicOut)
              .attr("stroke", (d) => linkColor(d))
              .attr("stroke-width", (d) => Math.max(1, d.width ?? 0))
              .attr("d", (d) => linkPath(d))
          ),
        (exit) => exit.transition().duration(300).attr("stroke-opacity", 0).remove()
      )
      .on("mouseenter", function () {
        d3.select(this).transition().duration(150).attr("stroke-opacity", 0.65);
      })
      .on("mouseleave", function () {
        d3.select(this).transition().duration(150).attr("stroke-opacity", 0.32);
      });

    const nodeGroups = g
      .selectAll<SVGGElement, FlowNode>("g.node")
      .data(graph.nodes, (d: any) => d.id)
      .join(
        (enter) => {
          const eg = enter
            .append("g")
            .attr("class", "node")
            .attr("transform", (d) => `translate(${d.x0},${d.y0})`)
            .style("opacity", 0);

          eg.append("rect")
            .attr("class", "box")
            .attr("width", (d) => Math.max(1, (d.x1 ?? 0) - (d.x0 ?? 0)))
            .attr("height", (d) => Math.max(1, (d.y1 ?? 0) - (d.y0 ?? 0)))
            .attr("rx", 3)
            .attr("fill", (d) => (d.kind === "uni" ? colorScale(d.name) : "#64748b"));

          eg.append("text")
            .attr("class", "label")
            .attr("y", (d) => ((d.y1 ?? 0) - (d.y0 ?? 0)) / 2)
            .attr("dy", "0.35em")
            .attr("x", (d) => (d.kind === "uni" ? -10 : (d.x1 ?? 0) - (d.x0 ?? 0) + 10))
            .attr("text-anchor", (d) => (d.kind === "uni" ? "end" : "start"))
            .attr("font-size", 10.5)
            .attr("font-weight", 800)
            .style("letter-spacing", "0.03em")
            .each(function (d) {
              // ชื่อ + แต้มรวมที่ไหลผ่านโหนดนี้ — โชว์เฉพาะฝั่งสถาบัน ส่วนฝั่งรุ่น
              // แสดงแค่ชื่อรุ่นเฉย ๆ ให้ดูโล่งกว่า
              const t = d3.select(this);
              t.append("tspan")
                .attr("class", "name")
                .attr("fill", "#cbd5e1")
                .style("text-transform", "uppercase")
                .text(d.name);
              if (d.kind === "uni") {
                t.append("tspan")
                  .attr("class", "pts")
                  .attr("dx", 5)
                  .attr("font-weight", 900)
                  .attr("fill", colorScale(d.name))
                  .text(`(${Math.round(d.value ?? 0)})`);
              }
            });

          eg.call((enter) =>
            enter.transition().duration(dur).ease(d3.easeCubicOut).style("opacity", 1)
          );
          return eg;
        },
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(dur)
              .ease(d3.easeCubicOut)
              .attr("transform", (d) => `translate(${d.x0},${d.y0})`)
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );

    nodeGroups.each(function (d) {
      const sel = d3.select(this);
      const h = Math.max(1, (d.y1 ?? 0) - (d.y0 ?? 0));
      const w = Math.max(1, (d.x1 ?? 0) - (d.x0 ?? 0));

      sel
        .select<SVGRectElement>("rect.box")
        .transition()
        .duration(dur)
        .ease(d3.easeCubicOut)
        .attr("width", w)
        .attr("height", h)
        .attr("fill", d.kind === "uni" ? colorScale(d.name) : "#64748b");

      sel
        .select<SVGTextElement>("text.label")
        .transition()
        .duration(dur)
        .ease(d3.easeCubicOut)
        .attr("y", h / 2)
        .attr("x", d.kind === "uni" ? -10 : w + 10);

      sel.select<SVGTSpanElement>("text.label tspan.name").text(d.name);

      if (d.kind === "uni") {
        sel
          .select<SVGTSpanElement>("text.label tspan.pts")
          .transition()
          .duration(dur)
          .attr("fill", colorScale(d.name))
          .textTween(function () {
            const node = this as SVGTSpanElement;
            const prev = Number(String(node.textContent).replace(/[()]/g, "")) || 0;
            const target = Math.round(d.value ?? 0);
            const interpolateValue = d3.interpolateRound(prev, target);
            return (t: number) => `(${interpolateValue(t)})`;
          });
      }
    });

    initializedRef.current = true;
  }, [data, colorScale]);

  return <svg ref={ref} className="w-full" style={{ minWidth: 640 }} />;
}

/* ---------------------------------------------------------------------
   D3 — Category x University heatmap matrix
--------------------------------------------------------------------- */
function CategoryHeatmap({
  categories,
  universities,
  matrix,
  colorScale,
}: {
  categories: string[];
  universities: string[];
  matrix: Record<string, Record<string, number>>;
  colorScale: (university: string) => string;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || categories.length === 0 || universities.length === 0) return;
    const svg = d3.select(ref.current);

    const cellW = 92;
    const cellH = 42;
    const margin = { top: 34, right: 8, bottom: 8, left: 132 };
    const width = margin.left + margin.right + cellW * universities.length;
    const height = margin.top + margin.bottom + cellH * categories.length;
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", width);

    // Reuse the same <g> across renders (keyed joins below) instead of
    // wiping the SVG on every socket update — that's what caused the flash.
    let g = svg.select<SVGGElement>("g.root");
    if (g.empty()) g = svg.append("g").attr("class", "root");

    g.selectAll<SVGTextElement, string>("text.colhead")
      .data(universities, (d) => d)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "colhead")
            .attr("x", (_d, i) => margin.left + i * cellW + cellW / 2)
            .attr("y", margin.top - 14)
            .attr("text-anchor", "middle")
            .attr("font-size", 10.5)
            .attr("font-weight", 900)
            .attr("fill", (d) => colorScale(d))
            .style("text-transform", "uppercase")
            .style("opacity", 0)
            .text((d) => d)
            .call((enter) => enter.transition().duration(400).style("opacity", 1)),
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(400)
              .attr("x", (_d, i) => margin.left + i * cellW + cellW / 2)
              .attr("fill", (d) => colorScale(d))
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );

    g.selectAll<SVGTextElement, string>("text.rowhead")
      .data(categories, (d) => d)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "rowhead")
            .attr("x", margin.left - 12)
            .attr("y", (_d, i) => margin.top + i * cellH + cellH / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("font-size", 11)
            .attr("font-weight", 700)
            .attr("fill", "#94a3b8")
            .style("opacity", 0)
            .text((d) => d)
            .call((enter) => enter.transition().duration(400).style("opacity", 1)),
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(400)
              .attr("y", (_d, i) => margin.top + i * cellH + cellH / 2)
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );

    type Cell = { uni: string; cat: string; ci: number; ui: number; val: number };
    const cells: Cell[] = [];
    categories.forEach((cat, ci) => {
      universities.forEach((uni, ui) => {
        cells.push({ uni, cat, ci, ui, val: matrix[uni]?.[cat] ?? 0 });
      });
    });

    const cellGroups = g
      .selectAll<SVGGElement, Cell>("g.cell")
      .data(cells, (d: any) => `${d.uni}::${d.cat}`)
      .join(
        (enter) => {
          const eg = enter
            .append("g")
            .attr("class", "cell")
            .attr(
              "transform",
              (d) => `translate(${margin.left + d.ui * cellW},${margin.top + d.ci * cellH})`
            )
            .style("opacity", 0);
          eg.append("rect")
            .attr("width", cellW - 8)
            .attr("height", cellH - 8)
            .attr("rx", 8);
          eg.append("text")
            .attr("class", "score-text")
            .attr("x", (cellW - 8) / 2)
            .attr("y", (cellH - 8) / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .attr("font-size", 13)
            .attr("font-weight", 900)
            .style("fill", "#f8fafc");
          eg.transition().duration(400).style("opacity", 1);
          return eg;
        },
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(400)
              .attr(
                "transform",
                (d) => `translate(${margin.left + d.ui * cellW},${margin.top + d.ci * cellH})`
              )
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );

    cellGroups.each(function (d) {
      const cellG = d3.select(this);

      // พื้นหลัง cell เป็นสีเข้มของแต่ละสถาบัน (ไม่ไล่ระดับตามค่าคะแนนอีกต่อไป)
      // เช่น CMU ม่วงเข้ม, CU ชมพูเข้ม, KKU ดินแดงเข้ม, KU เขียวเข้ม, PSU น้ำเงินเข้ม
      const darkFill = d3.interpolateRgb("#0e1016", colorScale(d.uni))(0.32);
      cellG
        .select<SVGRectElement>("rect")
        .transition()
        .duration(400)
        .attr("fill", d.val > 0 ? darkFill : "rgba(255,255,255,0.02)")
        .attr("stroke", colorScale(d.uni))
        .attr("stroke-opacity", d.val > 0 ? 0.4 : 0.08);

      // ตัวเลขคะแนนใช้สีขาวคงที่เสมอ ไม่มีพื้นหลังของ font แล้ว
      cellG.select<SVGTextElement>("text.score-text").text(d.val > 0 ? String(d.val) : "");
    });
  }, [categories, universities, matrix, colorScale]);

  return <svg ref={ref} />;
}

/* ---------------------------------------------------------------------
   D3 — Sets won/lost differential, diverging bar chart
--------------------------------------------------------------------- */
function SetsDiffChart({
  data,
  colorScale,
}: {
  data: UniStanding[];
  colorScale: (university: string) => string;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const svg = d3.select(ref.current);

    const sorted = [...data].sort((a, b) => b.setsWon - b.setsLost - (a.setsWon - a.setsLost));
    const width = 640;
    const height = Math.max(160, sorted.length * 52);
    // margin ซ้าย-ขวาเผื่อพื้นที่ให้ label ตัวเลข (เช่น "+12 (18-6)") ไม่ให้โดนตัดขอบ
    // เมื่อสถาบันไหนมีผลต่างเซตเยอะจนแท่งเกือบชนขอบ SVG
    const labelGutter = 78;
    const margin = { top: 8, right: labelGutter, bottom: 8, left: Math.max(96, labelGutter) };
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%");

    const diffs = sorted.map((d) => d.setsWon - d.setsLost);
    const maxAbs = Math.max(1, d3.max(diffs, (d) => Math.abs(d)) ?? 1);
    const x = d3
      .scaleLinear()
      .domain([-maxAbs, maxAbs])
      .range([margin.left, width - margin.right]);
    const y = d3
      .scaleBand()
      .domain(sorted.map((d) => d.university))
      .range([margin.top, height - margin.bottom])
      .padding(0.35);
    const zeroX = x(0);

    // Reuse the same <g> and its children across renders (keyed joins below)
    // instead of wiping the SVG on every socket update.
    let g = svg.select<SVGGElement>("g.root");
    if (g.empty()) g = svg.append("g").attr("class", "root");

    let zeroLine = g.select<SVGLineElement>("line.zero");
    if (zeroLine.empty()) {
      zeroLine = g.append("line").attr("class", "zero").attr("stroke", "rgba(255,255,255,0.15)");
    }
    zeroLine
      .transition()
      .duration(500)
      .attr("x1", zeroX)
      .attr("x2", zeroX)
      .attr("y1", margin.top)
      .attr("y2", height - margin.bottom);

    // ถ้าพื้นที่ระหว่างปลายแท่งกับขอบกราฟไม่พอสำหรับ label (< ~60px) ให้สลับไปวาง
    // label ไว้ "ในแท่ง" แทน (ชิดปลายแท่งด้านใน, สีอ่อนตัดกับพื้นสี) กันไม่ให้แหว่ง/หลุดขอบ
    const estLabelWidth = 60;
    const barX = (d: UniStanding) => {
      const diff = d.setsWon - d.setsLost;
      return diff >= 0 ? zeroX : x(diff);
    };
    const barWidth = (d: UniStanding) => Math.abs(x(d.setsWon - d.setsLost) - zeroX);
    const labelX = (d: UniStanding) => {
      const diff = d.setsWon - d.setsLost;
      const barEndX = x(diff);
      const spaceOutside = diff >= 0 ? width - margin.right - barEndX : barEndX - margin.left;
      const fitsOutside = spaceOutside >= estLabelWidth;
      if (fitsOutside) return diff >= 0 ? barEndX + 8 : barEndX - 8;
      return diff >= 0 ? barEndX - 8 : barEndX + 8;
    };
    const labelAnchor = (d: UniStanding) => {
      const diff = d.setsWon - d.setsLost;
      const barEndX = x(diff);
      const spaceOutside = diff >= 0 ? width - margin.right - barEndX : barEndX - margin.left;
      const fitsOutside = spaceOutside >= estLabelWidth;
      if (fitsOutside) return diff >= 0 ? "start" : "end";
      return diff >= 0 ? "end" : "start";
    };
    const labelFill = (d: UniStanding) => {
      const diff = d.setsWon - d.setsLost;
      const barEndX = x(diff);
      const spaceOutside = diff >= 0 ? width - margin.right - barEndX : barEndX - margin.left;
      return spaceOutside >= estLabelWidth ? "#e2e8f0" : "#05070d";
    };
    const labelText = (d: UniStanding) => {
      const diff = d.setsWon - d.setsLost;
      return `${diff > 0 ? "+" : ""}${diff} (${d.setsWon}-${d.setsLost})`;
    };

    g.selectAll<SVGTextElement, UniStanding>("text.rowlabel")
      .data(sorted, (d: any) => d.university)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "rowlabel")
            .attr("x", margin.left - 12)
            .attr("y", (d) => y(d.university)! + y.bandwidth() / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("fill", "#cbd5e1")
            .attr("font-size", 11.5)
            .attr("font-weight", 900)
            .style("text-transform", "uppercase")
            .style("opacity", 0)
            .text((d) => d.university)
            .call((enter) => enter.transition().duration(500).style("opacity", 1)),
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(500)
              .attr("y", (d) => y(d.university)! + y.bandwidth() / 2)
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );

    g.selectAll<SVGRectElement, UniStanding>("rect.bar")
      .data(sorted, (d: any) => d.university)
      .join(
        (enter) =>
          enter
            .append("rect")
            .attr("class", "bar")
            .attr("y", (d) => y(d.university)!)
            .attr("height", y.bandwidth())
            .attr("rx", 8)
            .attr("fill", (d) => colorScale(d.university))
            .attr("x", zeroX)
            .attr("width", 0)
            .call((enter) =>
              enter
                .transition()
                .duration(700)
                .ease(d3.easeCubicOut)
                .attr("x", barX)
                .attr("width", barWidth)
            ),
        (update) =>
          update.call((update) =>
            update
              .transition()
              .duration(500)
              .ease(d3.easeCubicOut)
              .attr("y", (d) => y(d.university)!)
              .attr("height", y.bandwidth())
              .attr("fill", (d) => colorScale(d.university))
              .attr("x", barX)
              .attr("width", barWidth)
          ),
        (exit) => exit.transition().duration(300).attr("width", 0).remove()
      );

    g.selectAll<SVGTextElement, UniStanding>("text.value")
      .data(sorted, (d: any) => d.university)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "value")
            .attr("x", labelX)
            .attr("y", (d) => y(d.university)! + y.bandwidth() / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", labelAnchor)
            .attr("fill", labelFill)
            .attr("font-size", 11.5)
            .attr("font-weight", 800)
            .style("opacity", 0)
            .text(labelText)
            .call((enter) => enter.transition().delay(450).duration(300).style("opacity", 1)),
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(500)
              .attr("x", labelX)
              .attr("y", (d) => y(d.university)! + y.bandwidth() / 2)
              .attr("text-anchor", labelAnchor)
              .attr("fill", labelFill)
              .textTween((d) => () => labelText(d))
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );
  }, [data, colorScale]);

  return <svg ref={ref} className="w-full" />;
}

/* ---------------------------------------------------------------------
   D3 — Match progress per category, small-multiple radial gauges
--------------------------------------------------------------------- */
function ProgressDonuts({ data }: { data: CategoryProgress[] }) {
  const ref = useRef<SVGSVGElement>(null);
  // Tracks each category's last-drawn angle outside of D3's datum system —
  // gSel.select("path.fg") below re-binds the parent group's datum onto the
  // path every render, so a datum() set on the path itself doesn't survive.
  const anglesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const svg = d3.select(ref.current);

    const cols = Math.min(data.length, 6) || 1;
    const cell = 140;
    const rows = Math.ceil(data.length / cols);
    const width = cell * cols;
    const height = cell * rows;
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%");

    const radius = 44;
    const arcGen = d3
      .arc()
      .innerRadius(radius - 9)
      .outerRadius(radius)
      .startAngle(0);
    const arcBgPath = d3.arc()({
      innerRadius: radius - 9,
      outerRadius: radius,
      startAngle: 0,
      endAngle: 2 * Math.PI,
    } as d3.DefaultArcObject) as string;

    const cellPos = (i: number) => ({
      cx: (i % cols) * cell + cell / 2,
      cy: Math.floor(i / cols) * cell + cell / 2 - 6,
    });

    // Reuse the same <g> and per-category donut groups across renders instead
    // of wiping the SVG each time.
    let g = svg.select<SVGGElement>("g.root");
    if (g.empty()) g = svg.append("g").attr("class", "root");

    const groups = g
      .selectAll<SVGGElement, CategoryProgress>("g.donut")
      .data(data, (d: any) => d.category)
      .join(
        (enter) => {
          const eg = enter
            .append("g")
            .attr("class", "donut")
            .attr("transform", (_d, i) => {
              const { cx, cy } = cellPos(i);
              return `translate(${cx},${cy})`;
            })
            .style("opacity", 0);

          eg.append("path")
            .attr("class", "bg")
            .attr("d", arcBgPath)
            .attr("fill", "rgba(255,255,255,0.06)");
          eg.append("path").attr("class", "fg").attr("fill", "#38bdf8");
          eg.append("text")
            .attr("class", "pct")
            .attr("text-anchor", "middle")
            .attr("dy", "-0.1em")
            .attr("font-size", 17)
            .attr("font-weight", 900)
            .attr("fill", "#f1f5f9")
            .text("0%");
          eg.append("text")
            .attr("class", "frac")
            .attr("text-anchor", "middle")
            .attr("dy", "1.35em")
            .attr("font-size", 9)
            .attr("font-weight", 700)
            .attr("fill", "#64748b");
          eg.append("text")
            .attr("class", "cat")
            .attr("text-anchor", "middle")
            .attr("y", radius + 22)
            .attr("font-size", 10)
            .attr("font-weight", 900)
            .attr("fill", "#94a3b8")
            .style("text-transform", "uppercase")
            .text((d) => d.category);

          eg.transition().duration(400).style("opacity", 1);
          return eg;
        },
        (update) =>
          update.style("opacity", 1).call((update) =>
            update
              .transition()
              .duration(400)
              .attr("transform", (_d, i) => {
                const { cx, cy } = cellPos(i);
                return `translate(${cx},${cy})`;
              })
          ),
        (exit) => exit.transition().duration(300).style("opacity", 0).remove()
      );

    groups.each(function (d) {
      const pct = d.total > 0 ? d.finished / d.total : 0;
      const targetAngle = 2 * Math.PI * pct;
      const prevAngle = anglesRef.current.get(d.category) ?? 0;
      const gSel = d3.select(this);

      gSel
        .select<SVGPathElement>("path.fg")
        .attr("fill", pct >= 1 ? "#10b981" : "#38bdf8")
        .transition()
        .duration(800)
        .ease(d3.easeCubicOut)
        .attrTween("d", () => {
          const interpolateAngle = d3.interpolate(prevAngle, targetAngle);
          return (t: number) => {
            const angle = interpolateAngle(t);
            anglesRef.current.set(d.category, angle);
            return arcGen({ endAngle: angle } as any) as string;
          };
        });

      gSel
        .select<SVGTextElement>("text.pct")
        .transition()
        .duration(500)
        .textTween(function () {
          const node = this as SVGTextElement;
          const prev = Number(String(node.textContent).replace("%", "")) || 0;
          const interpolateValue = d3.interpolateRound(prev, Math.round(pct * 100));
          return (t: number) => `${interpolateValue(t)}%`;
        });

      gSel.select<SVGTextElement>("text.frac").text(`${d.finished}/${d.total}`);
      gSel.select<SVGTextElement>("text.cat").text(d.category);
    });
  }, [data]);

  return <svg ref={ref} className="w-full" />;
}
