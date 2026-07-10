// server.js
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const hostname = "0.0.0.0"; // เพื่อให้มือถือเข้าผ่าน IP ได้

const app = next({ dev });
const handle = app.getRequestHandler();

const DATA_DIR = __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");
const BACKUP_FILE = path.join(DATA_DIR, "data.backup.json");
const TMP_FILE = path.join(DATA_DIR, "data.json.tmp");

// `roster` is the admin-panel working state (imported teams/players, category
// order, court assignment mode). It used to live only in the browser
// (localStorage) which is why it disappeared on refresh / a different device.
// It now lives in data.json alongside `matches`, so it survives refreshes,
// container restarts, and is shared across every admin screen.
const emptyRoster = () => ({
  entries: [],
  categories: [],
  courtMode: "auto",
  manualCourts: {}
});

const emptyData = () => ({
  matches: [],
  roster: emptyRoster(),
  lastUpdated: Date.now()
});

// ---------- Validation helpers ----------

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const isValidScore = (score) => {
  if (!isPlainObject(score)) return false;
  return ["s1a", "s1b", "s2a", "s2b"].every(
    (k) => typeof score[k] === "number" && Number.isFinite(score[k])
  );
};

const isValidTeam = (team) => {
  if (!isPlainObject(team)) return false;
  if (typeof team.university !== "string") return false;
  if (typeof team.category !== "string") return false;
  if (typeof team.group !== "string") return false;
  if (!Array.isArray(team.players)) return false;
  return team.players.every(
    (p) =>
      isPlainObject(p) &&
      typeof p.id === "string" &&
      typeof p.name === "string" &&
      (p.role === "starter" || p.role === "substitute")
  );
};

// Walkover/bye tag — byeWinner must be 'a', 'b', or null/undefined (not yet a bye).
const isValidByeWinner = (v) => v === undefined || v === null || v === "a" || v === "b";

const isValidMatch = (m) => {
  if (!isPlainObject(m)) return false;
  if (typeof m.id !== "string" || !m.id) return false;
  if (typeof m.category !== "string") return false;
  if (typeof m.group !== "string") return false;
  if (typeof m.court !== "string" && typeof m.court !== "number") return false;
  if (!isValidTeam(m.teamA) || !isValidTeam(m.teamB)) return false;
  if (!isValidScore(m.score)) return false;
  if (typeof m.isFinished !== "boolean") return false;
  // isBye/byeWinner are optional — matches imported fresh from Excel won't have them yet.
  if (m.isBye !== undefined && typeof m.isBye !== "boolean") return false;
  if (!isValidByeWinner(m.byeWinner)) return false;
  return true;
};

// Roster = the admin panel's working state. `entries` reuses the exact same
// shape as a match's teamA/teamB (university/category/group/players), so
// isValidTeam is reused as-is.
const isValidRoster = (r) => {
  if (!isPlainObject(r)) return false;
  if (!Array.isArray(r.entries) || !r.entries.every(isValidTeam)) return false;
  if (!Array.isArray(r.categories) || !r.categories.every((c) => typeof c === "string")) return false;
  if (r.courtMode !== "auto" && r.courtMode !== "manual") return false;
  if (!isPlainObject(r.manualCourts)) return false;
  if (
    !Object.values(r.manualCourts).every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 1
    )
  ) {
    return false;
  }
  return true;
};

// ---------- Persistence (atomic write + automatic backup/recovery) ----------

const readData = () => {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initial = emptyData();
      saveData(initial);
      return initial;
    }
    const content = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(content || "{}");
    if (!Array.isArray(parsed.matches)) {
      throw new Error("data.json missing a valid 'matches' array");
    }
    // Backfill `roster` for data.json files written before this field existed,
    // and guard against a corrupted roster block without discarding matches.
    if (!isValidRoster(parsed.roster)) {
      parsed.roster = emptyRoster();
    }
    return parsed;
  } catch (err) {
    console.error("[Data] Error reading data.json, attempting backup recovery:", err.message);
    try {
      if (fs.existsSync(BACKUP_FILE)) {
        const backupContent = fs.readFileSync(BACKUP_FILE, "utf-8");
        const parsedBackup = JSON.parse(backupContent || "{}");
        if (Array.isArray(parsedBackup.matches)) {
          if (!isValidRoster(parsedBackup.roster)) {
            parsedBackup.roster = emptyRoster();
          }
          console.warn("[Data] Recovered from backup file.");
          return parsedBackup;
        }
      }
    } catch (backupErr) {
      console.error("[Data] Backup recovery also failed:", backupErr.message);
    }
    console.warn("[Data] Falling back to empty dataset to keep the server alive.");
    return emptyData();
  }
};

