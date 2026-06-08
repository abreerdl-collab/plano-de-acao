// Criacao, edicao, selecao e imagens dos perfis.
"use strict";

async function loadTeamProfiles() {
  if (!supabaseClient || !currentUser) {
    teamProfiles = [];
    return;
  }
  const own = isRestrictedAdminUser() ? null : ensureSinglePrivateProfile();
  try {
    egressDiag("user_profiles select lista", { source: "loadTeamProfiles" });
    const { data, error } = await supabaseClient
      .from("user_profiles")
      .select("user_id, display_name, role, company, email, avatar_color, avatar_photo, updated_at")
      .order("display_name", { ascending: true });
    if (error) throw error;
    teamProfiles = (data || []).map(row => publicProfileFromRow(row));
  } catch (error) {
    console.warn("Perfis públicos indisponíveis:", error);
    teamProfiles = [];
  }
  if (own && !teamProfiles.some(profile => profile.userId === currentUser.id)) {
    teamProfiles.unshift(publicProfileFromPrivate(own));
  }
}

function publicProfileFromRow(row) {
  return {
    userId: row.user_id,
    name: row.display_name || row.email || "Usuário",
    role: row.role || "",
    company: row.company || "",
    email: row.email || "",
    avatarColor: row.avatar_color || pickColor(row.email || row.user_id),
    avatarPhoto: row.avatar_photo || "",
    updatedAt: row.updated_at || ""
  };
}

function publicProfileFromPrivate(profile) {
  return {
    userId: currentUser.id,
    name: profile.name || currentUser.email || "Meu perfil",
    role: profile.role || "",
    company: profile.company || "",
    email: currentUser.email || profile.email || "",
    avatarColor: profile.avatarColor || pickColor(currentUser.email || currentUser.id),
    avatarPhoto: profile.avatarPhoto || "",
    updatedAt: new Date().toISOString()
  };
}

async function getOwnPublicProfileRow() {
  if (!supabaseClient || !currentUser) return null;
  egressDiag("user_profiles select próprio perfil", { userId: currentUser.id });
  const { data, error } = await supabaseClient
    .from("user_profiles")
    .select("avatar_photo, avatar_color, display_name, role, company")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) {
    console.warn("Não foi possível ler o perfil público atual:", error);
    return null;
  }
  return data || null;
}

function publicProfileRowMatches(row, nextRow) {
  if (!row || !nextRow) return false;
  return String(row.display_name || "") === String(nextRow.display_name || "")
    && String(row.role || "") === String(nextRow.role || "")
    && String(row.company || "") === String(nextRow.company || "")
    && String(row.avatar_color || "") === String(nextRow.avatar_color || "")
    && String(row.avatar_photo || "") === String(nextRow.avatar_photo || "");
}

async function syncOwnPublicProfile(profile) {
  if (!supabaseClient || !currentUser || isRestrictedAdminUser()) return;
  const row = {
    user_id: currentUser.id,
    display_name: profile.name,
    role: profile.role || "",
    company: profile.company || "",
    email: currentUser.email || "",
    avatar_color: profile.avatarColor || pickColor(profile.name),
    avatar_photo: profile.avatarPhoto || "",
    updated_at: new Date().toISOString()
  };
  egressDiag("user_profiles upsert próprio perfil", { source: "syncOwnPublicProfile", userId: currentUser.id });
  const { error } = await supabaseClient
    .from("user_profiles")
    .upsert(row, { onConflict: "user_id" });
  if (error) {
    console.warn("Não foi possível salvar o perfil público:", error);
    return;
  }
  await loadTeamProfiles();
}

async function publishOwnProfileIfNeeded() {
  if (isRestrictedAdminUser()) return null;
  const profile = ensureSinglePrivateProfile();
  if (!supabaseClient || !currentUser || !profile) return profile;
  const existing = await getOwnPublicProfileRow();
  if (existing) {
    if (!profile.avatarPhoto && existing.avatar_photo) profile.avatarPhoto = existing.avatar_photo;
    if (!profile.avatarColor && existing.avatar_color) profile.avatarColor = existing.avatar_color;
    if ((!profile.role || !profile.company) && (existing.role || existing.company)) {
      profile.role = profile.role || existing.role || "";
      profile.company = profile.company || existing.company || "";
    }
  }
  const row = {
    user_id: currentUser.id,
    display_name: profile.name || (currentUser.email ? currentUser.email.split("@")[0] : "Usuário"),
    role: profile.role || "",
    company: profile.company || "",
    email: currentUser.email || "",
    avatar_color: profile.avatarColor || pickColor(currentUser.email || currentUser.id),
    avatar_photo: profile.avatarPhoto || "",
    updated_at: new Date().toISOString()
  };
  if (existing && publicProfileRowMatches(existing, row)) {
    egressDiag("publishOwnProfileIfNeeded pulou upsert sem alteração", { userId: currentUser.id });
    return profile;
  }
  egressDiag("user_profiles upsert próprio perfil", { source: "publishOwnProfileIfNeeded", userId: currentUser.id });
  const { error } = await supabaseClient
    .from("user_profiles")
    .upsert(row, { onConflict: "user_id" });
  if (error) console.warn("Perfil público ainda não disponível:", error);
  return profile;
}

