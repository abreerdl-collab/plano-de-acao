// Inicializacao, estado compartilhado, navegacao e eventos globais.
"use strict";

const SUPABASE_URL = "https://omyyxdjozumrlgpfexau.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mjNFpgsW0K1X_7id1RADfA_Hk-A1_7i";
const APP_VERSION = "egress-fix-2026-06-01-aba-lider";
const EGRESS_DIAG_PREFIX = "[EGRESS-DIAG]";
const SHARED_STATE_ID = "main";
const SHARED_STORAGE_KEY = "planoDeAcaoSST.shared.v1";
const SHARED_UPDATED_AT_CACHE_KEY = "planoDeAcaoSST.sharedUpdatedAt.v1";
const SYNC_LEADER_KEY = "planoDeAcaoSST.syncLeader.v1";
const PRESENCE_STORAGE_KEY = "planoDeAcaoSST.presence.v1";
const LOCAL_MIGRATION_KEY = "planoDeAcaoSST.localMerged.v1";
const STORAGE_KEY = "planoDeAcaoSST.v2";
const LEGACY_KEY = "planoDeAcaoSST.v1";
const THEME_KEY = "planoDeAcaoSST.theme.v1";
const THEME_USER_PREFIX = "planoDeAcaoSST.theme.user.";
const MAX_ACTIVITY_LOG = 500;
const RESTRICTED_ATTEMPT_ACTION = "Tentativa de acesso restrito";
const LOGGED_ACTIVITY_ACTIONS = new Set(["Excluiu perfil", "Excluiu pasta", "Excluiu plano", RESTRICTED_ATTEMPT_ACTION]);
const DEFAULT_FOLDER_ID = "default-folder";
const PRIORITIES = ["Alta", "Média", "Baixa"];
const STATUSES = ["Não iniciado", "Em andamento", "Concluído", "Cancelado"];
const DEFAULT_RESPONSIBLES = ["Empresa", "Empresa/Consultoria", "Consultoria", "RH", "SESMT", "CIPA", "Brigada", "Medicina do Trabalho"];
const AVATAR_COLORS = ["#2563eb", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#475569", "#0369a1", "#15803d"];
const FOLDER_COLORS = ["#2563eb", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#475569", "#0891b2", "#16a34a"];
const AVATAR_CANVAS_SIZE = 160;
const INACTIVITY_LOGOUT_MS = 60 * 60 * 1000;
const HIDDEN_SYNC_PAUSE_MS = 10 * 60 * 1000;
const INACTIVITY_RESET_THROTTLE_MS = 30 * 1000;
const INACTIVITY_LOG_THROTTLE_MS = 60 * 1000;
const SYNC_LEADER_TTL_MS = 45 * 1000;
const SYNC_LEADER_HEARTBEAT_MS = 15 * 1000;
const DEFAULT_DESCRIPTION = "A execução de cada uma das ações propostas configura um fator relevante para a redução dos riscos identificados, por isso deve ser considerado os responsáveis para que seja possível a aplicação de um ciclo de melhoria contínua (PDCA), onde após a realização de cada ação seja realizada uma nova análise dos riscos trabalhados e então atualizado o inventário de riscos.";
const RESTRICTED_ADMIN_EMAILS = new Set(["administrativo@protege.med.br"]);

console.info("[APP_VERSION]", APP_VERSION);

let app = createEmptyApp();
let supabaseClient = null;
let currentUser = null;
let cloudReady = false;
let isHydrating = true;
let hydrateUserPromise = null;
let hydrateUserId = "";
let saveTimer = null;
let tabInstanceId = "tab-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
let inactivityTimer = null;
let inactivityTimerResetAt = 0;
let inactivityResetLogAt = 0;
let hiddenSyncPauseTimer = null;
let hiddenAt = 0;
let inactivityLogoutInProgress = false;
let pendingSignOutMessage = "";
let authRedirectMessage = "";
let pendingPasswordRecovery = false;
let passwordRecoveryMode = false;
let restrictedAccessLogs = [];
let teamProfiles = [];
let pendingProtectedAction = null;
let syncTimer = null;
let syncLeaderTimer = null;
let realtimeChannel = null;
let lastSharedUpdatedAt = "";
let lastLocalChangeAt = 0;
let lastCloudSaveAt = 0;
let isSavingCloud = false;
let dirtyProfileIds = new Set();
let pendingProfileDeletes = new Set();
let pendingPlanDeletes = new Set();
let pendingFolderDeletes = new Set();
let pendingRowDeletes = new Set();
let pendingHiddenAdds = new Set();
let pendingHiddenRemoves = new Set();
let pendingFullSave = false;
let pendingActivityIds = new Set();
let onlineUserIds = new Set();
let selectedActions = new Set();
let draggingRow = null;
let draggingPlanId = null;
let selectedFolderForContext = null;
let selectedProfileColor = AVATAR_COLORS[0];
let selectedFolderColor = FOLDER_COLORS[0];
let pendingProfilePhoto = "";
let profilePhotoEditor = createPhotoEditorState();
let activeRichEditor = null;
let activeRichRange = null;
let selectedRichImage = null;
let richToolbarUserMoved = false;
let richToolbarDragState = null;
let selectedPortalApp = null;

const els = {
  authScreen: document.getElementById("authScreen"),
  authForm: document.getElementById("authForm"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  authMessage: document.getElementById("authMessage"),
  restrictedReadonlyBanner: document.getElementById("restrictedReadonlyBanner"),
  passwordMessage: document.getElementById("passwordMessage"),
  switchUserMessage: document.getElementById("switchUserMessage"),
  appSelectorScreen: document.getElementById("appSelectorScreen"),
  appSelectorUserEmail: document.getElementById("appSelectorUserEmail"),
  proceduresScreen: document.getElementById("proceduresScreen"),
  proceduresFrame: document.getElementById("proceduresFrame"),
  profileScreen: document.getElementById("profileScreen"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  folderScreen: document.getElementById("folderScreen"),
  editorScreen: document.getElementById("editorScreen"),
  profileGrid: document.getElementById("profileGrid"),
  activeProfileBadge: document.getElementById("activeProfileBadge"),
  folderList: document.getElementById("folderList"),
  plansGrid: document.getElementById("plansGrid"),
  selectedFolderTitle: document.getElementById("selectedFolderTitle"),
  folderSummary: document.getElementById("folderSummary"),
  planTitleInput: document.getElementById("planTitleInput"),
  saveStatus: document.getElementById("saveStatus"),
  actionsBody: document.getElementById("actionsBody"),
  equipmentBody: document.getElementById("equipmentBody"),
  trainingsBody: document.getElementById("trainingsBody"),
  searchInput: document.getElementById("searchInput"),
  priorityFilter: document.getElementById("priorityFilter"),
  statusFilter: document.getElementById("statusFilter"),
  responsibleFilter: document.getElementById("responsibleFilter"),
  selectAllActions: document.getElementById("selectAllActions"),
  selectionCount: document.getElementById("selectionCount"),
  bulkStatus: document.getElementById("bulkStatus"),
  responsibleSuggestions: document.getElementById("responsibleSuggestions"),
  profileModal: document.getElementById("profileModal"),
  folderModal: document.getElementById("folderModal"),
  planModal: document.getElementById("planModal"),
  profileColorPalette: document.getElementById("profileColorPalette"),
  folderColorPalette: document.getElementById("folderColorPalette"),
  folderContextMenu: document.getElementById("folderContextMenu"),
  richToolbar: document.getElementById("richToolbar"),
  richImageInput: document.getElementById("richImageInput")
};

const bodyBySection = {
  actions: els.actionsBody,
  equipment: els.equipmentBody,
  trainings: els.trainingsBody
};

const sectionLabels = {
  actions: "ação",
  equipment: "item",
  trainings: "treinamento"
};

const icons = {
  edit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  copy: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4c0-1 .7-2 2-2h4c1.3 0 2 1 2 2v2"/><path d="M19 6l-1 14c-.1 1.1-.9 2-2 2H8c-1.1 0-1.9-.9-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>'
};

function egressDiag(event, detail = {}) {
  const payload = { at: new Date().toISOString(), ...detail };
  console.info(EGRESS_DIAG_PREFIX, event, payload);
}

function egressDiagCaller() {
  try {
    return String(new Error().stack || "")
      .split("\n")
      .slice(2, 7)
      .map(line => line.trim())
      .filter(Boolean)
      .join(" <- ");
  } catch (error) {
    return "";
  }
}

function snapshotDiag(snapshot) {
  return {
    fullSave: !!(snapshot && snapshot.fullSave),
    profiles: snapshot && snapshot.profileIds ? snapshot.profileIds.length : dirtyProfileIds.size,
    deletedProfiles: snapshot && snapshot.deletedProfileIds ? snapshot.deletedProfileIds.length : pendingProfileDeletes.size,
    deletedPlans: snapshot && snapshot.deletedPlanIds ? snapshot.deletedPlanIds.length : pendingPlanDeletes.size,
    deletedFolders: snapshot && snapshot.deletedFolderIds ? snapshot.deletedFolderIds.length : pendingFolderDeletes.size,
    deletedRows: snapshot && snapshot.deletedRows ? snapshot.deletedRows.length : pendingRowDeletes.size,
    activities: snapshot && snapshot.activityIds ? snapshot.activityIds.length : pendingActivityIds.size,
    hiddenAdds: snapshot && snapshot.hiddenAdds ? snapshot.hiddenAdds.length : pendingHiddenAdds.size,
    hiddenRemoves: snapshot && snapshot.hiddenRemoves ? snapshot.hiddenRemoves.length : pendingHiddenRemoves.size
  };
}

function bindSessionLifecycleEvents() {
  ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click", "input"].forEach(eventName => {
    document.addEventListener(eventName, () => resetInactivityTimer(), { passive: true, capture: true });
  });
}

async function init() {
  applyStoredTheme();
  bindGlobalEvents();
  bindSessionLifecycleEvents();
  renderColorPalette(els.profileColorPalette, AVATAR_COLORS, selectedProfileColor, handleProfileColorSelect);
  renderColorPalette(els.folderColorPalette, FOLDER_COLORS, selectedFolderColor, handleFolderColorSelect);
  setupSupabase();
  await handleAuthRedirectParams();
  await hydrateAuthenticatedUser();
  isHydrating = false;
  renderApp();
}

function applyStoredTheme() {
  applyTheme(readThemePreference(), { persist: false });
}

function readThemePreference() {
  try {
    const userTheme = currentUser ? localStorage.getItem(THEME_USER_PREFIX + currentUser.id) : "";
    const globalTheme = localStorage.getItem(THEME_KEY);
    const stored = userTheme || globalTheme;
    return stored === "dark" ? "dark" : "light";
  } catch (error) {
    return "light";
  }
}

function toggleThemePreference() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme, { persist: true });
}

