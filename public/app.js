const state = {
  ownerToken: sessionStorage.getItem("askme.ownerToken") || "",
  latestQuiz: readJson(localStorage.getItem("askme.latestQuiz")),
  lastQuestionCode: localStorage.getItem("askme.lastQuestionCode") || "",
  isOwnerMode: isOwnerPath()
};

const SHARE_TITLE = "我的自由提问箱";
const SHARE_TEXT = "有空的话，来问我一个问题吧。";

const quizQuestions = [
  {
    question: "我最喜欢的颜色是",
    answer: "绿色",
    options: ["绿色", "蓝色", "黄色", "紫色"]
  },
  {
    question: "我最喜欢的歌手是",
    answer: "徐佳莹",
    options: ["徐佳莹", "孙燕姿", "陈绮贞", "张悬"]
  },
  {
    question: "我最喜欢的放松方式是",
    answer: "散步",
    options: ["散步", "看电影", "睡觉", "做饭"]
  },
  {
    question: "喜欢猫还是狗",
    answer: "狗",
    options: ["猫", "狗", "都喜欢", "都怕"]
  },
  {
    question: "喜欢牛奶还是酸奶",
    answer: "酸奶",
    options: ["牛奶", "酸奶", "豆浆", "奶茶"]
  },
  {
    question: "悲观主义 or 乐观主义",
    answer: "悲观",
    options: ["悲观", "乐观", "看情况", "都不是"]
  },
  {
    question: "森林 or 海洋",
    answer: "森林",
    options: ["森林", "海洋", "雪山", "城市"]
  },
  {
    question: "薄底披萨 or 厚底披萨",
    answer: "厚",
    options: ["薄", "厚", "都行", "不吃披萨"]
  },
  {
    question: "主动 or 被动",
    answer: "被动",
    options: ["主动", "被动", "轮流", "看对象"]
  }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  configurePageMode();
  bindShare();

  if (state.isOwnerMode) {
    bindOwner();
    return;
  }

  renderQuiz();
  bindAskForm();
  bindLookupForm();
  loadPublicWall();

  if (state.lastQuestionCode) {
    const codeInput = $("#lookupForm input[name='code']");
    codeInput.value = state.lastQuestionCode;
  }
});

function isOwnerPath() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(window.location.search);
  return pathname === "/owner" || params.get("owner") === "1";
}

function configurePageMode() {
  const ownerSection = $("#owner");
  if (state.isOwnerMode) {
    document.body.classList.add("owner-mode");
    ownerSection.classList.remove("is-hidden");
    document.title = "主人管理入口 - 我的自由提问箱";
    return;
  }

  document.body.classList.remove("owner-mode");
  ownerSection.classList.add("is-hidden");
  sessionStorage.removeItem("askme.ownerToken");
  localStorage.removeItem("askme.ownerToken");
  state.ownerToken = "";
}

function readJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (state.ownerToken) {
    headers.Authorization = `Bearer ${state.ownerToken}`;
  }
  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败，请稍后再试。");
  }
  return data;
}

function getShareUrl() {
  const url = new URL(window.location.href);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isWeChatBrowser() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function bindShare() {
  const buttons = [$("#shareSite"), $("#shareSiteInline")].filter(Boolean);
  const sheet = $("#shareSheet");
  const closeButton = $("#closeShareSheet");
  const copyButton = $("#copyShareLink");

  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const url = getShareUrl();
      if (!isWeChatBrowser() && navigator.share) {
        try {
          await navigator.share({
            title: SHARE_TITLE,
            text: SHARE_TEXT,
            url
          });
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }
      openShareSheet();
    });
  });

  closeButton.addEventListener("click", () => sheet.classList.add("is-hidden"));
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.classList.add("is-hidden");
  });
  copyButton.addEventListener("click", async () => {
    await copyText(getShareUrl());
    copyButton.textContent = "已复制分享链接";
  });
}

