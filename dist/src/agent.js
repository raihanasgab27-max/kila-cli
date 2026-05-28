import ollama from 'ollama';
import { tools, toolDefinitions } from './tools.js';
import chalk from 'chalk';
export class Agent {
    history = [
        {
            role: 'system',
            content: 'You are a helpful AI coding assistant. You can read, write, and delete files, run shell commands, and search the web. Use these tools when necessary to fulfill user requests.',
        },
    ];
    model;
    constructor(model = 'llama3.2:3b') {
        this.model = model;
    }
    async chat(userMessage) {
        this.history.push({ role: 'user', content: userMessage });
        while (true) {
            console.log(chalk.gray(`Thinking with ${this.model}...`));
            try {
                const response = await ollama.chat({
                    model: this.model,
                    messages: this.history,
                    tools: toolDefinitions,
                });
                const message = response.message;
                this.history.push(message);
                if (message.tool_calls && message.tool_calls.length > 0) {
                    for (const toolCall of message.tool_calls) {
                        const tool = tools.find((t) => t.name === toolCall.function.name);
                        if (tool) {
                            console.log(chalk.cyan(`Executing tool: ${toolCall.function.name}...`));
                            const result = await tool.execute(toolCall.function.arguments);
                            this.history.push({
                                role: 'tool',
                                content: result,
                            });
                        }
                    }
                    // Continue the loop to let the LLM process tool results
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
