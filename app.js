const STORAGE_KEY = "remainingLoanAmortizePlan.v1";

const PRESETS = {
  home: { balance: 285000, payment: 1950, termMonths: 240, rate: 5.43, extra: 150, extraStart: 1, priorPayments: 60 },
  auto: { balance: 16500, payment: 440, termMonths: 42, rate: 4.88, extra: 50, extraStart: 1, priorPayments: 18 },
  personal: { balance: 8000, payment: 260, termMonths: 36, rate: 10.74, extra: 40, extraStart: 1, priorPayments: 12 }
};

const DEFAULTS = {
  loanType: "home",
  calcMode: "solveRate", // 'solveRate' | 'solvePayment' | 'solveMonths'
  balance: 285000,
  payment: 1950,
  termMonths: 240,
  rate: 5.43,
  extra: 150,
  extraStart: 1,
  startDate: "2026-10",
  priorPayments: 60,
  autoSave: true,
  yearFilter: "all",
  investReturn: 7,
  taxRate: 15
};

const state = loadState();
let currentPlan = [], standardPlan = [];
let effectiveRate = 0;
let effectivePayment = 0;
let effectiveMonths = 0;

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const loanControls = document.querySelector("#loanControls");
const extraControls = document.querySelector("#extraControls");
const investControls = document.querySelector("#investControls");
const investBlock = document.querySelector("#investBlock");
const tradeoffSection = document.querySelector("#tradeoffSection");
const scheduleRows = document.querySelector("#scheduleRows");
const yearFilter = document.querySelector("#yearFilter");
const canvas = document.querySelector("#balanceChart");
const ctx = canvas.getContext("2d");
const warningBanner = document.querySelector("#warningBanner");
const warningTitle = document.querySelector("#warningTitle");
const warningText = document.querySelector("#warningText");
const fixPaymentBtn = document.querySelector("#fixPaymentBtn");

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(v) {
  return currency.format(v);
}

function fmtDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
}

function monthsLabel(months) {
  const yrs = Math.floor(months / 12);
  const rest = months % 12;
  return `${yrs ? `${yrs} yr${yrs === 1 ? "" : "s"}` : ""}${yrs && rest ? " " : ""}${rest ? `${rest} mo` : ""}` || "0 mo";
}

function scale(v, type) {
  if (type === "currency") return money(v);
  if (type === "percent") return `${v}%`;
  if (type === "months") return `${v} mo`;
  return String(v);
}

function dateForPayment(paymentIndex) {
  const [year, month] = state.startDate.split("-").map(Number);
  return new Date(year, month - 1 + (paymentIndex - 1), 1);
}

