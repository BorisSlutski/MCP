# Clalit MCP – Unified Server

MCP server for **Clalit Health Services** (Israel): pharmacy stock, appointments (book, check, cancel), and certificates/prescriptions. Token and session are **managed only by you**; the server does not store credentials.

## Features

| Area | Tools | Auth |
|------|--------|------|
| **Pharmacy** | `list_cities`, `find_city`, `search_medications`, `check_medication_stock`, `check_medication_stock_radius` | None |
| **Appointments** | `book_appointment`, `check_appointment` | Quick (ID + birth year) or browser profile |
| **Appointments** | `cancel_appointment` | Full login (SMS or browser profile) |
| **Certificates / prescriptions** | `request_certificate_or_prescription` | Full login (SMS or browser profile) |

## What You Must Supply (Token / Session)

Clalit has no public API and no API key. The “token” is your **browser session** or **quick-login data**. You choose one (or more) of:

| Option | Env variable | Description |
|--------|----------------|-------------|
| **Browser profile** | `CLALIT_BROWSER_PROFILE` | Path to a Chrome/Chromium profile directory where you are (or will) log in to Clalit. Session stays only in this folder. |
| **Cookies file** | `CLALIT_COOKIES_FILE` | Path to a JSON file of cookies exported after logging in. The server only **reads** this file; you update it when the session expires. |
| **Quick login** | `CLALIT_QUICK_ID`, `CLALIT_QUICK_BIRTH_YEAR` | National ID and birth year. Used only for **book/check appointment** (no password/SMS). Prefer not storing in env; use a local script or prompt instead if possible. |

Optional:

- `CLALIT_VISIBLE_FOR_AUTH=1` – use a **visible** browser window for login so you can enter the SMS code yourself (user-in-the-loop). The server does not see or store the SMS code.

The server **does not create or save** tokens; it only uses what you provide.

## Installation

- **Node.js 18+**
- From repo root: `cd clalit-mcp && npm install && npm run build`

### Install without cloning

You can use the server without cloning the repo:

- **npx** (if published to npm): `npx clalit-mcp` — set `command` to `npx` and `args` to `["clalit-mcp"]` in your MCP config, and add `env` as needed.
- **Global install:** `npm install -g clalit-mcp` then in Cursor config use `"command": "clalit-mcp"` (or `"command": "node"` with `"args": ["<path-to-global-bin>/clalit-mcp"]`).

You still need Node.js and a one-time Cursor MCP configuration (command, args, env).

## Configuration

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "clalit": {
      "command": "node",
      "args": ["/FULL/PATH/TO/MCP/clalit-mcp/dist/index.js"],
      "env": {
        "CLALIT_BROWSER_PROFILE": "/path/to/your/clalit-browser-profile",
        "CLALIT_VISIBLE_FOR_AUTH": "1"
      }
    }
  }
}
```

Or with quick login only (for pharmacy + book/check appointment):

```json
{
  "mcpServers": {
    "clalit": {
      "command": "node",
      "args": ["/FULL/PATH/TO/MCP/clalit-mcp/dist/index.js"],
      "env": {
        "CLALIT_QUICK_ID": "YOUR_ID",
        "CLALIT_QUICK_BIRTH_YEAR": "YEAR"
      }
    }
  }
}
```

Replace `/FULL/PATH/TO/MCP` with the real path. Do not commit real IDs or profile paths.

### Cookie file format (`CLALIT_COOKIES_FILE`)

The file must be a **JSON array** of cookie objects. The server **only reads** the file; it never writes or updates it. You are responsible for exporting and refreshing cookies when the session expires.

Each item must have at least `name`, `value`, and optionally `domain`, `path`, `expires`, `httpOnly`, `secure`. Example:

```json
[
  { "name": "SessionId", "value": "...", "domain": ".clalit.co.il", "path": "/" },
  { "name": "AuthToken", "value": "...", "domain": ".clalit.co.il", "path": "/", "secure": true }
]
```

If `domain` is omitted, `.clalit.co.il` is used. Unknown fields are ignored.

### Example: `mcp.json` (reference)

See [mcp.json.example](mcp.json.example) in this folder.

## Testing / Development

To test the server with [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

1. Build: `npm run build`
2. Run: `npx @modelcontextprotocol/inspector node dist/index.js`
3. In the Inspector, click **Connect**, then use the **Tools** tab to list and invoke tools.

Pharmacy tools may require network access; appointment tools may open a browser window (use `CLALIT_VISIBLE_FOR_AUTH=1` to see it).

## Tools (summary)

- **list_cities** – Cities available for pharmacy search.
- **find_city** – Fuzzy city search.
- **search_medications** – Search medication names (with dosage); ask user to choose before checking stock.
- **check_medication_stock** – Stock in a given city.
- **check_medication_stock_radius** – Pharmacies within radius of an address (recommended).
- **book_appointment** – Open appointment booking (quick login or profile).
- **check_appointment** – Open “my appointments” (quick login or profile).
- **cancel_appointment** – Opens full login; you complete SMS in browser if needed.
- **request_certificate_or_prescription** – Opens full login for certificates/prescriptions.

## Security

- Run the MCP **locally**; no cloud proxy.
- Do **not** share or log your SMS code; use a visible browser and enter it yourself when `CLALIT_VISIBLE_FOR_AUTH=1`.
- You are responsible for how you store and pass profile path, cookies file, or quick-login data (env, config file, etc.).
- **Session timeout:** Log-in validity (including disconnection after inactivity, e.g. after about 15 minutes) is determined by Clalit’s policy, not by this server. Re-authenticate when required.

## Disclaimer

This project is not affiliated with Clalit. Use complies with Clalit’s terms of service and acceptable use. Do not overload the site.

## License

MIT
