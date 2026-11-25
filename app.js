"use strict";

const STORAGE_KEY = "fieldnote-workspace-v1";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const currencyCodes = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : ["CAD", "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "INR"];
const currencyNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "currency" }) : null;
const currencyDigits = (currency = "CAD") => new Intl.NumberFormat("en-CA", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
const currencyScale = (currency = "CAD") => 10 ** currencyDigits(currency);
const money = (amount, currency = "CAD") => new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(amount / currencyScale(currency));
const minorAmount = (value, currency) => Math.round(Number(value) * currencyScale(currency));
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const displayDate = (value) => {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
};
const capitalise = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let workspace = { settings: {}, documents: [], customers: [], services: [], usage: {} };
let storageAvailable = true;
let currentDocumentId = null;
let filter = "all";
let toastTimer;
let editingCustomerId = null;
let editingServiceId = null;

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("visible"), 4500);
}

function loadWorkspace() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed.settings !== "object" || !Array.isArray(parsed.documents)) throw new Error("Invalid workspace data");
      workspace = { ...parsed, customers: parsed.customers || [], services: parsed.services || [], usage: parsed.usage || {} };
    }
  } catch (error) {
    storageAvailable = false;
    console.error("Could not load workspace:", error);
    toast("Could not load local data. Changes cannot be saved in this browser.", true);
  }
}

function persist(nextWorkspace) {
  if (!storageAvailable) {
    toast("Local storage is unavailable. Your changes were not saved.", true);
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextWorkspace));
    workspace = nextWorkspace;
    return true;
  } catch (error) {
    console.error("Could not save workspace:", error);
    toast("Could not save. Check browser storage or try a smaller logo.", true);
    return false;
  }
}

function lineTotal(item) {
  const quantity = Math.round(item.quantity * 100);
  if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(item.rateCents)) return NaN;
  return Number((BigInt(quantity) * BigInt(item.rateCents) + 50n) / 100n);
}

function roundedRatio(value, multiplier, divisor) {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(multiplier)) return NaN;
  return Number((BigInt(value) * BigInt(multiplier) + BigInt(divisor / 2)) / BigInt(divisor));
}

function calculate(doc) {
  const subtotal = doc.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const discount = doc.discountType === "percent" ? roundedRatio(subtotal, Math.round((doc.discountValue || 0) * 100), 10000) : minorAmount(doc.discountValue || 0, doc.currency || "CAD");
  const taxable = subtotal - discount;
  const tax = doc.applyHst && taxable >= 0 ? roundedRatio(taxable, 13, 100) : 0;
  const total = taxable + tax;
  const deposit = doc.depositCents || 0;
  return { subtotal, discount, tax, total, deposit, balance: total - deposit };
}

function currencyTotals(documents, field) {
  const totals = new Map();
  documents.forEach((doc) => {
    const currency = doc.currency || "CAD";
    totals.set(currency, (totals.get(currency) || 0) + calculate(doc)[field]);
  });
  return totals.size ? [...totals].map(([currency, total]) => money(total, currency)).join(" · ") : money(0, workspace.settings.currency || "CAD");
}

function currentUsage() {
  return workspace.usage[localDate().slice(0, 7)] || { quote: 0, invoice: 0 };
}

function fillCurrencies() {
  const options = currencyCodes.map((code) => `<option value="${code}">${code} — ${escapeHTML(currencyNames ? currencyNames.of(code) : code)}</option>`).join("");
  $$(".currency-select").forEach((select) => { select.innerHTML = options; });
}

function showView(view) {
  if (!["overview", "documents", "customers", "services", "settings"].includes(view)) return;
  $$(".view").forEach((element) => element.classList.toggle("hidden", element.id !== `${view}-view`));
  $$(".nav-link").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $("#breadcrumb-current").textContent = { overview: "Overview", documents: "Documents", customers: "Customers", services: "Saved services", settings: "Business settings" }[view];
  if (view === "settings") fillSettings();
  window.scrollTo(0, 0);
}

function emptyState(title, description, createButton = false) {
  return `<div class="empty-state"><div class="empty-icon"><svg><use href="#i-file"></use></svg></div><h3>${title}</h3><p>${description}</p>${createButton ? '<button class="text-button new-document">Create a document <svg><use href="#i-arrow"></use></svg></button>' : ""}</div>`;
}

function documentTable(documents, emptyMessage) {
  if (!documents.length) return emptyState(emptyMessage, "Everything you create will be right here when you need it.", true);
  return `<div class="table-wrap"><table><thead><tr><th>DOCUMENT</th><th>CUSTOMER</th><th>DATE</th><th>AMOUNT</th><th>STATUS</th><th></th></tr></thead><tbody>${documents.map((doc) => `<tr><td><button class="document-link" data-action="preview" data-id="${escapeHTML(doc.id)}">${escapeHTML(doc.number)}</button><span class="doc-sub">${capitalise(doc.type)}</span></td><td><strong>${escapeHTML(doc.customer)}</strong></td><td>${escapeHTML(displayDate(doc.issueDate))}</td><td><strong>${money(calculate(doc).total, doc.currency || "CAD")}</strong></td><td><span class="status status-${escapeHTML(doc.status)}">${escapeHTML(doc.status)}</span></td><td><div class="row-actions"><button data-action="preview" data-id="${escapeHTML(doc.id)}" aria-label="View ${escapeHTML(doc.number)}"><svg><use href="#i-chevron"></use></svg></button><button data-action="delete" data-id="${escapeHTML(doc.id)}" aria-label="Delete ${escapeHTML(doc.number)}"><svg><use href="#i-trash"></use></svg></button></div></td></tr>`).join("")}</tbody></table></div>`;
}

