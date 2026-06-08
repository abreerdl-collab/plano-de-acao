// Aplica o tema salvo antes da primeira pintura da pagina.

(function () {
  try {
    if (localStorage.getItem("planoDeAcaoSST.theme.v1") === "dark") {
      document.documentElement.dataset.theme = "dark";
    }
  } catch (error) {
    document.documentElement.dataset.theme = "light";
  }
})();
