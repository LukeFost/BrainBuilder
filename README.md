# BrainBuilder

A Minecraft AI agent powered by LLMs using mineflayer and LangGraph.

## Features

- LLM-powered autonomous agent that can navigate and interact with a Minecraft world
- Memory system with short-term and long-term memory components
- Planning capabilities to achieve goals
- Action system to interact with the Minecraft environment
- Conversational interface through in-game chat

## Getting Started

### Prerequisites

- Node.js (v18 or newer)
- A Minecraft LAN world (version 1.21.1)
- OpenAI API key

### Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file based on `.env.example` and add your OpenAI API key and the LAN port:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   MINECRAFT_PORT=55916  # Use the port shown in chat when you open to LAN
   ```

### Connecting to Your LAN World

1. Start your Minecraft game
2. Open a single-player world
3. Press ESC → "Open to LAN"
4. Choose your game mode and options
5. Click "Start LAN World"
6. Note the port number shown in chat (e.g., "Local game hosted on port 55916")
7. Update the MINECRAFT_PORT in your `.env` file with this port number
8. Run the bot:
   ```bash
   npm start
   ```

## Usage

The bot will connect to your Minecraft LAN world and begin operating autonomously with the default goal of "Collect wood and build a small shelter".

### In-Game Commands

You can interact with the bot using in-game chat commands:

- `goal <text>` - Set a new goal for the bot (e.g., `goal find diamonds`)
- `status` - Display the bot's current goal, plan, and last action
- `memory` - Show the bot's memory contents
- `inventory` - Display the bot's inventory
- `help` - Display available commands
- `stop` - Stop the current activity
- `explore` - Switch to exploration mode
- `follow <player>` - Follow a specific player

## Architecture

- **Agent System**: Built using LangGraph for workflow management
- **Memory Manager**: Handles short-term and long-term memory
- **Planner**: Creates step-by-step plans to achieve goals using LLMs
- **Actions**: Predefined actions the bot can take in the Minecraft world

## Troubleshooting

Common connection issues:

- If you see `Error: connect ECONNREFUSED`, check:
  - That your world is opened to LAN
  - The port in your .env file matches the one shown in Minecraft chat
  - Your Minecraft version (1.21.1) is correct

- If the bot connects but behaves unexpectedly:
  - Check the console output for errors
  - Make sure your OpenAI API key is valid

## Development

Run in development mode with hot reloading:
```bash
npm run dev
```

## Extend the Agent

Add new actions in the `src/agent/actions.ts` file by following the existing pattern.

## License

ISC