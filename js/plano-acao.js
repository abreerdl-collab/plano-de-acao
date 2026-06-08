// Logica principal e metadados do Plano de Acao.
"use strict";

function createPlanData(options) {
  const now = new Date().toISOString();
  const meta = {
    companyLogo: options.company || "Nome da Empresa",
    description: DEFAULT_DESCRIPTION,
    documentName: options.documentType || "PGR",
    company: options.company || "Empresa",
    technicalOwner: "SESMT / Consultoria",
    revisionDate: formatDateForMeta(new Date())
  };

  if (!options.useTemplate) {
    return { meta, actions: [], equipment: [], trainings: [] };
  }

  return {
    meta,
    actions: [
      { actionHtml: plainToRich("Implementar Ordem de Serviço (OS)"), responsible: "Empresa", when: "jan/26", priority: "Alta", progress: 0, status: "Não iniciado", observationHtml: "" },
      { actionHtml: plainToRich("Implementação ficha de EPI: fornecimento de luvas para proteção contra agentes químicos (luva látex) e registro em ficha de EPI. Estudar possibilidade de fornecimento de calçado de segurança."), responsible: "Empresa", when: "jan/26-jan/27", priority: "Alta", progress: 0, status: "Não iniciado", observationHtml: "" },
      { actionHtml: plainToRich("Revisão da Ordem de Serviço (atualizar conforme mudanças no ambiente de trabalho, processos e atividades. Recomenda-se revisão anual.)"), responsible: "Empresa/Consultoria", when: "", priority: "Alta", progress: 0, status: "Não iniciado", observationHtml: "" },
      { actionHtml: plainToRich("CIPA - segundo dimensionamento do Quadro I da NR-05"), responsible: "Empresa", when: "jan/26-jan/27", priority: "Alta", progress: 0, status: "Não iniciado", observationHtml: "" },
      { actionHtml: plainToRich("ASOs vigentes e atualizados dos funcionários"), responsible: "Empresa", when: "Segundo periodicidade do PCMSO", priority: "Alta", progress: 35, status: "Em andamento", observationHtml: "" },
      { actionHtml: plainToRich("Projeto AEP (Avaliação Ergonômica Preliminar + Fatores Psicossociais)"), responsible: "Empresa/Consultoria", when: "Implantação até mai/26", priority: "Alta", progress: 45, status: "Em andamento", observationHtml: "" },
      { actionHtml: plainToRich("Brigada / Prevenção contra Incêndios: manter observação das medidas de prevenção previstas na legislação e normas do corpo de bombeiros. Informar trabalhadores sobre uso de extintores, evacuação e alarmes. Manter extintores inspecionados e em suporte adequado."), responsible: "Empresa", when: "Inspeção/checklist periódico", priority: "Média", progress: 40, status: "Em andamento", observationHtml: "" },
      { actionHtml: plainToRich("Risco de queda (NR-18): proibições de uso de escada portátil conforme itens 18.8.6.8 a 18.8.6.12, incluindo uso de sapatas antiderrapantes, apoio em três pontos e isolamento de área."), responsible: "Empresa", when: "jan/26-jan/27", priority: "Média", progress: 40, status: "Em andamento", observationHtml: "" },
      { actionHtml: plainToRich("Gestão de documentação de Terceiros Contratados: cobrar PGR, PCMSO, ASOs, certificados de treinamentos, ficha de registro, Ordem de Serviço, comprovante de EPI."), responsible: "Empresa", when: "Sempre que houver novos serviços de terceiros", priority: "Média", progress: 40, status: "Em andamento", observationHtml: "" },
      { actionHtml: plainToRich("Ergonomia: para atividades em pé, recomendar pausas periódicas, alternância de postura e disponibilização de assento durante intervalos."), responsible: "Empresa", when: "Gestão ativa / Inspeção trimestral", priority: "Média", progress: 40, status: "Em andamento", observationHtml: "" },
      { actionHtml: plainToRich("Sinalização de Segurança (proibições, alertas, avisos, uso de EPIs)"), responsible: "Empresa", when: "jan/26-jan/27", priority: "Média", progress: 40, status: "Em andamento", observationHtml: "" },
      { actionHtml: plainToRich("Realização do mapa de risco por setor, em local visível."), responsible: "Empresa", when: "jan/26-jan/27", priority: "Baixa", progress: 0, status: "Não iniciado", observationHtml: "" }
    ].map(row => withBaseFields(row, now)),
    equipment: [
      { descriptionHtml: plainToRich("Cones ou sinalizadores para sinalizar a área em caso de emergência (rota de fuga, extintores, saída)"), responsible: "Empresa", status: "Não iniciado", observationHtml: "" },
      { descriptionHtml: plainToRich("Manual de procedimentos de emergência atualizado e acessível"), responsible: "Empresa", status: "Não iniciado", observationHtml: "" },
      { descriptionHtml: plainToRich("Kit de primeiros socorros"), responsible: "Empresa", status: "Não iniciado", observationHtml: "" }
    ].map(row => withBaseFields(row, now)),
    trainings: [
      { trainingHtml: plainToRich("Integração de novos funcionários"), responsible: "RH", when: "Na admissão", status: "Não iniciado", observationHtml: "" },
      { trainingHtml: plainToRich("Treinamento NR-06: Equipamentos de Proteção Individual, quando aplicável"), responsible: "Empresa/Consultoria", when: "Conforme aplicabilidade", status: "Não iniciado", observationHtml: "" },
      { trainingHtml: plainToRich("Treinamento CIPA"), responsible: "Empresa/Consultoria", when: "Conforme dimensionamento", status: "Não iniciado", observationHtml: "" }
    ].map(row => withBaseFields(row, now))
  };
}