function renderProfiles() {
  els.profileGrid.innerHTML = "";
  const directory = getVisibleTeamProfiles();
  if (!directory.length) {
    els.profileGrid.insertAdjacentHTML("beforeend", '<div class="empty-state">Nenhum perfil sincronizado ainda.</div>');
  }

  directory.forEach(profile => {
    const isRealProfile = !!profile.id && app.profiles.some(item => item.id === profile.id);
    const privateProfile = isRealProfile ? app.profiles.find(item => item.id === profile.id) : null;
    const card = document.createElement("article");
    card.className = "profile-card";
    card.dataset.profileId = profile.id || "";
    card.dataset.profileUserId = profile.userId || "";
    const foldersCount = privateProfile ? privateProfile.folders.length : "-";
    const plansCount = privateProfile ? privateProfile.plans.length : "-";
    const presenceUserId = profile.userId || (privateProfile ? privateProfile.userId : "") || profile.id || "";
    const isOnline = presenceUserId && onlineUserIds.has(presenceUserId);
    const lastAccessText = privateProfile && privateProfile.lastAccess ? formatDateTime(privateProfile.lastAccess) : "sem registro";
    const lastAccessHtml = isOnline ? "" : `<div class="last-access">Último acesso: ${escapeHtml(lastAccessText)}</div>`;
    const profileActionsHtml = isRestrictedAdminUser() ? "" : `
        <div class="profile-actions">
          <button class="button icon-only" type="button" data-profile-action="edit" title="Editar perfil" aria-label="Editar perfil">${icons.edit}</button>
        </div>
      `;
    card.innerHTML = `
      <div class="profile-top">
        ${avatarHtml(profile)}
        ${profileActionsHtml}
      </div>
      <div>
        <h2 class="profile-name">${escapeHtml(profile.name)}</h2>
        <p class="profile-role">${escapeHtml(profile.role || profile.company || "Sem função informada")}</p>
      </div>
      <div class="profile-stats">
        <div class="stat-box"><strong>${foldersCount}</strong><span>pastas</span></div>
        <div class="stat-box"><strong>${plansCount}</strong><span>planos</span></div>
      </div>
      <div class="profile-presence ${isOnline ? "is-online" : "is-offline"}"><span class="presence-dot"></span><span>Status: ${isOnline ? "Online" : "Offline"}</span></div>
      ${lastAccessHtml}
    `;
    els.profileGrid.appendChild(card);
  });

  if (currentUser && !isRestrictedAdminUser() && !currentUserOwnProfile()) {
    const createCard = document.createElement("button");
    createCard.className = "new-profile-card";
    createCard.type = "button";
    createCard.innerHTML = '<span class="plus">+</span><strong>Criar meu perfil</strong>';
    createCard.addEventListener("click", createCurrentUserProfile);
    els.profileGrid.appendChild(createCard);
  }

}

function currentUserOwnProfile() {
  if (!currentUser) return null;
  if (isRestrictedAdminUser()) return null;
  const email = normalizeText(currentUser.email || "");
  return app.profiles.find(profile => {
    if (profile.userId && app.hiddenUserProfileIds.includes(profile.userId)) return false;
    return profile.userId === currentUser.id
      || profile.id === currentUser.id
      || (email && normalizeText(profile.email || "") === email);
  }) || null;
}

function updateOwnLastAccess() {
  const profile = currentUserOwnProfile();
  if (!profile) return null;
  profile.lastAccess = new Date().toISOString();
  dirtyProfileIds.add(profile.id);
  return profile;
}

