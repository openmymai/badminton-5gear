// lib/backup-service.ts
import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'data', 'data.json');
const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

export function saveDataSafely(newData: any) {
  try {
    // 1. ตรวจสอบว่ามีโฟลเดอร์ backups หรือยัง
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // 2. ก่อนจะเขียนใหม่ ให้ Backup ไฟล์ปัจจุบันเก็บไว้ก่อน (ถ้าไฟล์เดิมมีอยู่)
    if (fs.existsSync(DATA_PATH)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(BACKUP_DIR, `data_${timestamp}.json`);
      fs.copyFileSync(DATA_PATH, backupPath);

      // (Optional) ลบไฟล์ backup ที่เก่าเกินไป (เก็บแค่ 20 ไฟล์ล่าสุด)
      const files = fs.readdirSync(BACKUP_DIR)
        .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);
      
      if (files.length > 20) {
        files.slice(20).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f.name)));
      }
    }

    // 3. ATOMIC WRITE: เขียนลงไฟล์ชั่วคราวก่อน
    const tempPath = DATA_PATH + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(newData, null, 2), 'utf-8');

    // 4. เปลี่ยนชื่อไฟล์ temp มาเป็นไฟล์จริง (Atomic Operation)
    fs.renameSync(tempPath, DATA_PATH);
    
    return { success: true };
  } catch (error) {
    console.error('Backup/Save Error:', error);
    return { success: false, error };
  }
}