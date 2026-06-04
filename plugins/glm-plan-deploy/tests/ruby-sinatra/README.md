# Ruby Sinatra Test Project

Minimal Sinatra application for testing deploy-arbitrary agent.

## Local Development

```bash
bundle install
PORT=9000 ruby app.rb
# or with rackup
PORT=9000 bundle exec rackup -p 9000 -o 0.0.0.0
```

## Expected Deployment Parameters

- **Language/Runtime**: Ruby 3.2
- **Build command**: None (interpreted language)
- **Build output files**: None (source files used directly)
- **Runtime dependencies**: `bundle install --deployment --without development test`
- **Startup command**: `bundle exec rackup -p $PORT -o 0.0.0.0`
- **Port**: 9000 (via PORT env var)

## Verify

```bash
curl http://localhost:9000
# {"status": "ok", "language": "ruby", "framework": "sinatra"}
```
