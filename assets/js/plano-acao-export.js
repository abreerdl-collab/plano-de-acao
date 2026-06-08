// Exportacoes PDF, RTF, JPEG e JSON.
"use strict";

async function exportExecutivePdf() {
  const plan = currentPlan();
  if (!plan) return alert("Abra um plano de ação antes de exportar o PDF.");
  const PdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!PdfCtor) {
    alert("A biblioteca de PDF ainda não carregou. Atualize a página e tente novamente.");
    return;
  }

  const doc = new PdfCtor({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  if (typeof doc.autoTable !== "function") {
    alert("A biblioteca de tabelas do PDF ainda não carregou. Atualize a página e tente novamente.");
    return;
  }

  const meta = plan.data && plan.data.meta ? plan.data.meta : {};
  const fileName = executivePdfFileName(meta.company || plan.company || plan.title);
  const button = document.getElementById("printBtn");
  const originalLabel = button ? button.innerHTML : "";
  if (button) {
    button.disabled = true;
    button.innerHTML = "Gerando PDF...";
  }

  try {
    await buildExecutivePdf(doc, plan);
    doc.save(fileName);
  } catch (error) {
    console.error(error);
    alert("Não foi possível gerar o PDF. Verifique se há imagens muito grandes e tente novamente.");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }
}

async function buildExecutivePdf(doc, plan) {
  const data = plan.data || { meta: {}, actions: [], equipment: [], trainings: [] };
  const meta = data.meta || {};
  const stats = getExecutiveStats(plan);
  const generatedAt = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const company = meta.company || plan.company || "-";
  const documentName = meta.documentName || plan.documentType || "-";

  doc.setProperties({
    title: `CRONOGRAMA DE AÇÕES - ${company}`,
    subject: "Relatório executivo de cronograma de ações SST",
    creator: "SATS"
  });

  let y = drawPdfHeader(doc, plan, meta, generatedAt);
  y = drawPdfMetaGrid(doc, [
    ["Empresa", company],
    ["Documento", documentName],
    ["Criação / Revisão", meta.revisionDate || "-"],
    ["Responsável técnico / setor", meta.technicalOwner || "-"]
  ], y);
  y = drawPdfDescription(doc, richContentForPdf(meta.description || DEFAULT_DESCRIPTION).text, y);
  y = drawPdfSummaryGrid(doc, stats, plan, y);
  y = drawPdfActionsTable(doc, data.actions || [], y);
  y = drawPdfEquipmentTable(doc, data.equipment || [], y);
  y = drawPdfTrainingsTable(doc, data.trainings || [], y);
  addPdfPageFooters(doc);
}

function drawPdfHeader(doc, plan, meta, generatedAt) {
  const width = pdfPageWidth(doc);
  const margin = 10;
  doc.setFillColor(37, 99, 235);
  doc.roundedRect(margin, 9, 13, 13, 2, 2, "F");
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("RELATÓRIO EXECUTIVO", margin + 18, 12.5);
  doc.setFontSize(17);
  doc.text("CRONOGRAMA DE AÇÕES SST", margin + 18, 19);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(pdfTrim(`${plan.title || "Plano de ação"}${meta.company ? " - " + meta.company : ""}`, 95), margin + 18, 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Gerado em", width - margin, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(generatedAt, width - margin, 18, { align: "right" });
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.7);
  doc.line(margin, 29, width - margin, 29);
  return 34;
}

function drawPdfMetaGrid(doc, items, startY) {
  const margin = 10;
  const gap = 4;
  const width = (pdfPageWidth(doc) - margin * 2 - gap * 3) / 4;
  items.forEach((item, index) => {
    drawPdfInfoBox(doc, margin + index * (width + gap), startY, width, 17, item[0], item[1]);
  });
  return startY + 22;
}

function drawPdfDescription(doc, text, startY) {
  const margin = 10;
  const width = pdfPageWidth(doc) - margin * 2;
  const lines = doc.splitTextToSize(pdfText(text), width - 8);
  const visibleLines = lines.slice(0, 6);
  const boxHeight = Math.max(15, 8 + visibleLines.length * 3.8);
  let y = ensurePdfSpace(doc, startY, boxHeight + 4);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, y, width, boxHeight, 2, 2, "FD");
  doc.setTextColor(51, 65, 85);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(visibleLines, margin + 4, y + 6);
  return y + boxHeight + 6;
}

function drawPdfSummaryGrid(doc, stats, plan, startY) {
  const items = [
    ["Total de ações", stats.total],
    ["Não iniciadas", `${stats.notStarted} (${pct(stats.notStarted, stats.total)})`],
    ["Em andamento", `${stats.inProgress} (${pct(stats.inProgress, stats.total)})`],
    ["Concluídas", `${stats.done} (${pct(stats.done, stats.total)})`],
    ["Progresso geral", `${stats.progress}%`],
    ["Alta prioridade aberta", stats.highOpen]
  ];
  const margin = 10;
  const gap = 3;
  const width = (pdfPageWidth(doc) - margin * 2 - gap * 5) / 6;
  let y = ensurePdfSpace(doc, startY, 20);
  items.forEach((item, index) => {
    drawPdfInfoBox(doc, margin + index * (width + gap), y, width, 16, item[0], item[1]);
  });
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(`Última edição do plano: ${formatDateTime(plan.updatedAt)}`, margin, y + 22);
  return y + 27;
}

function drawPdfActionsTable(doc, rows, startY) {
  const body = rows.map((row, index) => {
    const observation = richContentForPdf(row.observationHtml, { imagePlaceholder: false });
    return [
      String(index + 1),
      richContentForPdf(row.actionHtml).text,
      row.responsible || "-",
      row.when || "-",
      row.priority || "-",
      row.status || "-",
      pdfCellWithImages(observation)
    ];
  });
  return drawPdfTable(doc, "Ações", ["Item", "Ação recomendada para implementar/manter", "Responsável", "Quando", "Prioridade", "Status", "Observação"], body, startY, {
    emptyText: "Nenhuma ação cadastrada.",
    priorityColumn: 4,
    statusColumn: 5,
    imageColumn: 6,
    columnStyles: {
      0: { cellWidth: 11, halign: "center" },
      1: { cellWidth: 84 },
      2: { cellWidth: 31 },
      3: { cellWidth: 36 },
      4: { cellWidth: 22, halign: "center" },
      5: { cellWidth: 28, halign: "center" },
      6: { cellWidth: 65 }
    }
  });
}