function render() {
  const docs = [...workspace.documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $("#nav-count").textContent = docs.length;
  $("#stat-documents").textContent = docs.length;
  $("#stat-pending").textContent = docs.filter((doc) => doc.status === "sent").length;
  $("#stat-paid").textContent = currencyTotals(docs.filter((doc) => doc.type === "invoice" && doc.status === "paid"), "total");
  const outstanding = docs.filter((doc) => doc.type === "invoice" && doc.status === "sent");
  const overdue = outstanding.filter((doc) => doc.dueDate && doc.dueDate < localDate());
  $("#stat-outstanding").textContent = currencyTotals(outstanding, "balance");
  $("#stat-overdue").textContent = currencyTotals(overdue, "balance");
  $("#stat-overdue-count").textContent = `${overdue.length} ${overdue.length === 1 ? "invoice" : "invoices"} past their due date`;
  $("#stat-quotes").textContent = docs.filter((doc) => doc.type === "quote" && doc.status === "sent").length;
  const usage = currentUsage();
  $("#plan-usage").textContent = `${usage.quote} of 5 quotes · ${usage.invoice} of 5 invoices this month`;
  $("#recent-documents").innerHTML = documentTable(docs.slice(0, 5), "Your next great job starts here");
  const query = $("#document-search").value.trim().toLowerCase();
  const filtered = docs.filter((doc) => (filter === "all" || doc.type === filter) && `${doc.number} ${doc.customer}`.toLowerCase().includes(query));
  $("#all-documents").innerHTML = documentTable(filtered, docs.length ? "No matching documents" : "No documents just yet");
  $("#customers-list").innerHTML = workspace.customers.length ? `<div class="table-wrap"><table><thead><tr><th>CUSTOMER</th><th>EMAIL</th><th>PHONE</th><th>ADDRESS</th><th></th></tr></thead><tbody>${workspace.customers.map((customer) => `<tr><td><strong>${escapeHTML(customer.name)}</strong></td><td>${escapeHTML(customer.email || "—")}</td><td>${escapeHTML(customer.phone || "—")}</td><td>${escapeHTML(customer.address || "—")}</td><td><div class="row-actions"><button data-action="edit-customer" data-id="${escapeHTML(customer.id)}">Edit</button><button data-action="delete-customer" data-id="${escapeHTML(customer.id)}">Delete</button></div></td></tr>`).join("")}</tbody></table></div>` : emptyState("No saved customers yet", "Save a customer above to reuse their details.");
  const documentCustomers = new Map();
  docs.forEach((doc) => {
    const key = doc.customer.trim().toLowerCase();
    if (!documentCustomers.has(key) && !workspace.customers.some((customer) => customer.name.trim().toLowerCase() === key)) documentCustomers.set(key, doc);
  });
  if (documentCustomers.size) $("#customers-list").insertAdjacentHTML("beforeend", `<div class="derived-customers"><strong>Customers from your documents</strong><p>Save these details to reuse them on future documents.</p></div><div class="table-wrap"><table><thead><tr><th>CUSTOMER</th><th>EMAIL</th><th>PHONE</th><th></th></tr></thead><tbody>${[...documentCustomers.values()].map((doc) => `<tr><td><strong>${escapeHTML(doc.customer)}</strong></td><td>${escapeHTML(doc.customerEmail || "—")}</td><td>${escapeHTML(doc.phone || "—")}</td><td><div class="row-actions"><button data-action="use-document-customer" data-id="${escapeHTML(doc.id)}">Save details</button></div></td></tr>`).join("")}</tbody></table></div>`);
  $("#services-list").innerHTML = workspace.services.length ? `<div class="table-wrap"><table><thead><tr><th>DESCRIPTION</th><th>RATE</th><th></th></tr></thead><tbody>${workspace.services.map((service) => `<tr><td><strong>${escapeHTML(service.description)}</strong></td><td>${money(service.rateCents, service.currency || "CAD")}</td><td><div class="row-actions"><button data-action="edit-service" data-id="${escapeHTML(service.id)}">Edit</button><button data-action="delete-service" data-id="${escapeHTML(service.id)}">Delete</button></div></td></tr>`).join("")}</tbody></table></div>` : emptyState("No saved services yet", "Save a service above to reuse it in your documents.");
  const business = workspace.settings.businessName || "Your business";
  $("#profile-name").textContent = business;
  $("#profile-avatar").textContent = business.charAt(0).toUpperCase();
  $("#top-avatar").textContent = business.charAt(0).toUpperCase();
}

function nextNumber(type) {
  const prefix = type === "invoice" ? "INV" : "QUO";
  const max = workspace.documents.reduce((highest, doc) => {
    const match = doc.number.match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function lineMarkup(item = {}) {
  const currency = $("#document-form").elements.currency.value || "CAD";
  const digits = currencyDigits(currency);
  return `<div class="line-item"><label class="line-field line-description"><span class="line-mobile-label">Description</span><input name="description" aria-label="Line item description" placeholder="e.g. Labour and materials" maxlength="160" required value="${escapeHTML(item.description || "")}"></label><label class="line-field line-quantity"><span class="line-mobile-label">Quantity</span><input name="quantity" aria-label="Quantity" type="number" min="0.01" max="100000" step="0.01" required value="${escapeHTML(item.quantity ?? 1)}"></label><label class="line-field line-rate"><span class="line-mobile-label">Rate</span><input name="rate" aria-label="Rate" type="number" min="0" max="1000000" step="${1 / currencyScale(currency)}" required value="${escapeHTML(item.rateCents != null ? (item.rateCents / currencyScale(currency)).toFixed(digits) : "")}" placeholder="0"></label><div class="line-amount"><span class="line-mobile-label">Amount</span><span class="line-amount-value"></span></div><button type="button" class="remove-line" aria-label="Remove line item"><svg><use href="#i-trash"></use></svg></button></div>`;
}

function itemsFromForm() {
  return $$(".line-item", $("#line-items")).map((row) => ({
    description: $('[name="description"]', row).value.trim(),
    quantity: Number($('[name="quantity"]', row).value),
    rateCents: minorAmount($('[name="rate"]', row).value, $("#document-form").elements.currency.value)
  }));
}

function updateTotals() {
  const items = itemsFromForm();
  const form = $("#document-form");
  const currency = form.elements.currency.value;
  $$(".line-item", $("#line-items")).forEach((row, index) => {
    $(".line-amount-value", row).textContent = money(lineTotal(items[index]), currency);
  });
  const amounts = calculate({ items, currency, applyHst: form.elements.applyHst.checked, discountType: form.elements.discountType.value, discountValue: Number(form.elements.discountValue.value), depositCents: minorAmount(form.elements.deposit.value, currency) });
  $("#form-subtotal").textContent = money(amounts.subtotal, currency);
  $("#form-discount").textContent = `−${money(amounts.discount, currency)}`;
  $("#form-tax").textContent = money(amounts.tax, currency);
  $("#form-total").textContent = money(amounts.total, currency);
  $("#form-deposit").textContent = `−${money(amounts.deposit, currency)}`;
  $("#form-balance").textContent = money(amounts.balance, currency);
}

function updateCurrencyControls() {
  const form = $("#document-form");
  const currency = form.elements.currency.value;
  const step = 1 / currencyScale(currency);
  $$('[name="rate"]', $("#line-items")).forEach((input) => { input.step = step; });
  form.elements.deposit.step = step;
  form.elements.discountValue.step = form.elements.discountType.value === "percent" ? "0.01" : step;
  form.elements.discountType.options[0].textContent = `Fixed amount (${currency})`;
  form.elements.deposit.parentElement.firstChild.textContent = `Deposit received (${currency}) `;
  $(".grand-total small").textContent = currency;
  $("#service-select").innerHTML = '<option value="">Choose a service</option>' + workspace.services.filter((service) => (service.currency || "CAD") === currency).map((service) => `<option value="${escapeHTML(service.id)}">${escapeHTML(service.description)} — ${money(service.rateCents, currency)}</option>`).join("");
}

function setStatusOptions(type, value = "draft") {
  const status = $("#document-form").elements.status;
  status.innerHTML = `<option value="draft">Draft</option><option value="sent">Sent</option>${type === "quote" ? '<option value="approved">Approved</option>' : '<option value="paid">Paid</option>'}`;
  status.value = [...status.options].some((option) => option.value === value) ? value : "draft";
}

function openEditor(doc = null, convert = false) {
  const form = $("#document-form");
  form.reset();
  documentLogo.reset(workspace.settings.logo);
  currentDocumentId = doc && !convert ? doc.id : null;
  $("#editor-title").textContent = convert ? "Create invoice from quote" : doc ? "Edit document" : "New document";
  form.elements.type.value = convert ? "invoice" : doc?.type || "quote";
  form.elements.type.disabled = Boolean(doc && !convert);
  form.elements.currency.value = doc?.currency || workspace.settings.currency || "CAD";
  form.elements.design.value = doc?.design || "classic";
  form.elements.number.value = convert ? nextNumber("invoice") : doc?.number || nextNumber(form.elements.type.value);
  form.elements.customer.value = doc?.customer || "";
  form.elements.customerEmail.value = doc?.customerEmail || "";
  form.elements.customerAddress.value = doc?.customerAddress || "";
  form.elements.phone.value = doc?.phone || "";
  form.elements.issueDate.value = convert ? localDate() : doc?.issueDate || localDate();
  form.elements.dueDate.value = convert ? "" : doc?.dueDate || "";
  form.elements.notes.value = doc?.notes || "";
  form.elements.paymentTerms.value = doc?.paymentTerms || "";
  form.elements.discountType.value = doc?.discountType || "fixed";
  form.elements.discountValue.value = doc?.discountValue || 0;
  form.elements.deposit.value = (doc?.depositCents || 0) / currencyScale(form.elements.currency.value);
  form.elements.applyHst.checked = doc ? doc.applyHst : true;
  setStatusOptions(form.elements.type.value, convert ? "draft" : doc?.status);
  $("#customer-select").innerHTML = '<option value="">Select a customer</option>' + workspace.customers.map((customer) => `<option value="${escapeHTML(customer.id)}">${escapeHTML(customer.name)}</option>`).join("");
  $("#line-items").innerHTML = (doc?.items || [{}]).map(lineMarkup).join("");
  updateCurrencyControls();
  updateTotals();
  $("#document-dialog").showModal();
}

function fillSettings() {
  const form = $("#settings-form");
  ["businessName", "businessEmail", "businessPhone", "hstNumber", "businessAddress"].forEach((key) => { form.elements[key].value = workspace.settings[key] || ""; });
  $("#currency-form").elements.currency.value = workspace.settings.currency || "CAD";
  settingsLogo.reset(workspace.settings.logo);
}

function createLogoControl(input, image, remove) {
  let value = "";
  let version = 0;
  let reading = false;
  function update(logo) {
    value = logo || "";
    image.classList.toggle("hidden", !value);
    remove.classList.toggle("hidden", !value);
    if (value) image.src = value;
    else image.removeAttribute("src");
  }
  function reset(logo) {
    version++;
    reading = false;
    input.value = "";
    update(logo);
  }
  input.addEventListener("change", () => {
    const file = input.files[0];
    const currentVersion = ++version;
    reading = false;
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1024 * 1024) {
      input.value = "";
      toast("Choose a PNG, JPG, or WebP image up to 1 MB.", true);
      return;
    }
    const reader = new FileReader();
    reading = true;
    reader.onload = () => {
      if (currentVersion !== version) return;
      reading = false;
      update(reader.result);
    };
    reader.onerror = () => {
      if (currentVersion !== version) return;
      reading = false;
      toast("Could not read the logo file.", true);
    };
    reader.readAsDataURL(file);
  });
  remove.addEventListener("click", () => reset(""));
  return { reset, get value() { return value; }, get reading() { return reading; } };
}

const settingsLogo = createLogoControl($("#logo-input"), $("#logo-preview"), $("#remove-logo"));
const documentLogo = createLogoControl($("#document-logo-input"), $("#document-logo-preview"), $("#remove-document-logo"));

function documentMarkup(doc) {
  const settings = workspace.settings;
  const amounts = calculate(doc);
  const currency = doc.currency || "CAD";
  const design = ["classic", "modern", "bold", "minimal", "warm"].includes(doc.design) ? doc.design : "classic";
  const businessDetails = [settings.businessAddress, settings.businessEmail, settings.businessPhone, settings.hstNumber ? `HST: ${settings.hstNumber}` : ""].filter(Boolean).map(escapeHTML).join("\n");
  const customerDetails = [doc.customerAddress, doc.customerEmail, doc.phone].filter(Boolean).map(escapeHTML).join("\n");
  return `<article class="print-document design-${design}"><div class="print-top"><div>${settings.logo ? `<img class="print-logo" src="${escapeHTML(settings.logo)}" alt="Business logo">` : ""}<div class="print-business"><strong>${escapeHTML(settings.businessName || "Your business")}</strong>${businessDetails ? `\n${businessDetails}` : ""}</div></div><div class="print-type"><h2>${escapeHTML(doc.type)}</h2><span>${escapeHTML(doc.number)}</span></div></div><div class="print-details"><div><small>${doc.type === "invoice" ? "BILL TO" : "PREPARED FOR"}</small><strong>${escapeHTML(doc.customer)}</strong>${customerDetails ? `<div class="print-customer-details">${customerDetails}</div>` : ""}</div><div class="print-dates"><small>ISSUED</small>${escapeHTML(displayDate(doc.issueDate))}${doc.dueDate ? `<small>${doc.type === "invoice" ? "DUE" : "VALID UNTIL"}</small>${escapeHTML(displayDate(doc.dueDate))}` : ""}</div></div><div class="table-wrap"><table class="print-table"><thead><tr><th>DESCRIPTION</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr></thead><tbody>${doc.items.map((item) => `<tr><td>${escapeHTML(item.description)}</td><td>${escapeHTML(item.quantity)}</td><td>${money(item.rateCents, currency)}</td><td>${money(lineTotal(item), currency)}</td></tr>`).join("")}</tbody></table></div><div class="print-totals"><div><span>Subtotal</span><strong>${money(amounts.subtotal, currency)}</strong></div>${amounts.discount ? `<div><span>Discount${doc.discountType === "percent" ? ` (${escapeHTML(doc.discountValue)}%)` : ""}</span><strong>−${money(amounts.discount, currency)}</strong></div>` : ""}<div><span>HST ${doc.applyHst ? "(13%)" : "(not applied)"}</span><strong>${money(amounts.tax, currency)}</strong></div><div><span>Total ${currency}</span><strong>${money(amounts.total, currency)}</strong></div>${amounts.deposit ? `<div><span>Deposit received</span><strong>−${money(amounts.deposit, currency)}</strong></div>` : ""}<div class="print-grand"><span>Balance due ${currency}</span><strong>${money(amounts.balance, currency)}</strong></div></div>${doc.paymentTerms ? `<div class="print-terms"><strong>Payment terms</strong>${escapeHTML(doc.paymentTerms)}</div>` : ""}${doc.notes ? `<div class="print-notes"><strong>Notes</strong>${escapeHTML(doc.notes)}</div>` : ""}<div class="print-thanks">Thank you for your business.</div><div class="print-credit">Created with Fieldnote</div></article>`;
}

function preview(doc) {
  currentDocumentId = doc.id;
  $("#convert-invoice").classList.toggle("hidden", doc.type !== "quote");
  $("#printable-document").innerHTML = documentMarkup(doc);
  $("#preview-dialog").showModal();
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) showView(viewButton.dataset.view);
  if (event.target.closest(".new-document")) openEditor();
  if (event.target.closest(".close-dialog")) $("#document-dialog").close();
  if (event.target.closest(".close-preview")) $("#preview-dialog").close();
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "use-document-customer") {
    const doc = workspace.documents.find((item) => item.id === action.dataset.id);
    if (!doc) return;
    resetSavedItemForm("customer");
    const form = $("#customer-form");
    form.elements.name.value = doc.customer;
    form.elements.email.value = doc.customerEmail || "";
    form.elements.phone.value = doc.phone || "";
    form.elements.address.value = doc.customerAddress || "";
    form.elements.name.focus();
    return;
  }
  if (action.dataset.action.endsWith("-customer") || action.dataset.action.endsWith("-service")) {
    handleSavedItemAction(action.dataset.action, action.dataset.id);
    return;
  }
  const doc = workspace.documents.find((item) => item.id === action.dataset.id);
  if (!doc) return;
  if (action.dataset.action === "preview") preview(doc);
  if (action.dataset.action === "delete" && window.confirm(`Delete ${doc.number}? This cannot be undone.`)) {
    if (persist({ ...workspace, documents: workspace.documents.filter((item) => item.id !== doc.id) })) {
      render();
      toast("Document deleted.");
    }
  }
});

