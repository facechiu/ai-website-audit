const form = document.querySelector("#audit-form");
const loading = document.querySelector("#loading");
const results = document.querySelector("#results");
const scanLine = document.querySelector("#scan-line");
const categoryGrid = document.querySelector("#category-grid");
const insightGrid = document.querySelector("#insight-grid");
const issues = document.querySelector("#issues");
const summary = document.querySelector("#summary");
const copySummary = document.querySelector("#copy-summary");
const downloadReport = document.querySelector("#download-report");

const scanLines = [
  "讀取首頁與公開檔案...",
  "檢查 robots.txt、sitemap.xml、llms.txt...",
  "整理品牌事實與服務線索...",
  "模擬買家會問 AI 的問題...",
  "比對競爭對手風險...",
  "產生可銷售的修復建議..."
];

let latestSummary = "";
let latestAudit = null;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scoreTone(score) {
  if (score >= 85) return "AI 已經能抓到多數關鍵線索，適合拿來放大曝光。";
  if (score >= 70) return "基礎不差，但還需要補強品牌事實、FAQ 或信任證據。";
  if (score >= 50) return "AI 可能看得懂一部分，但推薦理由還不夠完整。";
  return "目前 AI 很可能難以理解你是誰、服務誰，以及為什麼值得推薦。";
}

function reportFileName(data) {
  const host = new URL(data.input).hostname.replace(/^www\./, "").replace(/[^a-z0-9-]+/gi, "-");
  return `ai-brand-audit-${host}.html`;
}

function renderInsightCards(data) {
  const insights = data.insights || {};
  const cards = [
    {
      title: "AI 推薦可能性",
      value: insights.recommendationReadiness || "待補強",
      text: insights.recommendationReason || "需要更多品牌事實與可引用內容。"
    },
    {
      title: "買家會問的問題",
      value: `${(insights.buyerQuestions || []).length} 題`,
      text: (insights.buyerQuestions || []).slice(0, 2).join(" / ") || "補上品牌與產業後會更精準。"
    },
    {
      title: "競品風險",
      value: insights.competitorRisk || "中",
      text: insights.competitorReason || "若競爭對手有更完整內容，AI 可能優先引用他們。"
    }
  ];

  insightGrid.innerHTML = cards.map((card) => `
    <article class="insight-card">
      <p>${escapeHtml(card.title)}</p>
      <strong>${escapeHtml(card.value)}</strong>
      <span>${escapeHtml(card.text)}</span>
    </article>
  `).join("");
}

function buildSummary(data) {
  const issueText = data.topIssues.map((issue) => `「${issue.label}」`).slice(0, 3).join("、");
  const questions = (data.insights?.buyerQuestions || []).slice(0, 2).join("；");
  return `這個網站的 AI 品牌能見度健檢總分為 ${data.overall} 分。${scoreTone(data.overall)} ` +
    `若買家問 AI：「${questions || "這個產業有哪些品牌值得推薦？"}」，目前最需要優先補強的是 ${issueText || "持續監測 AI 提及率與引用來源"}。` +
    "建議把官網調整成 AI 更容易引用的格式：清楚寫出品牌事實、服務對象、差異化、案例證據、FAQ 與結構化資料。";
}

function render(data) {
  latestAudit = data;
  latestSummary = buildSummary(data);

  document.querySelector("#overall-score").textContent = data.overall;
  document.querySelector(".score-ring").style.setProperty("--angle", `${data.overall * 3.6}deg`);
  document.querySelector("#site-title").textContent = data.signals.title || data.input;
  document.querySelector("#site-meta").textContent =
    `${data.input} · 首頁狀態 ${data.signals.status || "未知"} · 初始 HTML 文字量 ${data.signals.wordCount} words`;

  renderInsightCards(data);

  categoryGrid.innerHTML = data.categories.map((category) => `
    <article class="category">
      <b>${category.score}</b>
      <h3>${escapeHtml(category.name)}</h3>
      ${category.items.slice(0, 5).map((item) => `
        <div class="check">
          <span class="${item.pass ? "pass" : "fail"}">${item.pass ? "✓" : "×"}</span>
          <span>${escapeHtml(item.label)}</span>
        </div>
      `).join("")}
    </article>
  `).join("");

  issues.innerHTML = data.topIssues.length
    ? data.topIssues.map((issue) => `
      <div class="issue">
        <strong>${escapeHtml(issue.category)}｜${escapeHtml(issue.label)}</strong>
        <p>${escapeHtml(issue.fix)}</p>
      </div>
    `).join("")
    : `<p class="summary-copy">基礎訊號完整。下一步建議開始追蹤 AI 是否實際提到你、引用誰，以及競爭對手是否更常被推薦。</p>`;

  summary.textContent = latestSummary;
}

