# Raw Static Path Routing Fixture

This fixture verifies raw-static deployments under a non-root `CONTEXT_PATH`.

It intentionally mixes:

- Relative HTML `href` paths such as `assets/relative.css` and `pages/relative.html`.
- Root-absolute HTML `href` paths such as `/assets/absolute.css` and `/pages/absolute.html`.
- Relative JavaScript redirects such as `location.href = "pages/relative.html"`.
- Root-absolute JavaScript redirects such as `location.assign("/pages/absolute.html")`.

Raw-static deployments should serve every target file under the deployed context path without routing asset or page requests back to `index.html`.