$("#document-search").addEventListener("input", render);
$$(".tab").forEach((tab) => tab.addEventListener("click", () => {
  filter = tab.dataset.filter;
  $$(".tab").forEach((item) => item.classList.toggle("active", item === tab));
  render();
}));

$("#add-line").addEventListener("click", () => {
  $("#line-items").insertAdjacentHTML("beforeend", lineMarkup());
  updateTotals();
});
$("#customer-select").addEventListener("change", (event) => {
  const customer = workspace.customers.find((item) => item.id === event.target.value);
  if (!customer) return;
  const form = $("#document-form");
  form.elements.customer.value = customer.name;
  form.elements.customerEmail.value = customer.email;
  form.elements.phone.value = customer.phone;
  form.elements.customerAddress.value = customer.address;
});
$("#service-select").addEventListener("change", (event) => {
  const service = workspace.services.find((item) => item.id === event.target.value);
  if (!service) return;
  const rows = $$(".line-item", $("#line-items"));
  const emptyRow = rows.find((row) => !$('[name="description"]', row).value && !$('[name="rate"]', row).value);
  if (emptyRow) emptyRow.outerHTML = lineMarkup(service);
  else $("#line-items").insertAdjacentHTML("beforeend", lineMarkup(service));
  event.target.value = "";
  updateTotals();
});
$("#line-items").addEventListener("click", (event) => {
  const remove = event.target.closest(".remove-line");
  if (!remove) return;
  if ($$(".line-item", $("#line-items")).length === 1) {
    toast("Keep at least one line item.", true);
    return;
  }
  remove.closest(".line-item").remove();
  updateTotals();
});
$("#document-form").addEventListener("input", updateTotals);
$("#document-form").elements.currency.addEventListener("change", () => { updateCurrencyControls(); updateTotals(); });
$("#document-form").elements.discountType.addEventListener("change", () => { updateCurrencyControls(); updateTotals(); });
$("#document-form").elements.type.addEventListener("change", (event) => {
  const form = $("#document-form");
  const previous = event.target.value === "quote" ? "INV" : "QUO";
  if (!currentDocumentId && new RegExp(`^${previous}-\\d+$`).test(form.elements.number.value)) form.elements.number.value = nextNumber(event.target.value);
  setStatusOptions(event.target.value, form.elements.status.value);
});
$("#document-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (documentLogo.reading) {
    toast("Please wait for the logo to finish loading.", true);
    return;
  }
  const form = event.currentTarget;
  const items = itemsFromForm();
  if (!form.elements.customer.value.trim() || !form.elements.number.value.trim() || items.some((item) => !item.description || !Number.isFinite(item.quantity) || !Number.isFinite(item.rateCents))) {
    toast("Please complete the customer, document number, and line items.", true);
    return;
  }
  const discountValue = Number(form.elements.discountValue.value);
  const currency = form.elements.currency.value;
  const depositCents = minorAmount(form.elements.deposit.value, currency);
  const amounts = calculate({ items, currency, applyHst: form.elements.applyHst.checked, discountType: form.elements.discountType.value, discountValue, depositCents });
  if (!Number.isSafeInteger(amounts.subtotal) || !Number.isSafeInteger(amounts.total)) {
    toast("Document total is too large to calculate safely.", true);
    return;
  }
  if (!Number.isFinite(discountValue) || discountValue < 0 || (form.elements.discountType.value === "percent" && discountValue > 100) || amounts.discount > amounts.subtotal || !Number.isSafeInteger(depositCents) || depositCents < 0 || depositCents > amounts.total) {
    toast("Discount cannot exceed the subtotal, and deposit cannot exceed the total.", true);
    return;
  }
  const doc = {
    id: currentDocumentId || newId(),
    type: form.elements.type.value,
    currency,
    design: form.elements.design.value,
    number: form.elements.number.value.trim(),
    customer: form.elements.customer.value.trim(),
    customerEmail: form.elements.customerEmail.value.trim(),
    customerAddress: form.elements.customerAddress.value.trim(),
    phone: form.elements.phone.value.trim(),
    issueDate: form.elements.issueDate.value,
    dueDate: form.elements.dueDate.value,
    status: form.elements.status.value,
    notes: form.elements.notes.value.trim(),
    paymentTerms: form.elements.paymentTerms.value.trim(),
    discountType: form.elements.discountType.value,
    discountValue,
    depositCents,
    applyHst: form.elements.applyHst.checked,
    items,
    updatedAt: new Date().toISOString()
  };
  const month = localDate().slice(0, 7);
  const monthUsage = currentUsage();
  if (!currentDocumentId && monthUsage[doc.type] >= 5) {
    toast(`Free limit reached: 5 ${doc.type}s this month. Unlimited upgrade will be available when billing is connected.`, true);
    return;
  }
  const usage = currentDocumentId ? workspace.usage : { ...workspace.usage, [month]: { ...monthUsage, [doc.type]: monthUsage[doc.type] + 1 } };
  const documents = currentDocumentId ? workspace.documents.map((item) => item.id === currentDocumentId ? doc : item) : [...workspace.documents, doc];
  if (persist({ ...workspace, settings: { ...workspace.settings, logo: documentLogo.value }, documents, usage })) {
    $("#document-dialog").close();
    render();
    toast("Document saved.");
    preview(doc);
  }
});

