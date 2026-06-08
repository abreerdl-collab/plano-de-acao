// Persistencia local, sincronizacao em nuvem e normalizacao de dados.
"use strict";

function readSyncLeader() {
  const raw = localStorage.getItem(SYNC_LEADER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Controle de aba lider invalido ignorado:", error);
    localStorage.removeItem(SYNC_LEADER_KEY);
    return null;
  }
}

function writeSyncLeader(reason = "heartbeat") {
  if (!currentUser) return;
  localStorage.setItem(SYNC_LEADER_KEY, JSON.stringify({
    tabId: tabInstanceId,
    userId: currentUser.id,
    updatedAt: Date.now(),
    appVersion: APP_VERSION,
    reason
  }));
}

function isFreshSyncLeader(leader, now = Date.now()) {
  return !!leader
    && !!leader.tabId
    && !!leader.userId
    && Number.isFinite(Number(leader.updatedAt))
    && now - Number(leader.updatedAt) < SYNC_LEADER_TTL_MS;
}

function isCurrentSyncLeader() {
  if (!currentUser) return false;
  const leader = readSyncLeader();
  return !!leader
    && leader.tabId === tabInstanceId
    && leader.userId === currentUser.id
    && isFreshSyncLeader(leader);
}

function ensureSyncLeader(options = {}) {
  if (!currentUser || !cloudReady) return false;
  const reason = options.reason || "unknown";
  const now = Date.now();
  const leader = readSyncLeader();
  const ownLeader = leader && leader.tabId === tabInstanceId && leader.userId === currentUser.id;
  const staleLeader = !isFreshSyncLeader(leader, now);
  const canClaim = ownLeader
    || staleLeader
    || !!options.steal
    || !leader
    || leader.userId !== currentUser.id;

  if (!canClaim || (!ownLeader && document.visibilityState !== "visible" && !options.allowHidden)) {
    egressDiag("aba secundaria sem Supabase ativo", {
      reason,
      leaderAgeMs: leader && leader.updatedAt ? now - Number(leader.updatedAt) : null,
      hasLeader: !!leader
    });
    return false;
  }

  writeSyncLeader(reason);
  startSyncLeaderHeartbeat();
  if (!ownLeader) egressDiag("aba assumiu sync Supabase", { reason, previousLeaderAgeMs: leader && leader.updatedAt ? now - Number(leader.updatedAt) : null });
  return true;
}

function startSyncLeaderHeartbeat() {
  if (syncLeaderTimer) return;
  syncLeaderTimer = setInterval(() => {
    if (!currentUser || !cloudReady || document.visibilityState !== "visible" || !isCurrentSyncLeader()) {
      stopSyncLeaderHeartbeat();
      return;
    }
    writeSyncLeader("heartbeat");
  }, SYNC_LEADER_HEARTBEAT_MS);
}

function stopSyncLeaderHeartbeat() {
  if (syncLeaderTimer) clearInterval(syncLeaderTimer);
  syncLeaderTimer = null;
}

function releaseSyncLeadership() {
  stopSyncLeaderHeartbeat();
  const leader = readSyncLeader();
  if (leader && leader.tabId === tabInstanceId) {
    localStorage.removeItem(SYNC_LEADER_KEY);
    egressDiag("lideranca de sync liberada");
  }
}

function handleCrossTabStorage(event) {
  if (!currentUser || !cloudReady) return;
  if (event.key === SYNC_LEADER_KEY) {
    const leader = readSyncLeader();
    const currentOwnsLeader = leader && leader.tabId === tabInstanceId && leader.userId === currentUser.id;
    if ((syncTimer || realtimeChannel) && !currentOwnsLeader) {
      egressDiag("outra aba assumiu sync; Supabase local removido", {
        hasLeader: !!leader
      });
      stopSharedSync({ releaseLeadership: false });
      return;
    }
    if (!leader && document.visibilityState === "visible") {
      startSharedSync({ source: "leader-released", steal: true });
    }
    return;
  }

  if (event.key === PRESENCE_STORAGE_KEY) {
    applyPresenceCacheFromAnotherTab();
    return;
  }
  if (event.key !== SHARED_STORAGE_KEY && event.key !== SHARED_UPDATED_AT_CACHE_KEY) return;
  if (isCurrentSyncLeader()) return;
  applySharedCacheFromAnotherTab();
}

function writePresenceCache() {
  if (!currentUser || !isCurrentSyncLeader()) return;
  localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify({
    updatedAt: Date.now(),
    userIds: Array.from(onlineUserIds)
  }));
}

function applyPresenceCacheFromAnotherTab() {
  if (!currentUser || !cloudReady || isCurrentSyncLeader()) return;
  const raw = localStorage.getItem(PRESENCE_STORAGE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    onlineUserIds = new Set(Array.isArray(data.userIds) ? data.userIds.filter(Boolean) : []);
    if (app.view === "profiles") renderProfiles();
  } catch (error) {
    console.warn("Cache local de presenca ignorado:", error);
  }
}

function applySharedCacheFromAnotherTab() {
  if (!currentUser || !cloudReady || hasPendingCloudChanges() || isUserEditing()) return;
  const cachedUpdatedAt = readLocalSharedUpdatedAt();
  if (cachedUpdatedAt && cachedUpdatedAt === lastSharedUpdatedAt) return;
  const cached = readLocalSharedCache();
  if (!cached) return;
  app = restoreLocalNavigation(cached, captureLocalNavigation());
  if (cachedUpdatedAt) lastSharedUpdatedAt = cachedUpdatedAt;
  selectedActions.clear();
  renderApp();
  if (app.view === "editor") markSaved();
  egressDiag("cache compartilhado aplicado de outra aba", { cachedUpdatedAt });
}

