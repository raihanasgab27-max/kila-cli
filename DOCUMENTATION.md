# KILA CLI - Remote AI Code Assistant via Home Bridge
## Dokumentasi Lengkap & Teknis

---

## 📋 Daftar Isi
1. [Ringkasan Proyek](#ringkasan-proyek)
2. [Arsitektur Sistem](#arsitektur-sistem)
3. [Komponen-Komponen Utama](#komponen-komponen-utama)
4. [Cara Kerja / Workflow](#cara-kerja--workflow)
5. [Setup & Network](#setup--network)
6. [Konfigurasi](#konfigurasi)
7. [Memory & Context Management](#memory--context-management)
8. [Fitur-Fitur](#fitur-fitur)
9. [Tools & Capabilities](#tools--capabilities)
10. [Token Management & Budget](#token-management--budget)
11. [Telemetry & Monitoring](#telemetry--monitoring)
12. [Cara Menjalankan](#cara-menjalankan)

---

## 🎯 Ringkasan Proyek

**KILA CLI** adalah aplikasi AI Code Assistant yang dirancang untuk memberikan bantuan coding real-time via CLI (Command Line Interface). Proyek ini menggunakan arsitektur terdistribusi dengan tiga komponen utama:

- **Client**: CLI lokal di PC user
- **Bridge**: Server proxy publik (port 3123)
- **Server (VPS)**: Brain center dengan Ollama LLM

Tujuan: Memberikan asisten coding AI yang powerful, dengan manajemen memori konteks yang canggih, dan constraint/decision tracking untuk konsistensi jangka panjang.

**Tech Stack:**
- **Runtime**: Node.js (TypeScript + ts-node)
- **CLI Framework**: Commander.js
- **LLM**: Ollama (locally deployed)
- **Web Server**: Express.js
- **Search**: DuckDuckGo, Tavily, Google-It
- **Web Scraping**: duck-duck-scrape
- **Validation**: Zod
- **UI**: Chalk (colored terminal output)
- **Interactive**: Prompts (user input)

---

## 🏗️ Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                         INTERNET                             │
└──────────────┬──────────────────────────────┬────────────────┘
               │                              │
        ┌──────▼────────────────────────┐    │
        │  BRIDGE (Public URL)           │    │
        │  https://kila-cli.iantly.com   │    │
        │  Port: 3123                    │    │
        │  192.168.1.139:3123 (Local)    │    │
        └──────┬────────────────────────┘    │
               │                              │
    ┌──────────┴──────────┐                  │
    │                     │                  │
┌───▼──────────┐   ┌──────▼────────────┐    │
│  CLIENT      │   │  SERVER (VPS)      │    │
│  (Home PC)   │   │  Port: 3000        │    │
│              │   │  With Ollama LLM   │    │
│ KILA CLI     │◄──┤  & Tool Execution  │    │
│              │   │  + Web Search      │    │
│              │   │  + Polling Queue   │    │
└──────────────┘   └────────────────────┘    │
       ▲                                       │
       │                                       │
       └───────────────────────────────────────┘
       (Dapat juga koneksi lokal jika di network yang sama)
```

### Alur Komunikasi:
1. **Client** mengirim pesan ke **Bridge** (URL + port tunggal)
2. **Bridge** mem-proxy request ke **Server** (VPS)
3. **Server** memproses dengan Ollama LLM
4. **Server** menjalankan tools (web_search, read_file, etc.)
5. **Server** mengembalikan taskId ke Client
6. **Client** melakukan polling ke Server untuk status
7. Saat `status === 'completed'`, Client menerima response

---

## 🔧 Komponen-Komponen Utama

### 1. **CLIENT** (`client/` directory)

#### `client/index.ts` - CLI Entry Point
```
Fungsi:
- CLI interface dengan Commander.js
- User input loop dengan prompts.js
- Parse options: --url (Bridge URL), --model (Ollama model)

Default Values:
- URL: http://192.168.1.139:3123
- Model: Qwopus3.5:9b

Features:
- Interactive chat loop
- Special commands (/exit, /quit, /ringkas, /quota, /dashboard)
- Formatted output dengan Chalk (colored text)

Keluaran UI:
┌────────────────────────────────────────┐
│ KILA CLI - REMOTE AI BRIDGE             │
│ STATUS: Connected to http://...         │
│ MODEL: Qwopus3.5:9b                     │
└────────────────────────────────────────┘
>> [user input]

AI
[response dari server]
```

#### `client/agent.ts` - Core Intelligence & Memory Management
```
Bertanggung Jawab:
- Koneksi ke Server via HTTP
- Memory management (episodic, decision versioning)
- Token budget tracking & pruning
- Workspace file indexing & retrieval (Layer E)
- Tool execution & output handling
- Telemetry & metrics collection
- Image attachment support

Komponen Utama:

1. MEMORY LAYERS:
   - Constraints: Batasan yang WAJIB dipatuhi
   - Preferences: Preferensi user yang diutamakan
   - Active Decisions: Keputusan desain arsitektur
   - Milestones: Task yang sudah selesai
   - Findings: Temuan teknis penting
   - Architecture: Peta arsitektur komponen
   - Memory Store: Episodic memories (RAG lokal)
   - Archived Memories: Memories yang aged out

2. DECISION VERSIONING:
   - Setiap decision punya ID unik
   - Supersedes: Track keputusan lama yang digantikan
   - Active flag: Hanya keputusan aktif yang diteruskan

3. WORKSPACE RETRIEVAL (Layer E):
   - Index file dari workspace (exclude node_modules, .git, dist)
   - Tag-based retrieval berdasarkan filename & path
   - Scoring: Match pada tags, path words
   - Max 5 files per query

4. TOKEN BUDGET:
   - softLimit: 20000 tokens
   - hardLimit: 28000 tokens
   - Token breakdown tracking (base, constraints, preferences, etc)
   - Auto-pruning saat exceed

5. TELEMETRY METRICS:
   - retrieval recall rate (retrieval hits / queries)
   - retrieval utilization rate (utilized / hits)
   - workspace recall & utilization
   - constraint & decision violations
   - token history tracking
   - top retrieved tags & violated decisions

6. DYNAMIC SUMMARIZATION:
   - Setiap turn, LLM menganalisis & mengekstrak memori
   - Mengupdate memory store dengan episodic memories baru
   - Memory decay: Archive memori yang unused > 7 days
```

### 2. **SERVER** (`server/` directory)

#### `server/index.ts` - VPS Brain Center
```
Fungsi:
- Express.js server untuk menerima chat request
- LLM processing dengan Ollama
- Tool execution (server-side)
- Task queue management
- Auto-registration ke Bridge

Key Features:

1. ENDPOINT: /chat (POST)
   - Input: { model, messages }
   - Output: { taskId }
   - Process: Asynchronous (fire & forget)
   - Flow:
     * Register task dengan status 'processing'
     * Chat dengan Ollama LLM
     * Jika ada tool_calls, execute di server
     * Loop hingga response tanpa tool_calls
     * Save result dengan status 'completed' atau 'error'

2. ENDPOINT: /status/:taskId (GET)
   - Input: taskId
   - Output: { status, data?, error? }
   - Behavior: Auto-delete task setelah retrieval

3. SERVER TOOLS:
   - web_search: DuckDuckGo → Tavily → Google (fallback chain)

4. AUTO-REPORT ke Bridge:
   - Coba deteksi URL otomatis dari Cloudflared metrics API
   - POST ke bridge /register dengan { url, secret }
   - Fallback: --report flag untuk manual URL

5. ENVIRONMENT VARIABLES:
   - PORT: Server port (default 3000)
   - TAVILY_API_KEY: API key untuk Tavily search
   - BRIDGE_URL: Bridge URL (default https://kila-cli.iantly.com)
   - BRIDGE_SECRET: Secret key untuk auth ke Bridge
```

#### `server/bridge.ts` - Proxy Layer
```
Fungsi:
- Express.js middleware untuk routing
- Port: 3123 (default)
- Bind ke 0.0.0.0 (semua interface)

Key Features:

1. ENDPOINT: /register (POST)
   - Input: { url, secret }
   - Validate secret
   - Store remoteTunnelUrl untuk routing

2. ENDPOINT: /chat (POST)
   - Proxy ke remoteTunnelUrl/chat
   - Return response langsung atau error

3. ENDPOINT: /status/:taskId (GET)
   - Proxy ke remoteTunnelUrl/status/:taskId

4. URL TRACKING:
   - remoteTunnelUrl: URL tunnel dari Server (Colab)
   - Stored di memory saat register

5. LOGGING:
   - Chalk colored logs
   - IP/port info pada startup
   - Public URL: https://kila-cli.iantly.com
   - Local URL: http://192.168.1.139:3123
```

#### `server/tool-schemas.ts` - Tool Definitions
```
Define tool schemas untuk LLM (OpenAI function calling format)

Tools:
1. update_topic
   - Update current task topic untuk progress visibility
   
2. read_file
   - path (required)
   - start_line (optional)
   - end_line (optional)
   
3. grep_search
   - pattern (required, regex)
   - path (required, directory)
   - include (optional, file pattern)
   
4. write_file
   - path (required)
   - content (required)
   
5. run_command
   - command (required)
   
6. list_files
   - path (required)
   
7. web_search
   - query (required)
```

#### `server/tools.ts` - Tool Implementation
```
Implement tool execution di server

Setiap tool:
- Name & description
- Zod schema untuk validation
- Execute function

Implementasi:
- read_file: fs.readFileSync dengan line slicing
- grep_search: execSync grep command, limit 50 results
- write_file: Create dir & write file
- list_files: fs.readdirSync
- run_command: execSync
```

### 3. **LOCAL/SRC** (`src/` directory)

#### `src/index.ts` - Local-Only Agent
```
Alternatif untuk testing tanpa VPS
- Sama dengan client/index.ts tapi buat local agent
- Support ollama lokal
```

#### `src/agent.ts` - Simplified Local Agent
```
Versi simplified dari client/agent.ts
- Hanya untuk testing lokal
- Support tools execution lokal
```

#### `src/tools.ts` - Local Tool Definitions
```
Tool schemas & implementation untuk local
```

#### `src/test-tools.ts` - Testing
```
(Tidak dijelaskan di awal, perlu explore)
```

---

## 🔄 Cara Kerja / Workflow

### Saat User Mengetik Pesan:

```
1. USER INPUT
   >> "Buatkan fungsi reverse string"

2. CLIENT PREPROCESSING
   ├─ Extract gambar (jika ada)
   ├─ Tambah ke this.history
   └─ Token budget check

3. MEMORY RETRIEVAL (RAG)
   ├─ Clean message jadi keywords
   ├─ Score episodic memories berdasarkan:
   │  ├─ Tag match (weight 3.0)
   │  ├─ Keyword match (weight 1.5)
   │  ├─ Content match (weight 0.5)
   │  ├─ Recency score (1 / (1 + daysUnused))
   │  └─ Frequency score (usageCount / 10)
   ├─ Retrieve workspace files (tag-based matching)
   └─ Select hingga budget 4500 tokens

4. SYSTEM PROMPT BUILDING
   Gabung:
   ├─ Base rules (Bahasa Indonesia, behavior)
   ├─ Constraints section
   ├─ Preferences section
   ├─ Active Decisions section
   ├─ Task status (milestones, findings, architecture)
   ├─ Current topic
   ├─ Retrieved memories
   └─ Workspace files

5. SEND TO SERVER
   POST /chat {
     model: "Qwopus3.5:9b",
     messages: [
       { role: 'system', content: '...' },
       { role: 'user', content: '...' },
       ... history ...
     ]
   }
   
   Response: { taskId: "abc123" }

6. POLLING LOOP
   ├─ GET /status/abc123
   ├─ If status === 'processing': wait 1s, retry
   ├─ If status === 'completed': break
   └─ If status === 'error': throw

7. LLM RESPONSE PROCESSING
   ├─ Extract message.content
   ├─ Check message.tool_calls
   │  ├─ If no tool_calls: Return response
   │  └─ If tool_calls:
   │     ├─ For each toolCall:
   │     │  ├─ Execute tool (read_file, web_search, etc)
   │     │  ├─ Display tool output
   │     │  ├─ Compress output jika > 16000 chars
   │     │  └─ Add ke history dengan role: 'tool'
   │     └─ Loop kembali ke LLM dengan tool results

8. DYNAMIC SUMMARIZATION & CONSOLIDATION
   ├─ Send ke server untuk LLM analysis
   ├─ LLM extract:
   │  ├─ New constraints & preferences
   │  ├─ Updated active decisions
   │  ├─ New episodic memories
   │  ├─ Constraint violations detected
   │  └─ Decision violations detected
   ├─ Update memory store
   ├─ Memory decay (archive unused)
   ├─ Save metrics (.kila-eval.json)
   └─ Prune history ke budget

9. RETURN RESPONSE TO USER
   Formatted dengan:
   ├─ Purple color untuk backticks & bold
   ├─ Newlines untuk readability
   └─ Status dari tools (✓ checkmark)
```

### Command Khusus:

```
/exit, /quit
→ Keluar dari CLI

/ringkas
→ Run dynamic summarization & display all memory

/quota
→ Display token usage:
   Usage: X,XXX / 12,000 characters
   Status: YY% (red/yellow/green)

/dashboard
→ Display comprehensive telemetry:
   - Retrieval recall & utilization
   - Workspace observability
   - Compliance & violations
   - Prompt token analysis
   - Top retrieved tags
   - Top violated decisions

/dashboard reset
→ Reset semua metrics ke 0

/dashboard export
→ Export metrics ke JSON file
```

---

## 🌐 Setup & Network

### Network Architecture:

```
┌─────────────────────────────────────────────┐
│           Internet / Public Network          │
│  https://kila-cli.iantly.com (Public URL)   │
└────────────────────┬────────────────────────┘
                     │
        ┌────────────▼───────────┐
        │    BRIDGE SERVER       │
        │  192.168.1.139:3123    │
        │  (Local Home Network)  │
        └────────────┬───────────┘
                     │
        ┌────────────▼───────────┐
        │   SERVER (VPS/Colab)   │
        │   localhost:3000       │
        │   With Ollama          │
        └───────────────────────┘
                     ▲
                     │ (polling /status)
        ┌────────────▼───────────┐
        │   CLIENT (Home PC)     │
        │  http://192.168.1.139  │
        │  :3123                 │
        │                        │
        │  KILA CLI (TypeScript) │
        └────────────────────────┘
```

### IP Addresses & Ports:

```
BRIDGE:
  - Local: http://192.168.1.139:3123
  - Public: https://kila-cli.iantly.com
  - Bind: 0.0.0.0:3123

SERVER (VPS):
  - Local: http://localhost:3000 (dari VPS perspective)
  - Tunnel: Via Cloudflare
  - Auto-detect: localhost:45333 (Cloudflared metrics)

CLIENT:
  - Default connect to: http://192.168.1.139:3123
  - Can override: kila --url <custom_url>
```

### Environment Setup:

```bash
# .env file (di server atau VPS)

PORT=3000
TAVILY_API_KEY=your_api_key_here
BRIDGE_URL=https://kila-cli.iantly.com
BRIDGE_SECRET=kila-secret-key
```

### Running Architecture:

```bash
# Terminal 1: Server (VPS/Colab)
npm run server
# Listen pada port 3000
# Auto-register ke Bridge

# Terminal 2: Bridge (Home Network)
npm run bridge
# Listen pada port 3123
# Wait untuk server registration

# Terminal 3: Client (Home PC)
npm run client
# Or: kila --url http://192.168.1.139:3123 --model Qwopus3.5:9b
```

---

## ⚙️ Konfigurasi

### package.json Scripts:

```json
{
  "scripts": {
    "client": "node --loader ts-node/esm client/index.ts",
    "server": "node --loader ts-node/esm server/index.ts",
    "bridge": "node --loader ts-node/esm server/bridge.ts",
    "build": "tsc"
  }
}
```

### tsconfig.json:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*", "client/**/*", "server/**/*"]
}
```

### Client CLI Options:

```bash
kila --url <url> --model <model>

Options:
  -u, --url <url>      Bridge URL (default: http://192.168.1.139:3123)
  -m, --model <model>  Ollama model (default: Qwopus3.5:9b)

Examples:
  kila
  kila --url http://192.168.1.139:3123
  kila --url https://kila-cli.iantly.com --model mistral:latest
  kila -m neural-chat:latest
```

---

## 🧠 Memory & Context Management

### Memory Layers (5-Layer Architecture):

```
LAYER A: BASE RULES (Behavior & Constraints)
  └─ System prompt rules
  └─ Bahasa Indonesia
  └─ Token efficiency rules
  └─ Workspace reality > historical memory

LAYER B: STRUCTURED MEMORY (Imut / Append-Only)
  ├─ constraints: Batasan WAJIB dipatuhi
  ├─ preferences: Preferensi user
  ├─ milestones: Task selesai
  ├─ findings: Temuan teknis
  └─ architecture: Peta komponen

LAYER C: DECISION VERSIONING & VERSIONING
  ├─ activeDecisions: Keputusan desain saat ini
  ├─ supersedes: Track penggantian keputusan
  │  └─ Resolusi konflik otomatis
  └─ active flag: Track status keputusan

LAYER D: EPISODIC MEMORY STORE (RAG Lokal)
  ├─ memoryStore: Episodic memories aktif
  ├─ archivedMemories: Aged out memories
  └─ Scoring system:
     ├─ Tag match (weight 3.0)
     ├─ Keyword match (weight 1.5)
     ├─ Content match (weight 0.5)
     ├─ Recency score: 1 / (1 + daysSinceAccess)
     ├─ Frequency score: min(usageCount / 10, 1.0)
     └─ Importance score: (1-10)

LAYER E: WORKSPACE RETRIEVAL (File Indexing)
  ├─ Workspace indexing (exclude node_modules, .git, dist)
  ├─ File tagging berdasarkan path & filename
  ├─ Tag-based scoring & retrieval
  └─ Max 5 files per query
```

### Memory Entry Structure:

```typescript
interface MemoryEntry {
  id: string;              // Random ID
  content: string;         // Fact/knowledge
  tags: string[];          // Auto-extracted dari path
  keywords: string[];      // Manual keywords
  importance: number;      // 1-10 (set oleh LLM)
  timestamp: number;       // Created time
  lastAccessed: number;    // Last retrieval time
  usageCount: number;      // How many times used
}
```

### Decision Versioning:

```typescript
interface Decision {
  id: string;           // Unique ID
  topic: string;        // e.g., "API Authentication"
  value: string;        // e.g., "JWT with cookies"
  supersedes?: string;  // Previous decision ID
  timestamp: number;
  active: boolean;      // false jika sudah digantikan
}
```

### Memory Decay:

```
Rule:
- Jika unused > 7 days
- AND importance < 5
- AND usageCount === 0
→ Archive ke archivedMemories

Max archived: 100
  (Sort by importance, keep top 100)

Revival:
- Jika less than 2 matches dalam active store
- Take top 2 dari archived & restore
```

### Token Budget Strategy:

```
softLimit: 8000 tokens
hardLimit: 12000 tokens

Check at each turn:
├─ If > hardLimit:
│  └─ Force prune (aggressive)
└─ If > softLimit:
   └─ Run dynamic summarization
      └─ Consolidate memories
      └─ Prune gently

Token estimation: length / 3.8
```

### Token Breakdown Tracking:

```
lastTokenBreakdown {
  base: system prompt base
  constraints: constraints section
  preferences: preferences section
  decisions: active decisions section
  status: milestones + findings + architecture
  retrievedMemories: episodic memories text
  workspaceFiles: workspace files text
  history: conversation history
}

Display: Histogram dengan percentage
```

---

## 🎯 Fitur-Fitur

### 1. Remote Code Assistant
```
- Chat dengan LLM via network
- Support tool calling (function calling)
- Tool execution di server (web_search)
- Support image attachment
```

### 2. Advanced Memory Management
```
- Episodic memory store dengan scoring
- Decision versioning dengan conflict resolution
- Memory decay dengan archival system
- Constraint & preference tracking
```

### 3. Workspace Awareness
```
- Auto-index workspace files
- Tag-based file retrieval
- Workspace observability metrics
- File opened/used tracking
```

### 4. Token Management
```
- Soft & hard limits
- Auto-pruning & summarization
- Token breakdown analysis
- Token history tracking
```

### 5. Telemetry & Compliance
```
- Constraint violation detection (rule-based & LLM semantic)
- Decision violation tracking
- Retrieval recall & utilization metrics
- Comprehensive dashboard visualization
```

### 6. Tool Execution
```
- read_file (dengan line range support)
- write_file (dengan diff display)
- grep_search (recursive regex)
- run_command (shell execution)
- list_files
- web_search (multi-provider fallback)
- update_topic (progress tracking)
```

### 7. Interactive CLI
```
- Colored output dengan Chalk
- Progress indicators
- Real-time tool execution display
- Special commands (/quota, /dashboard, /ringkas)
- Image attachment support
```

### 8. Memory Consolidation
```
- Dynamic summarization setiap turn
- LLM-powered memory extraction
- Automatic memory store updates
- Violation snapshot saving
```

---

## 🛠️ Tools & Capabilities

### Tool: `update_topic`
```
Usage: automatic (LLM decides)
Purpose: Update current task topic untuk UI display

Parameters:
  title: string     (task title)
  summary: string   (brief summary)

Example:
  LLM auto-call: {
    "name": "update_topic",
    "arguments": {
      "title": "Implementing Authentication",
      "summary": "Adding JWT-based auth to API endpoints"
    }
  }

Display:
  >> Implementing Authentication:
     Adding JWT-based auth to API endpoints
```

### Tool: `read_file`
```
Parameters:
  path: string        (required, relative or absolute)
  start_line: number  (optional, 1-based)
  end_line: number    (optional, 1-based)

Examples:
  read_file path="src/index.ts"
  read_file path="src/utils.ts" start_line="1" end_line="50"

Output:
  [Showing lines 1 to 50 of 120]
  ... file content ...

Observability:
  - Tracked untuk workspace metrics
```

### Tool: `write_file`
```
Parameters:
  path: string    (required)
  content: string (required)

Features:
  - Auto-create directories
  - Show diff (added/removed lines)
  - Workspace usage tracking

Example Output:
  ✓ WriteFile src/new-feature.ts → Accepted (+15, -0)
       1 + export function newFeature() {
       2 +   return "hello";
       3 + }
```

### Tool: `grep_search`
```
Parameters:
  pattern: string  (required, regex)
  path: string     (required, directory)
  include: string  (optional, file pattern like "*.ts")

Features:
  - Recursive search
  - Limit 50 results
  - Regex support

Example:
  grep_search pattern="function.*test" path="src" include="*.ts"

Output:
  src/tests.ts:15: function testFeature() {
  src/utils.ts:42: function testHelper() {
  ...
```

### Tool: `list_files`
```
Parameters:
  path: string (required, directory path)

Output:
  file1.ts
  file2.ts
  subfolder/
  ...
```

### Tool: `run_command`
```
Parameters:
  command: string (required, shell command)

Features:
  - execSync execution
  - Can chain commands dengan ;

Example:
  run_command command="npm install && npm test"

Note:
  - Long-running commands bisa timeout
  - Better untuk quick operations
```

### Tool: `web_search`
```
Parameters:
  query: string (required, search query)

Fallback Chain:
  1. Try DuckDuckGo (primary)
  2. Try Tavily (jika API key ada)
  3. Try Google Search (last resort)

Output:
  Title: ...
  URL: ...
  Description: ...

Features:
  - Max 5 results
  - Server-side execution
```

---

## 📊 Token Management & Budget

### Token Estimation:
```
Formula: Math.ceil(text.length / 3.8)

Contoh:
  "Hello world" (11 chars) → 3 tokens
  System prompt (5000 chars) → 1316 tokens
```

### Budget Layers:

```
HARD LIMIT: 28,000 tokens
  - If exceeded: Aggressive force prune
  - Prune ke 16000 tokens

SOFT LIMIT: 20,000 tokens
  - If exceeded: Run dynamic summarization
  - Consolidate memories
  - Prune gently

RETRIEVAL BUDGET: 4,500 tokens
  - Max untuk episodic memories
  - Max untuk workspace files
```

### Token Breakdown Per Turn:

```
lastTokenBreakdown {
  base: rules + behavior section
  constraints: CONSTRAINTS section
  preferences: PREFERENCES section
  decisions: ACTIVE DECISIONS section
  status: TASK STATUS section
  retrievedMemories: retrieved episodic memories
  workspaceFiles: retrieved workspace files
  history: conversation history (tidak termasuk system)
}

Display di /dashboard:
  Base Rules           : [████░░░░░░░░░░░░░░] 20% (315 t)
  Constraints          : [██░░░░░░░░░░░░░░░░] 10% (158 t)
  Preferences          : [█░░░░░░░░░░░░░░░░░] 5% (79 t)
  ...
  Total Last Prompt    : 1,580 tokens
  Avg Prompt (Last 20) : 1,420 tokens
```

### Pruning Strategy:

```
When > softLimit:
  1. Extract & consolidate episodic memories
  2. Archive old/unused memories
  3. Remove oldest history entries
  4. Keep: system prompt + last N turns

When > hardLimit:
  1. Keep only: system + last 2 turns
  2. Force aggressive prune
  3. Save consolidated summary untuk next turn
```

---

## 📈 Telemetry & Monitoring

### Metrics Struktur:

```typescript
interface EvalMetrics {
  // Conversation stats
  totalTurns: number;
  
  // Retrieval stats
  retrievalQueries: number;        // Total queries
  retrievalHits: number;           // Queries dengan hasil
  retrievalMentioned: number;      // Memories disebutkan tapi tidak digunakan
  retrievalUtilized: number;       // Memories benar-benar digunakan
  
  // Workspace stats
  workspaceRetrieved: number;      // Files suggested
  workspaceOpened: number;         // Files actually read
  workspaceUsed: number;           // Files actually written
  
  // Compliance stats
  constraintViolationsCount: number;
  decisionViolationsCount: number;
  decisionConflicts: number;
  
  // Token history
  tokenHistory: { timestamp, tokens }[];
  
  // Usage maps
  retrievedTags: Record<string, number>;
  violatedDecisions: Record<string, number>;
  
  // Breakdown
  lastTokenBreakdown: {
    base, constraints, preferences, decisions, 
    status, retrievedMemories, workspaceFiles, history
  };
}
```

### Dashboard Display:

```
KILA CLI AGENT HEALTH & TELEMETRY

=== RETRIEVAL & MEMORY HEALTH ===
  Retrieval Recall       : [████████░░░░░░░░░░] 85%
  Retrieval Utilization  : [██████░░░░░░░░░░░░] 60%
  Memory Store Size      : 24 active, 5 archived

=== WORKSPACE OBSERVABILITY ===
  Workspace Recall       : [████████████░░░░░░] 78%
  Workspace Utilization  : [███████░░░░░░░░░░░] 45%
  Files Retrieved        : 42 total
  Files Opened (Read)    : 31
  Files Used (Written)   : 8

=== COMPLIANCE & VIOLATIONS ===
  Constraint Violations  : 0
  Decision Violations    : 1
  Decision Conflicts     : 0

=== PROMPT TOKEN ANALYSIS ===
  Last Prompt Total Size : 4,320 tokens
  Avg Prompt (Last 20)   : 3,850 tokens
  Composition Breakdown (Last Turn):
    Base Rules           : [██░░░░░░░░░░░░░░░░] 12% (400 t)
    Constraints          : [█░░░░░░░░░░░░░░░░░] 8% (260 t)
    Preferences          : [░░░░░░░░░░░░░░░░░░] 3% (100 t)
    ...

=== TOP RETRIEVED TAGS ===
  - function (12x)
  - async (8x)
  - api (5x)

=== TOP VIOLATED DECISIONS ===
  - None yet
```

### Violation Detection (2-Level):

```
Level 1: RULE-BASED (Heuristic)
  - Extract negation words dari constraints
  - Check jika output contains prohibited terms
  - Quick & lightweight

Level 2: LLM SEMANTIC (Setiap turn)
  - LLM analyze response secara semantik
  - Check lebih dalam untuk constraint violations
  - Detect decision value conflicts
  - More accurate tapi slower

Both combined:
  - deduplicate results
  - save violation snapshot
  - track metrics
```

### Violation Snapshot:

```
Saved to: .kila-debug/snapshot_<timestamp>.json

Contains:
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "userInput": "...",
  "output": "...",
  "promptSize": 4320,
  "promptBreakdown": { ... },
  "violations": ["Constraint: ...", "Decision Topic: ..."],
  "retrievedMemories": [{ id, content, tags }],
  "workspaceFiles": ["path1", "path2"],
  "fullPromptHistory": [...]
}
```

---

## 🚀 Cara Menjalankan

### Prerequisites:
```bash
- Node.js 18+
- npm / yarn
- Ollama installed & running (untuk server)
- Git (optional)
```

### Installation:

```bash
# Clone atau navigate ke project
cd kila-cli

# Install dependencies
npm install

# Compile TypeScript (optional, ts-node handles it)
npm run build
```

### Running (3-Terminal Setup):

#### Terminal 1: Server (VPS/Colab/Local)
```bash
npm run server
# atau dengan custom port:
PORT=3001 npm run server

# Output:
# AI Brain Server (VPS) running on port 3000
# Waiting for instructions from PC...
# [Bridge] Mencari URL tunnel otomatis...
# [Bridge] Terdeteksi URL: https://...
# [Bridge] Registrasi Berhasil!
```

#### Terminal 2: Bridge (Home Network)
```bash
npm run bridge

# Output:
# KILA BRIDGE - MIDDLE SERVER
# STATUS: Bridge berjalan di port 3123
# LOCAL: http://192.168.1.139:3123
# PUBLIC: https://kila-cli.iantly.com
```

#### Terminal 3: Client (Home PC)
```bash
# Basic
npm run client

# Dengan custom URL
npm run client -- --url http://192.168.1.139:3123

# Dengan custom model
npm run client -- --model mistral:latest

# Combined
npm run client -- --url http://192.168.1.139:3123 --model neural-chat

# Output:
# KILA CLI - REMOTE AI BRIDGE
# ================================================
# STATUS: Connected to http://192.168.1.139:3123
# MODEL: Qwopus3.5:9b
# ================================================
# 
# >> [awaiting input]
```

### Local Testing (Single Terminal):

```bash
# Run local agent (no server/bridge needed)
npm run client src/index.ts

# Uses local Ollama directly
```

### Building for Production:

```bash
# Compile all TypeScript
npm run build

# Creates dist/ folder with .js files

# Run compiled version:
node dist/server/index.js
node dist/server/bridge.js
node dist/client/index.js
```

### CLI Binary Usage:

```bash
# Setup bin script di package.json:
"bin": {
  "kila": "./dist/client/index.js"
}

# After build & npm link:
npm link
kila --url http://192.168.1.139:3123
```

### Environment Variables (.env):

```bash
# Server side
PORT=3000
TAVILY_API_KEY=tvly-...

# Bridge side
BRIDGE_SECRET=kila-secret-key
BRIDGE_URL=https://kila-cli.iantly.com

# Load dengan dotenv
dotenv.config()
```

### Debugging:

```bash
# Enable verbose logging (modify chalk logs)
# Check debug snapshots
ls .kila-debug/

# View metrics
cat .kila-eval.json

# Export metrics
>> /dashboard export
```

---

## 📋 File Structure Lengkap

```
kila-cli/
├── package.json          # Dependencies & scripts
├── tsconfig.json         # TypeScript config
├── .env                  # Environment variables
├── .gitignore
│
├── client/               # CLI CLIENT
│   ├── index.ts         # Entry point & CLI interface
│   └── agent.ts         # Core agent with memory management
│
├── server/              # VPS SERVER
│   ├── index.ts         # Chat server & tool execution
│   ├── bridge.ts        # Proxy middleware (port 3123)
│   ├── tool-schemas.ts  # Tool definitions for LLM
│   └── tools.ts         # Tool implementations
│
├── src/                 # LOCAL (for testing)
│   ├── index.ts         # Local CLI entry
│   ├── agent.ts         # Local agent (simplified)
│   ├── tools.ts         # Local tool definitions
│   └── test-tools.ts
│
├── dist/                # Compiled output (after npm run build)
│   ├── client/
│   ├── server/
│   └── src/
│
└── Documentation Files:
    ├── DOCUMENTATION.md  # This file
    └── README.md         # Quick start (if exists)
```

---

## 🔐 Security & Best Practices

### Security Considerations:

```
1. BRIDGE_SECRET
   - Protect API key untuk register ke bridge
   - Stored di .env (JANGAN commit ke git)

2. TAVILY_API_KEY
   - Stored di .env
   - Only used server-side

3. File Access
   - Can read any file dari CWD (tool: read_file)
   - Can write any file ke CWD (tool: write_file)
   - Can execute any command (tool: run_command)
   → Jangan expose ke untrusted users

4. Memory Isolation
   - Memories stored lokal di .kila-eval.json
   - Snapshots di .kila-debug/
   → Include di .gitignore
```

### Best Practices:

```
1. Token Management
   - Monitor /quota regularly
   - Run /ringkas jika approaching softLimit
   - Use /dashboard untuk telemetry

2. Workspace Awareness
   - Ensure .gitignore ada (untuk exclude node_modules)
   - Index hanya relevant directories
   - Document important files dengan tags

3. Memory Consolidation
   - Periodically review /dashboard
   - Export metrics untuk archival
   - Check violation snapshots

4. Decision Making
   - Clear constraints di awal project
   - Update decisions saat arsitektur berubah
   - Monitor decision conflicts

5. Tool Efficiency
   - Use grep_search daripada read_file besar
   - Limit web_search queries
   - Batch file operations
```

---

## 📚 Technical Specifications

### Supported Models (Ollama):

```
Default: Qwopus3.5:9b (or Qwon3.5)
Others:
  - mistral:latest
  - neural-chat:latest
  - openchat:latest
  - llama2:latest
  - dolphin-mixtral:latest

Requirement:
  - Support tool/function calling
  - Support system prompts
  - Support messages history
```

### LLM Tool Calling Format:

```
OpenAI-style function calling:
{
  "type": "function",
  "function": {
    "name": "tool_name",
    "description": "...",
    "parameters": {
      "type": "object",
      "properties": {
        "param1": { "type": "string", "description": "..." },
        ...
      },
      "required": ["param1"]
    }
  }
}
```

### Response Format:

```
message.tool_calls = [
  {
    "id": "call_...",
    "type": "function",
    "function": {
      "name": "read_file",
      "arguments": "{\"path\": \"src/index.ts\"}"
    }
  }
]
```

### HTTP Endpoints:

```
POST /chat
  Request: { model, messages }
  Response: { taskId }
  Status: 200/500

GET /status/:taskId
  Request: URL param
  Response: { status, data?, error? }
  Status: 200/404/500
  Auto-delete after retrieval if completed/error

POST /register (Bridge only)
  Request: { url, secret }
  Response: { status }
  Status: 200/401
```

### Image Attachment:

```
Format: Regex match untuk file paths
  Windows: C:\path\to\image.png
  Linux: /path/to/image.png

Encoding: Base64 (bitmap → base64string)

Supported: .png, .jpg, .jpeg

Handling:
  - Uploaded ke server via messages
  - Processed oleh LLM jika support
  - Removed dari history setelah processing (token save)
```

### Async Processing:

```
Server:
  - POST /chat immediately return taskId
  - Process background (fire & forget)
  - Store hasil di tasks Map

Client:
  - Poll /status/:taskId setiap 1 second
  - Non-blocking waiting
  - Max poll time: unlimited (task bisa lama)
```

---

## 🎓 Contoh Penggunaan

### Example 1: Code Generation

```
User: >> Buatkan fungsi untuk validate email

AI: 
[running dynamic summarization...]
[memory] Long-term memory, telemetry, decisions & memory store updated.

AI
Berikut fungsi untuk validasi email:

function validateEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

Fungsi ini menggunakan regex sederhana untuk...
```

### Example 2: Memory Query

```
User: >> /quota

AI
MEMORY QUOTA:
Usage: 4,250 / 12,000 characters
Status: 35%
```

### Example 3: Telemetry Review

```
User: >> /dashboard

AI
[displays comprehensive dashboard...]
```

### Example 4: Decision Making

```
During conversation, LLM updates decisions:
  [API Authentication] → JWT with HttpOnly cookies
  [Database] → PostgreSQL with prisma ORM
  [Frontend] → React with TypeScript
```

---

## 🐛 Troubleshooting

### Issue: "Connect ECONNREFUSED 192.168.1.139:3123"

```
Cause: Bridge not running or wrong URL
Solution:
  1. Check npm run bridge is running in Terminal 2
  2. Verify correct IP (check your network)
  3. Try kila --url http://localhost:3123 jika lokal
```

### Issue: "Server Akhir (Colab) belum terhubung ke Bridge"

```
Cause: Server tidak register ke bridge
Solution:
  1. Check npm run server berjalan
  2. Check BRIDGE_SECRET di .env match
  3. Run server dengan --report flag:
     PORT=3000 npm run server -- --report <your_url>
```

### Issue: "Token melebihi Hard Limit"

```
Cause: History terlalu panjang atau memories terlalu banyak
Solution:
  1. Run /ringkas untuk trigger summarization
  2. Run /dashboard reset jika ingin fresh start
  3. Check .kila-eval.json untuk metrics
```

### Issue: "No matches found" untuk grep_search

```
Cause: Pattern tidak cocok dengan file
Solution:
  1. Check pattern syntax (regex)
  2. Check path ada & accessible
  3. Try with --include flag untuk filter file type
```

---

## 🎯 Future Enhancements

Potential improvements:
```
1. Persistent database untuk memory (SQLite/PostgreSQL)
2. Multi-user support dengan session isolation
3. Real-time collaboration features
4. Advanced RAG dengan vector embeddings
5. Custom tool registration by users
6. Vision capabilities (image understanding)
7. Code execution sandbox
8. Git integration untuk version control
9. Streaming responses (Server-Sent Events)
10. WebSocket support untuk real-time communication
```

---

## 📞 Summary

**KILA CLI** adalah sistem AI assistant yang sophisticated dengan:
- Remote architecture (Client-Bridge-Server)
- Advanced memory management (5-layer)
- Token budget control & optimization
- Comprehensive telemetry & compliance tracking
- Tool-based LLM integration
- Decision versioning & constraint tracking
- Workspace-aware file retrieval
- Dynamic memory consolidation

Perfect untuk coding assistant yang perlu context retention, compliance checking, dan efficient token usage!

---

**Created**: January 2024  
**Last Updated**: January 2024  
**Version**: 1.0.0  
**Author**: Raihan  
**Status**: Production Ready
