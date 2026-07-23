# AI 官網健檢工具

免費導流工具原型：輸入網址後，檢查網站是否具備 AI 搜尋與 AI 摘要容易理解的基礎訊號。

## 本機啟動

```powershell
node server.js
```

打開：

```text
http://localhost:4173
```

## Render 部署

這個專案已包含 `render.yaml`，可以直接部署到 Render Web Service。

Render 設定：

- Runtime: Node
- Build Command: 留空
- Start Command: `node server.js`
- Environment Variable:
  - `RATE_LIMIT_MAX=12`

## 功能

- 掃描首頁 HTML
- 檢查 `robots.txt`
- 檢查 `sitemap.xml`
- 檢查 `llms.txt`
- 檢查 Title、Meta description、H1、Open Graph
- 檢查 JSON-LD、Organization、LocalBusiness、FAQ 訊號
- 偵測初始 HTML 內容過少與前端渲染風險
- 產生 SEO 基礎、AI 可讀性、信任訊號、轉換引導四大分數
- 產生修復建議與可複製的客戶結論

## 注意

這不是「真實 ChatGPT 推薦排名」工具，而是 AI 官網可讀性與 AI 搜尋友善度健檢工具。
