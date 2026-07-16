#!/bin/bash

# --- ตั้งค่าตัวแปร ---
WIN_USER="your_windows_username"       # ชื่อ User ของ Windows 11
WIN_IP="192.168.1.xxx"                 # IP เครื่อง Windows 11
# Path ปลายทางบน Windows (ใช้ / แทน \ และระบุ Drive ด้วย)
WIN_DEST_PATH="C:/Users/Name/Desktop/badminton-project/data"

LOCAL_DATA_PATH="./data"

echo "--- Starting Backup Push to Windows Standby ---"

# 1. ส่งไฟล์ data.json (ตัวปัจจุบัน)
scp "${LOCAL_DATA_PATH}/data.json" "${WIN_USER}@${WIN_IP}:${WIN_DEST_PATH}/data.json"

# 2. ส่งโฟลเดอร์ backups ทั้งหมด (ใช้ rsync เพื่อส่งเฉพาะไฟล์ใหม่)
# หมายเหตุ: Windows ต้องมี rsync หรือใช้ scp -r แทนได้
# ในที่นี้ใช้ scp -r เพื่อความง่ายและไม่ต้องลงโปรแกรมเพิ่มใน Windows
scp -r "${LOCAL_DATA_PATH}/backups" "${WIN_USER}@${WIN_IP}:${WIN_DEST_PATH}/"

if [ $? -eq 0 ]; then
    echo "Successfully pushed data to Windows Standby!"
else
    echo "Error: Failed to push data."
fi

echo "--- Finished ---"


# ขั้นตอนที่ 1: เตรียม Windows 11 ให้รับไฟล์ได้ (เปิด OpenSSH Server)
# Windows 11 ปกติจะมี SSH Client แต่เราต้องเปิด SSH Server เพื่อให้ Ubuntu เชื่อมต่อเข้ามาได้ครับ:
# กดปุ่ม Start พิมพ์ "Optional Features"
# หา "OpenSSH Server" ถ้ายังไม่มีให้กด Add a feature แล้วติดตั้ง
# เปิด Services.msc (หาใน Start)
# หาชื่อ OpenSSH SSH Server -> คลิกขวาเลือก Properties -> ปรับ Startup type เป็น Automatic และกด Start
# ตั้งรหัสผ่านให้ User Windows: (ถ้ายังไม่มี) เพราะ SSH จำเป็นต้องใช้รหัสผ่าน หรือ SSH Key

# ขั้นตอนที่ 2: ตั้งค่า SSH Key (ให้ Ubuntu เข้า Windows ได้โดยไม่ต้องใช้รหัส)
# ที่เครื่อง Ubuntu (อยู่นอก Docker):
# รันคำสั่ง: ssh-keygen -t rsa (Enter ไปเรื่อยๆ จนจบ)
# ก๊อปปี้คีย์ไปวางใน Windows:
# เปิดไฟล์ด้วยคำสั่ง: cat ~/.ssh/id_rsa.pub
# ก๊อปปี้ข้อความทั้งหมดที่ปรากฏ
# ไปที่เครื่อง Windows เข้าไปที่โฟลเดอร์ C:\Users\ชื่อของคุณ\.ssh\ (ถ้าไม่มีโฟลเดอร์ให้สร้างขึ้นมา)
# สร้างไฟล์ชื่อ authorized_keys แล้ววางข้อความที่ก๊อปปี้มาลงไปในไฟล์นี้แล้วบันทึก

# ขั้นตอนที่ 3: ตั้งค่าให้ส่งอัตโนมัติ (Crontab)
# เพื่อให้ Ubuntu ส่งไฟล์ไปให้ Windows ตลอดเวลา (เช่น ทุก 15 นาที):
# พิมพ์คำสั่ง crontab -e
# เพิ่มบรรทัดนี้ลงไป (ปรับ path ให้ตรงกับที่อยู่ไฟล์จริง):
# */15 * * * * /bin/bash /home/user/project/push-to-standby.sh >> /home/user/project/backup.log 2>&1