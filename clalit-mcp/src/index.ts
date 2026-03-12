#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// Use puppeteer-extra with stealth plugin to bypass bot detection
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";

// Import cities data (1708 cities from Clalit website)
import { ISRAEL_CITIES, CITY_COORDINATES, isCityValid, findSimilarCities } from "./cities-data.js";

// Enable stealth mode (puppeteer-extra may export default or namespace)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const puppeteer = ((puppeteerExtra as any).default || puppeteerExtra) as any;
puppeteer.use(StealthPlugin());

// Constants
const CLALIT_PHARMACY_URL = "https://e-services.clalit.co.il/PharmacyStock/";
const CLALIT_QUICK_LOGIN_URL = "https://e-services.clalit.co.il/onlinewebquick/quick/QuickLogin";
const CLALIT_APPOINTMENTS_QUICK_URL = "https://e-services.clalit.co.il/onlinewebquick/nvgq/tamuz/he-il";
const CLALIT_FULL_LOGIN_URL = "https://e-services.clalit.co.il/onlineweb/general/login.aspx";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const BROWSER_TIMEOUT = 60000; // Increased to 60 seconds
const TYPING_DELAY = 100; // Slightly slower typing for reliability

/** User-supplied config: token/session managed by user only */
export interface ClalitConfig {
  browserProfilePath?: string;
  cookiesFilePath?: string;
  quickId?: string;
  quickBirthYear?: string;
  visibleForAuth?: boolean;
}

function getConfig(): ClalitConfig {
  return {
    browserProfilePath: process.env.CLALIT_BROWSER_PROFILE,
    cookiesFilePath: process.env.CLALIT_COOKIES_FILE,
    quickId: process.env.CLALIT_QUICK_ID,
    quickBirthYear: process.env.CLALIT_QUICK_BIRTH_YEAR,
    visibleForAuth: process.env.CLALIT_VISIBLE_FOR_AUTH === "1" || process.env.CLALIT_VISIBLE_FOR_AUTH === "true",
  };
}

/** Cookie shape for CLALIT_COOKIES_FILE: name, value, domain required; rest optional */
interface CookieInput {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

/** Load cookies from JSON file (read-only). Returns null on missing file or parse error. */
function loadCookiesFromFile(filePath: string): CookieInput[] | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : [data];
    return arr.filter((c: unknown) => c && typeof c === "object" && "name" in c && "value" in c) as CookieInput[];
  } catch {
    return null;
  }
}

/** Apply user-supplied cookies to page. Call only after page has navigated to Clalit domain. No-op if no cookies file or invalid. */
async function applyUserCookiesIfConfigured(page: Page): Promise<void> {
  const config = getConfig();
  if (!config.cookiesFilePath) return;
  const cookies = loadCookiesFromFile(config.cookiesFilePath);
  if (!cookies?.length) return;
  const normalized = cookies.map((c) => ({
    name: String(c.name),
    value: String(c.value),
    domain: c.domain ?? ".clalit.co.il",
    path: c.path ?? "/",
    expires: c.expires ?? -1,
    httpOnly: !!c.httpOnly,
    secure: c.secure !== false,
  }));
  await page.setCookie(...normalized);
}

// Cache
let cachedCities: string[] = ISRAEL_CITIES; // Pre-loaded with 1708 cities

// Convert CITY_COORDINATES to array format for radius search
const KNOWN_CITIES_WITH_COORDS = Object.entries(CITY_COORDINATES).map(([name, coords]) => ({
  name,
  lat: coords.lat,
  lon: coords.lon,
}));

// Simple list for backward compatibility (all 1708 cities from Clalit)
const KNOWN_CITIES = ISRAEL_CITIES;

// O(1) lookup set for exact city name matching
const KNOWN_CITIES_SET = new Set(KNOWN_CITIES);

// Geocode result type
interface GeoLocation {
  lat: number;
  lon: number;
  displayName?: string;
}

// Pharmacy with distance
interface PharmacyWithDistance {
  name: string;
  address: string;
  phone?: string;
  stock?: string;
  clalitCode?: string;
  lat?: number;
  lon?: number;
  distance?: number;
}

// Helper: Generate Waze navigation link
function generateWazeLink(address: string, city?: string): string {
  const fullAddress = city ? `${address}, ${city}, Israel` : `${address}, Israel`;
  return `https://waze.com/ul?q=${encodeURIComponent(fullAddress)}`;
}

// Helper: Generate Clalit pharmacy details link
function generateClalitLink(code: string): string {
  return `https://www.clalit.co.il/he/sefersherut/pages/clinicdetails.aspx?ddeptcode=${code}`;
}

/**
 * Geocode an address using OpenStreetMap Nominatim
 */
async function geocodeAddress(address: string): Promise<GeoLocation | null> {
  const addressVariants = [
    `${address}, Israel`,
    address,
    address.replace('רחוב', '').trim(),
    address.replace(/\d+$/, '').trim() + ', Israel',
  ];
  
  for (const addr of addressVariants) {
    try {
      const params = new URLSearchParams({
        q: addr,
        format: 'json',
        limit: '1',
        countrycodes: 'il',
      });
      
      const response = await fetch(`${NOMINATIM_URL}?${params}`, {
        headers: {
          'User-Agent': 'ClalitPharmacyMCP/1.0',
          'Accept-Language': 'he,en',
        },
      });
      
      if (!response.ok) continue;
      
      const data = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
      if (data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          displayName: data[0].display_name,
        };
      }
    } catch {
      // Continue to next variant
    }
    await delay(300);
  }
  
  return null;
}

/**
 * Calculate distance between two points using Haversine formula
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Extract city name from address
 */
function extractCity(address: string): string {
  // Fast path: check each comma-separated segment against the set (O(segments))
  for (const segment of address.split(',')) {
    const trimmed = segment.trim();
    if (KNOWN_CITIES_SET.has(trimmed)) return trimmed;
  }

  // Fallback: substring scan for addresses without commas (O(n cities))
  for (const city of KNOWN_CITIES) {
    if (address.includes(city)) return city;
  }

  // Last resort: first two whitespace-delimited tokens
  const parts = address.split(/[,\s]+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0];
}

interface NearbyCity {
  name: string;
  lat: number;
  lon: number;
  distance: number;
}

/**
 * Find cities within a given radius of coordinates
 */
function findNearbyCities(lat: number, lon: number, radiusKm: number): NearbyCity[] {
  const nearbyCities: NearbyCity[] = [];
  
  for (const city of KNOWN_CITIES_WITH_COORDS) {
    const distance = haversineDistance(lat, lon, city.lat, city.lon);
    if (distance <= radiusKm) {
      nearbyCities.push({
        name: city.name,
        lat: city.lat,
        lon: city.lon,
        distance: Math.round(distance * 100) / 100,
      });
    }
  }
  
  // Sort by distance
  return nearbyCities.sort((a, b) => a.distance - b.distance);
}

// Browser instance
let browserInstance: Browser | null = null;
// Pending launch promise — prevents concurrent callers from each spawning a separate browser process
let browserLaunchPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance?.connected) return browserInstance;
  if (!browserLaunchPromise) {
    browserLaunchPromise = (async () => {
      const config = getConfig();
      const launchOptions: { headless: boolean; args: string[]; defaultViewport: { width: number; height: number }; ignoreDefaultArgs: string[]; userDataDir?: string } = {
        headless: !config.visibleForAuth,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--start-maximized",
          "--window-size=1366,900",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
        defaultViewport: { width: 1366, height: 900 },
        ignoreDefaultArgs: ["--enable-automation"],
      };
      if (config.browserProfilePath) {
        launchOptions.userDataDir = config.browserProfilePath;
      }
      const b = (await puppeteer.launch(launchOptions)) as Browser;
      browserInstance = b;
      browserLaunchPromise = null;
      return b;
    })();
  }
  return browserLaunchPromise;
}

// Create a new page with anti-detection measures
async function createPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  
  // Enhanced anti-detection measures for headless mode
  await page.evaluateOnNewDocument(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    
    // Override plugins to look like a real browser
    Object.defineProperty(navigator, 'plugins', { 
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ]
    });
    
    // Override languages
    Object.defineProperty(navigator, 'languages', { 
      get: () => ['he-IL', 'he', 'en-US', 'en'] 
    });
    
    // Add chrome object
    (window as any).chrome = {
      runtime: {},
      loadTimes: () => ({}),
      csi: () => ({}),
      app: {},
    };
    
    // Override permissions query
    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (params: any) => {
      if (params.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus);
      }
      return originalQuery(params);
    };
    
    // Hide automation indicators
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 1 });
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  });
  
  return page;
}