function openShareSheet() {
  const sheet = $("#shareSheet");
  const hint = $("#shareHint");
  const linkText = $("#shareLinkText");
  const copyButton = $("#copyShareLink");
  const url = getShareUrl();

  hint.textContent = isWeChatBrowser()
    ? "如果你在微信里打开，请点右上角“...”菜单，选择“分享到朋友圈”或“发送给朋友”。朋友圈会尽量使用本站配置的标题、描述和缩略图。"
    : "当前浏览器不能直接打开微信朋友圈。你可以复制链接，发到微信后再从微信右上角分享到朋友圈，卡片信息已经配置好。";
  linkText.textContent = url;
  copyButton.textContent = "复制分享链接";
  sheet.classList.remove("is-hidden");
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function escapeCode({ id, askerSecret }) {
  return `${id}::${askerSecret}`;
}

function parseCode(code) {
  const [id, askerSecret] = String(code || "").trim().split("::");
  if (!id || !askerSecret) return null;
  return { id, askerSecret };
}

function bindAskForm() {
  const form = $("#askForm");
  const knownNameField = $("#knownNameField");

  form.identityMode.forEach((radio) => {
    radio.addEventListener("change", () => {
      const isKnown = form.identityMode.value === "known";
      knownNameField.classList.toggle("is-hidden", !isKnown);
      form.askerName.required = isKnown;
    });
  });

  $$(".tiny-button").forEach((button) => {
    button.addEventListener("click", () => {
      form.question.value = button.dataset.prompt;
      form.promptTag.value = button.textContent.trim();
      form.question.focus();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      preAnswers: {
        impression: form.impression.value,
        strength: form.strength.value,
        weakness: form.weakness.value
      },
      question: form.question.value,
      identityMode: form.identityMode.value,
      askerName: form.askerName.value,
      askerQuestionVisibility: form.askerQuestionVisibility.value,
      mood: form.mood.value,
      promptTag: form.promptTag.value,
      quiz: state.latestQuiz
    };

    try {
      const result = await api("/api/questions", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const code = escapeCode(result);
      state.lastQuestionCode = code;
      localStorage.setItem("askme.lastQuestionCode", code);
      renderSubmitResult(code, result.question);
      form.reset();
      knownNameField.classList.add("is-hidden");
      form.askerName.required = false;
      await loadPublicWall();
    } catch (error) {
      showSubmitError(error.message);
    }
  });
}

function renderSubmitResult(code, question) {
  const result = $("#submitResult");
  result.classList.remove("is-hidden");
  result.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent = "问题已经送达";
  const text = document.createElement("p");
  text.textContent =
    question.askerQuestionPublic
      ? "你选择了愿意公开。只有主人也选择公开后，它才会进入公开墙。"
      : "你选择了仅双方可见，它不会进入公开墙。";
  const codeBox = document.createElement("div");
  codeBox.className = "code-box";
  codeBox.textContent = code;

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "tiny-button";
  copyButton.textContent = "复制提问码";
  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(code);
    copyButton.textContent = "已复制";
  });

  result.append(title, text, codeBox, copyButton);
  result.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showSubmitError(message) {
  const result = $("#submitResult");
  result.classList.remove("is-hidden");
  result.innerHTML = `<h2>还不能发送</h2><p>${message}</p>`;
}

function bindLookupForm() {
  const form = $("#lookupForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await lookupQuestion(form.code.value);
  });
}

async function lookupQuestion(code) {
  const parsed = parseCode(code);
  const target = $("#lookupResult");
  if (!parsed) {
    target.innerHTML = `<p class="message">提问码格式不正确。</p>`;
    return;
  }
  try {
    const data = await api(
      `/api/questions/${encodeURIComponent(parsed.id)}?secret=${encodeURIComponent(parsed.askerSecret)}`,
      { method: "GET" }
    );
    target.innerHTML = "";
    target.append(renderPrivateQuestion(data.question));
  } catch (error) {
    target.innerHTML = `<p class="message">${error.message}</p>`;
  }
}

function renderPrivateQuestion(question) {
  const wrapper = document.createElement("article");
  wrapper.className = "question-card";

  const status = question.questionIsPublic
    ? "问题已公开"
    : question.ownerQuestionPublic === false || question.askerQuestionPublic === false
      ? "问题仅双方可见"
      : "等待主人决定公开范围";

  wrapper.innerHTML = `
    <div class="card-meta">
      <span>${status}</span>
      <span>${question.answerPublic ? "回答公开" : "回答仅双方可见"}</span>
    </div>
    <h3></h3>
    <p class="answer"></p>
  `;
  $("h3", wrapper).textContent = question.question;
  $(".answer", wrapper).textContent = question.answer || "主人还没有回答，请之后再用提问码查看。";
  return wrapper;
}

async function loadPublicWall() {
  const wall = $("#publicWall");
  try {
    const data = await api("/api/public", { method: "GET" });
    wall.innerHTML = "";
    if (!data.questions.length) {
      wall.innerHTML = `<div class="empty-state">公开墙现在还是空的。只有双方都同意公开的问题才会来到这里，私密问题会安静地留在双方之间。</div>`;
      return;
    }
    const template = $("#publicQuestionTemplate");
    data.questions.forEach((question) => {
      const node = template.content.firstElementChild.cloneNode(true);
      $('[data-field="identity"]', node).textContent = `来自 · ${question.identityLabel}`;
      $('[data-field="mood"]', node).textContent = question.mood;
      $('[data-field="question"]', node).textContent = question.question;
      $('[data-field="answer"]', node).textContent =
        question.answer || "主人把回答留给了提问的人。";
      const quiz = $('[data-field="quiz"]', node);
      if (question.quizTotal) {
        quiz.textContent = `默契分 ${question.quizScore}/${question.quizTotal}`;
      } else {
        quiz.remove();
      }
      wall.append(node);
    });
  } catch (error) {
    wall.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

function renderQuiz() {
  const form = $("#quizForm");
  form.innerHTML = "";
  quizQuestions.forEach((item, index) => {
    const card = document.createElement("fieldset");
    card.className = "quiz-card";
    const legend = document.createElement("legend");
    legend.textContent = `${index + 1}. ${item.question}`;
    const options = document.createElement("div");
    options.className = "option-list";
    item.options.forEach((option) => {
      const label = document.createElement("label");
      label.className = "option-pill";
      label.innerHTML = `
        <input type="radio" name="quiz-${index}" value="${option}" required />
        <span>${option}</span>
      `;
      options.append(label);
    });
    card.append(legend, options);
    form.append(card);
  });

  const actions = document.createElement("div");
  actions.className = "quiz-actions";
  actions.innerHTML = `
    <button type="submit" class="primary-button">计算默契分</button>
    <p class="form-note">默契分可以附在你的下一条提问里，也可以只是自己偷偷看。</p>
  `;
  form.append(actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const answers = quizQuestions.map((item, index) => {
      const selected = form[`quiz-${index}`].value;
      return {
        question: item.question,
        selected,
        correct: selected === item.answer
      };
    });
    const score = answers.filter((item) => item.correct).length;
    state.latestQuiz = {
      score,
      total: quizQuestions.length,
      label: getQuizLabel(score),
      answers
    };
    localStorage.setItem("askme.latestQuiz", JSON.stringify(state.latestQuiz));
    renderQuizResult(state.latestQuiz);
  });
}

function getQuizLabel(score) {
  if (score >= 8) return "默契快满格";
  if (score >= 6) return "很懂我";
  if (score >= 3) return "有点熟，但还能继续探索";
  return "盲猜也可爱";
}

function renderQuizResult(result) {
  const target = $("#quizResult");
  target.classList.remove("is-hidden");
  const wrong = result.answers.filter((item) => !item.correct);
  target.innerHTML = `
    <h2>${result.label}</h2>
    <p>你的默契分是 ${result.score}/${result.total}。下一次提问会自动附上这个分数，主人可以看到。</p>
    <p>${wrong.length ? `还没猜中的题：${wrong.map((item) => item.question).join("、")}` : "全都猜中了。"}</p>
  `;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function bindOwner() {
  const loginForm = $("#ownerLoginForm");
  const refreshButton = $("#refreshOwner");

  if (!state.isOwnerMode || !loginForm || !refreshButton) {
    return;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/owner/login", {
        method: "POST",
        body: JSON.stringify({ password: loginForm.password.value })
      });
      state.ownerToken = data.token;
      sessionStorage.setItem("askme.ownerToken", data.token);
      localStorage.removeItem("askme.ownerToken");
      $("#ownerLogin").classList.add("is-hidden");
      $("#ownerDashboard").classList.remove("is-hidden");
      await loadOwnerQuestions();
    } catch (error) {
      $(".form-note", $("#ownerLogin")).textContent = error.message;
    }
  });

  refreshButton.addEventListener("click", loadOwnerQuestions);

  if (state.ownerToken) {
    $("#ownerLogin").classList.add("is-hidden");
    $("#ownerDashboard").classList.remove("is-hidden");
    loadOwnerQuestions();
  }
}