async function loadAppFromCloud(user) {
  const localCache = readLocalSharedCache();
  const cachedUpdatedAt = readLocalSharedUpdatedAt();
  const migrationDone = isRestrictedAdminUser(user) || !!localStorage.getItem(`${LOCAL_MIGRATION_KEY}.${user.id}`);
  egressDiag("loadAppFromCloud chamada", {
    hasLocalCache: !!localCache,
    cachedUpdatedAt,
    migrationDone
  });
  const remoteUpdatedAt = await fetchSharedStateUpdatedAt({ source: "loadAppFromCloud", throwOnError: true });
  if (remoteUpdatedAt && localCache && cachedUpdatedAt === remoteUpdatedAt && migrationDone) {
    lastSharedUpdatedAt = remoteUpdatedAt;
    egressDiag("loadAppFromCloud usando cache local; data remoto não baixado", { remoteUpdatedAt });
    return localCache;
  }

  if (remoteUpdatedAt) {
    egressDiag("loadAppFromCloud baixando data completo", { remoteUpdatedAt, cachedUpdatedAt });
    const row = await fetchSharedStateFull({ source: "loadAppFromCloud", throwOnError: true });
    if (row && row.data) {
      lastSharedUpdatedAt = row.updated_at || "";
      const merged = await mergeLocalCacheIntoCloud(normalizeApp(row.data), localCache);
      writeLocalSharedCache(merged, lastSharedUpdatedAt);
      return merged;
    }
    throw new Error("Linha shared_states/main não retornou data.");
  }

  const initial = createEmptyApp();
  const { data: created, error: createError } = await supabaseClient
    .from("shared_states")
    .upsert({
      id: SHARED_STATE_ID,
      data: initial,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" })
    .select("updated_at")
    .single();
  if (createError) throw createError;
  lastSharedUpdatedAt = created && created.updated_at ? created.updated_at : "";
  const merged = await mergeLocalCacheIntoCloud(normalizeApp(initial), localCache);
  writeLocalSharedCache(merged, lastSharedUpdatedAt);
  return merged;
}

function readLocalSharedCache() {
  const saved = localStorage.getItem(SHARED_STORAGE_KEY);
  if (!saved) return null;
  try {
    return normalizeApp(JSON.parse(saved));
  } catch (error) {
    console.warn("Cache local antigo ignorado:", error);
    return null;
  }
}

function readLocalSharedUpdatedAt() {
  return localStorage.getItem(SHARED_UPDATED_AT_CACHE_KEY) || "";
}

function writeLocalSharedCache(data, updatedAt = lastSharedUpdatedAt) {
  localStorage.setItem(SHARED_STORAGE_KEY, JSON.stringify(data));
  if (updatedAt) localStorage.setItem(SHARED_UPDATED_AT_CACHE_KEY, updatedAt);
}

async function mergeLocalCacheIntoCloud(cloudApp, localApp) {
  if (!currentUser || isRestrictedAdminUser() || !localApp || !Array.isArray(localApp.profiles) || !localApp.profiles.length) return cloudApp;
  const migrationKey = `${LOCAL_MIGRATION_KEY}.${currentUser.id}`;
  if (localStorage.getItem(migrationKey)) return cloudApp;

  const merged = normalizeApp(cloudApp);
  let changed = false;
  localApp.hiddenUserProfileIds.forEach(userId => {
    if (userId && !merged.hiddenUserProfileIds.includes(userId)) {
      merged.hiddenUserProfileIds.push(userId);
      changed = true;
    }
  });

  localApp.profiles.forEach(localProfile => {
    const profile = normalizeProfile(localProfile);
    const currentEmail = normalizeText(currentUser.email || "");
    const profileEmail = normalizeText(profile.email || "");
    if (!profile.userId && profileEmail && profileEmail === currentEmail) {
      profile.userId = currentUser.id;
      profile.id = currentUser.id;
    }
    if (profile.userId && merged.hiddenUserProfileIds.includes(profile.userId)) return;
    const existing = merged.profiles.find(item => {
      const itemEmail = normalizeText(item.email || "");
      return (profile.userId && item.userId === profile.userId)
        || item.id === profile.id
        || (profileEmail && itemEmail && itemEmail === profileEmail && item.userId === profile.userId);
    });
    if (!existing) {
      merged.profiles.push(profile);
      changed = true;
      return;
    }

    const folderIds = new Set(existing.folders.map(folder => folder.id));
    profile.folders.forEach(folder => {
      if (!folderIds.has(folder.id)) {
        existing.folders.push(folder);
        changed = true;
      }
    });
    const planIds = new Set(existing.plans.map(plan => plan.id));
    profile.plans.forEach(plan => {
      if (!planIds.has(plan.id)) {
        existing.plans.push(plan);
        changed = true;
      }
    });
    if (profile.avatarPhoto && !existing.avatarPhoto) {
      existing.avatarPhoto = profile.avatarPhoto;
      changed = true;
    }
    if (profile.name && (!existing.name || existing.name === "Perfil sem nome")) {
      existing.name = profile.name;
      changed = true;
    }
  });

  if (!changed) {
    localStorage.setItem(migrationKey, new Date().toISOString());
    return merged;
  }

  egressDiag("mergeLocalCacheIntoCloud enviando migração local", { changed });
  const { data, error } = await supabaseClient
    .from("shared_states")
    .upsert({
      id: SHARED_STATE_ID,
      data: sharedAppData(merged),
      updated_at: new Date().toISOString()
    }, { onConflict: "id" })
    .select("updated_at")
    .single();
  if (error) {
    console.warn("Não foi possível migrar o cache local para o banco:", error);
    return cloudApp;
  }
  localStorage.setItem(migrationKey, new Date().toISOString());
  lastSharedUpdatedAt = data && data.updated_at ? data.updated_at : lastSharedUpdatedAt;
  const normalized = normalizeApp(sharedAppData(merged));
  writeLocalSharedCache(normalized, lastSharedUpdatedAt);
  return normalized;
}

function ensureSinglePrivateProfile() {
  if (!currentUser) return null;
  if (isRestrictedAdminUser()) return null;
  if (app.hiddenUserProfileIds.includes(currentUser.id)) return null;
  const userEmail = normalizeText(currentUser.email || "");
  let profile = app.profiles.find(item => item.userId === currentUser.id)
    || app.profiles.find(item => item.id === currentUser.id)
    || app.profiles.find(item => userEmail && normalizeText(item.email || "") === userEmail);

  if (!profile) {
    profile = normalizeProfile({
      id: currentUser.id,
      userId: currentUser.id,
      name: currentUser.email ? currentUser.email.split("@")[0] : "Meu perfil",
      role: "",
      company: "",
      email: currentUser.email || "",
      avatarColor: pickColor(currentUser.email || currentUser.id),
      avatarPhoto: "",
      createdAt: new Date().toISOString(),
      lastAccess: "",
      folders: [createDefaultFolder()],
      plans: []
    });
    app.profiles.push(profile);
    dirtyProfileIds.add(profile.id);
  } else {
    Object.assign(profile, normalizeProfile({
      ...profile,
      userId: currentUser.id,
      email: currentUser.email || profile.email || ""
    }));
  }

  ensureDefaultFolder(profile);
  if (!app.activeFolderId) app.activeFolderId = DEFAULT_FOLDER_ID;
  return profile;
}

function createEmptyApp() {
  return {
    version: 2,
    view: "profiles",
    activeProfileId: null,
    activeFolderId: DEFAULT_FOLDER_ID,
  activePlanId: null,
  hiddenUserProfileIds: [],
  activityLog: [],
  profiles: []
};
}

function loadApp(storageKey = STORAGE_KEY, options = { allowLegacy: true }) {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      return normalizeApp(JSON.parse(saved));
    } catch (error) {
      console.warn("Não foi possível carregar dados v2:", error);
    }
  }

  const legacy = options.allowLegacy ? localStorage.getItem(LEGACY_KEY) : null;
  if (legacy) {
    try {
      return createAppFromLegacy(JSON.parse(legacy));
    } catch (error) {
      console.warn("Não foi possível migrar dados antigos:", error);
    }
  }

  return createEmptyApp();
}

