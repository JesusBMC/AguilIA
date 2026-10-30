/**
 * AgilIA demo SPA driver (vanilla JS).
 *
 * Drives the full local flow against the Hono API:
 *   upload bundled sample -> render extracted data + findings + alerts
 *   -> show / download the generated draft -> record ACCEPT/REJECT decisions.
 *
 * Every fetch is wrapped: failures surface in the red error strip (no silent
 * failure). There is NO authentication here by design — a visible banner says
 * so; Amazon Cognito is the production auth boundary.
 */
(function () {
  "use strict";

  // Same origin when served by the Hono app; fall back to the local port when
  // the file is opened directly (file://). connect-src in the CSP allows both.
  var API_BASE =
    window.location.protocol === "file:" ? "http://localhost:8787" : "";

  // Bundled sample estudio previo (inconsistencias) so the demo surfaces
  // findings immediately without needing a separate file upload.
  var SAMPLE_TEXT = [
    "ESTUDIO PREVIO",
    "Proceso de contratacion - Procuraduria General de la Nacion",
    "",
    "Entidad: Procuraduria General de la Nacion",
    "Proceso: AGL-2026-PGN41",
    "Objeto: Adquisicion, implementacion y soporte tecnologico (soluciones audiovisuales, equipos de computo y perifericos) para la Procuraduria General de la Nacion",
    "Modalidad de seleccion: Seleccion abreviada - Bolsa de Productos (BMC)",
    "",
    "Presupuesto",
    "Valor total sin IVA: $51.460.675.487",
    "Valor total con IVA y costos: $61.587.261.594",
    "CDP No. 40626 por valor de $61.587.261.594",
    "",
    "Cronograma",
    "Fecha de publicacion: 10/06/2026",
    "Fecha de cierre: 20/06/2026",
    "Plazo de ejecucion: 180 dias",
    "",
    "Experiencia exigida: Suministro de minimo 500 equipos mas la implementacion de una plataforma de audiencias virtuales en un unico contrato previo.",
    "",
    "Garantias: Cumplimiento 20%, calidad de los bienes 20%, salarios y prestaciones 5%",
    "",
    "Items / bienes a adquirir:",
    "1. Computador todo en uno (AIO) avanzado, 23.8 pulgadas FHD, o equivalente - Cantidad: 3500 - Marca: Abierta (o equivalente)",
    "2. Monitor profesional 27 pulgadas, panel IPS, o equivalente - Cantidad: 800 - Marca: Abierta (o equivalente)",
    "3. Estacion de trabajo Mac Studio M3 Ultra - Cantidad: 5 - Marca: Apple",
    "4. Portatil MacBook Pro M5 - Cantidad: 20 - Marca: Apple",
    "5. Tableta iPad M5 - Cantidad: 15 - Marca: Apple",
  ].join("\n");

  var state = { documentId: null, record: null };

  // ---- small DOM helpers -------------------------------------------------
  function $(id) {
    return document.getElementById(id);
  }
  function text(node, value) {
    if (node) node.textContent = value == null ? "" : String(value);
  }
  function showError(message) {
    var strip = $("app-error");
    text($("app-error-msg"), message);
    if (strip) strip.hidden = false;
  }
  function clearError() {
    var strip = $("app-error");
    if (strip) strip.hidden = true;
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- API layer (all errors surfaced) -----------------------------------
  function api(path, options) {
    return fetch(API_BASE + path, options).then(function (res) {
      return res
        .json()
        .catch(function () {
          return null;
        })
        .then(function (body) {
          if (!res.ok) {
            var msg =
              body && body.error && body.error.message
                ? body.error.message
                : "Error HTTP " + res.status;
            throw new Error(msg);
          }
          return body;
        });
    });
  }

  function formatLocation(loc) {
    if (!loc) return "—";
    var parts = [];
    if (loc.section) parts.push("§ " + loc.section);
    if (typeof loc.line === "number") parts.push("línea " + loc.line);
    if (typeof loc.charStart === "number")
      parts.push("offset " + loc.charStart);
    return parts.length ? parts.join(" · ") : "—";
  }

  // ---- rendering ----------------------------------------------------------
  var FIELD_LABELS = {
    entidad: "Entidad",
    procesoId: "Proceso",
    objeto: "Objeto",
    modalidad: "Modalidad",
    valorSinIva: "Valor sin IVA",
    valorTotalConIva: "Valor total con IVA",
    cdpNumero: "CDP (número)",
    cdpValor: "CDP (valor)",
    fechaPublicacion: "Fecha de publicación",
    fechaCierre: "Fecha de cierre",
    plazoEjecucion: "Plazo de ejecución",
    experienciaExigida: "Experiencia exigida",
    garantias: "Garantías",
  };

  function renderExtracted(record) {
    var tbody = $("tbl-datos");
    if (!tbody) return;
    var extracted = record.extracted || {};
    var rows = [];

    Object.keys(FIELD_LABELS).forEach(function (key) {
      var field = extracted[key];
      if (!field || field.value === undefined || field.value === null) return;
      rows.push(
        "<tr>" +
          '<td class="px-3 py-2 text-slate-500">' +
          escapeHtml(FIELD_LABELS[key]) +
          "</td>" +
          '<td class="px-3 py-2 font-medium">' +
          escapeHtml(field.value) +
          "</td>" +
          '<td class="px-3 py-2 text-[11px] text-slate-500 whitespace-nowrap">📄 ' +
          escapeHtml(formatLocation(field.location)) +
          "</td>" +
          '<td class="px-3 py-2 text-emerald-600">✓</td>' +
          "</tr>",
      );
    });

    var items = extracted.items || [];
    items.forEach(function (item) {
      var numero = item.numero ? item.numero.value : "";
      var desc = item.descripcion ? item.descripcion.value : "";
      var marca = item.marca ? " · Marca: " + item.marca.value : "";
      rows.push(
        "<tr>" +
          '<td class="px-3 py-2 text-slate-500">Ítem ' +
          escapeHtml(numero) +
          "</td>" +
          '<td class="px-3 py-2 font-medium">' +
          escapeHtml(desc + marca) +
          "</td>" +
          '<td class="px-3 py-2 text-[11px] text-slate-500 whitespace-nowrap">📊 anexo técnico</td>' +
          '<td class="px-3 py-2 text-emerald-600">✓</td>' +
          "</tr>",
      );
    });

    tbody.innerHTML = rows.length
      ? rows.join("")
      : '<tr><td class="px-3 py-3 text-slate-400" colspan="4">No se extrajeron campos.</td></tr>';

    var findings = record.findings || [];
    text(
      $("badge-datos"),
      rows.length + " identificados",
    );
    text($("badge-revisar"), findings.length + " por revisar");

    var procId =
      extracted.procesoId && extracted.procesoId.value
        ? extracted.procesoId.value
        : "AGL-2026-PGN41";
    text($("proc-id"), procId);

    var alerts = record.alerts || [];
    $("resumen-analisis").innerHTML =
      "Estado: <b>" +
      escapeHtml(record.status) +
      "</b><br>Hallazgos: <b>" +
      findings.length +
      "</b><br>Alertas de riesgo: <b>" +
      alerts.length +
      "</b><br>Documento: <span class='font-mono'>" +
      escapeHtml(record.documentId) +
      "</span>";
  }

  var SEV_STYLES = {
    HIGH: { border: "border-red-500", chip: "bg-red-100 text-red-700", icon: "🔴" },
    MEDIUM: {
      border: "border-amber-500",
      chip: "bg-amber-100 text-amber-700",
      icon: "🟠",
    },
    LOW: {
      border: "border-slate-400",
      chip: "bg-slate-100 text-slate-600",
      icon: "🟡",
    },
  };

  function renderAlerts(record) {
    var container = $("alertas");
    if (!container) return;
    var findings = record.findings || [];
    text($("badge-alertas"), findings.length + " alertas");

    if (!findings.length) {
      container.innerHTML =
        '<div class="text-[12px] text-emerald-600">Sin hallazgos: documento coherente.</div>';
      return;
    }

    container.innerHTML = findings
      .map(function (f) {
        var style = SEV_STYLES[f.severity] || SEV_STYLES.LOW;
        return (
          '<div class="bg-white rounded-xl border-l-4 ' +
          style.border +
          ' border border-slate-200 p-3" data-finding="' +
          escapeHtml(f.id) +
          '">' +
          '<div class="flex justify-between items-start"><b>' +
          style.icon +
          " " +
          escapeHtml(f.message) +
          '</b><span class="text-[10px] px-2 py-0.5 rounded-full ' +
          style.chip +
          '">' +
          escapeHtml(f.severity) +
          "</span></div>" +
          '<div class="text-[11px] text-slate-500 my-1">Regla: ' +
          escapeHtml(f.ruleId) +
          " · Evidencia: " +
          escapeHtml(f.evidence) +
          "</div>" +
          '<textarea data-justif rows="2" placeholder="Justificación (obligatoria para rechazar)" class="w-full border rounded-lg px-2 py-1.5 text-[11px] bg-slate-50 outline-none focus:ring-1 focus:ring-emerald-400 mb-2"></textarea>' +
          '<div class="flex gap-2 items-center flex-wrap">' +
          '<button data-action="ACCEPT" class="px-2.5 py-1 rounded border border-emerald-300 text-emerald-700 text-[11px]">👍 Aceptar</button>' +
          '<button data-action="REJECT" class="px-2.5 py-1 rounded border border-red-300 text-red-700 text-[11px]">👎 Rechazar</button>' +
          '<span data-status class="text-[11px]"></span>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderDraft(draft) {
    text($("draft-content"), draft.content || "(borrador vacío)");
    text($("draft-version"), "v" + draft.version + " · " + draft.format);
    var btn = $("btn-download");
    if (btn) btn.disabled = false;
  }

  function renderSummary(record) {
    text($("stat-findings"), (record.findings || []).length);
    text($("stat-alerts"), (record.alerts || []).length);
    text($("stat-decisions"), (record.decisions || []).length);

    var tbody = $("tbl-decisiones");
    if (!tbody) return;
    var decisions = record.decisions || [];
    if (!decisions.length) {
      tbody.innerHTML =
        '<tr><td class="px-4 py-3 text-slate-400" colspan="3">Aún no hay decisiones registradas.</td></tr>';
      return;
    }
    tbody.innerHTML = decisions
      .map(function (d) {
        var chip =
          d.action === "ACCEPT"
            ? "bg-emerald-100 text-emerald-700"
            : "bg-amber-100 text-amber-700";
        return (
          "<tr>" +
          '<td class="px-4 py-2">' +
          escapeHtml(d.findingId) +
          "</td>" +
          '<td class="px-2 text-slate-400">' +
          escapeHtml(d.justification || "—") +
          "</td>" +
          '<td class="px-2"><span class="px-2 py-0.5 rounded-full ' +
          chip +
          '">' +
          escapeHtml(d.action) +
          "</span></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  // ---- flows --------------------------------------------------------------
  function refreshRecord() {
    if (!state.documentId) return Promise.resolve();
    return api("/documents/" + encodeURIComponent(state.documentId)).then(
      function (record) {
        state.record = record;
        renderExtracted(record);
        renderAlerts(record);
        renderSummary(record);
      },
    );
  }

  function loadDraft() {
    if (!state.documentId) return Promise.resolve();
    return api(
      "/documents/" + encodeURIComponent(state.documentId) + "/draft",
    ).then(function (draft) {
      renderDraft(draft);
    });
  }

  function doUpload() {
    clearError();
    var btn = $("btn-analizar");
    if (btn) btn.disabled = true;
    api("/documents/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "estudio_previo_pgn_inconsistencias.txt",
        text: SAMPLE_TEXT,
        metadata: { entidad: "Procuraduria General de la Nacion" },
      }),
    })
      .then(function (record) {
        state.documentId = record.documentId;
        return refreshRecord();
      })
      .then(function () {
        return loadDraft();
      })
      .catch(function (err) {
        showError("No se pudo analizar el documento: " + err.message);
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  function submitDecision(card, action) {
    if (!state.documentId) {
      showError("Primero analice un documento.");
      return;
    }
    clearError();
    var findingId = card.getAttribute("data-finding");
    var justifEl = card.querySelector("[data-justif]");
    var statusEl = card.querySelector("[data-status]");
    var justification = justifEl ? justifEl.value.trim() : "";

    if (action === "REJECT" && !justification) {
      text(statusEl, "⚠ La justificación es obligatoria para rechazar.");
      statusEl.className = "text-[11px] text-red-600";
      if (justifEl) justifEl.focus();
      return;
    }

    api(
      "/documents/" + encodeURIComponent(state.documentId) + "/decision",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingId: findingId,
          action: action,
          justification: justification,
        }),
      },
    )
      .then(function (res) {
        text(
          statusEl,
          (action === "ACCEPT" ? "✓ Aceptada" : "✓ Rechazada") +
            " · registrada " +
            new Date(res.recordedAt).toLocaleTimeString(),
        );
        statusEl.className =
          "text-[11px] " +
          (action === "ACCEPT" ? "text-emerald-700" : "text-red-700");
        return refreshRecord();
      })
      .catch(function (err) {
        showError("No se pudo registrar la decisión: " + err.message);
      });
  }

  function downloadDraft() {
    if (!state.documentId) return;
    clearError();
    api(
      "/documents/" +
        encodeURIComponent(state.documentId) +
        "/draft?download=1",
    )
      .then(function (draft) {
        var blob = new Blob([draft.content], {
          type: "text/markdown;charset=utf-8",
        });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "borrador-" + state.documentId + "-v" + draft.version + ".md";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(function (err) {
        showError("No se pudo descargar el borrador: " + err.message);
      });
  }

  // ---- wiring -------------------------------------------------------------
  function init() {
    var analizar = $("btn-analizar");
    if (analizar) analizar.addEventListener("click", doUpload);

    var recargar = $("btn-recargar-draft");
    if (recargar)
      recargar.addEventListener("click", function () {
        clearError();
        loadDraft().catch(function (err) {
          showError("No se pudo recargar el borrador: " + err.message);
        });
      });

    var download = $("btn-download");
    if (download) download.addEventListener("click", downloadDraft);

    var closeErr = $("app-error-close");
    if (closeErr) closeErr.addEventListener("click", clearError);

    var alertas = $("alertas");
    if (alertas)
      alertas.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
        if (!btn) return;
        var card = btn.closest("[data-finding]");
        if (card) submitDecision(card, btn.getAttribute("data-action"));
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
