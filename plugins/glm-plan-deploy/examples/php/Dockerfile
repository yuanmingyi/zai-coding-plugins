# PHP Runtime Dockerfile
# Suitable for Laravel, Symfony, plain PHP applications
# Uses Apache for simplicity

FROM php:8.2-apache

# Install PHP extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng-dev \
    libzip-dev \
    unzip \
    && docker-php-ext-install pdo pdo_mysql zip gd \
    && rm -rf /var/lib/apt/lists/*

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Enable Apache mod_rewrite
RUN a2enmod rewrite

# Set Apache document root to public directory (for Laravel/Symfony)
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
# Port configuration (REQUIRED: production uses port 9000)
ENV PORT=9000
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf
RUN sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

# Set working directory
WORKDIR /var/www/html

# Copy composer files first for better caching
COPY composer.json composer.lock /var/www/html/

# Install dependencies
RUN composer install --no-dev --optimize-autoloader --no-scripts

# Copy application code
COPY . /var/www/html/

# Set permissions for Laravel storage
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache 2>/dev/null || true

# Run Laravel optimizations (uncomment for Laravel)
# RUN php artisan config:cache && php artisan route:cache && php artisan view:cache

# Expose port (REQUIRED: production uses port 9000)
EXPOSE 9000

# Update Apache to listen on port 9000 (matching PORT env var)
RUN sed -i 's/80/9000/g' /etc/apache2/sites-available/000-default.conf /etc/apache2/ports.conf

# Start Apache
CMD ["apache2-foreground"]