$("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (settingsLogo.reading) {
    toast("Please wait for the logo to finish loading.", true);
    return;
  }
  const form = event.currentTarget;
  const settings = { ...workspace.settings, logo: settingsLogo.value };
  ["businessName", "businessEmail", "businessPhone", "hstNumber", "businessAddress"].forEach((key) => { settings[key] = form.elements[key].value.trim(); });
  if (persist({ ...workspace, settings })) {
    render();
    toast("Business settings saved.");
  }
});
$("#currency-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const currency = event.currentTarget.elements.currency.value;
  if (persist({ ...workspace, settings: { ...workspace.settings, currency } })) {
    $("#service-form").elements.currency.value = currency;
    $("#service-form").elements.rate.step = 1 / currencyScale(currency);
    render();
    toast("Preferred currency saved.");
  }
});
$("#upgrade-plan").addEventListener("click", () => toast("Unlimited upgrade will be available after hosting and Stripe billing are connected."));

function resetSavedItemForm(kind) {
  $(`#${kind}-form`).reset();
  if (kind === "service") {
    $("#service-form").elements.currency.value = workspace.settings.currency || "CAD";
    $("#service-form").elements.rate.step = 1 / currencyScale($("#service-form").elements.currency.value);
  }
  $(`#cancel-${kind}`).hidden = true;
  if (kind === "customer") editingCustomerId = null;
  else editingServiceId = null;
}

