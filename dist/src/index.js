import { Command } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import { Agent } from './agent.js';
const program = new Command();
program
    .name('kila-cli')
    .description('AI Code Assistant via CLI using Ollama')
    .version('1.0.0')
    .option('-m, --model <model>', 'Ollama model to use', 'fredrezones55/Qwopus3.5:9b')
    .action(async (options) => {
    console.log(chalk.green(`Welcome to Kila CLI! Using model: ${options.model}`));
    console.log(chalk.gray('Type "exit" or "quit" to leave the chat.\n'));
    const agent = new Agent(options.model);
    while (true) {
        const { message } = await prompts({
            type: 'text',
            name: 'message',
            message: 'You:',
        });
        const exitCommands = ['/exit', '/quit'];
        if (!message || exitCommands.includes(message.toLowerCase().trim())) {
            console.log(chalk.yellow('Goodbye!'));
            process.exit(0);
        }
        const response = await agent.chat(message);
        console.log(`\n${chalk.bold.blue('AI:')}\n${response}\n`);
    }
});
program.parse(process.argv);
