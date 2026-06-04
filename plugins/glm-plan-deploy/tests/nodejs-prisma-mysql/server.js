const express = require("express");

const app = express();
const port = process.env.PORT || 3000;

let prisma = null;

function getPrisma() {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  if (!prisma) {
    const { PrismaClient } = require("@prisma/client");
    prisma = new PrismaClient();
  }
  return prisma;
}

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    language: "nodejs",
    framework: "express",
    database: "mysql",
  });
});

app.get("/todos", async (_req, res) => {
  const client = getPrisma();
  if (!client) {
    res.status(503).json({ error: "DATABASE_URL is not configured" });
    return;
  }

  try {
    const todos = await client.todo.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json({ todos });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
