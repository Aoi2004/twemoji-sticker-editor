"use strict";

const TWEMOJI_ASSET_BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.3/assets/svg/";
const STICKER_CATEGORIES = (window.FULL_TWEMOJI_CATEGORIES ?? []).filter(({ stickers }) => stickers.length > 0);
const RECENT_STICKERS_KEY = "twemoji-sticker-editor-recent-v1";
const THEME_KEY = "twemoji-sticker-editor-theme-v1";
const MAX_RECENT_STICKERS = 24;
const ALL_STICKERS = STICKER_CATEGORIES.flatMap((category) => category.stickers);

const canvas = document.querySelector("#editorCanvas");
const ctx = canvas.getContext("2d");
const imageInput = document.querySelector("#imageInput");
const emojiGrid = document.querySelector("#emojiGrid");
const emojiSearch = document.querySelector("#emojiSearch");
const emojiCategories = document.querySelector("#emojiCategories");
const statusText = document.querySelector("#statusText");
const fileName = document.querySelector("#fileName");
const viewport = document.querySelector("#stageViewport");
const zoomValue = document.querySelector("#zoomValue");
const themeToggle = document.querySelector("#themeToggle");
const themeLabel = document.querySelector("#themeLabel");
const copyImageButton = document.querySelector("#copyImageButton");
const pasteImageButton = document.querySelector("#pasteImageButton");
const clearButton = document.querySelector("#clearButton");
const MIN_STICKER_SIZE = 32;
const ROTATE_HANDLE_OFFSET = 34;

const state = {
  baseImage: null,
  baseName: "twemoji-edit.png",
  stickers: [],
  selectedId: null,
  drag: null,
  zoom: 1,
  history: [],
  historyIndex: -1,
  activeCategory: "recent",
  recentStickers: loadRecentStickers()
};

const imageCache = new Map();
let nextStickerId = 1;

function getInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Use the system preference when browser storage is unavailable.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#111318" : "#f4f6f8";
  themeToggle.checked = theme === "dark";
  themeLabel.textContent = theme === "dark" ? "ダーク" : "ライト";
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Theme switching remains available for the current session.
  }
}

function loadRecentStickers() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_STICKERS_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    const labelByEmoji = new Map(ALL_STICKERS);
    return stored
      .filter((emoji) => typeof emoji === "string" && labelByEmoji.has(emoji))
      .slice(0, MAX_RECENT_STICKERS)
      .map((emoji) => [emoji, labelByEmoji.get(emoji)]);
  } catch {
    return [];
  }
}

function saveRecentStickers() {
  try {
    localStorage.setItem(RECENT_STICKERS_KEY, JSON.stringify(state.recentStickers.map(([emoji]) => emoji)));
  } catch {
    // Editing remains available when browser storage is unavailable.
  }
}

function addToRecent(emoji) {
  const label = ALL_STICKERS.find(([candidate]) => candidate === emoji)?.[1];
  if (!label) return;
  state.recentStickers = [[emoji, label], ...state.recentStickers.filter(([candidate]) => candidate !== emoji)].slice(0, MAX_RECENT_STICKERS);
  saveRecentStickers();
}

function getCodePoint(emoji) {
  if (window.twemoji?.convert?.toCodePoint) {
    return window.twemoji.convert.toCodePoint(emoji);
  }
  return Array.from(emoji)
    .map((char) => char.codePointAt(0).toString(16))
    .filter((point) => point !== "fe0f")
    .join("-");
}

function getEmojiUrl(emoji) {
  return `${TWEMOJI_ASSET_BASE}${getCodePoint(emoji)}.svg`;
}

