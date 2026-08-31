#!/bin/bash

# --- ตั้งค่าตัวแปร (ใช้ Absolute Path เพื่อความปลอดภัย) ---
WIN_USER="your_windows_username"
WIN_IP="192.168.1.xxx"
WIN_DEST_PATH="C:/Users/your_windows_username/Desktop/backup_folder" # <--- แก้จุดที่ขาดไป

LOCAL_DATA_PATH="/home/cmuengineer/badminton-5gear/data" 

count=0 # <--- กำหนดค่าเริ่มต้น

echo "--- Starting Continuous Sync (Every 10s) ---"

while true; do
    # 1. Sync เฉพาะ data.json (rsync จะส่งแค่เมื่อไฟล์มีการเปลี่ยนขนาดหรือเวลา)
    rsync -az "${LOCAL_DATA_PATH}/data.json" "${WIN_USER}@${WIN_IP}:'${WIN_DEST_PATH}/data.json'"
    
    # 2. ทุกๆ 1 นาที (6 รอบ loop) Sync โฟลเดอร์ backups
    # (rsync -azq จะส่งเฉพาะไฟล์ใหม่ หรือไฟล์ที่แก้ไขเท่านั้น ไม่ส่งทับทั้งหมดให้เปลืองเน็ต)
    if (( (count % 6) == 0 )); then
        rsync -azq "${LOCAL_DATA_PATH}/backups/" "${WIN_USER}@${WIN_IP}:'${WIN_DEST_PATH}/backups/'"
        echo "Full backups folder synced at $(date)"
    fi

    ((count++))
    sleep 10
done

# ฝั่ง Windows: ต้องเปิดใช้งาน OpenSSH Server และสร้างโฟลเดอร์ปลายทางไว้รอ
# ฝั่ง Ubuntu: ต้อง เจน SSH Key และก๊อปปี้ไปไว้ที่ Windows เพื่อให้ Ubuntu ล็อกอินเข้า Windows ได้โดยไม่ต้องกรอกรหัสผ่าน:
# ssh-keygen -t rsa
# ssh-copy-id WIN_USER@192.168.1.xxx
# 
# nohup ./push-to-standby.sh > standby.log 2>&1 &