function normalizeApp(raw) {
  const appData = {
    version: 2,
    view: "profiles",
    activeProfileId: raw.activeProfileId || null,
    activeFolderId: raw.activeFolderId || DEFAULT_FOLDER_ID,
    activePlanId: raw.activePlanId || null,
    hiddenUserProfileIds: Array.isArray(raw.hiddenUserProfileIds) ? raw.hiddenUserProfileIds : [],
    activityLog: normalizeActivityLog(raw.activityLog || raw.activity_log || []),
    profiles: Array.isArray(raw.profiles) ? raw.profiles : []
  };

  appData.profiles = appData.profiles.map(profile => normalizeProfile(profile));
  return appData;
}

function normalizeActivityLog(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(entry => ({
      id: entry.id || createId(),
      at: entry.at || entry.createdAt || new Date().toISOString(),
      action: String(entry.action || "Atividade"),
      detail: String(entry.detail || ""),
      userId: entry.userId || "",
      userEmail: entry.userEmail || "",
      userName: entry.userName || "",
      profileId: entry.profileId || "",
      profileName: entry.profileName || "",
      planId: entry.planId || "",
      planTitle: entry.planTitle || ""
    }))
    .filter(entry => LOGGED_ACTIVITY_ACTIONS.has(entry.action))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, MAX_ACTIVITY_LOG);
}

function normalizeProfile(profile) {
  const folders = Array.isArray(profile.folders) ? profile.folders : [];
  const plans = Array.isArray(profile.plans) ? profile.plans : [];
  if (!folders.some(folder => folder.id === DEFAULT_FOLDER_ID)) {
    folders.unshift(createDefaultFolder());
  }
  return {
    id: profile.id || createId(),
    userId: profile.userId || profile.user_id || "",
    name: profile.name || "Perfil sem nome",
    role: profile.role || "",
    company: profile.company || "",
    email: profile.email || "",
    avatarColor: profile.avatarColor || pickColor(profile.name || ""),
    avatarPhoto: profile.avatarPhoto || "",
    createdAt: profile.createdAt || new Date().toISOString(),
    lastAccess: profile.lastAccess || "",
    folders: folders.map(folder => normalizeFolder(folder)),
    plans: plans.map(plan => normalizePlan(plan))
  };
}

function normalizeFolder(folder) {
  return {
    id: folder.id || createId(),
    name: folder.id === DEFAULT_FOLDER_ID ? "Sem pasta" : folder.name || "Nova pasta",
    color: folder.color || "#2563eb",
    isDefault: folder.id === DEFAULT_FOLDER_ID || !!folder.isDefault,
    createdAt: folder.createdAt || new Date().toISOString()
  };
}

function normalizePlan(plan) {
  const now = new Date().toISOString();
  return {
    id: plan.id || createId(),
    title: plan.title || "Plano sem nome",
    company: plan.company || (plan.data && plan.data.meta && plan.data.meta.company) || "",
    documentType: plan.documentType || (plan.data && plan.data.meta && plan.data.meta.documentName) || "PGR",
    folderId: plan.folderId || DEFAULT_FOLDER_ID,
    createdAt: plan.createdAt || now,
    updatedAt: plan.updatedAt || now,
    data: normalizePlanData(plan.data || createPlanData({ useTemplate: true }))
  };
}

function normalizePlanData(data) {
  const fallback = createPlanData({ useTemplate: false });
  return {
    meta: { ...fallback.meta, ...(data.meta || {}) },
    actions: Array.isArray(data.actions) ? data.actions.map(row => normalizeRow(row, "actions")) : [],
    equipment: Array.isArray(data.equipment) ? data.equipment.map(row => normalizeRow(row, "equipment")) : [],
    trainings: Array.isArray(data.trainings) ? data.trainings.map(row => normalizeRow(row, "trainings")) : []
  };
}

function normalizeRow(row, section) {
  const now = new Date().toISOString();
  const base = {
    id: row.id || createId(),
    lastEdited: row.lastEdited || now,
    responsible: row.responsible || "",
    status: normalizeStatus(row.status),
    observationHtml: richFromAny(row.observationHtml || row.observation || "")
  };
  if (section === "actions") {
    return {
      ...base,
      actionHtml: richFromAny(row.actionHtml || row.action || ""),
      when: row.when || "",
      priority: normalizePriority(row.priority),
      progress: clampProgress(row.progress)
    };
  }
  if (section === "equipment") {
    return {
      ...base,
      descriptionHtml: richFromAny(row.descriptionHtml || row.description || "")
    };
  }
  return {
    ...base,
    trainingHtml: richFromAny(row.trainingHtml || row.training || row.description || ""),
    when: row.when || ""
  };
}

