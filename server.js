import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = normalize(join(process.cwd(), "public"));
const rateLimitWindowMs = 60_000;
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 12);
const rateLimitStore = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function normalizeUrl(input) {
  const value = String(input || "").trim();
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("只支援 http 或 https 網址");
  return url;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function isRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, resetAt: now + rateLimitWindowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + rateLimitWindowMs;
  }
  entry.count += 1;
  rateLimitStore.set(ip, entry);
  return entry.count > rateLimitMax;
}

async function fetchText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "AI-Brand-Visibility-Audit/0.2 (+prototype)" }
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, text, headers: Object.fromEntries(res.headers) };
  } catch (error) {
    return { ok: false, status: 0, url: String(url), text: "", error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function has(pattern, text) {
  return pattern.test(text || "");
}

function cleanText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTag(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? cleanText(match[1]) : "";
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }
  return "";
}

function scoreItem(pass, weight) {
  return pass ? weight : 0;
}

function buildCategory(name, items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const earned = items.reduce((sum, item) => sum + scoreItem(item.pass, item.weight), 0);
  return { name, score: Math.round((earned / total) * 100), items };
}

function detectJsonLdTypes(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const types = new Set();
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] || [])];
      for (const node of nodes) {
        const type = node?.["@type"];
        if (Array.isArray(type)) type.forEach((t) => types.add(String(t)));
        if (typeof type === "string") types.add(type);
      }
    } catch {
      if (/FAQPage/i.test(block[1])) types.add("FAQPage");
      if (/Organization/i.test(block[1])) types.add("Organization");
      if (/LocalBusiness/i.test(block[1])) types.add("LocalBusiness");
    }
  }
  return [...types];
}

function robotsAllowsAi(robotsText) {
  if (!robotsText) return false;
  const lower = robotsText.toLowerCase();
  const blocked = ["gptbot", "claudebot", "perplexitybot", "ccbot", "google-extended"].some((bot) => {
    const section = lower.match(new RegExp(`user-agent:\\s*${bot}[\\s\\S]{0,300}`, "i"))?.[0] || "";
    return /disallow:\s*\//i.test(section);
  });
  return !blocked;
}

