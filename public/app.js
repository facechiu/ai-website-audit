const form = document.querySelector("#audit-form");
const loading = document.querySelector("#loading");
const results = document.querySelector("#results");
const scanLine = document.querySelector("#scan-line");
const categoryGrid = document.querySelector("#category-grid");
const issues = document.querySelector("#issues");
const summary = document.querySelector("#summary");
const copySummary = document.querySelector("#copy-summary");

const scanLines = [
  "檢查首頁是否可被讀取...",
  "讀取 robots.txt 與 AI 爬蟲規則...",
  "尋找 sitemap.xml 與 llms.txt...",
  "分析 Meta、H1、Open Graph...",
  "檢查 JSON-LD 與信任訊號...",
  "整理修復建議..."
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
  if (score >= 80) return "基礎不錯，適合進一步放大 AI 搜尋曝光。";
  if (score >= 60) return "有基本架構，但還有幾個關鍵缺口會影響 AI 理解與引用。";
  return "目前官網對 AI 不夠友善，容易讓 AI 看不懂服務、信任度與推薦理由。";
}

function render(data) {
  document.querySelector("#overall-score").textContent = data.overall;
  document.querySelector(".score-ring").style.setProperty("--angle", `${data.overall * 3.6}deg`);
  document.querySelector("#site-title").textContent = data.signals.title || data.input;
  document.querySelector("#site-meta").textContent = `${data.input} · 首頁狀態 ${data.signals.status || "未知"} · 初始 HTML 文字量 ${data.signals.wordCount} words${data.signals.scriptHeavy ? " · 偵測到前端渲染風險" : ""}`;

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
    : `<p class="summary-copy">主要基礎訊號都已具備，下一步可優化內容深度、案例與 AI 引用格式。</p>`;

  const issueText = data.topIssues.map((issue) => `「${issue.label}」`).slice(0, 3).join("、");
  const renderWarning = data.signals.scriptHeavy ? "另外，這個網站的主內容可能高度依賴 JavaScript，部分 AI 爬蟲或搜尋爬蟲讀到的內容會比使用者看到的少。" : "";
  latestSummary = `這個網站的 AI 官網健檢總分為 ${data.overall} 分。${scoreTone(data.overall)}目前最需要優先處理的是 ${issueText || "內容深度與轉換引導"}。${renderWarning}建議把官網調整成 AI 更容易理解的格式：補齊結構化資料、明確說明服務與信任證據，並加入可被 AI 摘要引用的問答式內容。`;
  summary.textContent = latestSummary;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = new FormData(form).get("url");
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
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "掃描失敗");
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
