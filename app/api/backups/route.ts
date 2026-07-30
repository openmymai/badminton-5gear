// app/api/backups/route.ts

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Without this, Next.js treats this GET handler as a static route and caches
// its response (Full Route Cache) — new backup files written to disk by
// server.js (auto backups) or the POST handler below (manual backups) would
// never show up in the admin list, since GET would keep returning the same
// cached array instead of re-reading the folder.
export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

export async function GET() {
  if (!fs.existsSync(BACKUP_DIR)) return NextResponse.json({ success: true, files: [] });
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort(
      (a, b) =>
        fs.statSync(path.join(BACKUP_DIR, b)).mtime.getTime() -
        fs.statSync(path.join(BACKUP_DIR, a)).mtime.getTime()
    );
  return NextResponse.json({ success: true, files: files.slice(0, 10) });
}

export async function POST() {
  const source = path.join(DATA_DIR, "data.json");
  if (!fs.existsSync(source)) return NextResponse.json({ success: false }, { status: 404 });

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(source, path.join(BACKUP_DIR, `manual_${timestamp}.json`));
  return NextResponse.json({ success: true });
}
