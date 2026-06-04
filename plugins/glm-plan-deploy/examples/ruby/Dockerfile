# Ruby Runtime Dockerfile
# Suitable for Rails, Sinatra applications

FROM ruby:3.2-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set environment
ENV RAILS_ENV=production
ENV RACK_ENV=production
ENV RAILS_SERVE_STATIC_FILES=true
ENV RAILS_LOG_TO_STDOUT=true
# Port configuration (REQUIRED: production uses port 9000)
ENV PORT=9000

# Set working directory
WORKDIR /app

# Copy Gemfile first for better caching
COPY Gemfile Gemfile.lock /app/

# Install dependencies
RUN bundle config set --local deployment 'true' && \
    bundle config set --local without 'development test' && \
    bundle install

# Copy application code
COPY . /app/

# Precompile assets (for Rails)
# RUN bundle exec rails assets:precompile

# Expose port (REQUIRED: production uses port 9000)
EXPOSE 9000

# Start the application
# The application MUST read port from PORT environment variable
# Adjust based on your framework:
# - Rails: bundle exec rails server -e production -p $PORT -b 0.0.0.0
# - Rails (Puma): bundle exec puma -C config/puma.rb (configure port in puma.rb)
# - Sinatra: bundle exec rackup -p $PORT -o 0.0.0.0
CMD ["sh", "-c", "bundle exec rails server -e production -p $PORT -b 0.0.0.0"]
