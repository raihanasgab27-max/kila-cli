import chalk from 'chalk';
import { tools } from '../src/tools.js'; // Menggunakan tool lokal yang sudah kita buat
export class Agent {
    history = [
        {
            role: 'system',
            content: 'You are a helpful AI coding assistant. You think on a remote server but the user wants you to manage files on their LOCAL PC. Use the provided tools to interact with the local file system and shell.',
        },
    ];
    model;
    serverUrl;
    constructor(serverUrl, model = 'llama3.2:3b') {
        this.serverUrl = serverUrl.replace(/\/$/, '');
        this.model = model;
    }
    async chat(userMessage) {
        this.history.push({ role: 'user', content: userMessage });
        while (true) {
            process.stdout.write(chalk.gray(`  [thinking: ${this.model}] `));
            try {
                // 1. Tanya Otak (VPS)
                const chatRes = await fetch(`${this.serverUrl}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: this.model, messages: this.history }),
                });
                // Clear "Thinking" line
                process.stdout.write('\r\x1b[K');
                if (!chatRes.ok)
                    throw new Error(`VPS Error: ${await chatRes.text()}`);
                const data = await chatRes.json();
                const message = data.message;
                this.history.push(message);
                // 2. Jika Otak (VPS) menyuruh pakai Tool
                if (message.tool_calls && message.tool_calls.length > 0) {
                    for (const toolCall of message.tool_calls) {
                        const toolName = toolCall.function.name;
                        const args = toolCall.function.arguments;
                        const tool = tools.find((t) => t.name === toolName);
                        if (tool) {
                            console.log(`${chalk.yellow('  TOOL:')} ${chalk.cyan(toolName)}`);
                            const result = await tool.execute(args);
                            this.history.push({
                                role: 'tool',
                                content: result,
                            });
                        }
                    }
                    // Tanya lagi ke VPS dengan hasil eksekusi lokal
                    continue;
                }
                return message.content;
            }
            catch (error) {
                return `Error: ${error.message}`;
            }
        }
    }
}
