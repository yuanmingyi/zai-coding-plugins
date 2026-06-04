要查找构建输出目录（`outdir`），先读取配置文件，再回退到默认值：

| 框架 | 配置文件 | 配置路径 | 默认值 |
|-----------|-------------|-------------|---------|
| Angular | `angular.json` | `projects.{project}.architect.build.options.outputPath` | `dist/project-name/` |
| Astro | `astro.config.*` | `outDir` | `dist/` |
| Docusaurus | `docusaurus.config.*` | `outDir` | `build/` |
| Express | — | 服务端框架，无构建输出 | — |
| Gatsby | `gatsby-config.*` | `pathPrefix`（CLI flags） | `public/` |
| Hexo | `_config.yml` | `public_dir` | `public/` |
| Koa | — | 服务端框架，无构建输出 | — |
| Next.js | `next.config.*` | `distDir` | `.next/` |
| Next.js（静态导出） | - | 使用 next build && next export 时 | `out/` |
| Nuxt | `nuxt.config.*` | `nitro.output.dir` / `buildDir` | `.output/public` |
| Qwik / Qwik City | `vite.config.*` | `build.outDir` | `dist/` |
| CRA（已弃用） | — | — | `build` |
| Remix | `vite.config.*` | `build.outDir` | `build/` |
| Solid / SolidStart | `app.config.ts` | 适配器特定 | `.output/public/` 或 `dist/` |
| SvelteKit | `svelte.config.js` | `kit.outDir` | `build` |
| Vite | `vite.config.*` | `build.outDir` | `dist` |
| Vue (Vite) | `vite.config.*` | `build.outDir` | `dist/` |
| webpack | `webpack.config.*` | `output.path` | `dist` |

**对于 Angular 框架，`outdir` 字段必须拼接 `browser` 子路径，例如 Angular 的默认 `outdir` 值是 `dist/project-name/browser`。这与 angular 默认设置不同，因为部署平台要求如此**

**如果未找到配置文件或配置值，将 `outdir` 保持为 unknown**
