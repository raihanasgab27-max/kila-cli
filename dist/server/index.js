import express from 'express';
import ollama from 'ollama';
import { toolDefinitions } from './tool-schemas.js';
import { search } from 'duck-duck-scrape';
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
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
    console.log(`User asking ${model}...`);
    try {
        let currentMessages = [...messages];
        while (true) {
            const response = await ollama.chat({
                model,
                messages: currentMessages,
                tools: toolDefinitions,
            });
            const message = response.message;
            // Jika AI ingin memanggil tool
            if (message.tool_calls && message.tool_calls.length > 0) {
                let hasServerTool = false;
                for (const toolCall of message.tool_calls) {
                    const toolName = toolCall.function.name;
                    // Cek apakah ini tool milik SERVER (VPS)
                    if (serverTools[toolName]) {
                        hasServerTool = true;
                        const result = await serverTools[toolName](toolCall.function.arguments);
                        currentMessages.push(message); // Tambahkan permintaan tool ke history
                        currentMessages.push({
                            role: 'tool',
                            content: result,
                        });
                    }
                }
                // Jika kita mengeksekusi tool di server, kita tanya AI lagi dengan hasil tersebut
                if (hasServerTool) {
                    continue;
                }
            }
            // Jika tidak ada server tool yang dipanggil, kirim respon balik ke client (mungkin ada local tool)
            return res.json(response);
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});
app.listen(PORT, () => {
    console.log(`AI Brain Server (VPS) running on port ${PORT}`);
    console.log(`Waiting for instructions from PC...`);
});