function drawPdfEquipmentTable(doc, rows, startY) {
  const body = rows.map((row, index) => {
    const observation = richContentForPdf(row.observationHtml, { imagePlaceholder: false });
    return [
      String(index + 1),
      richContentForPdf(row.descriptionHtml).text,
      row.responsible || "-",
      row.status || "-",
      pdfCellWithImages(observation)
    ];
  });
  return drawPdfTable(doc, "Equipamentos de emergência", ["Item", "Descrição", "Responsável", "Status", "Observação"], body, startY, {
    emptyText: "Nenhum equipamento cadastrado.",
    statusColumn: 3,
    imageColumn: 4,
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 115 },
      2: { cellWidth: 40 },
      3: { cellWidth: 35, halign: "center" },
      4: { cellWidth: 75 }
    }
  });
}

function drawPdfTrainingsTable(doc, rows, startY) {
  const body = rows.map((row, index) => {
    const observation = richContentForPdf(row.observationHtml, { imagePlaceholder: false });
    return [
      String(index + 1),
      richContentForPdf(row.trainingHtml).text,
      row.responsible || "-",
      row.when || "-",
      row.status || "-",
      pdfCellWithImages(observation)
    ];
  });
  return drawPdfTable(doc, "Treinamentos", ["Item", "Treinamento", "Responsável", "Quando", "Status", "Observação"], body, startY, {
    emptyText: "Nenhum treinamento cadastrado.",
    statusColumn: 4,
    imageColumn: 5,
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 94 },
      2: { cellWidth: 38 },
      3: { cellWidth: 44 },
      4: { cellWidth: 31, halign: "center" },
      5: { cellWidth: 58 }
    }
  });
}

function pdfCellWithImages(rich) {
  if (!rich || !rich.images || !rich.images.length) return rich && rich.text ? rich.text : "-";
  return {
    content: rich.text === "-" ? "" : rich.text,
    images: rich.images
  };
}

function pdfCellImages(raw) {
  return raw && typeof raw === "object" && Array.isArray(raw.images) ? raw.images : [];
}

function pdfCellContent(raw) {
  return raw && typeof raw === "object" && "content" in raw ? raw.content : raw;
}

function drawPdfCellImages(doc, data, images) {
  if (!images.length) return;
  const padding = 1.6;
  const gap = 1.6;
  const columns = images.length > 1 ? 2 : 1;
  const usableWidth = Math.max(8, data.cell.width - padding * 2);
  const thumbWidth = (usableWidth - gap * (columns - 1)) / columns;
  const textLines = (data.cell.text || []).filter(Boolean);
  const textHeight = textLines.length ? textLines.length * 3.1 + 1.5 : 0;
  let imageY = data.cell.y + padding + textHeight;

  images.slice(0, 4).forEach((src, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const imageX = data.cell.x + padding + column * (thumbWidth + gap);
    const rowY = imageY + row * 18.5;
    try {
      const props = doc.getImageProperties(src);
      const fit = fitPdfImage(props.width, props.height, thumbWidth, 17);
      doc.addImage(src, pdfImageFormat(src), imageX + Math.max(0, (thumbWidth - fit.width) / 2), rowY, fit.width, fit.height);
    } catch (error) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text("Imagem não suportada.", imageX, rowY + 5);
    }
  });
}

