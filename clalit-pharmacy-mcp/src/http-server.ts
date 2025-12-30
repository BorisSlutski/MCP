#!/usr/bin/env node
/**
 * HTTP API Server for Clalit Pharmacy MCP
 * This allows web apps (like Base44) to call your MCP via REST API
 * 
 * Run: npx ts-node src/http-server.ts
 * Or after build: node dist/http-server.js
 */

import express, { Request, Response } from "express";
import cors from "cors";

// Import your existing MCP logic
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import { ISRAEL_CITIES, CITY_COORDINATES, findSimilarCities } from "./cities-data.js";

// Enable stealth mode
const puppeteer = puppeteerExtra.default || puppeteerExtra;
puppeteer.use(StealthPlugin());

// Constants
const PORT = process.env.PORT || 3000;
const CLALIT_PHARMACY_URL = "https://e-services.clalit.co.il/PharmacyStock/";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Browser instance
let browserInstance: Browser | null = null;

const app = express();
app.use(cors());
app.use(express.json());

// =============== HELPER FUNCTIONS ===============

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: "new" as any,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
      defaultViewport: { width: 1366, height: 900 },
    }) as Browser;
  }
  return browserInstance;
}

async function createPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });
  });
  return page;
}

interface GeoLocation {
  lat: number;
  lon: number;
}

async function geocodeAddress(address: string): Promise<GeoLocation | null> {
  try {
    const params = new URLSearchParams({
      q: `${address}, Israel`,
      format: 'json',
      limit: '1',
      countrycodes: 'il',
    });
    
    const response = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': 'ClalitPharmacyAPI/1.0' },
    });
    
    if (!response.ok) return null;
    const data = await response.json() as Array<{ lat: string; lon: string }>;
    
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// =============== API ENDPOINTS ===============

// Health check
app.get("/", (req: Request, res: Response) => {
  res.json({
    name: "Clalit Pharmacy API",
    version: "1.0.0",
    status: "running",
    endpoints: {
      "GET /": "This health check",
      "GET /cities": "List all available cities",
      "GET /cities/search?q=name": "Find city by name",
      "GET /medications/search?q=name": "Search medications",
      "POST /stock/check": "Check medication stock { city, medications }",
      "POST /stock/radius": "Check stock in radius { address, medications, radius_km }",
    }
  });
});

// List all cities
app.get("/cities", (req: Request, res: Response) => {
  res.json({
    success: true,
    total: ISRAEL_CITIES.length,
    cities: ISRAEL_CITIES,
  });
});

// Search city by name
app.get("/cities/search", (req: Request, res: Response) => {
  const query = (req.query.q as string || "").trim();
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter 'q'" });
  }
  
  const matches = findSimilarCities(query);
  res.json({
    success: matches.length > 0,
    query,
    matches,
  });
});

// Search medications
app.get("/medications/search", async (req: Request, res: Response) => {
  const searchTerm = (req.query.q as string || "").trim();
  if (!searchTerm) {
    return res.status(400).json({ error: "Missing query parameter 'q'" });
  }

  let page: Page | null = null;
  try {
    const browser = await getBrowser();
    page = await createPage(browser);
    
    await page.goto(CLALIT_PHARMACY_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(5000);

    // Find and type in medication input
    const inputSelector = '#downshift-0-input';
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    await page.focus(inputSelector);
    
    // Type search term
    for (const char of searchTerm.toUpperCase()) {
      await page.type(inputSelector, char, { delay: 100 });
    }
    await delay(2000);

    // Get autocomplete results
    const medications = await page.evaluate(() => {
      const results: string[] = [];
      const items = document.querySelectorAll('#downshift-0-menu li');
      items.forEach((item) => {
        const text = (item as HTMLElement).innerText?.trim();
        if (text) results.push(text);
      });
      return results;
    });

    res.json({
      success: medications.length > 0,
      search_term: searchTerm,
      medications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    if (page) await page.close();
  }
});

// Check stock in specific city
app.post("/stock/check", async (req: Request, res: Response) => {
  const { city, medications } = req.body;
  
  if (!city || !medications || !Array.isArray(medications)) {
    return res.status(400).json({
      error: "Missing required fields: city (string), medications (array)",
    });
  }

  // Validate city
  const cityMatch = findSimilarCities(city);
  if (cityMatch.length === 0) {
    return res.status(400).json({
      error: `City "${city}" not found`,
      suggestions: ISRAEL_CITIES.slice(0, 10),
    });
  }

  // TODO: Implement full stock check logic here
  // For now, return a placeholder
  res.json({
    success: true,
    city: cityMatch[0],
    medications,
    message: "Stock check functionality - implement full logic from index.ts",
    note: "This is a simplified HTTP API. For full functionality, use the MCP server directly.",
  });
});

// Check stock in radius
app.post("/stock/radius", async (req: Request, res: Response) => {
  const { address, medications, radius_km = 5 } = req.body;
  
  if (!address || !medications || !Array.isArray(medications)) {
    return res.status(400).json({
      error: "Missing required fields: address (string), medications (array)",
    });
  }

  // Geocode address
  const location = await geocodeAddress(address);
  if (!location) {
    return res.status(400).json({
      error: `Could not geocode address: "${address}"`,
    });
  }

  // Find nearby cities
  const nearbyCities: Array<{ name: string; distance: number }> = [];
  for (const [name, coords] of Object.entries(CITY_COORDINATES)) {
    const distance = haversineDistance(location.lat, location.lon, coords.lat, coords.lon);
    if (distance <= radius_km) {
      nearbyCities.push({ name, distance: Math.round(distance * 100) / 100 });
    }
  }
  nearbyCities.sort((a, b) => a.distance - b.distance);

  res.json({
    success: true,
    address,
    location,
    radius_km,
    medications,
    nearby_cities: nearbyCities.slice(0, 20),
    message: "Found nearby cities. Full pharmacy search requires complete implementation.",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🏥 Clalit Pharmacy API running on http://localhost:${PORT}`);
  console.log(`📖 API docs: http://localhost:${PORT}/`);
});

// Cleanup on exit
process.on("SIGINT", async () => {
  if (browserInstance) await browserInstance.close();
  process.exit(0);
});