function createAppFromLegacy(legacy) {
  const profile = {
    id: createId(),
    name: "Perfil Padrão",
    role: "",
    company: legacy.meta && legacy.meta.company ? legacy.meta.company : "",
    email: "",
    avatarColor: "#2563eb",
    avatarPhoto: "",
    createdAt: new Date().toISOString(),
    lastAccess: "",
    folders: [createDefaultFolder()],
    plans: [{
      id: createId(),
      title: "Plano migrado",
      company: legacy.meta && legacy.meta.company ? legacy.meta.company : "Empresa",
      documentType: legacy.meta && legacy.meta.documentName ? legacy.meta.documentName : "PGR",
      folderId: DEFAULT_FOLDER_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: normalizePlanData(legacy)
    }]
  };
  return {
    version: 2,
    view: "profiles",
    activeProfileId: null,
    activeFolderId: DEFAULT_FOLDER_ID,
    activePlanId: null,
    profiles: [normalizeProfile(profile)]
  };
}

function createDefaultFolder() {
  return {
    id: DEFAULT_FOLDER_ID,
    name: "Sem pasta",
    color: "#64748b",
    isDefault: true,
    createdAt: new Date().toISOString()
  };
}

function withBaseFields(row, editedAt) {
  return { id: createId(), lastEdited: editedAt, ...row };
}

function touchRowAndPlan(row) {
  touchRow(row);
  touchPlan(currentPlan());
}

function touchRow(row) {
  row.lastEdited = new Date().toISOString();
}

function touchPlan(plan) {
  if (plan) plan.updatedAt = new Date().toISOString();
}

function rowDeleteKey(info) {
  if (!info) return "";
  return [info.profileId || app.activeProfileId || "", info.planId || app.activePlanId || "", info.section || "", info.rowId || info.id || ""].join("|");
}

function parseRowDeleteKey(key) {
  const [profileId, planId, section, rowId] = String(key || "").split("|");
  return { profileId, planId, section, rowId };
}

function saveApp(options = {}) {
  const key = currentUser ? SHARED_STORAGE_KEY : STORAGE_KEY;
  localStorage.setItem(key, JSON.stringify(app));
  if (!isHydrating) lastLocalChangeAt = Date.now();
  const pureActivitySave = options.activityId
    && !options.fullSave
    && !options.deleteProfileId
    && !options.deletePlanId
    && !options.deleteFolderId
    && !options.rowDelete
    && !options.rowDeletes
    && !options.profileId
    && !options.hiddenAdd
    && !options.hiddenRemove;
  if (isRestrictedAdminUser() && !options.localOnly) {
    egressDiag("saveApp bloqueado por modo readonly", {
      options: Object.keys(options),
      pureActivitySave: !!pureActivitySave,
      caller: egressDiagCaller()
    });
    return;
  }
  if (!options.localOnly) {
    if (options.fullSave) pendingFullSave = true;
    if (options.deleteProfileId) pendingProfileDeletes.add(options.deleteProfileId);
    if (options.deletePlanId) pendingPlanDeletes.add(options.deletePlanId);
    if (options.deleteFolderId) pendingFolderDeletes.add(options.deleteFolderId);
    if (options.activityId) pendingActivityIds.add(options.activityId);
    if (options.rowDelete) {
      const key = rowDeleteKey(options.rowDelete);
      if (key) pendingRowDeletes.add(key);
    }
    if (Array.isArray(options.rowDeletes)) options.rowDeletes.forEach(rowDelete => {
      const key = rowDeleteKey(rowDelete);
      if (key) pendingRowDeletes.add(key);
    });
    if (options.hiddenAdd) pendingHiddenAdds.add(options.hiddenAdd);
    if (options.hiddenRemove) pendingHiddenRemoves.add(options.hiddenRemove);
    if (options.profileId) dirtyProfileIds.add(options.profileId);
    if (!options.fullSave && !options.deleteProfileId && !options.profileId && !pureActivitySave && app.activeProfileId) {
      dirtyProfileIds.add(app.activeProfileId);
    }
  }
  if (!currentUser || !cloudReady || isHydrating || options.localOnly || !hasPendingCloudChanges()) return;
  scheduleCloudSave();
}

function hasPendingCloudChanges() {
  return pendingFullSave
    || dirtyProfileIds.size > 0
    || pendingProfileDeletes.size > 0
    || pendingPlanDeletes.size > 0
    || pendingFolderDeletes.size > 0
    || pendingRowDeletes.size > 0
    || pendingActivityIds.size > 0
    || pendingHiddenAdds.size > 0
    || pendingHiddenRemoves.size > 0;
}

function takePendingCloudSnapshot() {
  return {
    fullSave: pendingFullSave,
    profileIds: Array.from(dirtyProfileIds),
    deletedProfileIds: Array.from(pendingProfileDeletes),
    deletedPlanIds: Array.from(pendingPlanDeletes),
    deletedFolderIds: Array.from(pendingFolderDeletes),
    deletedRows: Array.from(pendingRowDeletes),
    activityIds: Array.from(pendingActivityIds),
    hiddenAdds: Array.from(pendingHiddenAdds),
    hiddenRemoves: Array.from(pendingHiddenRemoves)
  };
}

function clearPendingCloudSnapshot(snapshot) {
  if (snapshot.fullSave) pendingFullSave = false;
  snapshot.profileIds.forEach(id => dirtyProfileIds.delete(id));
  snapshot.deletedProfileIds.forEach(id => pendingProfileDeletes.delete(id));
  snapshot.deletedPlanIds.forEach(id => pendingPlanDeletes.delete(id));
  snapshot.deletedFolderIds.forEach(id => pendingFolderDeletes.delete(id));
  snapshot.deletedRows.forEach(key => pendingRowDeletes.delete(key));
  snapshot.activityIds.forEach(id => pendingActivityIds.delete(id));
  snapshot.hiddenAdds.forEach(id => pendingHiddenAdds.delete(id));
  snapshot.hiddenRemoves.forEach(id => pendingHiddenRemoves.delete(id));
}