function drawPdfTable(doc, title, head, body, startY, options) {
  let y = drawPdfSectionTitle(doc, title, startY);
  if (!body.length) return drawPdfEmptyBox(doc, options.emptyText, y);
  doc.autoTable({
    startY: y,
    head: [head],
    body,
    theme: "grid",
    margin: { left: 10, right: 10 },
    tableWidth: "wrap",
    styles: {
      font: "helvetica",
      fontSize: 7,
      cellPadding: 1.5,
      overflow: "linebreak",
      valign: "top",
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
      textColor: [15, 23, 42]
    },
    headStyles: {
      fillColor: [234, 242, 255],
      textColor: [15, 23, 42],
      fontStyle: "bold",
      halign: "center",
      fontSize: 7.2
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: options.columnStyles,
    didParseCell: data => {
      if (data.section !== "body") return;
      if (data.column.index === options.priorityColumn) applyPdfTone(data.cell, pdfPriorityTone(data.cell.raw));
      if (data.column.index === options.statusColumn) applyPdfTone(data.cell, pdfStatusTone(data.cell.raw));
      if (data.column.index === options.imageColumn) {
        const images = pdfCellImages(data.cell.raw);
        if (images.length) {
          const textLines = Array.isArray(data.cell.text)
            ? data.cell.text.filter(Boolean).length
            : String(pdfCellContent(data.cell.raw) || "").split(/\n+/).filter(Boolean).length;
          const imageRows = Math.ceil(Math.min(images.length, 4) / (images.length > 1 ? 2 : 1));
          data.cell.styles.minCellHeight = Math.max(data.cell.styles.minCellHeight || 0, 5 + textLines * 3.2 + imageRows * 18.5);
        }
      }
    },
    didDrawCell: data => {
      if (data.section !== "body" || data.column.index !== options.imageColumn) return;
      drawPdfCellImages(doc, data, pdfCellImages(data.cell.raw));
    }
  });
  return doc.lastAutoTable.finalY + 7;
}

function richContentForPdf(value, options = {}) {
  const template = document.createElement("template");
  template.innerHTML = sanitizeRichHtml(value || "");
  const useImagePlaceholder = options.imagePlaceholder !== false;
  const images = [...template.content.querySelectorAll("img")]
    .map(image => image.getAttribute("src"))
    .filter(src => /^data:image\//i.test(src || ""));
  template.content.querySelectorAll("img").forEach(image => {
    image.replaceWith(useImagePlaceholder ? document.createTextNode("[imagem anexada]") : document.createTextNode(""));
  });
  template.content.querySelectorAll("br").forEach(br => br.replaceWith(document.createTextNode("\n")));
  template.content.querySelectorAll("p, div, li").forEach(node => node.appendChild(document.createTextNode("\n")));
  const text = (template.content.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: text || "-", images };
}

function drawPdfInfoBox(doc, x, y, width, height, label, value) {
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text(String(label || "").toUpperCase(), x + 3, y + 5);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(pdfText(value), width - 6).slice(0, 2);
  doc.text(lines, x + 3, y + 10.5);
}

function drawPdfSectionTitle(doc, title, startY) {
  let y = ensurePdfSpace(doc, startY, 16);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(String(title || "").toUpperCase(), 10, y);
  doc.setDrawColor(226, 232, 240);
  doc.line(10, y + 2.3, pdfPageWidth(doc) - 10, y + 2.3);
  return y + 5;
}

function drawPdfEmptyBox(doc, text, startY) {
  let y = ensurePdfSpace(doc, startY, 13);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(10, y, pdfPageWidth(doc) - 20, 10, 2, 2, "FD");
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(text, 14, y + 6.5);
  return y + 15;
}

function applyPdfTone(cell, tone) {
  if (!tone) return;
  cell.styles.fillColor = tone.fill;
  cell.styles.textColor = tone.text;
  cell.styles.fontStyle = "bold";
  cell.styles.halign = "center";
}

function pdfPriorityTone(value) {
  if (value === "Alta") return { fill: [254, 226, 226], text: [153, 27, 27] };
  if (value === "Média") return { fill: [254, 243, 199], text: [146, 64, 14] };
  if (value === "Baixa") return { fill: [220, 252, 231], text: [22, 101, 52] };
  return null;
}

function pdfStatusTone(value) {
  if (value === "Não iniciado") return { fill: [226, 232, 240], text: [71, 85, 105] };
  if (value === "Em andamento") return { fill: [219, 234, 254], text: [30, 64, 175] };
  if (value === "Concluído") return { fill: [220, 252, 231], text: [22, 101, 52] };
  if (value === "Cancelado") return { fill: [254, 226, 226], text: [153, 27, 27] };
  return null;
}

function getExecutiveStats(plan) {
  const actions = plan.data && Array.isArray(plan.data.actions) ? plan.data.actions : [];
  const total = actions.length;
  const notStarted = actions.filter(row => row.status === "Não iniciado").length;
  const inProgress = actions.filter(row => row.status === "Em andamento").length;
  const done = actions.filter(row => row.status === "Concluído").length;
  const cancelled = actions.filter(row => row.status === "Cancelado").length;
  const highOpen = actions.filter(row => row.priority === "Alta" && row.status !== "Concluído" && row.status !== "Cancelado").length;
  return {
    total,
    notStarted,
    inProgress,
    done,
    cancelled,
    highOpen,
    progress: total ? Math.round((done / total) * 100) : 0
  };
}

function loadPdfImage(src) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth || image.width || 1,
      height: image.naturalHeight || image.height || 1,
      format: pdfImageFormat(src)
    });
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function pdfImageFormat(src) {
  if (/^data:image\/png/i.test(src || "")) return "PNG";
  if (/^data:image\/webp/i.test(src || "")) return "WEBP";
  return "JPEG";
}

function fitPdfImage(width, height, maxWidth, maxHeight) {
  const ratio = Math.min(maxWidth / Math.max(width, 1), maxHeight / Math.max(height, 1));
  return { width: width * ratio, height: height * ratio };
}

function ensurePdfSpace(doc, y, needed) {
  if (y + needed <= pdfPageHeight(doc) - 14) return y;
  doc.addPage();
  return 14;
}

function addPdfPageFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const width = pdfPageWidth(doc);
  const height = pdfPageHeight(doc);
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240);
    doc.line(10, height - 10, width - 10, height - 10);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("SATS", 10, height - 5);
    doc.text(`Página ${page} de ${pageCount}`, width - 10, height - 5, { align: "right" });
  }
}

function pdfPageWidth(doc) {
  return doc.internal.pageSize.getWidth();
}

function pdfPageHeight(doc) {
  return doc.internal.pageSize.getHeight();
}

function pdfText(value) {
  const text = String(value == null || value === "" ? "-" : value);
  return text.replace(/\r/g, "").replace(/\t/g, " ");
}

function pdfTrim(value, maxLength) {
  const text = pdfText(value).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, Math.max(0, maxLength - 1)).trim() + "..." : text;
}

function executivePdfFileName(company) {
  const safeCompany = sanitizeFileName(String(company || "SEM EMPRESA").trim().toUpperCase()) || "SEM EMPRESA";
  return `CRONOGRAMA DE AÇÕES - ${safeCompany}.pdf`;
}

async function exportExecutiveRtf() {
  const plan = currentPlan();
  if (!plan) return alert("Abra um plano de ação antes de exportar o RTF.");
  const meta = plan.data && plan.data.meta ? plan.data.meta : {};
  const button = document.getElementById("exportRtfBtn");
  const originalLabel = button ? button.innerHTML : "";
  if (button) {
    button.disabled = true;
    button.innerHTML = "Gerando RTF...";
  }

  try {
    const rtf = await buildExecutiveRtf(plan);
    const blob = new Blob([rtf], { type: "application/rtf;charset=utf-8" });
    downloadBlob(blob, executiveRtfFileName(meta.company || plan.company || plan.title));
  } catch (error) {
    console.error(error);
    alert("Não foi possível gerar o RTF. Verifique se há imagens muito grandes e tente novamente.");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }
}

