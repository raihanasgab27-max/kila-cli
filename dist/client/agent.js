import chalk from 'chalk';
import { tools } from '../src/tools.js'; // Menggunakan tool lokal yang sudah kita buat
export class Agent {
    history = [
        {
            role: 'system',
            content: 'Anda adalah asisten koding AI yang membantu. Anda berpikir di server remote tetapi pengguna ingin Anda mengelola file di PC LOKAL mereka. Gunakan tool yang disediakan untuk berinteraksi dengan file system dan shell lokal.\n\nATURAN PENTING:\n1. Selalu berbicara dalam Bahasa Indonesia.\n2. Sebelum melakukan perubahan pada file (write_file, delete_file), Anda WAJIB menjelaskan apa yang akan Anda lakukan dan meminta konfirmasi dari pengguna.\n3. Jika pengguna bertanya dalam Bahasa Indonesia, jawablah dalam Bahasa Indonesia yang santai dan profesional.',
        },
    ];
    model;
    serverUrl;
    constructor(serverUrl, model = 'Qwopus3.5:9b') {
        this.serverUrl = serverUrl.replace(/\/$/, '');
        this.model = model;
    }
    async chat(userMessage) {
        this.history.push({ role: 'user', content: userMessage });
        while (true) {
            process.stdout.write(chalk.gray(`  [thinking: ${this.model}] `));
            try {
                // 1. Kirim pesan dan dapatkan Task ID
                const initRes = await fetch(`${this.serverUrl}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: this.model, messages: this.history }),
                });
                if (!initRes.ok)
                    throw new Error(`VPS Error: ${await initRes.text()}`);
                const { taskId } = await initRes.json();
                // 2. Polling status sampai selesai
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
                    // Tunggu 1 detik sebelum tanya lagi
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
                // Clear "Thinking" line
                process.stdout.write('\r\x1b[K');
                const message = data.message;
                this.history.push(message);
                // 3. Jika AI menyuruh pakai Tool
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
