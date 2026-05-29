import express from 'express';
import ollama from 'ollama';
import { toolDefinitions } from './tool-schemas.js';
import { search } from 'duck-duck-scrape';
const app = express();
app.use(express.json({ limit: '50mb' }));
const PORT = process.env.PORT || 3000;
// Penyimpanan tugas (Task Queue)
const tasks = new Map();
// Logika eksekusi tool di sisi Server (VPS)
const serverTools = {
    web_search: async (args) => {
        try {
            console.log(`Server executing web_search: ${args.query}`);
            const results = await search(args.query);
            return results.results
                .slice(0, 5)
                .map((r) => `Title: ${r.title}\nURL: ${r.url}\nDescription: ${r.description}`)
                .join('\n\n');
        }
        catch (error) {
            return `Error searching web on server: ${error.message}`;
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
                    tools: toolDefinitions,
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
                    if (hasServerTool)
                        continue;
                }
                // Simpan hasil akhir ke dalam task
                tasks.set(taskId, { status: 'completed', data: response });
                break;
            }
        }
        catch (error) {
            console.error(`[Task ${taskId}] Error:`, error.message);
            tasks.set(taskId, { status: 'error', error: error.message });
        }
    })();
    // Langsung balas taskId ke client (koneksi putus di sini, aman dari timeout)
    res.json({ taskId });
});
app.get('/status/:taskId', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task)
        return res.status(404).json({ error: 'Task not found' });
    res.json(task);
    // Jika sudah selesai atau error, hapus dari memory setelah diambil
    if (task.status === 'completed' || task.status === 'error') {
        tasks.delete(req.params.taskId);
    }
});
app.listen(PORT, () => {
    console.log(`AI Brain Server (VPS) running on port ${PORT}`);
    console.log(`Waiting for instructions from PC...`);
});
