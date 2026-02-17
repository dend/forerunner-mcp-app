/**
 * Xbox Live / Halo Infinite authentication module.
 * Adapted from FilmShell's auth.ts — same encrypted token storage format,
 * same OAuth → Xbox → Spartan token chain.
 */

import { exec } from 'node:child_process';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { hostname, userInfo, platform } from 'node:os';
import { XboxAuthenticationClient } from '@dendotdev/conch';
import {
  HaloAuthenticationClient,
  HaloInfiniteClient,
  isSuccess,
} from '@dendotdev/grunt';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Config {
  clientId: string;
  redirectUri: string;
}

export interface StoredTokens {
  refreshToken: string;
  spartanToken: string;
  spartanTokenExpiry: number;
  xuid: string;
  xblToken?: string;
}

export interface AuthenticatedClient {
  client: HaloInfiniteClient;
  xuid: string;
}

// ---------------------------------------------------------------------------
// Encrypted token storage (binary, AES-256-GCM, same format as FilmShell)
// ---------------------------------------------------------------------------

const CONFIG_PATH = './config.json';
const TOKENS_PATH = './tokens.bin';

// Binary layout: [magic 2B "FS"][version 1B][salt 16B][iv 12B][authTag 16B][ciphertext ...]
const MAGIC = Buffer.from('FS');
const VERSION = 0x01;
const MAGIC_LEN = 2;
const VERSION_LEN = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC_LEN + VERSION_LEN + SALT_LEN + IV_LEN + TAG_LEN;
const AAD = Buffer.from('filmshell-tokens-v1');

function deriveKey(salt: Buffer): Buffer {
  const passphrase = hostname() + userInfo().username;
  return scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      'config.json not found. Copy config.example.json to config.json and set your client ID.',
    );
  }
  const data = readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(data);
}

export async function loadTokens(): Promise<StoredTokens | null> {
  if (!existsSync(TOKENS_PATH)) return null;
  try {
    const buf = await readFile(TOKENS_PATH);
    if (buf.length < HEADER_LEN) throw new Error('File too short');
    if (!buf.subarray(0, MAGIC_LEN).equals(MAGIC)) throw new Error('Bad magic');
    const version = buf[MAGIC_LEN];
    if (version !== VERSION) throw new Error(`Unsupported version: ${version}`);
    let off = MAGIC_LEN + VERSION_LEN;
    const salt = buf.subarray(off, (off += SALT_LEN));
    const iv = buf.subarray(off, (off += IV_LEN));
    const authTag = buf.subarray(off, (off += TAG_LEN));
    const ciphertext = buf.subarray(off);
    const key = deriveKey(salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf-8')) as StoredTokens;
  } catch {
    await unlink(TOKENS_PATH).catch(() => {});
    return null;
  }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  const plaintext = JSON.stringify(tokens);
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const versionBuf = Buffer.of(VERSION);
  await writeFile(TOKENS_PATH, Buffer.concat([MAGIC, versionBuf, salt, iv, authTag, ciphertext]));
}

// ---------------------------------------------------------------------------
// OAuth callback server
// ---------------------------------------------------------------------------

export function waitForAuthCode(redirectUri: string): Promise<string> {
  const url = new URL(redirectUri);
  const port = parseInt(url.port) || 3000;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
      const code = reqUrl.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>',
        );
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Error</h1><p>No authorization code received.</p></body></html>');
      }
    });
    server.listen(port, () => {});
    server.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Browser helper
// ---------------------------------------------------------------------------

