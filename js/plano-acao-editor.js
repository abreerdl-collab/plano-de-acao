// Tabelas, linhas, rich text e interacoes do editor.
"use strict";

function renderEditorTables() {
  const data = currentPlanData();
  if (!data) return;
  renderSection("actions");
  renderSection("equipment");
  renderSection("trainings");
  renderDashboard();
  updateSelectionUi();
  renderResponsibleControls();
}

function renderSection(section) {
  const rows = currentPlanData()[section];
  const tbody = bodyBySection[section];
  tbody.innerHTML = "";
  const filteredRows = rows.filter(row => matchesFilters(row, section));
  if (!filteredRows.length) {
    const colspan = section === "actions" ? 8 : section === "equipment" ? 6 : 7;
    tbody.innerHTML = `<tr><td class="empty-row" colspan="${colspan}">Nenhum registro encontrado com os filtros atuais.</td></tr>`;
    return;
  }
  filteredRows.forEach(row => {
    const index = rows.findIndex(item => item.id === row.id) + 1;
    tbody.appendChild(createRow(section, row, index));
  });
}

function createRow(section, row, index) {
  const tr = document.createElement("tr");
  tr.dataset.section = section;
  tr.dataset.id = row.id;
  tr.draggable = false;
  tr.innerHTML = section === "actions" ? actionRowHtml(row, index) : section === "equipment" ? equipmentRowHtml(row, index) : trainingRowHtml(row, index);
  return tr;
}

function itemCellHtml(row, index, selectable) {
  const readOnly = isRestrictedAdminUser();
  const checkbox = selectable && !readOnly ? `<input class="row-check" type="checkbox" data-select-row ${selectedActions.has(row.id) ? "checked" : ""} aria-label="Selecionar item ${index}">` : "";
  const dragHandle = readOnly ? "" : '<button class="drag-handle" type="button" draggable="true" data-drag-handle title="Arrastar para reordenar" aria-label="Arrastar para reordenar">&#8942;</button>';
  return `
    <div class="item-cell ${selectable ? "" : "no-checkbox"}">
      ${checkbox}
      ${dragHandle}
      <span class="item-number">${index}</span>
    </div>
  `;
}

function richEditorHtml(field, value, placeholder) {
  return `<div class="rich-editor" contenteditable="${isRestrictedAdminUser() ? "false" : "true"}" spellcheck="true" data-field="${field}" data-placeholder="${escapeAttr(placeholder)}">${sanitizeRichHtml(value || "")}</div>`;
}

function actionRowHtml(row, index) {
  return `
    <td>${itemCellHtml(row, index, true)}</td>
    <td>${richEditorHtml("actionHtml", row.actionHtml, "Descreva a ação recomendada. Cole ou arraste imagens aqui.")}</td>
    <td><input class="table-input" data-field="responsible" list="responsibleSuggestions" value="${escapeAttr(row.responsible)}" ${isRestrictedAdminUser() ? "readonly" : ""}></td>
    <td>${whenCellHtml(row.when)}</td>
    <td>${selectHtml("priority", row.priority, PRIORITIES, "priority-select " + priorityClass(row.priority))}</td>
    <td>${selectHtml("status", row.status, STATUSES, "status-select " + statusClass(row.status))}</td>
    <td>${richEditorHtml("observationHtml", row.observationHtml, "Observações, evidências e imagens.")}</td>
    <td class="no-print">${rowActionButtons(row)}</td>
  `;
}

function equipmentRowHtml(row, index) {
  return `
    <td>${itemCellHtml(row, index, false)}</td>
    <td>${richEditorHtml("descriptionHtml", row.descriptionHtml, "Descreva o equipamento. Cole imagens aqui.")}</td>
    <td><input class="table-input" data-field="responsible" list="responsibleSuggestions" value="${escapeAttr(row.responsible)}" ${isRestrictedAdminUser() ? "readonly" : ""}></td>
    <td>${selectHtml("status", row.status, STATUSES, "status-select " + statusClass(row.status))}</td>
    <td>${richEditorHtml("observationHtml", row.observationHtml, "Observações e imagens.")}</td>
    <td class="no-print">${rowActionButtons(row)}</td>
  `;
}

