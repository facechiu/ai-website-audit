import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = join(process.cwd(), "public");
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
      headers: {
        "user-agent": "AI-Website-Audit-Prototype/0.1 (+local prototype)"
      }
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

function extractTag(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
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
  const blocked = ["gptbot", "claudebot", "perplexitybot", "ccbot"].some((bot) => {
    const section = lower.match(new RegExp(`user-agent:\\s*${bot}[\\s\\S]{0,300}`, "i"))?.[0] || "";
    return /disallow:\s*\//i.test(section);
  });
  return !blocked;
}

async function auditWebsite(input) {
  const target = normalizeUrl(input);
  const origin = target.origin;
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
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const scriptHeavy = wordCount < 80 && has(/<script[^>]+src=/i, html);

  const signals = {
    title,
    description,
    h1,
    jsonLdTypes,
    wordCount,
    scriptHeavy,
    finalUrl: home.url,
    status: home.status
  };

  const categories = [
    buildCategory("SEO 基礎", [
      { label: "首頁可正常讀取", pass: home.ok, weight: 18, fix: "確認首頁沒有封鎖爬蟲，並回傳 200 狀態。" },
      { label: "Title 清楚存在", pass: title.length >= 8, weight: 16, fix: "加入包含品牌、服務、地區的 title。" },
      { label: "Meta description 完整", pass: description.length >= 40, weight: 16, fix: "補上 80-160 字的頁面描述，明確說明服務與受眾。" },
      { label: "H1 存在且具描述性", pass: h1.length >= 6, weight: 14, fix: "首頁保留一個清楚 H1，避免只放品牌口號。" },
      { label: "圖片 Alt 訊號", pass: has(/<img[^>]+alt=["'][^"']{3,}["']/i, html), weight: 10, fix: "重要圖片加入描述性 alt，讓 AI 理解畫面內容。" },
      { label: "Sitemap 可讀取", pass: sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.text), weight: 14, fix: "建立 /sitemap.xml 並提交給搜尋引擎。" },
      { label: "Open Graph 存在", pass: Boolean(extractMeta(html, "og:title") || extractMeta(html, "og:description")), weight: 12, fix: "補上 og:title、og:description、og:image。" }
    ]),
    buildCategory("AI 可讀性", [
      { label: "robots.txt 可讀取", pass: robots.ok, weight: 16, fix: "建立 /robots.txt，清楚宣告允許的爬蟲規則。" },
      { label: "未明顯封鎖主要 AI 爬蟲", pass: robotsAllowsAi(robots.text), weight: 20, fix: "檢查 GPTBot、ClaudeBot、PerplexityBot 是否被 Disallow: / 擋住。" },
      { label: "llms.txt 存在", pass: llms.ok && llms.text.length > 20, weight: 18, fix: "新增 /llms.txt，整理品牌、服務、重要頁面與引用資訊。" },
      { label: "JSON-LD 結構化資料", pass: jsonLdTypes.length > 0, weight: 18, fix: "加入 Organization、LocalBusiness、FAQPage 等 JSON-LD。" },
      { label: "FAQ 或問答型內容", pass: /faq|常見問題|問答|q&a|問題/i.test(bodyText), weight: 14, fix: "新增常見問題區，使用客戶會問的自然語句。" },
      {
        label: "初始 HTML 有足夠主內容",
        pass: wordCount >= 250,
        weight: 14,
        fix: scriptHeavy
          ? "目前主內容可能依賴 JavaScript 渲染；建議改成 SSR/SSG，讓 AI 與搜尋爬蟲直接讀到首頁文字。"
          : "首頁應有足夠文字說清楚服務、對象、流程與差異。"
      }
    ]),
    buildCategory("信任訊號", [
      { label: "Organization Schema", pass: jsonLdTypes.some((t) => /Organization/i.test(t)), weight: 20, fix: "加入 Organization Schema，包含名稱、網址、Logo、聯絡方式。" },
      { label: "LocalBusiness Schema", pass: jsonLdTypes.some((t) => /LocalBusiness/i.test(t)), weight: 16, fix: "若服務在地客戶，加入 LocalBusiness Schema。" },
      { label: "關於/品牌介紹訊號", pass: /關於|about|公司|品牌|團隊/i.test(bodyText), weight: 16, fix: "補上關於我們、團隊背景、服務經驗。" },
      { label: "聯絡資訊明確", pass: /聯絡|contact|電話|email|@|line/i.test(bodyText), weight: 16, fix: "讓 email、電話、表單、Line 等聯絡方式容易被找到。" },
      { label: "隱私權或條款", pass: /隱私|privacy|條款|terms/i.test(bodyText), weight: 12, fix: "補上隱私權政策與服務條款。" },
      { label: "案例/成果/客戶證明", pass: /案例|成果|客戶|見證|作品|portfolio|case/i.test(bodyText), weight: 20, fix: "加入案例、前後對照、客戶證言或實績。" }
    ]),
    buildCategory("轉換引導", [
      { label: "明確主要行動", pass: /預約|諮詢|聯絡|報價|開始|免費|試用|contact|book/i.test(bodyText), weight: 24, fix: "首頁第一屏放明確 CTA，例如免費健檢、預約諮詢。" },
      { label: "服務項目清楚", pass: /服務|方案|價格|流程|項目|service|pricing/i.test(bodyText), weight: 20, fix: "列出服務範圍、流程、交付內容與適合對象。" },
      { label: "痛點語言", pass: /問題|痛點|困擾|提升|成長|轉換|曝光|搜尋|AI/i.test(bodyText), weight: 18, fix: "用客戶語言說明他現在失去哪些 AI 搜尋機會。" },
      { label: "多段 CTA", pass: (bodyText.match(/聯絡|預約|諮詢|報價|開始|免費/g) || []).length >= 2, weight: 18, fix: "在頁首、內容中段、頁尾都放一次行動入口。" },
      { label: "社群或外部證明", pass: /facebook|instagram|linkedin|youtube|google map|review|評價/i.test(html), weight: 20, fix: "加入外部平台、評價、社群連結或媒體報導。" }
    ])
  ];

  const overall = Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length);
  const failed = categories.flatMap((c) => c.items.filter((item) => !item.pass).map((item) => ({ category: c.name, ...item })));
  return {
    input: target.href,
    scannedAt: new Date().toISOString(),
    overall,
    categories,
    signals,
    topIssues: failed.sort((a, b) => b.weight - a.weight).slice(0, 5)
  };
}

async function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === "POST" && url.pathname === "/api/audit") {
      if (isRateLimited(req)) {
        return sendJson(res, 429, { error: "掃描太頻繁，請稍後再試。" });
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const { url: targetUrl } = JSON.parse(body || "{}");
      return sendJson(res, 200, await auditWebsite(targetUrl));
    }

    const filePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const fullPath = join(PUBLIC_DIR, filePath);
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
  console.log(`AI 官網健檢原型已啟動：http://localhost:${PORT}`);
});
