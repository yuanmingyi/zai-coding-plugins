# Java Deployment Example

## Supported Versions

- Java 11, 17, 21 (LTS versions)

## Local Dependencies

```bash
# Maven
mvn dependency:resolve

# Gradle
./gradlew dependencies
```

## Build Commands

| Build Tool | Command | Output |
|------------|---------|--------|
| Maven | `mvn clean package -DskipTests` | `target/*.jar` |
| Gradle | `./gradlew build -x test` | `build/libs/*.jar` |
| Gradle (Spring Boot) | `./gradlew bootJar` | `build/libs/*-BOOT.jar` |

## Dockerfile.build Guidance

Before running the build command, ensure the build tool exists inside the image.

- If the command uses `mvn`, choose one of:
  - a base image that already contains Maven (for example `maven:3.9-eclipse-temurin-17`)
  - install Maven before `RUN mvn ...`
  - use Maven wrapper (`./mvnw`) and include both `mvnw` and `.mvn/`
- If the command uses `./gradlew`, include `gradlew` and `gradle/` and run `chmod +x gradlew`.
- Do not execute `RUN mvn ...` or `RUN gradle ...` until the tool is available.
- Prefer resolving dependencies before copying full source to improve cache reuse.

Example (Maven image):

```dockerfile
FROM maven:3.9-eclipse-temurin-17
WORKDIR /build

COPY pom.xml ./
RUN mvn -B -DskipTests dependency:go-offline

COPY . .
RUN mvn -B clean package -DskipTests
CMD sh -c 'cp target/*.jar /output-mount/app.jar'
```

### Special Cases

| Framework | Build Command | Notes |
|-----------|---------------|-------|
| Spring Boot (Maven) | `mvn clean package -DskipTests` | Creates fat JAR with embedded server |
| Spring Boot (Gradle) | `./gradlew bootJar` | Creates executable JAR |
| Quarkus | `mvn package -Dquarkus.package.type=uber-jar` | Creates uber-JAR |
| Plain Java | `mvn clean package` | May need external dependencies |

## Output Directory

| Build Tool | Output Directory | Contents |
|------------|------------------|----------|
| Maven | `target/` | JAR files, classes |
| Gradle | `build/libs/` | JAR files |

## Files to Include

For `deploy-package/` (remote build context), include:

- `src/` - Java source files
- `pom.xml` or `build.gradle(.kts)` - Build manifests
- `settings.gradle(.kts)` - Gradle project settings (if used)
- `mvnw`, `.mvn/` - Maven wrapper files (if used)
- `gradlew`, `gradle/` - Gradle wrapper files (if used)
- `application.properties` / `application.yml` and other runtime resources

For runtime image output, include:

- `app.jar` (copied from `target/*.jar` or `build/libs/*.jar`)
- external config directories when needed (`config/`)

## Files to Exclude

- `.git/` - VCS metadata
- `target/`, `build/` - Local build outputs
- `.idea/`, `.vscode/` - IDE metadata
- `.env` and local secret files
- `test/`, `*Test.java` - Test files
- `.DS_Store`

## Startup Commands

```bash
# Standard JAR
java -jar app.jar

# With port configuration
java -Dserver.port=9000 -jar app.jar

# With memory limits
java -Xmx512m -Xms256m -jar app.jar

# Production optimizations
java -Djava.security.egd=file:/dev/./urandom -Dserver.port=9000 -jar app.jar
```

## Common Ports

- Spring Boot default: 8080 (dev)
- **Production: 9000 (REQUIRED)** - Application must use `PORT` environment variable

## Environment Variables

```bash
JAVA_OPTS=-Xmx512m -Xms256m
# REQUIRED: Production port
SERVER_PORT=9000
SPRING_PROFILES_ACTIVE=production
```

## Port Configuration Requirement

**The production environment REQUIRES port 9000.** Your application must read the port from the `PORT` or `SERVER_PORT` environment variable.

### Minimal configuration changes:

| Config File | Before | After |
|-------------|--------|-------|
| application.properties | `server.port=8080` | `server.port=${PORT:8080}` |
| application.yml | `server.port: 8080` | `server.port: ${PORT:8080}` |
| Command line | `-Dserver.port=8080` | `-Dserver.port=${PORT}` |

## Important Notes

1. **Use JRE, not JDK** in production containers (smaller image)
2. **Eclipse Temurin** is the recommended base image (successor to AdoptOpenJDK)
3. Spring Boot creates "fat JARs" with all dependencies included
4. Add `-Djava.security.egd=file:/dev/./urandom` for faster startup
5. Keep build tool and base image aligned (`maven:*` for mvn flows, Gradle wrapper for gradle flows)
6. Prefer pinned Java/Maven tags over floating `latest`