function requeuePendingCloudSnapshot(snapshot) {
  if (snapshot.fullSave) pendingFullSave = true;
  snapshot.profileIds.forEach(id => dirtyProfileIds.add(id));
  snapshot.deletedProfileIds.forEach(id => pendingProfileDeletes.add(id));
  snapshot.deletedPlanIds.forEach(id => pendingPlanDeletes.add(id));
  snapshot.deletedFolderIds.forEach(id => pendingFolderDeletes.add(id));
  snapshot.deletedRows.forEach(key => pendingRowDeletes.add(key));
  snapshot.activityIds.forEach(id => pendingActivityIds.add(id));
  snapshot.hiddenAdds.forEach(id => pendingHiddenAdds.add(id));
  snapshot.hiddenRemoves.forEach(id => pendingHiddenRemoves.add(id));
}

function snapshotHasOnlyActivity(snapshot) {
  return !snapshot.fullSave
    && !snapshot.profileIds.length
    && !snapshot.deletedProfileIds.length
    && !snapshot.deletedPlanIds.length
    && !snapshot.deletedFolderIds.length
    && !snapshot.deletedRows.length
    && snapshot.activityIds.length > 0
    && !snapshot.hiddenAdds.length
    && !snapshot.hiddenRemoves.length;
}

function scheduleCloudSave() {
  egressDiag("scheduleCloudSave disparado", {
    pending: snapshotDiag(),
    caller: egressDiagCaller()
  });
  if (saveTimer) {
    clearTimeout(saveTimer);
    egressDiag("scheduleCloudSave substituiu debounce anterior", { delayMs: 5000 });
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveAppToCloud({ source: "debounced-save" });
  }, 5000);
  if (app.view === "editor") els.saveStatus.textContent = "Salvando no banco...";
}

async function flushCloudSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    egressDiag("flushCloudSave limpou debounce pendente", { pending: snapshotDiag() });
    await saveAppToCloud({ source: "flushCloudSave:timer" });
  } else if (hasPendingCloudChanges()) {
    await saveAppToCloud({ source: "flushCloudSave:pending" });
  }
}

async function saveAppToCloud(options = {}) {
  egressDiag("saveAppToCloud chamada", {
    source: options.source || "direct",
    pending: snapshotDiag(),
    caller: egressDiagCaller()
  });
  if (!supabaseClient || !currentUser || !cloudReady || isSavingCloud) {
    egressDiag("saveAppToCloud ignorada por guarda", {
      hasClient: !!supabaseClient,
      hasUser: !!currentUser,
      cloudReady,
      isSavingCloud
    });
    return;
  }
  const snapshot = takePendingCloudSnapshot();
  if (!snapshot.fullSave
    && !snapshot.profileIds.length
    && !snapshot.deletedProfileIds.length
    && !snapshot.deletedPlanIds.length
    && !snapshot.deletedFolderIds.length
    && !snapshot.deletedRows.length
    && !snapshot.activityIds.length
    && !snapshot.hiddenAdds.length
    && !snapshot.hiddenRemoves.length) {
    egressDiag("saveAppToCloud ignorada sem mudanças pendentes");
    return;
  }
  if (isRestrictedAdminUser()) {
    egressDiag("saveAppToCloud bloqueada por modo readonly", { snapshot: snapshotDiag(snapshot) });
    clearPendingCloudSnapshot(snapshot);
    return;
  }
  if (!ensureSyncLeader({
    reason: `saveAppToCloud:${options.source || "direct"}`,
    steal: document.visibilityState === "visible" || options.source === "pagehide" || options.source === "inactivity-logout"
  })) {
    egressDiag("saveAppToCloud aguardando aba lider", { source: options.source || "direct" });
    return;
  }
  isSavingCloud = true;
  clearPendingCloudSnapshot(snapshot);
  let savedCloudOk = false;
  try {
    const mergedData = await buildMergedCloudData(snapshot);
    const { data, error } = await supabaseClient
      .from("shared_states")
      .upsert({
        id: SHARED_STATE_ID,
        data: mergedData,
        updated_at: new Date().toISOString()
      }, { onConflict: "id" })
      .select("updated_at")
      .single();
    if (error) {
      console.error(error);
      requeuePendingCloudSnapshot(snapshot);
      if (app.view === "editor") els.saveStatus.textContent = "Erro ao salvar no banco";
      return;
    }
    app = restoreLocalNavigation(normalizeApp(mergedData), captureLocalNavigation());
    lastCloudSaveAt = Date.now();
    if (data && data.updated_at) lastSharedUpdatedAt = data.updated_at;
    writeLocalSharedCache(app, lastSharedUpdatedAt);
    if (app.view === "editor") markSaved();
    savedCloudOk = true;
  } catch (error) {
    console.error(error);
    requeuePendingCloudSnapshot(snapshot);
    if (app.view === "editor") els.saveStatus.textContent = "Erro ao salvar no banco";
  } finally {
    isSavingCloud = false;
    if (savedCloudOk && hasPendingCloudChanges() && currentUser && cloudReady) scheduleCloudSave();
  }
}

