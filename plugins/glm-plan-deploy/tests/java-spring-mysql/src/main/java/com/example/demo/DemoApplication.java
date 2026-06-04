package com.example.demo;

import java.util.List;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
public class DemoApplication {
    private final JdbcTemplate jdbcTemplate;

    public DemoApplication(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }

    @GetMapping("/")
    public Map<String, String> index() {
        return Map.of(
                "status", "ok",
                "language", "java",
                "framework", "spring-boot",
                "database", "mysql");
    }

    @GetMapping("/todos")
    public Map<String, List<Map<String, Object>>> todos() {
        List<Map<String, Object>> rows =
                jdbcTemplate.queryForList(
                        "select id, title, completed, created_at from todos order by id limit 20");
        return Map.of("todos", rows);
    }
}
