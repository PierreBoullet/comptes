const colors = ["#0f766e", "#b45309", "#1d4ed8", "#be123c", "#6d5f13", "#047857", "#9333ea", "#475569", "#c2410c"];
const initialBalance = -951.4;
const filtersKey = "comptes.filters";

const state = {
  transactions: [],
  filtered: [],
  categorySegments: [],
  categoryRules: [],
  selectedKeys: new Set(),
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
  heroBalance: document.querySelector("#hero-balance-total"),
  count: document.querySelector("#transaction-count"),
  categoryCount: document.querySelector("#category-count"),
  donut: document.querySelector("#donut"),
  categoryList: document.querySelector("#category-list"),
  monthlyChart: document.querySelector("#monthly-chart"),
  table: document.querySelector("#transaction-table"),
  status: document.querySelector("#import-status"),
  selectedCount: document.querySelector("#selected-count"),
  bulkCategory: document.querySelector("#bulk-category"),
  applyBulkCategory: document.querySelector("#apply-bulk-category"),
  selectAll: document.querySelector("#select-all"),
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
  const rule = state.categoryRules.find((entry) => entry.match.some((needle) => normalizedLabel.includes(normalize(needle))));
  return rule ? rule.category : "Divers";
}

function typeFor(label, amount) {
  const normalizedLabel = normalize(label);
  const rule = state.categoryRules.find((entry) => entry.match.some((needle) => normalizedLabel.includes(normalize(needle))));
  return rule?.type || (amount >= 0 ? "Recettes" : "Dépenses");
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

  return rows.slice(1).map((row, rowIndex) => {
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
      type: typeFor(label, amount),
      source: sourceHeader && record[sourceHeader] ? record[sourceHeader].trim() : sourceName,
      csvFile: sourceName,
      csvRow: rowIndex + 2,
    };
  }).filter((transaction) => transaction.label && transaction.amount !== 0);
}