async function buildMergedCloudData(snapshot) {
  egressDiag("buildMergedCloudData chamada", { snapshot: snapshotDiag(snapshot) });
  if (snapshot.fullSave) {
    egressDiag("buildMergedCloudData fullSave; não baixou data remoto");
    return sharedAppData(app);
  }
  const remoteUpdatedAt = await fetchSharedStateUpdatedAt({ source: "buildMergedCloudData" });
  if (remoteUpdatedAt && remoteUpdatedAt === lastSharedUpdatedAt) {
    egressDiag("buildMergedCloudData não baixou data remoto", {
      remoteUpdatedAt,
      lastSharedUpdatedAt
    });
    return sharedAppData(app);
  }
  egressDiag("buildMergedCloudData baixando data remoto", {
    remoteUpdatedAt,
    lastSharedUpdatedAt
  });
  const row = await fetchSharedStateFull({ source: "buildMergedCloudData" });
  const latest = row && row.data ? normalizeApp(row.data) : createEmptyApp();
  const deleteIds = new Set(snapshot.deletedProfileIds.filter(Boolean));
  const deletedPlanIds = new Set((snapshot.deletedPlanIds || []).filter(Boolean));
  const deletedFolderIds = new Set((snapshot.deletedFolderIds || []).filter(Boolean));
  const deletedRows = (snapshot.deletedRows || []).filter(Boolean).map(parseRowDeleteKey);
  const hiddenAddSet = new Set(snapshot.hiddenAdds.filter(Boolean));

  snapshot.hiddenRemoves.filter(Boolean).forEach(userId => {
    latest.hiddenUserProfileIds = latest.hiddenUserProfileIds.filter(id => id !== userId);
  });
  snapshot.hiddenAdds.filter(Boolean).forEach(userId => {
    if (!latest.hiddenUserProfileIds.includes(userId)) latest.hiddenUserProfileIds.push(userId);
  });

  latest.profiles = latest.profiles.filter(profile => {
    if (deleteIds.has(profile.id)) return false;
    if (profile.userId && hiddenAddSet.has(profile.userId)) return false;
    return true;
  });

  latest.profiles.forEach(profile => applyDeleteSnapshotToProfile(profile, deletedFolderIds, deletedPlanIds, deletedRows));

  snapshot.profileIds.filter(Boolean).forEach(profileId => {
    if (deleteIds.has(profileId)) return;
    const localProfile = app.profiles.find(profile => profile.id === profileId || profile.userId === profileId);
    if (!localProfile) return;
    const local = normalizeProfile(deepClone(localProfile));
    if (local.userId) {
      latest.hiddenUserProfileIds = latest.hiddenUserProfileIds.filter(userId => userId !== local.userId);
    }
    const index = latest.profiles.findIndex(item => item.id === local.id || (local.userId && item.userId === local.userId));
    const remote = index >= 0 ? latest.profiles[index] : null;
    const mergedProfile = mergeProfileForCloud(remote, local, { deletedFolderIds, deletedPlanIds, deletedRows });
    if (index >= 0) latest.profiles[index] = mergedProfile;
    else latest.profiles.push(mergedProfile);
  });

  if (snapshot.activityIds && snapshot.activityIds.length) {
    const activityIds = new Set(snapshot.activityIds);
    latest.activityLog = mergeActivityLogs(latest.activityLog, app.activityLog.filter(entry => activityIds.has(entry.id)));
  }

  return sharedAppData(latest);
}

function applyDeleteSnapshotToProfile(profile, deletedFolderIds, deletedPlanIds, deletedRows) {
  if (!profile) return;
  if (deletedFolderIds.size) {
    profile.folders = profile.folders.filter(folder => folder.isDefault || !deletedFolderIds.has(folder.id));
    profile.plans.forEach(plan => {
      if (deletedFolderIds.has(plan.folderId)) {
        plan.folderId = DEFAULT_FOLDER_ID;
        touchPlan(plan);
      }
    });
  }
  if (deletedPlanIds.size) {
    profile.plans = profile.plans.filter(plan => !deletedPlanIds.has(plan.id));
  }
  deletedRows.forEach(info => {
    if (info.profileId && info.profileId !== profile.id && info.profileId !== profile.userId) return;
    const plan = profile.plans.find(item => item.id === info.planId);
    if (!plan || !plan.data || !Array.isArray(plan.data[info.section])) return;
    plan.data[info.section] = plan.data[info.section].filter(row => row.id !== info.rowId);
    touchPlan(plan);
  });
}

function mergeProfileForCloud(remoteProfile, localProfile, options = {}) {
  const local = normalizeProfile(deepClone(localProfile));
  const remote = remoteProfile ? normalizeProfile(deepClone(remoteProfile)) : null;
  if (!remote) {
    applyDeleteSnapshotToProfile(local, options.deletedFolderIds || new Set(), options.deletedPlanIds || new Set(), options.deletedRows || []);
    return local;
  }

  const merged = normalizeProfile({
    ...remote,
    name: local.name,
    role: local.role,
    company: local.company,
    email: local.email,
    avatarColor: local.avatarColor,
    avatarPhoto: local.avatarPhoto,
    lastAccess: isSameOrNewer(local.lastAccess, remote.lastAccess) ? local.lastAccess : remote.lastAccess,
    createdAt: remote.createdAt || local.createdAt,
    folders: mergeFoldersForCloud(remote.folders, local.folders, options.deletedFolderIds || new Set()),
    plans: mergePlansForCloud(remote.plans, local.plans, {
      deletedPlanIds: options.deletedPlanIds || new Set(),
      deletedFolderIds: options.deletedFolderIds || new Set(),
      deletedRows: options.deletedRows || [],
      profileId: local.id
    })
  });
  applyDeleteSnapshotToProfile(merged, options.deletedFolderIds || new Set(), options.deletedPlanIds || new Set(), options.deletedRows || []);
  return merged;
}

function mergeFoldersForCloud(remoteFolders, localFolders, deletedFolderIds) {
  const map = new Map();
  normalizeProfile({ folders: remoteFolders || [], plans: [] }).folders.forEach(folder => {
    if (folder.isDefault || !deletedFolderIds.has(folder.id)) map.set(folder.id, folder);
  });
  normalizeProfile({ folders: localFolders || [], plans: [] }).folders.forEach(folder => {
    if (!folder.isDefault && deletedFolderIds.has(folder.id)) return;
    map.set(folder.id, folder);
  });
  const merged = Array.from(map.values());
  if (!merged.some(folder => folder.id === DEFAULT_FOLDER_ID)) merged.unshift(createDefaultFolder());
  return merged;
}

function mergePlansForCloud(remotePlans, localPlans, options) {
  const deletedPlanIds = options.deletedPlanIds || new Set();
  const deletedFolderIds = options.deletedFolderIds || new Set();
  const remoteMap = new Map((remotePlans || []).map(plan => [plan.id, normalizePlan(plan)]));
  const localMap = new Map((localPlans || []).map(plan => [plan.id, normalizePlan(plan)]));
  const ids = new Set([...remoteMap.keys(), ...localMap.keys()]);
  const baseOrder = [...localMap.keys(), ...remoteMap.keys()];
  const mergedMap = new Map();

  ids.forEach(planId => {
    if (deletedPlanIds.has(planId)) return;
    const remote = remoteMap.get(planId);
    const local = localMap.get(planId);
    const merged = remote && local ? mergePlanForCloud(remote, local, options) : deepClone(local || remote);
    if (!merged) return;
    if (deletedFolderIds.has(merged.folderId)) merged.folderId = DEFAULT_FOLDER_ID;
    mergedMap.set(planId, normalizePlan(merged));
  });

  return baseOrder
    .filter((id, index, arr) => arr.indexOf(id) === index && mergedMap.has(id))
    .map(id => mergedMap.get(id));
}

