// Utilitarios genericos compartilhados pelo sistema SATS.
"use strict";

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function renderColorPalette(container, colors, selected, onSelect) {
  container.innerHTML = "";
  colors.forEach(color => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-dot" + (color === selected ? " is-selected" : "");
    button.style.background = color;
    button.setAttribute("aria-label", `Selecionar cor ${color}`);
    button.addEventListener("click", () => onSelect(color));
    container.appendChild(button);
  });
}

function handleProfileColorSelect(color) {
  selectedProfileColor = color;
  renderColorPalette(els.profileColorPalette, AVATAR_COLORS, selectedProfileColor, handleProfileColorSelect);
}

function handleFolderColorSelect(color) {
  selectedFolderColor = color;
  renderColorPalette(els.folderColorPalette, FOLDER_COLORS, selectedFolderColor, handleFolderColorSelect);
}

function avatarHtml(profile, size) {
  const cls = size === "small" ? "avatar small" : "avatar";
  if (profile.avatarPhoto) return `<span class="${cls}"><img src="${escapeAttr(profile.avatarPhoto)}" alt=""></span>`;
  return `<span class="${cls}" style="background:${escapeAttr(profile.avatarColor || pickColor(profile.name))}">${escapeHtml(initials(profile.name))}</span>`;
}

function initials(name) {
  const parts = String(name || "ST").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "ST";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function pickColor(seed) {
  const text = String(seed || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash + text.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
}

function updateProgressControl(control, value) {
  if (!control) return;
  const fill = control.querySelector(".progress-fill");
  const progress = clampProgress(value);
  fill.style.width = progress + "%";
  fill.style.background = progressColor(progress);
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function pct(value, total) {
  return total ? Math.round((value / total) * 100) + "%" : "0%";
}

function normalizeStatus(value) {
  return STATUSES.includes(value) ? value : "Não iniciado";
}

function normalizePriority(value) {
  return PRIORITIES.includes(value) ? value : "Média";
}

function clampProgress(value) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function progressColor(value) {
  const progress = clampProgress(value);
  if (progress === 100) return "#22c55e";
  if (progress >= 71) return "#3b82f6";
  if (progress >= 31) return "#f59e0b";
  return "#ef4444";
}

function priorityClass(value) {
  return { Alta: "priority-alta", Média: "priority-media", Baixa: "priority-baixa" }[value] || "";
}

function statusClass(value) {
  return {
    "Não iniciado": "status-nao-iniciado",
    "Em andamento": "status-em-andamento",
    "Concluído": "status-concluido",
    "Cancelado": "status-cancelado"
  }[value] || "";
}

function formatDateForMeta(date) {
  return date.toLocaleDateString("pt-BR") + " - Rev. 00";
}

function formatDateFromInput(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("pt-BR");
}

function formatDateTime(value) {
  if (!value) return "sem registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem registro";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function richFromAny(value) {
  const text = String(value || "");
  if (!text) return "";
  return /<[a-z][\s\S]*>/i.test(text) ? sanitizeRichHtml(text) : plainToRich(text);
}

function plainToRich(value) {
  return escapeHtml(value || "").replace(/\n/g, "<br>");
}

function sanitizeRichHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  template.content.querySelectorAll("script, style, iframe, object, embed").forEach(node => node.remove());
  template.content.querySelectorAll("*").forEach(node => {
    [...node.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attr.name);
      if ((name === "src" || name === "href") && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      if (node.tagName.toLowerCase() === "img" && name === "src" && !/^data:image\//i.test(attr.value)) node.removeAttribute(attr.name);
    });
  });
  return template.innerHTML;
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html || "");
  return div.textContent || div.innerText || "";
}

function selectElementText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImageFileToDataUrl(file, options = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Arquivo inválido"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => compressImageSourceToDataUrl(reader.result, options).then(resolve).catch(reject);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImageSourceToDataUrl(src, options = {}) {
  const maxWidth = options.maxWidth || 900;
  const quality = options.quality || 0.65;
  return new Promise((resolve, reject) => {
    if (!/^data:image\//i.test(String(src || ""))) {
      reject(new Error("Imagem inválida"));
      return;
    }
    const image = new Image();
    image.onload = () => {
      const ratio = image.naturalWidth > maxWidth ? maxWidth / image.naturalWidth : 1;
      const width = Math.max(1, Math.round(image.naturalWidth * ratio));
      const height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => reject(new Error("Imagem inválida"));
    image.src = src;
  });
}

function compressRichEditorImages(editor) {
  const images = [...editor.querySelectorAll("img")]
    .filter(image => /^data:image\//i.test(image.getAttribute("src") || image.src || ""))
    .filter(image => image.dataset.sstCompressed !== "true");
  if (!images.length) return Promise.resolve();
  return Promise.all(images.map(image => {
    if (!image.__sstCompressPromise) {
      image.__sstCompressPromise = compressImageSourceToDataUrl(image.src, { maxWidth: 900, quality: 0.65 })
        .then(dataUrl => {
          image.src = dataUrl;
          image.dataset.sstCompressed = "true";
        })
        .catch(error => {
          console.error(error);
          image.removeAttribute("src");
          image.dataset.sstCompressed = "true";
        })
        .finally(() => {
          delete image.__sstCompressPromise;
        });
    }
    return image.__sstCompressPromise;
  })).then(() => undefined);
}

function imageFileToAvatarDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Arquivo inválido"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const size = AVATAR_CANVAS_SIZE;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, size, size);
        const sourceSize = Math.min(image.width, image.height);
        const sx = (image.width - sourceSize) / 2;
        const sy = (image.height - sourceSize) / 2;
        context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.62));
      };
      image.onerror = () => reject(new Error("Imagem inválida"));
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
