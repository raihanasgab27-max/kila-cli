import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { tools } from '../src/tools.js';
const purple = chalk.hex('#8800ff');
// === AGENT CLASS ===
export class Agent {
    history;
    fullHistory;
    model;
    serverUrl;
    cwd;
    // Layer B: Memori Terstruktur (Imut / Append-Only)
    memory = {
        constraints: [],
        preferences: [],
        milestones: [],
        findings: [],
        architecture: []
    };
    // Decision Versioning (dengan supersedes & contradiction resolution)
    activeDecisions = [];
    // Layer C: Episodic Memory Store (RAG)
    memoryStore = [];
    archivedMemories = [];
    // Layer E: Workspace Retrieval
    workspaceIndex = [];
    workspaceIndexBuilt = false;
    // Token Budget Limits (Balanced for 32k context window)
    softLimit = 24000;
    hardLimit = 32000;
    activeTopic = {
        title: 'Inisialisasi',
        summary: 'Memulai percakapan dengan pengguna.'
    };
    // Telemetry Metrics
    metrics = {
        totalTurns: 0,
        retrievalQueries: 0,
        retrievalHits: 0,
        retrievalMentioned: 0,
        retrievalUtilized: 0,
        workspaceRetrieved: 0,
        workspaceOpened: 0,
        workspaceUsed: 0,
        constraintViolationsCount: 0,
        decisionViolationsCount: 0,
        decisionConflicts: 0,
        tokenHistory: [],
        retrievedTags: {},
        violatedDecisions: {},
        lastTokenBreakdown: {
            base: 0,
            constraints: 0,
            preferences: 0,
            decisions: 0,
            status: 0,
            retrievedMemories: 0,
            workspaceFiles: 0,
            history: 0
        }
    };
    // Transient state for tracking file actions per turn
    lastRetrievedMemories = [];
    lastRetrievedWorkspaceFiles = [];
    lastRetrievedMemoriesText = '';
    lastRetrievedWorkspaceText = '';
    workspaceOpenedThisTurn = new Set();
    workspaceUsedThisTurn = new Set();
    constructor(serverUrl, model = 'Qwopus3.5:9b') {
        this.serverUrl = serverUrl.replace(/\/$/, '');
        this.model = model;
        this.cwd = process.cwd();
        this.history = [
            {
                role: 'system',
                content: '' // Diisi dinamis sebelum chat dipanggil
            }
        ];
        this.fullHistory = [];
        this.loadMetrics();
    }
    // =============================================
    // METRICS PERSISTENCE
    // =============================================
    getMetricsPath() {
        return path.join(this.cwd, '.kila-eval.json');
    }
    loadMetrics() {
        const filePath = this.getMetricsPath();
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(raw);
                this.metrics = {
                    ...this.metrics,
                    ...parsed,
                    tokenHistory: parsed.tokenHistory || [],
                    retrievedTags: parsed.retrievedTags || {},
                    violatedDecisions: parsed.violatedDecisions || {},
                    lastTokenBreakdown: {
                        ...this.metrics.lastTokenBreakdown,
                        ...(parsed.lastTokenBreakdown || {})
                    }
                };
            }
            catch (e) {
                // Ignore error and use default metrics
            }
        }
    }
    saveMetrics() {
        try {
            const filePath = this.getMetricsPath();
            fs.writeFileSync(filePath, JSON.stringify(this.metrics, null, 2), 'utf8');
        }
        catch (e) {
            // Ignore write errors
        }
    }
    // =============================================
    // WORKSPACE RETRIEVAL (Layer E)
    // =============================================
    buildWorkspaceIndex() {
        const excludeDirs = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.vscode', 'coverage']);
        const codeExtensions = new Set(['.ts', '.js', '.jsx', '.tsx', '.json', '.md', '.css', '.html', '.py', '.go', '.rs', '.java']);
        const indexFile = (filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            if (!codeExtensions.has(ext))
                return;
            try {
                const stat = fs.statSync(filePath);
                const basename = path.basename(filePath, ext);
                const relativePath = path.relative(this.cwd, filePath).replace(/\\/g, '/');
                const parts = relativePath.split('/').filter(p => p.length > 0);
                const tags = parts
                    .map(p => p.replace(ext, '').toLowerCase())
                    .flatMap(p => p.split(/[-_.]/).filter(t => t.length > 2));
                let summary = '';
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const lines = content.split('\n').slice(0, 3);
                    summary = lines.join(' ').substring(0, 120).trim();
                }
                catch (e) {
                    summary = `File ${ext}`;
                }
                this.workspaceIndex.push({
                    path: relativePath,
                    tags: Array.from(new Set(tags)),
                    summary,
                    lastModified: stat.mtimeMs
                });
            }
            catch (e) {
                // Ignore files that can't be read
            }
        };
        try {
            const entries = fs.readdirSync(this.cwd, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile()) {
                    indexFile(path.join(this.cwd, entry.name));
                }
                else if (entry.isDirectory() && !excludeDirs.has(entry.name)) {
                    try {
                        const subEntries = fs.readdirSync(path.join(this.cwd, entry.name), { withFileTypes: true });
                        for (const subEntry of subEntries) {
                            if (subEntry.isFile()) {
                                indexFile(path.join(this.cwd, entry.name, subEntry.name));
                            }
                        }
                    }
                    catch (e) {
                        // Ignore subfolders that can't be read
                    }
                }
            }
            this.workspaceIndexBuilt = true;
            console.log(chalk.gray(`  [workspace] Indexed ${this.workspaceIndex.length} files from ${this.cwd}`));
        }
        catch (e) {
            // Ignore CWD errors
        }
    }
    retrieveWorkspaceFiles(queryWords) {
        if (!this.workspaceIndexBuilt)
            this.buildWorkspaceIndex();
        if (this.workspaceIndex.length === 0 || queryWords.length === 0) {
            this.lastRetrievedWorkspaceFiles = [];
            return '';
        }
        const scored = this.workspaceIndex.map(file => {
            let score = 0;
            file.tags.forEach(tag => {
                if (queryWords.includes(tag))
                    score += 2;
            });
            const pathWords = file.path.toLowerCase().split(/[/\-_.]/);
            queryWords.forEach(qw => {
                if (pathWords.includes(qw))
                    score += 1;
            });
            return { file, score };
        });
        const matched = scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5); // Max 5 files
        this.lastRetrievedWorkspaceFiles = matched.map(m => m.file.path);
        if (matched.length === 0)
            return '';
        return matched
            .map(m => `- ${m.file.path} (Tags: ${m.file.tags.join(', ')})`)
            .join('\n');
    }
    // =============================================
    // DECISION VERSIONING & CONTRADICTION RESOLUTION
    // =============================================
    addOrUpdateDecision(topic, value) {
        const normalizedTopic = topic.toLowerCase().trim();
        const existing = this.activeDecisions.find(d => d.active && d.topic.toLowerCase().trim() === normalizedTopic);
        const newId = Math.random().toString(36).substring(7);
        if (existing) {
            existing.active = false;
            this.activeDecisions.push({
                id: newId,
                topic,
                value,
                supersedes: existing.id,
                timestamp: Date.now(),
                active: true
            });
        }
        else {
            this.activeDecisions.push({
                id: newId,
                topic,
                value,
                timestamp: Date.now(),
                active: true
            });
        }
    }
    getActiveDecisions() {
        return this.activeDecisions.filter(d => d.active);
    }
    // =============================================
    // SYSTEM PROMPT BUILDER (with Truth Hierarchy, Conflict Rules, and Workflow)
    // =============================================
    buildSystemPrompt(retrievedContext = '') {
        const constraintsSection = this.memory.constraints.length > 0
            ? `\n[BATASAN UTAMA (CONSTRAINTS) - WAJIB DITURUTI]:\n${this.memory.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
            : '';
        const preferencesSection = this.memory.preferences.length > 0
            ? `\n[PREFERENSI PENGGUNA (PREFERENCES) - DIUTAMAKAN]:\n${this.memory.preferences.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
            : '';
        const activeDecisions = this.getActiveDecisions();
        const decisionsSection = activeDecisions.length > 0
            ? `\n[KEPUTUSAN DESAIN & ARSITEKTUR AKTIF (ACTIVE DECISIONS)]:\n${activeDecisions.map((d, i) => `${i + 1}. [${d.topic}] → ${d.value}`).join('\n')}`
            : '';
        const taskSection = `\n[STATUS PROYEK AKTIF (TASK STATUS)]:
- Selesai / Pencapaian (Milestones):
${this.memory.milestones.length > 0 ? this.memory.milestones.map(t => `  * ${t}`).join('\n') : '  * Belum ada'}
- Temuan Teknis Penting (Findings):
${this.memory.findings.length > 0 ? this.memory.findings.map(t => `  * ${t}`).join('\n') : '  * Belum ada'}
- Peta Arsitektur Komponen (Architecture):
${this.memory.architecture.length > 0 ? this.memory.architecture.map(t => `  * ${t}`).join('\n') : '  * Belum ada'}`;
        const topicSection = `\n[TOPIK AKTIF SAAT INI]:
Judul: ${this.activeTopic.title}
Ringkasan: ${this.activeTopic.summary}`;
        const retrievalSection = retrievedContext
            ? `\n${retrievedContext}`
            : '';
        return `Anda adalah asisten koding AI profesional yang sangat ahli dan membantu.
Lokasi kerja Anda saat ini (CWD) adalah: ${this.cwd}

ATURAN PERILAKU UTAMA:
1. Selalu berbicara dalam Bahasa Indonesia dengan nada santai namun tetap profesional dan sopan.
2. Gunakan tool 'list_files' untuk melihat isi folder jika Anda belum tahu apa isi project ini.
3. EFISIENSI TOKEN: Selalu prioritaskan penggunaan 'grep_search' untuk mencari bagian kode yang relevan. Gunakan 'read_file' dengan parameter 'start_line' dan 'end_line' untuk membaca bagian yang diperlukan saja. JANGAN membaca seluruh isi file kecuali benar-benar diperlukan.
4. Sebelum melakukan perubahan pada file (write_file, delete_file), Anda WAJIB menjelaskan secara singkat apa yang akan Anda lakukan dan meminta konfirmasi dari pengguna.
5. Gunakan tool 'update_topic' secara berkala jika fokus atau topik pengerjaan Anda berubah untuk memberikan visualisasi progress yang jelas bagi pengguna.
6. PENCARIAN WEB (web_search): Anda MEMILIKI akses internet nyata melalui tool 'web_search'. Anda WAJIB memanggil tool 'web_search' setiap kali pengguna meminta informasi real-time, kurs mata uang terkini (seperti USD ke IDR), berita, atau informasi luar yang tidak ada di workspace lokal Anda. Jangan berasumsi, menebak, atau menggunakan database internal Anda untuk informasi dinamis.
7. KEJUJURAN MUTLAK: Anda dilarang keras membuat alasan palsu, berbohong, atau berdalih (seperti mengarang alasan "koneksi internet lambat", "masalah VPS", atau "kebijakan akses") ketika Anda lupa memanggil tool atau ketika tool mengalami kegagalan. Jika Anda lupa/salah langkah, akui dengan jujur. Jika tool mengalami error, katakan sejujurnya apa error yang diterima dari tool.

SUMBER INFORMASI UTAMA & PRIORITAS:
1. BATASAN UTAMA (CONSTRAINTS) - Wajib dipatuhi secara mutlak.
2. KEPUTUSAN DESAIN & ARSITEKTUR AKTIF (ACTIVE DECISIONS) - Kebijakan arsitektur yang disepakati.
3. WORKSPACE REALITY (Kondisi Nyata Workspace) - Kondisi aktual kode di file system.
4. HISTORICAL CLUES (Petunjuk Historis) - Informasi / memori dari percakapan masa lalu.
5. RECENT CONVERSATION (Percakapan Terakhir) - Konteks obrolan terbaru.

ATURAN PENANGANAN KONFLIK:
- Jika MEMORI (Petunjuk Historis) bertentangan dengan WORKSPACE REALITY: Gunakan WORKSPACE REALITY (kode nyata yang menang).
- Jika ACTIVE DECISION bertentangan dengan MEMORI: Gunakan ACTIVE DECISION.
- Jika CONSTRAINTS bertentangan dengan REQUEST USER: Utamakan CONSTRAINTS dan tolak request user secara sopan disertai penjelasan batasannya.

LANGKAH BERPIKIR SAAT MENERIMA PERINTAH (WORKFLOW):
Saat menerima perintah coding dari pengguna, Anda WAJIB mengikuti langkah berikut secara berurutan:
1. IDENTIFIKASI TOPIK: Tentukan topik utama tugas.
2. PERIKSA CONSTRAINTS & PREFERENCES: Pastikan tidak ada batasan yang dilanggar.
3. PERIKSA ACTIVE DECISIONS: Pastikan arsitektur selaras dengan keputusan desain aktif.
4. RETRIEVE WORKSPACE: Cari file workspace yang relevan (gunakan grep_search/list_files).
5. VERIFIKASI ASUMSI: Baca isi file workspace (read_file) untuk memastikan petunjuk historis/asumsi Anda selaras dengan kode nyata.
6. EKSEKUSI PERUBAHAN: Lakukan perubahan kode setelah melakukan verifikasi menyeluruh.

---
[INFORMASI MEMORI PROYEK (DIPERBARUI DINAMIS)]
${constraintsSection}
${preferencesSection}
${decisionsSection}
${taskSection}
${topicSection}
${retrievalSection}
---`;
    }
    // =============================================
    // COMPLIANCE & TELEMETRY DETECTORS
    // =============================================
    checkRuleBasedViolations(output, toolCalls = []) {
        const violatedConstraints = [];
        const violatedDecisions = [];
        const lowerOutput = output.toLowerCase();
        const combinedToolsContent = toolCalls.map(tc => JSON.stringify(tc).toLowerCase()).join(' ');
        const checkText = lowerOutput + ' ' + combinedToolsContent;
        // 1. Check Constraints (Rule-based)
        for (const constraint of this.memory.constraints) {
            const lowerConstraint = constraint.toLowerCase();
            const negations = ['jangan', 'dilarang', 'tidak boleh', 'avoid', 'dont', "don't", 'do not', 'no '];
            const hasNegation = negations.some(neg => lowerConstraint.includes(neg));
            if (hasNegation) {
                const stopwords = new Set([
                    'jangan', 'dilarang', 'tidak', 'boleh', 'gunakan', 'pakai', 'buat', 'membuat', 'melakukan',
                    'avoid', 'dont', 'don\'t', 'do', 'not', 'use', 'using', 'create', 'make', 'perform',
                    'dengan', 'dan', 'atau', 'di', 'ke', 'dari', 'yang', 'untuk', 'pada', 'adalah',
                    'with', 'and', 'or', 'in', 'to', 'from', 'that', 'for', 'on', 'is', 'a', 'the'
                ]);
                const words = lowerConstraint.split(/[^a-zA-Z0-9]/).filter(w => w.length > 2 && !stopwords.has(w));
                for (const word of words) {
                    if (checkText.includes(word)) {
                        violatedConstraints.push(constraint);
                        break;
                    }
                }
            }
        }
        // 2. Check Active Decisions (Heuristic)
        const activeDecisions = this.getActiveDecisions();
        for (const decision of activeDecisions) {
            const lowerTopic = decision.topic.toLowerCase();
            const lowerValue = decision.value.toLowerCase();
            if (checkText.includes(lowerTopic)) {
                if (lowerValue.includes('cookie') && checkText.includes('jwt') && !checkText.includes('cookie')) {
                    violatedDecisions.push(decision.topic);
                }
                else if (lowerValue.includes('jwt') && checkText.includes('cookie') && !checkText.includes('jwt')) {
                    violatedDecisions.push(decision.topic);
                }
                else if (lowerValue.includes('postgres') && checkText.includes('mongodb') && !checkText.includes('postgres')) {
                    violatedDecisions.push(decision.topic);
                }
            }
        }
        return { violatedConstraints, violatedDecisions };
    }
    saveViolationSnapshot(userInput, output, violations) {
        try {
            const debugDir = path.join(this.cwd, '.kila-debug');
            if (!fs.existsSync(debugDir)) {
                fs.mkdirSync(debugDir, { recursive: true });
            }
            const timestamp = Date.now();
            const snapshotPath = path.join(debugDir, `snapshot_${timestamp}.json`);
            const total = Object.values(this.metrics.lastTokenBreakdown).reduce((a, b) => a + b, 0) || 1;
            const breakdownPercent = {
                base: `${((this.metrics.lastTokenBreakdown.base / total) * 100).toFixed(1)}%`,
                constraints: `${((this.metrics.lastTokenBreakdown.constraints / total) * 100).toFixed(1)}%`,
                preferences: `${((this.metrics.lastTokenBreakdown.preferences / total) * 100).toFixed(1)}%`,
                decisions: `${((this.metrics.lastTokenBreakdown.decisions / total) * 100).toFixed(1)}%`,
                status: `${((this.metrics.lastTokenBreakdown.status / total) * 100).toFixed(1)}%`,
                retrievedMemories: `${((this.metrics.lastTokenBreakdown.retrievedMemories / total) * 100).toFixed(1)}%`,
                workspaceFiles: `${((this.metrics.lastTokenBreakdown.workspaceFiles / total) * 100).toFixed(1)}%`,
                history: `${((this.metrics.lastTokenBreakdown.history / total) * 100).toFixed(1)}%`
            };
            const snapshot = {
                timestamp: new Date(timestamp).toISOString(),
                userInput,
                output,
                promptSize: total,
                promptBreakdown: this.metrics.lastTokenBreakdown,
                promptBreakdownPercent: breakdownPercent,
                violations,
                retrievedMemories: this.lastRetrievedMemories.map(m => ({ id: m.id, content: m.content, tags: m.tags })),
                workspaceFiles: this.lastRetrievedWorkspaceFiles,
                fullPromptHistory: this.history
            };
            fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
            console.log(chalk.red(`\n  [telemetry] DETECTED VIOLATION! Debug snapshot saved to ${chalk.underline(path.relative(this.cwd, snapshotPath))}`));
        }
        catch (e) {
            console.log(chalk.red(`\n  [telemetry] Failed to save violation snapshot: ${e.message}`));
        }
    }
    // =============================================
    // TOOL OUTPUT COMPRESSION (Pola 1)
    // =============================================
    async summarizeLargeToolOutput(toolName, output) {
        process.stdout.write(chalk.gray(`  [compressing large output of ${toolName}...] `));
        try {
            const summaryRes = await fetch(`${this.serverUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        {
                            role: 'user',
                            content: `Berikut adalah output yang sangat besar dari tool "${toolName}". Tolong buatkan ringkasan detail dan komprehensif berupa poin-poin penting dari output ini dengan mempertahankan struktur dan kode penting agar tidak kehilangan informasi berharga (maksimal 60 baris).

Output Asli:
${output.substring(0, 80000)} ... (sisa output dipotong)`
                        }
                    ]
                }),
            });
            if (!summaryRes.ok)
                throw new Error('Koneksi server gagal');
            const { taskId } = await summaryRes.json();
            let data = null;
            while (true) {
                const statusRes = await fetch(`${this.serverUrl}/status/${taskId}`);
                const statusData = await statusRes.json();
                if (statusData.status === 'completed') {
                    data = statusData.data;
                    break;
                }
                else if (statusData.status === 'error')
                    throw new Error(statusData.error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            const summary = data.message.content;
            process.stdout.write('\r\x1b[K');
            return `[OUTPUT TERKOMPRESI - Tool ${toolName}]
${summary}

[Catatan: Output asli sangat besar (${output.length} karakter) dan telah diringkas untuk menghemat memori.]`;
        }
        catch (error) {
            process.stdout.write('\r\x1b[K');
            return `[OUTPUT DIPOTONG - Gagal Kompresi: ${error.message}]
${output.substring(0, 8000)}

... [Sisa output ${output.length - 8000} karakter dipotong karena terlalu besar]`;
        }
    }
    // =============================================
    // TOKEN BUDGET PRUNING (Pola 4)
    // =============================================
    pruneHistoryToBudget(tokenBudget = 20000) {
        let accumulatedTokens = 0;
        const pruned = [];
        for (let i = this.history.length - 1; i >= 1; i--) {
            const msgTokens = Math.ceil(JSON.stringify(this.history[i]).length / 3.8);
            if (accumulatedTokens + msgTokens > tokenBudget)
                break;
            accumulatedTokens += msgTokens;
            pruned.unshift(this.history[i]);
        }
        this.history = [this.history[0], ...pruned];
    }
    // =============================================
    // MEMORY RETRIEVAL LAYER (RAG Lokal + Workspace)
    // =============================================
    retrieveMemories(userMessage) {
        const cleanAndSplit = (text) => {
            return text.toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(word => word.length > 2);
        };
        const userWords = cleanAndSplit(userMessage);
        const topicWords = cleanAndSplit(`${this.activeTopic.title} ${this.activeTopic.summary}`);
        let contextWords = [];
        if (this.history.length > 2) {
            const lastMsg = this.history[this.history.length - 1];
            const secondLastMsg = this.history[this.history.length - 2];
            contextWords = cleanAndSplit(`${lastMsg.content || ''} ${secondLastMsg.content || ''}`);
        }
        const queryWords = Array.from(new Set([...userWords, ...topicWords, ...contextWords]));
        // Telemetry increment query count
        this.metrics.retrievalQueries++;
        // ---- Bagian 1: Retrieve dari memoryStore ----
        const scoreEntry = (entry) => {
            let matchScore = 0;
            entry.tags.forEach(tag => {
                if (queryWords.includes(tag.toLowerCase()))
                    matchScore += 3;
            });
            entry.keywords.forEach(kw => {
                if (queryWords.includes(kw.toLowerCase()))
                    matchScore += 1.5;
            });
            const contentWords = cleanAndSplit(entry.content);
            queryWords.forEach(qw => {
                if (contentWords.includes(qw))
                    matchScore += 0.5;
            });
            const daysSinceAccess = (Date.now() - entry.lastAccessed) / (1000 * 60 * 60 * 24);
            const recencyScore = 1 / (1 + daysSinceAccess);
            const frequencyScore = Math.min(entry.usageCount / 10, 1.0);
            const baseLLMScore = entry.importance / 10;
            const finalScore = matchScore * (baseLLMScore * 0.5 + recencyScore * 0.2 + frequencyScore * 0.3);
            return finalScore;
        };
        let scoredEntries = this.memoryStore
            .map(entry => ({ entry, finalScore: scoreEntry(entry) }))
            .filter(se => se.finalScore > 0.1)
            .sort((a, b) => b.finalScore - a.finalScore);
        if (scoredEntries.length < 2 && this.archivedMemories.length > 0) {
            const archivedScored = this.archivedMemories
                .map(entry => ({ entry, finalScore: scoreEntry(entry) }))
                .filter(se => se.finalScore > 0.3)
                .sort((a, b) => b.finalScore - a.finalScore)
                .slice(0, 2);
            for (const as of archivedScored) {
                this.archivedMemories = this.archivedMemories.filter(m => m.id !== as.entry.id);
                as.entry.lastAccessed = Date.now();
                this.memoryStore.push(as.entry);
                scoredEntries.push(as);
            }
            scoredEntries.sort((a, b) => b.finalScore - a.finalScore);
        }
        const selectedEntries = [];
        const tagCounts = new Map();
        const maxPerTag = 2;
        for (const match of scoredEntries) {
            const entry = match.entry;
            let tagLimitReached = false;
            for (const tag of entry.tags) {
                const count = tagCounts.get(tag.toLowerCase()) || 0;
                if (count >= maxPerTag) {
                    tagLimitReached = true;
                    break;
                }
            }
            if (tagLimitReached)
                continue;
            selectedEntries.push(entry);
            entry.tags.forEach(tag => {
                const count = tagCounts.get(tag.toLowerCase()) || 0;
                tagCounts.set(tag.toLowerCase(), count + 1);
            });
        }
        let currentTokens = 0;
        const budgetLimitTokens = 6000;
        const finalMemories = [];
        for (const entry of selectedEntries) {
            const entryTokens = Math.ceil(entry.content.length / 3.8);
            if (currentTokens + entryTokens > budgetLimitTokens)
                break;
            currentTokens += entryTokens;
            finalMemories.push(entry);
            entry.usageCount++;
            entry.lastAccessed = Date.now();
        }
        this.lastRetrievedMemories = [...finalMemories];
        if (finalMemories.length > 0) {
            this.metrics.retrievalHits++;
            // Record tags in telemetry
            for (const entry of finalMemories) {
                for (const tag of entry.tags) {
                    const normTag = tag.toLowerCase().trim();
                    this.metrics.retrievedTags[normTag] = (this.metrics.retrievedTags[normTag] || 0) + 1;
                }
            }
            this.lastRetrievedMemoriesText = `[MEMORI RELEVAN YANG DIPANGGIL KEMBALI (PETUNJUK HISTORIS)]:\n` +
                finalMemories
                    .map((entry, idx) => `[Petunjuk Historis #${idx + 1}] (Tags: ${entry.tags.join(', ')}):\n- ${entry.content}\n*(Catatan: Ini adalah petunjuk historis masa lalu. Selalu verifikasi kebenaran ini dengan kode nyata di workspace sebelum mengambil keputusan)*`)
                    .join('\n\n');
        }
        else {
            this.lastRetrievedMemoriesText = '';
        }
        // ---- Bagian 2: Retrieve dari Workspace Index (Layer E) ----
        const workspaceText = this.retrieveWorkspaceFiles(queryWords);
        if (workspaceText) {
            this.lastRetrievedWorkspaceText = `[WORKSPACE FILES YANG RELEVAN]:\n${workspaceText}`;
            this.metrics.workspaceRetrieved += this.lastRetrievedWorkspaceFiles.length;
        }
        else {
            this.lastRetrievedWorkspaceText = '';
        }
        return (this.lastRetrievedMemoriesText || this.lastRetrievedWorkspaceText)
            ? `${this.lastRetrievedMemoriesText}\n\n${this.lastRetrievedWorkspaceText}`
            : '';
    }
    // =============================================
    // DYNAMIC SUMMARIZATION, EXTRACTION & EVALUATION
    // =============================================
    async runDynamicSummarization(lastUserInput, lastResponse, lastToolCalls = []) {
        process.stdout.write(chalk.gray(`  [memory: mengekstrak fakta dan memadatkan memori...] `));
        const extractionContext = this.fullHistory.slice(-40);
        const activeDecisionsStr = JSON.stringify(this.getActiveDecisions().map(d => ({ topic: d.topic, value: d.value })));
        const constraintsStr = JSON.stringify(this.memory.constraints);
        const retrievedMemoriesStr = JSON.stringify(this.lastRetrievedMemories.map(m => ({ id: m.id, content: m.content })));
        try {
            const summaryRes = await fetch(`${this.serverUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        ...extractionContext,
                        {
                            role: 'user',
                            content: `Analisis percakapan terakhir kita, terutama respon terakhir dari asisten:
Response Asli:
"${lastResponse}"

Tool calls yang dipanggil asisten pada turn terakhir:
${JSON.stringify(lastToolCalls, null, 2)}

Berikut adalah batasan dan keputusan aktif saat ini:
CONSTRAINTS:
${constraintsStr}

ACTIVE DECISIONS:
${activeDecisionsStr}

RETRIEVED MEMORIES YANG DISUNTIKKAN:
${retrievedMemoriesStr}

Tugas Anda adalah mengekstrak memori baru ke dalam JSON valid. Format respons Anda HARUS berupa JSON valid tanpa penjelasan tambahan:
{
  "constraints": ["tambahan batasan baru jika ada"],
  "preferences": ["tambahan preferensi baru jika ada"],
  "activeDecisions": [
    { "topic": "topik", "value": "nilai baru" }
  ],
  "milestones": ["milestones terupdate"],
  "findings": ["temuan terupdate"],
  "architecture": ["arsitektur terupdate"],
  "newEpisodes": [
    {
      "content": "fakta episode baru",
      "tags": ["tag1", "tag2"],
      "keywords": ["kw1", "kw2"],
      "importance": 9
    }
  ],
  "constraintViolations": ["Batasan dari CONSTRAINTS di atas yang dilanggar asisten di turn terakhir. Biarkan array kosong jika tidak ada pelanggaran."],
  "decisionViolations": ["Topic dari ACTIVE DECISIONS di atas yang nilainya dilanggar asisten di turn terakhir. Biarkan array kosong jika tidak ada pelanggaran."],
  "retrievedMemoriesUtilized": ["ID dari RETRIEVED MEMORIES di atas yang benar-benar digunakan/membantu asisten mengambil keputusan atau menulis kode."],
  "retrievedMemoriesMentioned": ["ID dari RETRIEVED MEMORIES di atas yang sempat disebutkan dalam teks respon tetapi tidak benar-benar memandu keputusan atau penulisan kode."]
}`
                        }
                    ]
                }),
            });
            if (!summaryRes.ok)
                throw new Error('Gagal menghubungi server untuk memadatkan memori');
            const { taskId } = await summaryRes.json();
            let data = null;
            while (true) {
                const statusRes = await fetch(`${this.serverUrl}/status/${taskId}`);
                const statusData = await statusRes.json();
                if (statusData.status === 'completed') {
                    data = statusData.data;
                    break;
                }
                else if (statusData.status === 'error')
                    throw new Error(statusData.error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            const rawContent = data.message.content;
            try {
                const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    const accumulateList = (oldList, newList) => {
                        const set = new Set([...oldList, ...(newList || [])]);
                        return Array.from(set);
                    };
                    this.memory.constraints = accumulateList(this.memory.constraints, parsed.constraints);
                    this.memory.preferences = accumulateList(this.memory.preferences, parsed.preferences);
                    if (parsed.activeDecisions && Array.isArray(parsed.activeDecisions)) {
                        for (const dec of parsed.activeDecisions) {
                            if (dec.topic && dec.value) {
                                const existing = this.activeDecisions.find(d => d.active && d.topic.toLowerCase().trim() === dec.topic.toLowerCase().trim());
                                if (existing && existing.value.toLowerCase().trim() !== dec.value.toLowerCase().trim()) {
                                    this.metrics.decisionConflicts = (this.metrics.decisionConflicts || 0) + 1;
                                }
                                this.addOrUpdateDecision(dec.topic, dec.value);
                            }
                        }
                    }
                    this.memory.milestones = parsed.milestones || [];
                    this.memory.findings = parsed.findings || [];
                    this.memory.architecture = parsed.architecture || [];
                    if (parsed.newEpisodes && Array.isArray(parsed.newEpisodes)) {
                        parsed.newEpisodes.forEach((ep) => {
                            const importance = typeof ep.importance === 'number' ? ep.importance : 5;
                            const content = ep.content || '';
                            const tags = Array.isArray(ep.tags) ? ep.tags : [];
                            const keywords = Array.isArray(ep.keywords) ? ep.keywords : [];
                            if (content.length > 5) {
                                const exists = this.memoryStore.some(m => m.content.toLowerCase() === content.toLowerCase());
                                if (!exists) {
                                    this.memoryStore.push({
                                        id: Math.random().toString(36).substring(7),
                                        content,
                                        tags,
                                        keywords,
                                        importance,
                                        timestamp: Date.now(),
                                        lastAccessed: Date.now(),
                                        usageCount: 0
                                    });
                                }
                            }
                        });
                    }
                    // === TELEMETRI INTEGRASI (Level 1 + Level 2) ===
                    // Level 1: Rule-based violations check
                    const ruleViolations = this.checkRuleBasedViolations(lastResponse, lastToolCalls);
                    // Level 2: LLM semantic violations
                    const llmConstraintViolations = parsed.constraintViolations || [];
                    const llmDecisionViolations = parsed.decisionViolations || [];
                    // Gabungkan
                    const finalConstraintViolations = Array.from(new Set([...ruleViolations.violatedConstraints, ...llmConstraintViolations]));
                    const finalDecisionViolations = Array.from(new Set([...ruleViolations.violatedDecisions, ...llmDecisionViolations]));
                    if (finalConstraintViolations.length > 0) {
                        this.metrics.constraintViolationsCount += finalConstraintViolations.length;
                    }
                    if (finalDecisionViolations.length > 0) {
                        this.metrics.decisionViolationsCount += finalDecisionViolations.length;
                        for (const dec of finalDecisionViolations) {
                            const normDec = dec.toLowerCase().trim();
                            this.metrics.violatedDecisions[normDec] = (this.metrics.violatedDecisions[normDec] || 0) + 1;
                        }
                    }
                    if (finalConstraintViolations.length > 0 || finalDecisionViolations.length > 0) {
                        const allViolations = [
                            ...finalConstraintViolations.map(c => `Constraint: "${c}"`),
                            ...finalDecisionViolations.map(d => `Decision Topic: "${d}"`)
                        ];
                        this.saveViolationSnapshot(lastUserInput, lastResponse, allViolations);
                    }
                    // Klasifikasi Pemanfaatan Memori (Mention vs Utilized)
                    const llmUtilized = new Set(parsed.retrievedMemoriesUtilized || []);
                    const llmMentioned = new Set(parsed.retrievedMemoriesMentioned || []);
                    const lowerResponseCombined = (lastResponse + ' ' + JSON.stringify(lastToolCalls)).toLowerCase();
                    for (const mem of this.lastRetrievedMemories) {
                        const isLLMUtilized = llmUtilized.has(mem.id);
                        const isLLMMentioned = llmMentioned.has(mem.id);
                        const cleanTerms = [...mem.tags, ...mem.keywords].map(t => t.toLowerCase().trim());
                        const hasKeywordMatch = cleanTerms.some(term => term.length > 2 && lowerResponseCombined.includes(term));
                        if (isLLMUtilized) {
                            this.metrics.retrievalUtilized++;
                        }
                        else if (isLLMMentioned || hasKeywordMatch) {
                            this.metrics.retrievalMentioned++;
                        }
                    }
                    this.metrics.totalTurns++;
                }
            }
            catch (parseError) {
                // Ignore parsing errors
            }
            // Memory Decay
            const dayInMs = 1000 * 60 * 60 * 24;
            const toArchive = [];
            this.memoryStore = this.memoryStore.filter(entry => {
                const daysUnused = (Date.now() - entry.lastAccessed) / dayInMs;
                if (daysUnused > 7 && entry.importance < 5 && entry.usageCount === 0) {
                    toArchive.push(entry);
                    return false;
                }
                return true;
            });
            this.archivedMemories.push(...toArchive);
            if (this.archivedMemories.length > 100) {
                this.archivedMemories = this.archivedMemories
                    .sort((a, b) => b.importance - a.importance)
                    .slice(0, 100);
            }
            if (toArchive.length > 0) {
                console.log(chalk.gray(`  [memory] ${toArchive.length} memori dipindahkan ke archive.`));
            }
            this.history[0].content = this.buildSystemPrompt();
            this.pruneHistoryToBudget(20000);
            // Save metrics after every turn
            this.saveMetrics();
            process.stdout.write('\r\x1b[K');
            console.log(chalk.green(`  [memory] Long-term memory, telemetry, decisions & memory store updated.`));
        }
        catch (error) {
            process.stdout.write('\r\x1b[K');
            console.log(chalk.red(`\n  [memory] Gagal memadatkan memori: ${error.message}`));
        }
    }
    // =============================================
    // PUBLIC METHODS
    // =============================================
    async summarize() {
        await this.runDynamicSummarization('Manual Summary Request', 'No response available', []);
        const activeD = this.getActiveDecisions();
        const superseded = this.activeDecisions.filter(d => !d.active);
        return `CONSTRAINTS:
${this.memory.constraints.map(c => `  - ${c}`).join('\n') || '  - Tidak ada'}

PREFERENCES:
${this.memory.preferences.map(p => `  - ${p}`).join('\n') || '  - Tidak ada'}

ACTIVE DECISIONS:
${activeD.map(d => `  - [${d.topic}] → ${d.value}`).join('\n') || '  - Tidak ada'}

SUPERSEDED DECISIONS:
${superseded.map(d => `  - [${d.topic}] → ${d.value} (digantikan)`).join('\n') || '  - Tidak ada'}

TASK STATUS:
  - Milestones: ${this.memory.milestones.join(', ') || 'Belum ada'}
  - Findings: ${this.memory.findings.join(', ') || 'Belum ada'}
  - Architecture: ${this.memory.architecture.join(', ') || 'Belum ada'}

MEMORY STORE (${this.memoryStore.length} aktif, ${this.archivedMemories.length} archived):
${this.memoryStore.map(m => `  * [${m.importance}/10] ${m.content} (Tags: ${m.tags.join(', ')})`).join('\n') || '  * Kosong'}

WORKSPACE INDEX: ${this.workspaceIndex.length} files indexed`;
    }
    getQuota() {
        const totalChars = JSON.stringify(this.history).length;
        const estimatedTokens = Math.ceil(totalChars / 3.8);
        const limit = this.hardLimit;
        const percentage = ((estimatedTokens / limit) * 100).toFixed(2);
        return { totalChars, estimatedTokens, limit, percentage };
    }
    estimateTokens(text) {
        return Math.ceil(text.length / 3.8);
    }
    // =============================================
    // DASHBOARD RENDERERS
    // =============================================
    getDashboard() {
        const metrics = this.metrics;
        const recallRate = metrics.retrievalQueries > 0
            ? Math.round((metrics.retrievalHits / metrics.retrievalQueries) * 100)
            : 0;
        const utilRate = metrics.retrievalHits > 0
            ? Math.round((metrics.retrievalUtilized / metrics.retrievalHits) * 100)
            : 0;
        const workspaceRecall = metrics.workspaceRetrieved > 0
            ? Math.round((metrics.workspaceOpened / metrics.workspaceRetrieved) * 100)
            : 0;
        const workspaceUtil = metrics.workspaceOpened > 0
            ? Math.round((metrics.workspaceUsed / metrics.workspaceOpened) * 100)
            : 0;
        const avgPromptSize = metrics.tokenHistory.length > 0
            ? Math.round(metrics.tokenHistory.reduce((sum, entry) => sum + entry.tokens, 0) / metrics.tokenHistory.length)
            : 0;
        const progressBar = (percentage, char = '█', size = 20) => {
            const filledSize = Math.round((percentage / 100) * size);
            const emptySize = size - filledSize;
            const filled = char.repeat(filledSize);
            const empty = '░'.repeat(emptySize);
            let color = chalk.green;
            if (percentage < 40)
                color = chalk.red;
            else if (percentage < 75)
                color = chalk.yellow;
            return color(`[${filled}${empty}] ${percentage}%`);
        };
        const breakdown = metrics.lastTokenBreakdown;
        const totalPrompt = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1;
        const getPercent = (val) => Math.round((val / totalPrompt) * 100);
        const barSegment = (label, value, colorFn) => {
            const pct = getPercent(value);
            const barLength = Math.max(1, Math.round(pct / 5));
            const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
            return `${colorFn(`  ${label.padEnd(20)} : [${bar}] ${pct}% (${value} t)`)}`;
        };
        const topTags = Object.entries(metrics.retrievedTags)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([tag, count]) => `  - ${tag} (${count}x)`)
            .join('\n') || '  - (None yet)';
        const topViolations = Object.entries(metrics.violatedDecisions)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([topic, count]) => `  - ${topic} (${count}x)`)
            .join('\n') || '  - (None yet)';
        let ui = '\n';
        ui += chalk.bold.blue('====================================================\n');
        ui += chalk.bold.blue('              KILA CLI AGENT HEALTH & TELEMETRY     \n');
        ui += chalk.bold.blue('====================================================\n\n');
        ui += chalk.bold.yellow('=== RETRIEVAL & MEMORY HEALTH ===\n');
        ui += `  Retrieval Recall       : ${progressBar(recallRate)}\n`;
        ui += `  Retrieval Utilization  : ${progressBar(utilRate)}\n`;
        ui += `  Memory Store Size      : ${chalk.cyan(this.memoryStore.length)} active, ${chalk.cyan(this.archivedMemories.length)} archived\n\n`;
        ui += chalk.bold.yellow('=== WORKSPACE OBSERVABILITY ===\n');
        ui += `  Workspace Recall       : ${progressBar(workspaceRecall)} (Opened/Retrieved)\n`;
        ui += `  Workspace Utilization  : ${progressBar(workspaceUtil)} (Used/Opened)\n`;
        ui += `  Files Retrieved        : ${chalk.cyan(metrics.workspaceRetrieved)} total\n`;
        ui += `  Files Opened (Read)    : ${chalk.cyan(metrics.workspaceOpened)}\n`;
        ui += `  Files Used (Written)   : ${chalk.cyan(metrics.workspaceUsed)}\n\n`;
        ui += chalk.bold.yellow('=== COMPLIANCE & VIOLATIONS ===\n');
        const cViolColor = metrics.constraintViolationsCount > 0 ? chalk.red : chalk.green;
        const dViolColor = metrics.decisionViolationsCount > 0 ? chalk.red : chalk.green;
        const dConflicts = metrics.decisionConflicts || 0;
        ui += `  Constraint Violations  : ${cViolColor(metrics.constraintViolationsCount)}\n`;
        ui += `  Decision Violations    : ${dViolColor(metrics.decisionViolationsCount)}\n`;
        ui += `  Decision Conflicts     : ${chalk.cyan(dConflicts)}\n\n`;
        ui += chalk.bold.yellow('=== PROMPT TOKEN ANALYSIS ===\n');
        ui += `  Last Prompt Total Size : ${chalk.cyan(totalPrompt)} tokens\n`;
        ui += `  Avg Prompt (Last 20)   : ${chalk.cyan(avgPromptSize)} tokens\n`;
        ui += chalk.gray('  Composition Breakdown (Last Turn):\n');
        ui += barSegment('Base Rules', breakdown.base, chalk.gray) + '\n';
        ui += barSegment('Constraints', breakdown.constraints, chalk.red) + '\n';
        ui += barSegment('Preferences', breakdown.preferences, chalk.magenta) + '\n';
        ui += barSegment('Active Decisions', breakdown.decisions, chalk.blue) + '\n';
        ui += barSegment('Task & Topic Status', breakdown.status, chalk.yellow) + '\n';
        ui += barSegment('Retrieved Memories', breakdown.retrievedMemories, chalk.cyan) + '\n';
        ui += barSegment('Workspace Index', breakdown.workspaceFiles, chalk.green) + '\n';
        ui += barSegment('Conversation History', breakdown.history, chalk.white) + '\n\n';
        ui += chalk.bold.yellow('=== TOP RETRIEVED TAGS ===\n');
        ui += topTags + '\n\n';
        ui += chalk.bold.yellow('=== TOP VIOLATED DECISIONS ===\n');
        ui += topViolations + '\n\n';
        ui += chalk.bold.blue('====================================================\n');
        return ui;
    }
    resetDashboard() {
        this.metrics = {
            totalTurns: 0,
            retrievalQueries: 0,
            retrievalHits: 0,
            retrievalMentioned: 0,
            retrievalUtilized: 0,
            workspaceRetrieved: 0,
            workspaceOpened: 0,
            workspaceUsed: 0,
            constraintViolationsCount: 0,
            decisionViolationsCount: 0,
            decisionConflicts: 0,
            tokenHistory: [],
            retrievedTags: {},
            violatedDecisions: {},
            lastTokenBreakdown: {
                base: 0,
                constraints: 0,
                preferences: 0,
                decisions: 0,
                status: 0,
                retrievedMemories: 0,
                workspaceFiles: 0,
                history: 0
            }
        };
        this.saveMetrics();
        return chalk.green('  [telemetry] Dashboard metrics successfully reset.');
    }
    exportDashboard() {
        try {
            const timestamp = Date.now();
            const exportPath = path.join(this.cwd, `kila-eval-export_${timestamp}.json`);
            fs.writeFileSync(exportPath, JSON.stringify(this.metrics, null, 2), 'utf8');
            return chalk.green(`  [telemetry] Metrics exported successfully to ${chalk.underline(path.relative(this.cwd, exportPath))}`);
        }
        catch (e) {
            return chalk.red(`  [telemetry] Failed to export metrics: ${e.message}`);
        }
    }
    formatContent(content) {
        return content
            .replace(/(`[^`]+`)/g, (match) => purple(match))
            .replace(/(\*\*[^*]+\*\*)/g, (match) => purple(match));
    }
    showDiff(diffPath, newContent) {
        let oldContent = '';
        try {
            if (fs.existsSync(diffPath)) {
                oldContent = fs.readFileSync(diffPath, 'utf8');
            }
        }
        catch (e) { }
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        let added = 0;
        let removed = 0;
        let diffLines = [];
        if (oldContent === newContent) {
            return { added: 0, removed: 0, diffLines: [chalk.gray('      (No changes)')] };
        }
        if (oldContent) {
            oldLines.forEach((line, i) => {
                if (!newLines.includes(line)) {
                    diffLines.push(chalk.red(`      ${i + 1} - ${line}`));
                    removed++;
                }
            });
        }
        newLines.forEach((line, i) => {
            if (!oldLines.includes(line)) {
                diffLines.push(chalk.green(`      ${i + 1} + ${line}`));
                added++;
            }
        });
        return { added, removed, diffLines };
    }
    // =============================================
    // MAIN CHAT LOOP
    // =============================================
    async chat(userMessage) {
        let images = [];
        let cleanedMessage = userMessage;
        // Reset turn-based file tracking sets
        this.workspaceOpenedThisTurn.clear();
        this.workspaceUsedThisTurn.clear();
        const imageRegex = /([a-zA-Z]:\\[^:<>|"?*]+\.(png|jpg|jpeg))|(\/[^:<>|"?*]+\.(png|jpg|jpeg))/gi;
        const matches = userMessage.match(imageRegex);
        if (matches) {
            for (const match of matches) {
                const filePath = match.trim();
                if (fs.existsSync(filePath)) {
                    try {
                        process.stdout.write(chalk.gray(`  [image: reading ${path.basename(filePath)}...] `));
                        const bitmap = fs.readFileSync(filePath);
                        const base64 = Buffer.from(bitmap).toString('base64');
                        images.push(base64);
                        cleanedMessage = cleanedMessage.replace(match, `[Image: ${path.basename(filePath)}]`);
                    }
                    catch (e) {
                        console.log(chalk.red(`\n  Gagal membaca gambar: ${filePath}`));
                    }
                }
            }
            process.stdout.write('\r\x1b[K');
        }
        const userEntry = { role: 'user', content: cleanedMessage };
        if (images.length > 0) {
            userEntry.images = images;
        }
        this.history.push(userEntry);
        this.fullHistory.push(userEntry);
        // 1. RAG lokal + Workspace Retrieval
        const retrievedContext = this.retrieveMemories(cleanedMessage);
        // 2. Suntikkan ke System Prompt
        this.history[0].content = this.buildSystemPrompt(retrievedContext);
        // 3. Hitung Token Breakdown sebelum dikirim ke server
        const baseSectionTokens = this.estimateTokens(this.buildSystemPrompt(''));
        const constraintsSectionTokens = this.estimateTokens(this.memory.constraints.length > 0 ? this.memory.constraints.join('\n') : '');
        const preferencesSectionTokens = this.estimateTokens(this.memory.preferences.length > 0 ? this.memory.preferences.join('\n') : '');
        const decisionsSectionTokens = this.estimateTokens(this.getActiveDecisions().map(d => `${d.topic} -> ${d.value}`).join('\n'));
        const statusSectionTokens = this.estimateTokens(this.memory.milestones.join(' ') + this.memory.findings.join(' ') + this.memory.architecture.join(' ') + this.activeTopic.title + this.activeTopic.summary);
        const retrievedMemoriesTokens = this.estimateTokens(this.lastRetrievedMemoriesText);
        const workspaceFilesTokens = this.estimateTokens(this.lastRetrievedWorkspaceText);
        const historyTokens = this.estimateTokens(JSON.stringify(this.history.slice(1)));
        const totalSystemPromptTokens = baseSectionTokens + constraintsSectionTokens + preferencesSectionTokens + decisionsSectionTokens + statusSectionTokens + retrievedMemoriesTokens + workspaceFilesTokens;
        const totalPromptTokens = totalSystemPromptTokens + historyTokens;
        this.metrics.lastTokenBreakdown = {
            base: baseSectionTokens,
            constraints: constraintsSectionTokens,
            preferences: preferencesSectionTokens,
            decisions: decisionsSectionTokens,
            status: statusSectionTokens,
            retrievedMemories: retrievedMemoriesTokens,
            workspaceFiles: workspaceFilesTokens,
            history: historyTokens
        };
        // Store token history with timestamp (object as requested in note)
        this.metrics.tokenHistory.push({
            timestamp: Date.now(),
            tokens: totalPromptTokens
        });
        if (this.metrics.tokenHistory.length > 20) {
            this.metrics.tokenHistory.shift();
        }
        // 4. Dual-Guardrail Token Check
        const currentQuota = this.getQuota();
        if (currentQuota.estimatedTokens > this.hardLimit) {
            console.log(chalk.yellow(`\n  [warning] Token melebihi Hard Limit (${currentQuota.estimatedTokens}/${this.hardLimit}). Memotong paksa.`));
            this.pruneHistoryToBudget(20000);
        }
        else if (currentQuota.estimatedTokens > this.softLimit) {
            await this.runDynamicSummarization(cleanedMessage, 'Token soft-limit exceeded', []);
            const updatedContext = this.retrieveMemories(cleanedMessage);
            this.history[0].content = this.buildSystemPrompt(updatedContext);
        }
        const toolCallsThisTurn = [];
        while (true) {
            process.stdout.write(chalk.gray(`  [thinking: ${this.model}] `));
            try {
                const initRes = await fetch(`${this.serverUrl}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: this.model,
                        messages: this.history
                    }),
                });
                if (!initRes.ok)
                    throw new Error(`VPS Error: ${await initRes.text()}`);
                const { taskId } = await initRes.json();
                let data = null;
                while (true) {
                    const statusRes = await fetch(`${this.serverUrl}/status/${taskId}`);
                    if (!statusRes.ok)
                        throw new Error(`Polling Error: ${await statusRes.text()}`);
                    const statusData = await statusRes.json();
                    if (statusData.status === 'completed') {
                        data = statusData.data;
                        break;
                    }
                    else if (statusData.status === 'error') {
                        throw new Error(statusData.error);
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                process.stdout.write('\r\x1b[K');
                const message = data.message;
                this.history.push(message);
                this.fullHistory.push(message);
                if (message.tool_calls && message.tool_calls.length > 0) {
                    toolCallsThisTurn.push(...message.tool_calls);
                    for (const toolCall of message.tool_calls) {
                        const toolName = toolCall.function.name;
                        const args = toolCall.function.arguments;
                        if (toolName === 'update_topic') {
                            console.log(`\n  ${chalk.bold(args.title)}:`);
                            console.log(`  ${chalk.gray(args.summary)}\n`);
                            this.activeTopic = { title: args.title, summary: args.summary };
                            this.history[0].content = this.buildSystemPrompt(retrievedContext);
                            const toolEntry = { role: 'tool', content: 'Topic updated', tool_call_id: toolCall.id };
                            this.history.push(toolEntry);
                            this.fullHistory.push(toolEntry);
                            continue;
                        }
                        const tool = tools.find((t) => t.name === toolName);
                        if (tool) {
                            const icon = '✓';
                            const displayName = toolName.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
                            let detail = '';
                            if (toolName === 'read_file') {
                                const range = (args.start_line || args.end_line) ? `#L${args.start_line || 1}-${args.end_line || ''}` : '';
                                detail = `${chalk.cyan(args.path)}${chalk.yellow(range)}`;
                            }
                            else if (toolName === 'web_search') {
                                detail = chalk.yellow(`"${args.query}"`);
                            }
                            else if (toolName === 'grep_search') {
                                detail = `${chalk.yellow(`/${args.pattern}/`)} in ${chalk.cyan(args.path)}`;
                            }
                            else if (toolName === 'run_command') {
                                detail = chalk.gray(`$ ${args.command}`);
                            }
                            else {
                                detail = chalk.cyan(args.path || args.command || args.pattern || args.query || '');
                            }
                            // Workspace observability path monitoring
                            if (args.path) {
                                try {
                                    const absolutePath = path.resolve(this.cwd, args.path);
                                    const relativePath = path.relative(this.cwd, absolutePath).replace(/\\/g, '/');
                                    if (this.lastRetrievedWorkspaceFiles.includes(relativePath)) {
                                        if (toolName === 'read_file' && !this.workspaceOpenedThisTurn.has(relativePath)) {
                                            this.workspaceOpenedThisTurn.add(relativePath);
                                            this.metrics.workspaceOpened++;
                                        }
                                        else if (toolName === 'write_file' && !this.workspaceUsedThisTurn.has(relativePath)) {
                                            this.workspaceUsedThisTurn.add(relativePath);
                                            this.metrics.workspaceUsed++;
                                        }
                                    }
                                }
                                catch (e) {
                                    // Ignore resolving errors
                                }
                            }
                            if (toolName === 'write_file') {
                                const { added, removed, diffLines } = this.showDiff(args.path, args.content);
                                console.log(`  ${chalk.green(icon)}  ${chalk.bold(displayName)}  ${chalk.cyan(args.path)} → ${chalk.green(`Accepted (+${added}, -${removed})`)}`);
                                console.log('');
                                diffLines.forEach(line => console.log(line));
                                console.log('');
                            }
                            else {
                                console.log(`  ${chalk.green(icon)}  ${chalk.bold(displayName)}  ${detail}`);
                            }
                            let result = await tool.execute(args);
                            if (result && result.length > 24000) {
                                result = await this.summarizeLargeToolOutput(toolName, result);
                            }
                            const toolEntry = {
                                role: 'tool',
                                content: result,
                                tool_call_id: toolCall.id,
                            };
                            this.history.push(toolEntry);
                            this.fullHistory.push(toolEntry);
                        }
                    }
                    continue;
                }
                this.history.forEach(msg => {
                    if (msg.role === 'user' && msg.images) {
                        delete msg.images;
                        msg.content += ' (Data gambar telah dihapus dari memori untuk menghemat kuota)';
                    }
                });
                // Run dynamic summarization, episodic memory consolidation, and telemetry evaluation at the end of the turn
                await this.runDynamicSummarization(cleanedMessage, message.content, toolCallsThisTurn);
                return this.formatContent(message.content);
            }
            catch (error) {
                return `Error: ${error.message}`;
            }
        }
    }
}
