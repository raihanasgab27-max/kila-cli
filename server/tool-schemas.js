export const toolDefinitions = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file on the local PC',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The path to the file' }
                },
                required: ['path']
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
