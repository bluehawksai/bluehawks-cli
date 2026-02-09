
import { registerAllTools } from './src/core/tools/definitions/index.js';
import { toolRegistry } from './src/core/tools/registry.js';

console.log('Registering tools...');
registerAllTools();

const tools = toolRegistry.getAll();
console.log('Registered Tools:', tools.map(t => t.name).join(', '));

if (tools.some(t => t.name === 'find_files')) {
    console.log('SUCCESS: find_files is registered.');
} else {
    console.error('FAILURE: find_files is NOT registered.');
    process.exit(1);
}
