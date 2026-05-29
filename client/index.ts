#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import { Agent } from './agent.js';

const program = new Command();

program
  .name('kila-cli')
  .description('Remote AI Code Assistant via VPS Bridge')
  .version('1.0.0')
  .requiredOption('-u, --url <url>', 'Cloudflare Tunnel URL of the VPS Bridge')
  .option('-m, --model <model>', 'Ollama model on VPS', 'fredrezones55/Qwopus3.5:9b')
  .action(async (options) => {
    console.log(chalk.bold.blue('\nKILA CLI - REMOTE AI BRIDGE'));
    console.log(chalk.gray('================================================'));
    console.log(`${chalk.cyan('STATUS :')} Connected to ${options.url}`);
    console.log(`${chalk.cyan('MODEL  :')} ${options.model}`);
    console.log(chalk.gray('================================================\n'));

    const agent = new Agent(options.url, options.model);

    while (true) {
      const { message } = await prompts({
        type: 'text',
        name: 'message',
        message: chalk.bold.green('>>'),
      });

      const exitCommands = ['/exit', '/quit'];
      if (!message || exitCommands.includes(message.toLowerCase().trim())) {
        console.log(chalk.yellow('\nBYE.'));
        process.exit(0);
      }

      const response = await agent.chat(message);
      console.log(`\n${chalk.bold.blue('AI')}\n${chalk.white(response)}\n`);
    }
  });

program.parse(process.argv);