function mergePlanForCloud(remotePlan, localPlan, options) {
  const remote = normalizePlan(deepClone(remotePlan));
  const local = normalizePlan(deepClone(localPlan));
  const localIsNewer = isSameOrNewer(local.updatedAt, remote.updatedAt);
  const base = localIsNewer ? local : remote;
  const merged = {
    ...base,
    data: {
      meta: localIsNewer ? { ...remote.data.meta, ...local.data.meta } : { ...local.data.meta, ...remote.data.meta },
      actions: mergeRowsForCloud(remote.data.actions, local.data.actions, options, local.id, "actions", localIsNewer),
      equipment: mergeRowsForCloud(remote.data.equipment, local.data.equipment, options, local.id, "equipment", localIsNewer),
      trainings: mergeRowsForCloud(remote.data.trainings, local.data.trainings, options, local.id, "trainings", localIsNewer)
    }
  };
  merged.updatedAt = isSameOrNewer(local.updatedAt, remote.updatedAt) ? local.updatedAt : remote.updatedAt;
  return normalizePlan(merged);
}

function mergeRowsForCloud(remoteRows, localRows, options, planId, section, localOrderFirst) {
  const deletedKeys = new Set((options.deletedRows || [])
    .filter(info => (!info.profileId || info.profileId === options.profileId) && info.planId === planId && info.section === section)
    .map(info => info.rowId));
  const remoteMap = new Map((remoteRows || []).filter(row => !deletedKeys.has(row.id)).map(row => [row.id, row]));
  const localMap = new Map((localRows || []).filter(row => !deletedKeys.has(row.id)).map(row => [row.id, row]));
  const order = localOrderFirst
    ? [...localMap.keys(), ...remoteMap.keys()]
    : [...remoteMap.keys(), ...localMap.keys()];
  const rowMap = new Map();
  new Set([...remoteMap.keys(), ...localMap.keys()]).forEach(rowId => {
    const remote = remoteMap.get(rowId);
    const local = localMap.get(rowId);
    if (remote && local) {
      rowMap.set(rowId, isSameOrNewer(local.lastEdited, remote.lastEdited) ? local : remote);
    } else {
      rowMap.set(rowId, local || remote);
    }
  });
  return order
    .filter((id, index, arr) => arr.indexOf(id) === index && rowMap.has(id))
    .map(id => rowMap.get(id));
}

function mergeActivityLogs(baseEntries, newEntries) {
  const map = new Map();
  normalizeActivityLog(baseEntries).forEach(entry => map.set(entry.id, entry));
  normalizeActivityLog(newEntries).forEach(entry => map.set(entry.id, entry));
  return normalizeActivityLog(Array.from(map.values()));
}

function isSameOrNewer(candidate, reference) {
  const candidateTime = Date.parse(candidate || "") || 0;
  const referenceTime = Date.parse(reference || "") || 0;
  return candidateTime >= referenceTime;
}

function startSharedSync(options = {}) {
  egressDiag("startSharedSync chamado", {
    hadTimer: !!syncTimer,
    hadChannel: !!realtimeChannel,
    source: options.source || "unknown"
  });
  if (!ensureSyncLeader({
    reason: options.source || "startSharedSync",
    steal: options.steal !== false
  })) {
    stopSharedSync({ releaseLeadership: false });
    return;
  }
  stopSharedSync({ keepLeadership: true, releaseLeadership: false });
  startSyncLeaderHeartbeat();
  subscribeRealtime();
  syncTimer = setInterval(() => {
    if (document.visibilityState === "visible") {
      syncSharedStateFromCloud({ source: "polling-fallback" });
    }
  }, 600000);
  egressDiag("polling criado", { intervalMs: 600000 });
}

function stopSharedSync(options = {}) {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    egressDiag("polling limpo");
  }
  unsubscribeRealtime();
  if (!options.keepLeadership) stopSyncLeaderHeartbeat();
  if (options.releaseLeadership !== false) releaseSyncLeadership();
}

function subscribeRealtime() {
  if (!supabaseClient || !currentUser) return;
  if (realtimeChannel) {
    egressDiag("subscribeRealtime removeu canal antigo antes de criar novo");
    unsubscribeRealtime();
  }
  egressDiag("realtime criado", {
    table: "shared_states",
    filter: `id=eq.${SHARED_STATE_ID}`
  });
  realtimeChannel = supabaseClient
    .channel("sst-shared-team")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "shared_states",
      filter: `id=eq.${SHARED_STATE_ID}`
    }, payload => {
      if (!payload.new || payload.eventType === "DELETE") return;
      applyRemoteSharedState(payload.new).catch(error => console.warn("Falha ao aplicar atualização em tempo real:", error));
    })
    .on("presence", { event: "sync" }, () => {
      updateOnlineUsersFromPresence();
    })
    .subscribe(status => {
      if (status === "SUBSCRIBED" && currentUser && realtimeChannel) {
        egressDiag("Presence track enviado", { user_id: currentUser.id });
        realtimeChannel.track({
          user_id: currentUser.id
        }).catch(error => console.warn("Falha ao registrar presença online:", error));
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.warn("Realtime indisponível:", status);
      }
    });
}

function unsubscribeRealtime() {
  if (realtimeChannel && supabaseClient) {
    egressDiag("realtime removido");
    realtimeChannel.untrack().catch(error => console.warn("Falha ao remover presença online:", error));
    supabaseClient.removeChannel(realtimeChannel);
  }
  realtimeChannel = null;
  onlineUserIds = new Set();
  if (!isCurrentSyncLeader()) applyPresenceCacheFromAnotherTab();
  if (app.view === "profiles") renderProfiles();
}