async function buildExecutiveRtf(plan, options = {}) {
  const data = plan.data || { meta: {}, actions: [], equipment: [], trainings: [] };
  const meta = data.meta || {};
  const stats = getExecutiveStats(plan);
  const company = meta.company || plan.company || "-";
  const documentName = meta.documentName || plan.documentType || "-";
  const chunks = [
    "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Arial;}}{\\colortbl ;\\red15\\green23\\blue42;\\red29\\green78\\blue216;\\red255\\green255\\blue255;\\red219\\green234\\blue254;\\red254\\green226\\blue226;\\red153\\green27\\blue27;\\red254\\green243\\blue199;\\red146\\green64\\blue14;\\red220\\green252\\blue231;\\red22\\green101\\blue52;\\red229\\green231\\blue235;\\red55\\green65\\blue81;\\red203\\green213\\blue225;\\red248\\green250\\blue252;}",
    "\\viewkind4\\uc1\\landscape\\paperw16838\\paperh11906\\margl567\\margr567\\margt567\\margb567\\f0\\fs18\\cf1\n",
    `\\pard\\qc\\b\\fs30 ${rtfEscape("CRONOGRAMA DE AÇÕES SST")}\\b0\\fs18\\par\n`,
    `\\pard\\qc ${rtfEscape(`${plan.title || "Plano de ação"}${company && company !== "-" ? " - " + company : ""}`)}\\par\n`
  ];

  chunks.push(rtfTableRow(["Empresa", "Documento", "Criação / Revisão", "Responsável técnico / setor"].map(rtfEscape), [3925, 3925, 3925, 3925], true));
  chunks.push(rtfTableRow([company, documentName, meta.revisionDate || "-", meta.technicalOwner || "-"].map(rtfPlainCell), [3925, 3925, 3925, 3925]));
  chunks.push(`\\pard\\sb160\\b ${rtfEscape("Descrição")}\\b0\\par\n`);
  chunks.push(`\\pard ${rtfEscape(richContentForPdf(meta.description || DEFAULT_DESCRIPTION).text)}\\par\n`);

  chunks.push(`\\pard\\sb160\\b ${rtfEscape("Resumo")}\\b0\\par\n`);
  chunks.push(rtfTableRow(["Total de ações", "Não iniciadas", "Em andamento", "Concluídas", "Progresso geral", "Alta prioridade aberta"].map(rtfEscape), [2616, 2616, 2616, 2616, 2616, 2620], true));
  chunks.push(rtfTableRow([
    String(stats.total),
    `${stats.notStarted} (${pct(stats.notStarted, stats.total)})`,
    `${stats.inProgress} (${pct(stats.inProgress, stats.total)})`,
    `${stats.done} (${pct(stats.done, stats.total)})`,
    `${stats.progress}%`,
    String(stats.highOpen)
  ].map(rtfPlainCell), [2616, 2616, 2616, 2616, 2616, 2620]));
  chunks.push(`\\pard\\fs16 ${rtfEscape(`Última edição do plano: ${formatDateTime(plan.updatedAt)}`)}\\fs18\\par\n`);

  await appendRtfTable(chunks, "Ações", ["Item", "Ação recomendada", "Responsável", "Quando", "Prioridade", "Status", "Observação"], await Promise.all((data.actions || []).map(async (row, index) => [
    rtfPlainCell(index + 1),
    await rtfRichCell(row.actionHtml),
    rtfPlainCell(row.responsible || "-"),
    rtfPlainCell(row.when || "-"),
    rtfToneCell(row.priority || "-", rtfPriorityTone(row.priority)),
    rtfToneCell(row.status || "-", rtfStatusTone(row.status)),
    await rtfRichCell(row.observationHtml, { images: true })
  ])), [700, 5200, 1800, 2100, 1400, 1700, 2800], options);

  await appendRtfTable(chunks, "Equipamentos de emergência", ["Item", "Descrição", "Responsável", "Status", "Observação"], await Promise.all((data.equipment || []).map(async (row, index) => [
    rtfPlainCell(index + 1),
    await rtfRichCell(row.descriptionHtml),
    rtfPlainCell(row.responsible || "-"),
    rtfToneCell(row.status || "-", rtfStatusTone(row.status)),
    await rtfRichCell(row.observationHtml, { images: true })
  ])), [800, 6500, 2400, 2000, 4000], options);

  await appendRtfTable(chunks, "Treinamentos", ["Item", "Treinamento", "Responsável", "Quando", "Status", "Observação"], await Promise.all((data.trainings || []).map(async (row, index) => [
    rtfPlainCell(index + 1),
    await rtfRichCell(row.trainingHtml),
    rtfPlainCell(row.responsible || "-"),
    rtfPlainCell(row.when || "-"),
    rtfToneCell(row.status || "-", rtfStatusTone(row.status)),
    await rtfRichCell(row.observationHtml, { images: true })
  ])), [800, 5200, 2200, 2500, 2000, 3000], options);

  chunks.push("}");
  return chunks.join("");
}

async function appendRtfTable(chunks, title, headers, rows, widths, options = {}) {
  const usePageBreaks = options.pageBreaks === true;
  const rowsPerPage = 16;
  chunks.push(`\\pard\\sb220\\b\\fs22 ${rtfEscape(String(title || "").toUpperCase())}\\b0\\fs18\\par\n`);
  if (!rows.length) {
    chunks.push(`\\pard ${rtfEscape("Nenhum registro cadastrado.")}\\par\n`);
    return;
  }
  chunks.push(rtfTableRow(headers.map(rtfEscape), widths, true));
  rows.forEach((row, index) => {
    if (usePageBreaks && index > 0 && index % rowsPerPage === 0) {
      chunks.push("\\page\n");
      chunks.push(`\\pard\\sb120\\b\\fs22 ${rtfEscape(String(title || "").toUpperCase())} ${rtfEscape("(continuação)")}\\b0\\fs18\\par\n`);
      chunks.push(rtfTableRow(headers.map(rtfEscape), widths, true));
    }
    chunks.push(rtfTableRow(row, widths, false, { shaded: index % 2 === 1 }));
  });
}

