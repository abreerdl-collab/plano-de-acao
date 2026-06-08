// Autenticacao, sessao, permissoes e modo restrito.
"use strict";

function isRestrictedAdminEmail(email) {
  return RESTRICTED_ADMIN_EMAILS.has(String(email || "").trim().toLocaleLowerCase("pt-BR"));
}

function isRestrictedAdminUser(user = currentUser) {
  return !!user && isRestrictedAdminEmail(user.email);
}

function enforceRestrictedAdminView() {
  if (!isRestrictedAdminUser()) return false;
  selectedActions.clear();
  ["profileModal", "folderModal", "planModal", "logModal", "switchUserModal"].forEach(id => {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add("hidden");
  });
  hideFolderContextMenu();
  hideRichToolbar();
  return true;
}

function warnRestrictedAdminAccess() {
  if (!isRestrictedAdminUser()) return false;
  return true;
}

function blockRestrictedAdminAccess(detail = "Tentativa bloqueada de executar ação restrita.") {
  if (!isRestrictedAdminUser()) return false;
  recordRestrictedAttempt(detail);
  enforceRestrictedAdminView();
  saveApp({ localOnly: true });
  renderApp();
  return true;
}

function recordRestrictedAttempt(detail) {
  if (!isRestrictedAdminUser()) return null;
  const profile = currentProfile();
  const plan = currentPlan();
  const entry = {
    id: createId(),
    at: new Date().toISOString(),
    action: RESTRICTED_ATTEMPT_ACTION,
    detail: detail || "Tentativa bloqueada no modo somente leitura operacional.",
    userId: currentUser ? currentUser.id : "",
    userEmail: currentUser ? currentUser.email || "" : "",
    userName: "",
    profileId: profile ? profile.id || "" : "",
    profileName: profile ? profile.name || "" : "",
    planId: plan ? plan.id || "" : "",
    planTitle: plan ? plan.title || "" : ""
  };
  restrictedAccessLogs = normalizeActivityLog([entry, ...restrictedAccessLogs]);
  saveRestrictedAccessAttempt(entry).catch(error => console.warn("Não foi possível registrar a tentativa restrita:", error));
  return entry;
}

async function saveRestrictedAccessAttempt(entry) {
  if (!supabaseClient || !currentUser || !entry) return;
  const { error } = await supabaseClient
    .from("restricted_access_logs")
    .insert({
      user_id: entry.userId,
      user_email: entry.userEmail,
      detail: entry.detail,
      profile_id: entry.profileId,
      profile_name: entry.profileName,
      plan_id: entry.planId,
      plan_title: entry.planTitle,
      created_at: entry.at
    });
  if (error) throw error;
}

async function loadRestrictedAccessLogs() {
  if (!supabaseClient || !currentUser || isRestrictedAdminUser()) {
    restrictedAccessLogs = [];
    return;
  }
  const { data, error } = await supabaseClient
    .from("restricted_access_logs")
    .select("id, created_at, user_id, user_email, detail, profile_id, profile_name, plan_id, plan_title")
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) {
    console.warn("Log de acessos restritos indisponível:", error);
    restrictedAccessLogs = [];
    return;
  }
  restrictedAccessLogs = normalizeActivityLog((data || []).map(row => ({
    id: row.id || createId(),
    at: row.created_at || new Date().toISOString(),
    action: RESTRICTED_ATTEMPT_ACTION,
    detail: row.detail || "",
    userId: row.user_id || "",
    userEmail: row.user_email || "",
    userName: "",
    profileId: row.profile_id || "",
    profileName: row.profile_name || "",
    planId: row.plan_id || "",
    planTitle: row.plan_title || ""
  })));
}

function updateRestrictedAdminUi() {
  const restricted = isRestrictedAdminUser();
  document.body.classList.toggle("restricted-readonly", restricted);
  if (els.restrictedReadonlyBanner) {
    els.restrictedReadonlyBanner.classList.toggle("hidden", !restricted);
  }
}