async function closeBrowser(): Promise<void> {
  browserLaunchPromise = null;
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Validate that required fields exist in args; throws McpError with a clear message if any are missing. */
function requireArgs<T extends Record<string, unknown>>(args: unknown, fields: (keyof T)[]): T {
  if (!args || typeof args !== "object") {
    throw new McpError(ErrorCode.InvalidParams, "Missing required arguments");
  }
  const obj = args as Record<string, unknown>;
  const missing = fields.filter((f) => obj[f as string] === undefined || obj[f as string] === null || obj[f as string] === "");
  if (missing.length > 0) {
    throw new McpError(ErrorCode.InvalidParams, `Missing required argument(s): ${missing.join(", ")}`);
  }
  return obj as T;
}

/** Fill in quick-login form (ID + birth year) and submit. Returns true if form was submitted. */
async function performQuickLogin(page: Page, config: ClalitConfig, postSubmitDelayMs = 3000): Promise<boolean> {
  if (!config.quickId || !config.quickBirthYear) return false;
  await delay(2000);
  const idInput = await page.$('input[name*="id"], input[placeholder*="תעודת"], input#idNumber');
  const yearInput = await page.$('input[name*="year"], input[placeholder*="לידה"], input#birthYear');
  if (!idInput || !yearInput) return false;
  await idInput.type(config.quickId, { delay: 80 });
  await yearInput.type(config.quickBirthYear, { delay: 80 });
  let submitted = false;
  const submitBtn = await page.$('button[type="submit"]') ?? await page.$('input[type="submit"]');
  if (submitBtn) {
    await submitBtn.click();
    submitted = true;
  } else {
    submitted = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      const btn = buttons.find(el => (el as HTMLElement).innerText?.includes('המשך')) ?? buttons[0];
      if (btn) { (btn as HTMLElement).click(); return true; }
      return false;
    });
  }
  if (submitted) await delay(postSubmitDelayMs);
  return submitted;
}

// Click "יישוב" tab using MOUSE CLICK - more reliable than evaluate click
async function clickCityTab(page: Page): Promise<boolean> {
  // Get the position of the יישוב tab
  const tabRect = await page.evaluate(() => {
    const container = document.querySelector('[class*="TabMenu__TabsContainer"]');
    if (container) {
      const tabs = container.querySelectorAll('li');
      for (const tab of tabs) {
        if ((tab as HTMLElement).innerText?.trim() === 'יישוב') {
          const rect = tab.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
    }
    return null;
  });
  
  if (tabRect) {
    // Use actual mouse click on the tab coordinates
    await page.mouse.click(tabRect.x, tabRect.y);
  } else {
    // Fallback to evaluate click
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('li');
      for (const tab of tabs) {
        if ((tab as HTMLElement).innerText?.trim() === 'יישוב') {
          (tab as HTMLElement).click();
          break;
        }
      }
    });
  }
  
  // Wait for tab content to load
  await delay(3000);
  
  // Verify the tab switched - check if DownshiftDropdown (City input) appeared
  const switched = await page.evaluate(() => {
    const cityInput = document.querySelector(
      '[class*="DownshiftDropdown__AutocompleteWrapper"] input, ' +
      '[class*="DownshiftDropdown__TextInput"]'
    );
    return cityInput !== null;
  });
  
  return switched;
}

// ============================================
// STEP 1: Search medications 
// Type 3 letters, wait for autocomplete, add more letters
// Uses downshift autocomplete: #downshift-0-input
// ============================================
async function searchMedications(page: Page, searchTerm: string): Promise<string[]> {
  await page.goto(CLALIT_PHARMACY_URL, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT });
  await delay(5000); // Wait for React to fully initialize

  // Wait for React to initialize - try up to 10 attempts (20 seconds)
  let inputSelector: string | null = null;
  for (let attempt = 0; attempt < 10 && !inputSelector; attempt++) {
    await delay(2000);
    
    inputSelector = await page.evaluate(() => {
      const input1 = document.querySelector('#downshift-0-input');
      if (input1) return '#downshift-0-input';
      
      const input2 = document.querySelector('[class*="DsMedicineSearch"] input') as HTMLInputElement;
      if (input2) return input2.id ? `#${input2.id}` : '[class*="DsMedicineSearch"] input';
      
      return null;
    });
  }
  
  if (!inputSelector) {
    return [];
  }
  
  // Focus and clear
  await page.focus(inputSelector);
  await page.evaluate((sel) => {
    const input = document.querySelector(sel) as HTMLInputElement;
    if (input) input.value = '';
  }, inputSelector);
  await delay(200);

  // Type first 3 letters
  const first3 = searchTerm.slice(0, 3).toUpperCase();
  for (const char of first3) {
    await page.type(inputSelector, char, { delay: TYPING_DELAY });
  }

  // Wait for autocomplete to appear
  await delay(1500);

  // Type remaining letters if any
  const remaining = searchTerm.slice(3).toUpperCase();
  if (remaining.length > 0) {
    for (const char of remaining) {
      await page.type(inputSelector, char, { delay: TYPING_DELAY });
    }
    await delay(1000);
  }

  // Get ALL autocomplete suggestions from the dropdown
  const medications = await page.evaluate(() => {
    const results: string[] = [];
    
    // Downshift autocomplete - get all items from the menu
    const selectors = [
      '#downshift-0-menu li',
      '#downshift-0-menu [role="option"]',
      '[role="listbox"] [role="option"]',
      '[id*="downshift-0"] li',
      '[aria-labelledby*="downshift-0"] li',
    ];
    
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length > 0) {
        items.forEach((item) => {
          const text = (item as HTMLElement).innerText?.trim();
          if (text && text.length > 0 && !results.includes(text)) {
            results.push(text);
          }
        });
        if (results.length > 0) break;
      }
    }
    return results;
  });

  // Return ALL options so user can choose
  return medications;
}

// ============================================
// STEP 2: Get cities (also downshift autocomplete)
// Uses dynamic detection since downshift IDs can change
// ============================================
async function getCities(page: Page): Promise<string[]> {
  if (cachedCities.length > 0) {
    return cachedCities;
  }

  await page.goto(CLALIT_PHARMACY_URL, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT });
  await delay(2000); // Wait for React to initialize
  
  // Click "יישוב" tab using MOUSE CLICK
  let tabClicked = false;
  for (let attempt = 0; attempt < 3 && !tabClicked; attempt++) {
    // Get tab position and use mouse click (more reliable)
    const tabRect = await page.evaluate(() => {
      const container = document.querySelector('[class*="TabMenu__TabsContainer"]');
      if (container) {
        const tabs = container.querySelectorAll('li');
        for (const tab of tabs) {
          if ((tab as HTMLElement).innerText?.trim() === 'יישוב') {
            const rect = tab.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
      }
      return null;
    });
    
    if (tabRect) {
      await page.mouse.click(tabRect.x, tabRect.y);
    }
    
    await delay(3000);
    
    // Verify the CITY input appeared (DownshiftDropdown ONLY - NOT DownshiftSearchSelect!)
    tabClicked = await page.evaluate(() => {
      // ONLY look for DownshiftDropdown - this is the City tab
      // DownshiftSearchSelect is the Pharmacy tab (wrong!)
      const cityInput = document.querySelector(
        '[class*="DownshiftDropdown__AutocompleteWrapper"] input, ' +
        '[class*="DownshiftDropdown__TextInput"]'
      );
      return cityInput !== null;
    });
    
    if (!tabClicked) {
      await delay(1000);
    }
  }

  // Find the city input dynamically
  let cityInputSelector = await findCityInput(page);
  
  if (!cityInputSelector) {
    // Fallback: Use DownshiftDropdown ONLY (City tab)
    // DO NOT use DownshiftSearchSelect - that's the Pharmacy tab!
    const fallbacks = [
      '[class*="DownshiftDropdown__AutocompleteWrapper"] input',
      '[class*="DownshiftDropdown__TextInput"]',
      '[class*="DownshiftDropdown__SearchContainer"] input',
    ];
    for (const sel of fallbacks) {
      try {
        const element = await page.$(sel);
        if (element) {
          cityInputSelector = sel;
          break;
        }
      } catch {
        // Try next
      }
    }
  }
  
  if (!cityInputSelector) {
    console.error('City input not found');
    return [];
  }
  
  // Wait for city input to be visible (use shorter timeout since we already found it)
  try {
    await page.waitForSelector(cityInputSelector, { timeout: 5000, visible: true });
  } catch {
    // Element might already be visible, continue anyway
  }
  
  // Click on input to open dropdown
  await page.click(cityInputSelector);
  await delay(500);
  
  // Type a common Hebrew letter to get cities (like א)
  await page.type(cityInputSelector, 'א', { delay: 100 });
  await delay(1500);

  // Get cities from autocomplete menu
  const menuId = cityInputSelector.replace('-input', '-menu');
  const cities = await page.evaluate((menuSelector: string) => {
    const results: string[] = [];
    const selectors = [
      `${menuSelector} li`,
      `${menuSelector} [role="option"]`,
      '[role="listbox"] [role="option"]',
    ];
    
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length > 0) {
        items.forEach((item) => {
          const text = (item as HTMLElement).innerText?.trim();
          if (text && text.length > 1 && !results.includes(text)) {
            results.push(text);
          }
        });
        if (results.length > 0) break;
      }
    }
    return results;
  }, menuId);

  // Clear input
  await page.evaluate((sel) => {
    const input = document.querySelector(sel) as HTMLInputElement;
    if (input) input.value = '';
  }, cityInputSelector);

  cachedCities = cities;
  return cities;
}