function splitCompetitors(value) {
  return String(value || "").split(/[,\n，、]/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
}

function buildBuyerQuestions({ brand, industry, competitors }) {
  const service = industry || "這類服務";
  const name = brand || "這個品牌";
  const rival = competitors[0] || "其他競爭對手";
  return [
    `有哪些${service}品牌值得推薦？`,
    `${name}適合哪些客戶？`,
    `${name}和${rival}差在哪？`,
    `選擇${service}公司時應該注意什麼？`
  ];
}

function inferRecommendationReadiness(score) {
  if (score >= 85) return "高";
  if (score >= 70) return "中高";
  if (score >= 55) return "中";
  return "偏低";
}

function buildInsights({ overall, brand, industry, competitors, bodyText, jsonLdTypes, llmsOk }) {
  const buyerQuestions = buildBuyerQuestions({ brand, industry, competitors });
  const hasBrand = brand ? bodyText.toLowerCase().includes(brand.toLowerCase()) : true;
  const hasCompetitors = competitors.length > 0;
  const competitorRisk = hasCompetitors && overall < 80 ? "高" : hasCompetitors ? "中" : "未知";
  const recommendationReadiness = inferRecommendationReadiness(overall);
  const recommendationReason = llmsOk && jsonLdTypes.length > 0
    ? "網站已有 AI 可讀檔案與結構化資料，AI 比較容易抓到品牌事實。"
    : "目前仍缺少 AI 可直接引用的檔案或結構化資料。";
  const competitorReason = hasCompetitors
    ? `已提供 ${competitors.length} 個競爭對手。若他們有更完整的 FAQ、案例與比較頁，AI 可能優先推薦他們。`
    : "尚未輸入競爭對手，因此只能判斷官網本身，無法比較誰更容易被 AI 推薦。";

  return {
    recommendationReadiness,
    recommendationReason: hasBrand ? recommendationReason : `頁面沒有明顯提到「${brand}」，AI 可能難以把內容與品牌連在一起。`,
    buyerQuestions,
    competitorRisk,
    competitorReason
  };
}

async function auditWebsite(payload) {
  const target = normalizeUrl(payload.url);
  const origin = target.origin;
  const brand = String(payload.brand || "").trim();
  const industry = String(payload.industry || "").trim();
  const competitors = splitCompetitors(payload.competitors);
  const [home, robots, sitemap, llms] = await Promise.all([
    fetchText(target.href),
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/sitemap.xml`),
    fetchText(`${origin}/llms.txt`)
  ]);

  const html = home.text || "";
  const title = extractTag(html, "title");
  const description = extractMeta(html, "description");
  const h1 = extractTag(html, "h1");
  const jsonLdTypes = detectJsonLdTypes(html);
  const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const scriptHeavy = wordCount < 80 && has(/<script[^>]+src=/i, html);
  const brandMentioned = brand ? bodyText.toLowerCase().includes(brand.toLowerCase()) : true;
  const industryMentioned = industry ? industry.split(/[,\s，、]+/).filter(Boolean).some((term) => bodyText.toLowerCase().includes(term.toLowerCase())) : true;
  const llmsOk = llms.ok && llms.text.length > 20;

  const signals = { title, description, h1, jsonLdTypes, wordCount, scriptHeavy, finalUrl: home.url, status: home.status };

  const categories = [
    buildCategory("AI 可讀基礎", [
      { label: "首頁可正常讀取", pass: home.ok, weight: 16, fix: "確認首頁回應 200，避免登入牆、封鎖或轉址錯誤。" },
      { label: "Title 清楚存在", pass: title.length >= 8, weight: 12, fix: "補上清楚 title，包含品牌、服務與主要關鍵字。" },
      { label: "Meta description 完整", pass: description.length >= 40, weight: 12, fix: "補上 80-160 字的頁面描述，明確說明服務與受眾。" },
      { label: "H1 具描述性", pass: h1.length >= 6, weight: 12, fix: "首頁第一個 H1 要讓 AI 一眼知道你提供什麼服務。" },
      { label: "文字內容足夠", pass: wordCount >= 250, weight: 14, fix: scriptHeavy ? "若內容靠 JavaScript 才出現，建議改成伺服器可讀的 HTML。" : "增加可被 AI 摘要的品牌、服務、案例與 FAQ 文字。" },
      { label: "sitemap.xml 可讀取", pass: sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.text), weight: 12, fix: "建立 /sitemap.xml，幫搜尋引擎與 AI 找到重要頁面。" },
      { label: "robots.txt 可讀取", pass: robots.ok, weight: 10, fix: "建立 /robots.txt，清楚告訴爬蟲哪些頁面可讀。" },
      { label: "未明顯封鎖 AI 爬蟲", pass: robotsAllowsAi(robots.text), weight: 12, fix: "檢查 GPTBot、ClaudeBot、PerplexityBot 是否被 Disallow: / 封鎖。" }
    ]),
    buildCategory("品牌事實", [
      { label: "品牌名稱出現在頁面", pass: brandMentioned, weight: 18, fix: "首頁要明確寫出品牌名稱，避免 AI 無法把內容和品牌連在一起。" },
      { label: "產業與服務清楚", pass: industryMentioned || /服務|方案|產品|service|solution|platform/i.test(bodyText), weight: 18, fix: "清楚列出服務項目、服務對象與應用情境。" },
      { label: "差異化主張", pass: /差異|優勢|專精|特色|why|benefit|advantage|better/i.test(bodyText), weight: 14, fix: "補上為什麼選你，而不是只寫公司簡介。" },
      { label: "案例或成果證據", pass: /案例|客戶|見證|成果|review|case|customer|testimonial/i.test(bodyText), weight: 18, fix: "加入案例、前後對照、客戶證言或成果數字。" },
      { label: "聯絡方式明確", pass: /聯絡|contact|電話|email|@|line/i.test(bodyText), weight: 14, fix: "提供 email、電話、表單或 Line，讓 AI 能理解下一步行動。" },
      { label: "隱私權或條款", pass: /隱私|privacy|條款|terms/i.test(bodyText), weight: 8, fix: "補上隱私權政策與服務條款，提升信任感。" },
      { label: "關於品牌說明", pass: /關於|about|公司|團隊|品牌/i.test(bodyText), weight: 10, fix: "補上關於我們、團隊背景或品牌故事。" }
    ]),
    buildCategory("AI 引用訊號", [
      { label: "llms.txt 存在", pass: llmsOk, weight: 20, fix: "建立 /llms.txt，整理品牌介紹、服務頁、FAQ、案例與重要連結。" },
      { label: "JSON-LD 結構化資料", pass: jsonLdTypes.length > 0, weight: 20, fix: "加入 Organization、LocalBusiness、FAQPage 或 Product Schema。" },
      { label: "Organization Schema", pass: jsonLdTypes.some((t) => /Organization/i.test(t)), weight: 16, fix: "加入 Organization Schema，包含名稱、網址、Logo、聯絡方式。" },
      { label: "FAQ 或問答內容", pass: /faq|常見問題|問答|q&a|問題/i.test(bodyText), weight: 18, fix: "新增常見問題區，使用客戶會拿去問 AI 的自然語句。" },
      { label: "Open Graph 摘要", pass: Boolean(extractMeta(html, "og:title") || extractMeta(html, "og:description")), weight: 10, fix: "補上 og:title、og:description、og:image，讓外部引用更完整。" },
      { label: "圖片 Alt 訊號", pass: has(/<img[^>]+alt=["'][^"']{3,}["']/i, html), weight: 8, fix: "替重要圖片加上描述性 alt，讓 AI 理解圖片內容。" },
      { label: "自然語言痛點", pass: /痛點|問題|挑戰|需要|擔心|推薦|AI/i.test(bodyText), weight: 8, fix: "用客戶會問的語氣描述問題，例如『AI 推薦不到我怎麼辦』。" }
    ]),
    buildCategory("推薦與轉換", [
      { label: "明確主要行動", pass: /預約|諮詢|聯絡|免費|試用|開始|get started|contact|book/i.test(bodyText), weight: 20, fix: "首頁第一屏放明確 CTA，例如免費健檢、預約諮詢。" },
      { label: "多段 CTA", pass: (bodyText.match(/預約|諮詢|聯絡|免費|試用|開始/g) || []).length >= 2, weight: 14, fix: "在頁首、內容中段、頁尾都放一次行動入口。" },
      { label: "服務對象清楚", pass: /適合|對象|企業|品牌|老闆|團隊|客戶|for/i.test(bodyText), weight: 16, fix: "明確寫出你服務誰，AI 才知道什麼情境該推薦你。" },
      { label: "競品比較線索", pass: /比較|差異|替代|vs|versus|競爭/i.test(bodyText) || competitors.length > 0, weight: 16, fix: "新增比較頁或『我們和其他方案差在哪』，提高 AI 回答比較題時引用你的機率。" },
      { label: "價格或合作方式", pass: /價格|費用|方案|報價|pricing|plan/i.test(bodyText), weight: 14, fix: "提供價格區間、方案或合作流程，降低 AI 與客戶的不確定性。" },
      { label: "社群或外部證明", pass: /facebook|instagram|linkedin|youtube|google map|review|評價/i.test(html), weight: 20, fix: "加入社群、Google 商家、媒體報導、客戶評價或第三方平台連結。" }
    ])
  ];

  const overall = Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length);
  const failed = categories.flatMap((c) => c.items.filter((item) => !item.pass).map((item) => ({ category: c.name, ...item })));
  const insights = buildInsights({ overall, brand, industry, competitors, bodyText, jsonLdTypes, llmsOk });

  return {
    input: target.href,
    scannedAt: new Date().toISOString(),
    overall,
    categories,
    signals,
    insights,
    topIssues: failed.sort((a, b) => b.weight - a.weight).slice(0, 5)
  };
}

async function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function publicPath(pathname) {
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const fullPath = normalize(join(PUBLIC_DIR, requested));
  if (fullPath !== PUBLIC_DIR && !fullPath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    throw new Error("Invalid path");
  }
  return fullPath;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === "POST" && url.pathname === "/api/audit") {
      if (isRateLimited(req)) return sendJson(res, 429, { error: "使用次數太頻繁，請稍後再試。" });
      let body = "";
      for await (const chunk of req) body += chunk;
      return sendJson(res, 200, await auditWebsite(JSON.parse(body || "{}")));
    }

    const fullPath = publicPath(url.pathname);
    const content = await readFile(fullPath);
    res.writeHead(200, { "content-type": mime[extname(fullPath)] || "application/octet-stream" });
    res.end(content);
  } catch (error) {
    if (req.url?.startsWith("/api/")) return sendJson(res, 400, { error: error.message });
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`AI 品牌能見度健檢已啟動：http://localhost:${PORT}`);
});
