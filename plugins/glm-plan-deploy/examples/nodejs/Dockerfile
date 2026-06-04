# Node.js Runtime Dockerfile
# Suitable for Express, Next.js, NestJS applications

FROM node:20-slim

# Set environment
ENV NODE_ENV=production
# Port configuration (REQUIRED: production uses port 9000)
ENV PORT=9000

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json /app/

# Install production dependencies only (npm example; keep PM consistent with lockfile in real projects)
RUN npm ci --omit=dev

# Copy application code
# For pre-built apps, copy the build output (e.g., .next/, dist/)
COPY . /app/

# Expose port (REQUIRED: production uses port 9000)
EXPOSE 9000

# Start the application
# The application MUST read port from process.env.PORT
# Adjust based on your framework:
# - Express: node server.js (ensure app.listen(process.env.PORT))
# - Next.js: npm start (ensure "start": "next start -p $PORT" in package.json)
# - NestJS: node dist/main.js
CMD ["node", "server.js"]