// Math Solvers
function solveMonthlyRate(balance, payment, months) {
  if (months <= 0 || balance <= 0 || payment <= 0) return 0;
  if (payment * months <= balance) return 0;

  let low = 0;
  let high = 1.0;
  while ((payment / high) * (1 - Math.pow(1 + high, -months)) > balance && high < 20) {
    high *= 2;
  }

  for (let i = 0; i < 45; i++) {
    const mid = (low + high) / 2;
    const pv = (payment / mid) * (1 - Math.pow(1 + mid, -months));
    if (pv > balance) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return ((low + high) / 2) * 12 * 100;
}

function calculatePayment(balance, annualRate, months) {
  if (months <= 0 || balance <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return balance / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (balance * monthlyRate * factor) / (factor - 1);
}

function calculateMonths(balance, annualRate, payment) {
  if (balance <= 0 || payment <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return Math.ceil(balance / payment);
  const monthlyInterest = balance * monthlyRate;
  if (payment <= monthlyInterest) return 1200; // Payment does not cover interest
  const n = -Math.log(1 - monthlyInterest / payment) / Math.log(1 + monthlyRate);
  return Math.max(1, Math.min(1200, Math.round(n)));
}

function amortize(includeExtra) {
  const isSolveRate = state.calcMode === "solveRate";
  const isSolvePayment = state.calcMode === "solvePayment";
  const isSolveMonths = state.calcMode === "solveMonths";

  let rate = state.rate;
  let regular = state.payment;
  let months = state.termMonths;
  let isInsufficient = false;

  if (isSolveRate) {
    if (state.payment * state.termMonths < state.balance) {
      isInsufficient = true;
      rate = 0;
    } else {
      rate = solveMonthlyRate(state.balance, state.payment, state.termMonths);
    }
    regular = state.payment;
    months = state.termMonths;
  } else if (isSolvePayment) {
    regular = calculatePayment(state.balance, state.rate, state.termMonths);
    months = state.termMonths;
    rate = state.rate;
  } else if (isSolveMonths) {
    months = calculateMonths(state.balance, state.rate, state.payment);
    regular = state.payment;
    rate = state.rate;
    if (months >= 1200) {
      isInsufficient = true;
    }
  }

  effectiveRate = rate;
  effectivePayment = regular;
  effectiveMonths = months;

  const monthlyRate = rate / 100 / 12;
  let balance = state.balance;
  let payment = 0;
  const rows = [];

  while (balance > 0.005 && payment < 1200) {
    payment += 1;
    const interest = monthlyRate === 0 ? 0 : balance * monthlyRate;
    const plannedExtra = includeExtra && payment >= state.extraStart ? state.extra : 0;
    const principal = Math.min(balance, Math.max(0, regular - interest));
    const extra = Math.min(balance - principal, plannedExtra);
    balance = Math.max(0, balance - principal - extra);
    rows.push({
      payment,
      loanPaymentNum: (state.priorPayments || 0) + payment,
      date: dateForPayment(payment),
      principal,
      interest,
      extra,
      balance
    });
  }

  return { rows, regular, rate, months, isInsufficient };
}

function getFieldDefinitions() {
  const isSolveRate = state.calcMode === "solveRate";
  const isSolvePayment = state.calcMode === "solvePayment";
  const isSolveMonths = state.calcMode === "solveMonths";

  const loanDefs = [
    {
      key: "balance",
      label: "Current loan balance",
      type: "currency",
      min: 1000,
      max: 1500000,
      step: 500,
      readOnly: false,
      value: state.balance
    },
    {
      key: "payment",
      label: "Monthly payment (P&I)",
      badge: isSolvePayment ? "Calculated" : null,
      type: "currency",
      min: 25,
      max: 15000,
      step: 10,
      readOnly: isSolvePayment,
      value: isSolvePayment ? Math.round(effectivePayment) : state.payment
    },
    {
      key: "termMonths",
      label: "Months remaining",
      badge: isSolveMonths ? "Calculated" : null,
      type: "months",
      min: 1,
      max: 480,
      step: 1,
      readOnly: isSolveMonths,
      value: isSolveMonths ? effectiveMonths : state.termMonths,
      subnote: monthsLabel(isSolveMonths ? effectiveMonths : state.termMonths)
    },
    {
      key: "rate",
      label: "Interest rate (APR)",
      badge: isSolveRate ? "Calculated" : null,
      type: "percent",
      min: 0,
      max: 25,
      step: 0.05,
      readOnly: isSolveRate,
      value: isSolveRate ? Number(effectiveRate.toFixed(2)) : state.rate
    }
  ];

  const extraDefs = [
    {
      key: "extra",
      label: "Extra monthly payment",
      type: "currency",
      min: 0,
      max: 5000,
      step: 25,
      readOnly: false,
      value: state.extra
    },
    {
      key: "extraStart",
      label: "Start extra in remaining month",
      type: "number",
      min: 1,
      max: 480,
      step: 1,
      readOnly: false,
      value: state.extraStart
    }
  ];

  const investDefs = [
    {
      key: "investReturn",
      label: "Expected annual return",
      type: "percent",
      min: 0,
      max: 15,
      step: 0.25,
      readOnly: false,
      value: state.investReturn
    },
    {
      key: "taxRate",
      label: "Capital gains tax rate",
      type: "percent",
      min: 0,
      max: 40,
      step: 1,
      readOnly: false,
      value: state.taxRate
    }
  ];

  return { loanDefs, extraDefs, investDefs };
}

function renderControlList(target, defs) {
  target.innerHTML = defs.map(def => {
    const badgeHtml = def.badge ? `<span class="control-badge badge-computed">${def.badge}</span>` : "";
    const readOnlyAttr = def.readOnly ? "readonly" : "";
    const disabledAttr = def.readOnly ? "disabled" : "";
    const subnoteHtml = def.key === "termMonths"
      ? `<small id="termMonthsSubnote" style="color:var(--teal);font-size:0.75rem;font-weight:700;">${def.subnote}</small>`
      : "";

    return `
      <div class="control">
        <div class="control-head">
          <label for="${def.key}">
            ${def.label}
            ${badgeHtml}
          </label>
          <div class="control-input-wrap">
            ${subnoteHtml}
            <input id="${def.key}" type="number" data-key="${def.key}" min="${def.min}" max="${def.max}" step="${def.step}" value="${def.value}" ${readOnlyAttr}>
          </div>
        </div>
        <input type="range" data-key="${def.key}" aria-label="${def.label}" min="${def.min}" max="${def.max}" step="${def.step}" value="${def.value}" ${disabledAttr}>
        <div class="range-labels">
          <span>${scale(def.min, def.type)}</span>
          <span>${scale(def.max, def.type)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderControls() {
  const { loanDefs, extraDefs, investDefs } = getFieldDefinitions();
  renderControlList(loanControls, loanDefs);
  renderControlList(extraControls, extraDefs);
  renderControlList(investControls, investDefs);
}

function investSnapshot(months) {
  const monthlyGrowth = Math.pow(1 + state.investReturn / 100, 1 / 12) - 1;
  const taxRate = state.taxRate / 100;
  let portfolio = 0;
  let basis = 0;

  for (let m = 1; m <= months; m += 1) {
    if (m >= state.extraStart) {
      portfolio += state.extra;
      basis += state.extra;
    }
    portfolio *= 1 + monthlyGrowth;
  }
  const taxes = taxRate * Math.max(0, portfolio - basis);
  return { portfolio, taxes, net: portfolio - taxes };
}

function investmentTradeoff() {
  for (let m = 1; m <= standardPlan.length; m += 1) {
    const account = investSnapshot(m);
    const balance = standardPlan[m - 1].balance;
    if (account.net >= balance) {
      return { month: m, date: dateForPayment(m), balance, leftover: account.net - balance, ...account };
    }
  }
  const account = investSnapshot(standardPlan.length);
  return { month: standardPlan.length, date: dateForPayment(standardPlan.length), balance: 0, leftover: account.net, ...account };
}

function renderTradeoff() {
  investBlock.hidden = tradeoffSection.hidden = !(state.extra > 0);
  if (!state.extra || standardPlan.length === 0 || currentPlan.length === 0) return;

  const paydownMonths = currentPlan.length;
  const paydownInterest = currentPlan.reduce((sum, row) => sum + row.interest, 0);
  const standardMonths = standardPlan.length;
  const invest = investmentTradeoff();
  const paydownSooner = standardMonths - paydownMonths;
  const investSooner = standardMonths - invest.month;
  const difference = paydownMonths - invest.month;

  document.querySelector("#paydownPayoff").textContent = `${monthsLabel(paydownMonths)} to payoff`;
  document.querySelector("#paydownSooner").textContent = paydownSooner ? `${monthsLabel(paydownSooner)} sooner than standard` : "Standard schedule";
  document.querySelector("#paydownInterest").textContent = money(paydownInterest);
  document.querySelector("#paydownDate").textContent = fmtDate(currentPlan.at(-1).date);

  document.querySelector("#investPayoff").textContent = `${monthsLabel(invest.month)} to payoff`;
  document.querySelector("#investSooner").textContent = investSooner ? `${monthsLabel(investSooner)} sooner than standard` : "Standard schedule";
  document.querySelector("#investPortfolio").textContent = money(invest.net);
  document.querySelector("#investTax").textContent = `−${money(invest.taxes)}`;
  document.querySelector("#investLeftover").textContent = money(invest.leftover);

  document.querySelector("#tradeoffNote").textContent = `${money(state.extra)}/mo invested at ${state.investReturn}% annual growth, ${state.taxRate}% tax on gains`;

  const balanceAtPaydown = standardPlan[paydownMonths - 1] ? standardPlan[paydownMonths - 1].balance : 0;
  const position = investSnapshot(paydownMonths).net - balanceAtPaydown;

  const speed = difference > 0
    ? `Investing clears the remaining loan ${monthsLabel(difference)} sooner than extra principal, leaving ${money(invest.leftover)} surplus after debt is retired.`
    : difference < 0
      ? `Extra principal clears the remaining loan ${monthsLabel(-difference)} sooner than investing, avoiding ${money(invest.taxes)} in capital gains tax.`
      : `Both paths retire the remaining loan in the same month; investing leaves ${money(invest.leftover)} after tax.`;

  const standing = position >= 0
    ? `At month ${paydownMonths} — when extra-principal retires the loan — the portfolio nets ${money(investSnapshot(paydownMonths).net)} after tax while ${money(balanceAtPaydown)} of the loan would remain, so investing is ahead by ${money(position)}.`
    : `At month ${paydownMonths} — when extra-principal retires the loan — the portfolio nets ${money(investSnapshot(paydownMonths).net)} after tax against ${money(balanceAtPaydown)} remaining balance, so extra principal is ahead by ${money(-position)}.`;

  document.querySelector("#tradeoffVerdict").textContent = `${speed} ${standing}`;
}

function checkValidation(isInsufficient) {
  if (state.calcMode === "solveRate") {
    const minZeroInterestPayment = state.balance / state.termMonths;
    if (state.payment < minZeroInterestPayment) {
      warningBanner.hidden = false;
      warningTitle.textContent = "Payment too low to amortize balance";
      warningText.textContent = `At ${money(state.payment)}/mo for ${state.termMonths} months (${money(state.payment * state.termMonths)} total), you cannot pay off the ${money(state.balance)} balance. Minimum 0%-interest payment is ${money(minZeroInterestPayment)}/mo.`;
      fixPaymentBtn.textContent = `Set to ${money(Math.ceil(minZeroInterestPayment))}`;
      fixPaymentBtn.onclick = () => {
        state.payment = Math.ceil(minZeroInterestPayment);
        syncInputValues();
        render();
      };
      return true;
    }
  } else if (state.calcMode === "solveMonths" && isInsufficient) {
    const minInterestOnly = (state.balance * (state.rate / 100 / 12));
    warningBanner.hidden = false;
    warningTitle.textContent = "Payment covers interest only or less";
    warningText.textContent = `At ${state.rate}% APR, monthly interest alone is ${money(minInterestOnly)}. A payment of ${money(state.payment)} will never retire the balance.`;
    fixPaymentBtn.textContent = `Set to ${money(Math.ceil(minInterestOnly + 100))}`;
    fixPaymentBtn.onclick = () => {
      state.payment = Math.ceil(minInterestOnly + 100);
      syncInputValues();
      render();
    };
    return true;
  }

  warningBanner.hidden = true;
  return false;
}

function render() {
  const withStrategy = amortize(true);
  const standard = amortize(false);
  currentPlan = withStrategy.rows;
  standardPlan = standard.rows;

  const hasIssue = checkValidation(withStrategy.isInsufficient);

  if (currentPlan.length === 0) {
    document.querySelector("#monthlyPayment").textContent = money(effectivePayment + state.extra);
    document.querySelector("#interestRateVal").textContent = `${effectiveRate.toFixed(2)}%`;
    document.querySelector("#payoffDate").textContent = "—";
    document.querySelector("#payoffDuration").textContent = "Insufficient payment";
    document.querySelector("#totalInterest").textContent = "$0";
    scheduleRows.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">Adjust payment or terms to view schedule.</td></tr>`;
    drawChart();
    renderTradeoff();
    return;
  }

  const totalInterest = currentPlan.reduce((sum, row) => sum + row.interest, 0);
  const standardInterest = standardPlan.reduce((sum, row) => sum + row.interest, 0);
  const totalPrincipal = currentPlan.reduce((sum, row) => sum + row.principal + row.extra, 0);

  document.querySelector("#monthlyPayment").textContent = money(effectivePayment + state.extra);
  document.querySelector("#paymentSubnote").textContent = state.extra ? `${money(effectivePayment)} P&I + ${money(state.extra)} extra` : "Principal & interest";

  document.querySelector("#interestRateVal").textContent = `${effectiveRate.toFixed(2)}%`;
  document.querySelector("#rateStatusNote").textContent = state.calcMode === "solveRate" ? "Calculated from terms" : "Fixed loan APR";

  document.querySelector("#payoffDate").textContent = fmtDate(currentPlan.at(-1).date);
  document.querySelector("#payoffDuration").textContent = `${monthsLabel(currentPlan.length)} remaining (${currentPlan.length} payments)`;

  document.querySelector("#totalInterest").textContent = money(totalInterest);
  document.querySelector("#interestNote").textContent = state.extra ? `vs. ${money(standardInterest)} standard` : "Over remaining term";

  const monthsSaved = standardPlan.length - currentPlan.length;
  const interestSaved = Math.max(0, standardInterest - totalInterest);

  if (state.extra > 0) {
    document.querySelector("#insightText").textContent = `Your extra ${money(state.extra)}/mo starting in month ${state.extraStart} clears your loan ${monthsLabel(monthsSaved)} sooner and saves ${money(interestSaved)} in interest!`;
  } else {
    document.querySelector("#insightText").textContent = `You have ${monthsLabel(currentPlan.length)} (${currentPlan.length} payments) left. Total payments will be ${money(totalPrincipal + totalInterest)}, including ${money(totalInterest)} remaining interest.`;
  }

  renderYearFilter();
  renderTable();
  drawChart();
  renderTradeoff();

  if (state.autoSave) saveState();
}

function renderYearFilter() {
  const prior = state.yearFilter;
  const years = [...new Set(currentPlan.map(row => row.date.getFullYear()))];
  yearFilter.innerHTML = `<option value="all">All payments (${currentPlan.length})</option>${years.map(yr => `<option value="${yr}">${yr}</option>`).join("")}`;
  state.yearFilter = years.includes(Number(prior)) ? prior : "all";
  yearFilter.value = state.yearFilter;
}

function renderTable() {
  const rows = state.yearFilter === "all"
    ? currentPlan
    : currentPlan.filter(row => row.date.getFullYear() === Number(state.yearFilter));

  const hasPrior = Boolean(state.priorPayments && state.priorPayments > 0);

  scheduleRows.innerHTML = rows.map(row => {
    const paymentLabel = hasPrior
      ? `<strong>#${row.payment}</strong> <span style="color:var(--muted);font-size:0.75rem;">(Loan #${row.loanPaymentNum})</span>`
      : `<strong>#${row.payment}</strong>`;

    return `
      <tr>
        <td>${paymentLabel}</td>
        <td>${fmtDate(row.date)}</td>
        <td>${cents.format(row.principal)}</td>
        <td>${cents.format(row.interest)}</td>
        <td>${row.extra ? cents.format(row.extra) : "—"}</td>
        <td>${cents.format(row.balance)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6" style="text-align:center;padding:20px;">No payments in this year.</td></tr>`;
}

function drawChart() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(640, Math.floor(rect.width * dpr)) / dpr;
  const height = Math.max(320, Math.floor(rect.height * dpr)) / dpr;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#0c1110";
  ctx.fillRect(0, 0, width, height);

  const pad = { top: 25, right: 25, bottom: 38, left: 75 };
  const pw = width - pad.left - pad.right;
  const ph = height - pad.top - pad.bottom;
  const max = Math.max(state.balance, 1);
  const length = Math.max(standardPlan.length, currentPlan.length, 1);

  // Y-axis grid
  ctx.strokeStyle = "rgba(231,215,168,.14)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#b8b2a2";
  ctx.font = "700 12px Inter, system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ph * i) / 4;
    const value = max * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(shortMoney(value), pad.left - 12, y);
  }

  if (standardPlan.length === 0 && currentPlan.length === 0) return;

  const points = rows => [
    { x: pad.left, y: pad.top },
    ...rows.map((r, i) => ({
      x: pad.left + (pw * (i + 1)) / length,
      y: pad.top + ph * (1 - r.balance / max)
    }))
  ];

  const line = (rows, color, dash, fill) => {
    if (rows.length === 0) return;
    const pts = points(rows);

    if (fill) {
      const grad = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
      grad.addColorStop(0, "rgba(216,180,95,.32)");
      grad.addColorStop(1, "rgba(216,180,95,.015)");
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.lineTo(pts.at(-1).x, height - pad.bottom);
      ctx.lineTo(pad.left, height - pad.bottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.setLineDash([]);
  };

  line(standardPlan, "rgba(45,212,191,.72)", [7, 6], false);
  line(currentPlan, "#d8b45f", [], true);

  // X-axis labels
  ctx.fillStyle = "#b8b2a2";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= 5; i++) {
    const index = Math.min(length, Math.round((length * i) / 5));
    ctx.fillText(`M${index}`, pad.left + (pw * index) / length, height - pad.bottom + 13);
  }
}

function shortMoney(value) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return money(value);
}

function syncInputValues() {
  const { loanDefs, extraDefs, investDefs } = getFieldDefinitions();
  const allDefs = [...loanDefs, ...extraDefs, ...investDefs];
  allDefs.forEach(def => {
    document.querySelectorAll(`[data-key="${def.key}"]`).forEach(el => {
      if (def.readOnly || document.activeElement !== el) {
        el.value = def.value;
      }
    });
  });

  const termMonthsNote = document.querySelector("#termMonthsSubnote");
  if (termMonthsNote) {
    const isSolveMonths = state.calcMode === "solveMonths";
    termMonthsNote.textContent = monthsLabel(isSolveMonths ? effectiveMonths : state.termMonths);
  }
}

function sync(key, val) {
  state[key] = Math.max(0, Number(val) || 0);

  // Re-run amortization math to update computed values
  amortize(true);
  syncInputValues();
  render();
}

// Event Listeners
document.addEventListener("input", event => {
  const key = event.target.dataset.key;
  if (key) {
    sync(key, event.target.value);
  }
});

document.querySelectorAll(".loan-type").forEach(button => {
  button.addEventListener("click", () => {
    const type = button.dataset.loanType;
    Object.assign(state, PRESETS[type], { loanType: type, yearFilter: "all" });
    document.querySelectorAll(".loan-type").forEach(tab => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active);
    });
    amortize(true);
    renderControls();
    render();
  });
});

document.querySelectorAll(".mode-btn").forEach(button => {
  button.addEventListener("click", () => {
    state.calcMode = button.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.classList.toggle("active", btn === button);
    });
    amortize(true);
    renderControls();
    render();
  });
});

