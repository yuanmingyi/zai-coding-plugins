use actix_web::{get, web, App, HttpResponse, HttpServer, Responder};
use serde::Serialize;
use std::env;

#[derive(Serialize)]
struct Response {
    status: String,
    language: String,
    framework: String,
}

#[derive(Serialize)]
struct HealthResponse {
    healthy: bool,
}

#[get("/")]
async fn index() -> impl Responder {
    HttpResponse::Ok().json(Response {
        status: "ok".to_string(),
        language: "rust".to_string(),
        framework: "actix-web".to_string(),
    })
}

#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(HealthResponse { healthy: true })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{}", port);

    println!("Server running on {}", addr);

    HttpServer::new(|| {
        App::new()
            .service(index)
            .service(health)
    })
    .bind(&addr)?
    .run()
    .await
}
