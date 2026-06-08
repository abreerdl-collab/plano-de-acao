// Importacao e validacao de arquivos JSON.
"use strict";

function importJson(event) {
  if (blockRestrictedAdminAccess()) {
    event.target.value = "";
    return;
  }
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(reader.result);
      const imported = raw.version === 2 && Array.isArray(raw.profiles) ? normalizeApp(raw) : createAppFromLegacy(raw);
      if (!confirm("Importar este backup e substituir os dados atuais?")) return;
      Object.assign(app, imported);
      app.view = "profiles";
      selectedActions.clear();
      saveApp({ fullSave: true });
      renderApp();
    } catch (error) {
      alert("Não foi possível importar o arquivo JSON. Verifique se o backup é válido.");
      console.error(error);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}
