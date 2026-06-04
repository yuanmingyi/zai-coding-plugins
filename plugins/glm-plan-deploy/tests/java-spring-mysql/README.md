# Java Spring Boot MySQL Test Project

Spring Boot application that uses JDBC, Spring Data JPA, Flyway, and MySQL. This fixture verifies that the deploy-arbitrary analyzer detects Java database dependencies and required MySQL runtime environment keys.

## Local Development

```bash
mvn clean package -DskipTests
PORT=9000 java -jar target/demo-db-0.0.1-SNAPSHOT.jar
```

## Expected Deployment Parameters

- **Language/Runtime**: Java 17
- **Build command**: `mvn clean package -DskipTests`
- **Build output files**: `target/*.jar`
- **Startup command**: `java -jar app.jar`
- **Database**: MySQL via `DATABASE_URL`
- **Port**: 9000 (via PORT env var)

## Verify

```bash
curl http://localhost:9000
# {"status":"ok","language":"java","framework":"spring-boot","database":"mysql"}

curl http://localhost:9000/todos
# Requires DATABASE_URL and a reachable migrated MySQL database.
```
