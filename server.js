// ============================================================
//  AI-IPS  —  Backend Server (Node.js + Express)
//  Run:  npm install  then  node server.js
// ============================================================

const express    = require("express");
const multer     = require("multer");
const cors       = require("cors");
const JSZip      = require("jszip");
const Anthropic  = require("@anthropic-ai/sdk");
const path       = require("path");
require("dotenv").config();

const app  = express();
const PORT = process.env.PORT || 3001;

// ── middleware ────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());

// multer: store files in memory, 20 MB limit, max 50 files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 50 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".pptx") {
      return cb(new Error(`Wrong file type: ${file.originalname}. Only .pptx allowed.`));
    }
    cb(null, true);
  },
});

// Anthropic client — reads ANTHROPIC_API_KEY from .env
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── helpers ───────────────────────────────────────────────────

/**
 * Extract plain text from a .pptx buffer using JSZip.
 * Reads every ppt/slides/slideN.xml and strips XML tags.
 */
async function extractTextFromPPTX(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const slideKeys = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)[0]);
      const nb = parseInt(b.match(/\d+/)[0]);
      return na - nb;
    });

  if (!slideKeys.length) throw new Error("No slides found in file.");

  const texts = await Promise.all(
    slideKeys.map(async (key) => {
      const xml = await zip.files[key].async("string");
      return (xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [])
        .map((m) => m.replace(/<[^>]+>/g, ""))
        .join(" ");
    })
  );

  return texts.join("\n\n").trim();
}

/**
 * Send slide text to Claude and get back JSON scores.
 */
async function scoreWithClaude(fileName, slideText) {
  const prompt = `You are an expert hackathon judge evaluating a project presentation.

File: ${fileName}
Slide content:
${slideText.slice(0, 6000)}

Score the project on each criterion from 1 (very poor) to 10 (excellent):
- innovation:    How novel and creative is the idea?
- feasibility:   Can this realistically be built?
- practicality:  Does it solve a real problem well?
- completeness:  Is the presentation thorough and clear?

Return ONLY a valid JSON object. No markdown, no explanation, no extra text:
{
  "projectName": "name extracted or inferred from slides",
  "innovation": <integer 1-10>,
  "feasibility": <integer 1-10>,
  "practicality": <integer 1-10>,
  "completeness": <integer 1-10>,
  "summary": "one sentence describing what the project does"
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content.find((b) => b.type === "text")?.text || "{}";
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── routes ────────────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "AI-IPS server is running" });
});

/**
 * POST /api/evaluate
 * Accepts multiple .pptx files, returns scored + ranked results.
 *
 * Form field name: "files"
 * Response: { results: [...] }
 */
app.post("/api/evaluate", upload.array("files", 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded." });
  }

  const results = [];

  for (const file of req.files) {
    try {
      // 1. Extract text
      const text = await extractTextFromPPTX(file.buffer);
      if (!text) throw new Error("File appears to be empty or unreadable.");

      // 2. Score with Claude
      const scores = await scoreWithClaude(file.originalname, text);

      // 3. Compute total
      const total =
        scores.innovation +
        scores.feasibility +
        scores.practicality +
        scores.completeness;

      results.push({
        fileName:     file.originalname,
        projectName:  scores.projectName,
        summary:      scores.summary,
        innovation:   scores.innovation,
        feasibility:  scores.feasibility,
        practicality: scores.practicality,
        completeness: scores.completeness,
        total,
        shortlisted:  total >= 28,   // threshold: 28 / 40
        error:        false,
      });
    } catch (err) {
      console.error(`Error processing ${file.originalname}:`, err.message);
      results.push({
        fileName:     file.originalname,
        projectName:  file.originalname.replace(".pptx", ""),
        summary:      "Could not process this file.",
        innovation:   0,
        feasibility:  0,
        practicality: 0,
        completeness: 0,
        total:        0,
        shortlisted:  false,
        error:        true,
        errorMessage: err.message,
      });
    }
  }

  // Sort highest score first
  results.sort((a, b) => b.total - a.total);

  res.json({ results });
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Max 20 MB per file." });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ error: "Too many files. Max 50 at once." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// ── start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚡ AI-IPS server running at http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health\n`);
});