function recordActivity(action, detail = "", context = {}) {
  if (!LOGGED_ACTIVITY_ACTIONS.has(action)) return null;
  if (!app || !Array.isArray(app.activityLog)) app.activityLog = [];
  const targetProfile = context.profile || currentProfile() || null;
  const actorProfile = currentUserOwnProfile();
  const plan = context.plan || currentPlan() || null;
  const entry = {
    id: createId(),
    at: new Date().toISOString(),
    action,
    detail,
    userId: currentUser ? currentUser.id : "",
    userEmail: currentUser ? currentUser.email || "" : "",
    userName: actorProfile ? actorProfile.name || "" : "",
    profileId: targetProfile ? targetProfile.id || "" : "",
    profileName: targetProfile ? targetProfile.name || "" : "",
    planId: plan ? plan.id || "" : context.planId || "",
    planTitle: plan ? plan.title || "" : context.planTitle || ""
  };
  app.activityLog.unshift(entry);
  app.activityLog = normalizeActivityLog(app.activityLog);
  saveApp({ activityId: entry.id });
  const logModal = document.getElementById("logModal");
  if (logModal && !logModal.classList.contains("hidden")) renderActivityLog();
  return entry;
}

function renderActivityLog() {
  const list = document.getElementById("activityLogList");
  if (!list) return;
  const entries = normalizeActivityLog([...(app.activityLog || []), ...restrictedAccessLogs])
    .filter(entry => LOGGED_ACTIVITY_ACTIONS.has(entry.action))
    .slice(0, 120);
  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">Nenhum registro de exclusão ou acesso restrito ainda.</div>';
    return;
  }
  list.innerHTML = entries.map(entry => `
    <div class="activity-entry">
      <strong>${escapeHtml(entry.action)}</strong>
      <span>${escapeHtml(activityActor(entry))} - ${escapeHtml(formatDateTime(entry.at))}</span>
      ${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ""}
      ${entry.profileName || entry.planTitle ? `<small>${escapeHtml([entry.profileName ? "Perfil: " + entry.profileName : "", entry.planTitle ? "Plano: " + entry.planTitle : ""].filter(Boolean).join(" | "))}</small>` : ""}
    </div>
  `).join("");
}

function activityActor(entry) {
  if (entry.userName && entry.userEmail) return `${entry.userName} (${entry.userEmail})`;
  return entry.userName || entry.userEmail || "Usuário";
}

function resetInactivityTimer(options = {}) {
  if (!currentUser || !cloudReady || inactivityLogoutInProgress) return;
  const now = Date.now();
  const force = !!options.force;
  if (!force && inactivityTimer && now - inactivityTimerResetAt < INACTIVITY_RESET_THROTTLE_MS) return;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    handleInactivityLogout().catch(error => console.warn("Falha ao encerrar por inatividade:", error));
  }, INACTIVITY_LOGOUT_MS);
  inactivityTimerResetAt = now;
  if (force || now - inactivityResetLogAt >= INACTIVITY_LOG_THROTTLE_MS) {
    inactivityResetLogAt = now;
    egressDiag("inactivity timer resetado", { timeoutMs: INACTIVITY_LOGOUT_MS });
  }
}

function clearInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;
  inactivityTimerResetAt = 0;
}

function clearHiddenSyncPauseTimer() {
  if (hiddenSyncPauseTimer) clearTimeout(hiddenSyncPauseTimer);
  hiddenSyncPauseTimer = null;
  hiddenAt = 0;
}

function clearSessionLifecycleTimers() {
  clearInactivityTimer();
  clearHiddenSyncPauseTimer();
}

async function handleInactivityLogout() {
  if (!currentUser || inactivityLogoutInProgress) return;
  inactivityLogoutInProgress = true;
  try {
    egressDiag("sessão encerrada por inatividade", {
      hasPendingCloudChanges: hasPendingCloudChanges(),
      readonly: isRestrictedAdminUser()
    });
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!isRestrictedAdminUser() && hasPendingCloudChanges()) {
      await saveAppToCloud({ source: "inactivity-logout" });
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    pendingSignOutMessage = "Sessão encerrada por inatividade.";
    stopSharedSync();
    clearSessionLifecycleTimers();
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    } else {
      currentUser = null;
      cloudReady = false;
      app = createEmptyApp();
      selectedActions.clear();
      renderApp();
      setAuthMessage("Sessão encerrada por inatividade.", "");
    }
  } finally {
    if (currentUser) inactivityLogoutInProgress = false;
  }
}