function rtfTableRow(cells, widths, isHeader = false, options = {}) {
  const preparedCells = cells.map(cell => normalizeRtfCell(cell));
  let position = 0;
  let row = "\\trowd\\trgaph70\\trleft0";
  widths.forEach((width, index) => {
    const cell = preparedCells[index] || {};
    const background = cell.bg || (isHeader ? 2 : options.shaded ? 14 : 0);
    position += width;
    row += "\\clbrdrt\\brdrs\\brdrw10\\brdrcf13\\clbrdrl\\brdrs\\brdrw10\\brdrcf13\\clbrdrb\\brdrs\\brdrw10\\brdrcf13\\clbrdrr\\brdrs\\brdrw10\\brdrcf13\\clvertalt";
    if (background) row += `\\clcbpat${background}`;
    row += `\\cellx${position}`;
  });
  preparedCells.forEach(cell => {
    const align = cell.align === "center" || isHeader ? "\\qc" : "\\ql";
    const color = cell.color || (isHeader ? 3 : 1);
    const boldStart = isHeader || cell.bold ? "\\b" : "";
    const boldEnd = isHeader || cell.bold ? "\\b0" : "";
    row += `\\pard\\intbl${align}\\fs16\\cf${color}${boldStart} ${cell.text || rtfEscape("-")}${boldEnd}\\cf1\\cell`;
  });
  return row + "\\row\n";
}

function normalizeRtfCell(cell) {
  if (cell && typeof cell === "object" && "text" in cell) return cell;
  return { text: cell || rtfEscape("-") };
}

async function rtfRichCell(value, options = {}) {
  const rich = richContentForPdf(value, { imagePlaceholder: !options.images });
  const parts = [];
  if (rich.text && rich.text !== "-") parts.push(rtfEscape(rich.text));
  if (options.images) {
    for (const src of rich.images.slice(0, 4)) {
      const pict = await rtfImage(src, 2200, 1000);
      if (pict) parts.push(`\\line ${pict}`);
    }
  }
  return parts.join("") || rtfEscape("-");
}

function rtfPlainCell(value) {
  return rtfEscape(pdfText(value));
}

function rtfToneCell(value, tone) {
  const cell = {
    text: rtfPlainCell(value),
    align: "center",
    bold: true
  };
  if (tone) {
    cell.bg = tone.bg;
    cell.color = tone.color;
  }
  return cell;
}

function rtfPriorityTone(value) {
  if (value === "Alta") return { bg: 5, color: 6 };
  if (value === "Média") return { bg: 7, color: 8 };
  if (value === "Baixa") return { bg: 9, color: 10 };
  return null;
}

function rtfStatusTone(value) {
  if (value === "Não iniciado") return { bg: 11, color: 12 };
  if (value === "Em andamento") return { bg: 4, color: 2 };
  if (value === "Concluído") return { bg: 9, color: 10 };
  if (value === "Cancelado") return { bg: 5, color: 6 };
  return null;
}

async function rtfImage(src, maxWidthTwips, maxHeightTwips) {
  if (!/^data:image\/(png|jpe?g)/i.test(src || "")) return "";
  const image = await loadPdfImage(src);
  if (!image) return "";
  const fit = fitPdfImage(image.width, image.height, maxWidthTwips, maxHeightTwips);
  const blip = /^data:image\/png/i.test(src) ? "pngblip" : "jpegblip";
  const hex = dataUrlToHex(src);
  if (!hex) return "";
  return `{\\pict\\${blip}\\picw${Math.round(image.width)}\\pich${Math.round(image.height)}\\picwgoal${Math.round(fit.width)}\\pichgoal${Math.round(fit.height)} ${hex}}`;
}

function dataUrlToHex(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  if (!base64) return "";
  const binary = atob(base64);
  let hex = "";
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return hex;
}

function rtfEscape(value) {
  const text = String(value == null ? "" : value).replace(/\r/g, "").replace(/\t/g, " ");
  let escaped = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const code = text.charCodeAt(index);
    if (char === "\\") escaped += "\\\\";
    else if (char === "{") escaped += "\\{";
    else if (char === "}") escaped += "\\}";
    else if (char === "\n") escaped += "\\line ";
    else if (code > 127) escaped += `\\u${code > 32767 ? code - 65536 : code}?`;
    else escaped += char;
  }
  return escaped;
}

function executiveRtfFileName(company) {
  const safeCompany = sanitizeFileName(String(company || "SEM EMPRESA").trim().toUpperCase()) || "SEM EMPRESA";
  return `CRONOGRAMA DE AÇÕES - ${safeCompany}.rtf`;
}

async function exportExecutiveJpeg() {
  const plan = currentPlan();
  if (!plan) return alert("Abra um plano de ação antes de exportar o JPEG.");
  const meta = plan.data && plan.data.meta ? plan.data.meta : {};
  const fileBase = executiveJpegFileBase(meta.company || plan.company || plan.title);
  const button = document.getElementById("exportJpegBtn");
  const originalLabel = button ? button.innerHTML : "";
  if (button) {
    button.disabled = true;
    button.innerHTML = "Gerando JPEGs...";
  }

  try {
    const pages = await buildExecutiveJpegPages(plan);
    pages.forEach((page, index) => {
      setTimeout(() => downloadBlob(page.blob, `${fileBase} - ${page.fileSuffix}.jpg`), index * 250);
    });
  } catch (error) {
    console.error(error);
    alert("Não foi possível gerar o JPEG. Verifique se há imagens muito grandes e tente novamente.");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }
}

function executiveJpegFileBase(company) {
  const safeCompany = sanitizeFileName(String(company || "SEM EMPRESA").trim().toUpperCase()) || "SEM EMPRESA";
  return `CRONOGRAMA DE AÇÕES - ${safeCompany}`;
}

