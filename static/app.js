const $ = id => document.getElementById(id);
const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtPct = n => n == null ? '—' : n + '%';

// Navigation
document.querySelectorAll('nav a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const page = a.dataset.page;
    document.querySelectorAll('nav a').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
    document.getElementById('page-' + page).classList.add('active');
    loaders[page]?.();
  });
});

// Load dashboard on start + update statusbar
window.addEventListener('DOMContentLoaded', () => {
  document.querySelector('nav a[data-page="dashboard"]').click();
});

async function updateStatusbar() {
  try {
    const d = await api('GET', '/dashboard');
    const sb_nw = $('sb-networth');
    if (sb_nw) {
      sb_nw.textContent = 'Net Worth: ' + fmt(d.net_worth);
      sb_nw.className = d.net_worth >= 0 ? 'pos' : 'neg';
    }
    const sb_cf = $('sb-cashflow');
    if (sb_cf) {
      sb_cf.textContent = 'Cash Flow: ' + fmt(d.monthly_cash_flow) + '/mo';
      sb_cf.className = d.monthly_cash_flow >= 0 ? 'pos' : 'neg';
    }
  } catch (_) {}
}
updateStatusbar();

// ---- API helpers ----
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ---- Dashboard ----
const _EXPENSE_CATS = [
  ['Housing',        ['rent', 'mortgage']],
  ['Transport',      ['alaska air', 'clipper', 'lime']],
  ['Insurance',      ['insurance', 'state farm']],
  ['Food & Dining',  ['ovations', 'nth st', 'trader joe', 'safeway']],
  ['Subscriptions',  ['claude', 'avast', 'openai', 'chatg', 'youtube', 'viasat', 'motiv', 'apple']],
  ['Debt Payments',  ['loan pmt', 'sofi ach', 'provident', 'educational', 'citi autopay', 'cardmember']],
  ['Life & Events',  []],
  ['Utilities',      ['laundry', 'wash']],
];

function _groupExpenses(items) {
  const groups = {}, placed = new Set();
  for (const [cat, kws] of _EXPENSE_CATS) {
    for (const item of items) {
      if (placed.has(item.name)) continue;
      if (kws.some(k => item.name.toLowerCase().includes(k))) {
        (groups[cat] = groups[cat] || []).push(item);
        placed.add(item.name);
      }
    }
  }
  for (const item of items) {
    if (!placed.has(item.name)) (groups['Other'] = groups['Other'] || []).push(item);
  }
  return groups;
}

function _dashCard(label, valueStr, cls='', sub='', items=[]) {
  const rows = items.map(([n, v]) =>
    `<div class="card-item"><span>${n}</span><span>${v}</span></div>`
  ).join('');
  return `<div class="card">
    <div class="label">${label}</div>
    <div class="value ${cls}">${valueStr}</div>
    ${sub ? `<div class="card-sub">${sub}</div>` : ''}
    ${rows ? `<div class="card-items">${rows}</div>` : ''}
  </div>`;
}
function _dashTotal(label, valueStr, cls='') {
  return `<div class="card card-summary">
    <div class="label">${label}</div>
    <div class="value ${cls}">${valueStr}</div>
  </div>`;
}

// Wire dashboard "edit budget" link to navigate to Budget page
window.addEventListener('DOMContentLoaded', () => {
  const editLink = $('dash-budget-edit-link');
  if (editLink) {
    editLink.addEventListener('click', e => {
      e.preventDefault();
      document.querySelector('nav a[data-page="budget"]')?.click();
    });
  }
});

function _renderDashBudget(state) {
  if (!state || (!state.gross1 && !state.gross2)) return null;
  const g1 = (parseFloat(state.gross1) || 0) / 12;
  const g2 = (parseFloat(state.gross2) || 0) / 12;
  const other = parseFloat(state.other) || 0;
  const monthlyGross = g1 + g2 + other;
  if (!monthlyGross) return null;

  const cats = state.cats || {};
  let totalExpenses = 0, totalSavings = 0, housingTotal = 0, debtTotal = 0;
  const secTotals = {};
  for (const sec of BDG_SECTIONS) {
    let secSum = 0;
    for (const item of sec.items) secSum += parseFloat(cats[item.id] || 0);
    secTotals[sec.id] = secSum;
    if (sec.isSavings) totalSavings += secSum;
    else {
      totalExpenses += secSum;
      if (sec.id === 'housing') housingTotal = secSum;
      if (sec.id === 'debt')    debtTotal    = secSum;
    }
  }

  const savingsRate = monthlyGross > 0 ? totalSavings / monthlyGross * 100 : 0;
  const housingPct  = monthlyGross > 0 ? housingTotal / monthlyGross * 100 : 0;
  const dti         = monthlyGross > 0 ? (housingTotal + debtTotal) / monthlyGross * 100 : 0;
  const remaining   = monthlyGross - totalExpenses - totalSavings;
  const n1 = state.name1 || 'Adult 1';
  const n2 = state.name2 || 'Adult 2';

  let html = `<div class="cards" style="margin-bottom:10px;">
    <div class="card"><div class="label">Monthly Gross (${n1}+${n2})</div><div class="value pos">${fmt(monthlyGross)}</div></div>
    <div class="card"><div class="label">Total Expenses</div><div class="value neg">${fmt(totalExpenses)}</div></div>
    <div class="card"><div class="label">Monthly Savings</div><div class="value pos">${fmt(totalSavings)}</div></div>
    <div class="card"><div class="label">Unallocated</div><div class="value ${remaining >= 0 ? 'pos' : 'neg'}">${fmt(remaining)}</div></div>
    <div class="card"><div class="label">Savings Rate</div><div class="value ${savingsRate >= 20 ? 'pos' : savingsRate >= 15 ? '' : 'neg'}">${savingsRate.toFixed(1)}%</div></div>
    <div class="card"><div class="label">Housing %</div><div class="value ${housingPct <= 25 ? 'pos' : housingPct <= 28 ? '' : 'neg'}">${housingPct.toFixed(1)}%</div></div>
    <div class="card"><div class="label">Housing+Debt DTI</div><div class="value ${dti <= 28 ? 'pos' : dti <= 36 ? '' : 'neg'}">${dti.toFixed(1)}%</div></div>
  </div>`;

  // Top expense categories
  const topSecs = Object.entries(secTotals)
    .filter(([id]) => !BDG_SECTIONS.find(s => s.id === id)?.isSavings && secTotals[id] > 0)
    .sort(([,a],[,b]) => b - a).slice(0, 5);
  if (topSecs.length) {
    html += `<div style="font-size:11px;font-weight:bold;color:#444;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px;">Top Spending Categories</div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">`;
    for (const [id, amt] of topSecs) {
      const sec = BDG_SECTIONS.find(s => s.id === id);
      const pct = monthlyGross > 0 ? (amt / monthlyGross * 100).toFixed(1) : '0';
      const over = sec?.maxPct && (amt / monthlyGross) > sec.maxPct;
      html += `<div style="font-size:11px;padding:2px 8px;border:1px solid #ccc;background:#f8f8f8;${over ? 'border-color:var(--red);color:var(--red);' : ''}">${sec?.label || id}: ${fmt(amt)}/mo (${pct}%)</div>`;
    }
    html += '</div>';
  }
  return html;
}

async function loadDashboard() {
  const d = await api('GET', '/dashboard');

  // Net Worth row
  $('net-worth').textContent = fmt(d.net_worth);
  $('net-worth').className = 'value ' + (d.net_worth >= 0 ? 'pos' : 'neg');
  $('total-assets').textContent = fmt(d.total_assets);
  $('total-debt').textContent = fmt(d.total_debt);
  $('liquid').textContent = fmt(d.liquid);
  $('investments').textContent = fmt(d.investments);

  // Income badge — primary income only
  $('monthly-income').textContent = fmt(d.monthly_income);

  // Income panel — primary income section + other deposits section
  const primarySources = (d.income_sources || []).filter(s => s.primary);
  const otherSources   = (d.income_sources || []).filter(s => !s.primary);

  function _incomeCard(s) {
    const sub = s.frequency === 'semimonthly'
      ? `${fmt(s.per_period)} × 2 / month` : s.frequency;
    return _dashCard(s.name, fmt(s.monthly) + '/mo', 'pos', sub);
  }

  const primaryLabel = primarySources.length === 1 ? primarySources[0].name : 'Primary Income';
  let incHtml = `<div class="bd-section">${primaryLabel}</div><div class="cards">`;
  for (const s of primarySources) incHtml += _incomeCard(s);
  incHtml += _dashTotal('Total', fmt(d.monthly_income) + '/mo', 'pos');
  incHtml += '</div>';

  if (otherSources.length) {
    incHtml += '<div class="bd-section">Other Deposits</div><div class="cards">';
    for (const s of otherSources) incHtml += _incomeCard(s);
    incHtml += _dashTotal('Subtotal', fmt(d.monthly_supplemental) + '/mo', 'pos');
    incHtml += '</div>';
  }

  $('income-panel').innerHTML = incHtml;

  // Outflow badge
  const totalOutflow = d.monthly_expenses + d.monthly_loan_payments;
  $('monthly-outflow').textContent = fmt(totalOutflow);

  // Outflow panel — grouped expense cards then individual loan cards
  const expGroups = _groupExpenses(d.expense_items || []);
  let outHtml = '<div class="bd-section">Expenses by Category</div><div class="cards">';
  for (const [cat, items] of Object.entries(expGroups)) {
    const total = items.reduce((s, e) => s + e.monthly, 0);
    outHtml += _dashCard(cat, fmt(total) + '/mo', 'neg', '',
      items.map(e => [e.name, fmt(e.monthly)]));
  }
  outHtml += _dashTotal('Subtotal', fmt(d.monthly_expenses) + '/mo', 'neg');
  outHtml += '</div>';
  outHtml += '<div class="bd-section">Loan Payments</div><div class="cards">';
  for (const l of (d.loan_items || [])) {
    outHtml += _dashCard(l.name, fmt(l.monthly) + '/mo', 'neg',
      `${l.rate}% interest`, [['Balance', fmt(l.balance)]]);
  }
  outHtml += _dashTotal('Subtotal', fmt(d.monthly_loan_payments) + '/mo', 'neg');
  outHtml += '</div>';
  $('outflow-panel').innerHTML = outHtml;

  // Metrics row
  $('cash-flow').textContent = fmt(d.monthly_cash_flow);
  $('cash-flow').className = 'value ' + (d.monthly_cash_flow >= 0 ? 'pos' : 'neg');
  $('savings-rate').textContent = fmtPct(d.savings_rate);
  $('savings-rate').className = 'value ' + (d.savings_rate >= 20 ? 'pos' : d.savings_rate >= 10 ? '' : 'neg');
  $('emergency-months').textContent = d.emergency_months + ' mo';
  $('emergency-months').className = 'value ' + (d.emergency_months >= 6 ? 'pos' : d.emergency_months >= 3 ? '' : 'neg');
  $('dti').textContent = fmtPct(d.dti);
  $('dti').className = 'value ' + (d.dti <= 28 ? 'pos' : d.dti <= 43 ? '' : 'neg');
  if ($('dash-rsu-pending')) $('dash-rsu-pending').textContent = d.rsu_pending_value ? fmt(d.rsu_pending_value) : '—';
  if ($('dash-rsu-next90'))  $('dash-rsu-next90').textContent  = d.rsu_next90_net    ? fmt(d.rsu_next90_net)    : '—';

  // Advice
  $('advice-list').innerHTML = d.advice.map(a =>
    `<div class="advice-item ${a.priority}"><span class="icon">${a.icon}</span><span>${a.text}</span></div>`
  ).join('');

  // Goals
  const gl = $('goals-dash');
  gl.innerHTML = d.goals.length === 0
    ? '<div class="empty">No goals set.</div>'
    : d.goals.map(g => `
      <div class="goal-card">
        <div class="name">${g.name}</div>
        <div class="progress"><div class="progress-bar" style="width:${Math.min(g.pct,100)}%"></div></div>
        <div class="amounts"><span>${fmt(g.current)}</span><span>${fmtPct(g.pct)} of ${fmt(g.target)}</span></div>
      </div>`).join('');

  // Statusbar
  const sbNw = $('sb-networth'), sbCf = $('sb-cashflow');
  if (sbNw) sbNw.textContent = 'Net Worth: ' + fmt(d.net_worth);
  if (sbCf) sbCf.textContent = 'Cash Flow: ' + fmt(d.monthly_cash_flow) + '/mo';

  // Budget snapshot panel
  try {
    const bdg = await api('GET', '/budget');
    const panel = $('dash-budget-panel');
    if (panel) {
      const html = _renderDashBudget(bdg);
      panel.innerHTML = html || '<div class="empty">No household budget saved yet. Go to the Budget page to set one up.</div>';
    }
  } catch(_) {}
}

