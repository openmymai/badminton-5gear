const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const dev = process.env.NODE_ENV !== "production";
const port = 3000;
const hostname = "0.0.0.0"; // เพื่อให้มือถือเข้าผ่าน IP ได้

const app = next({ dev });
const handle = app.getRequestHandler();

const DATA_FILE = path.join(__dirname, "data.json");

const readData = () => {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initialData = { matches: [], lastUpdated: Date.now() };
      fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const content = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(content || '{"matches": []}');
  } catch (err) {
    console.error("Error reading data file:", err);
    return { matches: [] };
  }
};

const saveData = (data) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving data file:", err);
  }
};

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ส่งข้อมูลตั้งต้น
    socket.emit("data-updated", readData());

    // รับการอัปเดตเฉพาะแมตช์ (คะแนน, สนาม, สถานะ)
    socket.on("update-score", (payload) => {
      const { matchId, score, isFinished, court, teamA, teamB } = payload;
      const data = readData();
      const index = data.matches.findIndex(m => m.id === matchId);

      if (index !== -1) {
        if (score) data.matches[index].score = score;
        if (isFinished !== undefined) data.matches[index].isFinished = isFinished;
        if (court !== undefined) data.matches[index].court = court;
        if (teamA !== undefined) data.matches[index].teamA = teamA;
        if (teamB !== undefined) data.matches[index].teamB = teamB;

        data.lastUpdated = Date.now();
        saveData(data);
        io.emit("data-updated", data); // กระจายให้ทุกเครื่อง
      }
    });

    // รับการอัปเดตข้อมูลทั้งหมด (ใช้สำหรับ Sync ชื่อนักกีฬาทุกแมตช์)
    socket.on("import-excel", (newMatches) => {
      if (!newMatches || !Array.isArray(newMatches)) return;
      const newData = { matches: newMatches, lastUpdated: Date.now() };
      saveData(newData);
      io.emit("data-updated", newData);
      console.log(`[Sync] Global data updated`);
    });

    socket.on("get-match-details", (matchId) => {
      const data = readData();
      const match = data.matches.find(m => m.id === matchId);
      if (match) socket.emit("match-data", match);
    });

    socket.on("disconnect", () => console.log(`[Socket] Disconnected`));
  });

  httpServer.listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Server ready on http://${hostname}:${port}`);
  });
});