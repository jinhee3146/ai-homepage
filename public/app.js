var composer = document.querySelector("#composer");
var brief = document.querySelector("#brief");
var thread = document.querySelector("#thread");
var sendButton = document.querySelector(".send");
var statusLine = document.querySelector("#composer-status");
var chatMessages = [];
var sending = false;
var selectedTemplate = "template1";
var templateChoices = [
  ["template1", "템플릿 1", "previews/template1.png"],
  ["template2", "템플릿 2", "previews/template2.png"],
  ["template3", "템플릿 3", "previews/template3.png"]
];

function setStatus(text, isError) {
  statusLine.textContent = text;
  statusLine.classList.toggle("is-error", Boolean(isError));
}

function sendBrief(preset) {
  var text = typeof preset === "string" ? preset : brief.value.trim();
  if (sending) return;
  if (!text) {
    setStatus("내용을 입력한 뒤 버튼을 눌러 주세요.", true);
    return;
  }
  if (location.protocol === "file:") {
    setStatus("http://localhost:3000 으로 열어야 서버로 전송됩니다.", true);
    return;
  }

  sending = true;
  sendButton.disabled = true;
  sendButton.classList.add("is-busy");
  setStatus("GPT에게 보내는 중...");
  chatMessages.push({ role: "user", content: text });
  brief.value = "";
  renderThread("답변을 받는 중입니다.");

  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: chatMessages })
  })
    .then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
        return data;
      });
    })
    .then(function (data) {
      chatMessages.push({ role: "assistant", content: data.reply || "" });
      renderThread();
      setStatus("답을 받았습니다. 이어서 보낼 수 있습니다.");
    })
    .catch(function (error) {
      chatMessages.pop();
      brief.value = text;
      renderThread(error.message, true);
      setStatus(error.message, true);
    })
    .finally(function () {
      sending = false;
      sendButton.disabled = false;
      sendButton.classList.remove("is-busy");
      brief.focus();
    });
}

sendButton.addEventListener("click", sendBrief);
composer.addEventListener("submit", function (event) {
  event.preventDefault();
  sendBrief();
});

function renderThread(note, isError) {
  thread.hidden = false;
  thread.replaceChildren();
  chatMessages.forEach(function (message) {
    var bubble = document.createElement("p");
    bubble.className = "bubble " + message.role;
    bubble.textContent = message.content;
    thread.append(bubble);
  });
  if (note) {
    var status = document.createElement("p");
    status.className = isError ? "bubble error" : "bubble assistant";
    status.textContent = note;
    thread.append(status);
    return;
  }
  if (chatMessages.length && chatMessages[chatMessages.length - 1].role === "assistant") {
    thread.append(replyActions());
  }
}

function replyActions() {
  var wrap = document.createElement("div");
  wrap.className = "reply-actions";
  wrap.append(templatePicker(), actionButtons());
  return wrap;
}

function templatePicker() {
  var picker = document.createElement("div");
  picker.className = "template-pick";
  var label = document.createElement("span");
  label.textContent = "템플릿 고르기";
  var cards = document.createElement("div");
  cards.className = "template-cards";
  templateChoices.forEach(function (choice) {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", selectedTemplate === choice[0] ? "true" : "false");
    var image = document.createElement("img");
    image.src = choice[2];
    image.alt = choice[1] + " 화면";
    var name = document.createElement("span");
    name.textContent = choice[1];
    button.append(image, name);
    button.addEventListener("click", function () {
      selectedTemplate = choice[0];
      cards.querySelectorAll("button").forEach(function (item) {
        item.setAttribute("aria-pressed", "false");
      });
      button.setAttribute("aria-pressed", "true");
    });
    cards.append(button);
  });
  picker.append(label, cards);
  return picker;
}

function actionButtons() {
  var actions = document.createElement("div");
  actions.className = "next-actions";
  [
    ["문구 수정", "문구만 다시 다듬어 줘. 업종과 색 방향은 유지해 줘."],
    ["색상 수정", "색상만 다시 제안해 줘. 문구 방향은 유지하고 색 코드를 함께 적어 줘."],
    ["이대로 진행", ""]
  ].forEach(function (item) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = item[0];
    button.addEventListener("click", function () {
      if (item[0] === "이대로 진행") applyTemplate();
      else sendBrief(item[1]);
    });
    actions.append(button);
  });
  return actions;
}

function applyTemplate() {
  if (sending || !chatMessages.length) return;
  var popup = window.open("", "_blank");
  sending = true;
  sendButton.disabled = true;
  sendButton.classList.add("is-busy");
  setStatus("요청대로 템플릿을 만드는 중...");
  renderThread("템플릿에 반영하는 중입니다.");

  fetch("/api/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: chatMessages, template: selectedTemplate })
  })
    .then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || "템플릿 반영에 실패했습니다.");
        return data;
      });
    })
    .then(function (data) {
      if (popup) popup.location = data.url;
      else window.location.href = data.url;
      renderThread();
      setStatus("템플릿을 새 창에서 열었습니다.");
    })
    .catch(function (error) {
      if (popup) popup.close();
      renderThread(error.message, true);
      setStatus(error.message, true);
    })
    .finally(function () {
      sending = false;
      sendButton.disabled = false;
      sendButton.classList.remove("is-busy");
    });
}

var menuButton = document.querySelector(".menu-button");
var topnav = document.querySelector("#topnav");

menuButton.addEventListener("click", function () {
  var open = topnav.classList.toggle("is-open");
  menuButton.setAttribute("aria-expanded", open ? "true" : "false");
});

var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
var count = document.querySelector(".slider-count");
var current = 0;

function showSlide(index) {
  current = (index + slides.length) % slides.length;
  slides.forEach(function (slide, slideIndex) {
    slide.classList.toggle("is-active", slideIndex === current);
  });
  count.textContent = (current + 1) + " / " + slides.length;
}

document.querySelectorAll("[data-dir]").forEach(function (button) {
  button.addEventListener("click", function () {
    showSlide(current + Number(button.getAttribute("data-dir")));
  });
});