function applyTheme(theme, options = {}) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalized;
  if (options.persist) {
    try {
      localStorage.setItem(THEME_KEY, normalized);
      if (currentUser) localStorage.setItem(THEME_USER_PREFIX + currentUser.id, normalized);
    } catch (error) {
      console.warn("Não foi possível salvar a preferência de tema:", error);
    }
    recordActivity("Alterou tema", `Tema visual alterado para ${normalized === "dark" ? "modo dark" : "modo light"}.`);
  }
  updateThemeToggle();
}

function updateThemeToggle() {
  if (!els.themeToggleBtn) return;
  const isDark = document.documentElement.dataset.theme === "dark";
  els.themeToggleBtn.classList.toggle("is-dark", isDark);
  els.themeToggleBtn.setAttribute("aria-pressed", String(isDark));
  els.themeToggleBtn.title = isDark ? "Alterar para modo claro" : "Alterar para modo escuro";
  const label = els.themeToggleBtn.querySelector("[data-theme-label]");
  if (label) label.textContent = isDark ? "Modo dark" : "Modo light";
}

function bindGlobalEvents() {
  els.authForm.addEventListener("submit", handleLogin);
  document.getElementById("forgotPasswordBtn").addEventListener("click", handleForgotPassword);
  document.getElementById("appSelectorLogoutBtn").addEventListener("click", logout);
  document.getElementById("backToAppSelectorBtn").addEventListener("click", showAppSelector);
  window.addEventListener("message", handlePortalMessage);
  document.querySelectorAll("[data-app-choice]").forEach(button => {
    button.addEventListener("click", handleAppChoice);
  });
  document.getElementById("settingsBtn").addEventListener("click", openSettingsModal);
  document.getElementById("settingsChangePasswordBtn").addEventListener("click", () => {
    closeModal("settingsModal");
    openPasswordModal();
  });
  document.getElementById("settingsLogBtn").addEventListener("click", async () => {
    if (blockRestrictedAdminAccess("Tentou consultar o log do sistema.")) return;
    closeModal("settingsModal");
    await syncSharedStateFromCloud({ force: true, allowWhileEditing: true, source: "open-log-modal" });
    await loadRestrictedAccessLogs();
    renderActivityLog();
    openModal("logModal");
  });
  document.getElementById("settingsLogoutBtn").addEventListener("click", () => {
    closeModal("settingsModal");
    logout();
  });
  document.getElementById("passwordForm").addEventListener("submit", handlePasswordChange);
  document.querySelectorAll("[data-toggle-password]").forEach(button => {
    button.addEventListener("click", togglePasswordVisibility);
  });
  document.getElementById("switchUserForm").addEventListener("submit", handleSwitchUserLogin);
  if (els.themeToggleBtn) els.themeToggleBtn.addEventListener("click", toggleThemePreference);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("logoutBtnEditor").addEventListener("click", logout);
  document.getElementById("switchProfileBtn").addEventListener("click", () => showProfiles());
  document.getElementById("newPlanBtn").addEventListener("click", openPlanModal);
  document.getElementById("newFolderBtn").addEventListener("click", () => openFolderModal());
  document.getElementById("backToFoldersBtn").addEventListener("click", () => showFolders());
  document.getElementById("profileForm").addEventListener("submit", saveProfileFromModal);
  document.getElementById("profileDeleteBtn").addEventListener("click", deleteProfileFromModal);
  document.getElementById("folderForm").addEventListener("submit", saveFolderFromModal);
  document.getElementById("planForm").addEventListener("submit", createPlanFromModal);
  document.getElementById("profilePhotoInput").addEventListener("change", handleProfilePhoto);
  document.getElementById("profilePhotoZoomInput").addEventListener("input", handleProfilePhotoZoom);
  document.getElementById("profilePhotoResetBtn").addEventListener("click", resetProfilePhotoCrop);
  document.getElementById("profilePhotoCancelBtn").addEventListener("click", cancelProfilePhotoCrop);
  document.getElementById("profilePhotoApplyBtn").addEventListener("click", applyProfilePhotoCrop);
  const photoCanvas = document.getElementById("profilePhotoCanvas");
  photoCanvas.addEventListener("pointerdown", handleProfilePhotoPointerDown);
  photoCanvas.addEventListener("pointermove", handleProfilePhotoPointerMove);
  photoCanvas.addEventListener("pointerup", handleProfilePhotoPointerUp);
  photoCanvas.addEventListener("pointercancel", handleProfilePhotoPointerUp);
  document.getElementById("refreshLogBtn").addEventListener("click", async () => {
    if (blockRestrictedAdminAccess()) return;
    await syncSharedStateFromCloud({ force: true, allowWhileEditing: true, source: "refresh-log" });
    await loadRestrictedAccessLogs();
    renderActivityLog();
  });
  document.querySelectorAll("[data-close-modal]").forEach(button => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });

  els.profileGrid.addEventListener("click", handleProfileGridClick);
  els.folderList.addEventListener("click", handleFolderClick);
  els.folderList.addEventListener("dblclick", handleFolderDoubleClick);
  els.folderList.addEventListener("contextmenu", handleFolderContext);
  els.folderList.addEventListener("dragover", handleFolderDragOver);
  els.folderList.addEventListener("dragleave", handleFolderDragLeave);
  els.folderList.addEventListener("drop", handleFolderDrop);
  els.plansGrid.addEventListener("click", handlePlanClick);
  els.plansGrid.addEventListener("change", handlePlanMove);
  els.plansGrid.addEventListener("dragstart", handlePlanDragStart);
  els.plansGrid.addEventListener("dragend", handlePlanDragEnd);
  els.folderContextMenu.addEventListener("click", handleFolderContextAction);
  document.addEventListener("click", event => {
    if (!event.target.closest("#folderContextMenu")) hideFolderContextMenu();
    if (!event.target.closest("#richToolbar") && !event.target.closest(".rich-editor")) scheduleToolbarHide();
  });

  els.planTitleInput.addEventListener("input", () => {
    if (isRestrictedAdminUser()) {
      const plan = currentPlan();
      if (plan) els.planTitleInput.value = plan.title;
      return;
    }
    const plan = currentPlan();
    if (!plan) return;
    plan.title = els.planTitleInput.value || "Plano sem nome";
    touchPlan(plan);
    saveApp();
    markSaved();
  });

  document.querySelectorAll("[data-meta]").forEach(field => {
    field.addEventListener("input", handleMetaInput);
  });

  document.getElementById("templateActionSelect").addEventListener("change", applyTemplateChoiceToCurrentPlan);
  document.getElementById("printBtn").addEventListener("click", exportExecutivePdf);
  document.getElementById("exportRtfBtn").addEventListener("click", exportExecutiveRtf);
  document.getElementById("exportJpegBtn").addEventListener("click", exportExecutiveJpeg);
  document.getElementById("exportJsonBtn").addEventListener("click", exportJson);
  document.getElementById("importJsonBtn").addEventListener("click", () => {
    if (blockRestrictedAdminAccess()) return;
    document.getElementById("importJsonInput").click();
  });
  document.getElementById("importJsonInput").addEventListener("change", importJson);
  document.querySelectorAll("[data-add-section]").forEach(button => {
    button.addEventListener("click", () => addRow(button.dataset.addSection));
  });

  [els.searchInput, els.priorityFilter, els.statusFilter, els.responsibleFilter].forEach(control => {
    control.addEventListener("input", renderEditorTables);
    control.addEventListener("change", renderEditorTables);
  });

  els.selectAllActions.addEventListener("change", toggleAllVisibleActions);
  document.getElementById("applyBulkStatus").addEventListener("click", applyBulkStatus);
  document.getElementById("deleteSelected").addEventListener("click", deleteSelectedActions);

  Object.values(bodyBySection).forEach(tbody => {
    tbody.addEventListener("input", handleTableInput);
    tbody.addEventListener("change", handleTableChange);
    tbody.addEventListener("click", handleTableClick);
    tbody.addEventListener("paste", handleRichPaste);
    tbody.addEventListener("drop", handleRichDrop);
    tbody.addEventListener("dragover", handleRichDragOver);
    tbody.addEventListener("focusin", handleRichFocus);
    tbody.addEventListener("keyup", handleRichKeyup);
    tbody.addEventListener("mouseup", handleRichMouseup);
    tbody.addEventListener("dragstart", handleRowDragStart);
    tbody.addEventListener("dragover", handleRowDragOver);
    tbody.addEventListener("drop", handleRowDrop);
    tbody.addEventListener("dragend", handleRowDragEnd);
  });

  els.richToolbar.addEventListener("mousedown", event => {
    if (!event.target.closest("select")) event.preventDefault();
  });
  els.richToolbar.addEventListener("pointerdown", handleRichToolbarDragStart);
  els.richToolbar.addEventListener("dblclick", resetRichToolbarPosition);
  els.richToolbar.addEventListener("click", handleRichToolbarClick);
  document.getElementById("richBlockSelect").addEventListener("change", applyRichBlock);
  document.getElementById("richSizeSelect").addEventListener("change", applyRichSize);
  document.getElementById("richImageBtn").addEventListener("click", () => els.richImageInput.click());
  els.richImageInput.addEventListener("change", handleRichImageUpload);
  document.addEventListener("selectionchange", updateRichToolbarPosition);
  document.addEventListener("keydown", handleGlobalDeleteImage);
  window.addEventListener("pagehide", () => {
    const ownProfile = updateOwnLastAccess();
    if (currentUser && cloudReady) recordActivity("Saiu do sistema", "Aba fechada, recarregada ou sessão encerrada.");
    if (ownProfile) saveApp({ profileId: ownProfile.id });
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveAppToCloud({ source: "pagehide" });
    stopSharedSync();
    clearSessionLifecycleTimers();
    if (supabaseClient) supabaseClient.auth.signOut();
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("storage", handleCrossTabStorage);
  window.addEventListener("focus", () => {
    if (!currentUser || !cloudReady) return;
    startSharedSync({ source: "window-focus", steal: true });
    syncSharedStateFromCloud({ source: "window-focus", force: true, allowWhileEditing: true });
  });
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    handleTabHidden();
    return;
  }
  handleTabVisible().catch(error => console.warn("Falha ao retomar sincronização:", error));
}

