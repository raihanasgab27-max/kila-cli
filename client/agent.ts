import chalk from 'chalk';
import { tools } from '../src/tools.js'; // Menggunakan tool lokal yang sudah kita buat

export class Agent {
  private history: any[] = [
    {
      role: 'system',
      content: 'You are a helpful AI coding assistant. You think on a remote server but the user wants you to manage files on their LOCAL PC. Use the provided tools to interact with the local file system and shell.',
    },
  ];
  private model: string;
  private serverUrl: string;

  constructor(serverUrl: string, model: string = 'llama3.2:3b') {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.model = model;
  }

  async chat(userMessage: string) {
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

        if (!initRes.ok) throw new Error(`VPS Error: ${await initRes.text()}`);
        const { taskId } = await initRes.json();

        // 2. Polling status sampai selesai
        let data: any = null;
        while (true) {
          const statusRes = await fetch(`${this.serverUrl}/status/${taskId}`);
          if (!statusRes.ok) throw new Error(`Polling Error: ${await statusRes.text()}`);
          
          const statusData = await statusRes.json();
          
          if (statusData.status === 'completed') {
            data = statusData.data;
            break;
          } else if (statusData.status === 'error') {
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
              const result = await tool.execute(args as any);
              
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
      } catch (error: any) {
        return `Error: ${error.message}`;
      }
    }
  }
}
