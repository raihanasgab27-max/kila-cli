import express from 'express';
import ollama from 'ollama';
import dotenv from 'dotenv';
dotenv.config();
import chalk from 'chalk';
import { toolDefinitions } from './tool-schemas.js';
import { search } from 'duck-duck-scrape';
import { createRequire } from 'module';
import { tavily } from '@tavily/core';
const require = createRequire(import.meta.url);
const googleIt = require('google-it');

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// Penyimpanan tugas (Task Queue)
const tasks = new Map<string, { status: string; data?: any; error?: string }>();

// Logika eksekusi tool di sisi Server (VPS)
const serverTools: Record<string, Function> = {
  web_search: async (args: { query: string }) => {
    // 1. Coba DuckDuckGo
    try {
      console.log(`Server executing web_search (DuckDuckGo): ${args.query}`);
      const results = await search(args.query);
      if (results.results.length === 0) throw new Error('No results from DuckDuckGo');
      
      return results.results
        .slice(0, 5)
        .map((r) => `Title: ${r.title}\nURL: ${r.url}\nDescription: ${r.description}`)
        .join('\n\n');
    } catch (error: any) {
      console.log(`DuckDuckGo failed: ${error.message}`);
      
      // 2. Coba Tavily (Jika ada API Key)
      if (TAVILY_API_KEY) {
        try {
          console.log(`Trying Tavily Search: ${args.query}`);
          const tvly = tavily({ apiKey: TAVILY_API_KEY });
          const tavilyResults = await tvly.search(args.query, { searchDepth: "advanced", maxResults: 5 });
          
          return tavilyResults.results
            .map((r: any) => `Title: ${r.title}\nURL: ${r.url}\nDescription: ${r.content}`)
            .join('\n\n');
        } catch (tavilyError: any) {
          console.log(`Tavily failed: ${tavilyError.message}`);
        }
      }

      // 3. Coba Google (Last Resort)
      try {
        console.log(`Trying Google Search: ${args.query}`);
        const googleResults = await googleIt({ query: args.query, limit: 5 });
        return googleResults
          .map((r: any) => `Title: ${r.title}\nURL: ${r.link}\nDescription: ${r.snippet}`)
          .join('\n\n');
      } catch (googleError: any) {
        return `Error searching web (all providers failed): ${googleError.message}`;
      }
    }
  }
};

app.post('/chat', async (req, res) => {
  const { model, messages } = req.body;
  const taskId = Math.random().toString(36).substring(7);
  
  console.log(`[Task ${taskId}] User asking ${model}...`);
  
  // Daftarkan task baru
  tasks.set(taskId, { status: 'processing' });

  // Jalankan proses AI di background (jangan ditunggu/await)
  (async () => {
    try {
      let currentMessages = [...messages];
      
      while (true) {
        const response = await ollama.chat({
          model,
          messages: currentMessages,
          tools: toolDefinitions as any,
        });

        const message = response.message;
        
        if (message.tool_calls && message.tool_calls.length > 0) {
          let hasServerTool = false;
          
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            if (serverTools[toolName]) {
              hasServerTool = true;
              const result = await serverTools[toolName](toolCall.function.arguments);
              currentMessages.push(message);
              currentMessages.push({ role: 'tool', content: result });
            }
          }
          if (hasServerTool) continue; 
        }

        // Simpan hasil akhir ke dalam task
        tasks.set(taskId, { status: 'completed', data: response });
        break;
      }
    } catch (error: any) {
      console.error(`[Task ${taskId}] Error:`, error.message);
      tasks.set(taskId, { status: 'error', error: error.message });
    }
  })();

  // Langsung balas taskId ke client (koneksi putus di sini, aman dari timeout)
  res.json({ taskId });
});

app.get('/status/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  res.json(task);

  // Jika sudah selesai atau error, hapus dari memory setelah diambil
  if (task.status === 'completed' || task.status === 'error') {
    tasks.delete(req.params.taskId);
  }
});

app.listen(PORT, () => {
  console.log(`AI Brain Server (VPS) running on port ${PORT}`);
  console.log(`Waiting for instructions from PC...`);

  // Jalankan auto-report secara otomatis tanpa perlu flag
  autoReport();
});

async function autoReport() {
  const bridgeUrl = process.env.BRIDGE_URL || 'https://kila-cli.iantly.com';
  const secret = process.env.BRIDGE_SECRET || 'kila-secret-key';
  
  console.log(chalk.gray(`[Bridge] Mencari URL tunnel otomatis...`));

  try {
    let myUrl = '';

    // 1. Cek apakah ada di argument (fallback)
    const reportUrlIdx = process.argv.indexOf('--report');
    if (reportUrlIdx !== -1) {
      myUrl = process.argv[reportUrlIdx + 1];
    } 
    // 2. Coba deteksi otomatis dari Cloudflared Metrics API
    else {
      try {
        // Cloudflared biasanya menyediakan metrics di localhost:45333
        const metricsRes = await fetch('http://127.0.0.1:45333/metrics');
        const text = await metricsRes.text();
        const match = text.match(/user_hostname="([^"]+\.trycloudflare\.com)"/);
        if (match) {
          myUrl = `https://${match[1]}`;
          console.log(chalk.green(`[Bridge] Terdeteksi URL: ${myUrl}`));
        }
      } catch (e) {
        // Abaikan jika metrics tidak aktif
      }
    }

    if (!myUrl) {
      console.log(chalk.yellow('[Bridge] Tidak ada URL terdeteksi. Silakan gunakan --report jika otomatis gagal.'));
      return;
    }

    console.log(chalk.gray(`[Bridge] Melapor ke ${bridgeUrl}...`));
    const res = await fetch(`${bridgeUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: myUrl, secret }),
    });

    if (res.ok) console.log(chalk.green('[Bridge] Registrasi Berhasil!'));
    else console.log(chalk.red('[Bridge] Registrasi Gagal (Cek Secret Key)!'));
  } catch (e: any) {
    console.log(chalk.red(`[Bridge] Error: ${e.message}`));
  }
}