// Fuzzy match for city names
function fuzzyMatch(input: string, options: string[]): string[] {
  const norm = input.trim();
  const exact = options.find(o => o === norm);
  if (exact) return [exact];
  
  const contains = options.filter(o => o.includes(norm) || norm.includes(o));
  if (contains.length > 0) return contains.slice(0, 5);
  
  const starts = options.filter(o => o.startsWith(norm));
  return starts.slice(0, 5);
}

// Helper: Add one medication to the search using KEYBOARD navigation
async function addMedication(page: Page, medication: string): Promise<string | null> {
  // Wait for React to initialize - try up to 10 attempts (20 seconds)
  let medInputSelector: string | null = null;
  for (let attempt = 0; attempt < 10 && !medInputSelector; attempt++) {
    await delay(2000);
    
    medInputSelector = await page.evaluate(() => {
      const input1 = document.querySelector('#downshift-0-input');
      if (input1) return '#downshift-0-input';
      
      const input2 = document.querySelector('[class*="DsMedicineSearch"] input') as HTMLInputElement;
      if (input2) return input2.id ? `#${input2.id}` : '[class*="DsMedicineSearch"] input';
      
      return null;
    });
  }
  
  if (!medInputSelector) {
    return null;
  }
  
  await page.click(medInputSelector);
  await delay(200);
  await page.focus(medInputSelector);
  await delay(300);

  // Clear input
  await page.evaluate((sel) => {
    const input = document.querySelector(sel) as HTMLInputElement;
    if (input) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, medInputSelector);
  await delay(200);

  // Type medication name (first 3 letters, wait, then rest)
  const medFirst3 = medication.slice(0, 3);
  for (const char of medFirst3) {
    await page.type(medInputSelector, char, { delay: TYPING_DELAY });
  }
  await delay(2000); // Wait for autocomplete
  
  const medRemaining = medication.slice(3);
  if (medRemaining.length > 0) {
    for (const char of medRemaining) {
      await page.type(medInputSelector, char, { delay: TYPING_DELAY });
    }
  }
  await delay(2000); // Wait for autocomplete to update

  // Get all autocomplete options
  const autocompleteOptions = await page.evaluate(() => {
    const items = document.querySelectorAll('#downshift-0-menu li, [role="listbox"] [role="option"]');
    return Array.from(items).map(item => (item as HTMLElement).innerText?.trim()).filter(Boolean);
  });

  if (autocompleteOptions.length === 0) {
    return null;
  }

  // Find the best matching medication
  let targetIndex = 0;
  const exactMatchIndex = autocompleteOptions.findIndex(opt => opt === medication);
  if (exactMatchIndex >= 0) {
    targetIndex = exactMatchIndex;
  } else {
    const partialMatchIndex = autocompleteOptions.findIndex(opt => 
      opt.includes(medication) || medication.includes(opt)
    );
    if (partialMatchIndex >= 0) {
      targetIndex = partialMatchIndex;
    }
  }
  
  const medSelected = autocompleteOptions[targetIndex];
  
  // Use keyboard to navigate and select
  // Press ArrowDown to navigate to the target option
  for (let i = 0; i <= targetIndex; i++) {
    await page.keyboard.press('ArrowDown');
    await delay(100);
  }
  await delay(300);
  
  // Press Enter to SELECT the highlighted option
  await page.keyboard.press('Enter');
  await delay(1000);

  return medSelected;
}

// ============================================
// Find CITY input on the "יישוב" tab
// IMPORTANT: City tab uses DownshiftDropdown__* (NOT DownshiftSearchSelect__*)
// DownshiftSearchSelect is for "בית מרקחת" (Pharmacy) tab!
// ============================================
async function findCityInput(page: Page): Promise<string | null> {
  // ONLY look for DownshiftDropdown - this is the CITY tab input!
  // DownshiftSearchSelect is the WRONG tab (Pharmacy tab)
  const cssSelectors = [
    // PRIMARY: DownshiftDropdown = City tab (יישוב)
    '[class*="DownshiftDropdown__AutocompleteWrapper"] input',
    '[class*="DownshiftDropdown__TextInput"]',
    '[class*="DownshiftDropdown__SearchContainer"] input',
  ];
  
  for (const sel of cssSelectors) {
    try {
      const element = await page.$(sel);
      if (element) {
        return sel;
      }
    } catch {
      // Continue to next selector
    }
  }
  
  // Fallback: Find by evaluating the DOM
  const selector = await page.evaluate(() => {
    // 1. Look for DownshiftDropdown wrapper ONLY (City tab)
    const dropdownWrapper = document.querySelector('[class*="DownshiftDropdown__AutocompleteWrapper"]');
    if (dropdownWrapper) {
      const input = dropdownWrapper.querySelector('input');
      if (input) {
        const id = (input as HTMLInputElement).id;
        return id ? `#${id}` : '[class*="DownshiftDropdown__AutocompleteWrapper"] input';
      }
    }
    
    // 2. Look for input with placeholder containing "יישוב" or "להקליד"
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      const placeholder = (input as HTMLInputElement).placeholder || '';
      if (placeholder.includes('יישוב') || placeholder.includes('להקליד את שם היישוב')) {
        const id = (input as HTMLInputElement).id;
        return id ? `#${id}` : null;
      }
    }
    
    return null;
  });
  
  return selector;
}

