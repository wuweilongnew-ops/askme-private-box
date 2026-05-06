const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");

async function startTestServer(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "askme-test-"));
  const dataFile = path.join(tempDir, "questions.json");
  const app = createApp({
    dataFile,
    ...(options.retentionDays ? { retentionDays: options.retentionDays } : {}),
    ...(options.useDefaultPassword ? {} : { ownerPassword: "owner-pass" })
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    dataFile,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function requestText(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const text = await response.text();
  return { response, text };
}

async function request(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  return { response, data };
}

function validQuestion(overrides = {}) {
  return {
    preAnswers: {
      impression: "真诚又敏感的人",
      strength: "很会共情",
      weakness: "容易想太多"
    },
    question: "你最近最开心的小事是什么？",
    identityMode: "known",
    askerName: "老同学",
    askerQuestionVisibility: "public",
    mood: "好奇一下",
    ...overrides
  };
}

test("public wall hides a question until both sides consent", async () => {
  const server = await startTestServer();
  try {
    const created = await request(server.baseUrl, "/api/questions", {
      method: "POST",
      body: JSON.stringify(validQuestion())
    });
    assert.equal(created.response.status, 201);

    const beforeOwnerConsent = await request(server.baseUrl, "/api/public");
    assert.equal(beforeOwnerConsent.data.questions.length, 0);

    const login = await request(server.baseUrl, "/api/owner/login", {
      method: "POST",
      body: JSON.stringify({ password: "owner-pass" })
    });
    const token = login.data.token;

    const updated = await request(
      server.baseUrl,
      `/api/owner/questions/${created.data.id}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ownerQuestionVisibility: "public",
          answer: "是一杯刚好温度合适的咖啡。",
          answerVisibility: "private"
        })
      }
    );
    assert.equal(updated.response.status, 200);

    const publicWall = await request(server.baseUrl, "/api/public");
    assert.equal(publicWall.data.questions.length, 1);
    assert.equal(publicWall.data.questions[0].question, "你最近最开心的小事是什么？");
    assert.equal(publicWall.data.questions[0].answer, null);
    assert.equal(publicWall.data.questions[0].identityLabel, "双方知道的人");
  } finally {
    await server.close();
  }
});

test("owner cannot publish an answer when asker kept the question private", async () => {
  const server = await startTestServer();
  try {
    const created = await request(server.baseUrl, "/api/questions", {
      method: "POST",
      body: JSON.stringify(
        validQuestion({ askerQuestionVisibility: "private", identityMode: "anonymous" })
      )
    });
    const login = await request(server.baseUrl, "/api/owner/login", {
      method: "POST",
      body: JSON.stringify({ password: "owner-pass" })
    });

    const updated = await request(
      server.baseUrl,
      `/api/owner/questions/${created.data.id}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${login.data.token}` },
        body: JSON.stringify({
          ownerQuestionVisibility: "public",
          answer: "这个回答不能公开。",
          answerVisibility: "public"
        })
      }
    );

    assert.equal(updated.response.status, 400);
    assert.match(updated.data.error, /都同意公开/);

    const publicWall = await request(server.baseUrl, "/api/public");
    assert.equal(publicWall.data.questions.length, 0);
  } finally {
    await server.close();
  }
});

test("asker can read a private answer only with the generated code", async () => {
  const server = await startTestServer();
  try {
    const created = await request(server.baseUrl, "/api/questions", {
      method: "POST",
      body: JSON.stringify(validQuestion({ askerQuestionVisibility: "private" }))
    });
    const login = await request(server.baseUrl, "/api/owner/login", {
      method: "POST",
      body: JSON.stringify({ password: "owner-pass" })
    });
    await request(server.baseUrl, `/api/owner/questions/${created.data.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${login.data.token}` },
      body: JSON.stringify({
        ownerQuestionVisibility: "private",
        answer: "这是只给你看的回答。",
        answerVisibility: "private"
      })
    });

    const wrongSecret = await request(
      server.baseUrl,
      `/api/questions/${created.data.id}?secret=wrong`
    );
    assert.equal(wrongSecret.response.status, 404);

    const mine = await request(
      server.baseUrl,
      `/api/questions/${created.data.id}?secret=${created.data.askerSecret}`
    );
    assert.equal(mine.response.status, 200);
    assert.equal(mine.data.question.answer, "这是只给你看的回答。");
    assert.equal(mine.data.question.answerVisibility, "private");
  } finally {
    await server.close();
  }
});

test("owner route serves the private owner entry page", async () => {
  const server = await startTestServer();
  try {
    const page = await requestText(server.baseUrl, "/owner");
    assert.equal(page.response.status, 200);
    assert.match(page.text, /私人主人入口/);
    assert.match(page.text, /我的自由提问箱/);
  } finally {
    await server.close();
  }
});

test("owner password can be provided by configuration", async () => {
  const server = await startTestServer();
  try {
    const login = await request(server.baseUrl, "/api/owner/login", {
      method: "POST",
      body: JSON.stringify({ password: "owner-pass" })
    });

    assert.equal(login.response.status, 200);
    assert.ok(login.data.token);
  } finally {
    await server.close();
  }
});

test("quiz answer uses thick-crust pizza preference", async () => {
  const source = await fs.readFile(path.join(__dirname, "../public/app.js"), "utf8");
  assert.match(
    source,
    /question: "薄底披萨 or 厚底披萨",\s+answer: "厚"/
  );
});

test("questions older than retention window are pruned", async () => {
  const server = await startTestServer({ retentionDays: 3 });
  try {
    const oldQuestion = {
      id: "q_old",
      askerSecret: "secret_old",
      createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      preAnswers: {
        impression: "旧问题",
        strength: "旧优点",
        weakness: "旧缺点"
      },
      question: "这个问题应该过期",
      identityMode: "anonymous",
      askerName: "",
      askerQuestionPublic: true,
      ownerQuestionPublic: true,
      answer: "旧回答",
      answerPublic: true,
      answeredAt: null
    };
    await fs.writeFile(server.dataFile, `${JSON.stringify([oldQuestion], null, 2)}\n`, "utf8");

    const publicWall = await request(server.baseUrl, "/api/public");
    assert.equal(publicWall.response.status, 200);
    assert.equal(publicWall.data.questions.length, 0);

    const stored = JSON.parse(await fs.readFile(server.dataFile, "utf8"));
    assert.equal(stored.length, 0);
  } finally {
    await server.close();
  }
});
