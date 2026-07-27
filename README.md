# Hevy MCP Server


A Model Context Protocol (MCP) server that connects to the official Hevy API and exposes workout data to AI assistants. Supports dual transport modes: stdio for Claude Desktop and SSE for remote access (e.g., Poke.com).

Built by [@madebydia](https://x.com/madebydia)


## Deploy to Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/hevy-mcp-server?referralCode=a6V1Do&utm_medium=integration&utm_source=template&utm_campaign=generic)

See the [Railway Deployment](#railway-deployment) section below for configuration details.

## Features

### MCP Tools

#### Workout Management
- `get-workouts` - Get paginated workout list with date filtering
- `get-workout` - Get single workout by ID with full details
- `create-workout` - Create new workout with exercises and sets
- `update-workout` - Update existing workout
- `get-workout-count` - Get total workout count for stats
- `get-workout-events` - Get workout update/delete events since date

#### Routine Management
- `get-routines` - List all saved routines
- `get-routine` - Get single routine by ID
- `create-routine` - Create new workout routine template
- `update-routine` - Update existing routine
- `delete-routine` - Remove routine

#### Exercise Data
- `get-exercise-templates` - Browse available exercises (standard + custom)
- `get-exercise-template` - Get single exercise by ID
- `get-exercise-progress` - Track progress for specific exercises over time
- `get-exercise-stats` - Get personal records and 1RM estimates

#### Folder Organization
- `get-routine-folders` - List routine folders
- `get-routine-folder` - Get folder by ID
- `create-routine-folder` - Create new folder
- `update-routine-folder` - Update folder name
- `delete-routine-folder` - Remove folder

## Prerequisites

1. **Hevy PRO Subscription** - Required for API access
2. **Hevy API Key** - Get it at https://hevy.com/settings?developer
3. **Node.js** - Version 18 or higher

## Installation

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/madebydia/hevy-mcp-server
cd hevy-mcp-server
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your Hevy API key:

```bash
HEVY_API_KEY=your_hevy_api_key_here
HEVY_API_BASE_URL=https://api.hevyapp.com

# Transport configuration
TRANSPORT=stdio                    # stdio | sse | both
PORT=3004                          # Port for SSE/HTTP mode
HOST=127.0.0.1                     # Host for SSE/HTTP mode

# SSE Configuration (for Poke.com)
SSE_PATH=/mcp                      # SSE endpoint path
HEARTBEAT_INTERVAL=30000           # ms - keep connection alive
AUTH_TOKEN=                        # See Security section below
```

#### Security: AUTH_TOKEN Configuration

**When using SSE mode with remote access (e.g., via ngrok for Poke.com), you MUST set an AUTH_TOKEN to prevent unauthorized access to your Hevy data.**

Generate a secure token using either method:

**Option 1: Using the built-in script**
```bash
npm run generate-token
```

**Option 2: Using OpenSSL**
```bash
openssl rand -hex 32
```

Then add the generated token to your `.env` file:
```bash
AUTH_TOKEN=your_generated_token_here
```

When connecting from Poke.com, include the token in the Authorization header:
```
Authorization: Bearer your_generated_token_here
```

**Security Notes:**
- ✅ **REQUIRED** for SSE mode with public/ngrok access
- ❌ **Optional** for stdio mode (Claude Desktop)
- ❌ **Optional** for SSE mode on localhost only
- ⚠️  Never commit your `.env` file or share your AUTH_TOKEN

### 3. Build the Project

```bash
npm run build
```

## Usage

### For Claude Desktop (stdio mode)

#### 1. Run the server in development mode:

```bash
npm run dev
```

#### 2. Configure Claude Desktop

Edit your Claude Desktop config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude
