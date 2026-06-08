// Pastas de trabalho e organizacao dos planos.
"use strict";

function renderFoldersScreen() {
  const profile = currentProfile();
  if (!profile) return showProfiles();
  document.getElementById("newPlanBtn").classList.toggle("hidden", isRestrictedAdminUser());
  document.getElementById("newFolderBtn").classList.toggle("hidden", isRestrictedAdminUser());
  ensureDefaultFolder(profile);
  renderActiveProfile(profile);
  renderFolders(profile);
  renderPlans(profile);
}

function renderActiveProfile(profile) {
  els.activeProfileBadge.innerHTML = `
    ${avatarHtml(profile, "small")}
    <div>
      <strong>${escapeHtml(profile.name)}</strong>
      <span>${escapeHtml(profile.role || profile.company || "Perfil ativo")}</span>
    </div>
  `;
}

function renderFolders(profile) {
  els.folderList.innerHTML = "";
  profile.folders.forEach(folder => {
    const count = profile.plans.filter(plan => plan.folderId === folder.id).length;
    const item = document.createElement("div");
    item.className = "folder-item" + (folder.id === app.activeFolderId ? " is-active" : "");
    item.dataset.folderId = folder.id;
    item.innerHTML = `
      <span class="folder-dot" style="background:${escapeAttr(folder.color)}"></span>
      <span class="folder-name" data-folder-name>${escapeHtml(folder.name)}</span>
      <span class="folder-count">${count}</span>
    `;
    els.folderList.appendChild(item);
  });
}

function renderPlans(profile) {
  const folder = getActiveFolder(profile);
  const plans = profile.plans.filter(plan => plan.folderId === folder.id);
  els.selectedFolderTitle.textContent = folder.name;
  els.folderSummary.textContent = `${plans.length} plano${plans.length === 1 ? "" : "s"} nesta pasta`;
  els.plansGrid.innerHTML = "";
  if (!plans.length) {
    els.plansGrid.innerHTML = '<div class="empty-state">Nenhum plano nesta pasta. Crie um novo plano ou arraste planos de outra pasta.</div>';
    return;
  }
  plans.forEach(plan => {
    const stats = getPlanStats(plan);
    const readOnly = isRestrictedAdminUser();
    const card = document.createElement("article");
    card.className = "plan-card";
    card.dataset.planId = plan.id;
    card.draggable = !readOnly;
    const planActionsHtml = readOnly
      ? '<button class="button primary" type="button" data-plan-action="open">Abrir</button>'
      : `
        <button class="button primary" type="button" data-plan-action="open">Abrir</button>
        <button class="button" type="button" data-plan-action="duplicate">Duplicar</button>
        <select data-plan-move aria-label="Mover para pasta">
          <option value="">Mover para pasta...</option>
          ${profile.folders.map(folder => `<option value="${escapeAttr(folder.id)}">${escapeHtml(folder.name)}</option>`).join("")}
        </select>
        <button class="button danger" type="button" data-plan-action="delete">Excluir</button>
      `;
    card.innerHTML = `
      <div>
        <h3 class="plan-title">${escapeHtml(plan.title)}</h3>
        <div class="plan-meta">
          <span>Empresa: ${escapeHtml(plan.company || "-")}</span>
          <span>Documento: ${escapeHtml(plan.documentType || "-")}</span>
          <span>Criado: ${escapeHtml(formatDateTime(plan.createdAt))}</span>
          <span>Última edição: ${escapeHtml(formatDateTime(plan.updatedAt))}</span>
        </div>
      </div>
      <div>
        <div class="badge-row" style="justify-content:space-between">
          <strong>${stats.progress}% concluído</strong>
        </div>
        <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${stats.progress}%;background:${progressColor(stats.progress)}"></div></div>
      </div>
      <div class="badge-row">
        <span class="mini-badge badge-not-started">${stats.notStarted} não iniciadas</span>
        <span class="mini-badge badge-progress">${stats.inProgress} em andamento</span>
        <span class="mini-badge badge-done">${stats.done} concluídas</span>
      </div>
      <div class="plan-actions">
        ${planActionsHtml}
      </div>
    `;
    els.plansGrid.appendChild(card);
  });
}

function handleFolderClick(event) {
  const item = event.target.closest(".folder-item");
  if (!item || event.target.closest("[contenteditable='true']")) return;
  warnRestrictedAdminAccess();
  app.activeFolderId = item.dataset.folderId;
  saveApp({ localOnly: true });
  renderFoldersScreen();
}

function handleFolderDoubleClick(event) {
  if (blockRestrictedAdminAccess()) return;
  const nameEl = event.target.closest("[data-folder-name]");
  const item = event.target.closest(".folder-item");
  if (!nameEl || !item) return;
  if (item.dataset.folderId === DEFAULT_FOLDER_ID) return;
  enableInlineFolderRename(nameEl, item.dataset.folderId);
}

function enableInlineFolderRename(nameEl, folderId) {
  const profile = currentProfile();
  const folder = profile.folders.find(item => item.id === folderId);
  if (!folder) return;
  const oldName = folder.name;
  nameEl.contentEditable = "true";
  nameEl.focus();
  selectElementText(nameEl);
  const finish = () => {
    nameEl.contentEditable = "false";
    const name = nameEl.textContent.trim();
    if (name) folder.name = name;
    if (folder.name !== oldName) recordActivity("Renomeou pasta", `Pasta ${oldName} alterada para ${folder.name}.`, { profile });
    saveApp();
    renderFoldersScreen();
  };
  nameEl.addEventListener("blur", finish, { once: true });
  nameEl.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      nameEl.blur();
    }
    if (event.key === "Escape") {
      nameEl.textContent = folder.name;
      nameEl.blur();
    }
  });
}

function handleFolderContext(event) {
  if (blockRestrictedAdminAccess()) return;
  const item = event.target.closest(".folder-item");
  if (!item) return;
  event.preventDefault();
  selectedFolderForContext = item.dataset.folderId;
  els.folderContextMenu.style.left = event.clientX + "px";
  els.folderContextMenu.style.top = event.clientY + "px";
  els.folderContextMenu.classList.remove("hidden");
}

function handleFolderContextAction(event) {
  if (blockRestrictedAdminAccess()) return;
  const action = event.target.dataset.folderContext;
  if (!action || !selectedFolderForContext) return;
  hideFolderContextMenu();
  if (action === "rename") openFolderModal(selectedFolderForContext);
  if (action === "duplicate") duplicateFolder(selectedFolderForContext);
  if (action === "delete") deleteFolder(selectedFolderForContext);
}

function hideFolderContextMenu() {
  els.folderContextMenu.classList.add("hidden");
}

function handleFolderDragOver(event) {
  if (isRestrictedAdminUser()) return;
  const item = event.target.closest(".folder-item");
  if (!item || !draggingPlanId) return;
  event.preventDefault();
  item.classList.add("is-drop-target");
}

function handleFolderDragLeave(event) {
  const item = event.target.closest(".folder-item");
  if (item) item.classList.remove("is-drop-target");
}

function handleFolderDrop(event) {
  if (blockRestrictedAdminAccess()) return;
  const item = event.target.closest(".folder-item");
  if (!item || !draggingPlanId) return;
  event.preventDefault();
  const profile = currentProfile();
  const plan = profile.plans.find(plan => plan.id === draggingPlanId);
  if (plan) {
    const oldFolder = profile.folders.find(folder => folder.id === plan.folderId);
    const newFolder = profile.folders.find(folder => folder.id === item.dataset.folderId);
    plan.folderId = item.dataset.folderId;
    touchPlan(plan);
    app.activeFolderId = item.dataset.folderId;
    recordActivity("Moveu plano", `Plano ${plan.title} movido de ${oldFolder ? oldFolder.name : "-"} para ${newFolder ? newFolder.name : "-"}.`, { profile, plan });
    saveApp();
    renderFoldersScreen();
  }
}

function openFolderModal(folderId) {
  if (blockRestrictedAdminAccess()) return;
  const profile = currentProfile();
  const folder = profile && profile.folders.find(item => item.id === folderId);
  if (folder && folder.isDefault) {
    alert("A pasta padrão Sem pasta não pode ser editada.");
    return;
  }
  document.getElementById("folderModalTitle").textContent = folder ? "Editar Pasta" : "Nova Pasta";
  document.getElementById("folderIdInput").value = folder ? folder.id : "";
  document.getElementById("folderNameInput").value = folder ? folder.name : "";
  selectedFolderColor = folder ? folder.color : FOLDER_COLORS[0];
  renderColorPalette(els.folderColorPalette, FOLDER_COLORS, selectedFolderColor, handleFolderColorSelect);
  openModal("folderModal");
}

function saveFolderFromModal(event) {
  event.preventDefault();
  if (blockRestrictedAdminAccess()) return;
  const profile = currentProfile();
  if (!profile) return;
  const id = document.getElementById("folderIdInput").value;
  const name = document.getElementById("folderNameInput").value.trim();
  if (!name) return alert("Informe o nome da pasta.");
  if (id) {
    const folder = profile.folders.find(item => item.id === id);
    if (folder && !folder.isDefault) {
      const oldName = folder.name;
      folder.name = name;
      folder.color = selectedFolderColor;
      recordActivity("Editou pasta", `Pasta ${oldName} alterada para ${folder.name}.`, { profile });
    }
  } else {
    const folder = {
      id: createId(),
      name,
      color: selectedFolderColor,
      isDefault: false,
      createdAt: new Date().toISOString()
    };
    profile.folders.push(folder);
    recordActivity("Criou pasta", `Criou a pasta ${folder.name}.`, { profile });
  }
  saveApp();
  closeModal("folderModal");
  renderFoldersScreen();
}

function duplicateFolder(folderId) {
  if (blockRestrictedAdminAccess()) return;
  const profile = currentProfile();
  const folder = profile.folders.find(item => item.id === folderId);
  if (!folder) return;
  const newFolderId = createId();
  profile.folders.push({
    id: newFolderId,
    name: `${folder.name} (cópia)`,
    color: folder.color,
    isDefault: false,
    createdAt: new Date().toISOString()
  });
  const copies = profile.plans
    .filter(plan => plan.folderId === folderId)
    .map(plan => duplicatePlanObject(plan, newFolderId));
  profile.plans.push(...copies);
  app.activeFolderId = newFolderId;
  recordActivity("Duplicou pasta", `Duplicou a pasta ${folder.name} com ${copies.length} plano(s).`, { profile });
  saveApp();
  renderFoldersScreen();
}

function deleteFolder(folderId) {
  if (blockRestrictedAdminAccess()) return;
  const profile = currentProfile();
  const folder = profile.folders.find(item => item.id === folderId);
  if (!folder) return;
  if (folder.isDefault) {
    alert("A pasta padrão Sem pasta não pode ser excluída.");
    return;
  }
  if (!confirm("Excluir esta pasta? Os planos dentro dela serão movidos para Sem pasta.")) return;
  profile.plans.forEach(plan => {
    if (plan.folderId === folderId) {
      plan.folderId = DEFAULT_FOLDER_ID;
      touchPlan(plan);
    }
  });
  profile.folders = profile.folders.filter(item => item.id !== folderId);
  if (app.activeFolderId === folderId) app.activeFolderId = DEFAULT_FOLDER_ID;
  recordActivity("Excluiu pasta", `Excluiu a pasta ${folder.name}; planos movidos para Sem pasta.`, { profile });
  saveApp({ deleteFolderId: folderId });
  renderFoldersScreen();
}

function openPlanModal() {
  if (blockRestrictedAdminAccess()) return;
  const profile = currentProfile();
  if (!profile) return;
  document.getElementById("planNameInput").value = "";
  document.getElementById("planCompanyInput").value = "";
  document.getElementById("planDocumentTypeInput").value = "PGR";
  document.getElementById("planTemplateInput").value = "template";
  document.getElementById("planFolderInput").innerHTML = profile.folders.map(folder => `<option value="${escapeAttr(folder.id)}" ${folder.id === app.activeFolderId ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("");
  openModal("planModal");
  setTimeout(() => document.getElementById("planNameInput").focus(), 30);
}

function createPlanFromModal(event) {
  event.preventDefault();
  if (blockRestrictedAdminAccess()) return;
  const profile = currentProfile();
  if (!profile) return;
  const title = document.getElementById("planNameInput").value.trim();
  const company = document.getElementById("planCompanyInput").value.trim();
  const documentType = document.getElementById("planDocumentTypeInput").value;
  const folderId = document.getElementById("planFolderInput").value || DEFAULT_FOLDER_ID;
  const useTemplate = document.getElementById("planTemplateInput").value === "template";
  if (!title || !company) return alert("Informe o nome do plano e a empresa/cliente.");
  const now = new Date().toISOString();
  const plan = normalizePlan({
    id: createId(),
    title,
    company,
    documentType,
    folderId,
    createdAt: now,
    updatedAt: now,
    data: createPlanData({ useTemplate, company, documentType })
  });
  profile.plans.push(plan);
  app.activeFolderId = folderId;
  closeModal("planModal");
  recordActivity("Criou plano", `Criou o plano ${plan.title} para ${plan.company || "empresa não informada"}.`, { profile, plan });
  saveApp();
  showEditor(plan.id);
}

function handlePlanClick(event) {
  const card = event.target.closest(".plan-card");
  if (!card) return;
  const action = event.target.closest("[data-plan-action]");
  if (!action) return;
  const profile = currentProfile();
  const plan = profile.plans.find(item => item.id === card.dataset.planId);
  if (!plan) return;
  if (action.dataset.planAction === "open") {
    warnRestrictedAdminAccess();
    recordActivity("Abriu plano", `Abriu o plano ${plan.title}.`, { profile, plan });
    showEditor(plan.id);
    return;
  }
  if (blockRestrictedAdminAccess()) return;
  if (action.dataset.planAction === "duplicate") {
    const copy = duplicatePlanObject(plan, plan.folderId);
    profile.plans.push(copy);
    recordActivity("Duplicou plano", `Duplicou o plano ${plan.title}.`, { profile, plan: copy });
    saveApp();
    renderFoldersScreen();
  }
  if (action.dataset.planAction === "delete") {
    if (!confirm("Excluir este plano de ação?")) return;
    recordActivity("Excluiu plano", `Excluiu o plano ${plan.title}.`, { profile, plan });
    profile.plans = profile.plans.filter(item => item.id !== plan.id);
    saveApp({ deletePlanId: plan.id });
    renderFoldersScreen();
  }
}

function handlePlanMove(event) {
  if (blockRestrictedAdminAccess()) return;
  const select = event.target.closest("[data-plan-move]");
  if (!select || !select.value) return;
  const card = select.closest(".plan-card");
  const profile = currentProfile();
  const plan = profile.plans.find(item => item.id === card.dataset.planId);
  if (plan) {
    const oldFolder = profile.folders.find(folder => folder.id === plan.folderId);
    const newFolder = profile.folders.find(folder => folder.id === select.value);
    plan.folderId = select.value;
    touchPlan(plan);
    recordActivity("Moveu plano", `Plano ${plan.title} movido de ${oldFolder ? oldFolder.name : "-"} para ${newFolder ? newFolder.name : "-"}.`, { profile, plan });
    saveApp();
    renderFoldersScreen();
  }
}

function handlePlanDragStart(event) {
  if (isRestrictedAdminUser()) {
    event.preventDefault();
    return;
  }
  const card = event.target.closest(".plan-card");
  if (!card) return;
  draggingPlanId = card.dataset.planId;
  card.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggingPlanId);
}

function handlePlanDragEnd() {
  draggingPlanId = null;
  document.querySelectorAll(".plan-card.is-dragging").forEach(card => card.classList.remove("is-dragging"));
  document.querySelectorAll(".folder-item.is-drop-target").forEach(item => item.classList.remove("is-drop-target"));
}

function duplicatePlanObject(plan, folderId) {
  const copy = deepClone(plan);
  copy.id = createId();
  copy.title = `${plan.title} (cópia)`;
  copy.folderId = folderId;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = new Date().toISOString();
  ["actions", "equipment", "trainings"].forEach(section => {
    copy.data[section].forEach(row => {
      row.id = createId();
      row.lastEdited = new Date().toISOString();
    });
  });
  return copy;
}