yearFilter.addEventListener("change", event => {
  state.yearFilter = event.target.value;
  renderTable();
  if (state.autoSave) saveState();
});

document.querySelector("#autoSave").addEventListener("change", event => {
  state.autoSave = event.target.checked;
  if (state.autoSave) saveState();
});

document.querySelector("#priorPayments").addEventListener("input", event => {
  state.priorPayments = Math.max(0, parseInt(event.target.value, 10) || 0);
  renderTable();
  if (state.autoSave) saveState();
});

document.querySelector("#saveButton").addEventListener("click", saveState);

document.querySelector("#resetButton").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  Object.assign(state, DEFAULTS);
  document.querySelector("#autoSave").checked = state.autoSave;
  document.querySelector("#startDate").value = state.startDate;
  document.querySelector("#priorPayments").value = state.priorPayments;
  document.querySelectorAll(".loan-type").forEach(tab => {
    const active = tab.dataset.loanType === state.loanType;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active);
  });
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.calcMode);
  });
  amortize(true);
  renderControls();
  render();
});

document.querySelector("#downloadButton").addEventListener("click", () => {
  const hasPrior = Boolean(state.priorPayments && state.priorPayments > 0);
  const header = hasPrior
    ? "Remaining Payment #,Total Loan Payment #,Date,Principal,Interest,Extra Payment,Remaining Balance"
    : "Payment #,Date,Principal,Interest,Extra Payment,Remaining Balance";

  const data = currentPlan.map(r => {
    const parts = hasPrior
      ? [r.payment, r.loanPaymentNum, fmtDate(r.date), r.principal.toFixed(2), r.interest.toFixed(2), r.extra.toFixed(2), r.balance.toFixed(2)]
      : [r.payment, fmtDate(r.date), r.principal.toFixed(2), r.interest.toFixed(2), r.extra.toFixed(2), r.balance.toFixed(2)];
    return parts.join(",");
  });

  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([[header, ...data].join("\n")], { type: "text/csv" }));
  link.href = url;
  link.download = "remaining-loan-amortization-schedule.csv";
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#startDate").addEventListener("change", event => {
  state.startDate = event.target.value || DEFAULTS.startDate;
  render();
});

window.addEventListener("resize", drawChart);

// Initialize
document.querySelector("#autoSave").checked = state.autoSave;
document.querySelector("#startDate").value = state.startDate;
document.querySelector("#priorPayments").value = state.priorPayments || 0;
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.classList.toggle("active", btn.dataset.mode === state.calcMode);
});

amortize(true);
renderControls();
render();
