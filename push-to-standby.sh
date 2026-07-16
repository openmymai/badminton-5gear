#!/bin/bash

# --- ตั้งค่าตัวแปร ---
WIN_USER="your_windows_username"
WIN_IP="192.168.1.xxx"
WIN_DEST_PATH="C:/Users/Name/Desktop/badminton-project/data"
LOCAL_DATA_PATH="./data"

echo "--- Starting Continuous Sync (Every 10s) ---"

while true; do
    # 1. เช็คว่าไฟล์ data.json มีการเปลี่ยนแปลงไหม (ใช้ MD5 เช็คเบื้องต้นเพื่อประหยัด bandwidth)
    # แต่ถ้าเอาแบบง่ายที่สุดคือส่งทับไปเลย
    
    # ส่งเฉพาะ data.json (เร็วมาก)
    scp -q "${LOCAL_DATA_PATH}/data.json" "${WIN_USER}@${WIN_IP}:${WIN_DEST_PATH}/data.json"
    
    # 2. ทุกๆ 1 นาที (6 รอบ loop) ค่อยส่งโฟลเดอร์ backups ทั้งหมดหนึ่งครั้ง
    # เพื่อไม่ให้เครื่องรับภาระหนักเกินไป
    if (( (count % 6) == 0 )); then
        scp -q -r "${LOCAL_DATA_PATH}/backups" "${WIN_USER}@${WIN_IP}:${WIN_DEST_PATH}/"
        echo "Full backups folder synced at $(date)"
    fi

    ((count++))
    sleep 10
done


# รันสคริปต์นี้ทิ้งไว้ในโหมด Background
# 1.ทำให้ไฟล์รันได้:
# chmod +x sync-loop.sh

# 2.รันด้วย nohup (เพื่อให้ทำงานแม้จะปิดหน้าจอ Terminal ไปแล้ว):
# nohup ./sync-loop.sh > sync.log 2>&1 &

# 3.ถ้าต้องการหยุดรัน:
# pkill -f sync-loop.sh