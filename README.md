# Bluehawks CLI 🦅

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org)

A powerful, production-ready **multi-agent AI CLI assistant** for terminal-based coding assistance. Built with TypeScript, featuring an extensible plugin architecture, hooks system, and MCP integration.

## ✨ Features

- 🤖 **Multi-Agent Architecture** - Specialized agents for coding, research, and shell tasks
- 💬 **Interactive & Headless Modes** - Use interactively or in scripts/CI
- 🔌 **Plugin System** - Extend with custom commands, tools, and agents
- 🪝 **Hooks System** - Lifecycle hooks for tool execution and session events
- 🔗 **MCP Integration** - Connect to external data sources via Model Context Protocol
- 📝 **Session Management** - Resume previous conversations, named sessions
- ⚡ **Streaming Responses** - Real-time token streaming
- 🛠️ **Built-in Tools** - File operations, shell commands, git integration

## 📦 Installation

### From npm (Coming Soon)
```bash
npm install -g @bluehawks/cli
```

### From Source
```bash
git clone https://github.com/bluehawks-ai/bluehawks-cli.git
cd bluehawks-cli
npm install
npm run build
npm link
```

## 🚀 Quick Start

### 1. Configure API Key

Create configuration file at `~/.bluehawks/.env`:
```env
BLUEHAWKS_API_KEY=your-api-key
BLUEHAWKS_API_URL=https://api.bluehawks.ai/v1
BLUEHAWKS_MODEL=qwen-coder-32b
```

### 2. Run the CLI

**Interactive Mode:**
```bash
bluehawks
```

**Headless Mode (for scripts/CI):**
```bash
bluehawks -p "explain this codebase" --json
```

## 💻 Usage

### Commands

```bash
# Start interactive session
bluehawks

# Run with initial prompt
bluehawks -p "refactor the auth module"

# Continue last session
bluehawks -c

# Resume specific session
bluehawks -r my-session

# List saved sessions
bluehawks sessions

# List available tools
bluehawks tools

# Manage plugins
bluehawks plugins
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `-p, --prompt <text>` | Initial prompt to send |
| `-c, --continue` | Continue most recent session |
| `-r, --resume <name>` | Resume named session |
| `--max-turns <n>` | Limit agentic iterations |
| `--system-prompt <text>` | Override system prompt |
| `--append-system-prompt <text>` | Append to system prompt |
| `--add-dir <dirs...>` | Additional context directories |
| `--output-format <format>` | Output format: `text`, `json`, `stream-json` |
| `--json` | Output in JSON format |
| `-y, --yes` | Auto-approve all tool calls (YOLO mode) |

### Slash Commands

Inside the CLI, use these commands:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear conversation history |
| `/save [name]` | Save current session |
| `/stats` | Show session statistics |
| `/plan` | Toggle planning mode |
| `/yolo` | Toggle auto-approval mode |
| `/exit` | Exit the CLI |

## 🔌 Plugins

Create plugins to extend functionality with custom commands, tools, and agents.

### Plugin Structure
```
~/.bluehawks/plugins/my-plugin/
├── plugin.json          # Plugin manifest
├── commands/
│   └── greet.js        # Command handler
└── tools/
    └── custom_tool.js  # Tool handler
```

### Plugin Manifest (`plugin.json`)
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin",
  "commands": [
    {
      "name": "greet",
      "description": "Say hello",
      "handler": "commands/greet.js"
    }
  ],
  "tools": [
    {
      "name": "custom_tool",
      "description": "My custom tool",
      "handler": "tools/custom_tool.js",
      "parameters": {
        "type": "object",
        "properties": {
          "input": { "type": "string" }
        }
      }
    }
  ],
  "agents": [
    {
      "name": "reviewer",
      "description": "Code review agent",
      "systemPrompt": "You are an expert code reviewer..."
    }
  ]
}
```

## 🪝 Hooks

Hooks allow you to intercept and modify CLI behavior at various lifecycle events.

### Available Hooks

| Event | Trigger |
|-------|---------|
| `SessionStart` | When CLI session starts |
| `PreToolUse` | Before a tool executes (can block) |
| `PostToolUse` | After successful tool execution |
| `PostToolUseFailure` | After tool execution fails |
| `Stop` | Before CLI exits |

### Hook Configuration
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "run_command",
        "command": "echo 'Tool: $HOOK_INPUT' >> ~/tool.log"
      }
    ]
  }
}
```

## 🔗 MCP Integration

Connect to external data sources using the Model Context Protocol.

### Configuration (`.mcp.json`)
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

MCP tools are automatically registered and available to the agent.

## 🛠️ Built-in Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write content to file |
| `search_files` | Search files by pattern |
| `run_command` | Execute shell commands |
| `grep_search` | Search file contents |
| `git_status` | Get git repository status |
| `list_directory` | List directory contents |

## 🏗️ Architecture

```
src/
├── cli/                 # CLI components (Ink/React)
│   ├── app.tsx         # Main application component
│   └── commands/       # Slash command handlers
├── core/
│   ├── agents/         # Agent implementations
│   │   ├── agent.ts    # Base agent class
│   │   └── orchestrator.ts
│   ├── api/            # API client
│   ├── hooks/          # Hooks system
│   ├── mcp/            # MCP integration
│   ├── plugins/        # Plugin loader
│   ├── session/        # Session management
│   └── tools/          # Tool definitions & executor
└── config/             # Configuration constants
```

## 🧪 Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

## 📄 License

Apache 2.0 - See [LICENSE](LICENSE) for details.

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 📞 Support

- 📖 [Documentation](https://docs.bluehawks.ai)
- 💬 [Discord](https://discord.gg/bluehawks)
- 🐛 [Issue Tracker](https://github.com/bluehawks-ai/bluehawks-cli/issues)

---

Built with ❤️ by [Bluehawks AI](https://bluehawks.ai)
