const form = document.querySelector("#audit-form");
const loading = document.querySelector("#loading");
const results = document.querySelector("#results");
const scanLine = document.querySelector("#scan-line");
const categoryGrid = document.querySelector("#category-grid");
const insightGrid = document.querySelector("#insight-grid");
const issues = document.querySelector("#issues");
const summary = document.querySelector("#summary");
const copySummary = document.querySelector("#copy-summary");

const scanLines = [
  "讀取首頁與公開檔案...",
  "檢查 robots.txt、sitemap.xml、llms.txt...",
  "整理品牌事實與服務線索...",
  "模擬買家會問 AI 的問題...",
  "比對競爭對手風險...",
  "產生可銷售的修復建議..."
];

let latestSummary = "";

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

function render(data) {
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

  const issueText = data.topIssues.map((issue) => `「${issue.label}」`).slice(0, 3).join("、");
  const questions = (data.insights?.buyerQuestions || []).slice(0, 2).join("；");
  latestSummary =
    `這個網站的 AI 品牌能見度健檢總分為 ${data.overall} 分。${scoreTone(data.overall)} ` +
    `若買家問 AI：「${questions || "這個產業有哪些品牌值得推薦？"}」，目前最需要優先補強的是 ${issueText || "持續監測 AI 提及率與引用來源"}。` +
    `建議把官網調整成 AI 更容易引用的格式：清楚寫出品牌事實、服務對象、差異化、案例證據、FAQ 與結構化資料。`;
  summary.textContent = latestSummary;
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