async function buildExecutiveJpegPages(plan) {
  const data = plan.data || { meta: {}, actions: [], equipment: [], trainings: [] };
  const preparedPlan = {
    ...plan,
    data: await prepareJpegExportData(data)
  };
  const pages = [
    await buildJpegSectionPage(preparedPlan, "Cronograma de ações e ações", "JPEG 1 - CRONOGRAMA DE AÇÕES E AÇÕES", drawJpegActionsPage),
    await buildJpegSectionPage(preparedPlan, "Equipamento de emergência e treinamentos", "JPEG 2 - EQUIPAMENTO DE EMERGÊNCIA E TREINAMENTOS", drawJpegEquipmentTrainingPage)
  ];

  return pages;
}

async function prepareJpegExportData(data) {
  const actions = await Promise.all((data.actions || []).map(async row => ({
    ...row,
    _jpegAction: await richContentForJpeg(row.actionHtml),
    _jpegObservation: await richContentForJpeg(row.observationHtml, { imagePlaceholder: false })
  })));
  const equipment = await Promise.all((data.equipment || []).map(async row => ({
    ...row,
    _jpegDescription: await richContentForJpeg(row.descriptionHtml),
    _jpegObservation: await richContentForJpeg(row.observationHtml, { imagePlaceholder: false })
  })));
  const trainings = await Promise.all((data.trainings || []).map(async row => ({
    ...row,
    _jpegTraining: await richContentForJpeg(row.trainingHtml),
    _jpegObservation: await richContentForJpeg(row.observationHtml, { imagePlaceholder: false })
  })));

  return { ...data, actions, equipment, trainings };
}

async function richContentForJpeg(value, options = {}) {
  const rich = richContentForPdf(value, options);
  const items = await loadJpegEvidenceImages(rich.images.map(src => ({ src })));
  return {
    text: rich.text,
    images: items.filter(item => item.image).map(item => item.image)
  };
}

async function buildJpegSectionPage(plan, title, fileSuffix, drawBody) {
  const width = 1600;
  const measureCanvas = document.createElement("canvas");
  measureCanvas.width = width;
  const measureCtx = measureCanvas.getContext("2d");
  const height = Math.min(Math.max(1100, drawJpegSection(measureCtx, plan, title, drawBody, { measureOnly: true })), 30000);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  drawJpegSection(ctx, plan, title, drawBody);
  return {
    blob: await canvasToJpegBlob(canvas, 0.92),
    fileSuffix
  };
}

function drawJpegSection(ctx, plan, sectionTitle, drawBody, options = {}) {
  const measureOnly = !!options.measureOnly;
  const width = 1600;
  const margin = 64;
  const contentWidth = width - margin * 2;
  const data = plan.data || { meta: {}, actions: [], equipment: [], trainings: [] };
  const meta = data.meta || {};
  const stats = getExecutiveStats(plan);
  const company = meta.company || plan.company || "-";
  const documentName = meta.documentName || plan.documentType || "-";
  const generatedAt = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  let y = margin;

  if (!measureOnly) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, ctx.canvas.height);
    ctx.fillStyle = "#2563eb";
    canvasRoundRect(ctx, margin, y, 74, 74, 12, true);
    ctx.fillStyle = "#0f172a";
    ctx.font = "900 34px Segoe UI, Arial, sans-serif";
    ctx.fillText(sectionTitle, margin + 96, y + 30);
    ctx.font = "700 17px Segoe UI, Arial, sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText(`CRONOGRAMA DE AÇÕES SST | Gerado em ${generatedAt}`, margin + 96, y + 58);
  }
  y += 106;

  y = drawJpegMetaGrid(ctx, [
    ["Empresa", company],
    ["Documento", documentName],
    ["Criação / Revisão", meta.revisionDate || "-"],
    ["Plano", plan.title || "-"]
  ], margin, y, contentWidth, measureOnly);

  y = drawBody(ctx, y + 20, measureOnly, { data, meta, stats, margin, contentWidth, width, plan });

  if (!measureOnly) drawJpegSectionFooter(ctx, width, margin);
  return y + 90;
}

function drawJpegActionsPage(ctx, y, measureOnly, context) {
  const { data, meta, stats, margin, contentWidth } = context;
  y = drawJpegDescription(ctx, richContentForPdf(meta.description || DEFAULT_DESCRIPTION).text, margin, y + 20, contentWidth, measureOnly);
  y = drawJpegSummary(ctx, stats, margin, y + 18, contentWidth, measureOnly);
  return drawJpegTable(ctx, "Ações", [
    ["Item", "Ação recomendada", "Responsável", "Quando", "Prioridade", "Status", "Observação"],
    ...(data.actions || []).map((row, index) => [
      String(index + 1),
      jpegCellFromRich(row._jpegAction || richContentForPdf(row.actionHtml)),
      row.responsible || "-",
      row.when || "-",
      row.priority || "-",
      row.status || "-",
      jpegCellFromRich(row._jpegObservation || richContentForPdf(row.observationHtml, { imagePlaceholder: false }))
    ])
  ], margin, y + 18, [66, 484, 160, 178, 132, 154, 298], measureOnly);
}

function drawJpegEquipmentTrainingPage(ctx, y, measureOnly, context) {
  const { data, margin } = context;
  y = drawJpegTable(ctx, "Equipamentos de Emergência", [
    ["Item", "Descrição", "Responsável", "Status", "Observação"],
    ...(data.equipment || []).map((row, index) => [
      String(index + 1),
      jpegCellFromRich(row._jpegDescription || richContentForPdf(row.descriptionHtml)),
      row.responsible || "-",
      row.status || "-",
      jpegCellFromRich(row._jpegObservation || richContentForPdf(row.observationHtml, { imagePlaceholder: false }))
    ])
  ], margin, y + 18, [66, 620, 220, 170, 392], measureOnly);

  return drawJpegTable(ctx, "Treinamentos", [
    ["Item", "Treinamento", "Responsável", "Quando", "Status", "Observação"],
    ...(data.trainings || []).map((row, index) => [
      String(index + 1),
      jpegCellFromRich(row._jpegTraining || richContentForPdf(row.trainingHtml)),
      row.responsible || "-",
      row.when || "-",
      row.status || "-",
      jpegCellFromRich(row._jpegObservation || richContentForPdf(row.observationHtml, { imagePlaceholder: false }))
    ])
  ], margin, y + 18, [66, 470, 210, 220, 170, 332], measureOnly);
}

