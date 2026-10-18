// ============================================
// RESEARCH-TO-REELS: frontend
// ============================================

// Deploy chesaka ikkada mee Render URL pettandi, udaharanaku "https://xxxx.onrender.com"
const API_URL = "http://localhost:5000";

const paperFile = document.getElementById("paperFile");
const paperUrl = document.getElementById("paperUrl");
const paperText = document.getElementById("paperText");
const generateButton = document.getElementById("generateButton");
const uploadStatus = document.getElementById("uploadStatus");
const generatedContent = document.getElementById("generatedContent");
const fileNameDisplay = document.getElementById("fileName");

function showStatus(message) {
    if (uploadStatus) uploadStatus.textContent = message;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
}

// ---------- PDF selection ----------
if (paperFile) {
    paperFile.addEventListener("change", () => {
        const file = paperFile.files?.[0];
        const reset = (msg) => {
            paperFile.value = "";
            if (fileNameDisplay) fileNameDisplay.textContent = "No paper selected";
            showStatus(msg);
        };
        if (!file) return reset("Please select a research paper PDF.");
        const isPDF = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        if (!isPDF) return reset("Please select a PDF file only.");
        if (file.size > 15 * 1024 * 1024) return reset("PDF size must be less than 15 MB.");
        if (fileNameDisplay) fileNameDisplay.textContent = "Selected: " + file.name;
        showStatus("PDF selected. Click Generate Content.");
    });
}

// ---------- helpers ----------
function renderList(items) {
    if (!Array.isArray(items) || items.length === 0) return "<p>No review notes available.</p>";
    return `<ul>${items.map((i) => `<li>${escapeHTML(typeof i === "string" ? i : JSON.stringify(i))}</li>`).join("")}</ul>`;
}

// Slide / static post -> 1080x1350 PNG in Steer colours (needs html2canvas)
async function downloadSlide(slide, index, total, filename) {
    if (typeof html2canvas === "undefined") {
        showStatus("html2canvas not loaded. Check the script tag in index.html.");
        return;
    }
    const el = document.createElement("div");
    el.style.cssText =
        "position:fixed;left:-99999px;top:0;width:1080px;height:1350px;background:#F5EBDF;" +
        "padding:100px 90px;box-sizing:border-box;display:flex;flex-direction:column;" +
        "justify-content:center;font-family:'DM Sans',sans-serif;color:#351D1D";
    el.innerHTML = `
      <div style="position:absolute;top:70px;left:90px;font:700 44px 'Playfair Display',serif;color:#C04E2A">steer</div>
      ${total > 1 ? `<div style="position:absolute;top:80px;right:90px;font-size:24px;color:#B58777">${index + 1} / ${total}</div>` : ""}
      <h1 style="font:500 80px/1.12 'Playfair Display',serif;color:#C04E2A;margin:0 0 40px">${escapeHTML(slide.heading)}</h1>
      <p style="font-size:36px;line-height:1.5;font-weight:300;margin:0">${escapeHTML(slide.body)}</p>
      <div style="position:absolute;bottom:70px;left:90px;font:italic 34px 'Playfair Display',serif;color:#C04E2A">steerclub.com</div>`;
    document.body.appendChild(el);
    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(el, { scale: 1, backgroundColor: "#F5EBDF" });
        const a = document.createElement("a");
        a.download = filename;
        a.href = canvas.toDataURL("image/png");
        a.click();
    } finally {
        el.remove();
    }
}