function setupSupabase() {
  if (!window.supabase || !window.supabase.createClient) {
    setAuthMessage("Não foi possível carregar o Supabase. Verifique sua conexão.", "error");
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: true
    }
  });
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      pendingPasswordRecovery = true;
      if (session && session.user) {
        hydrateUser(session.user).then(() => {
          openPasswordModal({ recovery: true });
          setPasswordMessage("Digite uma nova senha para concluir a redefinição.", "");
        });
      }
      return;
    }
    if (event === "SIGNED_OUT") {
      stopSharedSync();
      clearSessionLifecycleTimers();
      currentUser = null;
      cloudReady = false;
      app = createEmptyApp();
      selectedActions.clear();
      renderApp();
      const message = pendingSignOutMessage || authRedirectMessage || "Sessão encerrada.";
      const tone = pendingSignOutMessage ? "" : (authRedirectMessage ? "error" : "ok");
      pendingSignOutMessage = "";
      inactivityLogoutInProgress = false;
      setAuthMessage(message, tone);
      return;
    }
    if (session && session.user && (!currentUser || currentUser.id !== session.user.id)) {
      hydrateUser(session.user);
    }
  });
}

async function handleAuthRedirectParams() {
  const params = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search || "");
  const error = params.get("error") || query.get("error");
  const errorCode = params.get("error_code") || query.get("error_code");
  const errorDescription = params.get("error_description") || query.get("error_description");
  const type = params.get("type") || query.get("type");

  if (type === "recovery") {
    pendingPasswordRecovery = true;
    cleanAuthUrl();
    return;
  }

  if (!error && !errorCode && !errorDescription) return;
  authRedirectMessage = errorCode === "otp_expired"
    ? "O link de redefinição expirou ou já foi usado. Peça um novo link em \"Esqueci minha senha\"."
    : decodeURIComponent((errorDescription || error || "Não foi possível validar o link de acesso.").replace(/\+/g, " "));
  cleanAuthUrl();
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  cloudReady = false;
  app = createEmptyApp();
  setAuthMessage(authRedirectMessage, "error");
}

function cleanAuthUrl() {
  if (!window.history || !window.history.replaceState) return;
  window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
}

async function hydrateAuthenticatedUser() {
  if (!supabaseClient) return;
  if (!authRedirectMessage) setAuthMessage("Verificando sessão...", "");
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    setAuthMessage(error.message, "error");
    return;
  }
  if (data.session && data.session.user) {
    await hydrateUser(data.session.user);
  } else {
    app = createEmptyApp();
    currentUser = null;
    cloudReady = false;
    if (authRedirectMessage) setAuthMessage(authRedirectMessage, "error");
    else setAuthMessage("Entre ou crie um usuário para começar.", "");
  }
}

async function hydrateUser(user) {
  if (currentUser && currentUser.id === user.id && cloudReady) return;
  if (hydrateUserPromise && hydrateUserId === user.id) {
    egressDiag("hydrateUser reutilizando hidratação em andamento", { userId: user.id });
    return hydrateUserPromise;
  }
  hydrateUserId = user.id;
  hydrateUserPromise = (async () => {
    if (currentUser && currentUser.id !== user.id) stopSharedSync();
    currentUser = user;
    applyStoredTheme();
    cloudReady = false;
    setAuthMessage("Carregando seus dados do banco...", "");
    try {
      app = await loadAppFromCloud(user);
      await publishOwnProfileIfNeeded();
      await loadTeamProfiles();
      app.view = "profiles";
      app.activeProfileId = null;
      app.activeFolderId = DEFAULT_FOLDER_ID;
      app.activePlanId = null;
      cloudReady = true;
      startSharedSync();
      resetInactivityTimer({ force: true });
      const ownProfile = isRestrictedAdminUser(user) ? null : updateOwnLastAccess();
      recordActivity("Entrou no sistema", `Login realizado por ${user.email || "usuário"}.`, { profile: ownProfile || null });
      if (ownProfile) saveApp({ profileId: ownProfile.id });
      else saveApp({ localOnly: true });
      renderApp();
      setAuthMessage(`Conectado como ${user.email || "usuário"}.`, "ok");
      if (pendingPasswordRecovery) {
        pendingPasswordRecovery = false;
        openPasswordModal({ recovery: true });
        setPasswordMessage("Digite uma nova senha para concluir a redefinição.", "");
      }
    } catch (error) {
      console.error(error);
      app = createEmptyApp();
      cloudReady = false;
      stopSharedSync();
      renderApp();
      setAuthMessage("Login aceito, mas o banco compartilhado não abriu. Verifique a tabela shared_states, as políticas RLS e a conexão antes de usar.", "error");
      if (pendingPasswordRecovery) {
        pendingPasswordRecovery = false;
        openPasswordModal({ recovery: true });
        setPasswordMessage("Digite uma nova senha para concluir a redefinição.", "");
      }
    } finally {
      hydrateUserPromise = null;
      hydrateUserId = "";
    }
  })();
  return hydrateUserPromise;
}

