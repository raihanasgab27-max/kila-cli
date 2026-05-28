import { Agent } from './agent.js';
import chalk from 'chalk';
async function test() {
    const agent = new Agent('llama3.2:3b');
    console.log(chalk.yellow('Test 1: Simple Chat'));
    const res1 = await agent.chat('Hello, who are you?');
    console.log(res1);
    console.log(chalk.yellow('\nTest 2: Tool Call (Write File)'));
    const res2 = await agent.chat('Create a file named test_ai.txt with the content "Hello from Kila CLI"');
    console.log(res2);
    console.log(chalk.yellow('\nTest 3: Tool Call (Read File)'));
    const res3 = await agent.chat('What is in test_ai.txt?');
    console.log(res3);
    console.log(chalk.yellow('\nTest 4: Tool Call (Delete File)'));
    const res4 = await agent.chat('Delete test_ai.txt');
    console.log(res4);
}
test().catch(console.error);
