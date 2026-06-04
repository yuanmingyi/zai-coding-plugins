## 获取支持的版本：

```bash
node /absolute/path/to/glm-plan-deploy/scripts/index.cjs node
```

返回 JSON 数组：`["14.10.8", "20.18.0", "22.17.1", "24.5.0"]`

## 检测项目的 Node.js 版本要求（按顺序）：

1. `package.json` 的 `engines.node` 字段（例如 `18.17.0`、`>=18.0.0`、`^16.14.0`）
2. `.nvmrc` 文件（例如 `18`、`lts/*`、`18.17.0`）
3. `.node-version` 文件（例如 `18`、`18.17.0`）
4. Lockfile（`package-lock.json` 或 `yarn.lock`）- 提取安装期间使用的 Node.js 版本
5. 框架依赖（确定最低版本要求）：
   - Angular 20 → 20.19.0+、22.12.0+ 或 24.0.0+
   - Angular 19 → 18.19.1+、20.11.1+ 或 22.0.0+
   - Angular 18 → 18.19.1+、20.11.1+ 或 22.0.0+
   - Angular 17（旧版）→ 18.13.0+ 或 20.9.0+
   - Express 5 → 18.17.0+（Node.js 18 EOL，建议 20+ 作为 active LTS）
   - Express 4 → 18.17.0+（旧版本支持 0.10+，但建议当前未 EOL 的 Node 版本）
   - Gatsby 5 → 18.0.0+（Node 18 EOL，建议 20+ 作为 active LTS）
   - Gatsby 4（旧版）→ 14.15.0+ 或 16.x+（不支持）
   - Hexo 8 → 20.19.0+（已放弃 Node.js 16 和 18 支持）
   - Hexo 7 → 14.0.0+（Node 14 EOL，建议 18.17.0+ 或 20+）
   - Hexo 6.2+ → 12.13.0+（旧版，Node 12/14 EOL）
   - Hexo 6.0-6.1 → 12.13.0 到 18.5.0（旧版）
   - Hexo 5 → 10.13.0 到 12.0.0（EOL）
   - Koa 3 → 18.0+
   - Koa 2 → 12.17+（最初为 7.6+）
   - Koa 1 → 0.12+（带 --harmony 标志，旧版）
   - Next.js 16+ → 20.9+
   - Next.js 15 → 18.18+、19.8.0 或 20.0.0+
   - Next.js 13-14 → 18.17+
   - Next.js 12-13 → 16.x 或 18.x
   - Qwik / Qwik City → 18.17+
   - Remix 3+ / React Router 7+ → 20+（Active/Maintenance LTS）
   - Remix 2 → 18+
   - Solid / SolidStart → 18+（建议 Latest LTS）
   - React（Create React App - 已弃用）→ 14.x+
   - Vite 7+ → 20.19+ 或 22.12+
   - Vite 6 → 18+、20+ 或 22+
   - Vite 5 → 18+ 或 20+
   - Vite 4 → 16.x+
   - Vue 3 + Vite → 20.19+ 或 22.12+
   - Nuxt 4 → 20.x+（建议 active LTS）
   - Nuxt 3 → 20.x+
   - Nuxt 2 → 14.x+ 或 16.x+（截至 2024 年 6 月 30 日已 EOL）
   - SvelteKit 2 → 18.13+
   - SvelteKit 1 → 16+（旧版）
   - Svelte 5 → 18+（基于 Vite 5）
   - Astro 5.8+ → 20.3+ 或 22+
   - Astro 5 → 18.20.8+、20.3+ 或 22+
   - Astro 4 → 18.x+
   - Docusaurus 3.9+ → 20.0+
   - Docusaurus 3 → 18.0+
   - Docusaurus 2 → 16.x+

**然后，从 API 响应中选择最接近的匹配版本：**

- 对于具体版本（例如 `18.17.0`）：在支持列表中查找最接近版本（优先匹配主版本，然后匹配次版本）
- 对于最低版本（例如 `>=18.0.0` 或 `18.x+`）：在支持列表中查找满足要求的最低版本
- 对于 caret 范围（例如 `^16.14.0`）：查找支持列表中 ≥ 16.14.0 且 < 17.0.0 的最低版本；如果该范围内没有，则选择最接近的主版本
- 对于 tilde 范围（例如 `~16.14.0`）：查找支持列表中 ≥ 16.14.0 且 < 16.15.0 的最低版本
- 对于主版本（例如 `18`）：查找支持列表中主版本为 18 的最接近版本

**如果无法从项目确定版本，或支持列表中没有版本匹配要求，将 Node.js 版本保持为 unknown**
