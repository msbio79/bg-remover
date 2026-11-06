const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

const $ = (selector) => document.querySelector(selector);
const drop = $("#drop");
const fileInput = $("#file");
const modelSelect = $("#model");
const results = $("#results");
const cardTemplate = $("#card");
const customColor = $("#custom-color");
const customSwatch = customColor.parentElement;

const items = new Map();
let nextId = 1;
let background = ""; // 빈 문자열이면 투명
let worker = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker("worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    const item = items.get(data.id);
    if (!item) return;
    if (data.type === "progress") showProgress(item, data);
    if (data.type === "done") finish(item, data.blob);
    if (data.type === "error") fail(item, data.message);
  };
  // 워커 자체가 뜨지 못한 경우(CDN 차단 등)에는 대기 중인 항목을 모두 실패 처리한다.
  worker.onerror = (event) => {
    event.preventDefault();
    for (const item of items.values()) {
      if (!item.result && !item.failed) fail(item, "처리 엔진을 불러오지 못했습니다. 네트워크를 확인해 주세요.");
    }
    worker.terminate();
    worker = null;
  };
  return worker;
}

function setStatus(item, text) {
  item.el.status.textContent = text;
}

function showProgress(item, { key, current, total }) {
  if (key.startsWith("fetch:")) {
    const percent = total ? Math.round((current / total) * 100) : 0;
    // 엔진과 모델을 따로 받으므로, 퍼센트가 되돌아가 보이지 않도록 구분해서 표시한다.
    const label = key.includes("/models/") ? "모델" : "엔진";
    setStatus(item, `${label} 다운로드 중… ${percent}%`);
  } else {
    setStatus(item, "배경 제거 중…");
  }
}

function finish(item, blob) {
  item.result = blob;
  item.resultUrl = URL.createObjectURL(blob);
  item.el.card.classList.remove("busy");
  setStatus(item, "");
  showResult(item);
  applyBackground(item);
  item.el.compare.hidden = false;
  item.el.download.hidden = false;
}

function fail(item, message) {
  console.error(message);
  item.failed = true;
  item.el.card.classList.remove("busy");
  item.el.card.classList.add("failed");
  setStatus(item, message.startsWith("처리 엔진") ? message : "이 사진은 처리하지 못했습니다.");
}

function showOriginal(item) {
  item.el.preview.src = item.originalUrl;
  item.el.stage.classList.remove("checker");
  item.el.stage.style.backgroundColor = "";
}

function showResult(item) {
  item.el.preview.src = item.resultUrl;
}

function applyBackground(item) {
  if (!item.result) return;
  item.el.stage.classList.toggle("checker", !background);
  item.el.stage.style.backgroundColor = background;
}

function addFile(file) {
  if (!ACCEPTED.includes(file.type)) return false;

  const id = nextId++;
  const fragment = cardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".card");
  const el = {
    card,
    stage: card.querySelector(".stage"),
    preview: card.querySelector(".preview"),
    status: card.querySelector(".status"),
    compare: card.querySelector(".compare"),
    download: card.querySelector(".download"),
    remove: card.querySelector(".remove"),
  };
  const item = {
    id,
    name: file.name || "image",
    originalUrl: URL.createObjectURL(file),
    resultUrl: null,
    result: null,
    failed: false,
    el,
  };
  items.set(id, item);

  card.classList.add("busy");
  card.querySelector(".name").textContent = item.name;
  el.preview.alt = item.name;
  el.preview.src = item.originalUrl;
  setStatus(item, "대기 중…");

  // 누르고 있는 동안만 원본을 보여 준다.
  el.compare.addEventListener("pointerdown", () => showOriginal(item));
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) {
    el.compare.addEventListener(type, () => {
      showResult(item);
      applyBackground(item);
    });
  }
  el.download.addEventListener("click", () => download(item));
  el.remove.addEventListener("click", () => removeItem(item));

  results.prepend(card);
  getWorker().postMessage({ id, file, model: modelSelect.value });
  return true;
}

function addFiles(files) {
  const list = [...files];
  const added = list.filter(addFile).length;
  if (added < list.length) alert("JPG, PNG, WebP 사진만 올릴 수 있습니다.");
}

function removeItem(item) {
  URL.revokeObjectURL(item.originalUrl);
  if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  item.el.card.remove();
  items.delete(item.id);
}

async function withBackground(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function download(item) {
  const blob = background ? await withBackground(item.result) : item.result;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.name.replace(/\.[^.]+$/, "")}-배경제거.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function selectBackground(color, swatch) {
  background = color;
  for (const button of document.querySelectorAll("button.swatch")) {
    button.setAttribute("aria-checked", String(button === swatch));
  }
  customSwatch.classList.toggle("selected", swatch === customSwatch);
  items.forEach(applyBackground);
}

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = ""; // 같은 파일을 다시 고를 수 있게 비운다.
});

for (const type of ["dragenter", "dragover"]) {
  window.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
}
for (const type of ["dragleave", "drop"]) {
  window.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("over");
  });
}
window.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

window.addEventListener("paste", (event) => {
  const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
  if (images.length) addFiles(images);
});

for (const button of document.querySelectorAll("button.swatch")) {
  button.addEventListener("click", () => selectBackground(button.dataset.color, button));
}
customColor.addEventListener("input", () => selectBackground(customColor.value, customSwatch));

// AGPL은 사용자에게 소스 코드 접근을 제공하도록 요구하므로 GitHub Pages 주소에서 저장소 링크를 만든다.
const pages = location.hostname.match(/^([^.]+)\.github\.io$/);
if (pages) {
  const repo = location.pathname.split("/")[1] || location.hostname;
  const source = $("#source");
  source.href = `https://github.com/${pages[1]}/${repo}`;
  source.hidden = false;
}
