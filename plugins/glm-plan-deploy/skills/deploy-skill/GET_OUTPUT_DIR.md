To find build output directory(`outdir`), read config file first, fall back to default:

| Framework | Config File | Config Path | Default |
|-----------|-------------|-------------|---------|
| Angular | `angular.json` | `projects.{project}.architect.build.options.outputPath` | `dist/project-name/` |
| Astro | `astro.config.*` | `outDir` | `dist/` |
| Docusaurus | `docusaurus.config.*` | `outDir` | `build/` |
| Express | — | Server-side framework, no build output | — |
| Gatsby | `gatsby-config.*` | `pathPrefix` (CLI flags) | `public/` |
| Hexo | `_config.yml` | `public_dir` | `public/` |
| Koa | — | Server-side framework, no build output | — |
| Next.js | `next.config.*` | `distDir` | `.next/` |
| Next.js (static export) | - | When using next build && next export | `out/` |
| Nuxt | `nuxt.config.*` | `nitro.output.dir` / `buildDir` | `.output/public` |
| Qwik / Qwik City | `vite.config.*` | `build.outDir` | `dist/` |
| CRA (deprecated) | — | — | `build` |
| Remix | `vite.config.*` | `build.outDir` | `build/` |
| Solid / SolidStart | `app.config.ts` | Adapter-specific | `.output/public/` or `dist/` |
| SvelteKit | `svelte.config.js` | `kit.outDir` | `build` |
| Vite | `vite.config.*` | `build.outDir` | `dist` |
| Vue (Vite) | `vite.config.*` | `build.outDir` | `dist/` |
| webpack | `webpack.config.*` | `output.path` | `dist` |

**The `outdir` field MUST be concatenated by a subpath of `browser` for Angular framework, for example, the default value of `outdir` for Angular is `dist/project-name/browser`. This is different from the angular default setting because the deployment platform requires**

**If config file or value not found, leave the `outdir` unknown**