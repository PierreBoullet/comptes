const categoryRules = [
  { match: ["leclerc", "lidl", "carrefour", "intermarche", "cafran"], category: "Courses" },
  { match: ["edf", "engie", "ekwateur", "sosh", "orange", "free", "ovh"], category: "Charges" },
  { match: ["essence", "total", "parking", "sncf", "peage"], category: "Voiture/Déplacement" },
  { match: ["pharmacie", "medecin", "docteur", "hopital"], category: "Medical" },
  { match: ["vinted", "kiabi", "decathlon"], category: "Vêtements" },
  { match: ["amazon", "cultura", "cinema", "netflix", "disney"], category: "Loisirs" },
  { match: ["leroy merlin", "brico", "castorama"], category: "Bricolage/Travaux" },
];

const colors = ["#0f766e", "#b45309", "#1d4ed8", "#be123c", "#6d5f13", "#047857", "#9333ea", "#475569", "#c2410c"];

const state = {
  transactions: [],
  filtered: [],
  categorySegments: [],
};

const elements = {
  reload: document.querySelector("#reload-data"),
  month: document.querySelector("#month-filter"),
  category: document.querySelector("#category-filter"),
  search: document.querySelector("#search-filter"),
  exportCsv: document.querySelector("#export-csv"),
  income: document.querySelector("#income-total"),
  expense: document.querySelector("#expense-total"),
  balance: document.querySelector("#balance-total"),
  count: document.querySelector("#transaction-count"),
  categoryCount: document.querySelector("#category-count"),
  donut: document.querySelector("#donut"),
  categoryList: document.querySelector("#category-list"),
  monthlyChart: document.querySelector("#monthly-chart"),
  table: document.querySelector("#transaction-table"),
  status: document.querySelector("#import-status"),
};

const floatingTooltip = document.createElement("div");
floatingTooltip.className = "floating-tooltip";
document.body.appendChild(floatingTooltip);

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let current = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows.filter((line) => line.some((cell) => cell.trim() !== ""));
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find(Boolean) || "";
  const candidates = [";", ",", "\t"];
  return candidates.sort((left, right) => firstLine.split(right).length - firstLine.split(left).length)[0];
}

function parseAmount(value) {
  const cleaned = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(/EUR|€/gi, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.+-]/g, "");
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function parseDate(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const french = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (french) {
    const year = Number(french[3].length === 2 ? `20${french[3]}` : french[3]);
    return new Date(year, Number(french[2]) - 1, Number(french[1]));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function findHeader(headers, aliases) {
  const normalized = headers.map(normalize);
  const index = aliases.findIndex((alias) => normalized.includes(normalize(alias)));
  if (index >= 0) return headers[normalized.indexOf(normalize(aliases[index]))];
  return null;
}

function categoryFor(label) {
  const normalizedLabel = normalize(label);
  const rule = categoryRules.find((entry) => entry.match.some((needle) => normalizedLabel.includes(normalize(needle))));
  return rule ? rule.category : "Divers";
}

function transactionsFromRows(rows, sourceName) {
  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  const dateHeader = findHeader(headers, ["date", "date operation", "date d operation", "date comptable"]);
  const labelHeader = findHeader(headers, ["libelle", "operation", "description", "intitule", "designation"]);
  const amountHeader = findHeader(headers, ["montant", "amount", "valeur"]);
  const debitHeader = findHeader(headers, ["debit", "retrait", "depense"]);
  const creditHeader = findHeader(headers, ["credit", "versement", "recette"]);
  const categoryHeader = findHeader(headers, ["categorie", "category"]);
  const sourceHeader = findHeader(headers, ["source", "fichier"]);

  if (!labelHeader || (!amountHeader && !debitHeader && !creditHeader)) {
    throw new Error("Colonnes attendues: Date, Libellé, Montant ou Débit/Crédit.");
  }

  return rows.slice(1).map((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]));
    const amount = amountHeader
      ? parseAmount(record[amountHeader])
      : parseAmount(record[creditHeader]) - parseAmount(record[debitHeader]);
    const label = String(record[labelHeader] || "").trim().replace(/\s+/g, " ");
    const operationDate = dateHeader ? parseDate(record[dateHeader]) : null;

    return {
      date: operationDate,
      label,
      amount,
      category: categoryHeader && record[categoryHeader] ? record[categoryHeader].trim() : categoryFor(label),
      source: sourceHeader && record[sourceHeader] ? record[sourceHeader].trim() : sourceName,
    };
  }).filter((transaction) => transaction.label && transaction.amount !== 0);
}