function trainingRowHtml(row, index) {
  return `
    <td>${itemCellHtml(row, index, false)}</td>
    <td>${richEditorHtml("trainingHtml", row.trainingHtml, "Descreva o treinamento. Cole imagens aqui.")}</td>
    <td><input class="table-input" data-field="responsible" list="responsibleSuggestions" value="${escapeAttr(row.responsible)}" ${isRestrictedAdminUser() ? "readonly" : ""}></td>
    <td>${whenCellHtml(row.when)}</td>
    <td>${selectHtml("status", row.status, STATUSES, "status-select " + statusClass(row.status))}</td>
    <td>${richEditorHtml("observationHtml", row.observationHtml, "Observações e imagens.")}</td>
    <td class="no-print">${rowActionButtons(row)}</td>
  `;
}

function whenCellHtml(value) {
  const readOnly = isRestrictedAdminUser();
  return `
    <div class="when-cell">
      <div class="when-editor" contenteditable="${readOnly ? "false" : "true"}" spellcheck="true" data-field="when" data-placeholder="jan/26, jan/26-jan/27...">${escapeHtml(value || "")}</div>
      <input class="date-picker ${readOnly ? "hidden" : ""}" type="date" data-date-picker title="Selecionar data" ${readOnly ? "disabled" : ""}>
    </div>
  `;
}

function progressHtml(value) {
  const progress = clampProgress(value);
  return `
    <div class="progress-control">
      <div class="progress-input-row">
        <input class="table-input" data-field="progress" type="number" min="0" max="100" value="${progress}" ${isRestrictedAdminUser() ? "readonly" : ""}>
        <span class="percent-symbol">%</span>
      </div>
      <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width: ${progress}%; background: ${progressColor(progress)}"></div></div>
    </div>
  `;
}