async function loadOwnerQuestions() {
  const list = $("#ownerQuestions");
  try {
    const data = await api("/api/owner/questions", { method: "GET" });
    list.innerHTML = "";
    if (!data.questions.length) {
      list.innerHTML = `<div class="empty-state">还没有收到问题。</div>`;
      return;
    }
    data.questions.forEach((question) => list.append(renderOwnerCard(question)));
  } catch (error) {
    if (error.message.includes("主人登录")) {
      sessionStorage.removeItem("askme.ownerToken");
      localStorage.removeItem("askme.ownerToken");
      state.ownerToken = "";
      $("#ownerLogin").classList.remove("is-hidden");
      $("#ownerDashboard").classList.add("is-hidden");
      return;
    }
    list.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

function renderOwnerCard(question) {
  const article = document.createElement("article");
  article.className = "owner-card";
  article.innerHTML = `
    <div class="owner-card-grid">
      <div>
        <div class="card-meta">
          <span>${question.identityMode === "known" ? `称呼：${question.askerName}` : "完全匿名"}</span>
          <span>${question.mood}</span>
          <span>${question.askerQuestionPublic ? "提问者愿意公开" : "提问者仅双方可见"}</span>
        </div>
        <dl>
          <dt>在对方眼里你是</dt>
          <dd data-field="impression"></dd>
          <dt>对方认为你的优点</dt>
          <dd data-field="strength"></dd>
          <dt>对方认为你的缺点</dt>
          <dd data-field="weakness"></dd>
          <dt>问题</dt>
          <dd data-field="question"></dd>
        </dl>
      </div>
      <form class="owner-form">
        <fieldset>
          <legend>你对问题的公开决定</legend>
          <div class="segmented">
            <label class="choice-card">
              <input type="radio" name="ownerQuestionVisibility" value="public" />
              <span>同意公开问题</span>
            </label>
            <label class="choice-card">
              <input type="radio" name="ownerQuestionVisibility" value="private" />
              <span>问题仅双方可见</span>
            </label>
          </div>
        </fieldset>
        <label>
          <span>你的回答</span>
          <textarea name="answer" maxlength="1200" placeholder="写给提问的人。"></textarea>
        </label>
        <fieldset>
          <legend>回答公开范围</legend>
          <div class="segmented">
            <label class="choice-card">
              <input type="radio" name="answerVisibility" value="public" />
              <span>公开回答</span>
            </label>
            <label class="choice-card">
              <input type="radio" name="answerVisibility" value="private" />
              <span>回答仅双方可见</span>
            </label>
          </div>
        </fieldset>
        <button class="primary-button" type="submit">保存回答和公开设置</button>
        <p class="message" aria-live="polite"></p>
      </form>
    </div>
  `;

  $('[data-field="impression"]', article).textContent = question.preAnswers.impression;
  $('[data-field="strength"]', article).textContent = question.preAnswers.strength;
  $('[data-field="weakness"]', article).textContent = question.preAnswers.weakness;
  $('[data-field="question"]', article).textContent = question.question;

  const form = $(".owner-form", article);
  form.ownerQuestionVisibility.value =
    question.ownerQuestionPublic === true ? "public" : "private";
  form.answer.value = question.answer || "";
  form.answerVisibility.value = question.answerPublic ? "public" : "private";
  updateAnswerPublicAvailability(form, question.askerQuestionPublic);

  form.ownerQuestionVisibility.forEach((radio) => {
    radio.addEventListener("change", () => {
      updateAnswerPublicAvailability(form, question.askerQuestionPublic);
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = {
        ownerQuestionVisibility: form.ownerQuestionVisibility.value,
        answer: form.answer.value,
        answerVisibility: form.answerVisibility.value
      };
      await api(`/api/owner/questions/${question.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      $(".message", form).textContent = "已保存。公开墙会按新的隐私规则更新。";
      await loadPublicWall();
    } catch (error) {
      $(".message", form).textContent = error.message;
    }
  });

  return article;
}

function updateAnswerPublicAvailability(form, askerAllowsPublic) {
  const ownerAllowsPublic = form.ownerQuestionVisibility.value === "public";
  const publicAnswer = form.answerVisibility.value === "public";
  const publicRadio = form.querySelector('input[name="answerVisibility"][value="public"]');
  publicRadio.disabled = !(askerAllowsPublic && ownerAllowsPublic);
  if (publicRadio.disabled && publicAnswer) {
    form.answerVisibility.value = "private";
  }
}