function drawJpegSectionFooter(ctx, width, margin) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, ctx.canvas.height - 66, width, 66);
  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(margin, ctx.canvas.height - 66);
  ctx.lineTo(width - margin, ctx.canvas.height - 66);
  ctx.stroke();
  ctx.fillStyle = "#64748b";
  ctx.font = "700 14px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("SATS - Exportação JPEG por seção", margin, ctx.canvas.height - 34);
  ctx.textAlign = "right";
  ctx.fillText("Acompanhamento interno", width - margin, ctx.canvas.height - 34);
  ctx.textAlign = "left";
}

function drawJpegMetaGrid(ctx, items, x, y, width, measureOnly) {
  const gap = 14;
  const boxWidth = (width - gap * 3) / 4;
  const boxHeight = 88;
  items.forEach((item, index) => {
    const bx = x + index * (boxWidth + gap);
    if (!measureOnly) {
      ctx.fillStyle = "#f8fafc";
      ctx.strokeStyle = "#cbd5e1";
      canvasRoundRect(ctx, bx, y, boxWidth, boxHeight, 10, true, true);
      ctx.fillStyle = "#64748b";
      ctx.font = "800 13px Segoe UI, Arial, sans-serif";
      ctx.fillText(String(item[0] || "").toUpperCase(), bx + 16, y + 27);
      ctx.fillStyle = "#0f172a";
      ctx.font = "800 20px Segoe UI, Arial, sans-serif";
      drawCanvasTextBlock(ctx, String(item[1] || "-"), bx + 16, y + 57, boxWidth - 32, 23, 2);
    }
  });
  return y + boxHeight;
}

function drawJpegDescription(ctx, text, x, y, width, measureOnly) {
  const lineHeight = 23;
  ctx.font = "600 17px Segoe UI, Arial, sans-serif";
  const lines = wrapCanvasText(ctx, text, width - 34).slice(0, 6);
  const height = Math.max(76, lines.length * lineHeight + 34);
  if (!measureOnly) {
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#cbd5e1";
    canvasRoundRect(ctx, x, y, width, height, 10, true, true);
    ctx.fillStyle = "#334155";
    drawCanvasTextBlock(ctx, text, x + 17, y + 29, width - 34, lineHeight, 6);
  }
  return y + height;
}

function drawJpegSummary(ctx, stats, x, y, width, measureOnly) {
  const items = [
    ["Total de Ações", stats.total, "#eff6ff", "#1d4ed8"],
    ["Não Iniciadas", stats.notStarted, "#f1f5f9", "#475569"],
    ["Em Andamento", stats.inProgress, "#dbeafe", "#1e40af"],
    ["Concluídas", stats.done, "#dcfce7", "#166534"],
    ["Progresso Geral", `${stats.progress}%`, "#ecfdf5", "#15803d"],
    ["Alta Prioridade", stats.highOpen, "#fee2e2", "#991b1b"]
  ];
  const gap = 12;
  const cardWidth = (width - gap * (items.length - 1)) / items.length;
  const height = 98;
  items.forEach((item, index) => {
    const cx = x + index * (cardWidth + gap);
    if (!measureOnly) {
      ctx.fillStyle = item[2];
      ctx.strokeStyle = "#cbd5e1";
      canvasRoundRect(ctx, cx, y, cardWidth, height, 10, true, true);
      ctx.fillStyle = item[3];
      ctx.font = "900 30px Segoe UI, Arial, sans-serif";
      ctx.fillText(String(item[1]), cx + 16, y + 45);
      ctx.font = "800 13px Segoe UI, Arial, sans-serif";
      drawCanvasTextBlock(ctx, item[0], cx + 16, y + 72, cardWidth - 32, 16, 2);
    }
  });
  return y + height;
}

function jpegCellFromRich(rich) {
  const images = (rich && rich.images ? rich.images : []).filter(image => image && typeof image === "object" && "naturalWidth" in image);
  if (!rich || !images.length) return rich && rich.text ? rich.text : "-";
  return {
    content: rich.text === "-" ? "" : rich.text,
    images
  };
}

function jpegCellText(cell) {
  return cell && typeof cell === "object" && !Array.isArray(cell) && "content" in cell ? cell.content : cell;
}

function jpegCellImages(cell) {
  return cell && typeof cell === "object" && !Array.isArray(cell) && Array.isArray(cell.images) ? cell.images : [];
}

function jpegCellDisplayText(cell) {
  const text = jpegCellText(cell);
  if ((!text || text === "-") && jpegCellImages(cell).length) return "";
  return pdfText(text);
}

function drawJpegCellImages(ctx, images, x, y, width, height) {
  if (!images.length || height <= 8) return;
  const columns = images.length > 1 ? 2 : 1;
  const gap = 8;
  const thumbWidth = (width - gap * (columns - 1)) / columns;
  const rowHeight = Math.min(92, Math.max(52, height / Math.ceil(Math.min(images.length, 4) / columns)));

  images.slice(0, 4).forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const ix = x + column * (thumbWidth + gap);
    const iy = y + row * (rowHeight + 6);
    drawImageContained(ctx, image, ix, iy, thumbWidth, rowHeight);
  });
}