async function createCurrentUserProfile() {
  if (!currentUser) return;
  if (blockRestrictedAdminAccess()) return;
  app.hiddenUserProfileIds = app.hiddenUserProfileIds.filter(userId => userId !== currentUser.id);
  const profile = ensureSinglePrivateProfile();
  if (!profile) {
    alert("Não foi possível criar o perfil deste usuário. Atualize a página e tente novamente.");
    return;
  }
  profile.lastAccess = new Date().toISOString();
  app.activeProfileId = profile.id;
  app.activeFolderId = DEFAULT_FOLDER_ID;
  app.activePlanId = null;
  app.view = "folders";
  await syncOwnPublicProfile(profile);
  recordActivity("Criou perfil", `Perfil criado para ${profile.email || profile.name}.`, { profile });
  saveApp({ profileId: profile.id, hiddenRemove: currentUser.id });
  await flushCloudSave();
  renderApp();
}

function getVisibleTeamProfiles() {
  const profileCards = app.profiles
    .filter(profile => !isRestrictedAdminEmail(profile.email) && (!profile.userId || !app.hiddenUserProfileIds.includes(profile.userId)))
    .map(profile => ({
    id: profile.id,
    userId: profile.userId || profile.id,
    name: profile.name,
    role: profile.role,
    company: profile.company,
    email: profile.email || "",
    avatarColor: profile.avatarColor,
    avatarPhoto: profile.avatarPhoto,
    updatedAt: profile.lastEdited || profile.createdAt
  }));
  teamProfiles.forEach(publicProfile => {
    if (!isRestrictedAdminEmail(publicProfile.email) && !app.hiddenUserProfileIds.includes(publicProfile.userId) && !profileCards.some(profile => profile.userId && profile.userId === publicProfile.userId)) {
      profileCards.push(publicProfile);
    }
  });
  return profileCards.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
}

function handleProfileGridClick(event) {
  const card = event.target.closest(".profile-card");
  if (!card) return;
  const profileId = card.dataset.profileId;
  const userId = card.dataset.profileUserId;
  const action = event.target.closest("[data-profile-action]");
  if (action) {
    event.stopPropagation();
    if (blockRestrictedAdminAccess()) return;
    requirePasswordForProfileAction(action.dataset.profileAction, profileId || userId);
    return;
  }
  warnRestrictedAdminAccess();
  const profile = getOrCreateSharedProfile(profileId, userId);
  app.activeProfileId = profile.id;
  app.activeFolderId = DEFAULT_FOLDER_ID;
  app.view = "folders";
  recordActivity("Acessou perfil", `Abriu o perfil ${profile.name}.`, { profile });
  saveApp({ localOnly: true });
  renderApp();
}

function getOrCreateSharedProfile(profileId, userId) {
  let profile = app.profiles.find(item => item.id === profileId) || app.profiles.find(item => item.userId && item.userId === userId);
  if (profile) return profile;
  const publicProfile = teamProfiles.find(item => item.userId === userId) || {};
  profile = normalizeProfile({
    id: userId || createId(),
    userId: userId || "",
    name: publicProfile.name || "Perfil",
    role: publicProfile.role || "",
    company: publicProfile.company || "",
    email: publicProfile.email || "",
    avatarColor: publicProfile.avatarColor || pickColor(publicProfile.email || publicProfile.name || ""),
    avatarPhoto: publicProfile.avatarPhoto || "",
    createdAt: new Date().toISOString(),
    lastAccess: "",
    folders: [createDefaultFolder()],
    plans: []
  });
  app.profiles.push(profile);
  saveApp({ profileId: profile.id });
  return profile;
}

function requirePasswordForProfileAction(action, profileId) {
  if (blockRestrictedAdminAccess()) return;
  const profile = app.profiles.find(item => item.id === profileId) || getOrCreateSharedProfile(profileId, profileId);
  if (!profile.email) {
    alert("Este perfil não tem e-mail vinculado. Edite o perfil e vincule um e-mail antes de proteger por senha.");
    return;
  }
  pendingProtectedAction = { action, profileId: profile.id };
  document.getElementById("switchUserTitle").textContent = action === "delete" ? "Confirmar exclusão" : "Confirmar edição";
  document.getElementById("switchUserEmailInput").value = profile.email || "";
  document.getElementById("switchUserPasswordInput").value = "";
  setSwitchUserMessage(`Digite a senha do perfil ${profile.name} para continuar.`, "");
  openModal("switchUserModal");
  setTimeout(() => document.getElementById("switchUserPasswordInput").focus(), 30);
}