function renderEditor() {
  const plan = currentPlan();
  if (!plan) return showFolders();
  els.planTitleInput.value = plan.title;
  els.planTitleInput.readOnly = isRestrictedAdminUser();
  renderRestrictedEditorUi();
  renderMetaFields();
  renderResponsibleControls();
  renderEditorTables();
  markSaved();
}

function renderRestrictedEditorUi() {
  const readOnly = isRestrictedAdminUser();
  ["templateActionField", "exportJsonBtn", "importJsonBtn", "applyBulkStatus", "deleteSelected"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.classList.toggle("hidden", readOnly);
  });
  if (els.bulkStatus) els.bulkStatus.classList.toggle("hidden", readOnly);
  if (els.selectAllActions) els.selectAllActions.disabled = readOnly;
  document.querySelectorAll("[data-add-section]").forEach(button => {
    button.classList.toggle("hidden", readOnly);
  });
}

function renderMetaFields() {
  const plan = currentPlan();
  if (!plan) return;
  const readOnly = isRestrictedAdminUser();
  document.querySelectorAll("[data-meta]").forEach(field => {
    const key = field.dataset.meta;
    if (field.classList && field.classList.contains("editable-text")) {
      field.textContent = plan.data.meta[key] || "";
      field.contentEditable = readOnly ? "false" : "true";
    } else {
      field.value = plan.data.meta[key] || "";
      field.disabled = readOnly;
    }
  });
}

function handleMetaInput(event) {
  if (isRestrictedAdminUser()) return;
  const plan = currentPlan();
  if (!plan) return;
  const field = event.currentTarget;
  const key = field.dataset.meta;
  plan.data.meta[key] = field.isContentEditable ? field.textContent.trim() : field.value;
  if (key === "company") plan.company = plan.data.meta[key];
  if (key === "documentName") plan.documentType = plan.data.meta[key];
  touchPlan(plan);
  saveApp();
  markSaved();
}

function currentProfile() {
  return app.profiles.find(profile => profile.id === app.activeProfileId) || null;
}

function currentPlan() {
  const profile = currentProfile();
  if (!profile) return null;
  return profile.plans.find(plan => plan.id === app.activePlanId) || null;
}

function currentPlanData() {
  const plan = currentPlan();
  return plan ? plan.data : null;
}

function getActiveFolder(profile) {
  return profile.folders.find(folder => folder.id === app.activeFolderId) || profile.folders.find(folder => folder.id === DEFAULT_FOLDER_ID) || profile.folders[0];
}

function ensureDefaultFolder(profile) {
  if (!profile.folders.some(folder => folder.id === DEFAULT_FOLDER_ID)) {
    profile.folders.unshift(createDefaultFolder());
  }
}

function getPlanStats(plan) {
  const actions = plan.data.actions || [];
  const total = actions.length;
  const done = actions.filter(row => row.status === "Concluído").length;
  const progress = total ? Math.round((done / total) * 100) : 0;
  return {
    progress,
    notStarted: actions.filter(row => row.status === "Não iniciado").length,
    inProgress: actions.filter(row => row.status === "Em andamento").length,
    done
  };
}