function handleTabHidden() {
  egressDiag("aba oculta, sync pausado", { pauseAfterMs: HIDDEN_SYNC_PAUSE_MS });
  stopSyncLeaderHeartbeat();
  const ownProfile = updateOwnLastAccess();
  if (ownProfile) {
    saveApp({ profileId: ownProfile.id });
    flushCloudSave();
  }
  if (hiddenSyncPauseTimer) clearTimeout(hiddenSyncPauseTimer);
  hiddenAt = Date.now();
  hiddenSyncPauseTimer = setTimeout(() => {
    hiddenSyncPauseTimer = null;
    if (document.visibilityState !== "hidden") return;
    egressDiag("aba oculta há 10min, realtime removido", {
      hiddenForMs: Date.now() - hiddenAt
    });
    stopSharedSync();
  }, HIDDEN_SYNC_PAUSE_MS);
}

async function handleTabVisible() {
  clearHiddenSyncPauseTimer();
  egressDiag("aba visível, sync retomado");
  if (!supabaseClient || !currentUser || inactivityLogoutInProgress) return;
  resetInactivityTimer({ force: true });
  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data.session || !data.session.user) {
    pendingSignOutMessage = "Sessão encerrada.";
    stopSharedSync();
    clearSessionLifecycleTimers();
    currentUser = null;
    cloudReady = false;
    app = createEmptyApp();
    selectedActions.clear();
    renderApp();
    setAuthMessage(pendingSignOutMessage, "");
    pendingSignOutMessage = "";
    return;
  }
  if (cloudReady) {
    startSharedSync({ source: "tab-visible", steal: true });
    await syncSharedStateFromCloud({ force: true, allowWhileEditing: true, source: "tab-visible" });
  }
}

