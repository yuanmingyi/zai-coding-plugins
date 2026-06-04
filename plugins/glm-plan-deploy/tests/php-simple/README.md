# PHP Simple Test Project

Minimal PHP application for testing deploy-arbitrary agent.

## Local Development

```bash
# Using PHP built-in server
php -S 0.0.0.0:9000
```

## Expected Deployment Parameters

- **Language/Runtime**: PHP 8.2
- **Build command**: None (interpreted language)
- **Build output files**: None (source files used directly)
- **Runtime dependencies**: None (using php:8.2-apache base image)
- **Startup command**: Apache (automatic in php:8.2-apache, configured to listen on PORT)
- **Port**: 9000 (configured via Apache ports.conf and EXPOSE)

## Verify

```bash
curl http://localhost:9000
# {"status": "ok", "language": "php", "framework": "built-in"}
```

## Notes

- PHP uses Apache as the runtime server
- The PORT environment variable configures Apache to listen on port 9000
- The base image `php:8.2-apache` includes all necessary Apache configuration