function handleSavedItemAction(action, id) {
  const [operation, kind] = action.split("-");
  const collection = kind === "customer" ? "customers" : "services";
  const item = workspace[collection].find((entry) => entry.id === id);
  if (!item) return;
  if (operation === "edit") {
    const form = $(`#${kind}-form`);
    if (kind === "customer") {
      editingCustomerId = id;
      ["name", "email", "phone", "address"].forEach((key) => { form.elements[key].value = item[key] || ""; });
    } else {
      editingServiceId = id;
      form.elements.description.value = item.description;
      form.elements.currency.value = item.currency || "CAD";
      form.elements.rate.step = 1 / currencyScale(form.elements.currency.value);
      form.elements.rate.value = (item.rateCents / currencyScale(form.elements.currency.value)).toFixed(currencyDigits(form.elements.currency.value));
    }
    $(`#cancel-${kind}`).hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements[kind === "customer" ? "name" : "description"].focus();
  } else if (operation === "delete" && window.confirm(`Delete this saved ${kind}? Existing documents will not be changed.`)) {
    if (persist({ ...workspace, [collection]: workspace[collection].filter((entry) => entry.id !== id) })) {
      resetSavedItemForm(kind);
      render();
      toast(`Saved ${kind} deleted.`);
    }
  }
}

$("#cancel-customer").addEventListener("click", () => resetSavedItemForm("customer"));
$("#cancel-service").addEventListener("click", () => resetSavedItemForm("service"));
$("#customer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  if (!name) {
    toast("Enter a customer name.", true);
    return;
  }
  const customer = { id: editingCustomerId || newId(), name, email: form.elements.email.value.trim(), phone: form.elements.phone.value.trim(), address: form.elements.address.value.trim() };
  const customers = editingCustomerId ? workspace.customers.map((item) => item.id === editingCustomerId ? customer : item) : [...workspace.customers, customer];
  if (persist({ ...workspace, customers })) {
    resetSavedItemForm("customer");
    render();
    toast("Customer saved.");
  }
});
$("#service-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const description = form.elements.description.value.trim();
  if (!description) {
    toast("Enter a service description.", true);
    return;
  }
  const currency = form.elements.currency.value;
  const service = { id: editingServiceId || newId(), description, currency, rateCents: minorAmount(form.elements.rate.value, currency) };
  const services = editingServiceId ? workspace.services.map((item) => item.id === editingServiceId ? service : item) : [...workspace.services, service];
  if (persist({ ...workspace, services })) {
    resetSavedItemForm("service");
    render();
    toast("Service saved.");
  }
});
$("#service-form").elements.currency.addEventListener("change", (event) => { $("#service-form").elements.rate.step = 1 / currencyScale(event.target.value); });