async function loadDataFiles() {
  elements.status.textContent = "Chargement de la base de référence...";
  try {
    const categoriesResponse = await fetch("/categories.json");
    if (!categoriesResponse.ok) throw new Error("Impossible de lire categories.json.");
    state.categoryRules = await categoriesResponse.json();

    const response = await fetch("/api/transactions");
    if (!response.ok) throw new Error("Impossible de lire la base de référence. Lance le serveur avec python server.py.");

    const payload = await response.json();
    if (!payload.transactions.length) {
      state.transactions = [];
      state.filtered = [];
      updateFilters();
      render();
      elements.status.textContent = "Aucune opération dans la base de référence.";
      return;
    }

    state.transactions = payload.transactions.map((transaction) => ({
      ...transaction,
      date: parseDate(transaction.date),
      csvFile: transaction.source_file,
      csvRow: transaction.source_row,
    }));
    updateFilters();
    restoreFilters();
    applyFilters();
    elements.status.textContent = `${state.transactions.length} opérations chargées depuis la base de référence.`;
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

function categoryOptions(selectedCategory) {
  const categories = [...new Set([
    ...state.categoryRules.map((rule) => rule.category),
    ...state.transactions.map((transaction) => transaction.category),
    selectedCategory,
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));

  return categories.map((category) => {
    const selected = category === selectedCategory ? " selected" : "";
    return `<option value="${escapeHtml(category)}"${selected}>${escapeHtml(category)}</option>`;
  }).join("");
}

function transactionKey(transaction) {
  return String(transaction.id);
}

function refreshBulkControls() {
  const visibleKeys = state.filtered.map(transactionKey);
  const selectedVisible = visibleKeys.filter((key) => state.selectedKeys.has(key));
  elements.selectedCount.textContent = String(state.selectedKeys.size);
  elements.applyBulkCategory.disabled = selectedVisible.length === 0;
  elements.selectAll.checked = visibleKeys.length > 0 && selectedVisible.length === visibleKeys.length;
  elements.selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleKeys.length;
}

async function persistTransactionCategory(transaction, category) {
  const response = await fetch(`/api/transactions/${transaction.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: transaction.label, category }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "La sauvegarde a échoué.");
}

async function applyBulkCategory() {
  const category = elements.bulkCategory.value;
  const selected = state.transactions.filter((transaction) => state.selectedKeys.has(transactionKey(transaction)));
  if (!category || !selected.length) return;

  elements.applyBulkCategory.disabled = true;
  elements.status.textContent = `Modification de ${selected.length} écriture(s) en cours...`;
  try {
    for (const transaction of selected) {
      await persistTransactionCategory(transaction, category);
    }
    selected.forEach((transaction) => { transaction.category = category; });
    state.selectedKeys.clear();
    applyFilters();
    elements.status.textContent = `${selected.length} écriture(s) modifiée(s).`;
  } catch (error) {
    elements.status.textContent = error.message;
    refreshBulkControls();
  }
}

async function saveTransactionEdit(transaction, updates) {
  const nextLabel = updates.label ?? transaction.label;
  const nextCategory = updates.category ?? transaction.category;
  const previous = { label: transaction.label, category: transaction.category };

  transaction.label = nextLabel;
  transaction.category = nextCategory;
  elements.status.textContent = "Sauvegarde de la modification...";

  try {
    const response = await fetch(`/api/transactions/${transaction.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: nextLabel, category: nextCategory }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "La sauvegarde a échoué.");
    applyFilters();
    elements.status.textContent = "Modification sauvegardée.";
  } catch (error) {
    transaction.label = previous.label;
    transaction.category = previous.category;
    applyFilters();
    elements.status.textContent = error.message;
  }
}

function applyFilters() {
  const selectedMonth = elements.month.value;
  const selectedCategory = elements.category.value;
  const searched = normalize(elements.search.value);

  saveFilters();

  state.filtered = state.transactions.filter((transaction) => {
    const matchesMonth = selectedMonth === "all" || monthKey(transaction.date) === selectedMonth;
    const matchesCategory = selectedCategory === "all" || transaction.category === selectedCategory;
    const matchesSearch = !searched || normalize(transaction.label).includes(searched);
    return matchesMonth && matchesCategory && matchesSearch;
  });

  render();
}

function updateFilters() {
  const selectedMonth = elements.month.value;
  const selectedCategory = elements.category.value;
  const months = [...new Set(state.transactions.map((transaction) => monthKey(transaction.date)))].sort().reverse();
  const categoriesByType = new Map([["Recettes", new Set()], ["Dépenses", new Set()]]);
  state.transactions.forEach((transaction) => categoriesByType.get(transaction.type)?.add(transaction.category));
  if (selectedCategory !== "all") {
    const selectedType = state.categoryRules.find((rule) => rule.category === selectedCategory)?.type || "Dépenses";
    categoriesByType.get(selectedType).add(selectedCategory);
  }

  elements.month.innerHTML = '<option value="all">Tous</option>' + months.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(monthLabel(key))}</option>`).join("");
  elements.category.innerHTML = '<option value="all">Toutes</option>' + [...categoriesByType.entries()].map(([type, categories]) => {
    const options = [...categories].sort((a, b) => a.localeCompare(b, "fr"));
    return options.length ? `<optgroup label="${type}">${options.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</optgroup>` : "";
  }).join("");
  if ([...elements.month.options].some((option) => option.value === selectedMonth)) {
    elements.month.value = selectedMonth;
  }
  if ([...elements.category.options].some((option) => option.value === selectedCategory)) {
    elements.category.value = selectedCategory;
  }
}

function saveFilters() {
  const filters = {
    month: elements.month.value,
    category: elements.category.value,
    search: elements.search.value,
  };
  localStorage.setItem(filtersKey, JSON.stringify(filters));
  const url = new URL(window.location.href);
  url.searchParams.set("month", filters.month);
  url.searchParams.set("category", filters.category);
  url.searchParams.set("search", filters.search);
  window.history.replaceState(null, "", url);
}

function restoreFilters() {
  const params = new URLSearchParams(window.location.search);
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(filtersKey) || "null");
  } catch {
    stored = null;
  }
  const saved = {
    month: params.get("month") || stored?.month || "all",
    category: params.get("category") || stored?.category || "all",
    search: params.get("search") ?? stored?.search ?? "",
  };
  if (!saved) return;

  if (saved.category && saved.category !== "all" && ![...elements.category.options].some((option) => option.value === saved.category)) {
    elements.category.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(saved.category)}">${escapeHtml(saved.category)}</option>`);
  }
  if ([...elements.month.options].some((option) => option.value === saved.month)) {
    elements.month.value = saved.month;
  }
  if ([...elements.category.options].some((option) => option.value === saved.category)) {
    elements.category.value = saved.category;
  }
  elements.search.value = saved.search || "";
}