// ============================================
// STEP 3: Check stock - select medication(s), city, click בדיקת מלאי
// Supports MULTIPLE medications!
// ============================================
async function checkMedicationStock(
  page: Page,
  city: string,
  medications: string[]
): Promise<{ 
  found: boolean; 
  pharmacies: Array<{ name: string; address: string; phone?: string; stock?: string; clalitCode?: string }>; 
  message: string; 
  selectedMedications: string[];
  city?: string;
  error?: string;
  debug?: string;
}> {
  
  await page.goto(CLALIT_PHARMACY_URL, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT });
  await delay(5000); // Wait for React to fully initialize

  // ========================================
  // IMPORTANT: Order matters!
  // 1. Click city tab FIRST
  // 2. Enter city 
  // 3. Add medications LAST
  // If we add meds first, they get cleared when switching tabs!
  // ========================================
  
  // Declare selectedMeds array (will be populated after city is selected)
  let selectedMeds: string[] = [];

  // 1. Click "יישוב" TAB using MOUSE CLICK (BEFORE adding medications!)
  let cityTabClicked = false;
  for (let attempt = 0; attempt < 3 && !cityTabClicked; attempt++) {
    // Get tab position and use mouse click (more reliable)
    const tabRect = await page.evaluate(() => {
      const container = document.querySelector('[class*="TabMenu__TabsContainer"]');
      if (container) {
        const tabs = container.querySelectorAll('li');
        for (const tab of tabs) {
          if ((tab as HTMLElement).innerText?.trim() === 'יישוב') {
            const rect = tab.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
      }
      return null;
    });
    
    if (tabRect) {
      await page.mouse.click(tabRect.x, tabRect.y);
    }
    
    await delay(5000); // Wait longer for tab switch
    
    // Verify the CITY input appeared (DownshiftDropdown ONLY!)
    cityTabClicked = await page.evaluate(() => {
      // ONLY DownshiftDropdown - NOT DownshiftSearchSelect (that's Pharmacy tab)
      const cityInput = document.querySelector(
        '[class*="DownshiftDropdown__AutocompleteWrapper"] input, ' +
        '[class*="DownshiftDropdown__TextInput"]'
      );
      return cityInput !== null;
    });
    
    if (!cityTabClicked) {
      await delay(1000);
    }
  }
  
  if (!cityTabClicked) {
    return {
      found: false,
      pharmacies: [],
      selectedMedications: selectedMeds,
      message: 'לא הצלחנו לעבור ללשונית יישוב',
      debug: 'City tab switch failed - city input not found after clicking tab',
    };
  }

  // 3. Find the city input dynamically (DownshiftDropdown ONLY!)
  let cityInputSelector = await findCityInput(page);
  if (!cityInputSelector) {
    // Fallback - DownshiftDropdown ONLY (City tab)
    // DO NOT use DownshiftSearchSelect - that's the Pharmacy tab!
    const fallbacks = [
      '[class*="DownshiftDropdown__AutocompleteWrapper"] input',
      '[class*="DownshiftDropdown__TextInput"]',
      '[class*="DownshiftDropdown__SearchContainer"] input',
    ];
    for (const sel of fallbacks) {
      const exists = await page.$(sel);
      if (exists) {
        cityInputSelector = sel;
        break;
      }
    }
  }

  if (!cityInputSelector) {
    return {
      found: false,
      pharmacies: [],
      selectedMedications: selectedMeds,
      message: 'לא נמצא שדה קלט לעיר',
      debug: 'City input not found after clicking tab',
    };
  }

  // Wait for city input - retry with dynamic selector if needed
  let cityInputFound = false;
  for (let attempt = 0; attempt < 5 && !cityInputFound; attempt++) {
    await delay(2000);
    
    // Check if selector exists
    const exists = await page.$(cityInputSelector);
    if (exists) {
      cityInputFound = true;
      break;
    }
    
    // Try to find dynamically
    const dynamicSelector = await page.evaluate(() => {
      // Look for DownshiftDropdown input (City tab)
      const dropdown = document.querySelector('[class*="DownshiftDropdown__AutocompleteWrapper"] input');
      if (dropdown) {
        const id = (dropdown as HTMLInputElement).id;
        return id ? `#${id}` : '[class*="DownshiftDropdown__AutocompleteWrapper"] input';
      }
      
      // Find any downshift input that's not the medication input
      const inputs = document.querySelectorAll('input[id*="downshift"]');
      for (const input of inputs) {
        const id = (input as HTMLInputElement).id;
        // Skip downshift-0 (medication)
        if (id && !id.includes('-0-')) {
          const parent = input.closest('[class*="DsMedicineSearch"]');
          if (!parent) {
            return `#${id}`;
          }
        }
      }
      return null;
    });
    
    if (dynamicSelector) {
      cityInputSelector = dynamicSelector;
      const exists2 = await page.$(cityInputSelector);
      if (exists2) {
        cityInputFound = true;
        break;
      }
    }
  }
  
  if (!cityInputFound) {
    return {
      found: false,
      pharmacies: [],
      selectedMedications: selectedMeds,
      city: city,
      error: 'city_input_not_found',
      message: 'לא נמצא שדה קלט לעיר - יש לנסות שוב',
      debug: `City input selector ${cityInputSelector} not found after 5 attempts`,
    };
  }
  await delay(500);
  
  // Click and focus on city input
  await page.click(cityInputSelector);
  await delay(300);
  await page.focus(cityInputSelector);
  await delay(200);
  
  // Clear any existing value
  await page.evaluate((sel) => {
    const input = document.querySelector(sel) as HTMLInputElement;
    if (input) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, cityInputSelector);
  await delay(300);

  // 4. Type city name letter by letter (Hebrew)
  // Type first 3 letters
  const cityFirst3 = city.slice(0, 3);
  for (const char of cityFirst3) {
    await page.type(cityInputSelector, char, { delay: TYPING_DELAY });
  }
  await delay(2000); // Wait for autocomplete
  
  // Type remaining letters
  const cityRemaining = city.slice(3);
  if (cityRemaining.length > 0) {
    for (const char of cityRemaining) {
      await page.type(cityInputSelector, char, { delay: TYPING_DELAY });
    }
  }
  await delay(2000); // Wait for autocomplete to update

  // 5. MUST select city from autocomplete list using KEYBOARD navigation
  // This is more reliable with downshift than clicking
  const menuId = cityInputSelector.replace('-input', '-menu');
  
  // First, check if autocomplete options exist
  // Use multiple selectors including the actual class names from the website
  const autocompleteOptions = await page.evaluate((menuSelector: string) => {
    const selectors = [
      // Specific menu selector from input ID
      `${menuSelector} li`,
      `${menuSelector} [role="option"]`,
      // DownshiftDropdown (City tab - PRIMARY)
      '[class*="DownshiftDropdown"] ul li',
      '[class*="DownshiftDropdown"] [role="option"]',
      // DownshiftDropdown fallback
      '[class*="DownshiftDropdown"] ul li',
      '[class*="DownshiftDropdown"] [role="option"]',
      // Generic listbox
      '[role="listbox"] [role="option"]',
      '[role="listbox"] li',
      // Any downshift menu
      '[id*="downshift-"][id*="-menu"] li',
    ];
    
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length > 0) {
        return Array.from(items).map(item => (item as HTMLElement).innerText?.trim()).filter(Boolean);
      }
    }
    return [];
  }, menuId);

  if (autocompleteOptions.length === 0) {
    return {
      found: false,
      pharmacies: [],
      selectedMedications: selectedMeds,
      message: `לא נמצאה העיר "${city}" ברשימת ההשלמה האוטומטית`,
      debug: `City autocomplete empty after typing "${city}". Input: ${cityInputSelector}, Menu: ${menuId}`,
    };
  }

  // Find the best matching city in the list
  let targetIndex = 0;
  const exactMatchIndex = autocompleteOptions.findIndex(opt => opt === city);
  if (exactMatchIndex >= 0) {
    targetIndex = exactMatchIndex;
  } else {
    const partialMatchIndex = autocompleteOptions.findIndex(opt => opt.includes(city) || city.includes(opt));
    if (partialMatchIndex >= 0) {
      targetIndex = partialMatchIndex;
    }
  }
  
  const citySelected = autocompleteOptions[targetIndex];
  
  // Use keyboard to navigate to the correct option and select it
  // Press ArrowDown to navigate to the target option (starting from 0)
  for (let i = 0; i <= targetIndex; i++) {
    await page.keyboard.press('ArrowDown');
    await delay(100);
  }
  await delay(300);
  
  // Press Enter to select the highlighted option
  await page.keyboard.press('Enter');
  await delay(1500);

  // Verify the city was selected by checking if input has the value or a tag was created
  const cityConfirmed = await page.evaluate((selectedCity: string, inputSel: string) => {
    // Check if input value matches
    const input = document.querySelector(inputSel) as HTMLInputElement;
    if (input && input.value.includes(selectedCity.substring(0, 3))) {
      return true;
    }
    // Check if a tag/chip was created with the city name
    const tags = document.querySelectorAll('[class*="tag"], [class*="Tag"], [class*="chip"], [class*="Chip"], [class*="pill"], [class*="Pill"]');
    for (const tag of tags) {
      if ((tag as HTMLElement).innerText?.includes(selectedCity.substring(0, 3))) {
        return true;
      }
    }
    return false;
  }, citySelected, cityInputSelector);

  if (!cityConfirmed) {
    // Fallback: try clicking directly on the first autocomplete option
    await page.evaluate((menuSelector: string) => {
      const selectors = [
        `${menuSelector} li`,
        `${menuSelector} [role="option"]`,
        '[class*="DownshiftDropdown"] ul li',
        '[class*="DownshiftDropdown"] [role="option"]',
        '[class*="DownshiftDropdown"] ul li',
        '[role="listbox"] [role="option"]',
        '[role="listbox"] li',
      ];
      for (const sel of selectors) {
        const item = document.querySelector(sel);
        if (item) {
          (item as HTMLElement).click();
          return;
        }
      }
    }, menuId);
    await delay(1000);
  }

  // ========================================
  // 5. Add ALL medications AFTER city is selected
  // This is crucial - medications get cleared when switching tabs!
  // ========================================
  for (const medication of medications) {
    const selected = await addMedication(page, medication);
    if (selected) {
      selectedMeds.push(selected);
    }
    await delay(800);
  }

  // 6. Click "בדיקת מלאי" button using MOUSE CLICK (more human-like)
  // First scroll button into view
  await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"].Button__Btn-sc-8shcgr-0') ||
                document.querySelector('button.Button__Btn-sc-8shcgr-0') ||
                document.querySelector('button[type="submit"]');
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  await delay(500);
  
  // Get button position for mouse click
  const buttonInfo = await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"].Button__Btn-sc-8shcgr-0') ||
                document.querySelector('button.Button__Btn-sc-8shcgr-0') ||
                document.querySelector('button[type="submit"]');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      return {
        found: true,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        text: (btn as HTMLElement).innerText?.trim()
      };
    }
    return { found: false, x: 0, y: 0, text: '' };
  });
  
  if (!buttonInfo.found) {
    return {
      found: false,
      pharmacies: [],
      selectedMedications: selectedMeds,
      message: 'לא נמצא כפתור בדיקת מלאי',
      debug: 'Check stock button not found',
    };
  }
  
  // Click button using REAL MOUSE (simulates human behavior)
  await page.mouse.move(buttonInfo.x, buttonInfo.y, { steps: 5 });
  await delay(200);
  await page.mouse.click(buttonInfo.x, buttonInfo.y);

  // Wait for results to load
  await delay(7000);

  // 7. Get results using CORRECT selectors from the website HTML structure
  const results = await page.evaluate(() => {
    const pharmacies: Array<{ name: string; address: string; phone?: string; stock?: string; clalitCode?: string }> = [];
    
    // Check for error messages first
    const bodyText = document.body?.innerText || '';
    if (bodyText.includes('משהו השתבש') || bodyText.includes('שגיאה') || bodyText.includes('לנסות שוב')) {
      return { 
        pharmacies: [], 
        error: 'server_error',
        msg: 'שגיאת שרת - יש לנסות שוב מאוחר יותר',
        bodyText: bodyText.substring(0, 500)
      };
    }
    
    // Check for "no stock" message
    if (bodyText.includes('לא נמצא מלאי') || bodyText.includes('לא נמצאו') || bodyText.includes('אין מלאי')) {
      return {
        pharmacies: [],
        error: 'no_stock',
        msg: 'לא נמצא מלאי בבתי מרקחת בעיר זו',
        bodyText: bodyText.substring(0, 500)
      };
    }
    
    // PRIMARY: Use the CORRECT selectors from the website's HTML structure
    const pharmacyCards = document.querySelectorAll('[class*="PharmacyCard__PharmacyCardContainer"]');
    
    pharmacyCards.forEach((card) => {
      // Get card text and parse it
      const fullText = (card as HTMLElement).innerText?.trim() || '';
      const lines = fullText.split('\n').filter(l => l.trim());
      
      // Find key information
      let stock = '';
      let name = '';
      let address = '';
      let phone = '';
      let clalitCode = '';
      
      // Try to extract pharmacy code from links in the card
      const links = card.querySelectorAll('a[href*="ddeptcode"], a[href*="clinicdetails"]');
      links.forEach(link => {
        const href = (link as HTMLAnchorElement).href || '';
        const match = href.match(/ddeptcode=(\d+)/);
        if (match) {
          clalitCode = match[1];
        }
      });
      
      // Also check for data attributes or hidden inputs
      if (!clalitCode) {
        const dataCode = card.getAttribute('data-code') || 
                         card.getAttribute('data-id') ||
                         card.getAttribute('data-pharmacy-id');
        if (dataCode) clalitCode = dataCode;
      }
      
      // Check buttons with onclick or data attributes
      if (!clalitCode) {
        const buttons = card.querySelectorAll('button, a');
        buttons.forEach(btn => {
          const onclick = btn.getAttribute('onclick') || '';
          const dataId = btn.getAttribute('data-id') || btn.getAttribute('data-code') || '';
          const match = onclick.match(/(\d{5,6})/);
          if (match) clalitCode = match[1];
          if (dataId && /^\d{5,6}$/.test(dataId)) clalitCode = dataId;
        });
      }
      
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed === 'במלאי' || trimmed === 'אזל מהמלאי') {
          stock = trimmed;
        } else if (trimmed.includes('בית מרקחת') && !name) {
          // Only take first occurrence of pharmacy name
          name = trimmed;
        } else if (/^\d{9,10}$/.test(trimmed.replace(/[-\s]/g, ''))) {
          phone = trimmed;
        }
      });
      
      // Extract address from lines after name
      if (name) {
        const nameIdx = lines.findIndex(l => l.includes('בית מרקחת'));
        if (nameIdx >= 0 && nameIdx + 1 < lines.length) {
          for (let i = nameIdx + 1; i < lines.length && i < nameIdx + 3; i++) {
            const line = lines[i].trim();
            if (line.length > 5 && !line.includes('למידע') && !line.includes('מזמינים') && !/^\d{9,10}$/.test(line.replace(/[-\s]/g, ''))) {
              address = line;
              break;
            }
          }
        }
      }
      
      if (name && name.length > 2) {
        pharmacies.push({ name, address, phone, stock, clalitCode });
      }
    });

    // Get message if any
    const msgEl = document.querySelector('[class*="message"], [class*="Message"], [class*="status"], [class*="Status"]');
    const msg = msgEl ? (msgEl as HTMLElement).innerText?.trim() : '';

    return { 
      pharmacies, 
      error: null,
      msg,
      bodyText: bodyText.substring(0, 500)
    };
  });

  // Handle server error
  if (results.error === 'server_error') {
    return {
      found: false,
      pharmacies: [],
      selectedMedications: selectedMeds,
      city: citySelected,
      error: 'server_error',
      message: 'שגיאת שרת באתר כללית - יש לנסות שוב מאוחר יותר',
      debug: `Website returned error: ${results.bodyText.substring(0, 200)}`,
    };
  }

  // Handle no stock
  if (results.error === 'no_stock') {
    return {
      found: false,
      pharmacies: [],
      selectedMedications: selectedMeds,
      city: citySelected,
      error: 'no_stock',
      message: `לא נמצא מלאי עבור ${selectedMeds.join(', ')} בבתי מרקחת ב${citySelected}`,
    };
  }

  return {
    found: results.pharmacies.length > 0,
    pharmacies: results.pharmacies,
    selectedMedications: selectedMeds,
    city: citySelected,
    message: results.pharmacies.length > 0 
      ? `נמצאו ${results.pharmacies.length} בתי מרקחת עם מלאי עבור ${selectedMeds.join(', ')} ב${citySelected}` 
      : results.msg || `לא נמצאו תוצאות עבור ${selectedMeds.join(', ')} ב${citySelected}`,
    debug: !results.pharmacies.length ? `Body: ${results.bodyText.substring(0, 200)}` : undefined,
  };
}