// Writes atomically (tmp file + rename) and keeps a rolling backup so a crash
// mid-write can never leave data.json truncated/corrupted.
const saveData = (data) => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    }
    fs.writeFileSync(TMP_FILE, JSON.stringify(data, null, 2));
    fs.renameSync(TMP_FILE, DATA_FILE);
    return true;
  } catch (err) {
    console.error("[Data] Error saving data.json:", err.message);
    return false;
  }
};

// Merges a freshly generated match list with what's already persisted.
// Any match that already exists (matched by id) keeps its recorded score /
// isFinished status — regenerating the schedule from Excel must never wipe
// results that were already entered on court. This includes the walkover/bye
// tag (isBye/byeWinner): a match filed as a Bye must stay tagged as a Bye
// even after the admin re-imports the schedule. Roster/court/category fields
// are refreshed from the new payload in case the admin edited names or
// reassigned courts.
const mergeMatches = (existingMatches, incomingMatches) => {
  const existingById = new Map(existingMatches.map((m) => [m.id, m]));
  let preserved = 0;
  let added = 0;

  const merged = incomingMatches.map((incoming) => {
    const prior = existingById.get(incoming.id);
    if (prior) {
      preserved++;
      return {
        ...incoming,
        score: prior.score,
        isFinished: prior.isFinished,
        isBye: prior.isBye ?? false,
        byeWinner: prior.byeWinner ?? null,
      };
    }
    added++;
    return incoming;
  });

  return { merged, preserved, added };
};

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("[HTTP] Unhandled request error:", err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    try {
      const data = readData();
      socket.emit("data-updated", data);
      // Send the roster separately too so the admin page (which only cares
      // about roster, not match results) can listen to a lighter event.
      socket.emit("roster-updated", data.roster);
    } catch (err) {
      console.error("[Socket] Error sending initial data:", err);
    }

    // อัปเดตเฉพาะแมตช์เดียว (คะแนน, สนาม, สถานะ, รายชื่อทีม, แท็ก walkover/bye)
    socket.on("update-score", (payload) => {
      try {
        if (!isPlainObject(payload) || typeof payload.matchId !== "string") {
          socket.emit("action-error", { message: "ข้อมูลที่ส่งมาไม่ถูกต้อง (update-score)" });
          return;
        }
        const { matchId, score, isFinished, court, teamA, teamB, isBye, byeWinner } = payload;

        if (score !== undefined && !isValidScore(score)) {
          socket.emit("action-error", { message: "รูปแบบคะแนนไม่ถูกต้อง" });
          return;
        }
        if (teamA !== undefined && !isValidTeam(teamA)) {
          socket.emit("action-error", { message: "ข้อมูลทีม A ไม่ถูกต้อง" });
          return;
        }
        if (teamB !== undefined && !isValidTeam(teamB)) {
          socket.emit("action-error", { message: "ข้อมูลทีม B ไม่ถูกต้อง" });
          return;
        }
        if (isBye !== undefined && typeof isBye !== "boolean") {
          socket.emit("action-error", { message: "รูปแบบสถานะ Walkover/Bye ไม่ถูกต้อง" });
          return;
        }
        if (byeWinner !== undefined && !isValidByeWinner(byeWinner)) {
          socket.emit("action-error", { message: "รูปแบบผู้ชนะ Walkover/Bye ไม่ถูกต้อง" });
          return;
        }

        const data = readData();
        const index = data.matches.findIndex((m) => m.id === matchId);

        if (index === -1) {
          socket.emit("action-error", { message: `ไม่พบแมตช์ ${matchId}` });
          return;
        }

        if (score !== undefined) data.matches[index].score = score;
        if (isFinished !== undefined) data.matches[index].isFinished = Boolean(isFinished);
        if (court !== undefined) data.matches[index].court = String(court);
        if (teamA !== undefined) data.matches[index].teamA = teamA;
        if (teamB !== undefined) data.matches[index].teamB = teamB;
        if (isBye !== undefined) data.matches[index].isBye = isBye;
        if (byeWinner !== undefined) data.matches[index].byeWinner = byeWinner;

        data.lastUpdated = Date.now();
        if (saveData(data)) {
          io.emit("data-updated", data); // กระจายให้ทุกเครื่อง
        } else {
          socket.emit("action-error", { message: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่" });
        }
      } catch (err) {
        console.error("[Socket] update-score error:", err);
        socket.emit("action-error", { message: "เกิดข้อผิดพลาดขณะบันทึกคะแนน" });
      }
    });

    // รับตารางแข่งขันที่สร้างใหม่ทั้งชุดจากหน้า Admin แล้ว merge เข้ากับของเดิม
    // (แมตช์ที่มีอยู่แล้วจะคงคะแนน/ผลเดิม รวมถึงแท็ก walkover/bye ไว้ ไม่ถูกรีเซ็ต)
    socket.on("import-excel", (newMatches) => {
      try {
        if (!Array.isArray(newMatches)) {
          socket.emit("action-error", { message: "รูปแบบข้อมูลตารางแข่งขันไม่ถูกต้อง" });
          return;
        }

        // อนุญาตให้ส่ง [] เพื่อล้างข้อมูลทั้งหมดโดยตั้งใจ (ปุ่ม "ล้างข้อมูลทั้งหมด")
        // หมายเหตุ: การล้างนี้ล้างเฉพาะตารางแข่ง (matches) เท่านั้น ส่วน roster
        // จะถูกล้างแยกผ่าน event "update-roster" ที่หน้า Admin ส่งมาคู่กัน
        if (newMatches.length === 0) {
          const current = readData();
          const cleared = { ...current, matches: [], lastUpdated: Date.now() };
          if (saveData(cleared)) {
            io.emit("data-updated", cleared);
            console.log("[Sync] Match schedule cleared by admin");
          } else {
            socket.emit("action-error", { message: "ล้างข้อมูลไม่สำเร็จ กรุณาลองใหม่" });
          }
          return;
        }

        const invalidIndex = newMatches.findIndex((m) => !isValidMatch(m));
        if (invalidIndex !== -1) {
          socket.emit("action-error", {
            message: `พบข้อมูลแมตช์ไม่ถูกต้องที่ตำแหน่ง ${invalidIndex + 1} กรุณาตรวจสอบข้อมูลนำเข้า`
          });
          return;
        }

        const existing = readData();
        const { merged, preserved, added } = mergeMatches(existing.matches, newMatches);
        const newData = { ...existing, matches: merged, lastUpdated: Date.now() };

        if (saveData(newData)) {
          io.emit("data-updated", newData);
          console.log(`[Sync] Schedule regenerated: ${merged.length} matches (${preserved} preserved with existing results, ${added} new)`);
        } else {
          socket.emit("action-error", { message: "บันทึกตารางแข่งขันไม่สำเร็จ กรุณาลองใหม่" });
        }
      } catch (err) {
        console.error("[Socket] import-excel error:", err);
        socket.emit("action-error", { message: "เกิดข้อผิดพลาดขณะสร้างตารางแข่งขัน" });
      }
    });

    // รับสถานะห้องทำงานของ Admin ทั้งหมด (ทีม/นักกีฬาที่นำเข้า, ลำดับรุ่น,
    // โหมด/ค่าสนามที่กำหนดเอง) แล้วบันทึกลง data.json ให้เป็น single source
    // of truth — refresh หน้าเว็บ หรือเปิดจากเครื่อง Admin เครื่องอื่น จะเห็น
    // ข้อมูลชุดเดียวกันเสมอ
    socket.on("update-roster", (roster) => {
      try {
        if (!isValidRoster(roster)) {
          socket.emit("action-error", { message: "ข้อมูลรายชื่อนักกีฬาไม่ถูกต้อง" });
          return;
        }

        const data = readData();
        data.roster = roster;
        data.lastUpdated = Date.now();

        if (saveData(data)) {
          io.emit("roster-updated", roster); // กระจายให้ทุกหน้า Admin ที่เปิดอยู่
        } else {
          socket.emit("action-error", { message: "บันทึกรายชื่อนักกีฬาไม่สำเร็จ กรุณาลองใหม่" });
        }
      } catch (err) {
        console.error("[Socket] update-roster error:", err);
        socket.emit("action-error", { message: "เกิดข้อผิดพลาดขณะบันทึกรายชื่อนักกีฬา" });
      }
    });

    // แก้ชื่อนักกีฬาคนเดียว แต่ให้มีผลกับ "ทุกที่" ที่ทีมนี้ปรากฏอยู่ในคราวเดียว:
    // ทุกแมตช์ของทีมนี้ (university+category+group) และ roster entry ต้นทาง
    // (เดิมหน้า Matches ใช้วิธี re-emit ตารางแข่งทั้งชุดผ่าน "import-excel" ซึ่ง
    // ทำงานได้แต่ไม่อัปเดต roster ทำให้ถ้า Admin สร้างตารางใหม่ทับ ชื่อที่แก้ไว้จะหาย)
    socket.on("update-player-name", (payload) => {
      try {
        if (!isPlainObject(payload)) {
          socket.emit("action-error", { message: "ข้อมูลไม่ถูกต้อง (update-player-name)" });
          return;
        }
        const { university, category, group, playerId, newName } = payload;
        if (
          typeof university !== "string" ||
          typeof category !== "string" ||
          typeof group !== "string" ||
          typeof playerId !== "string" ||
          typeof newName !== "string"
        ) {
          socket.emit("action-error", { message: "ข้อมูลไม่ถูกต้อง (update-player-name)" });
          return;
        }
        const trimmed = newName.trim();
        if (!trimmed) {
          socket.emit("action-error", { message: "ชื่อนักกีฬาต้องไม่ว่างเปล่า" });
          return;
        }

        const data = readData();
        let touched = false;

        data.matches.forEach((m) => {
          if (m.category !== category || m.group !== group) return;
          ["teamA", "teamB"].forEach((key) => {
            const team = m[key];
            if (team && team.university === university) {
              team.players.forEach((p) => {
                if (p.id === playerId) { p.name = trimmed; touched = true; }
              });
            }
          });
        });

        data.roster.entries.forEach((e) => {
          if (e.university === university && e.category === category && e.group === group) {
            e.players.forEach((p) => {
              if (p.id === playerId) { p.name = trimmed; touched = true; }
            });
          }
        });

        if (!touched) {
          socket.emit("action-error", { message: "ไม่พบนักกีฬาที่ต้องการแก้ไขชื่อ" });
          return;
        }

        data.lastUpdated = Date.now();
        if (saveData(data)) {
          io.emit("data-updated", data);
          io.emit("roster-updated", data.roster);
        } else {
          socket.emit("action-error", { message: "บันทึกชื่อนักกีฬาไม่สำเร็จ กรุณาลองใหม่" });
        }
      } catch (err) {
        console.error("[Socket] update-player-name error:", err);
        socket.emit("action-error", { message: "เกิดข้อผิดพลาดขณะแก้ไขชื่อนักกีฬา" });
      }
    });

    // แก้สนามของ "ทั้งรุ่น/สาย" พร้อมกันในคราวเดียว — เพราะทุกแมตช์ในรุ่น/สาย
    // เดียวกันควรลงสนามเดียวกันเสมอ (ตามที่หน้า Admin กำหนดไว้ตอนสร้างตาราง)
    // แก้ทีละแมตช์จากหน้า Matches แบบเดิมทำให้แมตช์อื่นในกลุ่มเดียวกันสนามไม่ตรงกัน
    socket.on("update-group-court", (payload) => {
      try {
        if (!isPlainObject(payload)) {
          socket.emit("action-error", { message: "ข้อมูลไม่ถูกต้อง (update-group-court)" });
          return;
        }
        const { category, group, court } = payload;
        if (
          typeof category !== "string" ||
          typeof group !== "string" ||
          (typeof court !== "string" && typeof court !== "number")
        ) {
          socket.emit("action-error", { message: "ข้อมูลไม่ถูกต้อง (update-group-court)" });
          return;
        }
        const courtStr = String(court).trim();
        if (!courtStr) {
          socket.emit("action-error", { message: "กรุณาระบุหมายเลขสนาม" });
          return;
        }

        const data = readData();
        let touched = false;
        data.matches.forEach((m) => {
          if (m.category === category && m.group === group) {
            m.court = courtStr;
            touched = true;
          }
        });

        if (!touched) {
          socket.emit("action-error", { message: "ไม่พบคู่แข่งขันในรุ่น/สายนี้" });
          return;
        }

        data.lastUpdated = Date.now();
        if (saveData(data)) {
          io.emit("data-updated", data);
        } else {
          socket.emit("action-error", { message: "บันทึกสนามไม่สำเร็จ กรุณาลองใหม่" });
        }
      } catch (err) {
        console.error("[Socket] update-group-court error:", err);
        socket.emit("action-error", { message: "เกิดข้อผิดพลาดขณะบันทึกสนาม" });
      }
    });

    socket.on("get-match-details", (matchId) => {
      try {
        if (typeof matchId !== "string") return;
        const data = readData();
        const match = data.matches.find((m) => m.id === matchId);
        if (match) socket.emit("match-data", match);
      } catch (err) {
        console.error("[Socket] get-match-details error:", err);
      }
    });

    socket.on("disconnect", () => console.log(`[Socket] Disconnected: ${socket.id}`));

    socket.on("error", (err) => {
      console.error(`[Socket] Socket-level error (${socket.id}):`, err);
    });
  });

  io.on("connect_error", (err) => {
    console.error("[Socket.IO] connect_error:", err);
  });

  httpServer.listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Server ready on http://${hostname}:${port}`);
  });

  httpServer.on("error", (err) => {
    console.error("[HTTP] Server error:", err);
  });
}).catch((err) => {
  console.error("[Next] Failed to prepare app:", err);
  process.exit(1);
});

// กันเซิร์ฟเวอร์ล้มทั้งตัวจาก error ที่หลุดรอดออกมา — log ไว้แล้วอยู่รอดต่อ
process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled rejection:", reason);
});