function openProfileModal(profileId) {
  if (blockRestrictedAdminAccess()) return;
  const profile = profileId ? app.profiles.find(item => item.id === profileId) : null;
  document.getElementById("profileModalTitle").textContent = profile ? "Editar Perfil" : "Configurar Perfil";
  document.getElementById("profileIdInput").value = profile ? profile.id : "";
  document.getElementById("profileNameInput").value = profile ? profile.name : "";
  document.getElementById("profileRoleInput").value = profile ? profile.role : "";
  document.getElementById("profileCompanyInput").value = profile ? profile.company : "";
  document.getElementById("profileEmailDisplayInput").value = profile ? profile.email || "" : currentUser ? currentUser.email || "" : "";
  document.getElementById("profilePhotoInput").value = "";
  const deleteButton = document.getElementById("profileDeleteBtn");
  deleteButton.classList.toggle("hidden", !profile);
  deleteButton.dataset.profileId = profile ? profile.id : "";
  pendingProfilePhoto = profile ? profile.avatarPhoto : "";
  closeProfilePhotoAdjuster();
  selectedProfileColor = profile ? profile.avatarColor : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  renderColorPalette(els.profileColorPalette, AVATAR_COLORS, selectedProfileColor, handleProfileColorSelect);
  renderProfilePhotoPreview();
  openModal("profileModal");
  setTimeout(() => document.getElementById("profileNameInput").focus(), 30);
}

async function saveProfileFromModal(event) {
  event.preventDefault();
  if (blockRestrictedAdminAccess()) return;
  const id = document.getElementById("profileIdInput").value;
  const previousProfile = id ? deepClone(app.profiles.find(item => item.id === id) || {}) : null;
  const name = document.getElementById("profileNameInput").value.trim();
  if (!name) {
    alert("Informe o nome completo do perfil.");
    return;
  }
  const photoAdjuster = document.getElementById("profilePhotoAdjuster");
  if (profilePhotoEditor.image && photoAdjuster && !photoAdjuster.classList.contains("hidden")) {
    pendingProfilePhoto = exportProfilePhotoCrop();
    closeProfilePhotoAdjuster();
    renderProfilePhotoPreview();
  }
  const payload = {
    name,
    role: document.getElementById("profileRoleInput").value.trim(),
    company: document.getElementById("profileCompanyInput").value.trim(),
    email: document.getElementById("profileEmailDisplayInput").value.trim(),
    avatarColor: selectedProfileColor,
    avatarPhoto: pendingProfilePhoto
  };
  let savedProfile = null;
  if (id) {
    const profile = app.profiles.find(item => item.id === id);
    if (!profile) {
      alert("Perfil não encontrado. Atualize a página e tente novamente.");
      return;
    }
    Object.assign(profile, payload);
    if (currentUser && normalizeText(profile.email || "") === normalizeText(currentUser.email || "")) {
      profile.userId = currentUser.id;
    }
    savedProfile = profile;
  } else {
    savedProfile = normalizeProfile({
      id: currentUser ? currentUser.id : createId(),
      userId: currentUser ? currentUser.id : "",
      ...payload,
      createdAt: new Date().toISOString(),
      lastAccess: "",
      folders: [createDefaultFolder()],
      plans: []
    });
    app.profiles.push(savedProfile);
  }
  recordProfileActivity(previousProfile, savedProfile);
  saveApp({ profileId: savedProfile.id });
  if (savedProfile && currentUser && savedProfile.userId === currentUser.id) {
    await syncOwnPublicProfile(savedProfile);
  }
  await flushCloudSave();
  closeModal("profileModal");
  renderProfiles();
}

function recordProfileActivity(previousProfile, savedProfile) {
  if (!savedProfile) return;
  if (!previousProfile || !previousProfile.id) {
    recordActivity("Criou perfil", `Criou o perfil ${savedProfile.name}.`, { profile: savedProfile });
    return;
  }
  const changes = [];
  if (previousProfile.name !== savedProfile.name) changes.push(`nome: ${previousProfile.name || "-"} -> ${savedProfile.name || "-"}`);
  if (previousProfile.role !== savedProfile.role) changes.push("cargo/função");
  if (previousProfile.company !== savedProfile.company) changes.push("empresa/consultoria");
  if (previousProfile.avatarColor !== savedProfile.avatarColor) changes.push("cor do avatar");
  if ((previousProfile.avatarPhoto || "") !== (savedProfile.avatarPhoto || "")) {
    changes.push(savedProfile.avatarPhoto ? "foto de perfil alterada" : "foto de perfil removida");
    recordActivity(savedProfile.avatarPhoto ? "Trocou foto de perfil" : "Removeu foto de perfil", `Perfil ${savedProfile.name}.`, { profile: savedProfile });
  }
  recordActivity("Editou perfil", changes.length ? `Alterações: ${changes.join(", ")}.` : `Perfil ${savedProfile.name} salvo sem alterações visíveis.`, { profile: savedProfile });
}