async function handleLogin(event) {
  event.preventDefault();
  if (!supabaseClient) return setAuthMessage("Supabase não carregou. Atualize a página.", "error");
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) return setAuthMessage("Informe e-mail e senha.", "error");
  setAuthMessage("Entrando...", "");
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return setAuthMessage(error.message, "error");
  await hydrateUser(data.user);
}

async function handleSignup() {
  if (!supabaseClient) return setAuthMessage("Supabase não carregou. Atualize a página.", "error");
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) return setAuthMessage("Informe e-mail e senha para criar o usuário.", "error");
  if (password.length < 6) return setAuthMessage("A senha precisa ter pelo menos 6 caracteres.", "error");
  setAuthMessage("Criando usuário...", "");
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) return setAuthMessage(error.message, "error");
  if (data.session && data.user) {
    await hydrateUser(data.user);
  } else {
    setAuthMessage("Usuário criado. Se a confirmação por e-mail estiver ativa, confirme antes de entrar.", "ok");
  }
}

async function handleForgotPassword() {
  if (!supabaseClient) return setAuthMessage("Supabase não carregou. Atualize a página.", "error");
  const email = els.authEmail.value.trim();
  if (!email) return setAuthMessage("Informe seu e-mail para receber o link de redefinição.", "error");
  setAuthMessage("Enviando e-mail de redefinição...", "");
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  if (error) return setAuthMessage(error.message, "error");
  setAuthMessage("E-mail enviado. Abra o link recebido para criar uma nova senha.", "ok");
}

function openSettingsModal() {
  document.getElementById("settingsUserEmail").textContent = currentUser && currentUser.email ? currentUser.email : "Usuário conectado";
  document.getElementById("settingsLogBtn").classList.toggle("hidden", isRestrictedAdminUser());
  if (isRestrictedAdminUser()) {
    const list = document.getElementById("activityLogList");
    if (list) list.innerHTML = "";
  } else {
    renderActivityLog();
  }
  openModal("settingsModal");
}

function openPasswordModal(options = {}) {
  passwordRecoveryMode = !!options.recovery;
  const currentField = document.getElementById("currentPasswordField");
  const currentInput = document.getElementById("currentPasswordInput");
  document.getElementById("passwordForm").dataset.mode = passwordRecoveryMode ? "recovery" : "change";
  currentField.classList.toggle("hidden", passwordRecoveryMode);
  currentInput.required = !passwordRecoveryMode;
  currentInput.value = "";
  document.getElementById("newPasswordInput").value = "";
  document.getElementById("confirmPasswordInput").value = "";
  document.querySelectorAll("[data-toggle-password]").forEach(button => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (input) input.type = "password";
    button.classList.remove("is-visible");
    button.setAttribute("aria-pressed", "false");
    button.title = "Mostrar senha";
  });
  setPasswordMessage("", "");
  openModal("passwordModal");
  setTimeout(() => document.getElementById(passwordRecoveryMode ? "newPasswordInput" : "currentPasswordInput").focus(), 30);
}

function togglePasswordVisibility(event) {
  const button = event.currentTarget;
  const input = document.getElementById(button.dataset.togglePassword);
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.classList.toggle("is-visible", show);
  button.setAttribute("aria-pressed", String(show));
  button.title = show ? "Ocultar senha" : "Mostrar senha";
  button.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
}

