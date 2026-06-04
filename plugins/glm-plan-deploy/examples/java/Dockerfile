# Java Runtime Dockerfile
# Uses Eclipse Temurin (successor to AdoptOpenJDK)
# https://hub.docker.com/_/eclipse-temurin
FROM eclipse-temurin:17-jre

# Set working directory
WORKDIR /app

# Copy the JAR file
COPY app.jar /app/app.jar

# Port configuration (REQUIRED: production uses port 9000)
ENV PORT=9000
EXPOSE 9000

# Start the application
# The application MUST read port from PORT or server.port property
# Use a shell wrapper so PORT is expanded at container start time.
CMD ["sh", "-c", "exec java -Djava.security.egd=file:/dev/./urandom -Dserver.port=$PORT -jar /app/app.jar"]