// ---- Accounts ----
async function loadAccounts() {
  const rows = await api('GET', '/accounts');
  const tbody = $('accounts-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No accounts yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(a => `
    <tr>
      <td>${a.name}</td>
      <td><span class="badge badge-${a.type}">${a.type}</span></td>
      <td class="${a.balance >= 0 ? 'pos' : 'neg'}">${fmt(a.balance)}</td>
      <td>${a.apy ? fmtPct(a.apy) : '—'}</td>
      <td>${a.institution || '—'}</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" onclick="editAccount(${a.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAccount(${a.id})">Delete</button>
      </div></td>
    </tr>`).join('');
}

function openAccountModal(data = {}) {
  $('acc-id').value = data.id || '';
  $('acc-name').value = data.name || '';
  $('acc-type').value = data.type || 'checking';
  $('acc-balance').value = data.balance ?? '';
  $('acc-apy').value = data.apy ?? '';
  $('acc-institution').value = data.institution || '';
  $('acc-notes').value = data.notes || '';
  $('modal-account-title').textContent = data.id ? 'Edit Account' : 'Add Account';
  $('modal-account').classList.add('open');
}

async function editAccount(id) {
  const rows = await api('GET', '/accounts');
  openAccountModal(rows.find(r => r.id === id));
}

async function deleteAccount(id) {
  if (!confirm('Delete this account?')) return;
  await api('DELETE', `/accounts/${id}`);
  loadAccounts();
}

$('btn-add-account').addEventListener('click', () => openAccountModal());

$('form-account').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('acc-id').value;
  const body = {
    name: $('acc-name').value,
    type: $('acc-type').value,
    balance: +$('acc-balance').value,
    apy: +$('acc-apy').value || 0,
    institution: $('acc-institution').value || null,
    notes: $('acc-notes').value || null,
  };
  if (id) await api('PUT', `/accounts/${id}`, body);
  else await api('POST', '/accounts', body);
  $('modal-account').classList.remove('open');
  loadAccounts();
});

// ---- Recurring ----
async function loadRecurring() {
  const rows = await api('GET', '/recurring');
  const income = rows.filter(r => r.kind === 'income');
  const expense = rows.filter(r => r.kind === 'expense');

  renderRecurringTable('income-tbody', income);
  renderRecurringTable('expense-tbody', expense);

  const totalIncome = income.reduce((s, r) => s + r.monthly_amount, 0);
  const totalExpense = expense.reduce((s, r) => s + r.monthly_amount, 0);
  $('recurring-income-total').textContent = fmt(totalIncome) + '/mo';
  $('recurring-expense-total').textContent = fmt(totalExpense) + '/mo';
}

function renderRecurringTable(tbodyId, rows) {
  const tbody = $(tbodyId);
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">None.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.name}</td>
      <td>${r.category || '—'}</td>
      <td>${r.amount.toLocaleString('en-US', {style:'currency',currency:'USD'})} / ${r.frequency}</td>
      <td>${fmt(r.monthly_amount)}/mo</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" onclick="editRecurring(${r.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRecurring(${r.id})">Delete</button>
      </div></td>
    </tr>`).join('');
}

function openRecurringModal(data = {}) {
  $('rec-id').value = data.id || '';
  $('rec-name').value = data.name || '';
  $('rec-kind').value = data.kind || 'expense';
  $('rec-amount').value = data.amount ?? '';
  $('rec-category').value = data.category || '';
  $('rec-frequency').value = data.frequency || 'monthly';
  $('rec-notes').value = data.notes || '';
  $('modal-recurring-title').textContent = data.id ? 'Edit Recurring' : 'Add Recurring';
  $('modal-recurring').classList.add('open');
}

async function editRecurring(id) {
  const rows = await api('GET', '/recurring');
  openRecurringModal(rows.find(r => r.id === id));
}

async function deleteRecurring(id) {
  if (!confirm('Delete this item?')) return;
  await api('DELETE', `/recurring/${id}`);
  loadRecurring();
}

$('btn-add-recurring').addEventListener('click', () => openRecurringModal());

async function scanRecurring() {
  const status = $('recurring-scan-status');
  const results = $('recurring-scan-results');
  status.textContent = 'Scanning imported transactions...';
  results.style.display = 'none';

  let data;
  try {
    data = await api('GET', '/ingest/scan-recurring');
  } catch(e) {
    status.textContent = 'Error: ' + e.message;
    return;
  }

  const sugg = data.suggestions || [];
  if (!sugg.length) {
    status.textContent = 'No recurring patterns found. Import more transactions first.';
    return;
  }

  // Filter out ones that already exist (name match)
  const existing = await api('GET', '/recurring');
  const existingNames = new Set(existing.map(r => r.name.toLowerCase()));
  const fresh = sugg.filter(s => !existingNames.has(s.name.toLowerCase()));

  if (!fresh.length) {
    status.textContent = 'All detected patterns are already in your recurring list.';
    return;
  }

  status.textContent = `Found ${fresh.length} new pattern${fresh.length !== 1 ? 's' : ''}.`;
  results.style.display = 'block';

  $('recurring-suggestions-list').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Select</th><th>Name</th><th>Kind</th><th>Amount</th><th>Frequency</th><th>Seen</th></tr></thead>
        <tbody>
          ${fresh.map((s, i) => `<tr>
            <td><input type="checkbox" id="rsugg-${i}" checked
              data-name="${esc(s.name)}" data-kind="${s.kind}"
              data-amount="${s.amount}" data-freq="${s.frequency}"></td>
            <td style="font-size:12px;">${s.name}</td>
            <td><span class="badge badge-${s.kind}">${s.kind}</span></td>
            <td class="${s.kind === 'income' ? 'pos' : 'neg'}">${fmt(s.amount)}</td>
            <td>${s.frequency}</td>
            <td style="color:var(--muted);font-size:11px;">${s.occurrences}x</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function applyRecurringSuggestions() {
  const checks = document.querySelectorAll('#recurring-suggestions-list input[type=checkbox]:checked');
  if (!checks.length) return;
  let added = 0;
  for (const cb of checks) {
    await api('POST', '/recurring', {
      name:      cb.dataset.name,
      kind:      cb.dataset.kind,
      amount:    +cb.dataset.amount,
      frequency: cb.dataset.freq,
      category:  'Auto-detected',
    }).catch(() => {});
    added++;
  }
  $('recurring-scan-results').style.display = 'none';
  $('recurring-scan-status').textContent = `Added ${added} item${added !== 1 ? 's' : ''}.`;
  loadRecurring();
}

$('form-recurring').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('rec-id').value;
  const body = {
    name: $('rec-name').value,
    kind: $('rec-kind').value,
    amount: +$('rec-amount').value,
    category: $('rec-category').value || null,
    frequency: $('rec-frequency').value,
    notes: $('rec-notes').value || null,
  };
  if (id) await api('PUT', `/recurring/${id}`, body);
  else await api('POST', '/recurring', body);
  $('modal-recurring').classList.remove('open');
  loadRecurring();
});

// ---- Loans ----
async function loadLoans() {
  const rows = await api('GET', '/loans');
  const tbody = $('loans-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No loans.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(l => {
    const pctPaid = Math.round((1 - l.balance / l.original_balance) * 100);
    return `<tr>
      <td>${l.name}</td>
      <td class="neg">${fmt(l.balance)}</td>
      <td>${fmtPct(l.rate)}</td>
      <td>${fmt(l.monthly_payment)}/mo</td>
      <td>${l.months_remaining} mo</td>
      <td class="neg">${fmt(l.total_interest_remaining)} interest left</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" onclick="showAmortization(${l.id}, '${l.name}')">Schedule</button>
        <button class="btn btn-ghost btn-sm" onclick="editLoan(${l.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteLoan(${l.id})">Delete</button>
      </div></td>
    </tr>`;
  }).join('');
}

function openLoanModal(data = {}) {
  $('loan-id').value = data.id || '';
  $('loan-name').value = data.name || '';
  $('loan-balance').value = data.balance ?? '';
  $('loan-original').value = data.original_balance ?? '';
  $('loan-rate').value = data.rate ?? '';
  $('loan-term').value = data.term_months ?? '';
  $('loan-start').value = data.start_date || new Date().toISOString().slice(0,10);
  $('loan-payment').value = data.monthly_payment ?? '';
  $('loan-notes').value = data.notes || '';
  $('modal-loan-title').textContent = data.id ? 'Edit Loan' : 'Add Loan';
  $('modal-loan').classList.add('open');
}

async function editLoan(id) {
  const rows = await api('GET', '/loans');
  openLoanModal(rows.find(r => r.id === id));
}

async function deleteLoan(id) {
  if (!confirm('Delete this loan?')) return;
  await api('DELETE', `/loans/${id}`);
  loadLoans();
}

async function showAmortization(id, name) {
  const sched = await api('GET', `/loans/${id}/amortization`);
  $('amort-title').textContent = name + ' — Amortization Schedule';
  const tbody = $('amort-tbody');
  tbody.innerHTML = sched.map(s => `
    <tr>
      <td>${s.month}</td>
      <td>${fmt(s.payment)}</td>
      <td class="pos">${fmt(s.principal)}</td>
      <td class="neg">${fmt(s.interest)}</td>
      <td>${fmt(s.balance)}</td>
    </tr>`).join('');
  $('modal-amort').classList.add('open');
}

$('btn-add-loan').addEventListener('click', () => openLoanModal());

$('form-loan').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('loan-id').value;
  const body = {
    name: $('loan-name').value,
    balance: +$('loan-balance').value,
    original_balance: +$('loan-original').value,
    rate: +$('loan-rate').value,
    term_months: +$('loan-term').value,
    start_date: $('loan-start').value,
    monthly_payment: +$('loan-payment').value || null,
    notes: $('loan-notes').value || null,
  };
  if (id) await api('PUT', `/loans/${id}`, body);
  else await api('POST', '/loans', body);
  $('modal-loan').classList.remove('open');
  loadLoans();
});

// ---- Goals ----
async function loadGoals() {
  const rows = await api('GET', '/goals');
  const container = $('goals-list');
  if (rows.length === 0) {
    container.innerHTML = '<div class="empty">No goals yet.</div>';
    return;
  }
  container.innerHTML = rows.map(g => `
    <div class="goal-card">
      <div class="name">${g.name}</div>
      ${g.target_date ? `<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Target: ${g.target_date}</div>` : ''}
      <div class="progress"><div class="progress-bar" style="width:${Math.min(g.pct,100)}%"></div></div>
      <div class="amounts">
        <span>${fmt(g.current)} saved</span>
        <span>${fmtPct(g.pct)} of ${fmt(g.target)}</span>
      </div>
      ${g.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:8px;">${g.notes}</div>` : ''}
      <div class="row-actions" style="margin-top:12px;">
        <button class="btn btn-ghost btn-sm" onclick="editGoal(${g.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteGoal(${g.id})">Delete</button>
      </div>
    </div>`).join('');
}

let _goalTemplates = [];

async function openGoalModal(data = {}) {
  $('goal-id').value = data.id || '';
  $('goal-name').value = data.name || '';
  $('goal-target').value = data.target ?? '';
  $('goal-current').value = data.current ?? '';
  $('goal-date').value = data.target_date || '';
  $('goal-notes').value = data.notes || '';
  $('modal-goal-title').textContent = data.id ? 'Edit Goal' : 'Add Goal';

  // Load templates (skip if editing existing goal)
  const sel = $('goal-template');
  if (!data.id) {
    try {
      _goalTemplates = await api('GET', '/goals/templates');
      sel.innerHTML = '<option value="">-- select a template --</option>' +
        _goalTemplates.map((t, i) => `<option value="${i}">${t.label}</option>`).join('');
    } catch (_) {
      sel.innerHTML = '<option value="">-- templates unavailable --</option>';
    }
  } else {
    sel.innerHTML = '<option value="">-- editing existing goal --</option>';
  }

  $('modal-goal').classList.add('open');
}

function applyGoalTemplate() {
  const sel = $('goal-template');
  const idx = sel.value;
  if (idx === '' || !_goalTemplates[idx]) return;
  const t = _goalTemplates[idx];
  if (t.id === 'custom') return;  // let user fill freely
  if (t.name)   $('goal-name').value   = t.name;
  if (t.target) $('goal-target').value = t.target;
  if (t.notes)  $('goal-notes').value  = t.notes;
}

async function editGoal(id) {
  const rows = await api('GET', '/goals');
  openGoalModal(rows.find(r => r.id === id));
}

async function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  await api('DELETE', `/goals/${id}`);
  loadGoals();
}

$('btn-add-goal').addEventListener('click', () => openGoalModal());

$('form-goal').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('goal-id').value;
  const body = {
    name: $('goal-name').value,
    target: +$('goal-target').value,
    current: +$('goal-current').value || 0,
    target_date: $('goal-date').value || null,
    notes: $('goal-notes').value || null,
  };
  if (id) await api('PUT', `/goals/${id}`, body);
  else await api('POST', '/goals', body);
  $('modal-goal').classList.remove('open');
  loadGoals();
});

// ---- Debt-Free Calculator ----
let _dfcLoans = [];
let _dfcCashFlow = 0;
let _dfcRsuVestedGross = 0;
let _dfcRsuVestedNet = 0;

async function loadDebtCalc() {
  const [loans, dash, grants] = await Promise.all([
    api('GET', '/loans'),
    api('GET', '/dashboard'),
    api('GET', '/rsus').catch(() => []),
  ]);

  _dfcLoans = loans.filter(l => l.balance > 0);
  _dfcCashFlow = dash.monthly_cash_flow;

  // Compute total vested RSU value across all grants
  _dfcRsuVestedGross = 0;
  _dfcRsuVestedNet = 0;
  for (const g of grants) {
    if (g.vested_value) {
      _dfcRsuVestedGross += g.vested_value;
      const ftr = (g.federal_tax_rate || 22) / 100;
      _dfcRsuVestedNet += g.vested_value * (1 - ftr);
    }
  }
  _dfcRsuVestedGross = Math.round(_dfcRsuVestedGross * 100) / 100;
  _dfcRsuVestedNet   = Math.round(_dfcRsuVestedNet   * 100) / 100;

  // Show RSU section if there are vested shares with value
  const rsuSection = $('dfc-rsu-section');
  if (rsuSection) {
    if (_dfcRsuVestedGross > 0) {
      rsuSection.style.display = '';
      $('dfc-rsu-gross').textContent = fmt(_dfcRsuVestedGross);
      $('dfc-rsu-net').textContent   = fmt(_dfcRsuVestedNet);
    } else {
      rsuSection.style.display = 'none';
    }
  }

  if (!_dfcLoans.length) {
    $('dfc-no-debt').style.display = '';
    $('dfc-results').style.display = 'none';
    return;
  }

  const totalDebt = _dfcLoans.reduce((s, l) => s + l.balance, 0);
  const minPayments = _dfcLoans.reduce((s, l) => s + _loanMinPayment(l), 0);

  $('dfc-total-debt').textContent = fmt(totalDebt);
  $('dfc-min-payment').textContent = fmt(minPayments);
  $('dfc-cash-flow').textContent = fmt(Math.max(0, _dfcCashFlow));

  // Default extra = all remaining cash flow (minimums already deducted in dashboard calc)
  const suggested = Math.max(0, Math.floor(_dfcCashFlow));
  if (!$('dfc-extra').value || $('dfc-extra').value === '0') {
    $('dfc-extra').value = suggested;
  }

  runDebtCalc();
}

function _loanMinPayment(l) {
  if (l.monthly_payment) return l.monthly_payment;
  if (!l.rate || !l.term_months) return 0;
  const r = l.rate / 100 / 12;
  return l.balance * r * Math.pow(1 + r, l.term_months) / (Math.pow(1 + r, l.term_months) - 1);
}

function _simulatePayoff(loans, extra, strategy) {
  // Deep copy balances
  let debts = loans.map(l => ({
    id:          l.id,
    name:        l.name,
    balance:     l.balance,
    rate:        l.rate,
    minPayment:  _loanMinPayment(l),
    interestPaid: 0,
    payoffMonth: null,
  }));

  // Sort order for target (extra payments go here first)
  function sortDebts(ds) {
    if (strategy === 'avalanche') {
      ds.sort((a, b) => b.rate - a.rate);
    } else {
      ds.sort((a, b) => a.balance - b.balance);
    }
  }

  const schedule = [];  // {month, name, payment, principal, interest, balanceAfter}
  let month = 0;
  const MAX_MONTHS = 600;

  while (debts.some(d => d.balance > 0.01) && month < MAX_MONTHS) {
    month++;
    sortDebts(debts);

    let remaining = extra;
    // First pass: pay minimums on all
    for (const d of debts) {
      if (d.balance <= 0.01) continue;
      const interest = d.balance * (d.rate / 100 / 12);
      const pay = Math.min(d.minPayment, d.balance + interest);
      const principal = pay - interest;
      d.balance = Math.max(0, d.balance - principal);
      d.interestPaid += interest;
      schedule.push({ month, name: d.name, payment: pay, principal, interest, balanceAfter: d.balance });
    }
    // Second pass: apply extra to target debt
    for (const d of debts) {
      if (d.balance <= 0.01 || remaining <= 0) continue;
      const extra_pay = Math.min(remaining, d.balance);
      d.balance = Math.max(0, d.balance - extra_pay);
      remaining -= extra_pay;
      // Update last schedule row for this debt this month
      const last = [...schedule].reverse().find(r => r.month === month && r.name === d.name);
      if (last) { last.payment += extra_pay; last.principal += extra_pay; last.balanceAfter = d.balance; }
      if (d.balance <= 0.01) break; // avalanche: stack freed min onto next
      remaining += 0; // snowball/avalanche: move to next
    }
    // Mark payoffs
    for (const d of debts) {
      if (d.balance <= 0.01 && d.payoffMonth === null) d.payoffMonth = month;
    }
    // Freed minimums roll into extra next month (snowball/avalanche cascade)
    const freed = debts.filter(d => d.payoffMonth === month).reduce((s, d) => s + d.minPayment, 0);
    extra += freed;
  }

  return { debts, schedule, totalMonths: month };
}

function _applyLumpSum(loans, lumpSum, strategy) {
  const sorted = [...loans].sort((a, b) =>
    strategy === 'avalanche' ? b.rate - a.rate : a.balance - b.balance
  );
  const modified = loans.map(l => ({ ...l }));
  let remaining = lumpSum;
  for (const target of sorted) {
    if (remaining <= 0) break;
    const loan = modified.find(l => l.id === target.id);
    const paydown = Math.min(remaining, loan.balance);
    loan.balance -= paydown;
    remaining -= paydown;
  }
  return modified.filter(l => l.balance > 0.01);
}

function _monthToDate(m) {
  const d = new Date(2026, 4, 1); // May 2026
  d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function runDebtCalc() {
  if (!_dfcLoans.length) return;

  const extra    = parseFloat($('dfc-extra').value) || 0;
  const strategy = $('dfc-strategy').value;

  // RSU lump sum
  const rsuEnabled = $('dfc-rsu-enable')?.checked;
  const rsuPct  = Math.min(100, Math.max(0, parseFloat($('dfc-rsu-pct')?.value) || 100)) / 100;
  const rsuLump = (rsuEnabled && _dfcRsuVestedNet > 0) ? _dfcRsuVestedNet * rsuPct : 0;

  // Update RSU applying / leftover cards
  if ($('dfc-rsu-applying')) $('dfc-rsu-applying').textContent = rsuLump > 0 ? fmt(rsuLump) : '—';

  // Build loans to use (with lump sum applied if enabled)
  const loansForSim = rsuLump > 0 ? _applyLumpSum(_dfcLoans, rsuLump, strategy) : _dfcLoans;

  const result = _simulatePayoff(loansForSim, extra, strategy);

  // Baseline: minimums only, no RSU
  const baseline = _simulatePayoff(_dfcLoans, 0, strategy);
  const baselineInterest = baseline.debts.reduce((s, d) => s + d.interestPaid, 0);
  const baselineMonths   = baseline.totalMonths;

  const totalInterest = result.debts.reduce((s, d) => s + d.interestPaid, 0);
  const saved       = baselineInterest - totalInterest;
  const monthsSaved = baselineMonths - result.totalMonths;

  $('dfc-free-date').textContent = _monthToDate(result.totalMonths);
  $('dfc-months').textContent = result.totalMonths + ' months';
  $('dfc-total-interest').textContent = fmt(totalInterest);
  $('dfc-interest-saved').textContent = saved > 0
    ? `Save ${fmt(saved)} & ${monthsSaved} mo vs minimums`
    : 'Same as minimums only';

  // RSU comparison: without vs with RSU
  const rsuCompare = $('dfc-rsu-compare');
  if (rsuCompare && rsuLump > 0) {
    const noRsu = _simulatePayoff(_dfcLoans, extra, strategy);
    const noRsuInterest = noRsu.debts.reduce((s, d) => s + d.interestPaid, 0);
    const noRsuMonths   = noRsu.totalMonths;
    const interestSavedByRsu = noRsuInterest - totalInterest;
    const monthsSavedByRsu   = noRsuMonths   - result.totalMonths;

    // Remaining RSU cash after debt payoff
    const totalDebt   = _dfcLoans.reduce((s, l) => s + l.balance, 0);
    const rsuApplied  = Math.min(rsuLump, totalDebt);
    const rsuLeftover = rsuLump - rsuApplied;
    if ($('dfc-rsu-leftover')) $('dfc-rsu-leftover').textContent = fmt(rsuLeftover);

    rsuCompare.innerHTML = `
      <div style="font-size:11px;font-weight:bold;margin-bottom:6px;color:#444;">RSU LUMP SUM IMPACT</div>
      <div class="cards" style="margin-bottom:8px;">
        <div class="card"><div class="label">Without RSU</div>
          <div class="value">${_monthToDate(noRsuMonths)}</div>
          <div class="card-sub">${noRsuMonths} months · ${fmt(noRsuInterest)} interest</div>
        </div>
        <div class="card"><div class="label">With RSU (${fmt(rsuLump)} applied)</div>
          <div class="value pos">${_monthToDate(result.totalMonths)}</div>
          <div class="card-sub">${result.totalMonths} months · ${fmt(totalInterest)} interest</div>
        </div>
        <div class="card"><div class="label">RSU Saves</div>
          <div class="value pos">${fmt(interestSavedByRsu)} interest</div>
          <div class="card-sub">${monthsSavedByRsu} months sooner${rsuLeftover > 0 ? ' · ' + fmt(rsuLeftover) + ' remaining' : ''}</div>
        </div>
      </div>`;
    rsuCompare.style.display = '';
  } else {
    if (rsuCompare) rsuCompare.style.display = 'none';
    if ($('dfc-rsu-leftover')) $('dfc-rsu-leftover').textContent = '—';
  }

  // Post-payoff freed savings analysis
  const freedEl = $('dfc-freed-savings');
  if (freedEl && result.totalMonths > 0) {
    const totalMinimums = _dfcLoans.reduce((s, l) => s + _loanMinPayment(l), 0);
    const totalMonthlyFreed = totalMinimums + extra;
    const annualFreed = totalMonthlyFreed * 12;
    const debtFreeDate = _monthToDate(result.totalMonths);
    freedEl.innerHTML = `<strong>After becoming debt-free in ${debtFreeDate}:</strong>
      ${fmt(totalMinimums)}/mo in minimums + ${fmt(extra)}/mo extra = <strong>${fmt(totalMonthlyFreed)}/mo freed</strong>
      (${fmt(annualFreed)}/yr).
      Redirect to savings &rarr; max 401(k) ($${(23500/12).toFixed(0)}/mo), IRA ($${(14000/12).toFixed(0)}/mo combined), or taxable brokerage.`;
    freedEl.style.display = '';
  } else if (freedEl) {
    freedEl.style.display = 'none';
  }

  // Avalanche vs snowball comparison banner
  const banner = $('dfc-compare-banner');
  if (extra > 0) {
    const alt = _simulatePayoff(_dfcLoans, extra, strategy === 'avalanche' ? 'snowball' : 'avalanche');
    const altInterest = alt.debts.reduce((s, d) => s + d.interestPaid, 0);
    const diff = Math.abs(totalInterest - altInterest);
    const mDiff = Math.abs(result.totalMonths - alt.totalMonths);
    if (diff > 1 || mDiff > 0) {
      const altName = strategy === 'avalanche' ? 'Snowball' : 'Avalanche';
      const better = strategy === 'avalanche'
        ? `Avalanche saves ${fmt(diff)} more interest than Snowball.`
        : `Snowball finishes ${mDiff} month${mDiff !== 1 ? 's' : ''} earlier. Avalanche would save ${fmt(diff)} more in interest.`;
      banner.textContent = `Comparison: ${better}`;
      banner.style.display = '';
    } else {
      banner.style.display = 'none';
    }
  } else {
    banner.style.display = 'none';
  }

  // Payoff order table
  const sorted = [...result.debts].sort((a, b) => (a.payoffMonth || 999) - (b.payoffMonth || 999));
  $('dfc-order-tbody').innerHTML = sorted.map((d, i) => {
    const orig = _dfcLoans.find(l => l.id === d.id) || d;
    return `<tr>
      <td>${i + 1}</td>
      <td>${escHtml(d.name)}</td>
      <td class="neg">${fmt(orig.balance)}</td>
      <td>${d.rate}%</td>
      <td>${fmt(_loanMinPayment(orig))}</td>
      <td>${d.payoffMonth || '—'}</td>
      <td>${d.payoffMonth ? _monthToDate(d.payoffMonth) : '—'}</td>
      <td class="neg">${fmt(d.interestPaid)}</td>
    </tr>`;
  }).join('');

  // Month-by-month schedule (collapsed by default, aggregated per month per loan)
  const aggMap = {};
  for (const r of result.schedule) {
    const key = `${r.month}|${r.name}`;
    if (!aggMap[key]) aggMap[key] = { month: r.month, name: r.name, payment: 0, principal: 0, interest: 0, balanceAfter: r.balanceAfter };
    aggMap[key].payment += r.payment;
    aggMap[key].principal += r.principal;
    aggMap[key].interest += r.interest;
    aggMap[key].balanceAfter = r.balanceAfter;
  }
  const schedRows = Object.values(aggMap).sort((a, b) => a.month - b.month || a.name.localeCompare(b.name));
  $('dfc-schedule-tbody').innerHTML = schedRows.map(r => `
    <tr>
      <td>${r.month}</td>
      <td style="white-space:nowrap">${_monthToDate(r.month)}</td>
      <td style="font-size:11px">${escHtml(r.name)}</td>
      <td>${fmt(r.payment)}</td>
      <td class="pos">${fmt(r.principal)}</td>
      <td class="neg">${fmt(r.interest)}</td>
      <td>${r.balanceAfter <= 0.01 ? '<span class="pos" style="font-weight:bold">PAID OFF</span>' : fmt(r.balanceAfter)}</td>
    </tr>`).join('');

  $('dfc-results').style.display = '';
}

function toggleDfcSchedule() {
  const wrap = $('dfc-schedule-wrap');
  const lbl  = $('dfc-schedule-toggle');
  const hidden = wrap.style.display === 'none';
  wrap.style.display = hidden ? '' : 'none';
  lbl.textContent = hidden ? 'hide' : 'show';
}

// ---- Modal close ----
document.querySelectorAll('.modal-bg').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});
document.querySelectorAll('.btn-modal-close').forEach(b => {
  b.addEventListener('click', () => b.closest('.modal-bg').classList.remove('open'));
});

// ---- SimpleFIN ----

async function loadImport() {
  const status = await api('GET', '/simplefin/status');
  $('sfin-connect-panel').style.display = status.connected ? 'none' : 'block';
  $('sfin-connected-panel').style.display = status.connected ? 'block' : 'none';
  if (status.connected) sfinRenderStored();
}

async function sfinRenderStored() {
  // Render what's already in our DB without re-fetching
  const conn = await api('GET', '/simplefin/preview?days=0').catch(() => null);
  if (conn) renderSfinAccounts(conn);
}

async function sfinPreview() {
  $('sfin-sync-msg').textContent = 'Fetching…';
  try {
    const data = await api('GET', '/simplefin/preview?days=90');
    renderSfinAccounts(data);
    $('sfin-sync-msg').textContent = 'Last fetch: just now';
  } catch(e) {
    $('sfin-sync-msg').textContent = 'Error: ' + e.message;
  }
}

async function sfinSync() {
  $('sfin-sync-msg').textContent = 'Syncing…';
  try {
    const r = await api('POST', '/simplefin/sync');
    $('sfin-sync-msg').textContent = `Synced ${r.accounts_synced} accounts`;
    loadDashboard();
  } catch(e) {
    $('sfin-sync-msg').textContent = 'Error: ' + e.message;
  }
}

async function sfinClaim() {
  const token = $('sfin-token').value.trim();
  if (!token) return;
  $('sfin-connect-msg').textContent = 'Claiming…';
  try {
    await api('POST', '/simplefin/claim', { token });
    $('sfin-connect-msg').textContent = ' Connected.';
    setTimeout(loadImport, 800);
  } catch(e) {
    $('sfin-connect-msg').textContent = ' ' + e.message;
  }
}

async function sfinConnectDirect() {
  const url = $('sfin-access-url').value.trim();
  if (!url) return;
  await api('POST', '/simplefin/connect', { access_url: url });
  $('sfin-connect-msg').textContent = ' Saved.';
  setTimeout(loadImport, 500);
}

function renderSfinAccounts(data) {
  const tbody = $('sfin-accounts-tbody');
  const accounts = data.accounts || [];

  if (data.errors?.length) {
    $('sfin-errors').style.display = 'block';
    $('sfin-errors-list').innerHTML = data.errors.map(e =>
      `<div style="color:var(--red);font-size:13px;">${e}</div>`).join('');
  }

  if (accounts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No accounts fetched yet — click "Fetch Accounts".</td></tr>';
    return;
  }

  tbody.innerHTML = accounts.map(a => {
    let status, actions;
    if (a.ignored) {
      status = `<span class="badge" style="background:rgba(123,127,150,.15);color:var(--muted)">Ignored</span>`;
      actions = `<button class="btn btn-ghost btn-sm" onclick="sfinUnignore('${a.sfin_id}')">Restore</button>`;
    } else if (a.linked_account_id) {
      status = `<span class="badge badge-savings">Linked</span>`;
      actions = `<button class="btn btn-ghost btn-sm" onclick="sfinOpenMap('${a.sfin_id}','${esc(a.raw_name)}','${esc(a.org_name||'')}')">Re-map</button>`;
    } else {
      status = `<span class="badge badge-other">Unmapped</span>`;
      actions = `
        <button class="btn btn-primary btn-sm" onclick="sfinOpenMap('${a.sfin_id}','${esc(a.raw_name)}','${esc(a.org_name||'')}')">Import</button>
        <button class="btn btn-ghost btn-sm" onclick="sfinIgnore('${a.sfin_id}')">Ignore</button>`;
    }
    const bal = a.balance != null
      ? `<span class="${a.balance < 0 ? 'neg' : 'pos'}">${fmt(a.balance)}</span>`
      : '—';
    return `<tr>
      <td>${a.org_name || '—'}</td>
      <td style="font-family:monospace;font-size:12px;">${a.raw_name}</td>
      <td>${bal}</td>
      <td style="color:var(--muted);font-size:12px;">${a.balance_date_str || '—'}</td>
      <td>${status}</td>
      <td><div class="row-actions">${actions}</div></td>
    </tr>`;
  }).join('');
}

async function sfinOpenMap(sfinId, rawName, orgName) {
  $('sfin-map-id').value = sfinId;
  $('sfin-map-name').value = rawName;
  $('sfin-map-type').value = 'checking';
  $('sfin-map-apy').value = '';
  $('sfin-map-institution').value = orgName;
  $('modal-sfin-title').textContent = 'Import: ' + rawName;
  $('sfin-suggestions-list').innerHTML = '<div style="color:var(--muted);font-size:12px;">Loading suggestions…</div>';
  $('modal-sfin-map').classList.add('open');

  try {
    const sugg = await api('GET', `/simplefin/recurring-suggestions/${encodeURIComponent(sfinId)}`);
    renderSuggestions(sugg);
  } catch(e) {
    $('sfin-suggestions-list').innerHTML = '<div style="color:var(--muted);font-size:12px;">No transaction history yet.</div>';
  }
}

function renderSuggestions(sugg) {
  if (!sugg.length) {
    $('sfin-suggestions-list').innerHTML = '<div style="color:var(--muted);font-size:12px;">No recurring patterns detected.</div>';
    return;
  }
  $('sfin-suggestions-list').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>✓</th><th>Description</th><th>Kind</th><th>Amount</th><th>Frequency</th><th>Seen</th></tr></thead>
        <tbody>
          ${sugg.map((s, i) => `<tr>
            <td><input type="checkbox" id="sugg-${i}" checked data-kind="${s.kind}"
              data-amount="${s.amount}" data-freq="${s.frequency}" data-name="${esc(s.description)}"></td>
            <td style="font-size:12px;">${s.description}</td>
            <td><span class="badge badge-${s.kind}">${s.kind}</span></td>
            <td>${fmt(s.amount)}</td>
            <td>${s.frequency}</td>
            <td style="color:var(--muted);font-size:12px;">${s.occurrences}x</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function sfinDoImport() {
  const sfinId = $('sfin-map-id').value;
  const body = {
    sfin_id: sfinId,
    name: $('sfin-map-name').value,
    type: $('sfin-map-type').value,
    apy: +$('sfin-map-apy').value || 0,
    institution: $('sfin-map-institution').value || null,
  };
  const result = await api('POST', '/simplefin/link', body);

  // Import checked suggestions as recurring
  const checks = document.querySelectorAll('#sfin-suggestions-list input[type=checkbox]:checked');
  for (const cb of checks) {
    await api('POST', '/recurring', {
      name: cb.dataset.name,
      kind: cb.dataset.kind,
      amount: +cb.dataset.amount,
      frequency: cb.dataset.freq,
      category: 'SimpleFIN Import',
    }).catch(() => {});
  }

  $('modal-sfin-map').classList.remove('open');
  sfinPreview();
  loadDashboard();
}

async function sfinIgnore(sfinId) {
  await api('POST', '/simplefin/link', { sfin_id: sfinId, ignore: true });
  sfinPreview();
}

async function sfinUnignore(sfinId) {
  await api('POST', '/simplefin/link', { sfin_id: sfinId, ignore: false });
  sfinPreview();
}

function esc(s) {
  return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ---- PDF Ingest ----

let _lastImportId = null;

async function loadIngest() {
  loadIngestHistory();
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (file) uploadPdf(file);
}

// Drag-and-drop wiring (runs after DOM is ready)
window.addEventListener('DOMContentLoaded', () => {
  const zone = $('drop-zone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) uploadPdf(file);
  });
});

async function uploadPdf(file) {
  const status = $('ingest-status');
  const result = $('ingest-result');
  const actions = $('ingest-actions');

  status.className = 'status-processing';
  status.textContent = `Parsing ${file.name}...`;
  result.style.display = 'none';
  actions.style.display = 'none';
  _lastImportId = null;

  const form = new FormData();
  form.append('file', file);

  let data;
  try {
    const res = await fetch('/api/ingest/upload', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || res.statusText);
    }
    data = await res.json();
  } catch (e) {
    status.className = 'status-error';
    status.textContent = 'Error: ' + e.message;
    return;
  }

  _lastImportId = data.import_id;
  status.className = 'status-done';
  status.textContent = `Parsed: ${file.name}`;
  result.style.display = 'block';
  result.innerHTML = renderParsed(data.parsed) + renderMissingFields(data.parsed);
  actions.style.display = 'flex';
  loadIngestHistory();
}

function renderParsed(p) {
  if (!p) return '<div class="empty">No data extracted.</div>';
  const d = p.data || {};
  const typeLabel = (p.doc_type || 'unknown').replace(/_/g, ' ').toUpperCase();
  const conf = p.confidence ? ` — ${Math.round(p.confidence * 100)}% confidence` : '';

  let html = `<div class="doc-type-badge">${typeLabel}${conf}</div>`;
  html += `<div class="parsed-field"><span class="key">Institution:</span> ${p.institution || '—'}</div>`;
  html += `<div class="parsed-field"><span class="key">Summary:</span> ${p.summary || '—'}</div>`;

  if (p.doc_type === 'bank_statement' || p.doc_type === 'credit_card') {
    const bal = p.doc_type === 'credit_card' ? d.statement_balance : d.ending_balance;
    html += `<div class="parsed-field"><span class="key">Account:</span> ${d.account_name || d.account_number || '—'}</div>`;
    html += `<div class="parsed-field"><span class="key">Balance:</span> <span class="${bal < 0 ? 'neg' : 'pos'}">${fmt(bal)}</span></div>`;
    html += `<div class="parsed-field"><span class="key">Statement Date:</span> ${d.statement_date || '—'}</div>`;
    if (p.doc_type === 'credit_card') {
      html += `<div class="parsed-field"><span class="key">Min Payment:</span> ${fmt(d.minimum_payment)}</div>`;
      html += `<div class="parsed-field"><span class="key">APR:</span> ${d.apr ? d.apr + '%' : '—'}</div>`;
    }
    const txns = d.transactions || [];
    if (txns.length) {
      const newCount  = d.new_count != null ? d.new_count : txns.length;
      const dupeCount = d.duplicate_count || 0;
      let txnLabel = `${txns.length} transactions found — <span class="pos">${newCount} new</span>`;
      if (dupeCount > 0) txnLabel += `, <span style="color:#888">${dupeCount} already imported (will be skipped)</span>`;
      html += `<div style="margin-top:8px;font-size:11px;">${txnLabel}</div>`;
      html += `<div class="table-wrap" style="max-height:180px;overflow-y:auto;margin-top:4px;"><table>`;
      html += `<thead><tr><th>Date</th><th>Description</th><th>Amount</th><th></th></tr></thead><tbody>`;
      txns.slice(0, 30).forEach(t => {
        const dupeMark = t.is_duplicate ? `<td style="color:#aaa;font-size:10px;">dup</td>` : '<td></td>';
        const rowStyle = t.is_duplicate ? ' style="opacity:0.45;"' : '';
        html += `<tr${rowStyle}><td>${t.date||'—'}</td><td style="font-size:11px;">${t.description||'—'}</td>
          <td class="${t.amount < 0 ? 'neg' : 'pos'}">${fmt(t.amount)}</td>${dupeMark}</tr>`;
      });
      html += '</tbody></table></div>';
    }
  } else if (p.doc_type === 'rsu_letter') {
    html += `<div class="parsed-field"><span class="key">Company:</span> ${d.company || '—'} ${d.ticker ? '(' + d.ticker + ')' : ''}</div>`;
    if (d.broker) html += `<div class="parsed-field"><span class="key">Broker:</span> ${d.broker}</div>`;

    if (d.grants && d.grants.length > 0) {
      // Multi-grant (Schwab Equity Awards Center)
      html += `<div class="parsed-field"><span class="key">Grants:</span> ${d.total_grants}</div>`;
      html += `<div class="parsed-field"><span class="key">Total Shares:</span> <strong>${(d.total_shares||0).toLocaleString()}</strong></div>`;
      html += `<div class="parsed-field"><span class="key">Vested:</span> <span class="pos">${(d.shares_vested||0).toLocaleString()}</span></div>`;
      html += `<div class="parsed-field"><span class="key">Pending:</span> ${(d.shares_pending||0).toLocaleString()}</div>`;
      d.grants.forEach(g => {
        html += `<div style="margin-top:10px;border-top:1px solid #ccc;padding-top:8px;font-size:12px;">`;
        html += `<strong>Grant #${g.grant_number}</strong> &nbsp;|&nbsp; ${g.grant_date} &nbsp;|&nbsp; `;
        html += `${g.shares_granted} shares &nbsp;|&nbsp; `;
        html += `<span class="pos">${g.shares_vested} vested</span> &nbsp;|&nbsp; ${g.shares_pending} pending</div>`;
        const sched = g.vesting_schedule || [];
        if (sched.length) {
          const vestedCount  = sched.filter(v => v.vested).length;
          const pendingCount = sched.filter(v => !v.vested).length;
          html += `<div class="table-wrap" style="max-height:160px;overflow-y:auto;margin-top:4px;"><table>`;
          html += `<thead><tr><th>Date</th><th>Shares</th><th>Status</th><th>Price at Vest</th></tr></thead><tbody>`;
          sched.forEach(v => {
            html += `<tr${v.vested ? '' : ' style="color:#888"'}>`
              + `<td>${v.date}</td><td>${v.shares}</td>`
              + `<td class="${v.vested ? 'pos' : 'muted'}">${v.vested ? 'Vested' : 'Pending'}</td>`
              + `<td>${v.price_at_vest ? fmt(v.price_at_vest) : '—'}</td></tr>`;
          });
          html += '</tbody></table></div>';
        }
      });
    } else {
      // Single grant (PDF or manual)
      html += `<div class="parsed-field"><span class="key">Grant Number:</span> ${d.grant_number || '—'}</div>`;
      html += `<div class="parsed-field"><span class="key">Grant Date:</span> ${d.grant_date || '—'}</div>`;
      html += `<div class="parsed-field"><span class="key">Grant Price:</span> ${fmt(d.grant_price)}</div>`;
      html += `<div class="parsed-field"><span class="key">Shares Granted:</span> <strong>${(d.shares_granted||0).toLocaleString()}</strong></div>`;
      html += `<div class="parsed-field"><span class="key">Shares Vested:</span> <span class="pos">${(d.shares_vested||0).toLocaleString()}</span></div>`;
      html += `<div class="parsed-field"><span class="key">Shares Pending:</span> ${(d.shares_pending||0).toLocaleString()}</div>`;
      const sched = d.vesting_schedule || [];
      if (sched.length) {
        html += `<div style="margin-top:8px;font-weight:bold;font-size:11px;">Vesting Schedule (${sched.length} events)</div>`;
        html += `<div class="table-wrap" style="max-height:180px;overflow-y:auto;margin-top:4px;"><table>`;
        html += `<thead><tr><th>Date</th><th>Shares</th><th>Status</th></tr></thead><tbody>`;
        sched.forEach(v => {
          html += `<tr><td>${v.date||'—'}</td><td>${v.shares}</td>
            <td class="${v.vested ? 'pos' : 'muted'}">${v.vested ? 'Vested' : 'Pending'}</td></tr>`;
        });
        html += '</tbody></table></div>';
      }
    }
  } else if (p.doc_type === 'brokerage') {
    html += `<div class="parsed-field"><span class="key">Total Value:</span> <span class="pos">${fmt(d.total_value)}</span></div>`;
    html += `<div class="parsed-field"><span class="key">Cash:</span> ${fmt(d.cash_balance)}</div>`;
    html += `<div class="parsed-field"><span class="key">Statement Date:</span> ${d.statement_date || '—'}</div>`;
    const h = d.holdings || [];
    if (h.length) {
      html += `<div style="margin-top:8px;font-weight:bold;font-size:11px;">Holdings</div>`;
      html += `<div class="table-wrap" style="margin-top:4px;"><table>`;
      html += `<thead><tr><th>Symbol</th><th>Shares</th><th>Price</th><th>Value</th></tr></thead><tbody>`;
      h.forEach(hh => {
        html += `<tr><td><strong>${hh.symbol||'—'}</strong></td><td>${hh.shares}</td>
          <td>${fmt(hh.price)}</td><td class="pos">${fmt(hh.value)}</td></tr>`;
      });
      html += '</tbody></table></div>';
    }
  } else {
    html += `<pre style="font-size:10px;overflow:auto;max-height:200px;">${JSON.stringify(d, null, 2)}</pre>`;
  }

  return html;
}

function renderMissingFields(p) {
  if (!p) return '';
  const d = p.data || {};
  const fields = [];
  const cur = p.doc_type || '';

  fields.push(`<div class="missing-field">
    <label for="mf-institution">Institution:</label>
    <input type="text" id="mf-institution" value="${p.institution || ''}" placeholder="e.g. Chase, Fidelity">
  </div>`);

  const typeOpts = [
    ['', '-- select --'],
    ['bank_statement', 'Bank Statement'],
    ['credit_card', 'Credit Card Statement'],
    ['brokerage', 'Brokerage Statement'],
    ['rsu_letter', 'RSU Letter'],
  ].map(([v, label]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${label}</option>`).join('');
  fields.push(`<div class="missing-field">
    <label for="mf-doc-type">Document Type:</label>
    <select id="mf-doc-type">${typeOpts}</select>
  </div>`);

  if (p.doc_type === 'bank_statement' || p.doc_type === 'credit_card') {
    if (!d.account_name) {
      fields.push(`<div class="missing-field">
        <label for="mf-account-name">Account Name:</label>
        <input type="text" id="mf-account-name" placeholder="e.g. Checking ••1234">
      </div>`);
    }
    if (!d.account_type) {
      fields.push(`<div class="missing-field">
        <label for="mf-account-type">Account Type:</label>
        <select id="mf-account-type">
          <option value="">-- select --</option>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
          <option value="credit_card">Credit Card</option>
        </select>
      </div>`);
    }
  }

  if (p.doc_type === 'rsu_letter') {
    if (!d.company) {
      fields.push(`<div class="missing-field">
        <label for="mf-company">Company:</label>
        <input type="text" id="mf-company" placeholder="e.g. Acme Corp">
      </div>`);
    }
    if (!d.ticker) {
      fields.push(`<div class="missing-field">
        <label for="mf-ticker">Ticker (optional):</label>
        <input type="text" id="mf-ticker" placeholder="e.g. NVDA">
      </div>`);
    }
  }

  if (fields.length === 0) return '';

  return `<div id="missing-fields-form" style="margin-top:12px;padding:10px;border:1px solid #999;background:#f9f9f9;">
    <div style="font-weight:bold;font-size:12px;margin-bottom:8px;">Review & correct before importing:</div>
    ${fields.join('')}
  </div>`;
}

function _collectPatch() {
  const patch = {};
  const mfInst = $('mf-institution');
  if (mfInst?.value.trim()) patch.institution = mfInst.value.trim();
  const mfDocType = $('mf-doc-type');
  if (mfDocType?.value) patch.doc_type = mfDocType.value;
  const mfAccName = $('mf-account-name');
  if (mfAccName?.value.trim()) patch.account_name = mfAccName.value.trim();
  const mfAccType = $('mf-account-type');
  if (mfAccType?.value) patch.account_type = mfAccType.value;
  const mfCompany = $('mf-company');
  if (mfCompany?.value.trim()) patch.company = mfCompany.value.trim();
  const mfTicker = $('mf-ticker');
  if (mfTicker?.value.trim()) patch.ticker = mfTicker.value.trim();
  return patch;
}

async function saveIngestPatch(id, statusElId) {
  const patch = _collectPatch();
  if (!Object.keys(patch).length) {
    const el = $(statusElId);
    if (el) { el.textContent = 'No changes.'; setTimeout(() => { el.textContent = ''; }, 1500); }
    return;
  }
  const r = await api('POST', `/ingest/${id}/patch`, patch);
  const form = $('missing-fields-form');
  if (form) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderMissingFields(r.parsed);
    const newForm = tmp.querySelector('#missing-fields-form');
    if (newForm) form.replaceWith(newForm);
  }
  if (statusElId) {
    const el = $(statusElId);
    if (el) { el.textContent = 'Saved.'; setTimeout(() => { el.textContent = ''; }, 2000); }
  }
  loadIngestHistory();
}

async function confirmImport() {
  if (!_lastImportId) return;

  const patch = _collectPatch();
  if (Object.keys(patch).length > 0) {
    await api('POST', `/ingest/${_lastImportId}/patch`, patch);
  }

  const r = await api('POST', `/ingest/${_lastImportId}/confirm`);
  $('ingest-status').textContent = 'Imported: ' + r.imported.join(', ');
  $('ingest-actions').style.display = 'none';
  loadDashboard();
  loadIngestHistory();
}

function dismissIngest() {
  $('ingest-result').style.display = 'none';
  $('ingest-actions').style.display = 'none';
  $('ingest-status').textContent = '';
  _lastImportId = null;
}

async function loadIngestHistory() {
  const rows = await api('GET', '/ingest/history');
  const tbody = $('ingest-history-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No imports yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td style="font-size:11px;">${r.filename}</td>
      <td><span class="doc-type-badge" style="font-size:9px;">${(r.doc_type||'unknown').replace(/_/g,' ')}</span></td>
      <td style="font-size:11px;color:var(--muted);">${r.imported_at?.slice(0,16)||'—'}</td>
      <td style="color:${r.status==='imported'?'var(--green)':'var(--muted)'};">${r.status}</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" onclick="reviewImport(${r.id})">Review</button>
        <button class="btn btn-danger btn-sm" onclick="deleteImport(${r.id})">Delete</button>
      </div></td>
    </tr>`).join('');
}

async function deleteImport(id) {
  if (!confirm('Delete this import record? This does not remove any accounts or data already confirmed.')) return;
  await api('DELETE', `/ingest/${id}`);
  loadIngestHistory();
}

async function reviewImport(id) {
  const data = await api('GET', `/ingest/${id}`);
  const body = $('ingest-review-body');
  body.innerHTML = renderParsed(data.parsed) + renderMissingFields(data.parsed);
  const importBtn = data.status !== 'imported'
    ? `<button class="btn btn-primary" onclick="_lastImportId=${id};confirmImport();$('modal-ingest-review').classList.remove('open')">Import</button>`
    : '';
  body.innerHTML += `<div class="modal-footer" style="display:flex;gap:8px;margin-top:12px;">
    ${importBtn}
    <button class="btn btn-ghost" onclick="saveIngestPatch(${id},'ingest-review-save-status')">Save Changes</button>
    <span id="ingest-review-save-status" style="font-size:11px;color:var(--muted);line-height:30px;"></span>
  </div>`;
  _lastImportId = id;
  $('modal-ingest-review').classList.add('open');
}

// ---- RSUs ----

async function fetchNvdaPrice(force = false) {
  const priceEl  = $('rsu-price-value');
  const changeEl = $('rsu-price-change');
  const dateEl   = $('rsu-price-date');
  priceEl.textContent = 'fetching…';

  let q;
  try {
    q = await api('GET', '/rsus/quote/NVDA');
  } catch(e) {
    priceEl.textContent = 'unavailable';
    return;
  }

  priceEl.textContent = '$' + q.price.toFixed(2);
  const up = q.change >= 0;
  changeEl.innerHTML = `<span class="${up ? 'pos' : 'neg'}">${up ? '+' : ''}${q.change.toFixed(2)} (${up ? '+' : ''}${q.change_pct.toFixed(3)}%)</span>`;
  dateEl.textContent = q.trade_date ? `as of ${q.trade_date}` : '';

  // Refresh grant cards now that current_price is updated server-side
  await loadRsuGrants();
  loadRsuEquitySummary();
}

async function loadRsuEquitySummary() {
  try {
    const s = await api('GET', '/rsus/equity-summary');
    if ($('rsu-pending-value'))  $('rsu-pending-value').textContent  = s.pending_value  ? fmt(s.pending_value)  : '—';
    if ($('rsu-next90-net'))     $('rsu-next90-net').textContent     = s.next_90_net    ? fmt(s.next_90_net)    : '—';
    if ($('rsu-total-pending-shares')) {
      const total = (await api('GET', '/rsus')).reduce((n, g) => n + g.shares_pending, 0);
      $('rsu-total-pending-shares').textContent = total.toLocaleString() + ' shares';
    }
  } catch(_) {}
}

async function loadRsus() {
  fetchNvdaPrice();   // non-blocking — updates price bar then refreshes grants
  await Promise.all([loadRsuUpcoming(), loadRsuGrants(), loadRsuEquitySummary()]);
}

async function loadRsuUpcoming() {
  const events = await api('GET', '/rsus/upcoming?limit=12');
  const tbody = $('rsu-upcoming-tbody');
  if (!events.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No upcoming vests — add a grant or set current price.</td></tr>';
    return;
  }
  tbody.innerHTML = events.map(e => `
    <tr>
      <td>${e.date}</td>
      <td>${e.company}${e.ticker ? ' (' + e.ticker + ')' : ''}</td>
      <td>${e.shares.toLocaleString()}</td>
      <td class="pos">${e.gross_value != null ? fmt(e.gross_value) : '—'}</td>
      <td class="neg">${e.tax_withheld != null ? fmt(e.tax_withheld) : '—'}</td>
      <td class="pos">${e.net_value != null ? fmt(e.net_value) : '—'}</td>
    </tr>`).join('');
}

async function loadRsuGrants() {
  const grants = await api('GET', '/rsus');
  const container = $('rsu-grants-list');
  if (!grants.length) {
    container.innerHTML = '<div class="empty">No grants yet.</div>';
    return;
  }
  container.innerHTML = grants.map(g => {
    const pct = g.shares_granted ? Math.round(g.shares_vested / g.shares_granted * 100) : 0;
    const taxLabel = g.federal_tax_rate ? g.federal_tax_rate + '%' : '22%';
    return `
    <div class="panel" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <strong>${g.company}</strong>${g.ticker ? ` <span style="color:var(--muted)">(${g.ticker})</span>` : ''}
          ${g.broker ? `<span style="font-size:11px;color:var(--muted);margin-left:8px;">${g.broker}</span>` : ''}
          ${g.grant_number ? `<span style="font-size:11px;color:var(--muted);margin-left:8px;">Grant #${g.grant_number}</span>` : ''}
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="editRsu(${g.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteRsu(${g.id})">Remove</button>
        </div>
      </div>

      <div class="cards" style="margin-top:8px;">
        <div class="card">
          <div class="label">Granted</div>
          <div class="value">${g.shares_granted.toLocaleString()}</div>
        </div>
        <div class="card">
          <div class="label">Vested</div>
          <div class="value pos">${g.shares_vested.toLocaleString()}</div>
        </div>
        <div class="card">
          <div class="label">Pending</div>
          <div class="value">${g.shares_pending.toLocaleString()}</div>
        </div>
        <div class="card">
          <div class="label">Tax Rate</div>
          <div class="value">${taxLabel}</div>
        </div>
        ${g.pending_value != null ? `<div class="card"><div class="label">Pending Value</div><div class="value pos">${fmt(g.pending_value)}</div></div>` : ''}
        ${g.grant_date ? `<div class="card"><div class="label">Grant Date</div><div class="value" style="font-size:13px;">${g.grant_date}</div></div>` : ''}
      </div>

      <div style="margin-top:8px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:3px;">${pct}% vested (${g.shares_vested} of ${g.shares_granted} shares)</div>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
      </div>

      ${g.next_vest_date ? `
      <div style="margin-top:8px;font-size:12px;border-top:1px solid #eee;padding-top:6px;">
        <strong>Next vest:</strong> ${g.next_vest_date} — ${g.next_vest_shares} shares
        ${g.next_vest_gross != null ? `
          &nbsp;|&nbsp; Gross: <span class="pos">${fmt(g.next_vest_gross)}</span>
          &nbsp;|&nbsp; Tax: <span class="neg">${fmt(g.next_vest_tax)}</span>
          &nbsp;|&nbsp; Net: <span class="pos">${fmt(g.next_vest_net)}</span>
          ${g.next_vest_shares_delivered != null ? `&nbsp;|&nbsp; ~${g.next_vest_shares_delivered} shares delivered` : ''}
        ` : ''}
      </div>` : ''}

      ${g.vesting_schedule.length ? `
      <details style="margin-top:8px;">
        <summary style="cursor:pointer;font-size:11px;color:var(--blue);">View full schedule (${g.vesting_schedule.length} events)</summary>
        <div class="table-wrap" style="margin-top:6px;max-height:220px;overflow-y:auto;">
          <table>
            <thead><tr><th>Date</th><th>Shares</th><th>Status</th><th>Price at Vest</th><th>Gross Value</th></tr></thead>
            <tbody>
              ${g.vesting_schedule.map(v => {
                const price = v.price_at_vest || g.current_price;
                const gross = price ? fmt(v.shares * price) : '—';
                return `<tr>
                  <td>${v.date}</td>
                  <td>${v.shares.toLocaleString()}</td>
                  <td class="${v.vested ? 'pos' : 'muted'}">${v.vested ? 'Vested' : 'Pending'}</td>
                  <td>${v.price_at_vest ? fmt(v.price_at_vest) : (g.current_price ? fmt(g.current_price) + '*' : '—')}</td>
                  <td class="${v.vested ? 'pos' : ''}">${gross}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          ${g.current_price && g.vesting_schedule.some(v => !v.price_at_vest && !v.vested) ? '<div style="font-size:10px;color:var(--muted);margin-top:2px;">* estimated at current price</div>' : ''}
        </div>
      </details>` : ''}
    </div>`;
  }).join('');
}

let _rsuGrants = [];

async function openRsuModal(data = {}) {
  $('rsu-id').value          = data.id || '';
  $('rsu-company').value     = data.company || '';
  $('rsu-ticker').value      = data.ticker || 'NVDA';
  $('rsu-broker').value      = data.broker || 'Charles Schwab';
  $('rsu-grant-number').value = data.grant_number || '';
  $('rsu-grant-date').value  = data.grant_date || '';
  $('rsu-grant-price').value = data.grant_price || '';
  $('rsu-shares-granted').value = data.shares_granted || '';
  $('rsu-tax-rate').value    = data.federal_tax_rate ?? 22;
  $('rsu-current-price').value = data.current_price || '';
  $('rsu-notes').value       = data.notes || '';
  $('modal-rsu-title').textContent = data.id ? 'Edit RSU Grant' : 'Add RSU Grant';

  // Populate vesting schedule
  const tbody = $('rsu-sched-tbody');
  tbody.innerHTML = '';
  const sched = data.vesting_schedule || [];
  if (sched.length) {
    sched.forEach(v => rsuAddVestRow(v));
  } else {
    rsuAddVestRow();
  }

  $('modal-rsu').classList.add('open');
}

function rsuAddVestRow(v = {}) {
  const tbody = $('rsu-sched-tbody');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="date" class="rsu-vest-date" value="${v.date || ''}" style="width:130px;"></td>
    <td><input type="number" class="rsu-vest-shares" value="${v.shares || ''}" min="1" style="width:80px;" placeholder="0"></td>
    <td style="text-align:center;"><input type="checkbox" class="rsu-vest-vested" ${v.vested ? 'checked' : ''}></td>
    <td><input type="number" class="rsu-vest-price" value="${v.price_at_vest || ''}" step="0.01" style="width:100px;" placeholder="optional"></td>
    <td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">X</button></td>`;
  tbody.appendChild(row);
}

function _collectVestSchedule() {
  const rows = $('rsu-sched-tbody').querySelectorAll('tr');
  const sched = [];
  rows.forEach(row => {
    const date   = row.querySelector('.rsu-vest-date').value;
    const shares = parseInt(row.querySelector('.rsu-vest-shares').value);
    const vested = row.querySelector('.rsu-vest-vested').checked;
    const price  = parseFloat(row.querySelector('.rsu-vest-price').value) || null;
    if (date && shares > 0) {
      sched.push({ date, shares, vested, price_at_vest: price });
    }
  });
  return sched;
}

async function editRsu(id) {
  const grants = await api('GET', '/rsus');
  openRsuModal(grants.find(g => g.id === id));
}

async function deleteRsu(id) {
  if (!confirm('Remove this grant? Data is kept in the database.')) return;
  await api('DELETE', `/rsus/${id}`);
  loadRsuGrants();
}

$('btn-add-rsu').addEventListener('click', () => openRsuModal());

$('form-rsu').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('rsu-id').value;
  const body = {
    company:          $('rsu-company').value,
    ticker:           $('rsu-ticker').value || null,
    broker:           $('rsu-broker').value || null,
    grant_number:     $('rsu-grant-number').value || null,
    grant_date:       $('rsu-grant-date').value || null,
    grant_price:      parseFloat($('rsu-grant-price').value) || null,
    shares_granted:   parseInt($('rsu-shares-granted').value),
    federal_tax_rate: parseFloat($('rsu-tax-rate').value) || 22,
    current_price:    parseFloat($('rsu-current-price').value) || null,
    notes:            $('rsu-notes').value || null,
    vesting_schedule: _collectVestSchedule(),
  };
  if (id) await api('PUT', `/rsus/${id}`, body);
  else     await api('POST', '/rsus', body);
  $('modal-rsu').classList.remove('open');
  loadRsus();
});

// ---- Transactions ----
let _txnOffset = 0;
const _TXN_LIMIT = 100;
let _txnTotal = 0;
let _txnDebounce = null;

function debounceLoadTxn() {
  clearTimeout(_txnDebounce);
  _txnDebounce = setTimeout(() => { _txnOffset = 0; loadTransactions(); }, 300);
}

function txnPage(dir) {
  const next = _txnOffset + dir * _TXN_LIMIT;
  if (next < 0 || next >= _txnTotal) return;
  _txnOffset = next;
  loadTransactions();
}

async function loadTransactions() {
  const accountId = $('txn-account-filter').value;
  const search = ($('txn-search').value || '').trim();

  const params = new URLSearchParams({ limit: _TXN_LIMIT, offset: _txnOffset });
  if (accountId) params.set('account_id', accountId);
  if (search) params.set('search', search);

  const data = await api('GET', '/transactions?' + params.toString());
  _txnTotal = data.total;

  // populate account filter once
  const sel = $('txn-account-filter');
  if (sel.options.length <= 1) {
    for (const a of (data.accounts || [])) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name + (a.institution ? ` — ${a.institution}` : '');
      sel.appendChild(opt);
    }
  }

  $('txn-count').textContent = `${data.total.toLocaleString()} transaction${data.total !== 1 ? 's' : ''}`;
  const pageNum = Math.floor(_txnOffset / _TXN_LIMIT) + 1;
  const pageTotal = Math.max(1, Math.ceil(_txnTotal / _TXN_LIMIT));
  $('txn-page-label').textContent = `Page ${pageNum} of ${pageTotal}`;
  $('txn-prev').disabled = _txnOffset === 0;
  $('txn-next').disabled = _txnOffset + _TXN_LIMIT >= _txnTotal;

  const tbody = $('txn-tbody');
  if (!data.items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No transactions found.</td></tr>';
    return;
  }

  tbody.innerHTML = data.items.map(t => {
    const amt = t.amount || 0;
    const amtCls = amt >= 0 ? 'pos' : 'neg';
    const amtStr = fmt(Math.abs(amt));
    const signStr = amt >= 0 ? '+' : '−';
    return `<tr>
      <td style="white-space:nowrap">${t.date || ''}</td>
      <td style="font-size:11px;color:#555;">${t.account_name || ''}</td>
      <td>${escHtml(t.description || '')}</td>
      <td><span style="font-size:11px;color:#555;">${escHtml(t.category || '')}</span></td>
      <td style="text-align:right;font-family:'Courier New',monospace;" class="${amtCls}">${signStr}${amtStr}</td>
      <td><button class="btn btn-sm" onclick="openTxnEdit(${t.id})">Edit</button></td>
    </tr>`;
  }).join('');
}

function openTxnEdit(id) {
  const tbody = $('txn-tbody');
  const btn = tbody.querySelector(`button[onclick="openTxnEdit(${id})"]`);
  const row = btn.closest('tr');
  const cells = row.querySelectorAll('td');

  $('txn-edit-id').value = id;
  $('txn-edit-date').value = cells[0].textContent.trim();
  $('txn-edit-desc').value = cells[2].textContent.trim();
  $('txn-edit-cat').value = cells[3].textContent.trim();

  // Parse amount back from display
  const amtCell = cells[4].textContent.trim();
  const neg = amtCell.startsWith('−');
  const num = parseFloat(amtCell.replace(/[^0-9.]/g, ''));
  $('txn-edit-amount').value = (neg ? -num : num).toFixed(2);

  $('modal-txn').classList.add('open');
}

async function saveTxnEdit() {
  const id = parseInt($('txn-edit-id').value);
  const body = {
    date:        $('txn-edit-date').value || null,
    description: $('txn-edit-desc').value || null,
    category:    $('txn-edit-cat').value || null,
    amount:      parseFloat($('txn-edit-amount').value),
  };
  await api('PATCH', `/transactions/${id}`, body);
  $('modal-txn').classList.remove('open');
  loadTransactions();
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---- Budget Calculator (Bogleheads Household Budgeting) ----

const BDG_SECTIONS = [
  {
    id: 'housing', label: 'HOUSING', guideline: '≤28% gross',
    maxPct: 0.28, softPct: 0.25, isSavings: false,
    items: [
      { id: 'housing_rent',  label: 'Rent / Mortgage payment' },
      { id: 'housing_tax',   label: 'Property taxes (if not escrowed)' },
      { id: 'housing_ins',   label: 'Homeowners / Renters insurance' },
      { id: 'housing_hoa',   label: 'HOA / condo fees' },
      { id: 'housing_maint', label: 'Maintenance & repairs (~1% home value / yr)' },
    ]
  },
  {
    id: 'transport', label: 'TRANSPORTATION', guideline: '≤15% gross',
    maxPct: 0.15, softPct: 0.12, isSavings: false,
    items: [
      { id: 'tr_car',   label: 'Car payment(s)' },
      { id: 'tr_ins',   label: 'Auto insurance' },
      { id: 'tr_gas',   label: 'Gas / fuel' },
      { id: 'tr_park',  label: 'Parking & tolls' },
      { id: 'tr_maint', label: 'Maintenance & registration' },
    ]
  },
  {
    id: 'food', label: 'FOOD', guideline: '≤15% gross',
    maxPct: 0.15, softPct: 0.10, isSavings: false,
    items: [
      { id: 'food_groc',   label: 'Groceries & supermarket' },
      { id: 'food_dining', label: 'Dining out & delivery' },
    ]
  },
  {
    id: 'healthcare', label: 'HEALTHCARE', guideline: '≤10% gross',
    maxPct: 0.10, softPct: 0.07, isSavings: false,
    items: [
      { id: 'hc_prem',   label: 'Health insurance premiums (employee share)' },
      { id: 'hc_dental', label: 'Dental & vision premiums' },
      { id: 'hc_oop',    label: 'Out-of-pocket / copays' },
      { id: 'hc_rx',     label: 'Prescriptions' },
    ]
  },
  {
    id: 'utilities', label: 'UTILITIES & COMMUNICATIONS', guideline: '≤8% gross',
    maxPct: 0.08, softPct: 0.05, isSavings: false,
    items: [
      { id: 'util_elec',    label: 'Electricity' },
      { id: 'util_gas',     label: 'Gas / heating fuel' },
      { id: 'util_water',   label: 'Water & sewer' },
      { id: 'util_internet',label: 'Internet' },
      { id: 'util_phone',   label: 'Cell phone(s)' },
    ]
  },
  {
    id: 'personal', label: 'PERSONAL & HOUSEHOLD', guideline: '≤8% gross',
    maxPct: 0.08, softPct: 0.05, isSavings: false,
    items: [
      { id: 'per_clothing', label: 'Clothing & shoes' },
      { id: 'per_care',     label: 'Personal care & grooming' },
      { id: 'per_supplies', label: 'Household supplies & cleaning' },
      { id: 'per_pets',     label: 'Pets' },
      { id: 'per_subs',     label: 'Subscriptions & streaming' },
    ]
  },
  {
    id: 'debt', label: 'DEBT PAYMENTS (non-housing)', guideline: 'Housing+Debt ≤36%',
    maxPct: 0.10, softPct: 0.08, isSavings: false, isDebt: true,
    items: [
      { id: 'debt_student', label: 'Student loans' },
      { id: 'debt_cc',      label: 'Credit card minimum payments' },
      { id: 'debt_other',   label: 'Personal / other loans' },
    ]
  },
  {
    id: 'children', label: 'CHILDREN & EDUCATION', guideline: 'varies',
    maxPct: null, softPct: null, isSavings: false,
    items: [
      { id: 'kid_childcare',  label: 'Childcare / daycare' },
      { id: 'kid_school',     label: 'School tuition & fees' },
      { id: 'kid_activities', label: "Children's activities & sports" },
      { id: 'kid_529',        label: '529 college savings' },
    ]
  },
  {
    id: 'misc', label: 'ENTERTAINMENT & MISCELLANEOUS', guideline: '≤5–10% gross',
    maxPct: 0.10, softPct: 0.05, isSavings: false,
    items: [
      { id: 'misc_ent',     label: 'Entertainment & recreation' },
      { id: 'misc_travel',  label: 'Travel & vacation (monthly avg)' },
      { id: 'misc_gifts',   label: 'Gifts & charitable giving' },
      { id: 'misc_other',   label: 'Other miscellaneous' },
    ]
  },
  {
    id: 'savings', label: 'SAVINGS & INVESTING', guideline: '≥15–20% gross',
    maxPct: null, softPct: null, minPct: 0.15, goodPct: 0.20, isSavings: true,
    items: [
      { id: 'sav_efund',   label: 'Emergency fund contribution' },
      { id: 'sav_401k1',   label: '401(k) / 403(b) — Adult 1' },
      { id: 'sav_401k2',   label: '401(k) / 403(b) — Adult 2' },
      { id: 'sav_ira1',    label: 'Roth / Traditional IRA — Adult 1' },
      { id: 'sav_ira2',    label: 'Roth / Traditional IRA — Adult 2' },
      { id: 'sav_hsa',     label: 'HSA contributions' },
      { id: 'sav_taxable', label: 'Taxable brokerage / other investing' },
    ]
  },
];

function _bdgState() {
  try { return JSON.parse(localStorage.getItem('bdg_v1') || '{}'); } catch(_) { return {}; }
}

let _bdgSaveTimer = null;

function saveBudgetState() {
  const state = {
    name1: $('bdg-name1')?.value,
    name2: $('bdg-name2')?.value,
    gross1: $('bdg-gross1')?.value,
    gross2: $('bdg-gross2')?.value,
    other: $('bdg-other-income')?.value,
    cats: {},
  };
  for (const sec of BDG_SECTIONS) {
    for (const item of sec.items) {
      const el = $('bdg-' + item.id);
      if (el) state.cats[item.id] = el.value;
    }
  }
  localStorage.setItem('bdg_v1', JSON.stringify(state));
  clearTimeout(_bdgSaveTimer);
  _bdgSaveTimer = setTimeout(() => api('POST', '/budget', state).catch(() => {}), 1500);
}

function _renderBudgetTable() {
  const state = _bdgState();
  const cats = state.cats || {};
  let html = '';
  for (const sec of BDG_SECTIONS) {
    html += `<tr style="background:#d8d8d8;">
      <td style="font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;">${sec.label}</td>
      <td style="text-align:right;font-weight:bold;font-family:monospace;font-size:12px;" id="bdg-sub-${sec.id}">—</td>
      <td style="text-align:right;font-family:monospace;font-size:11px;color:#555;" id="bdg-ann-${sec.id}">—</td>
      <td style="text-align:right;font-weight:bold;font-size:12px;font-family:monospace;" id="bdg-pct-${sec.id}">—</td>
      <td style="font-size:10px;color:#333;" id="bdg-guide-${sec.id}">${sec.guideline}</td>
    </tr>`;
    for (const item of sec.items) {
      const val = cats[item.id] || '';
      html += `<tr>
        <td style="padding-left:22px;font-size:12px;">${item.label}</td>
        <td style="padding:2px 4px;text-align:right;">
          <input type="number" id="bdg-${item.id}" value="${val}" min="0" step="any" placeholder="0"
            style="width:115px;text-align:right;font-family:'Courier New',monospace;font-size:12px;">
        </td>
        <td style="text-align:right;font-size:11px;color:#777;font-family:monospace;" id="bdg-item-ann-${item.id}"></td>
        <td></td><td></td>
      </tr>`;
    }
  }
  $('bdg-tbody').innerHTML = html;
}

function calcBudget() {
  const gross1   = (parseFloat($('bdg-gross1')?.value) || 0) / 12;
  const gross2   = (parseFloat($('bdg-gross2')?.value) || 0) / 12;
  const other    = parseFloat($('bdg-other-income')?.value) || 0;
  const totalGross = gross1 + gross2 + other;

  if ($('bdg-mo1')) $('bdg-mo1').textContent = gross1 ? fmt(gross1) : '—';
  if ($('bdg-mo2')) $('bdg-mo2').textContent = gross2 ? fmt(gross2) : '—';
  if ($('bdg-combined-gross'))  $('bdg-combined-gross').textContent  = totalGross ? fmt(totalGross) : '—';
  if ($('bdg-combined-annual')) $('bdg-combined-annual').textContent = totalGross ? fmt(totalGross * 12) : '—';

  let totalExpenses = 0, totalSavings = 0, housingTotal = 0, debtTotal = 0;

  for (const sec of BDG_SECTIONS) {
    let secTotal = 0;
    for (const item of sec.items) {
      const val = parseFloat($('bdg-' + item.id)?.value) || 0;
      secTotal += val;
      const annEl = $('bdg-item-ann-' + item.id);
      if (annEl) annEl.textContent = val > 0 ? fmt(val * 12) : '';
    }

    const subEl   = $('bdg-sub-' + sec.id);
    const annEl   = $('bdg-ann-' + sec.id);
    const pctEl   = $('bdg-pct-' + sec.id);
    const guideEl = $('bdg-guide-' + sec.id);

    if (subEl) subEl.textContent = fmt(secTotal);
    if (annEl) annEl.textContent = secTotal > 0 ? fmt(secTotal * 12) + '/yr' : '';

    if (pctEl && totalGross > 0) {
      const pctNum = secTotal / totalGross;
      const pctStr = (pctNum * 100).toFixed(1) + '%';
      pctEl.textContent = pctStr;

      let cls = '';
      if (sec.isSavings) {
        cls = pctNum >= (sec.goodPct || 0.20) ? 'pos' : pctNum >= (sec.minPct || 0.15) ? '' : 'neg';
      } else if (sec.maxPct) {
        cls = pctNum > sec.maxPct ? 'neg' : pctNum > sec.softPct ? '' : 'pos';
      }
      pctEl.className = cls;
      if (guideEl) guideEl.style.color = cls === 'neg' ? 'var(--red)' : cls === 'pos' ? 'var(--green)' : '#333';
    } else if (pctEl) {
      pctEl.textContent = '—';
    }

    if (sec.isSavings) {
      totalSavings += secTotal;
    } else {
      totalExpenses += secTotal;
      if (sec.id === 'housing') housingTotal = secTotal;
      if (sec.id === 'debt')    debtTotal    = secTotal;
    }
  }

  const remaining  = totalGross - totalExpenses - totalSavings;
  const savingsRate = totalGross > 0 ? totalSavings / totalGross * 100 : 0;
  const housingPct  = totalGross > 0 ? housingTotal / totalGross * 100 : 0;
  const dti         = totalGross > 0 ? (housingTotal + debtTotal) / totalGross * 100 : 0;

  const si = $('bdg-s-income'), se = $('bdg-s-expenses'), ss = $('bdg-s-savings');
  const sr = $('bdg-s-remaining'), srate = $('bdg-s-srate'), shpct = $('bdg-s-hpct'), sdti = $('bdg-s-dti');

  if (si) si.textContent = fmt(totalGross);
  if (se) se.textContent = fmt(totalExpenses);
  if (ss) ss.textContent = fmt(totalSavings);
  if (sr) { sr.textContent = fmt(remaining); sr.className = 'value ' + (remaining >= 0 ? 'pos' : 'neg'); }
  if (srate) { srate.textContent = savingsRate.toFixed(1) + '%'; srate.className = 'value ' + (savingsRate >= 20 ? 'pos' : savingsRate >= 15 ? '' : 'neg'); }
  if (shpct) { shpct.textContent = housingPct.toFixed(1) + '%'; shpct.className = 'value ' + (housingPct <= 25 ? 'pos' : housingPct <= 28 ? '' : 'neg'); }
  if (sdti)  { sdti.textContent  = dti.toFixed(1) + '%';         sdti.className  = 'value ' + (dti <= 28 ? 'pos' : dti <= 36 ? '' : 'neg'); }

  _renderBdgPriority(totalGross);
}

function _renderBdgPriority(monthlyGross) {
  const el = $('bdg-priority');
  if (!el) return;

  const k401_1  = (parseFloat($('bdg-sav_401k1')?.value)  || 0) * 12;
  const k401_2  = (parseFloat($('bdg-sav_401k2')?.value)  || 0) * 12;
  const ira1    = (parseFloat($('bdg-sav_ira1')?.value)    || 0) * 12;
  const ira2    = (parseFloat($('bdg-sav_ira2')?.value)    || 0) * 12;
  const hsa     = (parseFloat($('bdg-sav_hsa')?.value)     || 0) * 12;
  const efund   = (parseFloat($('bdg-sav_efund')?.value)   || 0);
  const taxable = (parseFloat($('bdg-sav_taxable')?.value) || 0) * 12;

  // 2025 IRS limits
  const IRA_LIMIT  = 7000;
  const K401_LIMIT = 23500;
  const HSA_FAM    = 8550;

  const tiers = [
    {
      step: 1,
      label: 'Build Emergency Fund (3–6 months of essential expenses)',
      note: 'Keep in a high-yield savings account. Before investing, have 3 months minimum; 6 months is the Bogleheads target.',
      done: efund > 0,
      progress: efund > 0 ? `Contributing ${fmt(efund)}/mo` : 'Not yet contributing',
    },
    {
      step: 2,
      label: 'Capture full employer 401(k) match — free money, 100% instant return',
      note: 'Contribute at least enough to get 100% of employer match. This beats any other investment.',
      done: k401_1 > 0 || k401_2 > 0,
      progress: k401_1 + k401_2 > 0 ? `Contributing ${fmt((k401_1 + k401_2) / 12)}/mo combined` : 'No 401k contributions entered',
    },
    {
      step: 3,
      label: `Max HSA (if on HDHP) — $${HSA_FAM.toLocaleString()}/yr family (2025)`,
      note: 'Triple tax advantage: deductible, grows tax-free, tax-free qualified withdrawals. Best account type available.',
      done: hsa >= HSA_FAM,
      progress: hsa > 0 ? `${fmt(hsa)}/yr of ${fmt(HSA_FAM)} limit (${fmt(HSA_FAM / 12)}/mo to max)` : 'Not contributing',
    },
    {
      step: 4,
      label: `Max Roth/Traditional IRA — $${IRA_LIMIT.toLocaleString()}/person ($${(IRA_LIMIT * 2).toLocaleString()} combined, 2025)`,
      note: `Tax-advantaged growth outside your employer. Prefer Roth if in lower bracket now. Adult 1: ${fmt(ira1)}/yr · Adult 2: ${fmt(ira2)}/yr`,
      done: ira1 >= IRA_LIMIT && ira2 >= IRA_LIMIT,
      progress: `${fmt(ira1 + ira2)}/yr of ${fmt(IRA_LIMIT * 2)} combined limit`,
    },
    {
      step: 5,
      label: `Max 401(k) — $${K401_LIMIT.toLocaleString()}/person ($${(K401_LIMIT * 2).toLocaleString()} combined, 2025)`,
      note: `After capturing match and maxing IRA, maximize 401k. Adult 1: ${fmt(k401_1)}/yr · Adult 2: ${fmt(k401_2)}/yr · Monthly to max each: ${fmt(K401_LIMIT / 12)}`,
      done: k401_1 >= K401_LIMIT && k401_2 >= K401_LIMIT,
      progress: `${fmt(k401_1 + k401_2)}/yr of ${fmt(K401_LIMIT * 2)} combined limit`,
    },
    {
      step: 6,
      label: 'Invest in taxable brokerage — low-cost index funds (e.g. VTI, VXUS)',
      note: 'Once all tax-advantaged accounts are maxed, invest remaining savings in a taxable account. Use tax-efficient funds.',
      done: taxable > 0 && ira1 >= IRA_LIMIT && k401_1 >= K401_LIMIT,
      progress: taxable > 0 ? `Contributing ${fmt(taxable / 12)}/mo` : 'Not yet contributing',
    },
  ];

  el.innerHTML = tiers.map(t => {
    const icon = t.done ? '&#9989;' : '&#9633;';
    const cls  = t.done ? 'good' : 'tip';
    return `<div class="advice-item ${cls}">
      <span style="margin-right:8px;font-size:14px;">${icon}</span>
      <span>
        <strong>Step ${t.step}: ${t.label}</strong><br>
        <span style="font-size:10px;color:#555;">${t.note}</span><br>
        <span style="font-size:10px;font-family:'Courier New',monospace;color:#333;">${t.progress}</span>
      </span>
    </div>`;
  }).join('');
}

async function loadBudgetFromLoans() {
  let loans;
  try { loans = await api('GET', '/loans'); }
  catch(e) { alert('Could not load loans: ' + e.message); return; }

  const activeLoan = loans.filter(l => l.balance > 0);
  if (!activeLoan.length) {
    alert('No active loans found. Add loans on the Loans page first.');
    return;
  }

  // Classify loans into budget categories
  const MORTGAGE_KEYWORDS = ['mortgage', 'home loan', 'heloc', 'property'];
  const STUDENT_KEYWORDS  = ['student', 'educational', 'navient', 'nelnet', 'fedloan', 'sofi'];
  const CC_KEYWORDS       = ['credit card', 'visa', 'mastercard', 'amex', 'discover', 'citi', 'cardmember'];

  let added = 0;
  for (const l of activeLoan) {
    const name = (l.name || '').toLowerCase();
    const pmt  = l.monthly_payment || 0;
    if (!pmt) continue;

    let catId = null;
    if (MORTGAGE_KEYWORDS.some(k => name.includes(k))) {
      catId = 'housing_rent';
    } else if (STUDENT_KEYWORDS.some(k => name.includes(k))) {
      catId = 'debt_student';
    } else if (CC_KEYWORDS.some(k => name.includes(k))) {
      catId = 'debt_cc';
    } else {
      catId = 'debt_other';
    }

    const el = $('bdg-' + catId);
    if (el) {
      el.value = ((parseFloat(el.value) || 0) + pmt).toFixed(2);
      added++;
    }
  }

  saveBudgetState();
  calcBudget();
  if (added > 0) {
    alert(`Loaded ${added} loan payment${added !== 1 ? 's' : ''} into budget. Mortgage/home loans → Housing, student loans → Debt, credit cards → Debt, others → Debt (other). Review and adjust as needed.`);
  } else {
    alert('Loans found but no monthly payment amounts set. Edit each loan on the Loans page to add a monthly payment.');
  }
}

async function loadBudgetFromRecurring() {
  let rows;
  try { rows = await api('GET', '/recurring'); }
  catch(e) { alert('Could not load recurring data: ' + e.message); return; }

  const expenses = rows.filter(r => r.kind === 'expense');
  const income   = rows.filter(r => r.kind === 'income');

  // Pre-fill income — combined gross from primary income sources
  const primaryAnnual = income
    .filter(i => !i.category?.toLowerCase().includes('other') && i.monthly_amount > 500)
    .reduce((s, i) => s + i.monthly_amount * 12, 0);

  if (primaryAnnual > 0 && !$('bdg-gross1').value) {
    $('bdg-gross1').value = primaryAnnual.toFixed(0);
  }

  // Map recurring expenses to budget categories by keyword matching
  const keyMap = [
    ['housing_rent',  ['rent', 'mortgage', 'housing']],
    ['tr_car',        ['car payment', 'auto loan', 'vehicle loan']],
    ['tr_ins',        ['auto insurance', 'car insurance', 'state farm']],
    ['tr_gas',        ['gas station', 'fuel', 'shell', 'chevron', 'arco']],
    ['food_groc',     ['grocery', 'groceries', 'trader joe', "trader joe's", 'safeway', 'whole foods', 'costco', 'kroger']],
    ['food_dining',   ['restaurant', 'dining', 'doordash', 'ubereats', 'grubhub', 'ovations', 'nth st']],
    ['hc_prem',       ['health insurance', 'medical premium', 'blue cross', 'aetna', 'cigna', 'kaiser']],
    ['util_internet', ['internet', 'comcast', 'xfinity', 'viasat', 'spectrum']],
    ['util_phone',    ['phone', 'verizon', 't-mobile', 'tmobile', 'at&t', 'att mobile']],
    ['per_subs',      ['subscription', 'netflix', 'spotify', 'hulu', 'youtube', 'streaming', 'claude', 'openai', 'chatgpt', 'apple', 'motiv', 'avast']],
    ['util_elec',     ['electric', 'electricity', 'pge', 'pg&e', 'sdge', 'con ed']],
    ['debt_student',  ['student loan', 'educational', 'navient', 'nelnet', 'fedloan']],
    ['debt_cc',       ['credit card', 'citi autopay', 'cardmember', 'amex autopay', 'discover autopay']],
    ['debt_other',    ['loan pmt', 'sofi ach', 'provident', 'personal loan']],
    ['misc_ent',      ['entertainment', 'amazon', 'steam', 'playstation', 'xbox']],
    ['tr_park',       ['clipper', 'bart', 'transit', 'metro', 'commute', 'lime']],
    ['per_pets',      ['pet', 'vet', 'petco', 'petsmart']],
  ];

  for (const exp of expenses) {
    const name = (exp.name || '').toLowerCase();
    for (const [catId, keywords] of keyMap) {
      if (keywords.some(kw => name.includes(kw))) {
        const el = $('bdg-' + catId);
        if (el) {
          const existing = parseFloat(el.value) || 0;
          el.value = (existing + exp.monthly_amount).toFixed(2);
        }
        break;
      }
    }
  }

  saveBudgetState();
  calcBudget();
  alert('Loaded recurring data. Review and adjust amounts as needed — some items may need manual re-categorization.');
}

function resetBudget() {
  if (!confirm('Clear all budget values and start over?')) return;
  localStorage.removeItem('bdg_v1');
  loadBudget();
}

async function loadBudget() {
  let state = _bdgState();
  // If local storage is empty, try loading from backend
  if (!state.gross1 && !state.gross2) {
    try {
      const remote = await api('GET', '/budget');
      if (remote && (remote.gross1 || remote.gross2)) {
        state = remote;
        localStorage.setItem('bdg_v1', JSON.stringify(state));
      }
    } catch(_) {}
  }
  if (state.name1) $('bdg-name1').value = state.name1;
  if (state.name2) $('bdg-name2').value = state.name2;
  if (state.gross1) $('bdg-gross1').value = state.gross1;
  if (state.gross2) $('bdg-gross2').value = state.gross2;
  if (state.other)  $('bdg-other-income').value = state.other;
  _renderBudgetTable();
  // Restore saved category values into freshly-rendered inputs
  const cats = state.cats || {};
  for (const sec of BDG_SECTIONS) {
    for (const item of sec.items) {
      const el = $('bdg-' + item.id);
      if (el && cats[item.id]) el.value = cats[item.id];
    }
  }
  // Wire up all input events via delegation (once per page lifetime)
  const page = $('page-budget');
  if (page && !page._bdgWired) {
    page.addEventListener('input', () => { saveBudgetState(); calcBudget(); });
    page._bdgWired = true;
  }
  calcBudget();
}

// Page loaders
const loaders = {
  dashboard: loadDashboard,
  accounts: loadAccounts,
  recurring: loadRecurring,
  loans: loadLoans,
  goals: () => { loadGoals(); loadDebtCalc(); },
  budget: loadBudget,
  rsus: loadRsus,
  import: loadImport,
  ingest: loadIngest,
  transactions: loadTransactions,
};
