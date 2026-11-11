
const express = require("express");
const fs = require("fs");
const path = require("path");

loadEnv(path.join(__dirname, "../.env"));

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const templatePath = path.join(
  __dirname,
  "../templates/template1"
);

app.use(express.static(path.join(__dirname, "../public")));

// HTML, CSS 등 템플릿 파일 제공
app.use("/template1", express.static(templatePath));
app.use("/template2", express.static(path.join(__dirname, "../templates/template2")));
app.use("/template3", express.static(path.join(__dirname, "../templates/template3")));

// config.json 불러오기
app.get("/api/config", (req, res) => {
  res.sendFile(path.join(templatePath, "config.json"));
});

app.post("/api/chat", async (req, res) => {
  const messages = sanitizeMessages(req.body && req.body.messages);
  if (!messages.length) {
    res.status(400).json({ error: "보낼 메시지가 없습니다." });
    return;
  }

  try {
    const reply = await askOpenAI([
      {
        role: "system",
        content: "당신은 기업 홈페이지 기획을 돕는 도우미입니다. 한국어로 답하고, 업종에 맞는 메뉴, 문구, 색을 짧게 제안합니다. 색을 말할 때는 #으로 시작하는 색 코드를 함께 적습니다."
      },
      ...messages
    ]);
    res.json({ reply: reply });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.post("/api/apply", async (req, res) => {
  const messages = sanitizeMessages(req.body && req.body.messages);
  if (!messages.length) {
    res.status(400).json({ error: "반영할 대화가 없습니다." });
    return;
  }

  const templateId = ["template1", "template2", "template3"].indexOf(req.body && req.body.template) >= 0
    ? req.body.template
    : "template1";
  const configPath = path.join(__dirname, "../templates", templateId, "config.json");
  try {
    const current = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const reply = await askOpenAI([
      {
        role: "system",
        content: "대화에서 정한 홈페이지를 기존 JSON 구조 그대로 고쳐 JSON만 반환합니다. companyName, primaryColor, heroEyebrow, heroTitle, heroDescription, pageDescription, menu, heroActions, heroPanel, about, business, products, contact, year 키를 유지합니다. menu의 href는 #about #business #products #contact 순서를 유지합니다. primaryColor는 #과 6자리 색 코드입니다. 대화에 없는 연락처와 사실 숫자는 기존 값을 유지합니다."
      },
      ...messages,
      {
        role: "user",
        content: "현재 설정입니다. 대화 내용에 맞게 고친 JSON만 주세요.\n" + JSON.stringify(current)
      }
    ], true);
    const next = JSON.parse(stripJsonFence(reply));
    const merged = mergeConfig(current, next);
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    res.json({ url: "/" + templateId + "/?applied=" + Date.now() });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
});

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

async function askOpenAI(messages, jsonMode) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY가 없습니다. 프로젝트 루트의 .env 파일에 넣고 서버를 다시 실행해 주세요.");
    error.status = 500;
    throw error;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: jsonMode ? { type: "json_object" } : undefined,
      messages: messages
    })
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data.error && data.error.message ? data.error.message : "OpenAI 요청에 실패했습니다."
    );
    error.status = response.status;
    throw error;
  }
  const reply = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  return reply || "";
}

function stripJsonFence(text) {
  return String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
}

function mergeConfig(base, next) {
  const config = JSON.parse(JSON.stringify(base));
  if (!next || typeof next !== "object") return config;
  ["companyName", "heroEyebrow", "heroTitle", "heroDescription", "pageDescription"].forEach(function (key) {
    if (typeof next[key] === "string" && next[key].trim()) config[key] = next[key].trim();
  });
  if (typeof next.primaryColor === "string" && /^#([0-9a-fA-F]{6})$/.test(next.primaryColor.trim())) {
    config.primaryColor = next.primaryColor.trim();
  }
  if (Array.isArray(next.menu)) {
    config.menu = next.menu.slice(0, 4).map(function (item, index) {
      const fallback = base.menu[index] || {};
      return {
        label: textOr(item && item.label, fallback.label),
        href: fallback.href || (item && item.href)
      };
    }).filter(function (item) { return item.label && item.href; });
  }
  if (next.heroPanel && Array.isArray(next.heroPanel.items)) {
    config.heroPanel.label = textOr(next.heroPanel.label, config.heroPanel.label);
    config.heroPanel.items = next.heroPanel.items.slice(0, 4).map(function (item) {
      return { title: textOr(item.title, ""), description: textOr(item.description, "") };
    }).filter(function (item) { return item.title; });
  }
  if (next.about) {
    config.about.title = textOr(next.about.title, config.about.title);
    config.about.body = textOr(next.about.body, config.about.body);
    if (Array.isArray(next.about.facts)) {
      config.about.facts = next.about.facts.slice(0, 3).map(function (fact) {
        return { label: textOr(fact.label, ""), value: textOr(fact.value, "") };
      }).filter(function (fact) { return fact.label && fact.value; });
    }
  }
  if (next.business && Array.isArray(next.business.items)) {
    config.business.title = textOr(next.business.title, config.business.title);
    config.business.items = next.business.items.slice(0, 4).map(function (item) {
      return { title: textOr(item.title, ""), description: textOr(item.description, "") };
    }).filter(function (item) { return item.title; });
  }
  if (next.products && Array.isArray(next.products.items)) {
    config.products.title = textOr(next.products.title, config.products.title);
    config.products.items = next.products.items.slice(0, 3).map(function (item) {
      return { name: textOr(item.name, ""), description: textOr(item.description, "") };
    }).filter(function (item) { return item.name; });
  }
  if (next.contact) {
    ["title", "description", "address", "phone", "email", "submit", "success"].forEach(function (key) {
      if (typeof next.contact[key] === "string" && next.contact[key].trim()) {
        config.contact[key] = next.contact[key].trim();
      }
    });
  }
  return config;
}

function textOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : (fallback || "");
}

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(function (message) {
      return message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim();
    })
    .slice(-12)
    .map(function (message) {
      return {
        role: message.role,
        content: message.content.trim().slice(0, 4000)
      };
    });
}