function selectHtml(field, value, options, className) {
  const optionHtml = options.map(option => `<option value="${escapeAttr(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
  const disabled = isRestrictedAdminUser() ? "disabled" : "";
  if (field === "status") {
    const display = value === "Em andamento" ? "Em<br>Andamento" : escapeHtml(value || "-");
    return `
      <div class="select-shell status-shell ${statusClass(value)}">
        <span class="select-display">${display}</span>
        <select class="table-select ${className}" data-field="${field}" aria-label="${escapeAttr(value || field)}" ${disabled}>${optionHtml}</select>
      </div>
    `;
  }
  return `<select class="table-select ${className}" data-field="${field}" aria-label="${escapeAttr(value || field)}" ${disabled}>${optionHtml}</select>`;
}

function rowActionButtons(row) {
  if (isRestrictedAdminUser()) {
    return `<div class="row-actions"><div class="last-edit" title="${escapeAttr(formatDateTime(row.lastEdited))}">Editado: ${escapeHtml(formatDateTime(row.lastEdited))}</div></div>`;
  }
  return `
    <div class="row-actions">
      <button class="button icon-only" type="button" data-action="duplicate" title="Duplicar linha" aria-label="Duplicar linha">${icons.copy}</button>
      <button class="button icon-only danger" type="button" data-action="delete" title="Excluir linha" aria-label="Excluir linha">${icons.trash}</button>
      <div class="last-edit" title="${escapeAttr(formatDateTime(row.lastEdited))}">Editado: ${escapeHtml(formatDateTime(row.lastEdited))}</div>
    </div>
  `;
}

function handleTableInput(event) {
  if (isRestrictedAdminUser()) return;
  const target = event.target;
  if (target.classList && target.classList.contains("rich-editor")) {
    saveRichEditor(target);
    return;
  }
  if (target.classList && target.classList.contains("when-editor")) {
    savePlainEditor(target);
    return;
  }
  if (!target.dataset.field) return;
  const { row, section } = getRowFromElement(target);
  if (!row) return;
  const value = target.dataset.field === "progress" ? clampProgress(target.value) : target.value;
  row[target.dataset.field] = value;
  touchRowAndPlan(row);
  if (target.dataset.field === "progress") updateProgressControl(target.closest(".progress-control"), value);
  saveApp();
  renderDashboard();
  if (target.dataset.field === "responsible") renderResponsibleControls();
  if (section === "actions") updateSelectionUi();
  markSaved();
}

function handleTableChange(event) {
  if (isRestrictedAdminUser()) return;
  const target = event.target;
  if (target.dataset.selectRow !== undefined) {
    const tr = target.closest("tr");
    if (!tr) return;
    if (target.checked) selectedActions.add(tr.dataset.id);
    else selectedActions.delete(tr.dataset.id);
    updateSelectionUi();
    return;
  }

  if (target.dataset.datePicker !== undefined) {
    const input = target.closest(".when-cell").querySelector("[data-field='when']");
    if (target.value && input) {
      const formatted = formatDateFromInput(target.value);
      if (input.isContentEditable) input.textContent = formatted;
      else input.value = formatted;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    target.value = "";
    return;
  }

  if (!target.dataset.field) return;
  const { row } = getRowFromElement(target);
  if (!row) return;
  row[target.dataset.field] = target.dataset.field === "progress" ? clampProgress(target.value) : target.value;
  if (target.dataset.field === "status" && row.status === "Concluído" && "progress" in row) row.progress = 100;
  touchRowAndPlan(row);
  saveApp();
  renderEditorTables();
  markSaved();
}

function handleTableClick(event) {
  if (isRestrictedAdminUser()) return;
  const imageWrap = event.target.closest(".rt-image-wrap");
  if (imageWrap) {
    selectRichImage(imageWrap);
    return;
  }
  if (selectedRichImage && !event.target.closest(".rich-toolbar")) clearSelectedRichImage();
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { row, section } = getRowFromElement(button);
  if (!row) return;
  if (button.dataset.action === "delete") deleteRow(section, row.id);
  if (button.dataset.action === "duplicate") duplicateRow(section, row.id);
}

function saveRichEditor(editor) {
  if (isRestrictedAdminUser()) return;
  const { row } = getRowFromElement(editor);
  if (!row) return;
  const persist = () => {
    row[editor.dataset.field] = sanitizeRichHtml(editor.innerHTML);
    touchRowAndPlan(row);
    saveApp();
    renderDashboard();
    markSaved();
  };
  compressRichEditorImages(editor).then(persist).catch(error => {
    console.error(error);
    persist();
  });
}

function savePlainEditor(editor) {
  if (isRestrictedAdminUser()) return;
  const { row } = getRowFromElement(editor);
  if (!row) return;
  row[editor.dataset.field] = (editor.innerText || editor.textContent || "").replace(/\u00a0/g, " ");
  touchRowAndPlan(row);
  saveApp();
  markSaved();
}

function addRow(section) {
  if (blockRestrictedAdminAccess()) return;
  const now = new Date().toISOString();
  const base = { id: createId(), lastEdited: now, responsible: "", status: "Não iniciado", observationHtml: "" };
  const row = section === "actions"
    ? { ...base, actionHtml: "", when: "", priority: "Média", progress: 0 }
    : section === "equipment"
      ? { ...base, descriptionHtml: "" }
      : { ...base, trainingHtml: "", when: "" };
  currentPlanData()[section].push(row);
  touchPlan(currentPlan());
  recordActivity("Adicionou linha", `Adicionou ${sectionLabels[section] || "linha"} em ${currentPlan().title}.`, { plan: currentPlan() });
  saveApp();
  renderEditorTables();
  focusNewRow(section, row.id);
}

function focusNewRow(section, id) {
  requestAnimationFrame(() => {
    const row = bodyBySection[section].querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    const field = row && row.querySelector(".rich-editor, .when-editor, input");
    if (field) field.focus();
  });
}

function duplicateRow(section, id) {
  if (blockRestrictedAdminAccess()) return;
  const rows = currentPlanData()[section];
  const index = rows.findIndex(row => row.id === id);
  if (index < 0) return;
  const copy = deepClone(rows[index]);
  copy.id = createId();
  copy.lastEdited = new Date().toISOString();
  rows.splice(index + 1, 0, copy);
  touchPlan(currentPlan());
  recordActivity("Duplicou linha", `Duplicou ${sectionLabels[section] || "linha"} no plano ${currentPlan().title}.`, { plan: currentPlan() });
  saveApp();
  renderEditorTables();
}

function deleteRow(section, id) {
  if (blockRestrictedAdminAccess()) return;
  const label = sectionLabels[section] || "linha";
  if (!confirm(`Excluir esta ${label}? Esta ação não pode ser desfeita.`)) return;
  currentPlanData()[section] = currentPlanData()[section].filter(row => row.id !== id);
  selectedActions.delete(id);
  touchPlan(currentPlan());
  recordActivity("Excluiu linha", `Excluiu ${label} do plano ${currentPlan().title}.`, { plan: currentPlan() });
  saveApp({ rowDelete: { section, rowId: id } });
  renderEditorTables();
}

function handleRowDragStart(event) {
  if (isRestrictedAdminUser()) {
    event.preventDefault();
    return;
  }
  const handle = event.target.closest("[data-drag-handle]");
  if (!handle) {
    event.preventDefault();
    return;
  }
  const tr = handle.closest("tr[data-id]");
  if (!tr) return;
  draggingRow = { section: tr.dataset.section, id: tr.dataset.id };
  tr.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", tr.dataset.id);
}

function handleRowDragOver(event) {
  const tr = event.target.closest("tr[data-id]");
  if (!tr || !draggingRow || tr.dataset.section !== draggingRow.section) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function handleRowDrop(event) {
  if (blockRestrictedAdminAccess()) return;
  const tr = event.target.closest("tr[data-id]");
  if (!tr || !draggingRow || tr.dataset.section !== draggingRow.section || tr.dataset.id === draggingRow.id) return;
  event.preventDefault();
  const rows = currentPlanData()[draggingRow.section];
  const from = rows.findIndex(row => row.id === draggingRow.id);
  const to = rows.findIndex(row => row.id === tr.dataset.id);
  if (from < 0 || to < 0) return;
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  touchRowAndPlan(moved);
  saveApp();
  renderEditorTables();
}

function handleRowDragEnd() {
  document.querySelectorAll("tr.is-dragging").forEach(row => row.classList.remove("is-dragging"));
  draggingRow = null;
}

function getRowFromElement(element) {
  const tr = element.closest("tr[data-section][data-id]");
  if (!tr) return {};
  const section = tr.dataset.section;
  return { section, row: currentPlanData()[section].find(row => row.id === tr.dataset.id) };
}

function toggleAllVisibleActions() {
  if (isRestrictedAdminUser()) return;
  const visibleIds = currentPlanData().actions.filter(row => matchesFilters(row, "actions")).map(row => row.id);
  if (els.selectAllActions.checked) visibleIds.forEach(id => selectedActions.add(id));
  else visibleIds.forEach(id => selectedActions.delete(id));
  renderSection("actions");
  updateSelectionUi();
}

function applyBulkStatus() {
  if (blockRestrictedAdminAccess()) return;
  const status = els.bulkStatus.value;
  if (!status || !selectedActions.size) return;
  currentPlanData().actions.forEach(row => {
    if (selectedActions.has(row.id)) {
      row.status = status;
      if (status === "Concluído") row.progress = 100;
      touchRowAndPlan(row);
    }
  });
  recordActivity("Alterou status em lote", `${selectedActions.size} ação(ões) alteradas para ${status} no plano ${currentPlan().title}.`, { plan: currentPlan() });
  els.bulkStatus.value = "";
  saveApp();
  renderEditorTables();
}

function deleteSelectedActions() {
  if (blockRestrictedAdminAccess()) return;
  if (!selectedActions.size) return;
  if (!confirm(`Excluir ${selectedActions.size} ações selecionadas? Esta ação não pode ser desfeita.`)) return;
  const rowDeletes = Array.from(selectedActions).map(rowId => ({ section: "actions", rowId }));
  recordActivity("Excluiu ações em lote", `Excluiu ${selectedActions.size} ação(ões) selecionadas no plano ${currentPlan().title}.`, { plan: currentPlan() });
  currentPlanData().actions = currentPlanData().actions.filter(row => !selectedActions.has(row.id));
  selectedActions.clear();
  touchPlan(currentPlan());
  saveApp({ rowDeletes });
  renderEditorTables();
}

function renderDashboard() {
  const data = currentPlanData();
  const total = data.actions.length;
  const notStarted = countByStatus("Não iniciado");
  const inProgress = countByStatus("Em andamento");
  const done = countByStatus("Concluído");
  const progress = total ? Math.round((done / total) * 100) : 0;
  const highOpen = data.actions.filter(row => row.priority === "Alta" && row.status !== "Concluído" && row.status !== "Cancelado").length;

  setText("metricTotal", total);
  setText("metricNotStarted", notStarted);
  setText("metricNotStartedPct", pct(notStarted, total));
  setText("metricInProgress", inProgress);
  setText("metricInProgressPct", pct(inProgress, total));
  setText("metricDone", done);
  setText("metricDonePct", pct(done, total));
  setText("metricProgress", progress + "%");
  setText("metricHighOpen", highOpen);
  const fill = document.getElementById("metricProgressFill");
  fill.style.width = progress + "%";
  fill.style.background = progressColor(progress);
}

function countByStatus(status) {
  return currentPlanData().actions.filter(row => row.status === status).length;
}

function renderResponsibleControls() {
  const options = getResponsibleOptions();
  const current = els.responsibleFilter.value;
  els.responsibleFilter.innerHTML = '<option value="">Todos</option>' + options.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join("");
  if (options.includes(current)) els.responsibleFilter.value = current;
  els.responsibleSuggestions.innerHTML = options.map(value => `<option value="${escapeAttr(value)}"></option>`).join("");
}

function getResponsibleOptions() {
  const found = new Set(DEFAULT_RESPONSIBLES);
  const data = currentPlanData();
  if (data) {
    ["actions", "equipment", "trainings"].forEach(section => {
      data[section].forEach(row => {
        if (row.responsible && row.responsible.trim()) found.add(row.responsible.trim());
      });
    });
  }
  return [...found].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function matchesFilters(row, section) {
  const query = normalizeText(els.searchInput.value);
  const priority = els.priorityFilter.value;
  const status = els.statusFilter.value;
  const responsible = els.responsibleFilter.value;

  if (query && !normalizeText(stripHtml(Object.values(row).join(" "))).includes(query)) return false;
  if (priority && section === "actions" && row.priority !== priority) return false;
  if (status && row.status !== status) return false;
  if (responsible && row.responsible !== responsible) return false;
  return true;
}

function updateSelectionUi() {
  const data = currentPlanData();
  if (!data) return;
  selectedActions = new Set([...selectedActions].filter(id => data.actions.some(row => row.id === id)));
  const count = selectedActions.size;
  els.selectionCount.textContent = count === 1 ? "1 selecionada" : `${count} selecionadas`;
  const visibleIds = data.actions.filter(row => matchesFilters(row, "actions")).map(row => row.id);
  els.selectAllActions.checked = visibleIds.length > 0 && visibleIds.every(id => selectedActions.has(id));
  els.selectAllActions.indeterminate = visibleIds.some(id => selectedActions.has(id)) && !els.selectAllActions.checked;
}

function handleRichFocus(event) {
  if (isRestrictedAdminUser()) return;
  const editor = event.target.closest(".rich-editor");
  if (!editor) return;
  activeRichEditor = editor;
  saveRichSelection();
  showRichToolbar(editor);
}

function handleRichMouseup(event) {
  if (isRestrictedAdminUser()) return;
  const editor = event.target.closest(".rich-editor");
  if (!editor) return;
  activeRichEditor = editor;
  saveRichSelection();
  showRichToolbar(editor);
}

function handleRichKeyup(event) {
  if (isRestrictedAdminUser()) return;
  const editor = event.target.closest(".rich-editor");
  if (!editor) return;
  activeRichEditor = editor;
  saveRichSelection();
  showRichToolbar(editor);
}

function handleRichPaste(event) {
  if (isRestrictedAdminUser()) {
    event.preventDefault();
    return;
  }
  const plainEditor = event.target.closest(".when-editor");
  if (plainEditor) {
    event.preventDefault();
    const text = event.clipboardData ? event.clipboardData.getData("text/plain") : "";
    document.execCommand("insertText", false, text);
    setTimeout(() => savePlainEditor(plainEditor), 0);
    return;
  }
  const editor = event.target.closest(".rich-editor");
  if (!editor) return;
  const items = event.clipboardData && event.clipboardData.items ? [...event.clipboardData.items] : [];
  const imageItem = items.find(item => item.type && item.type.startsWith("image/"));
  if (!imageItem) {
    setTimeout(() => saveRichEditor(editor), 0);
    return;
  }
  event.preventDefault();
  activeRichEditor = editor;
  saveRichSelection();
  const file = imageItem.getAsFile();
  insertImageFileIntoEditor(file, editor);
}

function handleRichDragOver(event) {
  if (isRestrictedAdminUser()) return;
  const editor = event.target.closest(".rich-editor");
  if (!editor) return;
  const files = event.dataTransfer && event.dataTransfer.files ? [...event.dataTransfer.files] : [];
  if (files.some(file => file.type.startsWith("image/"))) {
    event.preventDefault();
  }
}

function handleRichDrop(event) {
  if (isRestrictedAdminUser()) return;
  const editor = event.target.closest(".rich-editor");
  if (!editor) return;
  const files = event.dataTransfer && event.dataTransfer.files ? [...event.dataTransfer.files] : [];
  const imageFiles = files.filter(file => file.type.startsWith("image/"));
  if (!imageFiles.length) return;
  event.preventDefault();
  activeRichEditor = editor;
  setCaretFromPoint(event.clientX, event.clientY, editor);
  imageFiles.forEach(file => insertImageFileIntoEditor(file, editor));
}

function handleRichToolbarClick(event) {
  if (isRestrictedAdminUser()) return;
  const commandButton = event.target.closest("[data-rich-command]");
  const colorButton = event.target.closest("[data-rich-color]");
  const clearFormatButton = event.target.closest("[data-rich-clear-format]");
  const clearButton = event.target.closest("[data-rich-clear]");
  if (!activeRichEditor) return;
  restoreRichSelection();
  if (clearButton) {
    clearActiveRichEditor();
    return;
  }
  if (clearFormatButton) {
    document.execCommand("removeFormat", false, null);
    saveRichEditor(activeRichEditor);
    showRichToolbar(activeRichEditor);
    return;
  }
  if (colorButton) {
    document.execCommand("foreColor", false, colorButton.dataset.richColor);
    saveRichEditor(activeRichEditor);
    showRichToolbar(activeRichEditor);
    return;
  }
  if (commandButton) {
    document.execCommand(commandButton.dataset.richCommand, false, null);
    saveRichEditor(activeRichEditor);
    showRichToolbar(activeRichEditor);
  }
}

function clearActiveRichEditor() {
  if (isRestrictedAdminUser()) return;
  if (!activeRichEditor) return;
  if (selectedRichImage) {
    const editor = selectedRichImage.closest(".rich-editor");
    selectedRichImage.remove();
    selectedRichImage = null;
    if (editor) {
      activeRichEditor = editor;
      saveRichEditor(editor);
      showRichToolbar(editor);
    }
    return;
  }
  activeRichEditor.innerHTML = "";
  saveRichEditor(activeRichEditor);
  activeRichEditor.focus();
  showRichToolbar(activeRichEditor);
}

function applyRichSize(event) {
  if (isRestrictedAdminUser()) return;
  if (!activeRichEditor || !event.target.value) return;
  restoreRichSelection();
  document.execCommand("fontSize", false, event.target.value);
  event.target.value = "";
  saveRichEditor(activeRichEditor);
  showRichToolbar(activeRichEditor);
}

function applyRichBlock(event) {
  if (isRestrictedAdminUser()) return;
  if (!activeRichEditor || !event.target.value) return;
  restoreRichSelection();
  document.execCommand("formatBlock", false, event.target.value);
  event.target.value = "";
  saveRichEditor(activeRichEditor);
  showRichToolbar(activeRichEditor);
}

function handleRichImageUpload(event) {
  if (isRestrictedAdminUser()) {
    event.target.value = "";
    return;
  }
  const file = event.target.files && event.target.files[0];
  if (!file || !activeRichEditor) return;
  insertImageFileIntoEditor(file, activeRichEditor);
  event.target.value = "";
}

function insertImageFileIntoEditor(file, editor) {
  if (isRestrictedAdminUser()) return;
  if (!file || !file.type.startsWith("image/")) return;
  compressImageFileToDataUrl(file).then(dataUrl => {
    restoreRichSelection();
    insertHtmlAtCursor(`<span class="rt-image-wrap" contenteditable="false" style="width:260px"><img src="${escapeAttr(dataUrl)}" alt="Imagem anexada" data-sst-compressed="true"></span>&nbsp;`, editor);
    saveRichEditor(editor);
    showRichToolbar(editor);
  }).catch(error => {
    console.error(error);
    alert("Não foi possível inserir a imagem. Tente outro arquivo JPEG ou PNG.");
  });
}

function saveRichSelection() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !activeRichEditor) return;
  const range = selection.getRangeAt(0);
  if (activeRichEditor.contains(range.commonAncestorContainer)) {
    activeRichRange = range.cloneRange();
  }
}

function restoreRichSelection() {
  if (!activeRichRange || !activeRichEditor) {
    if (activeRichEditor) activeRichEditor.focus();
    return;
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(activeRichRange);
  activeRichEditor.focus();
}

function insertHtmlAtCursor(html, editor) {
  editor.focus();
  const selection = window.getSelection();
  let range = activeRichRange;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
  range.deleteContents();
  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    activeRichRange = range.cloneRange();
  }
}

function setCaretFromPoint(x, y, editor) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
    }
  }
  if (range && editor.contains(range.commonAncestorContainer)) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    activeRichRange = range.cloneRange();
  }
}

function showRichToolbar(editor) {
  if (isRestrictedAdminUser()) return;
  const rect = getSelectionRect() || editor.getBoundingClientRect();
  els.richToolbar.classList.add("is-visible");
  if (richToolbarUserMoved) {
    keepRichToolbarInViewport();
    return;
  }
  const toolbarWidth = Math.min(els.richToolbar.offsetWidth || 720, window.innerWidth - 16);
  const topOffset = window.innerWidth <= 760 ? 58 : 44;
  const top = Math.max(8, rect.top - topOffset);
  const left = Math.min(window.innerWidth - toolbarWidth - 8, Math.max(8, rect.left));
  els.richToolbar.style.top = top + "px";
  els.richToolbar.style.left = left + "px";
}

function handleRichToolbarDragStart(event) {
  const handle = event.target.closest("[data-rich-toolbar-drag]");
  if (!handle || !els.richToolbar.classList.contains("is-visible")) return;
  event.preventDefault();
  const rect = els.richToolbar.getBoundingClientRect();
  richToolbarUserMoved = true;
  richToolbarDragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    left: rect.left,
    top: rect.top
  };
  els.richToolbar.classList.add("is-dragging");
  if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
  document.addEventListener("pointermove", handleRichToolbarDragMove);
  document.addEventListener("pointerup", handleRichToolbarDragEnd, { once: true });
  document.addEventListener("pointercancel", handleRichToolbarDragEnd, { once: true });
}

function handleRichToolbarDragMove(event) {
  if (!richToolbarDragState) return;
  event.preventDefault();
  setRichToolbarPosition(
    richToolbarDragState.left + event.clientX - richToolbarDragState.startX,
    richToolbarDragState.top + event.clientY - richToolbarDragState.startY
  );
}

function handleRichToolbarDragEnd() {
  richToolbarDragState = null;
  els.richToolbar.classList.remove("is-dragging");
  document.removeEventListener("pointermove", handleRichToolbarDragMove);
  document.removeEventListener("pointerup", handleRichToolbarDragEnd);
  document.removeEventListener("pointercancel", handleRichToolbarDragEnd);
  keepRichToolbarInViewport();
}

function resetRichToolbarPosition(event) {
  if (!event.target.closest("[data-rich-toolbar-drag]")) return;
  event.preventDefault();
  richToolbarUserMoved = false;
  if (activeRichEditor) showRichToolbar(activeRichEditor);
}

function keepRichToolbarInViewport() {
  const rect = els.richToolbar.getBoundingClientRect();
  const left = Number.parseFloat(els.richToolbar.style.left) || rect.left || 8;
  const top = Number.parseFloat(els.richToolbar.style.top) || rect.top || 8;
  setRichToolbarPosition(left, top);
}

function setRichToolbarPosition(left, top) {
  const rect = els.richToolbar.getBoundingClientRect();
  const width = rect.width || els.richToolbar.offsetWidth || 320;
  const height = rect.height || els.richToolbar.offsetHeight || 42;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - height - 8);
  els.richToolbar.style.left = Math.min(maxLeft, Math.max(8, left)) + "px";
  els.richToolbar.style.top = Math.min(maxTop, Math.max(8, top)) + "px";
}

function updateRichToolbarPosition() {
  if (!activeRichEditor || !els.richToolbar.classList.contains("is-visible")) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (activeRichEditor.contains(range.commonAncestorContainer)) {
    activeRichRange = range.cloneRange();
    showRichToolbar(activeRichEditor);
  }
}

function scheduleToolbarHide() {
  setTimeout(() => {
    if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest(".rich-editor")) {
      hideRichToolbar();
    }
  }, 120);
}

function hideRichToolbar() {
  els.richToolbar.classList.remove("is-visible");
}

function getSelectionRect() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return rect && rect.width !== 0 ? rect : null;
}

function selectRichImage(wrapper) {
  if (isRestrictedAdminUser()) return;
  clearSelectedRichImage();
  selectedRichImage = wrapper;
  wrapper.classList.add("is-selected");
  activeRichEditor = wrapper.closest(".rich-editor");
  showRichToolbar(activeRichEditor);
}

function clearSelectedRichImage() {
  if (selectedRichImage) selectedRichImage.classList.remove("is-selected");
  selectedRichImage = null;
}

function handleGlobalDeleteImage(event) {
  if (isRestrictedAdminUser()) return;
  if (!selectedRichImage) return;
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  event.preventDefault();
  const editor = selectedRichImage.closest(".rich-editor");
  selectedRichImage.remove();
  selectedRichImage = null;
  if (editor) saveRichEditor(editor);
}

function applyTemplateChoiceToCurrentPlan(event) {
  if (blockRestrictedAdminAccess()) return;
  const plan = currentPlan();
  if (!plan) return;
  const choice = event.target.value;
  event.target.value = "";
  if (!choice) return;
  const useTemplate = choice === "template";
  const label = useTemplate ? "template padrão" : "plano em branco";
  if (!confirm(`Gerar ${label} e substituir os dados do plano atual?`)) return;
  plan.data = createPlanData({ useTemplate, company: plan.company, documentType: plan.documentType });
  touchPlan(plan);
  recordActivity(useTemplate ? "Carregou template" : "Gerou plano em branco", `Gerou ${label} no plano ${plan.title}.`, { plan });
  saveApp();
  renderEditor();
}
