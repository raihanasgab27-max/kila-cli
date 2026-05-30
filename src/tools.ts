import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { z } from 'zod';

// Define the tool schemas
export const tools = [
  {
    name: 'update_topic',
    description: 'Update the current topic or task being performed. Use this to keep the user informed about the progress.',
    parameters: z.object({
      title: z.string().describe('The title of the new topic'),
      summary: z.string().describe('A brief summary of what is being done'),
    }),
    execute: async (args: { title: string; summary: string }) => {
      return `Topic updated to: ${args.title}`;
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Optionally provide start_line and end_line (1-based) to read specific parts.',
    parameters: z.object({
      path: z.string().describe('The path to the file to read'),
      start_line: z.number().optional().describe('The 1-based line number to start reading from'),
      end_line: z.number().optional().describe('The 1-based line number to end reading at'),
    }),
    execute: async (args: { path: string; start_line?: number; end_line?: number }) => {
      try {
        const content = fs.readFileSync(args.path, 'utf8');
        const lines = content.split('\n');
        
        if (args.start_line || args.end_line) {
          const start = args.start_line ? args.start_line - 1 : 0;
          const end = args.end_line ? args.end_line : lines.length;
          const slicedLines = lines.slice(start, end);
          return `[Showing lines ${start + 1} to ${Math.min(end, lines.length)} of ${lines.length}]\n${slicedLines.join('\n')}`;
        }
        
        return content;
      } catch (error: any) {
        return `Error reading file: ${error.message}`;
      }
    },
  },
  {
    name: 'grep_search',
    description: 'Search for a pattern in files within a directory (recursive).',
    parameters: z.object({
      pattern: z.string().describe('The regex pattern to search for'),
      path: z.string().describe('The directory path to search in').default('.'),
      include: z.string().optional().describe('File pattern to include (e.g., "*.ts")'),
    }),
    execute: async (args: { pattern: string; path: string; include?: string }) => {
      try {
        let command = `grep -rnE "${args.pattern.replace(/"/g, '\\"')}" "${args.path}"`;
        if (args.include) {
          command += ` --include="${args.include}"`;
        }
        
        // Limit results to prevent context overflow
        command += ` | head -n 50`;

        const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
        return output || 'No matches found.';
      } catch (error: any) {
        if (error.status === 1) return 'No matches found.';
        return `Error searching: ${error.message}`;
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
];

export const toolDefinitions = tools.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(tool.parameters.shape).map(([key, value]: [string, any]) => {
          let type = 'string';
          const zType = value._def.typeName;
          if (zType === 'ZodNumber') type = 'number';
          if (zType === 'ZodBoolean') type = 'boolean';
          
          return [
            key,
            {
              type,
              description: value.description,
            },
          ];
        })
      ),
      required: Object.keys(tool.parameters.shape).filter(key => {
        const field = (tool.parameters.shape as any)[key];
        return field._def.typeName !== 'ZodOptional' && field._def.defaultValue === undefined;
      }),
    },
  },
}));