function loadStickerImage(emoji) {
  const url = getEmojiUrl(emoji);
  if (imageCache.has(url)) return imageCache.get(url);

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

function stickersForCurrentView() {
  const query = emojiSearch.value.trim().toLowerCase();
  const category = STICKER_CATEGORIES.find(({ id }) => id === state.activeCategory);
  const stickers = query ? ALL_STICKERS : state.activeCategory === "recent" ? state.recentStickers : category?.stickers ?? [];
  return stickers.filter(([emoji, label]) => !query || emoji.includes(query) || label.toLowerCase().includes(query));
}

function renderEmojiCategories() {
  emojiCategories.replaceChildren();
  [{ id: "recent", label: "最近", icon: "◷" }, ...STICKER_CATEGORIES].forEach((category) => {
    const button = document.createElement("button");
    const isActive = category.id === state.activeCategory;
    button.type = "button";
    button.className = "emoji-category";
    button.textContent = `${category.icon} ${category.label}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(isActive));
    button.addEventListener("click", () => {
      state.activeCategory = category.id;
      renderEmojiCategories();
      renderEmojiGrid();
    });
    emojiCategories.append(button);
  });
}

function renderEmojiGrid() {
  emojiGrid.replaceChildren();
  stickersForCurrentView()
    .forEach(([emoji, label]) => {
      const button = document.createElement("button");
      const img = document.createElement("img");
      button.type = "button";
      button.className = "emoji-button";
      button.title = label;
      button.setAttribute("aria-label", `${label}を追加`);
      img.alt = emoji;
      img.loading = "lazy";
      img.src = getEmojiUrl(emoji);
      button.append(img);
      button.addEventListener("pointerenter", () => loadStickerImage(emoji).catch(() => {}), { once: true });
      button.addEventListener("click", () => addSticker(emoji));
      emojiGrid.append(button);
    });
}

function snapshot() {
  return JSON.stringify(state.stickers.map(({ image, ...sticker }) => sticker));
}

function restore(serialized) {
  state.stickers = JSON.parse(serialized);
  state.selectedId = state.stickers.at(-1)?.id ?? null;
  Promise.all(state.stickers.map((sticker) => loadStickerImage(sticker.emoji).then((img) => {
    sticker.image = img;
  }).catch(() => {}))).then(render);
  syncControls();
}

function pushHistory() {
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot());
  state.historyIndex = state.history.length - 1;
  updateButtons();
}

function selectedSticker() {
  return state.stickers.find((sticker) => sticker.id === state.selectedId) ?? null;
}

function setCanvasSize(width, height) {
  const maxPixels = 3600 * 3600;
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
}

function fitToViewport() {
  const availableWidth = Math.max(320, viewport.clientWidth - 56);
  const availableHeight = Math.max(240, viewport.clientHeight - 56);
  state.zoom = Math.min(1.5, availableWidth / canvas.width, availableHeight / canvas.height);
  applyZoom();
}

function applyZoom() {
  const width = Math.max(1, Math.round(canvas.width * state.zoom));
  const height = Math.max(1, Math.round(canvas.height * state.zoom));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function drawSticker(sticker) {
  if (!sticker.image) return;
  ctx.save();
  ctx.translate(sticker.x, sticker.y);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.drawImage(sticker.image, -sticker.size / 2, -sticker.size / 2, sticker.size, sticker.size);
  ctx.restore();
}

function drawSelection(sticker) {
  const handleRadius = getHandleRadius();
  const resizeX = sticker.size / 2;
  const resizeY = sticker.size / 2;
  const rotateY = -sticker.size / 2 - ROTATE_HANDLE_OFFSET / state.zoom;

  ctx.save();
  ctx.translate(sticker.x, sticker.y);
  ctx.rotate((sticker.rotation * Math.PI) / 180);
  ctx.strokeStyle = "#1d9bf0";
  ctx.lineWidth = Math.max(2 / state.zoom, 1);
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(-sticker.size / 2, -sticker.size / 2, sticker.size, sticker.size);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(0, -sticker.size / 2);
  ctx.lineTo(0, rotateY);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1d9bf0";
  ctx.lineWidth = Math.max(3 / state.zoom, 1.5);
  ctx.beginPath();
  ctx.arc(0, rotateY, handleRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#1d9bf0";
  ctx.beginPath();
  ctx.rect(resizeX - handleRadius, resizeY - handleRadius, handleRadius * 2, handleRadius * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (state.baseImage) {
    ctx.drawImage(state.baseImage, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#eef2f6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#526070";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "28px system-ui, sans-serif";
    ctx.fillText("画像を選択してください", canvas.width / 2, canvas.height / 2);
  }
  state.stickers.forEach(drawSticker);
  const selected = selectedSticker();
  if (selected) drawSelection(selected);
}

function syncControls() {
  updateButtons();
}

function updateButtons() {
  document.querySelector("#undoButton").disabled = state.historyIndex <= 0;
  document.querySelector("#redoButton").disabled = state.historyIndex >= state.history.length - 1;
  document.querySelector("#downloadButton").disabled = !state.baseImage;
  copyImageButton.disabled = !state.baseImage;
  const hasSelection = Boolean(selectedSticker());
  clearButton.disabled = !hasSelection;
}

async function addSticker(emoji) {
  const img = await loadStickerImage(emoji);
  const size = Math.max(72, Math.round(Math.min(canvas.width, canvas.height) * 0.16));
  const sticker = {
    id: nextStickerId++,
    emoji,
    x: canvas.width / 2,
    y: canvas.height / 2,
    size,
    rotation: 0,
    image: img
  };
  state.stickers.push(sticker);
  state.selectedId = sticker.id;
  addToRecent(emoji);
  if (state.activeCategory === "recent" && !emojiSearch.value.trim()) renderEmojiGrid();
  pushHistory();
  syncControls();
  render();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height
  };
}

function getHandleRadius() {
  return Math.max(10 / state.zoom, 6);
}

function toStickerLocalPoint(point, sticker) {
  const dx = point.x - sticker.x;
  const dy = point.y - sticker.y;
  const angle = (-sticker.rotation * Math.PI) / 180;
  return {
    x: dx * Math.cos(angle) - dy * Math.sin(angle),
    y: dx * Math.sin(angle) + dy * Math.cos(angle)
  };
}

function hitSelectionHandle(point, sticker) {
  const local = toStickerLocalPoint(point, sticker);
  const radius = getHandleRadius() * 1.25;
  const resizeX = sticker.size / 2;
  const resizeY = sticker.size / 2;
  const rotateY = -sticker.size / 2 - ROTATE_HANDLE_OFFSET / state.zoom;
  const resizeHit = Math.abs(local.x - resizeX) <= radius && Math.abs(local.y - resizeY) <= radius;
  const rotateHit = Math.hypot(local.x, local.y - rotateY) <= radius;

  if (rotateHit) return "rotate";
  if (resizeHit) return "resize";
  return null;
}

function hitTestSticker(point) {
  for (let index = state.stickers.length - 1; index >= 0; index -= 1) {
    const sticker = state.stickers[index];
    const local = toStickerLocalPoint(point, sticker);
    if (Math.abs(local.x) <= sticker.size / 2 && Math.abs(local.y) <= sticker.size / 2) {
      return sticker;
    }
  }
  return null;
}

function getPointerAngle(point, sticker) {
  return Math.atan2(point.y - sticker.y, point.x - sticker.x) * 180 / Math.PI;
}

function getPointerDistance(point, sticker) {
  return Math.max(1, Math.hypot(point.x - sticker.x, point.y - sticker.y));
}

function setCanvasCursor(event) {
  if (state.drag) return;
  const point = getCanvasPoint(event);
  const selected = selectedSticker();
  const handle = selected ? hitSelectionHandle(point, selected) : null;
  if (handle === "rotate") {
    canvas.style.cursor = "grab";
  } else if (handle === "resize") {
    canvas.style.cursor = "nwse-resize";
  } else if (hitTestSticker(point)) {
    canvas.style.cursor = "move";
  } else {
    canvas.style.cursor = "default";
  }
}

function loadBaseImage(file, displayName = file.name) {
  if (!file?.type.startsWith("image/")) {
    statusText.textContent = "画像ファイルを選択してください";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.baseImage = img;
      state.baseName = file.name.replace(/\.[^.]+$/, "") || "twemoji-edit";
      state.stickers = [];
      state.selectedId = null;
      state.history = [];
      state.historyIndex = -1;
      setCanvasSize(img.naturalWidth, img.naturalHeight);
      fileName.textContent = displayName;
      statusText.textContent = `${canvas.width}×${canvas.height}px`;
      fitToViewport();
      pushHistory();
      syncControls();
      render();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (file) loadBaseImage(file);
});

function canvasToPngBlob() {
  const selectedId = state.selectedId;
  state.selectedId = null;
  render();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      state.selectedId = selectedId;
      render();
      if (blob) resolve(blob);
      else reject(new Error("PNGを書き出せませんでした"));
    }, "image/png");
  });
}

async function copyImageToClipboard() {
  if (!state.baseImage) return;
  if (!navigator.clipboard?.write || !window.ClipboardItem) {
    statusText.textContent = "このブラウザは画像コピーに対応していません";
    return;
  }

  try {
    const blob = await canvasToPngBlob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    statusText.textContent = "画像をクリップボードにコピーしました";
  } catch {
    statusText.textContent = "画像をコピーできませんでした。ブラウザの権限を確認してください";
  }
}

function imageFileFromClipboardItem(item) {
  const type = item.types.find((candidate) => candidate.startsWith("image/"));
  if (!type) return null;
  return item.getType(type).then((blob) => new File([blob], `clipboard-image.${type.split("/")[1] || "png"}`, { type }));
}

async function pasteImageFromClipboard() {
  if (!navigator.clipboard?.read) {
    statusText.textContent = "画像を貼り付けるには Cmd/Ctrl + V を使ってください";
    return;
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const file = await imageFileFromClipboardItem(item);
      if (file) {
        loadBaseImage(file, "クリップボードの画像");
        return;
      }
    }
    statusText.textContent = "クリップボードに画像がありません";
  } catch {
    statusText.textContent = "画像を貼り付けるには Cmd/Ctrl + V を使ってください";
  }
}

canvas.addEventListener("pointerdown", (event) => {
  const point = getCanvasPoint(event);
  const selected = selectedSticker();
  const handle = selected ? hitSelectionHandle(point, selected) : null;
  const target = handle ? selected : hitTestSticker(point);
  state.selectedId = target?.id ?? null;
  if (target) {
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = handle === "rotate" ? "grabbing" : handle === "resize" ? "nwse-resize" : "move";
    state.drag = {
      id: target.id,
      mode: handle || "move",
      offsetX: point.x - target.x,
      offsetY: point.y - target.y,
      startAngle: getPointerAngle(point, target),
      startDistance: getPointerDistance(point, target),
      startRotation: target.rotation,
      startSize: target.size,
      moved: false
    };
  }
  syncControls();
  render();
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.drag) {
    setCanvasCursor(event);
    return;
  }
  const sticker = selectedSticker();
  if (!sticker) return;
  const point = getCanvasPoint(event);
  if (state.drag.mode === "rotate") {
    const delta = getPointerAngle(point, sticker) - state.drag.startAngle;
    sticker.rotation = state.drag.startRotation + delta;
  } else if (state.drag.mode === "resize") {
    const scale = getPointerDistance(point, sticker) / state.drag.startDistance;
    sticker.size = Math.max(MIN_STICKER_SIZE, state.drag.startSize * scale);
  } else {
    sticker.x = point.x - state.drag.offsetX;
    sticker.y = point.y - state.drag.offsetY;
  }
  state.drag.moved = true;
  render();
});

function finishCanvasDrag() {
  if (state.drag?.moved) pushHistory();
  state.drag = null;
  canvas.style.cursor = "default";
}

canvas.addEventListener("pointerup", finishCanvasDrag);
canvas.addEventListener("pointercancel", finishCanvasDrag);
canvas.addEventListener("lostpointercapture", finishCanvasDrag);

document.querySelector("#undoButton").addEventListener("click", () => {
  if (state.historyIndex <= 0) return;
  state.historyIndex -= 1;
  restore(state.history[state.historyIndex]);
  updateButtons();
});

document.querySelector("#redoButton").addEventListener("click", () => {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex += 1;
  restore(state.history[state.historyIndex]);
  updateButtons();
});

clearButton.addEventListener("click", () => {
  if (!selectedSticker()) return;
  state.stickers = state.stickers.filter((sticker) => sticker.id !== state.selectedId);
  state.selectedId = null;
  pushHistory();
  syncControls();
  render();
});

document.querySelector("#downloadButton").addEventListener("click", () => {
  state.selectedId = null;
  render();
  const link = document.createElement("a");
  link.download = `${state.baseName}-twemoji.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

copyImageButton.addEventListener("click", copyImageToClipboard);
pasteImageButton.addEventListener("click", pasteImageFromClipboard);

document.querySelector("#fitButton").addEventListener("click", fitToViewport);
document.querySelector("#zoomOutButton").addEventListener("click", () => {
  state.zoom = Math.max(0.1, state.zoom - 0.1);
  applyZoom();
});
document.querySelector("#zoomInButton").addEventListener("click", () => {
  state.zoom = Math.min(3, state.zoom + 0.1);
  applyZoom();
});

emojiSearch.addEventListener("input", renderEmojiGrid);
themeToggle.addEventListener("change", () => setTheme(themeToggle.checked ? "dark" : "light"));
window.addEventListener("paste", (event) => {
  const item = [...(event.clipboardData?.items ?? [])].find((candidate) => candidate.type.startsWith("image/"));
  const file = item?.getAsFile();
  if (!file) return;
  event.preventDefault();
  loadBaseImage(file, "クリップボードの画像");
});
window.addEventListener("resize", () => {
  if (!state.baseImage) return;
  fitToViewport();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

setTheme(getInitialTheme());
renderEmojiCategories();
renderEmojiGrid();
syncControls();
render();
fitToViewport();
STICKER_CATEGORIES[0]?.stickers.slice(0, 24).forEach(([emoji]) => loadStickerImage(emoji).catch(() => {}));
state.recentStickers.forEach(([emoji]) => loadStickerImage(emoji).catch(() => {}));