function openBrowser(url: string): void {
  const cmd =
    platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} ${JSON.stringify(url)}`);
}

// ---------------------------------------------------------------------------
// Full OAuth → Xbox → Spartan token chain
// ---------------------------------------------------------------------------

async function authenticate(
  config: Config,
): Promise<{ spartanToken: string; xuid: string; refreshToken: string; xblToken: string }> {
  const xboxClient = new XboxAuthenticationClient();

  const authUrl = xboxClient.generateAuthUrl(config.clientId, config.redirectUri);
  console.error('[auth] Opening browser for sign-in...');
  console.error(authUrl);
  openBrowser(authUrl);

  const code = await waitForAuthCode(config.redirectUri);

  const oauthToken = await xboxClient.requestOAuthToken(config.clientId, code, config.redirectUri);
  if (!oauthToken?.access_token) throw new Error('Failed to get OAuth access token');

  const userToken = await xboxClient.requestUserToken(oauthToken.access_token);
  if (!userToken?.Token) throw new Error('Failed to get user token');

  const xboxXstsToken = await xboxClient.requestXstsToken(userToken.Token);
  if (!xboxXstsToken?.Token) throw new Error('Failed to get Xbox XSTS token');

  const xuid = xboxXstsToken.DisplayClaims?.xui?.[0]?.xid;
  const userHash = xboxXstsToken.DisplayClaims?.xui?.[0]?.uhs;
  if (!xuid || !userHash) throw new Error('Failed to get XUID/userHash from Xbox XSTS token');

  const xblToken = `XBL3.0 x=${userHash};${xboxXstsToken.Token}`;

  const relyingParty = HaloAuthenticationClient.getRelyingParty();
  const haloXstsToken = await xboxClient.requestXstsToken(
    userToken.Token,
    relyingParty as 'http://xboxlive.com',
  );
  if (!haloXstsToken?.Token) throw new Error('Failed to get Halo XSTS token');

  const haloAuthClient = new HaloAuthenticationClient();
  const spartanTokenResponse = await haloAuthClient.getSpartanToken(haloXstsToken.Token);
  if (!spartanTokenResponse?.token) throw new Error('Failed to get Spartan token');

  return { spartanToken: spartanTokenResponse.token, xuid, refreshToken: oauthToken.refresh_token ?? '', xblToken };
}

async function refreshAuthentication(
  config: Config,
  refreshToken: string,
): Promise<{ spartanToken: string; xuid: string; refreshToken: string; xblToken: string }> {
  const xboxClient = new XboxAuthenticationClient();

  const oauthToken = await xboxClient.refreshOAuthToken(
    config.clientId,
    refreshToken,
    config.redirectUri,
  );
  if (!oauthToken?.access_token) throw new Error('Failed to refresh OAuth token');

  const userToken = await xboxClient.requestUserToken(oauthToken.access_token);
  if (!userToken?.Token) throw new Error('Failed to get user token');

  const xboxXstsToken = await xboxClient.requestXstsToken(userToken.Token);
  if (!xboxXstsToken?.Token) throw new Error('Failed to get Xbox XSTS token');

  const xuid = xboxXstsToken.DisplayClaims?.xui?.[0]?.xid;
  const userHash = xboxXstsToken.DisplayClaims?.xui?.[0]?.uhs;
  if (!xuid || !userHash) throw new Error('Failed to get XUID/userHash from Xbox XSTS token');

  const xblToken = `XBL3.0 x=${userHash};${xboxXstsToken.Token}`;

  const relyingParty = HaloAuthenticationClient.getRelyingParty();
  const haloXstsToken = await xboxClient.requestXstsToken(
    userToken.Token,
    relyingParty as 'http://xboxlive.com',
  );
  if (!haloXstsToken?.Token) throw new Error('Failed to get Halo XSTS token');

  const haloAuthClient = new HaloAuthenticationClient();
  const spartanTokenResponse = await haloAuthClient.getSpartanToken(haloXstsToken.Token);
  if (!spartanTokenResponse?.token) throw new Error('Failed to get Spartan token');

  return {
    spartanToken: spartanTokenResponse.token,
    xuid,
    refreshToken: oauthToken.refresh_token ?? refreshToken,
    xblToken,
  };
}

// ---------------------------------------------------------------------------
// Public: get (or create) an authenticated HaloInfiniteClient
// ---------------------------------------------------------------------------

let cachedClient: AuthenticatedClient | null = null;
let cachedExpiry = 0;

export async function getOrCreateClient(
  onStatus?: (msg: string) => void,
): Promise<AuthenticatedClient> {
  // Return cached client if still valid
  if (cachedClient && Date.now() < cachedExpiry - 300_000) {
    return cachedClient;
  }

  const log = onStatus ?? ((msg: string) => console.error(`[auth] ${msg}`));
  const config = loadConfig();
  let tokens = await loadTokens();
  let needsAuth = true;

  if (tokens?.spartanToken && tokens.refreshToken) {
    if (tokens.spartanTokenExpiry && Date.now() < tokens.spartanTokenExpiry - 300_000) {
      needsAuth = false;
    } else {
      try {
        log('Refreshing authentication...');
        const refreshed = await refreshAuthentication(config, tokens.refreshToken);
        tokens = {
          refreshToken: refreshed.refreshToken,
          spartanToken: refreshed.spartanToken,
          spartanTokenExpiry: Date.now() + 3_600_000,
          xuid: refreshed.xuid,
          xblToken: refreshed.xblToken,
        };
        await saveTokens(tokens);
        needsAuth = false;
      } catch {
        log('Session expired, re-authenticating...');
      }
    }
  }

  if (needsAuth) {
    log('Waiting for browser sign-in...');
    const authResult = await authenticate(config);
    tokens = {
      refreshToken: authResult.refreshToken,
      spartanToken: authResult.spartanToken,
      spartanTokenExpiry: Date.now() + 3_600_000,
      xuid: authResult.xuid,
      xblToken: authResult.xblToken,
    };
    await saveTokens(tokens);
  }

  if (!tokens) throw new Error('Authentication failed.');

  // Create initial client
  let client = new HaloInfiniteClient({
    spartanToken: tokens.spartanToken,
    xuid: tokens.xuid,
  });

  // Fetch clearance/flight token
  log('Fetching clearance token...');
  const clearanceResult = await client.settings.getClearanceLevel();
  if (isSuccess(clearanceResult) && clearanceResult.result.flightId) {
    log(`Flight ID: ${clearanceResult.result.flightId}`);
    client = new HaloInfiniteClient({
      spartanToken: tokens.spartanToken,
      xuid: tokens.xuid,
      clearanceToken: clearanceResult.result.flightId,
    });
  } else {
    log('Could not fetch clearance token, some features may not work.');
  }

  cachedClient = { client, xuid: tokens.xuid };
  cachedExpiry = tokens.spartanTokenExpiry;
  return cachedClient;
}


