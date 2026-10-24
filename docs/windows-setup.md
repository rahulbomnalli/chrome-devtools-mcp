# Windows 11 Installation & Setup Guide — Chrome DevTools HyperSpeed

This guide details configuring and running **Chrome DevTools HyperSpeed** on **Windows 11** (optimized for 12th-Gen Intel Core i5 and 8 GB RAM).

---

## 1. Prerequisites

1. **Node.js**: Node.js 22.x or later installed (`node -v` >= v22.0.0).
2. **Google Chrome**: Stable Google Chrome installed at the standard Windows path:
   `C:\Program Files\Google\Chrome\Application\chrome.exe`
3. **PowerShell**: Windows PowerShell 5.1 or PowerShell 7+ (pwsh).

---

## 2. Clone & Build

Open PowerShell in the workspace:

```powershell
# 1. Check out the hyperspeed branch
git checkout hyperspeed

# 2. Install dependencies
npm ci

# 3. Build project
# Note: On Node 22, enable experimental type stripping for TypeScript helper scripts
$env:NODE_OPTIONS = "--experimental-strip-types"
npm run build
```

---

## 3. Running the Server

### Option A: Standard Stdio Mode (MCP Clients)

Run directly via Node:

```powershell
$env:NODE_OPTIONS = "--experimental-strip-types"
node build/src/index.js --isolated-profile --chrome-path="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

### Option B: Persistent Background Daemon

Start the daemon process for instant tool execution without per-call browser startup overhead:

```powershell
node build/src/bin/chrome-devtools.js start --isolated-profile
```

Check status:

```powershell
node build/src/bin/chrome-devtools.js status
```

Stop the daemon when finished:

```powershell
node build/src/bin/chrome-devtools.js stop
```

---

## 4. Antigravity CLI & MCP Integration

Add Chrome DevTools HyperSpeed to your MCP client configuration (e.g. `~/.gemini/antigravity-ide/mcp_config.json`, Claude Desktop `claude_desktop_config.json`, or Codex config):

```json
{
  "mcpServers": {
    "chrome-devtools-hyperspeed": {
      "command": "node",
      "args": [
        "c:/Users/91973/Desktop/chrome-devtools-mcp-main/build/src/index.js",
        "--isolated-profile"
      ],
      "env": {
        "NODE_OPTIONS": "--experimental-strip-types"
      }
    }
  }
}
```

---

## 5. Verifying the Setup

Run the HyperSpeed test suite to verify all 15 compound tools and locators:

```powershell
$env:NODE_OPTIONS = "--experimental-strip-types"
npm run test tests/tools/hyperspeed.test.ts
```

All 27 assertions should pass cleanly.
