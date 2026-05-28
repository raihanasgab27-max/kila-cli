import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { search } from 'duck-duck-scrape';
import { z } from 'zod';

// Define the tool schemas
export const tools = [
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    parameters: z.object({
      path: z.string().describe('The path to the file to read'),
    }),
    execute: async (args: { path: string }) => {
      try {
        return fs.readFileSync(args.path, 'utf8');
      } catch (error: any) {
        return `Error reading file: ${error.message}`;
      }
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    parameters: z.object({
      path: z.string().describe('The path to the file to write'),
      content: z.string().describe('The content to write to the file'),
    }),
    execute: async (args: { path: string; content: string }) => {
      try {
        fs.mkdirSync(path.dirname(args.path), { recursive: true });
        fs.writeFileSync(args.path, args.content);
        return `Successfully wrote to ${args.path}`;
      } catch (error: any) {
        return `Error writing file: ${error.message}`;
      }
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory',
    parameters: z.object({
      path: z.string().describe('The directory path to list files from').default('.'),
    }),
    execute: async (args: { path: string }) => {
      try {
        const files = fs.readdirSync(args.path);
        return files.join('\n');
      } catch (error: any) {
        return `Error listing files: ${error.message}`;
      }
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file',
    parameters: z.object({
      path: z.string().describe('The path to the file to delete'),
    }),
    execute: async (args: { path: string }) => {
      try {
        fs.unlinkSync(args.path);
        return `Successfully deleted ${args.path}`;
      } catch (error: any) {
        return `Error deleting file: ${error.message}`;
      }
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command',
    parameters: z.object({
      command: z.string().describe('The shell command to execute'),
    }),
    execute: async (args: { command: string }) => {
      try {
        const output = execSync(args.command, { encoding: 'utf8', stdio: 'pipe' });
        return output || '(Command executed successfully with no output)';
      } catch (error: any) {
        return `Error executing command: ${error.stderr || error.message}`;
      }
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for information',
    parameters: z.object({
      query: z.string().describe('The search query'),
    }),
    execute: async (args: { query: string }) => {
      try {
        const results = await search(args.query);
        return results.results
          .slice(0, 5)
          .map((r) => `Title: ${r.title}\nURL: ${r.url}\nDescription: ${r.description}`)
          .join('\n\n');
      } catch (error: any) {
        return `Error searching web: ${error.message}`;
      }
    },
  },
];

export const toolDefinitions = tools.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(tool.parameters.shape).map(([key, value]: [string, any]) => [
          key,
          {
            type: value._def.typeName === 'ZodString' ? 'string' : 'any',
            description: value.description,
          },
        ])
      ),
      required: Object.keys(tool.parameters.shape),
    },
  },
}));
