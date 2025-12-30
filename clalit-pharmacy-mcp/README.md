<p align="center">
  <img src="https://raw.githubusercontent.com/anthropics/anthropic-cookbook/main/misc/mcp-server-icon.png" width="120" alt="MCP Server Icon">
</p>

<h1 align="center">💊 Clalit Pharmacy Stock MCP Server</h1>

<p align="center">
  <strong>Check medication availability in Clalit pharmacies across Israel using AI assistants</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#usage">Usage</a> •
  <a href="#tools">Tools</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="Node.js Version">
  <img src="https://img.shields.io/badge/MCP-compatible-purple.svg" alt="MCP Compatible">
  <img src="https://img.shields.io/badge/language-TypeScript-blue.svg" alt="TypeScript">
</p>

---

## 🌟 What is this?

This is an **MCP (Model Context Protocol) server** that enables AI assistants like Claude, Cursor, and other MCP-compatible clients to check medication availability in **Clalit Health Services pharmacies** across Israel.

Since the Clalit pharmacy website doesn't provide a public API, this server uses **Puppeteer** with stealth mode to automate browser interactions and fetch real-time stock information.

### What is MCP?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is an open standard that allows AI models to securely interact with external tools, data sources, and services. This MCP server provides medication stock checking capabilities to any MCP-compatible AI assistant.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **Search Medications** | Find medications by name with autocomplete (supports English names like "Ozempic", "Concerta", "Ritalin") |
| 🏙️ **1,700+ Cities** | Pre-loaded database of all Israeli cities supported by Clalit |
| 📍 **Radius Search** | Find pharmacies within a configurable radius (default 5km) from your address |
| 🎯 **Priority Ranking** | Highlights pharmacies that have ALL your requested medications |
| 📊 **Table Output** | Results formatted as clear tables with stock status and distance |
| 💊 **Multiple Medications** | Check availability of multiple medications at once |
| 🗺️ **Waze Navigation** | Direct Waze links for easy navigation to pharmacies |
| ℹ️ **Clalit Details** | Links to pharmacy details on Clalit website (when available) |
| 🕐 **Real-time Data** | Fetches live stock information from Clalit's website |

---

## 📦 Installation

### Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **npm** or **yarn**

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/BorisSlutski/MCP.git

# 2. Navigate to the project directory
cd MCP/clalit-pharmacy-mcp

# 3. Install dependencies
npm install

# 4. Build the TypeScript
npm run build
```

### Quick Install via npx (coming soon)

```bash
npx clalit-pharmacy-mcp
```

---

## ⚙️ Configuration

### For Cursor IDE

Add this to your MCP settings file (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "clalit-pharmacy": {
      "command": "node",
      "args": ["/FULL/PATH/TO/clalit-pharmacy-mcp/dist/index.js"]
    }
  }
}
```

> ⚠️ Replace `/FULL/PATH/TO/` with the actual path to your cloned repository.

### For Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "clalit-pharmacy": {
      "command": "node",
      "args": ["/FULL/PATH/TO/clalit-pharmacy-mcp/dist/index.js"]
    }
  }
}
```

### Restart Required

After adding the configuration, **restart your AI client** to load the MCP server.

---

## 🚀 Usage

### Example Conversations

**Simple search:**
```
User: Is there Ozempic available in Tel Aviv?

AI: Let me search for Ozempic... I found several dosages:
    1. OZEMPIC INJ 0.25MG/0.5MG
    2. OZEMPIC INJ 1MG
    Which dosage do you need?

User: 1MG

AI: What's your address? And is a 5km radius OK?

User: Rothschild 50, Tel Aviv. Yes, 5km is fine.

AI: 🎯 Found 3 pharmacies with OZEMPIC INJ 1MG within 5km:
    | Distance | Pharmacy | Address | Phone | Status |
    |----------|----------|---------|-------|--------|
    | 0.8 km   | בית מרקחת כללית שדרות רוטשילד | ... | 03-XXX | 🟢 Open |
    ...
