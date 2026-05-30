import chalk from 'chalk';
import fs from 'fs';
import { tools } from '../src/tools.js';
const purple = chalk.hex('#8800ff');
export class Agent {
    history = [
        {
            role: 'system',
            content: 'Anda adalah asisten koding AI yang membantu. Anda berpikir di server remote tetapi pengguna ingin Anda mengelola file di PC LOKAL mereka. Gunakan tool yang disediakan untuk berinteraksi dengan file system dan shell lokal.\n\nATURAN PENTING:\n1. Selalu berbicara dalam Bahasa Indonesia.\n2. Sebelum melakukan perubahan pada file (write_file, delete_file), Anda WAJIB menjelaskan apa yang akan Anda lakukan dan meminta konfirmasi dari pengguna.\n3. Jika pengguna bertanya dalam Bahasa Indonesia, jawablah dalam Bahasa Indonesia yang santai dan profesional.\n4. Gunakan tool update_topic sesering mungkin untuk memberitahu progress Anda.',
        },
    ];
    model;
    serverUrl;
    constructor(serverUrl, model = 'Qwopus3.5:9b') {
        this.serverUrl = serverUrl.replace(/\/$/, '');
        this.model = model;
    }
    formatContent(content) {
        // Highlight code blocks, backticks, and bold text in purple
        return content
            .replace(/(`[^`]+`)/g, (match) => purple(match))
            .replace(/(\*\*[^*]+\*\*)/g, (match) => purple(match));
    }
    showDiff(path, newContent) {
        let oldContent = '';
        try {
            if (fs.existsSync(path)) {
                oldContent = fs.readFileSync(path, 'utf8');
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
        // Very basic diff display
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
    async chat(userMessage) {
        this.history.push({ role: 'user', content: userMessage });
        while (true) {
            process.stdout.write(chalk.gray(`  [thinking: ${this.model}] `));
            try {
                const initRes = await fetch(`${this.serverUrl}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: this.model, messages: this.history }),
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
                if (message.tool_calls && message.tool_calls.length > 0) {
                    for (const toolCall of message.tool_calls) {
                        const toolName = toolCall.function.name;
                        const args = toolCall.function.arguments;
                        if (toolName === 'update_topic') {
                            console.log(`\n  ${chalk.bold(args.title)}:`);
                            console.log(`  ${chalk.gray(args.summary)}\n`);
                            this.history.push({ role: 'tool', content: 'Topic updated', tool_call_id: toolCall.id });
                            continue;
                        }
                        const tool = tools.find((t) => t.name === toolName);
                        if (tool) {
                            const icon = '✓';
                            const displayName = toolName.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
                            if (toolName === 'write_file') {
                                const { added, removed, diffLines } = this.showDiff(args.path, args.content);
                                console.log(`  ${chalk.green(icon)}  ${chalk.bold(displayName)}  ${chalk.cyan(args.path)} → ${chalk.green(`Accepted (+${added}, -${removed})`)}`);
                                console.log('');
                                diffLines.forEach(line => console.log(line));
                                console.log('');
                            }
                            else {
                                console.log(`  ${chalk.green(icon)}  ${chalk.bold(displayName)}  ${chalk.cyan(args.path || args.command || args.pattern || '')}`);
                            }
                            const result = await tool.execute(args);
                            this.history.push({
                                role: 'tool',
                                content: result,
                                tool_call_id: toolCall.id,
                            });
                        }
                    }
                    continue;
                }
                return this.formatContent(message.content);
            }
            catch (error) {
                return `Error: ${error.message}`;
            }
        }
    }
}
