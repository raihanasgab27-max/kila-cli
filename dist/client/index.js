#!/usr/bin/env node
import { Command } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import { Agent } from './agent.js';
const program = new Command();
program
    .name('kila')
    .description('Remote AI Code Assistant via Home Bridge')
    .version('1.0.0')
    .option('-u, --url <url>', 'URL of the VPS or Bridge', 'http://192.168.1.139:3123')
    .option('-m, --model <model>', 'Ollama model on VPS', 'Qwopus3.5:9b')
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
        if (message.toLowerCase().trim() === '/ringkas') {
            const summary = await agent.summarize();
            console.log(`\n${chalk.bold.green('MEMORI DIRINGKAS:')}\n${chalk.gray(summary)}\n`);
            continue;
        }
        if (message.toLowerCase().trim() === '/quota') {
            const { totalChars, limit, percentage } = agent.getQuota();
            const color = Number(percentage) > 80 ? chalk.red : (Number(percentage) > 50 ? chalk.yellow : chalk.green);
            console.log(`\n${chalk.bold('MEMORY QUOTA:')}`);
            console.log(`Usage: ${chalk.cyan(totalChars.toLocaleString())} / ${limit.toLocaleString()} characters`);
            console.log(`Status: ${color(`${percentage}%`)}\n`);
            continue;
        }
        const response = await agent.chat(message);
        console.log(`\n${chalk.bold.blue('AI')}\n${chalk.white(response)}\n`);
    }
});
program.parse(process.argv);