async function deleteProfileFromModal() {
  if (blockRestrictedAdminAccess()) return;
  const profileId = document.getElementById("profileDeleteBtn").dataset.profileId || document.getElementById("profileIdInput").value;
  if (!profileId) return;
  const deleted = await deleteProfile(profileId);
  if (deleted) closeModal("profileModal");
}

async function deleteProfile(profileId) {
  if (blockRestrictedAdminAccess()) return false;
  const profile = app.profiles.find(item => item.id === profileId);
  if (!profile) return false;
  if (!confirm(`Excluir o perfil "${profile.name}" e todos os planos dele?`)) return false;
  recordActivity("Excluiu perfil", `Excluiu o perfil ${profile.name} com ${profile.plans.length} plano(s).`, { profile });
  if (profile.userId && !app.hiddenUserProfileIds.includes(profile.userId)) {
    app.hiddenUserProfileIds.push(profile.userId);
  }
  app.profiles = app.profiles.filter(item => item.id !== profileId);
  if (app.activeProfileId === profileId) {
    app.activeProfileId = null;
    app.activeFolderId = DEFAULT_FOLDER_ID;
    app.activePlanId = null;
    app.view = "profiles";
  }
  saveApp({ deleteProfileId: profile.id, hiddenAdd: profile.userId || "" });
  await flushCloudSave();
  renderApp();
  return true;
}

function createPhotoEditorState() {
  return {
    image: null,
    source: "",
    zoomBase: 1,
    zoomFactor: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0
  };
}

async function handleProfilePhoto(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Selecione um arquivo de imagem.");
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    await openProfilePhotoAdjuster(dataUrl);
  } catch (error) {
    console.error(error);
    alert("Não foi possível carregar a imagem. Tente outro arquivo JPEG ou PNG.");
  }
}

function renderProfilePhotoPreview() {
  const preview = document.getElementById("profilePhotoPreview");
  if (!pendingProfilePhoto) {
    preview.innerHTML = "<span>Nenhuma foto selecionada. O avatar usará as iniciais.</span>";
    return;
  }
  preview.innerHTML = `<span class="avatar small"><img src="${escapeAttr(pendingProfilePhoto)}" alt=""></span><span>Foto carregada e salva no navegador.</span><button class="button" type="button" id="adjustProfilePhoto">Ajustar foto</button><button class="button" type="button" id="removeProfilePhoto">Remover foto</button>`;
  document.getElementById("adjustProfilePhoto").addEventListener("click", () => {
    openProfilePhotoAdjuster(pendingProfilePhoto).catch(error => {
      console.error(error);
      alert("Não foi possível abrir o ajuste desta foto.");
    });
  });
  document.getElementById("removeProfilePhoto").addEventListener("click", () => {
    pendingProfilePhoto = "";
    closeProfilePhotoAdjuster();
    document.getElementById("profilePhotoInput").value = "";
    renderProfilePhotoPreview();
  });
}

async function openProfilePhotoAdjuster(source) {
  const image = await loadImageElement(source);
  profilePhotoEditor = createPhotoEditorState();
  profilePhotoEditor.image = image;
  profilePhotoEditor.source = source;
  document.getElementById("profilePhotoAdjuster").classList.remove("hidden");
  resetProfilePhotoCrop();
}

function closeProfilePhotoAdjuster() {
  const adjuster = document.getElementById("profilePhotoAdjuster");
  const canvas = document.getElementById("profilePhotoCanvas");
  if (adjuster) adjuster.classList.add("hidden");
  if (canvas) canvas.classList.remove("is-dragging");
  profilePhotoEditor = createPhotoEditorState();
}

function resetProfilePhotoCrop() {
  const state = profilePhotoEditor;
  if (!state || !state.image) return;
  state.zoomBase = Math.max(AVATAR_CANVAS_SIZE / state.image.naturalWidth, AVATAR_CANVAS_SIZE / state.image.naturalHeight);
  state.zoomFactor = 1;
  state.zoom = state.zoomBase;
  state.offsetX = (AVATAR_CANVAS_SIZE - state.image.naturalWidth * state.zoom) / 2;
  state.offsetY = (AVATAR_CANVAS_SIZE - state.image.naturalHeight * state.zoom) / 2;
  document.getElementById("profilePhotoZoomInput").value = "100";
  clampProfilePhotoCrop();
  renderProfilePhotoCrop();
}

