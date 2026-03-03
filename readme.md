# AI-IPS — Smart Hackathon Judging

Two separate files:
- `server.js`  — Node.js backend (Express + Multer + Claude API)
- `index.html` — Plain HTML/CSS/JS frontend

---

## Setup & Run

### 1. Install backend dependencies
```bash
npm install
```

### 2. Add your Anthropic API key
```bash
cp .env.example .env
# then edit .env and paste your key:
# ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Start the backend
```bash
node server.js
# or for auto-reload during development:
npx nodemon server.js
```
Server runs at: http://localhost:3001

### 4. Open the frontend
Just open `index.html` in your browser.  
Make sure the **Backend URL** field shows `http://localhost:3001`  
Click **Test** to verify the connection, then upload your .pptx files.

---

## How it works

```
Browser (index.html)
  └── uploads .pptx files via POST /api/evaluate
        └── server.js receives files (multer)
              └── JSZip extracts slide text
                    └── Claude API scores each project
                          └── returns ranked JSON results
                                └── frontend renders leaderboard
```

## API Endpoints

| Method | Path            | Description                        |
|--------|-----------------|------------------------------------|
| GET    | /api/health     | Server health check                |
| POST   | /api/evaluate   | Upload .pptx files, get scores     |

### POST /api/evaluate
- **Content-Type:** multipart/form-data
- **Field name:** `files` (multiple .pptx files)
- **Response:**
```json
{
  "results": [
    {
      "fileName": "project.pptx",
      "projectName": "SmartFarm AI",
      "summary": "An AI platform for precision agriculture.",
      "innovation": 8,
      "feasibility": 7,
      "practicality": 8,
      "completeness": 9,
      "total": 32,
      "shortlisted": true,
      "error": false
    }
  ]
}
```

## Scoring

| Score range | Status      |
|-------------|-------------|
| 28–40       | ✅ Shortlisted |
| 0–27        | ❌ Rejected    |

Each criterion scored 1–10 by Claude. Max total = 40.