function validateBackup(data) {
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = (value, max, optional = false) => (optional && value === undefined) || (typeof value === "string" && value.length <= max);
  const date = (value, optional = false) => (optional && (!value || value === undefined)) || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
  const uniqueIds = (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length;
  if (!object(data) || data.format !== "fieldnote-backup" || data.version !== 1 || !object(data.workspace)) throw new Error("Not a supported Fieldnote backup.");
  const imported = data.workspace;
  if (!object(imported.settings) || !Array.isArray(imported.documents) || !Array.isArray(imported.customers) || !Array.isArray(imported.services)) throw new Error("Backup is missing workspace data.");
  const settings = imported.settings;
  if (settings.currency !== undefined && !currencyCodes.includes(settings.currency)) throw new Error("Unsupported preferred currency.");
  if (imported.usage !== undefined && (!object(imported.usage) || Object.entries(imported.usage).some(([month, counts]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !object(counts) || !Number.isSafeInteger(counts.quote) || counts.quote < 0 || !Number.isSafeInteger(counts.invoice) || counts.invoice < 0))) throw new Error("Invalid monthly usage.");
  if (!["businessName", "businessEmail", "businessPhone", "hstNumber", "businessAddress"].every((key) => text(settings[key], 240, true)) || !text(settings.logo, 1500000, true) || (settings.logo && !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(settings.logo))) throw new Error("Invalid business settings.");
  if (!imported.customers.every((item) => object(item) && text(item.id, 100) && item.id && text(item.name, 120) && item.name.trim() && ["email", "phone", "address"].every((key) => text(item[key], 240))) || !uniqueIds(imported.customers)) throw new Error("Invalid saved customers.");
  if (!imported.services.every((item) => object(item) && text(item.id, 100) && item.id && text(item.description, 160) && item.description.trim() && (item.currency === undefined || currencyCodes.includes(item.currency)) && Number.isSafeInteger(item.rateCents) && item.rateCents >= 0 && item.rateCents <= 1000000 * currencyScale(item.currency || "CAD")) || !uniqueIds(imported.services)) throw new Error("Invalid saved services.");
  if (!uniqueIds(imported.documents)) throw new Error("Duplicate document IDs.");
  for (const doc of imported.documents) {
    if (!object(doc) || !text(doc.id, 100) || !doc.id || !["quote", "invoice"].includes(doc.type) || !text(doc.number, 40) || !doc.number.trim() || !text(doc.customer, 120) || !doc.customer.trim() || !["draft", "sent", doc.type === "quote" ? "approved" : "paid"].includes(doc.status) || !date(doc.issueDate) || !date(doc.dueDate, true) || !text(doc.updatedAt, 50) || Number.isNaN(Date.parse(doc.updatedAt)) || typeof doc.applyHst !== "boolean" || !["phone", "customerEmail", "customerAddress", "paymentTerms", "notes"].every((key) => text(doc[key], 1000, true)) || !Array.isArray(doc.items) || !doc.items.length || doc.items.length > 1000) throw new Error("Invalid document details.");
    if (doc.currency !== undefined && !currencyCodes.includes(doc.currency)) throw new Error("Unsupported document currency.");
    if (doc.design !== undefined && !["classic", "modern", "bold", "minimal", "warm"].includes(doc.design)) throw new Error("Invalid document design.");
    if (!doc.items.every((item) => object(item) && text(item.description, 160) && item.description.trim() && typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity >= 0.01 && item.quantity <= 100000 && Math.abs(item.quantity * 100 - Math.round(item.quantity * 100)) < 0.000001 && Number.isSafeInteger(item.rateCents) && item.rateCents >= 0 && item.rateCents <= 1000000 * currencyScale(doc.currency || "CAD"))) throw new Error("Invalid line item.");
    if (doc.discountType !== undefined && !["fixed", "percent"].includes(doc.discountType)) throw new Error("Invalid discount type.");
    if (doc.discountValue !== undefined && (typeof doc.discountValue !== "number" || !Number.isFinite(doc.discountValue) || doc.discountValue < 0 || doc.discountValue > (doc.discountType === "percent" ? 100 : 1000000))) throw new Error("Invalid discount.");
    if (doc.depositCents !== undefined && (!Number.isSafeInteger(doc.depositCents) || doc.depositCents < 0 || doc.depositCents > 1000000 * currencyScale(doc.currency || "CAD"))) throw new Error("Invalid deposit.");
    const amounts = calculate(doc);
    if (!Number.isSafeInteger(amounts.total) || amounts.discount > amounts.subtotal || amounts.deposit > amounts.total) throw new Error("Invalid document totals.");
  }
  return { ...imported, usage: imported.usage || {} };
}

$("#export-backup").addEventListener("click", () => {
  const file = new Blob([JSON.stringify({ format: "fieldnote-backup", version: 1, workspace }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fieldnote-backup-${localDate()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup downloaded. Store it somewhere safe.");
});
$("#choose-backup").addEventListener("click", () => $("#import-backup").click());
$("#import-backup").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast("Backup must be smaller than 10 MB.", true);
    return;
  }
  try {
    const imported = validateBackup(JSON.parse(await file.text()));
    if (!window.confirm("Restore this backup? It will replace all current documents, customers, services, and settings in this browser.")) return;
    for (const [month, counts] of Object.entries(workspace.usage)) {
      const restored = imported.usage[month] || { quote: 0, invoice: 0 };
      imported.usage[month] = { quote: Math.max(counts.quote, restored.quote), invoice: Math.max(counts.invoice, restored.invoice) };
    }
    if (persist(imported)) {
      resetSavedItemForm("customer");
      resetSavedItemForm("service");
      fillSettings();
      render();
      toast("Backup restored.");
    }
  } catch (error) {
    console.error("Could not restore backup:", error);
    toast(`Could not restore backup: ${error.message}`, true);
  }
});
$("#edit-document").addEventListener("click", () => {
  const doc = workspace.documents.find((item) => item.id === currentDocumentId);
  if (!doc) return;
  $("#preview-dialog").close();
  openEditor(doc);
});
$("#convert-invoice").addEventListener("click", () => {
  const doc = workspace.documents.find((item) => item.id === currentDocumentId);
  if (!doc || doc.type !== "quote") return;
  $("#preview-dialog").close();
  openEditor(doc, true);
});
$("#print-document").addEventListener("click", () => window.print());

function jpegFileName(doc) {
  const name = doc.number.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim().replace(/[. ]+$/, "");
  return `${name || doc.type}.jpg`;
}

async function createJpeg(doc) {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser cannot create an image.");
  const operations = [];
  const palettes = {
    classic: { ink: "#304136", muted: "#718074", tint: "#f3f6f0", accent: "#839a79" },
    modern: { ink: "#203b5b", muted: "#687f98", tint: "#eaf1f8", accent: "#3d78a9" },
    bold: { ink: "#233b30", muted: "#687d70", tint: "#dce9df", accent: "#244c38" },
    minimal: { ink: "#252525", muted: "#737373", tint: "#f5f5f5", accent: "#555555" },
    warm: { ink: "#5c3a2f", muted: "#98786b", tint: "#fbefe8", accent: "#b86f4f" }
  };
  const palette = palettes[doc.design] || palettes.classic;
  const ink = palette.ink;
  const muted = palette.muted;
  const currency = doc.currency || "CAD";
  const font = (size, bold = false) => `${bold ? "bold " : ""}${size}px Tahoma, Arial, sans-serif`;
  const text = (value, x, y, style = {}) => operations.push({ type: "text", value: String(value), x, y, ...style });
  const line = (y) => operations.push({ type: "line", y });
  const wrap = (value, width, fontStyle) => {
    context.font = fontStyle;
    const lines = [];
    for (const paragraph of String(value).replace(/\r\n?/g, "\n").split("\n")) {
      let current = "";
      for (const token of paragraph.split(/(\s+)/u)) {
        if (!token) continue;
        if (context.measureText(current + token).width <= width) {
          current += token;
          continue;
        }
        if (current.trim()) lines.push(current.trimEnd());
        current = "";
        if (!token.trim()) continue;
        for (const character of Array.from(token)) {
          if (current && context.measureText(current + character).width > width) {
            lines.push(current);
            current = "";
          }
          current += character;
        }
      }
      lines.push(current.trimEnd());
    }
    return lines;
  };
  const block = (value, x, y, width, fontStyle, color = ink, align = "left", leading = 28) => {
    const lines = wrap(value, width, fontStyle);
    lines.forEach((value, index) => text(value, x, y + index * leading, { fontStyle, color, align }));
    return y + lines.length * leading;
  };
  const rightText = (value, x, y, width, bold = false) => {
    let size = 20;
    context.font = font(size, bold);
    while (size > 12 && context.measureText(String(value)).width > width) context.font = font(--size, bold);
    text(value, x, y, { fontStyle: font(size, bold), color: ink, align: "right" });
  };
  const settings = workspace.settings;
  const amounts = calculate(doc);
  if (doc.design && doc.design !== "classic") operations.push({ type: "rect", x: 80, y: 44, width: 1080, height: doc.design === "bold" ? 12 : 4, color: palette.accent });
  let logo = null;
  if (settings.logo) {
    logo = new Image();
    logo.src = settings.logo;
    await logo.decode();
    if (!logo.naturalWidth || !logo.naturalHeight) throw new Error("The business logo could not be loaded.");
  }
  let leftY = 80;
  if (logo) {
    const scale = Math.min(180 / logo.naturalWidth, 100 / logo.naturalHeight);
    const width = logo.naturalWidth * scale;
    const height = logo.naturalHeight * scale;
    operations.push({ type: "image", image: logo, x: 80, y: leftY, width, height });
    leftY += height + 18;
  }
  leftY = block(settings.businessName || "Your business", 80, leftY, 560, font(25, true), ink, "left", 32);
  for (const detail of [settings.businessAddress, settings.businessEmail, settings.businessPhone, settings.hstNumber ? `HST: ${settings.hstNumber}` : ""]) {
    if (detail) leftY = block(detail, 80, leftY, 560, font(19), muted, "left", 27);
  }
  let rightY = block(capitalise(doc.type), 1160, 80, 440, font(48, true), ink, "right", 57);
  rightY = block(doc.number, 1160, rightY + 8, 440, font(20), muted, "right", 27);
  let y = Math.max(leftY, rightY) + 60;
  text(doc.type === "invoice" ? "BILL TO" : "PREPARED FOR", 80, y, { fontStyle: font(16, true), color: muted });
  text("ISSUED", 1160, y, { fontStyle: font(16, true), color: muted, align: "right" });
  let customerY = block(doc.customer, 80, y + 30, 610, font(24, true), ink, "left", 32);
  for (const detail of [doc.customerAddress, doc.customerEmail, doc.phone]) {
    if (detail) customerY = block(detail, 80, customerY, 610, font(19), muted, "left", 27);
  }
  let dateY = block(displayDate(doc.issueDate), 1160, y + 30, 350, font(19), muted, "right", 27);
  if (doc.dueDate) {
    text(doc.type === "invoice" ? "DUE" : "VALID UNTIL", 1160, dateY + 14, { fontStyle: font(16, true), color: muted, align: "right" });
    dateY = block(displayDate(doc.dueDate), 1160, dateY + 40, 350, font(19), muted, "right", 27);
  }
  y = Math.max(customerY, dateY) + 50;
  operations.push({ type: "rect", x: 80, y, width: 1080, height: 45, color: palette.tint });
  text("DESCRIPTION", 90, y + 13, { fontStyle: font(15, true), color: muted });
  for (const [label, x] of [["QTY", 795], ["RATE", 970], ["AMOUNT", 1150]]) text(label, x, y + 13, { fontStyle: font(15, true), color: muted, align: "right" });
  y += 60;
  for (const item of doc.items) {
    const end = block(item.description, 90, y, 560, font(19), ink, "left", 27);
    rightText(item.quantity, 795, y, 120);
    rightText(money(item.rateCents, currency), 970, y, 160);
    rightText(money(lineTotal(item), currency), 1150, y, 170);
    y = Math.max(end, y + 27) + 16;
    line(y);
    y += 16;
  }
  y += 12;
  const totalRow = (label, amount, bold = false) => {
    text(label, 760, y, { fontStyle: font(bold ? 22 : 19, bold), color: bold ? ink : muted });
    rightText(amount, 1150, y, 230, bold);
    y += 36;
  };
  totalRow("Subtotal", money(amounts.subtotal, currency));
  if (amounts.discount) totalRow(`Discount${doc.discountType === "percent" ? ` (${doc.discountValue}%)` : ""}`, `−${money(amounts.discount, currency)}`);
  totalRow(`HST ${doc.applyHst ? "(13%)" : "(not applied)"}`, money(amounts.tax, currency));
  totalRow(`Total ${currency}`, money(amounts.total, currency));
  if (amounts.deposit) totalRow("Deposit received", `−${money(amounts.deposit, currency)}`);
  line(y);
  y += 16;
  totalRow(`Balance due ${currency}`, money(amounts.balance, currency), true);
  for (const [label, value] of [["Payment terms", doc.paymentTerms], ["Notes", doc.notes]]) {
    if (!value) continue;
    y += 35;
    text(label, 80, y, { fontStyle: font(20, true), color: ink });
    y = block(value, 80, y + 32, 1080, font(19), muted, "left", 27);
  }
  y += 60;
  line(y);
  text("Thank you for your business.", 80, y + 24, { fontStyle: font(23), color: palette.accent });
  text("Created with Fieldnote", 1160, y + 65, { fontStyle: font(15), color: muted, align: "right" });
  const height = Math.max(1754, Math.ceil(y + 110));
  if (height > 16000) throw new Error("This document is too long to save as one JPEG. Use PDF instead.");
  canvas.height = height;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = "top";
  for (const operation of operations) {
    if (operation.type === "image") context.drawImage(operation.image, operation.x, operation.y, operation.width, operation.height);
    else if (operation.type === "rect") {
      context.fillStyle = operation.color;
      context.fillRect(operation.x, operation.y, operation.width, operation.height);
    } else if (operation.type === "line") {
      context.strokeStyle = "#e6ece4";
      context.beginPath();
      context.moveTo(80, operation.y);
      context.lineTo(1160, operation.y);
      context.stroke();
    } else {
      context.fillStyle = operation.color || ink;
      context.font = operation.fontStyle || font(19);
      context.textAlign = operation.align || "left";
      context.fillText(operation.value, operation.x, operation.y);
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob && blob.type === "image/jpeg" ? resolve(blob) : reject(new Error("Your browser could not encode the JPEG.")), "image/jpeg", 0.92));
}

$("#export-jpeg").addEventListener("click", async (event) => {
  const doc = workspace.documents.find((item) => item.id === currentDocumentId);
  if (!doc) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const blob = await createJpeg(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = jpegFileName(doc);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("JPEG downloaded.");
  } catch (error) {
    console.error("Could not export JPEG:", error);
    toast(`Could not export JPEG: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

function updateBundleCount() {
  const selected = $$("#bundle-list input:checked").length;
  $("#bundle-count").textContent = `${selected} selected`;
  $("#print-bundle").disabled = selected === 0;
}

$("#open-bundle").addEventListener("click", () => {
  const docs = [...workspace.documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!docs.length) {
    toast("Create a document before combining files.", true);
    return;
  }
  $("#bundle-list").innerHTML = docs.map((doc) => `<label class="bundle-item"><input type="checkbox" value="${escapeHTML(doc.id)}"><span><strong>${escapeHTML(doc.number)} · ${escapeHTML(doc.customer)}</strong><small>${capitalise(doc.type)} · ${escapeHTML(displayDate(doc.issueDate))} · ${money(calculate(doc).total, doc.currency || "CAD")}</small></span></label>`).join("");
  updateBundleCount();
  $("#bundle-dialog").showModal();
});
$("#bundle-list").addEventListener("change", updateBundleCount);
$("#bundle-select-all").addEventListener("click", () => { $$("#bundle-list input").forEach((input) => { input.checked = true; }); updateBundleCount(); });
$("#bundle-clear").addEventListener("click", () => { $$("#bundle-list input").forEach((input) => { input.checked = false; }); updateBundleCount(); });
$("#close-bundle").addEventListener("click", () => $("#bundle-dialog").close());
$("#cancel-bundle").addEventListener("click", () => $("#bundle-dialog").close());
window.addEventListener("afterprint", () => {
  document.body.classList.remove("printing-bundle");
  $("#bundle-print").innerHTML = "";
});
$("#print-bundle").addEventListener("click", async (event) => {
  const ids = $$("#bundle-list input:checked").map((input) => input.value);
  const documents = ids.map((id) => workspace.documents.find((doc) => doc.id === id));
  if (!documents.length || documents.some((doc) => !doc)) {
    toast("Select existing documents to combine.", true);
    return;
  }
  const button = event.currentTarget;
  button.disabled = true;
  try {
    $("#bundle-print").innerHTML = documents.map(documentMarkup).join("");
    await Promise.all($$("#bundle-print img").map((image) => image.decode()));
    document.body.classList.add("printing-bundle");
    window.print();
  } catch (error) {
    document.body.classList.remove("printing-bundle");
    $("#bundle-print").innerHTML = "";
    console.error("Could not print combined documents:", error);
    toast("Could not prepare the combined PDF. Check your logo and try again.", true);
  } finally {
    button.disabled = false;
  }
});
$("#share-document").addEventListener("click", async () => {
  const doc = workspace.documents.find((item) => item.id === currentDocumentId);
  if (!doc) return;
  const business = workspace.settings.businessName || "Your business";
  const text = `Hi ${doc.customer}, here's your ${doc.type} ${doc.number} from ${business} with a balance of ${money(calculate(doc).balance, doc.currency || "CAD")}${doc.dueDate ? ` (${doc.type === "invoice" ? "due" : "valid until"} ${displayDate(doc.dueDate)})` : ""}. Please contact us if you have any questions.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `${capitalise(doc.type)} ${doc.number}`, text });
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Could not share document details:", error);
        toast("Could not open sharing. Please try again.", true);
      }
    }
  } else if (doc.phone) {
    window.location.href = `sms:${encodeURIComponent(doc.phone)}?body=${encodeURIComponent(text)}`;
    toast("Opening your text app. Attach the PDF separately.");
  } else if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Details copied. Paste them into a message and attach the PDF.");
    } catch (error) {
      console.error("Could not copy document details:", error);
      toast("Could not copy details. Add a customer phone number to open your text app.", true);
    }
  } else {
    toast("Sharing is unavailable. Add a customer phone number to open your text app.", true);
  }
});

fillCurrencies();
loadWorkspace();
resetSavedItemForm("service");
render();
