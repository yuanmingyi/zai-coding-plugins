# Ruby Deployment Example

## Supported Versions

- Ruby 3.1, 3.2, 3.3

## Local Dependencies

```bash
# Install bundler if not present
gem install bundler

# Required local build validation for deployment workflow
bundle install --deployment --without development test
```

## Build Commands

Ruby is interpreted, so no compilation is needed. However, local build validation is still required: install dependencies first, then run framework-specific asset steps when applicable.

| Framework | Build Command | Notes |
|-----------|---------------|-------|
| Rails | `bundle install --deployment --without development test && bundle exec rails assets:precompile` | Installs gems, then compiles assets to `public/assets/` |
| Sinatra | `bundle install --deployment --without development test` | Installs gems for runtime parity |
| Hanami | `bundle install --deployment --without development test && bundle exec hanami assets precompile` | Installs gems, then compiles assets |

### Special Cases

| Scenario | Command | Notes |
|----------|---------|-------|
| Rails production | `RAILS_ENV=production bundle exec rails assets:precompile` | Production asset compilation |
| Database migrations | `bundle exec rails db:migrate` | Run separately, not in container startup |

## Output Directory

| Framework | Output Directory | Contents |
|-----------|------------------|----------|
| Rails | `.` (root) + `public/assets/` | Source + compiled assets |
| Sinatra | `.` (root) | All source files |

## Files to Include

- `*.rb` - Ruby source files
- `Gemfile`, `Gemfile.lock` - Dependencies
- `config/` - Configuration files
- `app/`, `lib/` - Application code
- `public/` - Static assets (including compiled assets)
- `views/` - Template files
- `db/schema.rb` or `db/structure.sql` - Database schema

## Files to Exclude

- `.bundle/`
- `vendor/bundle/` - Reinstalled in container
- `tmp/`, `log/`
- `test/`, `spec/` - Test directories
- `.git/`
- `node_modules/` - If using Webpacker/jsbundling

## Startup Commands

| Framework | Development | Production |
|-----------|-------------|------------|
| Rails | `rails server` | `bundle exec rails server -e production -p 9000` |
| Rails (Puma) | `rails server` | `bundle exec puma -C config/puma.rb` |
| Sinatra | `ruby app.rb` | `bundle exec rackup -p 9000` |

## Common Ports

- Rails default: 3000 (dev)
- **Production: 9000 (REQUIRED)** - Application must use `PORT` environment variable

## Environment Variables

```bash
RAILS_ENV=production
RACK_ENV=production
SECRET_KEY_BASE=<generate with `rails secret`>
RAILS_SERVE_STATIC_FILES=true
# REQUIRED: Production port
PORT=9000
```

## Port Configuration Requirement

**The production environment REQUIRES port 9000.** Your application must read the port from the `PORT` environment variable.

### Minimal code/config changes:

| Framework | Before | After |
|-----------|--------|-------|
| Rails | `-p 3000` | `-p $PORT` or configure in `config/puma.rb` |
| Sinatra | `set :port, 3000` | `set :port, ENV['PORT'] \|\| 3000` |
| Puma (config/puma.rb) | `port 3000` | `port ENV.fetch('PORT') { 3000 }` |

## Important Notes

1. **Use `-slim` images** for smaller container size
2. **Bundle install with deployment flag** in production: `bundle install --deployment --without development test`
3. **Set SECRET_KEY_BASE** for Rails production
4. **RAILS_SERVE_STATIC_FILES=true** if not using a reverse proxy
5. Include `Gemfile.lock` for deterministic gem resolution
6. Prefer pinned Ruby tags over floating `latest`
