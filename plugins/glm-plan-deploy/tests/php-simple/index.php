<?php
header('Content-Type: application/json');

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path === '/' || $path === '') {
    echo json_encode([
        'status' => 'ok',
        'language' => 'php',
        'framework' => 'built-in'
    ]);
} elseif ($path === '/health') {
    echo json_encode(['healthy' => true]);
} else {
    http_response_code(404);
    echo json_encode(['error' => 'Not found']);
}
