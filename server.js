import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = process.env.INF_STAIRS_RANKINGS_FILE || path.join(__dirname, "data", "rankings.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

async function ensureDataFile() {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  if (!existsSync(DATA_FILE)) {
    await writeFile(DATA_FILE, "[]\n", "utf8");
  }
}

async function readRankings() {
  try {
    await ensureDataFile();
    const raw = await readFile(DATA_FILE, "utf8");
    const rankings = JSON.parse(raw);
    return Array.isArray(rankings) ? rankings : [];
  } catch (error) {
    console.error("Failed to read rankings:", error.message);
    return [];
  }
}

async function writeRankings(rankings) {
  await ensureDataFile();
  await writeFile(DATA_FILE, `${JSON.stringify(rankings, null, 2)}\n`, "utf8");
}

function sanitizeNickname(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 16);
}

function normalizeScore(payload) {
  const nickname = sanitizeNickname(payload.nickname);
  const score = Number(payload.score);
  const elapsedMs = Number(payload.elapsedMs);

  if (nickname.length < 1) {
    return { error: "닉네임을 입력해 주세요." };
  }

  if (!Number.isInteger(score) || score < 0 || score > 99999) {
    return { error: "점수 형식이 올바르지 않습니다." };
  }

  return {
    entry: {
      id: crypto.randomUUID(),
      nickname,
      score,
      elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.min(20000, Math.round(elapsedMs))) : 20000,
      createdAt: new Date().toISOString()
    }
  };
}

function sortRankings(rankings) {
  return rankings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) {
      throw new Error("payload-too-large");
    }
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(value));
}

async function handleApi(req, res, pathname) {
  if (pathname !== "/api/rankings") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.method === "GET") {
    const rankings = sortRankings(await readRankings()).slice(0, 50);
    sendJson(res, 200, { rankings });
    return;
  }

  if (req.method === "POST") {
    try {
      const payload = await readJsonBody(req);
      const result = normalizeScore(payload);

      if (result.error) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      const rankings = sortRankings([...(await readRankings()), result.entry]).slice(0, 100);
      await writeRankings(rankings);
      sendJson(res, 201, { entry: result.entry, rankings: rankings.slice(0, 50) });
    } catch {
      sendJson(res, 400, { error: "요청을 처리할 수 없습니다." });
    }
    return;
  }

  res.writeHead(405, { Allow: "GET, POST" });
  res.end();
}

async function serveStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const target = path.normalize(path.join(PUBLIC_DIR, cleanPath));

  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(target)] || "application/octet-stream"
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url.pathname);
    return;
  }

  await serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Inf Stairs running at http://localhost:${PORT}`);
});