function renderApp() {
  const showAuth = !currentUser;
  updateRestrictedAdminUi();
  els.authScreen.classList.toggle("hidden", !showAuth);
  if (showAuth) {
    selectedPortalApp = null;
    els.appSelectorScreen.classList.add("hidden");
    els.proceduresScreen.classList.add("hidden");
    els.profileScreen.classList.add("hidden");
    els.folderScreen.classList.add("hidden");
    els.editorScreen.classList.add("hidden");
    return;
  }

  const showSelector = !selectedPortalApp;
  const showProcedures = selectedPortalApp === "procedures";
  els.appSelectorScreen.classList.toggle("hidden", !showSelector);
  els.proceduresScreen.classList.toggle("hidden", !showProcedures);
  if (showSelector) {
    els.profileScreen.classList.add("hidden");
    els.folderScreen.classList.add("hidden");
    els.editorScreen.classList.add("hidden");
    hideFolderContextMenu();
    hideRichToolbar();
    renderAppSelector();
    return;
  }

  if (showProcedures) {
    els.profileScreen.classList.add("hidden");
    els.folderScreen.classList.add("hidden");
    els.editorScreen.classList.add("hidden");
    hideFolderContextMenu();
    hideRichToolbar();
    return;
  }

  enforceRestrictedAdminView();
  els.profileScreen.classList.toggle("hidden", app.view !== "profiles");
  els.folderScreen.classList.toggle("hidden", app.view !== "folders");
  els.editorScreen.classList.toggle("hidden", app.view !== "editor");
  hideFolderContextMenu();
  hideRichToolbar();
  if (app.view === "profiles") renderProfiles();
  if (app.view === "folders") renderFoldersScreen();
  if (app.view === "editor") renderEditor();
  updateThemeToggle();
}