```

**Multiple medications:**
```
User: I need both Concerta 36mg and Ritalin 20mg near Petah Tikva

AI: [Searches and shows table with pharmacies, 
    prioritizing those with BOTH medications marked with 🎯]
```

---

## 🛠️ Available Tools

### 1. `search_medications`
Search for medications by name. Returns a list of available medications with different dosages.

**Parameters:**
- `search_term` (required): Medication name in English (e.g., "ozempic", "concerta")

**Workflow:**
1. Search returns medications with different dosages
2. AI asks user to select the correct dosage
3. Proceed to stock check

---

### 2. `check_medication_stock`
Check medication stock in a specific city.

**Parameters:**
- `city` (required): City name in Hebrew (e.g., "פתח תקווה")
- `medications` (required): Array of exact medication names from search

---

### 3. `check_medication_stock_radius` ⭐ Recommended
Check medication availability within a radius of your address.

**Parameters:**
- `address` (required): Full address in Hebrew (e.g., "פתח תקווה רוטשילד 50")
- `medications` (required): Array of exact medication names
- `radius_km` (optional): Search radius in km (default: 5)

**Output includes:**
- 🎯 **Priority pharmacies** with ALL medications
- 📍 Distance from your location
- 📞 Phone numbers
- ✅/❌ Stock status per medication
- 🗺️ **Waze link** for direct navigation
- ℹ️ **Clalit link** for pharmacy details (when available)

---

### 4. `list_cities`
Get list of all 1,700+ available cities.

---

### 5. `find_city`
Find city by name with fuzzy matching.

**Parameters:**
- `city_name`: City name to search (supports partial names and typos)

---

## 📸 Screenshots

### Medication Search Results
```
| # | Medication              | Dosage |
|---|-------------------------|--------|
| 1 | CONCERTA ER TAB 18MG 30 | 18MG   |
| 2 | CONCERTA ER TAB 27MG 30 | 27MG   |
| 3 | CONCERTA ER TAB 36MG 30 | 36MG   |
| 4 | CONCERTA ER TAB 54MG 30 | 54MG   |
```

### Pharmacy Results Table
```
| 📍 מרחק | 🏥 בית מרקחת | 📍 עיר | CONCERTA | RITALIN | 📞 טלפון | 🗺️ |
|---------|--------------|------|----------|---------|----------|-----|
| 1.2 🎯  | ברקמן        | פ״ת  | ✅       | ✅      | 03-XXX   | [🗺️](waze://...) |
| 2.5     | בית מרקחת ב  | ר״ג  | ✅       | ❌      | 03-YYY   | [🗺️](waze://...) |
| 3.1     | בית מרקחת ג  | גש   | ✅       | ❌      | 03-ZZZ   | [🗺️](waze://...) |
```

**Legend:** 🎯 = All medications in stock | ✅ = In stock | ❌ = Out of stock | 🗺️ = Waze navigation

---

## 🔧 Development

```bash
# Build
npm run build

# Run directly
npm start

# Development (build + run)
npm run dev
```

---

## 📋 Technical Details

- **Language:** TypeScript
- **Runtime:** Node.js 18+
- **Browser Automation:** Puppeteer with stealth plugin
- **Geocoding:** OpenStreetMap Nominatim (free, no API key needed)
- **Protocol:** MCP (Model Context Protocol)

---

## ⚠️ Disclaimer

- This tool is for **personal use only**
- It interacts with the Clalit pharmacy website and is subject to their terms of service
- Stock information is fetched in real-time but may not be 100% accurate
- Use responsibly and don't overload the Clalit servers
- The developers are not affiliated with Clalit Health Services

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** - see below for details:

```
MIT License

Copyright (c) 2024 Boris Slutski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Puppeteer](https://pptr.dev/) for browser automation
- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/) for geocoding
- Clalit Health Services for providing the pharmacy stock website

---

<p align="center">
  Made with ❤️ for the Israeli community
</p>
