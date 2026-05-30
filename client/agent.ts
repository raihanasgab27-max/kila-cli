import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { tools } from '../src/tools.js';

const purple = chalk.hex('#8800ff');

export class Agent {
  private history: any[];
  private model: string;
  private serverUrl: string;
  private cwd: string;

  constructor(serverUrl: string, model: string = 'Qwopus3.5:9b') {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.model = model;
    this.cwd = process.cwd();

    this.history = [
      {
        role: 'system',
        content: `Anda adalah asisten koding AI yang membantu. 
Lokasi kerja Anda saat ini (CWD) adalah: ${this.cwd}

ATURAN PENTING:
1. Selalu berbicara dalam Bahasa Indonesia.
2. Gunakan tool 'list_files' untuk melihat isi folder jika Anda belum tahu apa isi project ini.
3. EFISIENSI TOKEN: Selalu prioritaskan penggunaan 'grep_search' untuk mencari bagian kode yang relevan. Gunakan 'read_file' dengan parameter 'start_line' dan 'end_line' untuk membaca bagian yang diperlukan saja. JANGAN membaca seluruh isi file kecuali benar-benar diperlukan (misal file sangat pendek atau perlu konteks penuh).
4. Sebelum melakukan perubahan pada file (write_file, delete_file), Anda WAJIB menjelaskan apa yang akan Anda lakukan dan meminta konfirmasi dari pengguna.
5. Jika pengguna bertanya tentang project, mulailah dengan 'list_files' dan 'read_file' untuk memahami konteksnya.
6. Gunakan tool 'update_topic' untuk memberitahu progress langkah demi langkah.
7. Jawablah dengan santai tapi tetap profesional.`,
      },
    ];
  }

  async summarize() {
    process.stdout.write(chalk.gray(`  [memory: summarizing everything...] `));
    
    try {
      const summaryRes = await fetch(`${this.serverUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...this.history,
            { 
              role: 'user', 
              content: 'Tolong buatkan ringkasan super padat tentang project ini, apa yang sudah kita lakukan, status file terakhir, dan apa yang sedang kita kerjakan. Ringkasan ini akan digunakan sebagai satu-satunya memori saya untuk turn berikutnya agar hemat token.' 
            }
          ]
        }),
      });

      if (!summaryRes.ok) throw new Error('Gagal menghubungi server untuk ringkasan');
      
      const { taskId } = await summaryRes.json();
      let data: any = null;
      while (true) {
        const statusRes = await fetch(`${this.serverUrl}/status/${taskId}`);
        const statusData = await statusRes.json();
        if (statusData.status === 'completed') {
          data = statusData.data;
          break;
        } else if (statusData.status === 'error') throw new Error(statusData.error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const summary = data.message.content;
      
      // Reset history dengan summary baru
      this.history = [
        {
          role: 'system',
          content: `Anda adalah asisten koding AI. 
Lokasi kerja Anda (CWD): ${this.cwd}

RINGKASAN STATUS SEBELUMNYA (MEMORI):
${summary}

Lanjutkan bantuan Anda berdasarkan ringkasan di atas.`,
        },
      ];

      process.stdout.write('\r\x1b[K');
      return summary;
    } catch (error: any) {
      process.stdout.write('\r\x1b[K');
      throw new Error(`Gagal meringkas: ${error.message}`);
    }
  }

  getQuota() {
    const totalChars = JSON.stringify(this.history).length;
    const limit = 128000;
    const percentage = ((totalChars / limit) * 100).toFixed(2);
    return { totalChars, limit, percentage };
  }

  private formatContent(content: string) {
    // Highlight code blocks, backticks, and bold text in purple
    return content
      .replace(/(`[^`]+`)/g, (match) => purple(match))
      .replace(/(\*\*[^*]+\*\*)/g, (match) => purple(match));
  }

  private showDiff(path: string, newContent: string) {
    let oldContent = '';
    try {
      if (fs.existsSync(path)) {
        oldContent = fs.readFileSync(path, 'utf8');
      }
    } catch (e) {}

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    let added = 0;
    let removed = 0;
    let diffLines: string[] = [];

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

  async chat(userMessage: string) {
    let images: string[] = [];
    let cleanedMessage = userMessage;

    // Deteksi path gambar (png, jpg, jpeg)
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
            // Hapus path dari pesan agar tidak membingungkan teks AI (opsional)
            cleanedMessage = cleanedMessage.replace(match, `[Image: ${path.basename(filePath)}]`);
          } catch (e) {
            console.log(chalk.red(`\n  Gagal membaca gambar: ${filePath}`));
          }
        }
      }
      process.stdout.write('\r\x1b[K');
    }

    const userEntry: any = { role: 'user', content: cleanedMessage };
    if (images.length > 0) {
      userEntry.images = images;
    }
    
    this.history.push(userEntry);

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

        if (!initRes.ok) throw new Error(`VPS Error: ${await initRes.text()}`);
        const { taskId } = await initRes.json();

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
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        process.stdout.write('\r\x1b[K');
        
        const message = data.message;
        this.history.push(message);

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            const args = toolCall.function.arguments as any;

            if (toolName === 'update_topic') {
              console.log(`\n  ${chalk.bold(args.title)}:`);
              console.log(`  ${chalk.gray(args.summary)}\n`);
              this.history.push({ role: 'tool', content: 'Topic updated', tool_call_id: toolCall.id });
              continue;
            }

            const tool = tools.find((t) => t.name === toolName);
            if (tool) {
              const icon = '✓';
              const displayName = toolName.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
              
              let detail = '';
              if (toolName === 'read_file') {
                const range = (args.start_line || args.end_line) ? ` [L${args.start_line || 1}-${args.end_line || 'end'}]` : '';
                detail = `${chalk.cyan(args.path)}${chalk.yellow(range)}`;
              } else if (toolName === 'web_search') {
                detail = chalk.yellow(`"${args.query}"`);
              } else if (toolName === 'grep_search') {
                detail = `${chalk.yellow(`/${args.pattern}/`)} in ${chalk.cyan(args.path)}`;
              } else if (toolName === 'run_command') {
                detail = chalk.gray(`$ ${args.command}`);
              } else {
                detail = chalk.cyan(args.path || args.command || args.pattern || args.query || '');
              }

              if (toolName === 'write_file') {
                const { added, removed, diffLines } = this.showDiff(args.path, args.content);
                console.log(`  ${chalk.green(icon)}  ${chalk.bold(displayName)}  ${chalk.cyan(args.path)} → ${chalk.green(`Accepted (+${added}, -${removed})`)}`);
                console.log('');
                diffLines.forEach(line => console.log(line));
                console.log('');
              } else {
                console.log(`  ${chalk.green(icon)}  ${chalk.bold(displayName)}  ${detail}`);
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

        // --- PEMBERSIHAN GAMBAR (Penting agar tidak boros!) ---
        this.history.forEach(msg => {
          if (msg.role === 'user' && msg.images) {
            delete msg.images;
            msg.content += ' (Data gambar telah dihapus dari memori untuk menghemat kuota)';
          }
        });

        return this.formatContent(message.content);
      } catch (error: any) {
        return `Error: ${error.message}`;
      }
    }
  }
}