async function loadDataFiles() {
  elements.status.textContent = "Chargement des CSV du répertoire data...";
  try {
    const response = await fetch("/api/csv-files");
    if (!response.ok) throw new Error("Impossible de lister le répertoire data. Lance le serveur avec python server.py.");

    const files = await response.json();
    if (!files.length) {
      state.transactions = [];
      state.filtered = [];
      updateFilters();
      render();
      elements.status.textContent = "Aucun fichier CSV trouvé dans data.";
      return;
    }

    const loaded = await Promise.all(files.map(async (file) => {
      const csvResponse = await fetch(file.url);
      if (!csvResponse.ok) throw new Error(`Impossible de lire ${file.name}`);
      return transactionsFromRows(parseCsv(await csvResponse.text()), file.name);
    }));

    state.transactions = loaded.flat();
    updateFilters();
    applyFilters();
    elements.status.textContent = `${state.transactions.length} opérations chargées depuis ${files.length} fichier${files.length > 1 ? "s" : ""} CSV.`;
  } catch (error) {
    state.transactions = [];
    state.filtered = [];
    updateFilters();
    render();
    elements.status.textContent = error.message;
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function monthKey(date) {
  if (!date) return "Sans date";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  if (key === "Sans date") return key;
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function applyFilters() {
  const selectedMonth = elements.month.value;
  const selectedCategory = elements.category.value;
  const searched = normalize(elements.search.value);

  state.filtered = state.transactions.filter((transaction) => {
    const matchesMonth = selectedMonth === "all" || monthKey(transaction.date) === selectedMonth;
    const matchesCategory = selectedCategory === "all" || transaction.category === selectedCategory;
    const matchesSearch = !searched || normalize(transaction.label).includes(searched);
    return matchesMonth && matchesCategory && matchesSearch;
  });

  render();
}

function updateFilters() {
  const months = [...new Set(state.transactions.map((transaction) => monthKey(transaction.date)))].sort().reverse();
  const categories = [...new Set(state.transactions.map((transaction) => transaction.category))].sort((a, b) => a.localeCompare(b, "fr"));

  elements.month.innerHTML = '<option value="all">Tous</option>' + months.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(monthLabel(key))}</option>`).join("");
  elements.category.innerHTML = '<option value="all">Toutes</option>' + categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
}

function render() {
  const income = state.filtered.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
  const expense = state.filtered.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

  elements.income.textContent = formatCurrency(income);
  elements.expense.textContent = formatCurrency(expense);
  elements.balance.textContent = formatCurrency(income - expense);
  elements.balance.className = income - expense >= 0 ? "positive" : "negative";
  elements.count.textContent = String(state.filtered.length);

  renderCategories();
  renderMonthlyChart();
  renderTable();
}

function renderCategories() {
  const byCategory = new Map();
  state.filtered.filter((transaction) => transaction.amount < 0).forEach((transaction) => {
    byCategory.set(transaction.category, (byCategory.get(transaction.category) || 0) + Math.abs(transaction.amount));
  });

  const entries = [...byCategory.entries()].sort((left, right) => right[1] - left[1]);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  let cursor = 0;
  const gradient = entries.map(([category, amount], index) => {
    const start = cursor;
    const end = cursor + (amount / total) * 100;
    cursor = end;
    return `${colors[index % colors.length]} ${start}% ${end}%`;
  }).join(", ");

  elements.categoryCount.textContent = `${entries.length} catégorie${entries.length > 1 ? "s" : ""}`;
  state.categorySegments = entries.map(([category, amount], index) => {
    const previous = entries.slice(0, index).reduce((sum, [, entryAmount]) => sum + entryAmount, 0);
    return {
      category,
      amount,
      percent: total > 0 ? Math.round((amount / total) * 100) : 0,
      start: total > 0 ? (previous / total) * 100 : 0,
      end: total > 0 ? ((previous + amount) / total) * 100 : 0,
    };
  });
  delete elements.donut.dataset.tooltip;
  elements.donut.removeAttribute("title");
  elements.donut.style.background = total > 0 ? `conic-gradient(${gradient})` : "conic-gradient(var(--line) 0 100%)";
  elements.categoryList.innerHTML = entries.length ? entries.map(([category, amount], index) => {
    const percent = total > 0 ? Math.round((amount / total) * 100) : 0;
    const tooltip = `${category}: ${formatCurrency(amount)} (${percent}%)`;
    return `<div class="category-row" data-tooltip="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}">
      <i class="swatch" style="background:${colors[index % colors.length]}"></i>
      <strong>${escapeHtml(category)}</strong>
      <span>${formatCurrency(amount)} · ${percent}%</span>
    </div>`;
  }).join("") : '<p class="empty-state">Aucune dépense à afficher.</p>';
}

function hideFloatingTooltip() {
  floatingTooltip.classList.remove("visible");
}

function showFloatingTooltip(text, event) {
  floatingTooltip.textContent = text;
  floatingTooltip.style.left = `${event.clientX + 14}px`;
  floatingTooltip.style.top = `${event.clientY + 14}px`;
  floatingTooltip.classList.add("visible");
}

function segmentFromDonutEvent(event) {
  const rect = elements.donut.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const deltaX = event.clientX - centerX;
  const deltaY = event.clientY - centerY;
  const distance = Math.hypot(deltaX, deltaY);
  const outerRadius = rect.width / 2;
  const innerRadius = outerRadius - 48;

  if (distance < innerRadius || distance > outerRadius || !state.categorySegments.length) return null;

  const degrees = (Math.atan2(deltaX, -deltaY) * 180 / Math.PI + 360) % 360;
  const position = degrees / 360 * 100;
  return state.categorySegments.find((segment) => position >= segment.start && position <= segment.end) || null;
}

function renderMonthlyChart() {
  const byMonth = new Map();
  state.filtered.forEach((transaction) => {
    const key = monthKey(transaction.date);
    const current = byMonth.get(key) || { income: 0, expense: 0 };
    if (transaction.amount > 0) current.income += transaction.amount;
    if (transaction.amount < 0) current.expense += Math.abs(transaction.amount);
    byMonth.set(key, current);
  });

  const entries = [...byMonth.entries()].sort(([left], [right]) => left.localeCompare(right));
  const max = Math.max(1, ...entries.flatMap(([, value]) => [value.income, value.expense]));

  elements.monthlyChart.innerHTML = entries.length ? entries.map(([key, value]) => {
    const label = monthLabel(key);
    const incomeTooltip = `${label} - Recettes: ${formatCurrency(value.income)}`;
    const expenseTooltip = `${label} - Dépenses: ${formatCurrency(value.expense)}`;
    return `<div class="month-row">
    <strong>${escapeHtml(label)}</strong>
    <div class="bars">
      <div class="bar income" data-tooltip="${escapeHtml(incomeTooltip)}" title="${escapeHtml(incomeTooltip)}"><span style="width:${(value.income / max) * 100}%"></span></div>
      <div class="bar expense" data-tooltip="${escapeHtml(expenseTooltip)}" title="${escapeHtml(expenseTooltip)}"><span style="width:${(value.expense / max) * 100}%"></span></div>
    </div>
    <span>${formatCurrency(value.income - value.expense)}</span>
  </div>`;
  }).join("") : '<p class="empty-state">Aucune donnée mensuelle.</p>';
}

function renderTable() {
  const sorted = [...state.filtered].sort((left, right) => (right.date?.getTime() || 0) - (left.date?.getTime() || 0));
  elements.table.innerHTML = sorted.length ? sorted.map((transaction) => `<tr>
    <td>${transaction.date ? new Intl.DateTimeFormat("fr-FR").format(transaction.date) : ""}</td>
    <td>${escapeHtml(transaction.label)}</td>
    <td>${escapeHtml(transaction.category)}</td>
    <td>${escapeHtml(transaction.source || "")}</td>
    <td class="amount-cell ${transaction.amount >= 0 ? "positive" : "negative"}">${formatCurrency(transaction.amount)}</td>
  </tr>`).join("") : '<tr><td colspan="5" class="empty-state">Aucune opération ne correspond aux filtres.</td></tr>';
}

function exportCategorizedCsv() {
  const headers = ["Date", "Libellé", "Catégorie", "Source", "Montant"];
  const lines = [headers, ...state.filtered.map((transaction) => [
    transaction.date ? new Intl.DateTimeFormat("fr-FR").format(transaction.date) : "",
    transaction.label,
    transaction.category,
    transaction.source || "",
    String(transaction.amount).replace(".", ","),
  ])];
  const csv = lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "operations-classees.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

elements.reload.addEventListener("click", loadDataFiles);
elements.donut.addEventListener("mousemove", (event) => {
  const segment = segmentFromDonutEvent(event);
  if (!segment) {
    hideFloatingTooltip();
    return;
  }
  showFloatingTooltip(`${segment.category}: ${formatCurrency(segment.amount)} (${segment.percent}%)`, event);
});
elements.donut.addEventListener("mouseleave", hideFloatingTooltip);
elements.donut.addEventListener("click", (event) => {
  const segment = segmentFromDonutEvent(event);
  if (!segment) return;
  elements.category.value = segment.category;
  applyFilters();
  hideFloatingTooltip();
});
elements.month.addEventListener("change", applyFilters);
elements.category.addEventListener("change", applyFilters);
elements.search.addEventListener("input", applyFilters);
elements.exportCsv.addEventListener("click", exportCategorizedCsv);

render();
loadDataFiles();