async function handlePasswordChange(event) {
  event.preventDefault();
  if (!supabaseClient) return setPasswordMessage("Supabase não carregou. Atualize a página.", "error");
  const currentPassword = document.getElementById("currentPasswordInput").value;
  const password = document.getElementById("newPasswordInput").value;
  const confirmPassword = document.getElementById("confirmPasswordInput").value;
  const isRecovery = document.getElementById("passwordForm").dataset.mode === "recovery" || passwordRecoveryMode;
  if (!isRecovery && !currentPassword) return setPasswordMessage("Confirme sua senha atual.", "error");
  if (password.length < 6) return setPasswordMessage("A senha precisa ter pelo menos 6 caracteres.", "error");
  if (password !== confirmPassword) return setPasswordMessage("As senhas não conferem.", "error");
  setPasswordMessage("Atualizando senha...", "");
  if (!isRecovery) {
    const email = currentUser && currentUser.email ? currentUser.email : "";
    if (!email) return setPasswordMessage("Não foi possível identificar o e-mail do usuário conectado.", "error");
    const { data: verifyData, error: verifyError } = await supabaseClient.auth.signInWithPassword({ email, password: currentPassword });
    if (verifyError) return setPasswordMessage("Senha atual incorreta.", "error");
    if (!verifyData.user || verifyData.user.id !== currentUser.id) {
      return setPasswordMessage("A senha atual não pertence ao usuário conectado.", "error");
    }
    currentUser = verifyData.user;
  }
  const updatePayload = isRecovery ? { password } : { password, currentPassword };
  const { error } = await supabaseClient.auth.updateUser(updatePayload);
  if (error) return setPasswordMessage(error.message, "error");
  recordActivity("Alterou senha", "Senha do usuário conectado foi alterada.");
  setPasswordMessage("Senha alterada com sucesso.", "ok");
  setTimeout(() => closeModal("passwordModal"), 900);
}

async function handleSwitchUserLogin(event) {
  event.preventDefault();
  if (!supabaseClient) return setSwitchUserMessage("Supabase não carregou. Atualize a página.", "error");
  const email = document.getElementById("switchUserEmailInput").value.trim();
  const password = document.getElementById("switchUserPasswordInput").value;
  if (!email || !password) return setSwitchUserMessage("Informe a senha.", "error");
  if (!pendingProtectedAction) return setSwitchUserMessage("Nenhuma ação protegida em andamento.", "error");
  const action = pendingProtectedAction;
  const targetProfile = app.profiles.find(profile => profile.id === action.profileId);
  if (!targetProfile || normalizeText(targetProfile.email) !== normalizeText(email)) {
    return setSwitchUserMessage("Este perfil não está vinculado a este e-mail.", "error");
  }
  setSwitchUserMessage("Confirmando senha do perfil...", "");
  await flushCloudSave();
  const verifierClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const { data, error } = await verifierClient.auth.signInWithPassword({ email, password });
  await verifierClient.auth.signOut();
  if (error) return setSwitchUserMessage("Senha incorreta.", "error");
  if (!data.user || normalizeText(data.user.email) !== normalizeText(targetProfile.email)) {
    return setSwitchUserMessage("A senha informada não pertence a este perfil.", "error");
  }
  await syncSharedStateFromCloud({ force: true, allowWhileEditing: true, source: "protected-action-verified" });
  pendingProtectedAction = null;
  closeModal("switchUserModal");
  if (action.action === "edit") openProfileModal(action.profileId);
  if (action.action === "delete") await deleteProfile(action.profileId);
}

async function logout() {
  const ownProfile = updateOwnLastAccess();
  recordActivity("Saiu do sistema", "Logout realizado pelo usuário.");
  if (ownProfile) saveApp({ profileId: ownProfile.id });
  await flushCloudSave();
  if (supabaseClient) await supabaseClient.auth.signOut();
}

function setAuthMessage(message, tone) {
  els.authMessage.textContent = message || "";
  els.authMessage.classList.toggle("is-error", tone === "error");
  els.authMessage.classList.toggle("is-ok", tone === "ok");
}

function setPasswordMessage(message, tone) {
  els.passwordMessage.textContent = message || "";
  els.passwordMessage.classList.toggle("is-error", tone === "error");
  els.passwordMessage.classList.toggle("is-ok", tone === "ok");
}

function setSwitchUserMessage(message, tone) {
  els.switchUserMessage.textContent = message || "";
  els.switchUserMessage.classList.toggle("is-error", tone === "error");
  els.switchUserMessage.classList.toggle("is-ok", tone === "ok");
}
