# PHP Deployment Example

## Supported Versions

- PHP 8.1, 8.2, 8.3

## Local Dependencies

```bash
# If composer.json exists, install dependencies
composer install --no-dev --optimize-autoloader

# If no composer.json, run syntax validation on the entrypoint
php -l index.php
```

## Build Commands

PHP is interpreted, so no compilation is needed. However, local build validation is still required: install dependencies when Composer is used, otherwise run syntax validation on the entrypoint.

| Framework | Build Command | Notes |
|-----------|---------------|-------|
| Laravel | `composer install --no-dev --optimize-autoloader` | Optimizes autoloader |
| Laravel | `php artisan config:cache && php artisan route:cache` | Caches config and routes |
| Symfony | `composer install --no-dev --optimize-autoloader` | Optimizes autoloader |
| Plain PHP | `php -l index.php` | Syntax validation when no Composer dependencies are used |

### Special Cases

| Scenario | Command | Notes |
|----------|---------|-------|
| Laravel optimization | `php artisan optimize` | Caches config, routes, views |
| Laravel storage link | `php artisan storage:link` | Creates symlink for public storage |
| Clear cache | `php artisan cache:clear` | Clears application cache |

## Output Directory

| Framework | Output Directory | Contents |
|-----------|------------------|----------|
| Laravel | `.` (root) | All source files |
| Symfony | `.` (root) | All source files |
| Plain PHP | `.` (root) or `public/` | Source files |

## Files to Include

- `*.php` - PHP source files
- `composer.json`, `composer.lock` - Dependencies
- `public/` - Web root (index.php, assets)
- `resources/views/` - Blade templates (Laravel)
- `templates/` - Twig templates (Symfony)
- `config/` - Configuration files
- `routes/` - Route definitions
- `storage/` - Storage directory (Laravel)

## Files to Exclude

- `vendor/` - Reinstalled in container (or include for faster startup)
- `node_modules/`
- `tests/`
- `.git/`
- `.env` - Use environment variables instead
- `storage/logs/`, `storage/framework/cache/` - Temporary files

## Startup Commands

| Server | Command | Notes |
|--------|---------|-------|
| Apache | Apache starts automatically | Use `php:8.2-apache` image |
| Built-in | `php -S 0.0.0.0:9000 -t public` | Development only |
| PHP-FPM | Requires nginx configuration | Production recommended |

## Common Ports

- Apache default: 80 (dev)
- PHP built-in: 8000 (dev)
- **Production: 9000 (REQUIRED)** - Container must expose port 9000

## Environment Variables

```bash
APP_ENV=production
APP_DEBUG=false
APP_KEY=<generate with `php artisan key:generate`>
# REQUIRED: Production port (for Apache/nginx config)
PORT=9000
```

## Port Configuration Requirement

**The production environment REQUIRES port 9000.** The web server (Apache/nginx) must be configured to listen on port 9000.

### Configuration for Apache:

In Dockerfile, update Apache ports:
```dockerfile
RUN sed -i 's/80/9000/g' /etc/apache2/sites-available/000-default.conf /etc/apache2/ports.conf
```

### Configuration for nginx + PHP-FPM:

In nginx.conf:
```nginx
server {
    listen 9000;
    # ... rest of config
}
```

## Important Notes

1. **Apache vs FPM**: `php:*-apache` includes Apache; `php:*-fpm` requires separate nginx
2. **Document root**: Set to `public/` for Laravel/Symfony
3. **Extensions**: Install required PHP extensions (pdo, mysql, etc.)
4. **Storage permissions**: Ensure `storage/` and `bootstrap/cache/` are writable
5. Include `composer.lock` when present for deterministic dependency resolution
6. Prefer pinned PHP base tags over floating `latest`