function drawJpegTable(ctx, title, rows, x, y, widths, measureOnly) {
  const tableWidth = widths.reduce((sum, value) => sum + value, 0);
  const lineHeight = 20;
  const cellPadding = 12;
  const headerHeight = 42;
  let cursorY = y;
  if (!measureOnly) {
    ctx.fillStyle = "#0f172a";
    ctx.font = "900 22px Segoe UI, Arial, sans-serif";
    ctx.fillText(String(title || "").toUpperCase(), x, cursorY + 24);
  }
  cursorY += 38;
  const normalizedTitle = String(title || "").toLowerCase();
  const isActionsTable = normalizedTitle.includes("ações") || normalizedTitle.includes("acoes");
  const isEquipmentTable = normalizedTitle.includes("equip");
  const isTrainingTable = normalizedTitle.includes("trein");
  const priorityColumn = isActionsTable ? 4 : -1;
  const statusColumn = isActionsTable ? 5 : isEquipmentTable ? 3 : isTrainingTable ? 4 : -1;
  ctx.font = "600 14px Segoe UI, Arial, sans-serif";
  const rowHeights = rows.map((row, rowIndex) => {
    if (rowIndex === 0) return headerHeight;
    return Math.max(56, Math.max(...row.map((cell, index) => {
      const maxLines = index === 1 ? 8 : index === row.length - 1 ? 5 : 3;
      const displayText = jpegCellDisplayText(cell);
      const textLines = displayText ? wrapCanvasText(ctx, displayText, widths[index] - cellPadding * 2) : [];
      const imageCount = jpegCellImages(cell).length;
      const imageRows = imageCount ? Math.ceil(Math.min(imageCount, 4) / (imageCount > 1 ? 2 : 1)) : 0;
      const imageHeight = imageRows ? imageRows * 98 + 8 : 0;
      return Math.min(maxLines, textLines.length) * lineHeight + cellPadding * 2 + imageHeight;
    })));
  });
  if (!measureOnly && rows.length === 1) {
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#cbd5e1";
    canvasRoundRect(ctx, x, cursorY, tableWidth, 62, 8, true, true);
    ctx.fillStyle = "#64748b";
    ctx.font = "700 18px Segoe UI, Arial, sans-serif";
    ctx.fillText("Nenhum registro cadastrado.", x + 18, cursorY + 38);
  }
  if (rows.length === 1) return cursorY + 62;

  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex];
    let cursorX = x;
    row.forEach((cell, colIndex) => {
      const cellWidth = widths[colIndex];
      if (!measureOnly) {
        const isHeader = rowIndex === 0;
        const tone = !isHeader && (colIndex === priorityColumn ? jpegPriorityTone(cell) : colIndex === statusColumn ? jpegStatusTone(cell) : null);
        ctx.fillStyle = isHeader ? "#1e3a8a" : tone ? tone.fill : rowIndex % 2 === 0 ? "#f8fafc" : "#ffffff";
        ctx.strokeStyle = "#cbd5e1";
        ctx.fillRect(cursorX, cursorY, cellWidth, rowHeight);
        ctx.strokeRect(cursorX, cursorY, cellWidth, rowHeight);
        ctx.fillStyle = isHeader ? "#ffffff" : tone ? tone.text : "#1e293b";
        ctx.font = isHeader || tone ? "800 14px Segoe UI, Arial, sans-serif" : "600 14px Segoe UI, Arial, sans-serif";
        const maxLines = isHeader ? 2 : colIndex === 1 ? 8 : colIndex === row.length - 1 ? 5 : 3;
        const displayText = jpegCellDisplayText(cell);
        const textBlockBottom = displayText
          ? drawCanvasTextBlock(ctx, displayText, cursorX + cellPadding, cursorY + 24, cellWidth - cellPadding * 2, lineHeight, maxLines)
          : cursorY + cellPadding;
        const images = jpegCellImages(cell);
        if (images.length) {
          drawJpegCellImages(ctx, images, cursorX + cellPadding, textBlockBottom + 8, cellWidth - cellPadding * 2, rowHeight - (textBlockBottom - cursorY) - cellPadding);
        }
      }
      cursorX += cellWidth;
    });
    cursorY += rowHeight;
  });
  return cursorY;
}

function jpegPriorityTone(value) {
  if (value === "Alta") return { fill: "#fee2e2", text: "#991b1b" };
  if (value === "Média") return { fill: "#fef3c7", text: "#92400e" };
  if (value === "Baixa") return { fill: "#dcfce7", text: "#166534" };
  return null;
}

function jpegStatusTone(value) {
  if (value === "Não iniciado") return { fill: "#e2e8f0", text: "#475569" };
  if (value === "Em andamento") return { fill: "#dbeafe", text: "#1e40af" };
  if (value === "Concluído") return { fill: "#dcfce7", text: "#166534" };
  if (value === "Cancelado") return { fill: "#fee2e2", text: "#991b1b" };
  return null;
}

function wrapCanvasText(ctx, value, maxWidth) {
  const paragraphs = pdfText(value).split(/\n+/);
  const lines = [];
  paragraphs.forEach(paragraph => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      return;
    }
    let line = "";
    words.forEach(word => {
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    });
    if (line) lines.push(line);
  });
  return lines.length ? lines : ["-"];
}

function drawCanvasTextBlock(ctx, value, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const lines = wrapCanvasText(ctx, value, maxWidth).slice(0, maxLines);
  lines.forEach((line, index) => {
    const suffix = index === maxLines - 1 && wrapCanvasText(ctx, value, maxWidth).length > maxLines ? "..." : "";
    ctx.fillText(line + suffix, x, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function canvasRoundRect(ctx, x, y, width, height, radius, fill = true, stroke = false) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function drawImageContained(ctx, image, x, y, width, height) {
  const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * ratio;
  const drawHeight = image.naturalHeight * ratio;
  const dx = x + (width - drawWidth) / 2;
  const dy = y + (height - drawHeight) / 2;
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
}

function loadJpegEvidenceImages(items) {
  return Promise.all(items.map(item => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve({ ...item, image });
    image.onerror = () => resolve({ ...item, image: null });
    image.src = item.src;
  })));
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise(resolve => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
        return;
      }
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve(dataUrlToBlob(dataUrl));
    }, "image/jpeg", quality);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mime = (header.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function exportJson() {
  if (blockRestrictedAdminAccess()) return;
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "SATS",
    version: 2,
    ...app
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `planos_acao_sst_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}
