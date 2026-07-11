// app/api/backups/restore/route.ts

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: Request) {
  const { filename } = await req.json();
  const DATA_DIR = path.join(process.cwd(), 'data');
  const backupPath = path.join(DATA_DIR, 'backups', filename);
  const targetPath = path.join(DATA_DIR, 'data.json');

  if (!fs.existsSync(backupPath)) return NextResponse.json({ success: false }, { status: 404 });

  // สร้าง backup ของไฟล์ปัจจุบันก่อน restore เผื่อเปลี่ยนใจ
  const emergencyName = `pre-restore_${new Date().getTime()}.json`;
  fs.copyFileSync(targetPath, path.join(DATA_DIR, 'backups', emergencyName));
  
  // ทำการ Restore
  fs.copyFileSync(backupPath, targetPath);
  return NextResponse.json({ success: true });
}