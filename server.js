require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const Groq = require("groq-sdk");

const app = express();
const PORT = process.env.PORT || 5000;
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const groq = process.env.GROQ_API_KEY
    ? new Groq({ apiKey: process.env.GROQ_API_KEY })
    : null;

// ---------- middleware ----------
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const isPdf =
            file.mimetype === "application/pdf" ||
            file.originalname.toLowerCase().endsWith(".pdf");
        if (!isPdf) return cb(new Error("Please upload a PDF file."));
        cb(null, true);
    }
});

// ---------- helpers ----------
function cleanText(input) {
    return String(input || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

// Fetch a paper page (PMC / journal HTML) and strip tags. PDFs by URL also work.
async function fetchPaperFromUrl(url) {
    if (!/^https?:\/\//i.test(url)) throw new Error("Paper link must start with http:// or https://");
    const resp = await fetch(url, { headers: { "User-Agent": "steer-research-studio/1.0" } });
    if (!resp.ok) throw new Error(`Could not fetch the paper link (status ${resp.status}).`);
    const type = resp.headers.get("content-type") || "";
    if (type.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
        const buf = Buffer.from(await resp.arrayBuffer());
        return (await pdfParse(buf)).text || "";
    }
    const html = await resp.text();
    return html
        .replace(/<(script|style|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
}

// Shorten long papers but keep the useful sections
function prepareResearchText(input, maxChars = 9000) {
    const text = cleanText(input);
    if (text.length <= maxChars) return text;

    const sections = [
        { name: "ABSTRACT", pattern: /(?:^|\n)\s*abstract\s*(?:\n|:)/i, length: 1800 },
        { name: "INTRODUCTION", pattern: /(?:^|\n)\s*(?:\d+\.?\s*)?introduction\s*(?:\n|:)/i, length: 900 },
        { name: "METHODS", pattern: /(?:^|\n)\s*(?:\d+\.?\s*)?(?:methods?|materials\s+and\s+methods?|study\s+design)\s*(?:\n|:)/i, length: 1200 },
        { name: "RESULTS", pattern: /(?:^|\n)\s*(?:\d+\.?\s*)?results?\s*(?:\n|:)/i, length: 2000 },
        { name: "DISCUSSION", pattern: /(?:^|\n)\s*(?:\d+\.?\s*)?discussion\s*(?:\n|:)/i, length: 1500 },
        { name: "CONCLUSION", pattern: /(?:^|\n)\s*(?:\d+\.?\s*)?conclusions?\s*(?:\n|:)/i, length: 1000 },
        { name: "LIMITATIONS", pattern: /(?:^|\n)\s*limitations?\s*(?:\n|:)/i, length: 700 }
    ];

    const excerpts = [];
    for (const s of sections) {
        const m = s.pattern.exec(text);
        if (!m) continue;
        const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
        const ex = text.slice(start, start + s.length).trim();
        if (ex) excerpts.push(`[${s.name}]\n${ex}`);
    }

    let result = `PAPER OPENING / TITLE\n${text.slice(0, 1000)}\n\n` + excerpts.join("\n\n");
    if (excerpts.length === 0) {
        const first = Math.floor(maxChars * 0.65);
        result = text.slice(0, first) + "\n\n[END OF PAPER EXCERPT]\n" + text.slice(-(maxChars - first));
    }
    return result.slice(0, maxChars);
}

// ---------- accuracy + brand guardrails (no AI involved) ----------
const norm = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(/[^a-z0-9%.\-]+/g, " ")
        .trim();

const BANNED = [
    /semaglutide|tirzepatide|ozempic|wegovy|mounjaro|zepbound|rybelsus|liraglutide|saxenda/i,
    /before\s*(and|\/)\s*after/i,
    /\bmiracle\b|\bguarantee/i,
    /\blose\s+\d+\s*(kg|kilos?|pounds?|lbs?)/i
];

const DRUGS_RX = /semaglutide|tirzepatide|ozempic|wegovy|mounjaro|zepbound|rybelsus|liraglutide|saxenda/i;
const DRUGS_RX_G = new RegExp(DRUGS_RX.source, "gi");

function scrub(v) {
    if (typeof v === "string") return v.replace(DRUGS_RX_G, "a GLP-1 medicine");
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object")
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
    return v;
}

function publicFlags(content) {
    const publicText = JSON.stringify([
        content.carousel, content.static_post, content.reel,
        content.caption, content.caption_hinglish, content.hashtags
    ]);
    return BANNED.filter((rx) => rx.test(publicText)).map((rx) => rx.source);
}

function applyGuardrails(content, fullText) {
    const fullNorm = norm(fullText);

    content.key_findings = (content.key_findings || []).map((f, i) => ({
        ...f,
        id: `F${i + 1}`,
        quote_verified:
            Boolean(f.evidence_quote) && fullNorm.includes(norm(f.evidence_quote))
    }));

    content.compliance_flags = publicFlags(content);
    return content;
}

// ---------- prompt ----------
const SYSTEM_PROMPT = `
You are a scientific research content assistant for Steer, an Indian doctor-led metabolic health club.
Transform academic research into clear, engaging educational Instagram content.

SCIENTIFIC ACCURACY
1. Use only the supplied excerpt for scientific claims.
2. Never invent results, statistics, quotations or references.
3. evidence_quote must be copied EXACTLY (character for character, max 25 words) from the excerpt. If you cannot, return "".
4. State study limitations and uncertainty. Distinguish association from causation.
5. Do not imply a small or observational study proves a treatment works.
6. If something is not in the excerpt, say it is not available. Do not pretend the excerpt is the full paper.
7. Every number shown on any slide must appear in the evidence_quote of the finding it cites.
8. source_finding must be a finding id: "F1" for the first key finding, "F2" for the second, and so on.

STEER VOICE
- Doctor-led, warm, club not clinic. Short punchy lines; fragments are fine.
- Use Indian life: roti, chai, rice, desk jobs, family dinners.
- Sentence case. Never ALL CAPS.
- Never name any drug or brand. Say "a GLP-1 medicine" or "a clinical trial".
- Never promise kilos or timelines. No before/after. No fear, shame or hype. No personal medical advice.
- Last carousel slide: "Before you start, hear it from a doctor, not a reel." and steerclub.com.
- If the study population is mostly one group (for example mostly white or mostly women), say so on the last slide.

DOCTOR REVIEW
All output is an unapproved draft. Never claim a doctor has approved it.

OUTPUT: one valid JSON object only, no markdown fences, exactly this structure:
{
  "paper_summary": "...",
  "key_findings": [ { "finding": "...", "evidence_quote": "exact quote or empty string", "limitation": "..." } ],
  "carousel": { "slides": [ { "heading": "...", "body": "...", "source_finding": "F1" } ] },
  "static_post": { "headline": "...", "body": "...", "source_finding": "F1" },
  "reel": { "voiceover": "...", "scenes": [ { "visual": "...", "subtitle": "..." } ] },
  "caption": "...",
  "caption_hinglish": "same caption in Hinglish, Roman script",
  "hashtags": ["#..."],
  "doctor_review_notes": ["..."]
}
Generate up to 5 key findings and up to 5 carousel slides (the last one is the doctor CTA).
`;

async function callModel(userMessage) {
    const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage }
        ],
        temperature: 0.2,
        max_completion_tokens: 3500,
        response_format: { type: "json_object" }
    });
    return completion.choices?.[0]?.message?.content;
}

// ---------- routes ----------
app.get("/", (req, res) =>
    res.json({ success: true, message: "Research-to-Reels API is running!", aiProvider: "Groq", aiConfigured: Boolean(groq) })
);
app.get("/api/health", (req, res) =>
    res.json({ success: true, server: "running", aiProvider: "Groq", aiConfigured: Boolean(groq) })
);

app.post("/api/generate", upload.single("paper"), async (req, res) => {
    const started = Date.now();
    try {
        if (!groq) {
            return res.status(503).json({ success: false, error: "Groq API key is missing. Add GROQ_API_KEY to your environment." });
        }

        let researchText = "";
        let sourceLabel = "";

        if (req.file) {
            const pdfData = await pdfParse(req.file.buffer);
            researchText = pdfData.text || "";
            sourceLabel = req.file.originalname;
        } else if (typeof req.body?.researchText === "string" && req.body.researchText.trim()) {
            researchText = req.body.researchText;
            sourceLabel = "pasted text";
        } else if (typeof req.body?.paperUrl === "string" && req.body.paperUrl.trim()) {
            sourceLabel = req.body.paperUrl.trim();
            researchText = await fetchPaperFromUrl(sourceLabel);
        } else {
            return res.status(400).json({ success: false, error: "Please upload a research PDF, paste text, or give a paper link." });
        }

        researchText = cleanText(researchText);
        if (researchText.length < 200) {
            return res.status(400).json({ success: false, error: "Not enough readable text found. Try a text-based PDF or paste the text." });
        }

        const excerpt = prepareResearchText(researchText, 9000);

        const userMessage = `
Analyze the following research paper excerpt and create the content described in the system instructions.
The excerpt may not contain every section. Do not guess missing details. Do not invent numbers or quotes.

RESEARCH PAPER EXCERPT:

${excerpt}
`;

        // one automatic retry if the model returns broken JSON
        let content = null;
        for (let attempt = 1; attempt <= 2 && !content; attempt++) {
            const text = await callModel(userMessage);
            if (!text) continue;
            try { content = JSON.parse(text); }
            catch (e) { console.error(`JSON parse failed (attempt ${attempt})`); }
        }
        if (!content) throw new Error("The AI response could not be parsed. Please try again.");

        const required = ["paper_summary", "key_findings", "carousel", "static_post", "reel"];
        const missing = required.filter((f) => !Object.prototype.hasOwnProperty.call(content, f));
        if (missing.length) throw new Error("The AI response is missing sections: " + missing.join(", "));

        // verify quotes against the FULL paper text, then lint
        content = applyGuardrails(content, researchText);

        return res.json({
            success: true,
            status: "PENDING_DOCTOR_REVIEW",
            publishAllowed: false,
            source: sourceLabel,
            seconds: Math.round((Date.now() - started) / 100) / 10,
            message: "Draft generated. A qualified doctor must verify the findings and approve all content before publication.",
            content
        });
    } catch (error) {
        console.error("Generation error:", error);
        let status = Number(error.status || error.statusCode) || 500;
        let msg = error.message || "An unexpected error occurred.";
        if (/tokens per minute|Request too large/i.test(msg)) {
            status = 429;
            msg = "Groq token limit reached. Wait a minute, or use a shorter paper.";
        }
        if (![400, 401, 403, 413, 429, 500, 503].includes(status)) status = 500;
        return res.status(status).json({ success: false, error: msg });
    }
});

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            error: error.code === "LIMIT_FILE_SIZE" ? "PDF must be 15 MB or smaller." : error.message
        });
    }
    return res.status(400).json({ success: false, error: error.message || "The request could not be processed." });
});

app.listen(PORT, () => {
    console.log(`Research-to-Reels API running at http://localhost:${PORT}`);
    console.log("Groq configured:", Boolean(groq));
});