// ---------- render results ----------
function renderGeneratedContent(result) {
    if (!generatedContent) return showStatus("Result container missing in index.html.");

    const content = result.content || {};
    const staticPost = content.static_post || {};
    const reel = content.reel || {};
    const carousel = content.carousel || {};
    const findingsList = content.key_findings || [];
    const flags = content.compliance_flags || [];

    const findings = findingsList.map((f, i) => `
        <article class="generated-card finding-card" data-id="${escapeHTML(f.id)}" data-verified="${f.quote_verified ? 1 : 0}">
            <h3>${escapeHTML(f.id || "F" + (i + 1))}
                ${f.quote_verified
                    ? '<span class="badge ok">quote found in paper</span>'
                    : '<span class="badge bad">quote NOT found: doctor must check</span>'}
            </h3>
            <p><strong>Finding:</strong> ${escapeHTML(f.finding)}</p>
            <p><strong>Evidence quote:</strong> ${escapeHTML(f.evidence_quote || "(none)")}</p>
            <p><strong>Limitation:</strong> ${escapeHTML(f.limitation || "Verify the original research paper.")}</p>
            <label class="approve-row">
                <input type="checkbox" class="approve-box">
                Doctor approves this finding
            </label>
            ${f.quote_verified ? "" : '<input class="input-field source-note" placeholder="Source / citation for this claim (required to approve)">'}
        </article>`).join("");

    const slides = (carousel.slides || []).map((s, i) => `
        <article class="generated-card">
            <p>SLIDE ${i + 1}</p>
            <h3>${escapeHTML(s.heading)}</h3>
            <p>${escapeHTML(s.body)}</p>
            <small>Source: ${escapeHTML(s.source_finding)}</small>
        </article>`).join("");

    const scenes = (reel.scenes || []).map((s, i) => `
        <article class="generated-card">
            <h3>Scene ${i + 1}</h3>
            <p><strong>Visual:</strong> ${escapeHTML(s.visual)}</p>
            <p><strong>Subtitle:</strong> ${escapeHTML(s.subtitle)}</p>
        </article>`).join("");

    generatedContent.hidden = false;
    generatedContent.innerHTML = `
        <section class="generated-card review-warning">
            <h2>Doctor review required</h2>
            <p>${escapeHTML(result.message || "Verify all claims against the original paper.")}</p>
            <p><strong>Status:</strong> ${escapeHTML(result.status || "PENDING_DOCTOR_REVIEW")}
               &middot; <strong>Publishing allowed:</strong> No
               ${result.seconds ? `&middot; <strong>Machine time:</strong> ${escapeHTML(result.seconds)} s` : ""}</p>
            ${flags.length ? `<p class="badge bad">Compliance flags: ${escapeHTML(flags.join(" | "))}</p>` : ""}
        </section>

        <section class="generated-card">
            <h2>Research summary</h2>
            <p>${escapeHTML(content.paper_summary)}</p>
        </section>

        <section>
            <h2>01 &mdash; Key findings</h2>
            ${findings || "<p>No findings returned.</p>"}
        </section>

        <section>
            <h2>02 &mdash; Instagram carousel</h2>
            <button id="downloadSlides" type="button" class="action-button">Download slides (PNG)</button>
            ${slides || "<p>No carousel slides returned.</p>"}
        </section>

        <section class="generated-card">
            <h2>03 &mdash; Static post</h2>
            <h3>${escapeHTML(staticPost.headline)}</h3>
            <p>${escapeHTML(staticPost.body)}</p>
            <small>Source: ${escapeHTML(staticPost.source_finding)}</small>
            <button id="downloadStatic" type="button" class="action-button">Download static (PNG)</button>
        </section>

        <section class="generated-card">
            <h2>04 &mdash; Reel voiceover</h2>
            <p>${escapeHTML(reel.voiceover)}</p>
        </section>

        <section>
            <h2>05 &mdash; Reel scenes</h2>
            ${scenes || "<p>No scenes returned.</p>"}
        </section>

        <section class="generated-card">
            <h2>06 &mdash; Caption</h2>
            <p>${escapeHTML(content.caption)}</p>
            <h3>Hinglish</h3>
            <p>${escapeHTML(content.caption_hinglish)}</p>
            <h3>Hashtags</h3>
            <p>${escapeHTML(Array.isArray(content.hashtags) ? content.hashtags.join(" ") : "")}</p>
        </section>

        <section class="generated-card">
            <h2>07 &mdash; Doctor review notes</h2>
            ${renderList(content.doctor_review_notes)}
        </section>

        <section class="generated-card review-warning">
            <h2>Approval</h2>
            <input id="reviewerName" class="input-field" placeholder="Reviewing doctor's name">
            <button id="exportApproved" type="button" class="action-button" disabled>Export approved content</button>
            <p id="approvalState">0 findings approved</p>
            <small>Export stays locked until every finding is approved, unverified quotes have a source note, and there are no compliance flags.</small>
        </section>`;

    // ----- PNG downloads -----
    document.getElementById("downloadSlides")?.addEventListener("click", async () => {
        const list = carousel.slides || [];
        for (let i = 0; i < list.length; i++) {
            await downloadSlide(list[i], i, list.length, `steer-slide-${i + 1}.png`);
            await new Promise((r) => setTimeout(r, 400));
        }
    });
    document.getElementById("downloadStatic")?.addEventListener("click", () =>
        downloadSlide({ heading: staticPost.headline, body: staticPost.body }, 0, 1, "steer-static.png")
    );

    // ----- approval gate -----
    const cards = [...generatedContent.querySelectorAll(".finding-card")];
    const nameInput = document.getElementById("reviewerName");
    const exportBtn = document.getElementById("exportApproved");
    const stateEl = document.getElementById("approvalState");

    function cardApproved(card) {
        const checked = card.querySelector(".approve-box").checked;
        if (!checked) return false;
        if (card.dataset.verified === "1") return true;
        return (card.querySelector(".source-note")?.value || "").trim().length > 3;
    }

    function updateGate() {
        const done = cards.filter(cardApproved).length;
        stateEl.textContent = `${done} / ${cards.length} findings approved`;
        exportBtn.disabled = !(
            cards.length > 0 && done === cards.length &&
            nameInput.value.trim().length > 2 && flags.length === 0
        );
    }
    generatedContent.addEventListener("input", updateGate);
    generatedContent.addEventListener("change", updateGate);

    exportBtn.addEventListener("click", () => {
        const approvals = cards.map((c) => ({
            id: c.dataset.id,
            quote_verified: c.dataset.verified === "1",
            source_note: c.querySelector(".source-note")?.value.trim() || ""
        }));
        const out = { reviewer: nameInput.value.trim(), date: new Date().toISOString(), approvals, content };
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
        a.download = "approved-content.json";
        a.click();
    });

    generatedContent.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- generate ----------
if (generateButton) {
    generateButton.addEventListener("click", async (event) => {
        event.preventDefault();

        const file = paperFile?.files?.[0];
        const text = paperText?.value?.trim() || "";
        const url = paperUrl?.value?.trim() || "";

        if (!file && !text && !url) {
            return showStatus("Please upload a PDF, paste research text, or add a paper link.");
        }

        const formData = new FormData();
        if (file) formData.append("paper", file);
        else if (text) formData.append("researchText", text);
        else formData.append("paperUrl", url);

        generateButton.disabled = true;
        const originalText = generateButton.textContent;
        generateButton.textContent = "Generating...";
        showStatus("Processing research paper. Please wait...");
        if (generatedContent) { generatedContent.innerHTML = ""; generatedContent.hidden = true; }

        try {
            const response = await fetch(`${API_URL}/api/generate`, { method: "POST", body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Server error: ${response.status}`);
            if (!result.content) throw new Error("No generated content received from backend.");

            renderGeneratedContent(result);
            showStatus("Content generated. Doctor review required before publication.");
        } catch (error) {
            console.error("Generation error:", error);
            showStatus("Error: " + error.message);
        } finally {
            generateButton.disabled = false;
            generateButton.textContent = originalText || "Generate Content";
        }
    });
}