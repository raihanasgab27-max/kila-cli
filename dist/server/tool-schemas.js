export const toolDefinitions = [
    {
        type: 'function',
        function: {
            name: 'update_topic',
            description: 'Update the current topic or task being performed. Use this to keep the user informed about the progress.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'The title of the new topic' },
                    summary: { type: 'string', description: 'A brief summary of what is being done' }
                },
                required: ['title', 'summary']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file on the local PC. Optionally provide start_line and end_line.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path to the file' },
                    start_line: { type: 'number', description: 'The 1-based line number to start reading from' },
                    end_line: { type: 'number', description: 'The 1-based line number to end reading at' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'grep_search',
            description: 'Search for a pattern in files within a directory on the local PC.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'The regex pattern to search for' },
                    path: { type: 'string', description: 'The directory path to search in' },
                    include: { type: 'string', description: 'File pattern to include (e.g., "*.ts")' }
                },
                required: ['pattern', 'path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write content to a file on the local PC',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path to the file' },
                    content: { type: 'string', description: 'The content to write' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute a shell command on the local PC',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The command to run' }
                },
                required: ['command']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List files in a directory on the local PC',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The directory path' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the web for information using the VPS internet connection',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'The search query' }
                },
                required: ['query']
            }
        }
    }
];