// MCP Server
const server = new Server(
  { name: "clalit-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_cities",
      description: "קבלת רשימת כל הערים הזמינות לחיפוש בתי מרקחת של כללית. Get list of all available cities (in Hebrew) for pharmacy search.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "find_city",
      description: "חיפוש עיר לפי שם (תומך בחיפוש חלקי). Find a city by name with fuzzy matching. Use this if user provides approximate city name.",
      inputSchema: {
        type: "object",
        properties: { city_name: { type: "string", description: "שם העיר לחיפוש (מלא או חלקי) - City name to search for" } },
        required: ["city_name"],
      },
    },
    {
      name: "search_medications",
      description: `חיפוש תרופות לפי שם - מחזיר רשימת תרופות עם מינונים שונים.
IMPORTANT WORKFLOW:
1. Search returns medications with DIFFERENT DOSAGES (e.g., CONCERTA 18MG, 27MG, 36MG, 54MG)
2. YOU MUST ASK THE USER which specific dosage they need before checking stock
3. Show user a numbered list of available dosages and ask them to choose
4. Only after user confirms the dosage, proceed to check_medication_stock_radius`,
      inputSchema: {
        type: "object",
        properties: { search_term: { type: "string", description: "שם התרופה לחיפוש (באנגלית) - Medication name to search for (in English, e.g., 'concerta', 'ozempic', 'ritalin')" } },
        required: ["search_term"],
      },
    },
    {
      name: "check_medication_stock",
      description: "בדיקת זמינות תרופה בעיר ספציפית. Check medication stock in a SPECIFIC city only. For radius-based search use check_medication_stock_radius instead.",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string", description: "שם העיר (בעברית) - City name in Hebrew (e.g., פתח תקווה)" },
          medications: { 
            type: "array", 
            items: { type: "string" },
            description: "רשימת תרופות לבדיקה - EXACT medication names from search_medications including dosage (e.g., ['CONCERTA ER TAB 36MG 30'])" 
          },
        },
        required: ["city", "medications"],
      },
    },
    {
      name: "check_medication_stock_radius",
      description: `בדיקת זמינות תרופות ברדיוס מהכתובת שלך - הכלי המומלץ לשימוש!
RECOMMENDED WORKFLOW:
1. First use search_medications to find exact medication names with dosages
2. ASK USER which dosage they need (show numbered list)
3. ASK USER for their address (city + street for better accuracy)
4. ASK USER if default 5km radius is OK, or if they want different radius
5. Call this tool with the confirmed parameters
6. Results show PRIORITY pharmacies (those with ALL requested medications) first!

OUTPUT: Returns table-formatted results with:
- 🎯 PRIORITY: Pharmacies with ALL medications (best option - one stop!)
- 📍 Distance from your address
- 📞 Phone numbers
- ⏰ Open/closed status
- ✅/❌ Stock status per medication`,
      inputSchema: {
        type: "object",
        properties: {
          address: { 
            type: "string", 
            description: "כתובת מלאה בעברית - Full address for accurate distance calculation (e.g., 'פתח תקווה רחוב רוטשילד 50' or just 'פתח תקווה')" 
          },
          medications: { 
            type: "array", 
            items: { type: "string" },
            description: "רשימת תרופות - EXACT medication names from search_medications WITH DOSAGE (e.g., ['CONCERTA ER TAB 36MG 30', 'RITALIN LA CAP 20MG 30'])" 
          },
          radius_km: { 
            type: "number", 
            description: "רדיוס חיפוש בק״מ - Search radius in km. DEFAULT: 5. Ask user if they want to change it." 
          },
        },
        required: ["address", "medications"],
      },
    },
    {
      name: "book_appointment",
      description: "הזמנת תור לכללית (רופא, בדיקות דם, אחיות, בית מרקחת, כללית סמייל). דורש כניסה מהירה (ת.ז. + שנת לידה) או פרופיל דפדפן. Book a Clalit appointment. Requires quick login (ID + birth year) or browser profile with session.",
      inputSchema: {
        type: "object",
        properties: {
          appointment_type: { type: "string", description: "סוג תור: doctor / blood_test / nurse / pharmacy / smile (רופא, בדיקות דם, אחיות, בית מרקחת, כללית סמייל)" },
          city_or_region: { type: "string", description: "עיר או אזור (בעברית) - City or region in Hebrew" },
        },
        required: ["appointment_type"],
      },
    },
    {
      name: "check_appointment",
      description: "בדיקת התורים שלי / הצגת תורים קרובים. Check my appointments or list upcoming appointments. Uses quick login or browser profile.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "cancel_appointment",
      description: "ביטול תור. דורש כניסה מלאה (SMS או פרופיל דפדפן עם סשן). Cancel an appointment. Requires full login (SMS or browser profile with session).",
      inputSchema: {
        type: "object",
        properties: {
          appointment_id_or_date: { type: "string", description: "מזהה תור או תאריך התור - Appointment ID or date" },
        },
        required: ["appointment_id_or_date"],
      },
    },
    {
      name: "request_certificate_or_prescription",
      description: "הזמנת אישור או מרשם מהמרפאה. דורש כניסה מלאה (SMS או פרופיל). Request a certificate or prescription. Requires full login.",
      inputSchema: {
        type: "object",
        properties: {
          request_type: { type: "string", description: "certificate / prescription - סוג הבקשה" },
          details: { type: "string", description: "פרטים נוספים (אופציונלי)" },
        },
        required: ["request_type"],
      },
    },
  ],
}));

