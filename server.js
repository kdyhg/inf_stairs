import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "1GbYD5LIF3I514aPHo4V6dGbxQafWJMONwxI_osXFtaY";
const GOOGLE_SHEET_GID = process.env.GOOGLE_SHEET_GID || "0";
const GOOGLE_SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || "";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
let cachedRankings = [];
let cachedAccessToken = null;
let cachedSheetRange = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function getGoogleCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      return {
        clientEmail: credentials.client_email,
        privateKey: credentials.private_key
      };
    } catch {
      throw new ApiError("GOOGLE_SERVICE_ACCOUNT_JSON 형식이 올바르지 않습니다.", 503);
    }
  }

  return {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY
  };
}

function assertGoogleConfig() {
  const credentials = getGoogleCredentials();

  if (!credentials.clientEmail || !credentials.privateKey) {
    throw new ApiError("Google Sheets 서비스 계정 환경변수가 설정되지 않았습니다.", 503);
  }

  return {
    clientEmail: credentials.clientEmail,
    privateKey: credentials.privateKey.replace(/\\n/g, "\n")
  };
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: credentials.clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  }));
  const input = `${header}.${payload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(input)
    .sign(credentials.privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${input}.${signature}`;
}

async function getAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const assertion = signJwt(assertGoogleConfig());
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(data.error_description || data.error || "Google 인증에 실패했습니다.", 502);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  };

  return cachedAccessToken.token;
}

async function googleRequest(pathname, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}${pathname}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || "Google Sheets API 요청에 실패했습니다.";
    throw new ApiError(message, response.status >= 500 ? 502 : response.status);
  }

  return data;
}

function quoteSheetName(title) {
  return `'${title.replace(/'/g, "''")}'`;
}

async function getSheetRange() {
  if (GOOGLE_SHEET_RANGE) return GOOGLE_SHEET_RANGE;
  if (cachedSheetRange) return cachedSheetRange;

  const metadata = await googleRequest("?fields=sheets(properties(sheetId,title))");
  const sheet = metadata.sheets?.find((item) => String(item.properties?.sheetId) === String(GOOGLE_SHEET_GID))
    || metadata.sheets?.[0];

  if (!sheet?.properties?.title) {
    throw new ApiError("Google Sheet 탭을 찾을 수 없습니다.", 502);
  }

  cachedSheetRange = `${quoteSheetName(sheet.properties.title)}!A:E`;
  return cachedSheetRange;
}

function getHeaderRange(sheetRange) {
  const sheetPrefix = sheetRange.includes("!") ? `${sheetRange.split("!")[0]}!` : "";
  return `${sheetPrefix}A1:E1`;
}

function isHeaderRow(row) {
  const first = String(row[0] || "").toLowerCase();
  const second = String(row[1] || "").toLowerCase();
  return first === "id" || second === "nickname" || second === "닉네임";
}

function rowToRanking(row) {
  const score = Number(row[2]);
  const elapsedMs = Number(row[3]);

  if (!row[1] || !Number.isInteger(score)) return null;

  return {
    id: row[0] || crypto.randomUUID(),
    nickname: String(row[1]),
    score,
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 20000,
    createdAt: row[4] || new Date().toISOString()
  };
}

async function ensureSheetHeader(sheetRange) {
  const headerRange = getHeaderRange(sheetRange);
  const current = await googleRequest(`/values/${encodeURIComponent(headerRange)}?majorDimension=ROWS`);

  if (!current.values?.length) {
    await googleRequest(`/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({
        values: [["id", "nickname", "score", "elapsedMs", "createdAt"]]
      })
    });
  }
}

async function readRankings() {
  try {
    const sheetRange = await getSheetRange();
    const data = await googleRequest(`/values/${encodeURIComponent(sheetRange)}?majorDimension=ROWS`);
    const rows = data.values || [];
    cachedRankings = rows
      .filter((row) => !isHeaderRow(row))
      .map(rowToRanking)
      .filter(Boolean);
    return cachedRankings;
  } catch (error) {
    if (cachedRankings.length) return cachedRankings;
    throw error;
  }
}

async function appendRanking(entry) {
  const sheetRange = await getSheetRange();
  await ensureSheetHeader(sheetRange);
  await googleRequest(`/values/${encodeURIComponent(sheetRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({
      values: [[entry.id, entry.nickname, entry.score, entry.elapsedMs, entry.createdAt]]
    })
  });
  cachedRankings = [...cachedRankings, entry];
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
    try {
      const rankings = sortRankings(await readRankings()).slice(0, 50);
      sendJson(res, 200, { rankings });
    } catch (error) {
      console.error("Failed to load rankings:", error.message);
      sendJson(res, error.status || 500, { error: error.message || "랭킹을 불러올 수 없습니다." });
    }
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

      await appendRanking(result.entry);
      const rankings = sortRankings(await readRankings()).slice(0, 50);
      sendJson(res, 201, { entry: result.entry, rankings, persisted: true });
    } catch (error) {
      console.error("Failed to save ranking:", error.message);
      sendJson(res, error.status || 400, { error: error.message || "요청을 처리할 수 없습니다." });
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
