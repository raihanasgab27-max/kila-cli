import express from 'express';
import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = 3123;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'kila-secret-key';

// Variable untuk menyimpan URL Server Akhir (Colab)
let remoteTunnelUrl = '';

console.log(chalk.bold.blue('\nKILA BRIDGE - MIDDLE SERVER'));
console.log(chalk.gray('================================================'));

// 1. Endpoint untuk Colab lapor URL (via kila-cli.iantly.com)
app.post('/register', (req, res) => {
  const { url, secret } = req.body;

  if (secret !== BRIDGE_SECRET) {
    console.log(chalk.red('  [auth] Gagal: Secret key tidak cocok!'));
    return res.status(401).json({ error: 'Unauthorized' });
  }

  remoteTunnelUrl = url.replace(/\/$/, '');
  console.log(chalk.green(`  [register] Link Colab Baru: ${chalk.bold(remoteTunnelUrl)}`));
  res.json({ status: 'ok' });
});

// 2. Proxy Chat (dari Client ke Colab)
app.post('/chat', async (req, res) => {
  if (!remoteTunnelUrl) {
    return res.status(503).json({ error: 'Server Akhir (Colab) belum terhubung ke Bridge!' });
  }

  try {
    const response = await fetch(`${remoteTunnelUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: `Gagal meneruskan ke Colab: ${error.message}` });
  }
});

// 3. Proxy Status (Polling)
app.get('/status/:taskId', async (req, res) => {
  if (!remoteTunnelUrl) return res.status(503).json({ error: 'Bridge offline' });

  try {
    const response = await fetch(`${remoteTunnelUrl}/status/${req.params.taskId}`);
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${chalk.cyan('STATUS :')} Bridge berjalan di port ${PORT}`);
  console.log(`${chalk.cyan('LOCAL  :')} http://192.168.1.139:${PORT}`);
  console.log(`${chalk.cyan('PUBLIC :')} https://kila-cli.iantly.com`);
  console.log(chalk.gray('================================================\n'));
});