const VISIBLE_AUTH_PAGE_KEEP_OPEN_MS = 120000; // 2 minutes for user to complete SMS login

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  let page: Page | null = null;
  let closePageAfterMs = 0;

  try {
    const browser = await getBrowser();
    page = await createPage(browser);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "he-IL,he;q=0.9" });

    switch (name) {
      case "list_cities": {
        const cities = await getCities(page);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, total_cities: cities.length, cities, message: `נמצאו ${cities.length} ערים זמינות` }, null, 2) }] };
      }

      case "find_city": {
        const { city_name: cityName } = requireArgs<{ city_name: string }>(args, ["city_name"]);
        const cities = await getCities(page);
        const matches = fuzzyMatch(cityName, cities);
        return { content: [{ type: "text", text: JSON.stringify({ success: matches.length > 0, suggestions: matches, message: matches.length > 0 ? `נמצאו ${matches.length} התאמות:` : 'לא נמצאו התאמות' }, null, 2) }] };
      }

      case "search_medications": {
        const { search_term: searchTerm } = requireArgs<{ search_term: string }>(args, ["search_term"]);
        const medications = await searchMedications(page, searchTerm);
        
        // Format as numbered list for easy selection
        const medicationsList = medications.map((med, idx) => ({
          number: idx + 1,
          name: med,
          // Try to extract dosage from name
          dosage: med.match(/\d+\s*MG|\d+\s*MCG|\d+\s*ML/i)?.[0] || 'N/A',
        }));
        
        // Build table string
        let tableOutput = '\n| # | תרופה / Medication | מינון / Dosage |\n|---|-------------------|----------------|\n';
        medicationsList.forEach(med => {
          tableOutput += `| ${med.number} | ${med.name} | ${med.dosage} |\n`;
        });
        
        const response = {
          success: medications.length > 0,
          search_term: searchTerm,
          total_results: medications.length,
          medications_table: tableOutput,
          medications_list: medicationsList,
          action_required: medications.length > 0 
            ? '⚠️ ACTION REQUIRED: Ask user which medication/dosage they need! Show them the table and ask for the number.'
            : null,
          next_step: medications.length > 0
            ? 'After user selects, ask for their address and if 5km radius is OK'
            : 'Try a different search term',
          message: medications.length > 0 
            ? `נמצאו ${medications.length} אפשרויות. יש לבחור את המינון הנכון:`
            : 'לא נמצאו תרופות. נסה מונח חיפוש אחר.',
        };
        
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
      }

      case "check_medication_stock": {
        const { city, medications } = requireArgs<{ city: string; medications: string[] }>(args, ["city", "medications"]);
        // Use cached cities if available, otherwise skip validation and let the autocomplete handle it
        let cityToUse = city;
        if (cachedCities.length > 0) {
          const cityMatch = fuzzyMatch(city, cachedCities);
          if (cityMatch.length > 0) {
            cityToUse = cityMatch[0];
          }
        }
        const result = await checkMedicationStock(page, cityToUse, medications);
        
        // Build table output
        let pharmacyTable = `\n### 🏥 בתי מרקחת ב${cityToUse} / Pharmacies in ${cityToUse}\n\n`;
        
        if (result.pharmacies.length > 0) {
          pharmacyTable += '| 🏥 בית מרקחת | 📍 כתובת | 📞 טלפון | 📦 מלאי | 🗺️ ניווט | ℹ️ |\n';
          pharmacyTable += '|--------------|----------|----------|---------|----------|----|\n';
          result.pharmacies.forEach(p => {
            const stock = p.stock === 'במלאי' ? '✅ במלאי' : (p.stock === 'אזל מהמלאי' ? '❌ אזל' : p.stock || '?');
            const wazeLink = generateWazeLink(p.address, cityToUse);
            const clalitLink = p.clalitCode ? generateClalitLink(p.clalitCode) : null;
            pharmacyTable += `| ${p.name} | ${p.address} | ${p.phone || '-'} | ${stock} | [🗺️](${wazeLink}) | ${clalitLink ? `[ℹ️](${clalitLink})` : '-'} |\n`;
          });
        } else {
          pharmacyTable += '❌ לא נמצאו בתי מרקחת עם מלאי בעיר זו\n';
        }
        
        return { content: [{ type: "text", text: JSON.stringify({ 
          success: result.found, 
          city: cityToUse, 
          medications_requested: medications,
          medications_selected: result.selectedMedications,
          pharmacies_found: result.pharmacies.length,
          table: pharmacyTable,
          pharmacies: result.pharmacies, 
          message: result.message,
          tip: result.pharmacies.length === 0 ? '💡 נסה לחפש ברדיוס רחב יותר עם check_medication_stock_radius' : null,
          ...(result.debug ? { debug: result.debug } : {}),
        }, null, 2) }] };
      }

      case "check_medication_stock_radius": {
        const { address, medications, radius_km = 5 } = requireArgs<{ address: string; medications: string[]; radius_km?: number }>(args, ["address", "medications"]);
        
        // 1. Geocode user's address
        let userLocation = await geocodeAddress(address);
        if (!userLocation) {
          // Try with just city
          const city = extractCity(address);
          const cityLocation = await geocodeAddress(city);
          if (!cityLocation) {
            return { content: [{ type: "text", text: JSON.stringify({ 
              success: false, 
              error: 'geocoding_failed',
              message: `לא הצלחנו למצוא את הכתובת "${address}"`,
            }, null, 2) }] };
          }
          userLocation = cityLocation;
        }
        
        // 2. Find all cities within radius
        const nearbyCities = findNearbyCities(userLocation.lat, userLocation.lon, radius_km);
        
        if (nearbyCities.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ 
            success: false, 
            address,
            radius_km,
            message: `לא נמצאו ערים ברדיוס ${radius_km} ק"מ מהכתובת`,
          }, null, 2) }] };
        }
        
        // 3. Search each medication in all nearby cities.
        //    Cities run in parallel — each gets its own browser page (tab).
        //    Medications within a city remain sequential to preserve Clalit form state.
        type PharmacyKey = string;
        const pharmacyMedications: Map<PharmacyKey, {
          name: string;
          address: string;
          phone?: string;
          city: string;
          cityDistance: number;
          medications: string[];
          clalitCode?: string;
        }> = new Map();

        const medicationSummary: Record<string, {
          pharmaciesFound: number;
          pharmacies: Array<{ name: string; address: string; city: string }>;
        }> = {};

        const citiesSearched: Array<{ name: string; distance: number; pharmaciesPerMedication: Record<string, number> }> = [];

        // Fan-out: one page per city, all cities searched concurrently
        const cityPageResults = await Promise.all(
          nearbyCities.map(async (cityInfo) => {
            const cityPage = await createPage(browser);
            const pharmaciesPerMedication: Record<string, number> = {};
            const medCounts: Record<string, number> = {};
            const hits: Array<{
              key: string;
              medication: string;
              name: string;
              address: string;
              phone?: string;
              clalitCode?: string;
            }> = [];
            try {
              for (const medication of medications) {
                const stockResult = await checkMedicationStock(cityPage, cityInfo.name, [medication]).catch(() => null);
                pharmaciesPerMedication[medication] = stockResult?.pharmacies?.length || 0;
                medCounts[medication] = 0;
                if (stockResult?.found && stockResult.pharmacies) {
                  medCounts[medication] = stockResult.pharmacies.length;
                  for (const pharmacy of stockResult.pharmacies) {
                    hits.push({
                      key: `${pharmacy.name}|${pharmacy.address}`,
                      medication,
                      name: pharmacy.name,
                      address: pharmacy.address,
                      phone: pharmacy.phone,
                      clalitCode: pharmacy.clalitCode,
                    });
                  }
                }
              }
            } finally {
              await cityPage.close();
            }
            return { cityInfo, pharmaciesPerMedication, medCounts, hits };
          })
        );

        // Merge results from all parallel city searches
        for (const { cityInfo, pharmaciesPerMedication, medCounts, hits } of cityPageResults) {
          citiesSearched.push({ name: cityInfo.name, distance: cityInfo.distance, pharmaciesPerMedication });

          for (const medication of medications) {
            if (!medicationSummary[medication]) {
              medicationSummary[medication] = { pharmaciesFound: 0, pharmacies: [] };
            }
            medicationSummary[medication].pharmaciesFound += medCounts[medication] || 0;
          }

          for (const hit of hits) {
            medicationSummary[hit.medication].pharmacies.push({
              name: hit.name,
              address: hit.address,
              city: cityInfo.name,
            });

            if (pharmacyMedications.has(hit.key)) {
              const existing = pharmacyMedications.get(hit.key)!;
              if (!existing.medications.includes(hit.medication)) {
                existing.medications.push(hit.medication);
              }
              if (hit.clalitCode) existing.clalitCode = hit.clalitCode;
            } else {
              pharmacyMedications.set(hit.key, {
                name: hit.name,
                address: hit.address,
                phone: hit.phone,
                city: cityInfo.name,
                cityDistance: cityInfo.distance,
                medications: [hit.medication],
                clalitCode: hit.clalitCode,
              });
            }
          }
        }
        
        // 4. Convert map to array and geocode pharmacies
        const allPharmacies = Array.from(pharmacyMedications.values());
        const pharmaciesWithDistance: Array<PharmacyWithDistance & { 
          city: string; 
          medications: string[];
          hasAllMedications: boolean;
          wazeLink: string;
          clalitLink?: string;
        }> = [];
        
        for (const pharmacy of allPharmacies) {
          const pharmacyAddress = `${pharmacy.address}, Israel`;
          
          // Respect Nominatim rate limit
          await delay(1100);
          
          const location = await geocodeAddress(pharmacyAddress);
          
          const hasAll = pharmacy.medications.length === medications.length;
          const wazeLink = generateWazeLink(pharmacy.address, pharmacy.city);
          const clalitLink = pharmacy.clalitCode ? generateClalitLink(pharmacy.clalitCode) : undefined;
          
          if (location && userLocation) {
            const distance = haversineDistance(
              userLocation.lat, userLocation.lon,
              location.lat, location.lon
            );
            
            pharmaciesWithDistance.push({
              name: pharmacy.name,
              address: pharmacy.address,
              phone: pharmacy.phone,
              clalitCode: pharmacy.clalitCode,
              city: pharmacy.city,
              medications: pharmacy.medications,
              hasAllMedications: hasAll,
              wazeLink,
              clalitLink,
              lat: location.lat,
              lon: location.lon,
              distance: Math.round(distance * 100) / 100,
            });
          } else {
            pharmaciesWithDistance.push({
              name: pharmacy.name,
              address: pharmacy.address,
              phone: pharmacy.phone,
              clalitCode: pharmacy.clalitCode,
              city: pharmacy.city,
              medications: pharmacy.medications,
              hasAllMedications: hasAll,
              wazeLink,
              clalitLink,
              distance: undefined,
            });
          }
        }
        
        // 5. Filter by radius and sort by distance
        const nearbyPharmacies = pharmaciesWithDistance
          .filter(p => p.distance !== undefined && p.distance <= radius_km)
          .sort((a, b) => (a.distance || 999) - (b.distance || 999));
        
        const pharmaciesWithoutLocation = pharmaciesWithDistance.filter(p => p.distance === undefined);
        
        // 6. Find optimal pharmacies (those that have ALL medications)
        const optimalPharmacies = nearbyPharmacies.filter(p => p.hasAllMedications);
        
        // 7. Create summary by city
        const citySummary: Record<string, { total: number; withAll: number }> = {};
        for (const p of nearbyPharmacies) {
          const city = p.city || 'Unknown';
          if (!citySummary[city]) {
            citySummary[city] = { total: 0, withAll: 0 };
          }
          citySummary[city].total++;
          if (p.hasAllMedications) citySummary[city].withAll++;
        }
        
        // 8. Build formatted table responses
        
        // === MEDICATION SUMMARY TABLE ===
        let medicationSummaryTable = '\n### 📊 סיכום זמינות תרופות / Medication Availability Summary\n\n';
        medicationSummaryTable += '| תרופה / Medication | במלאי ברדיוס / In Stock |\n';
        medicationSummaryTable += '|---------------------|------------------------|\n';
        medications.forEach(med => {
          const count = nearbyPharmacies.filter(p => p.medications.includes(med)).length;
          const status = count > 0 ? `✅ ${count} בתי מרקחת` : '❌ לא נמצא';
          medicationSummaryTable += `| ${med} | ${status} |\n`;
        });
        
        // === PRIORITY TABLE (pharmacies with ALL medications) ===
        let priorityTable = '';
        if (optimalPharmacies.length > 0) {
          priorityTable = `\n### 🎯 עדיפות ראשונה - בתי מרקחת עם כל התרופות! / PRIORITY - All Medications Available!\n\n`;
          priorityTable += '| 📍 מרחק | 🏥 בית מרקחת | 📍 כתובת | 📞 טלפון | 🗺️ ניווט | ℹ️ פרטים |\n';
          priorityTable += '|---------|--------------|----------|----------|----------|----------|\n';
          optimalPharmacies.forEach(p => {
            const dist = p.distance ? `${p.distance} ק"מ` : '?';
            const wazeLink = `[Waze](${p.wazeLink})`;
            const clalitLink = p.clalitLink ? `[כללית](${p.clalitLink})` : '-';
            priorityTable += `| ${dist} | ${p.name} | ${p.address}, ${p.city} | ${p.phone || '-'} | ${wazeLink} | ${clalitLink} |\n`;
          });
        } else if (medications.length > 1) {
          priorityTable = `\n### ⚠️ לא נמצא בית מרקחת עם כל ${medications.length} התרופות ביחד\n`;
          priorityTable += 'תצטרך לבקר בכמה בתי מרקחת. ראה טבלה למטה.\n';
        }
        
        // === ALL PHARMACIES TABLE (sorted by: has all meds first, then by distance) ===
        const sortedPharmacies = [...nearbyPharmacies].sort((a, b) => {
          // First sort by hasAllMedications (true first)
          if (a.hasAllMedications && !b.hasAllMedications) return -1;
          if (!a.hasAllMedications && b.hasAllMedications) return 1;
          // Then by distance
          return (a.distance || 999) - (b.distance || 999);
        });
        
        let allPharmaciesTable = `\n### 📋 כל בתי המרקחת ברדיוס ${radius_km} ק"מ / All Pharmacies in Radius\n\n`;
        
        // Build header with medication columns
        allPharmaciesTable += '| 📍 מרחק | 🏥 בית מרקחת | 📍 עיר | ';
        medications.forEach(med => {
          // Short name for column header (first 15 chars)
          const shortName = med.length > 15 ? med.substring(0, 15) + '...' : med;
          allPharmaciesTable += `${shortName} | `;
        });
        allPharmaciesTable += '📞 טלפון | 🗺️ |\n';
        
        // Separator
        allPharmaciesTable += '|---------|--------------|------|';
        medications.forEach(() => { allPharmaciesTable += '--------|'; });
        allPharmaciesTable += '----------|----|\n';
        
        // Data rows
        sortedPharmacies.forEach(p => {
          const dist = p.distance ? `${p.distance}` : '?';
          const priority = p.hasAllMedications ? '🎯' : '';
          
          allPharmaciesTable += `| ${dist} ${priority} | ${p.name} | ${p.city} | `;
          medications.forEach(med => {
            const hasMed = p.medications.includes(med);
            allPharmaciesTable += `${hasMed ? '✅' : '❌'} | `;
          });
          allPharmaciesTable += `${p.phone || '-'} | [🗺️](${p.wazeLink}) |\n`;
        });
        
        // Legend
        allPharmaciesTable += '\n**מקרא:** 🎯 = כל התרופות במלאי | ✅ = במלאי | ❌ = חסר | 🗺️ = ניווט Waze\n';
        
        // === BUILD FINAL RESPONSE ===
        const response: Record<string, unknown> = {
          success: nearbyPharmacies.length > 0, 
          address,
          radius_km,
          medications_requested: medications,
          
          // Formatted tables for display
          tables: {
            medication_summary: medicationSummaryTable,
            priority_pharmacies: priorityTable,
            all_pharmacies: allPharmaciesTable,
          },
          
          // Summary stats
          stats: {
            total_pharmacies_found: nearbyPharmacies.length,
            pharmacies_with_all_medications: optimalPharmacies.length,
            cities_searched: nearbyCities.length,
          },
          
          // Structured data for programmatic access
          optimal_pharmacies: optimalPharmacies.map(p => ({
            name: p.name,
            address: p.address,
            city: p.city,
            phone: p.phone,
            distance_km: p.distance,
            waze_link: p.wazeLink,
            clalit_link: p.clalitLink,
          })),
          
          all_pharmacies: sortedPharmacies.map(p => ({
            priority: p.hasAllMedications ? '🎯 PRIORITY' : '',
            name: p.name,
            address: p.address,
            city: p.city,
            phone: p.phone,
            distance_km: p.distance,
            medications_in_stock: p.medications,
            has_all_medications: p.hasAllMedications,
            waze_link: p.wazeLink,
            clalit_link: p.clalitLink,
          })),
          
          message: nearbyPharmacies.length > 0 
            ? optimalPharmacies.length > 0
              ? `🎯 מצוין! נמצאו ${optimalPharmacies.length} בתי מרקחת עם כל התרופות ברדיוס ${radius_km} ק"מ!`
              : `נמצאו ${nearbyPharmacies.length} בתי מרקחת ברדיוס ${radius_km} ק"מ, אך אין אחד עם כל התרופות`
            : `לא נמצאו בתי מרקחת עם מלאי ברדיוס ${radius_km} ק"מ. נסה להרחיב את הרדיוס.`,
        };
        
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
      }

      case "book_appointment": {
        const config = getConfig();
        const { appointment_type, city_or_region } = (args || {}) as { appointment_type?: string; city_or_region?: string };
        await applyUserCookiesIfConfigured(page);
        await page.goto(CLALIT_QUICK_LOGIN_URL, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT });
        if (config.quickId && config.quickBirthYear) {
          await performQuickLogin(page, config, 3000);
        }
        await page.goto(CLALIT_APPOINTMENTS_QUICK_URL, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT });
        const url = page.url();
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "נפתח דף זימון תורים. השלם את הכניסה אם נדרש ובחר סוג תור ואזור.", url, appointment_type: appointment_type || "any", city_or_region: city_or_region || null, tip: "להזמנת תור עם כניסה מהירה: הגדר CLALIT_QUICK_ID ו-CLALIT_QUICK_BIRTH_YEAR" }, null, 2) }] };
      }

      case "check_appointment": {
        const config = getConfig();
        await applyUserCookiesIfConfigured(page);
        await page.goto(CLALIT_QUICK_LOGIN_URL, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT });
        if (config.quickId && config.quickBirthYear) {
          await performQuickLogin(page, config, 4000);
        }
        await page.goto(CLALIT_APPOINTMENTS_QUICK_URL, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT });
        const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 1500) || "");
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "נפתח דף תורים. אם יש רשימת תורים בדף היא מוצגת למטה.", url: page.url(), page_preview: bodyText.substring(0, 800), tip: "לבדיקת תורים עם פרופיל: הגדר CLALIT_BROWSER_PROFILE לנתיב פרופיל שבו נכנסת לכללית" }, null, 2) }] };
      }

      case "cancel_appointment": {
        const { appointment_id_or_date } = (args || {}) as { appointment_id_or_date?: string };
        await applyUserCookiesIfConfigured(page);
        await page.goto(CLALIT_FULL_LOGIN_URL, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT });
        const config = getConfig();
        if (config.visibleForAuth) closePageAfterMs = VISIBLE_AUTH_PAGE_KEEP_OPEN_MS;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "ביטול תור דורש כניסה מלאה (סיסמה או קוד SMS). נפתח דף הכניסה. השלם התחברות בחלון; הדף יישאר פתוח כ־2 דקות.", url: CLALIT_FULL_LOGIN_URL, appointment_id_or_date: appointment_id_or_date || null, action_required: "הזן קוד SMS בדפדפן אם הופעל במצב גלוי (CLALIT_VISIBLE_FOR_AUTH=1), או השתמש בפרופיל דפדפן עם סשן פעיל (CLALIT_BROWSER_PROFILE).", visible_for_auth: config.visibleForAuth }, null, 2) }] };
      }

      case "request_certificate_or_prescription": {
        const { request_type, details } = (args || {}) as { request_type?: string; details?: string };
        await applyUserCookiesIfConfigured(page);
        await page.goto(CLALIT_FULL_LOGIN_URL, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT });
        const config = getConfig();
        if (config.visibleForAuth) closePageAfterMs = VISIBLE_AUTH_PAGE_KEEP_OPEN_MS;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "הזמנת אישור/מרשם דורשת כניסה מלאה. נפתח דף הכניסה. השלם התחברות בחלון; הדף יישאר פתוח כ־2 דקות.", url: CLALIT_FULL_LOGIN_URL, request_type: request_type || "certificate", details: details || null, action_required: "התחבר עם קוד SMS או השתמש בפרופיל דפדפן (CLALIT_BROWSER_PROFILE). לאחר כניסה ניתן לנווט לשירותי אישורים/מרשמים באתר.", visible_for_auth: config.visibleForAuth }, null, 2) }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, null, 2) }], isError: true };
  } finally {
    if (page) {
      if (closePageAfterMs > 0) await delay(closePageAfterMs);
      await page.close();
    }
  }
});

process.on("SIGINT", async () => { await closeBrowser(); process.exit(0); });
process.on("SIGTERM", async () => { await closeBrowser(); process.exit(0); });

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.info(JSON.stringify({ jsonrpc: "2.0", method: "log", params: { message: "Clalit MCP Server running" } }));
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