function cancelProfilePhotoCrop() {
  document.getElementById("profilePhotoInput").value = "";
  closeProfilePhotoAdjuster();
}

function applyProfilePhotoCrop() {
  if (!profilePhotoEditor.image) return;
  pendingProfilePhoto = exportProfilePhotoCrop();
  document.getElementById("profilePhotoInput").value = "";
  closeProfilePhotoAdjuster();
  renderProfilePhotoPreview();
}

function handleProfilePhotoZoom(event) {
  const state = profilePhotoEditor;
  if (!state || !state.image) return;
  const oldZoom = state.zoom || state.zoomBase || 1;
  const focusX = AVATAR_CANVAS_SIZE / 2;
  const focusY = AVATAR_CANVAS_SIZE / 2;
  const imageFocusX = (focusX - state.offsetX) / oldZoom;
  const imageFocusY = (focusY - state.offsetY) / oldZoom;
  state.zoomFactor = Number(event.target.value || 100) / 100;
  state.zoom = state.zoomBase * state.zoomFactor;
  state.offsetX = focusX - imageFocusX * state.zoom;
  state.offsetY = focusY - imageFocusY * state.zoom;
  clampProfilePhotoCrop();
  renderProfilePhotoCrop();
}

function handleProfilePhotoPointerDown(event) {
  const state = profilePhotoEditor;
  if (!state || !state.image) return;
  event.preventDefault();
  const point = profilePhotoCanvasPoint(event);
  state.dragging = true;
  state.pointerId = event.pointerId;
  state.startX = point.x;
  state.startY = point.y;
  state.startOffsetX = state.offsetX;
  state.startOffsetY = state.offsetY;
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add("is-dragging");
}

function handleProfilePhotoPointerMove(event) {
  const state = profilePhotoEditor;
  if (!state || !state.image || !state.dragging) return;
  event.preventDefault();
  const point = profilePhotoCanvasPoint(event);
  state.offsetX = state.startOffsetX + point.x - state.startX;
  state.offsetY = state.startOffsetY + point.y - state.startY;
  clampProfilePhotoCrop();
  renderProfilePhotoCrop();
}

function handleProfilePhotoPointerUp(event) {
  const state = profilePhotoEditor;
  if (!state || !state.dragging) return;
  state.dragging = false;
  state.pointerId = null;
  event.currentTarget.classList.remove("is-dragging");
  try {
    event.currentTarget.releasePointerCapture(event.pointerId);
  } catch (error) {
    // O navegador pode liberar a captura automaticamente.
  }
}

function profilePhotoCanvasPoint(event) {
  const canvas = document.getElementById("profilePhotoCanvas");
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function clampProfilePhotoCrop() {
  const state = profilePhotoEditor;
  if (!state || !state.image) return;
  const scaledWidth = state.image.naturalWidth * state.zoom;
  const scaledHeight = state.image.naturalHeight * state.zoom;
  state.offsetX = scaledWidth <= AVATAR_CANVAS_SIZE
    ? (AVATAR_CANVAS_SIZE - scaledWidth) / 2
    : Math.min(0, Math.max(AVATAR_CANVAS_SIZE - scaledWidth, state.offsetX));
  state.offsetY = scaledHeight <= AVATAR_CANVAS_SIZE
    ? (AVATAR_CANVAS_SIZE - scaledHeight) / 2
    : Math.min(0, Math.max(AVATAR_CANVAS_SIZE - scaledHeight, state.offsetY));
}

function renderProfilePhotoCrop() {
  const state = profilePhotoEditor;
  const canvas = document.getElementById("profilePhotoCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  if (!state || !state.image) return;
  drawProfilePhotoImage(ctx, state);
  ctx.save();
  ctx.fillStyle = "rgba(15, 23, 42, 0.48)";
  ctx.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2 - 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2 - 10, 0, Math.PI * 2);
  ctx.stroke();
}

function drawProfilePhotoImage(ctx, state) {
  const width = state.image.naturalWidth * state.zoom;
  const height = state.image.naturalHeight * state.zoom;
  ctx.drawImage(state.image, state.offsetX, state.offsetY, width, height);
}

function exportProfilePhotoCrop() {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  drawProfilePhotoImage(ctx, profilePhotoEditor);
  return canvas.toDataURL("image/jpeg", 0.62);
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Imagem inválida"));
    image.src = source;
  });
}