function render() {
  const income = state.filtered.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
  const expense = state.filtered.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const balance = income - expense;
  const accountBalance = state.transactions.reduce((sum, transaction) => sum + transaction.amount, initialBalance);

  elements.income.textContent = formatCurrency(income);
  elements.expense.textContent = formatCurrency(expense);
  elements.balance.textContent = formatCurrency(balance);
  elements.balance.className = balance >= 0 ? "positive" : "negative";
  elements.heroBalance.textContent = formatCurrency(accountBalance);
  elements.heroBalance.className = accountBalance >= 0 ? "positive" : "negative";
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
  elements.table.innerHTML = sorted.length ? sorted.map((transaction) => `<tr data-csv-file="${escapeHtml(transaction.csvFile)}" data-csv-row="${transaction.csvRow}">
    <td class="select-cell"><input class="row-select" type="checkbox" ${state.selectedKeys.has(transactionKey(transaction)) ? "checked" : ""} aria-label="Sélectionner ${escapeHtml(transaction.label)}" /></td>
    <td>${transaction.date ? new Intl.DateTimeFormat("fr-FR").format(transaction.date) : ""}</td>
    <td><input class="table-edit" data-field="label" type="text" value="${escapeHtml(transaction.label)}" aria-label="Modifier le libellé" /></td>
    <td><select class="table-edit" data-field="category" aria-label="Modifier la catégorie">${categoryOptions(transaction.category)}</select></td>
    <td>${escapeHtml(transaction.source || "")}</td>
    <td class="amount-cell ${transaction.amount >= 0 ? "positive" : "negative"}">${formatCurrency(transaction.amount)}</td>
  </tr>`).join("") : '<tr><td colspan="6" class="empty-state">Aucune opération ne correspond aux filtres.</td></tr>';
  elements.bulkCategory.innerHTML = categoryOptions("");
  refreshBulkControls();
}

function transactionFromEditedControl(control) {
  const row = control.closest("tr");
  if (!row) return null;
  const csvFile = row.dataset.csvFile;
  const csvRow = Number(row.dataset.csvRow);
  return state.transactions.find((transaction) => transaction.csvFile === csvFile && transaction.csvRow === csvRow) || null;
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
elements.month.addEventListener("change", () => {
  saveFilters();
  applyFilters();
});
elements.category.addEventListener("change", () => {
  saveFilters();
  applyFilters();
});
elements.search.addEventListener("input", () => {
  saveFilters();
  applyFilters();
});
elements.exportCsv.addEventListener("click", exportCategorizedCsv);
window.addEventListener("beforeunload", saveFilters);
elements.applyBulkCategory.addEventListener("click", applyBulkCategory);
elements.selectAll.addEventListener("change", () => {
  state.filtered.forEach((transaction) => {
    const key = transactionKey(transaction);
    if (elements.selectAll.checked) state.selectedKeys.add(key);
    else state.selectedKeys.delete(key);
  });
  renderTable();
});
elements.table.addEventListener("change", (event) => {
  const control = event.target.closest(".table-edit");
  if (!control) return;
  const transaction = transactionFromEditedControl(control);
  if (!transaction) return;
  const value = control.value.trim();
  if (!value || value === transaction[control.dataset.field]) return;
  saveTransactionEdit(transaction, { [control.dataset.field]: value });
});
elements.table.addEventListener("change", (event) => {
  const control = event.target.closest(".row-select");
  if (!control) return;
  const transaction = transactionFromEditedControl(control);
  if (!transaction) return;
  const key = transactionKey(transaction);
  if (control.checked) state.selectedKeys.add(key);
  else state.selectedKeys.delete(key);
  refreshBulkControls();
});

render();
loadDataFiles();