function updateOnlineUsersFromPresence() {
  if (!realtimeChannel) return;
  const state = realtimeChannel.presenceState();
  onlineUserIds = new Set(Object.values(state)
    .flat()
    .map(presence => presence.user_id)
    .filter(Boolean));
  writePresenceCache();
  if (app.view === "profiles") renderProfiles();
}

async function syncSharedStateFromCloud(options = {}) {
  egressDiag("syncSharedStateFromCloud chamada", {
    source: options.source || "unknown",
    force: !!options.force,
    allowWhileEditing: !!options.allowWhileEditing,
    caller: egressDiagCaller()
  });
  if (!supabaseClient || !currentUser || !cloudReady || isSavingCloud) {
    egressDiag("syncSharedStateFromCloud ignorada por guarda", {
      hasClient: !!supabaseClient,
      hasUser: !!currentUser,
      cloudReady,
      isSavingCloud
    });
    return;
  }
  if (!ensureSyncLeader({
    reason: options.source || "syncSharedStateFromCloud",
    steal: !!options.force && document.visibilityState === "visible"
  })) {
    egressDiag("syncSharedStateFromCloud ignorada por aba secundaria", { source: options.source || "unknown" });
    stopSharedSync({ releaseLeadership: false });
    return;
  }
  if (!options.force && hasRecentLocalActivity()) {
    egressDiag("syncSharedStateFromCloud ignorada por atividade local recente", { source: options.source || "unknown" });
    return;
  }
  if (!options.allowWhileEditing && isUserEditing()) {
    egressDiag("syncSharedStateFromCloud ignorada por edição ativa", { source: options.source || "unknown" });
    return;
  }
  const remoteUpdatedAt = await fetchSharedStateUpdatedAt({ source: options.source || "syncSharedStateFromCloud" });
  if (!remoteUpdatedAt || remoteUpdatedAt === lastSharedUpdatedAt) {
    egressDiag("syncSharedStateFromCloud não baixou data", {
      remoteUpdatedAt,
      lastSharedUpdatedAt
    });
    return;
  }
  egressDiag("syncSharedStateFromCloud baixando data completo", {
    remoteUpdatedAt,
    lastSharedUpdatedAt
  });
  const row = await fetchSharedStateFull({ source: options.source || "syncSharedStateFromCloud" });
  if (!row || !row.data) return;
  await applyRemoteSharedState(row, options);
}

async function fetchSharedStateUpdatedAt(options = {}) {
  egressDiag("shared_states select updated_at", { source: options.source || "unknown" });
  const { data, error } = await supabaseClient
    .from("shared_states")
    .select("updated_at")
    .eq("id", SHARED_STATE_ID)
    .maybeSingle();
  if (error) {
    egressDiag("shared_states select updated_at erro", { source: options.source || "unknown", message: error.message });
    if (options.throwOnError) throw error;
    return "";
  }
  if (!data) return "";
  return data.updated_at || "";
}

async function fetchSharedStateFull(options = {}) {
  egressDiag("shared_states select data, updated_at", { source: options.source || "unknown" });
  const { data, error } = await supabaseClient
    .from("shared_states")
    .select("data, updated_at")
    .eq("id", SHARED_STATE_ID)
    .maybeSingle();
  if (error) {
    egressDiag("shared_states select data erro", { source: options.source || "unknown", message: error.message });
    if (options.throwOnError) throw error;
    return null;
  }
  if (!data) return null;
  return data;
}

async function applyRemoteSharedState(row, options = {}) {
  if (!row || !row.data) return;
  if (row.updated_at && row.updated_at === lastSharedUpdatedAt) return;
  if (!options.force && hasRecentLocalActivity()) return;
  if (!options.allowWhileEditing && isUserEditing()) return;
  app = restoreLocalNavigation(normalizeApp(row.data), captureLocalNavigation());
  lastSharedUpdatedAt = row.updated_at || "";
  writeLocalSharedCache(app, lastSharedUpdatedAt);
  selectedActions.clear();
  renderApp();
  if (app.view === "editor") markSaved();
}

function sharedAppData(source = app) {
  const data = normalizeApp(JSON.parse(JSON.stringify(source)));
  data.view = "profiles";
  data.activeProfileId = null;
  data.activeFolderId = DEFAULT_FOLDER_ID;
  data.activePlanId = null;
  return data;
}

function captureLocalNavigation() {
  return {
    view: app.view || "profiles",
    activeProfileId: app.activeProfileId || null,
    activeFolderId: app.activeFolderId || DEFAULT_FOLDER_ID,
    activePlanId: app.activePlanId || null
  };
}

function restoreLocalNavigation(nextApp, nav) {
  const restored = normalizeApp(nextApp);
  const profile = restored.profiles.find(item => item.id === nav.activeProfileId);
  if (!profile) {
    restored.view = "profiles";
    restored.activeProfileId = null;
    restored.activeFolderId = DEFAULT_FOLDER_ID;
    restored.activePlanId = null;
    return restored;
  }

  restored.activeProfileId = profile.id;
  const folderExists = profile.folders.some(folder => folder.id === nav.activeFolderId);
  restored.activeFolderId = folderExists ? nav.activeFolderId : DEFAULT_FOLDER_ID;

  if (nav.view === "editor") {
    const plan = profile.plans.find(item => item.id === nav.activePlanId);
    if (plan) {
      restored.view = "editor";
      restored.activePlanId = plan.id;
      return restored;
    }
    restored.view = "folders";
    restored.activePlanId = null;
    return restored;
  }

  restored.view = nav.view === "folders" ? "folders" : "profiles";
  restored.activePlanId = null;
  return restored;
}

function hasRecentLocalActivity() {
  const now = Date.now();
  return hasPendingCloudChanges()
    || !!saveTimer
    || isSavingCloud
    || now - lastLocalChangeAt < 2500
    || now - lastCloudSaveAt < 2500;
}

function isUserEditing() {
  const active = document.activeElement;
  if (!active) return false;
  return !!active.closest && !!active.closest("input, select, textarea, [contenteditable='true'], .modal");
}

function markSaved() {
  els.saveStatus.textContent = "Sincronizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function userStorageKey(userId) {
  return `${STORAGE_KEY}.${userId}`;
}