function buildReportHtml(data) {
  const generatedAt = new Date(data.scannedAt || Date.now()).toLocaleString("zh-TW");
  const insights = data.insights || {};
  const insightCards = [
    ["AI 推薦可能性", insights.recommendationReadiness || "待補強", insights.recommendationReason || ""],
    ["買家會問的問題", `${(insights.buyerQuestions || []).length} 題`, (insights.buyerQuestions || []).join("、")],
    ["競品風險", insights.competitorRisk || "中", insights.competitorReason || ""]
  ];

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI 品牌能見度健檢報告</title>
  <style>
    :root{--bg:#F5EEE0;--panel:#fffaf0;--card:#E8D5B5;--text:#2E2A24;--muted:#8A7E72;--accent:#FF6B35;--line:#8B6F4C}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font-family:"Segoe UI","Noto Sans TC",Arial,sans-serif}
    main{width:min(1080px,calc(100% - 32px));margin:0 auto;padding:38px 0 54px}
    header{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;border-bottom:2px solid rgba(139,111,76,.25);padding-bottom:24px;margin-bottom:22px}
    h1{font-size:42px;line-height:1.08;margin:0 0 12px} h2{font-size:22px;margin:0 0 14px} p{line-height:1.7}
    .meta{color:var(--muted);margin:0}.score{width:150px;height:150px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--accent) ${data.overall * 3.6}deg,var(--card) 0);position:relative}
    .score:before{content:"";position:absolute;inset:12px;border-radius:50%;background:var(--panel)}.score strong{z-index:1;font-size:48px;color:var(--accent)}.score span{z-index:1;position:absolute;margin-top:60px;color:var(--muted)}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:22px 0}.grid.four{grid-template-columns:repeat(4,1fr)}
    .card,.panel{border:1px solid rgba(139,111,76,.28);border-radius:8px;background:var(--panel);padding:18px;box-shadow:0 12px 30px rgba(46,42,36,.08)}
    .card.feature{background:var(--card)}.card p{margin:0;color:#5c5146}.card b{display:block;color:var(--accent);font-size:30px;margin:8px 0}
    .category b{display:inline-block;background:var(--card);color:var(--accent);font-size:28px;padding:9px 12px;border-radius:8px;margin-bottom:10px}.check{display:flex;gap:8px;color:var(--muted);font-size:14px;line-height:1.5}.pass{color:#507a54;font-weight:900}.fail{color:#b23a2a;font-weight:900}
    .issue{border-top:1px solid rgba(139,111,76,.28);padding:13px 0}.issue:first-child{border-top:0}.summary{background:var(--card);font-size:18px}
    @media print{body{background:#fff}main{width:auto;padding:18px}.card,.panel{box-shadow:none}button{display:none}}
    @media(max-width:820px){header,.grid,.grid.four{grid-template-columns:1fr}.score{width:128px;height:128px}}
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="meta">AI Brand Visibility Audit · ${escapeHtml(generatedAt)}</p>
        <h1>AI 品牌能見度健檢報告</h1>
        <p class="meta">${escapeHtml(data.signals.title || data.input)}</p>
        <p class="meta">${escapeHtml(data.input)} · 首頁狀態 ${escapeHtml(data.signals.status || "未知")} · 初始 HTML 文字量 ${escapeHtml(data.signals.wordCount)} words</p>
      </div>
      <div class="score"><strong>${data.overall}</strong><span>總分</span></div>
    </header>

    <section class="grid">
      ${insightCards.map(([title, value, text]) => `
      <article class="card feature">
        <span>${escapeHtml(title)}</span>
        <b>${escapeHtml(value)}</b>
        <p>${escapeHtml(text)}</p>
      </article>`).join("")}
    </section>

    <section class="grid four">
      ${data.categories.map((category) => `
      <article class="card category">
        <b>${category.score}</b>
        <h2>${escapeHtml(category.name)}</h2>
        ${category.items.slice(0, 6).map((item) => `
        <div class="check"><span class="${item.pass ? "pass" : "fail"}">${item.pass ? "✓" : "×"}</span><span>${escapeHtml(item.label)}</span></div>`).join("")}
      </article>`).join("")}
    </section>

    <section class="panel">
      <h2>優先修復建議</h2>
      ${data.topIssues.length ? data.topIssues.map((issue) => `
      <div class="issue">
        <strong>${escapeHtml(issue.category)}｜${escapeHtml(issue.label)}</strong>
        <p>${escapeHtml(issue.fix)}</p>
      </div>`).join("") : `<p>基礎訊號完整，下一步建議開始追蹤 AI 實際提及率與引用來源。</p>`}
    </section>

    <section class="panel summary">
      <h2>可交給客戶看的結論</h2>
      <p>${escapeHtml(buildSummary(data))}</p>
    </section>
  </main>
</body>
</html>`;
}

function downloadHtmlReport() {
  if (!latestAudit) {
    alert("請先完成一次健檢，再下載報告。");
    return;
  }
  const blob = new Blob([buildReportHtml(latestAudit)], { type: "text/html;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = reportFileName(latestAudit);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  results.classList.add("hidden");
  loading.classList.remove("hidden");

  let index = 0;
  scanLine.textContent = scanLines[index];
  const timer = setInterval(() => {
    index = Math.min(index + 1, scanLines.length - 1);
    scanLine.textContent = scanLines[index];
  }, 850);

  try {
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "健檢失敗");
    render(data);
    results.classList.remove("hidden");
  } catch (error) {
    alert(error.message);
  } finally {
    clearInterval(timer);
    loading.classList.add("hidden");
  }
});

copySummary.addEventListener("click", async () => {
  await navigator.clipboard.writeText(latestSummary);
  copySummary.textContent = "已複製";
  setTimeout(() => {
    copySummary.textContent = "複製結論";
  }, 1400);
});

downloadReport.addEventListener("click", downloadHtmlReport);