function renderAppSelector() {
  els.appSelectorUserEmail.textContent = currentUser && currentUser.email
    ? `Conectado como ${currentUser.email}`
    : "Usuário conectado";
}

function handleAppChoice(event) {
  const choice = event.currentTarget.dataset.appChoice;
  if (choice === "procedures") {
    selectedPortalApp = "procedures";
    renderApp();
    return;
  }
  if (choice === "plans") {
    selectedPortalApp = "plans";
    showProfiles();
  }
}

function showAppSelector() {
  selectedPortalApp = null;
  selectedActions.clear();
  renderApp();
}

function handlePortalMessage(event) {
  if (event.source !== els.proceduresFrame.contentWindow) return;
  if (!event.data || event.data.type !== "sats:show-app-selector") return;
  showAppSelector();
}

function showProfiles() {
  app.view = "profiles";
  app.activePlanId = null;
  selectedActions.clear();
  saveApp({ localOnly: true });
  renderApp();
}

function showFolders() {
  const profile = currentProfile();
  if (!profile) return showProfiles();
  app.view = "folders";
  app.activePlanId = null;
  if (!profile.folders.some(folder => folder.id === app.activeFolderId)) app.activeFolderId = DEFAULT_FOLDER_ID;
  saveApp({ localOnly: true });
  renderApp();
}

function showEditor(planId) {
  app.activePlanId = planId;
  app.view = "editor";
  selectedActions.clear();
  saveApp({ localOnly: true });
  renderApp();
}

init();
