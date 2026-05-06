const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DEFAULT_DATA_FILE = path.join(DATA_DIR, "questions.json");
const DEFAULT_OWNER_PASSWORD = "change-me-owner";
const DEFAULT_RETENTION_DAYS = 3;
const MAX_BODY_BYTES = 128 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function createApp(options = {}) {
  const dataFile = options.dataFile || process.env.DATA_FILE || DEFAULT_DATA_FILE;
  const ownerPassword =
    options.ownerPassword || process.env.OWNER_PASSWORD || DEFAULT_OWNER_PASSWORD;
  const retentionDays = Number(
    options.retentionDays || process.env.RETENTION_DAYS || DEFAULT_RETENTION_DAYS
  );
  const usesDefaultPassword =
    !options.ownerPassword && !process.env.OWNER_PASSWORD;
  const ownerTokens = new Set();
  let writeQueue = Promise.resolve();

  async function ensureStore() {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    try {
      await fs.access(dataFile);
    } catch {
      await fs.writeFile(dataFile, "[]\n", "utf8");
    }
  }

  async function loadQuestions() {
    await ensureStore();
    const raw = await fs.readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw || "[]");
    const items = Array.isArray(parsed) ? parsed : [];
    const pruned = pruneExpiredQuestions(items);
    if (pruned.length !== items.length) {
      await saveQuestions(pruned);
    }
    return pruned;
  }

  async function saveQuestions(items) {
    await fs.writeFile(dataFile, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  }

  function withQuestions(mutator) {
    writeQueue = writeQueue.then(async () => {
      const items = pruneExpiredQuestions(await loadQuestions());
      const result = await mutator(items);
      await saveQuestions(pruneExpiredQuestions(items));
      return result;
    });
    return writeQueue;
  }

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    res.end(body);
  }

  function sendError(res, status, message) {
    sendJson(res, status, { error: message });
  }

  function sanitizeText(value, maxLength) {
    return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, maxLength);
  }

  function publicFlag(value) {
    return value === true || value === "public";
  }

  function timingSafeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  }

  function createId(prefix) {
    return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
  }

  function isOwnerRequest(req) {
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    return token && ownerTokens.has(token);
  }

  function pruneExpiredQuestions(items) {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      return [];
    }
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    return items.filter((item) => {
      const createdAt = Date.parse(item.createdAt || "");
      return Number.isFinite(createdAt) && createdAt >= cutoff;
    });
  }

  function isQuestionPublic(item) {
    return item.askerQuestionPublic === true && item.ownerQuestionPublic === true;
  }

  function toPublicQuestion(item) {
    const canShowAnswer = isQuestionPublic(item) && item.answer && item.answerPublic;
    return {
      id: item.id,
      createdAt: item.createdAt,
      answeredAt: item.answeredAt || null,
      identityLabel:
        item.identityMode === "known" ? "双方知道的人" : "匿名提问",
      mood: item.mood || "认真提问",
      question: item.question,
      answer: canShowAnswer ? item.answer : null,
      answerVisibility: canShowAnswer ? "public" : "private",
      quizScore: item.quiz && Number.isFinite(item.quiz.score) ? item.quiz.score : null,
      quizTotal: item.quiz && Number.isFinite(item.quiz.total) ? item.quiz.total : null
    };
  }

  function toPrivateQuestion(item, viewer) {
    return {
      ...toPublicQuestion(item),
      viewer,
      identityMode: item.identityMode,
      askerName: item.identityMode === "known" ? item.askerName : "",
      preAnswers: item.preAnswers,
      askerQuestionPublic: item.askerQuestionPublic,
      ownerQuestionPublic: item.ownerQuestionPublic,
      questionIsPublic: isQuestionPublic(item),
      answer: item.answer || "",
      answerPublic: Boolean(item.answerPublic && isQuestionPublic(item)),
      answerVisibility:
        item.answerPublic && isQuestionPublic(item) ? "public" : "private",
      promptTag: item.promptTag || "",
      updatedAt: item.updatedAt
    };
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        throw new Error("请求内容太长了，请缩短后再发送。");
      }
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    const raw = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(raw);
  }

  function validateNewQuestion(body) {
    const preAnswers = body.preAnswers || {};
    const impression = sanitizeText(preAnswers.impression, 280);
    const strength = sanitizeText(preAnswers.strength, 280);
    const weakness = sanitizeText(preAnswers.weakness, 280);
    const question = sanitizeText(body.question, 500);
    const identityMode =
      body.identityMode === "known" ? "known" : "anonymous";
    const askerName = sanitizeText(body.askerName, 32);
    const mood = sanitizeText(body.mood, 24) || "认真提问";
    const promptTag = sanitizeText(body.promptTag, 60);

    if (impression.length < 2 || strength.length < 2 || weakness.length < 2) {
      return { error: "提问前的三个问题都需要认真回答，至少写 2 个字。" };
    }
    if (question.length < 3) {
      return { error: "提问内容至少需要 3 个字。" };
    }
    if (identityMode === "known" && askerName.length < 1) {
      return { error: "选择“仅双方知道”时，请留下只有你们能看懂的称呼。" };
    }

    const quiz = body.quiz && typeof body.quiz === "object"
      ? {
          score: Number(body.quiz.score) || 0,
          total: Number(body.quiz.total) || 0,
          label: sanitizeText(body.quiz.label, 80)
        }
      : null;

    return {
      value: {
        preAnswers: { impression, strength, weakness },
        question,
        identityMode,
        askerName: identityMode === "known" ? askerName : "",
        askerQuestionPublic: publicFlag(body.askerQuestionVisibility),
        mood,
        promptTag,
        quiz
      }
    };
  }

  async function handleApi(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, usesDefaultPassword });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/public") {
      const items = await loadQuestions();
      sendJson(res, 200, {
        questions: items
          .filter(isQuestionPublic)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .map(toPublicQuestion)
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/questions") {
      const body = await readBody(req);
      const validation = validateNewQuestion(body);
      if (validation.error) {
        sendError(res, 400, validation.error);
        return;
      }

      const now = new Date().toISOString();
      const question = {
        id: createId("q"),
        askerSecret: createId("secret"),
        createdAt: now,
        updatedAt: now,
        ownerQuestionPublic: null,
        answer: "",
        answerPublic: false,
        answeredAt: null,
        ...validation.value
      };

      await withQuestions((items) => {
        items.push(question);
        return question;
      });

      sendJson(res, 201, {
        id: question.id,
        askerSecret: question.askerSecret,
        question: toPrivateQuestion(question, "asker")
      });
      return;
    }

    const questionMatch = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
    if (req.method === "GET" && questionMatch) {
      const secret = url.searchParams.get("secret") || "";
      const items = await loadQuestions();
      const item = items.find((entry) => entry.id === questionMatch[1]);
      if (!item || !timingSafeEqual(item.askerSecret, secret)) {
        sendError(res, 404, "没有找到这个提问，或提问码不正确。");
        return;
      }
      sendJson(res, 200, { question: toPrivateQuestion(item, "asker") });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/owner/login") {
      const body = await readBody(req);
      if (!timingSafeEqual(body.password || "", ownerPassword)) {
        sendError(res, 401, "主人口令不正确。");
        return;
      }
      const token = createId("owner");
      ownerTokens.add(token);
      sendJson(res, 200, { token, usesDefaultPassword });
      return;
    }

    if (url.pathname === "/api/owner/questions") {
      if (!isOwnerRequest(req)) {
        sendError(res, 401, "需要主人登录。");
        return;
      }
      if (req.method === "GET") {
        const items = await loadQuestions();
        sendJson(res, 200, {
          questions: items
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .map((item) => toPrivateQuestion(item, "owner"))
        });
        return;
      }
    }

    const ownerQuestionMatch = url.pathname.match(/^\/api\/owner\/questions\/([^/]+)$/);
    if (req.method === "PATCH" && ownerQuestionMatch) {
      if (!isOwnerRequest(req)) {
        sendError(res, 401, "需要主人登录。");
        return;
      }
      const body = await readBody(req);
      const result = await withQuestions((items) => {
        const item = items.find((entry) => entry.id === ownerQuestionMatch[1]);
        if (!item) return null;

        if (body.ownerQuestionVisibility === "public") {
          item.ownerQuestionPublic = true;
        }
        if (body.ownerQuestionVisibility === "private") {
          item.ownerQuestionPublic = false;
        }

        const answer = sanitizeText(body.answer, 1200);
        item.answer = answer;
        item.answeredAt = answer ? new Date().toISOString() : null;

        const wantsPublicAnswer = body.answerVisibility === "public";
        if (wantsPublicAnswer && (!answer || !isQuestionPublic(item))) {
          return {
            error:
              "只有提问者和主人都同意公开，并且已经写好回答时，回答才可以公开。"
          };
        }
        item.answerPublic = wantsPublicAnswer && isQuestionPublic(item);
        item.updatedAt = new Date().toISOString();
        return { question: toPrivateQuestion(item, "owner") };
      });

      if (!result) {
        sendError(res, 404, "没有找到这个提问。");
        return;
      }
      if (result.error) {
        sendError(res, 400, result.error);
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    sendError(res, 404, "接口不存在。");
  }

  async function serveStatic(req, res, url) {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "/owner" || pathname === "/owner/") {
      pathname = "/index.html";
    }
    const filePath = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));
    const relative = path.relative(PUBLIC_DIR, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const content = await fs.readFile(filePath);
      const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer"
      });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  }

  return async function app(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      await serveStatic(req, res, url);
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendError(res, 400, "请求格式不是有效 JSON。");
        return;
      }
      sendError(res, 500, error.message || "服务暂时出了点问题。");
    }
  };
}

function startServer(options = {}) {
  const app = createApp(options);
  const port = Number(options.port || process.env.PORT || 3000);
  const host = options.host || process.env.HOST || "0.0.0.0";
  const server = http.createServer(app);
  server.listen(port, host, () => {
    const passwordHint = process.env.OWNER_PASSWORD
      ? "已使用环境变量 OWNER_PASSWORD"
      : `本地默认主人口令为 ${DEFAULT_OWNER_PASSWORD}`;
    console.log(`ASKme is running at http://${host}:${port}`);
    console.log(`Local URL: http://localhost:${port}`);
    console.log(passwordHint);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer,
  DEFAULT_OWNER_PASSWORD
};
