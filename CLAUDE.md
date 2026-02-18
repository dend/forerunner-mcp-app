# CLAUDE.md

## Project

Forerunner — a Halo Infinite stat tracker MCP App. Uses `@dendotdev/grunt` (Halo Infinite API) and `@dendotdev/conch` (Xbox Live auth). React UI served as a single-file HTML bundle via MCP ext-apps SDK.

## Build

```sh
npm run build   # tsc --noEmit → vite build → tsc server declarations → esbuild server + main
npm run serve   # tsx main.ts
npm run dev     # concurrent vite watch + tsx watch
```

## Architecture

```
auth.ts         — Xbox Live OAuth + Spartan token chain, encrypted token storage
server.ts       — MCP server: tools (halo_authenticate, halo_match_stats, halo_career, halo_service_record) + UI resource
src/mcp-app.tsx — React UI (Halo Infinite-styled), bundled into a single HTML file by Vite
main.ts         — Entry point, wires up MCP server to stdio transport
config.json     — Azure Entra app client ID + redirect URI (not committed; copy from config.example.json)
tokens.bin      — Encrypted token cache (AES-256-GCM, machine-bound key)
```

## Authentication

### Token Chain

OAuth (Azure Entra) → Xbox User Token → Xbox XSTS Token → Halo XSTS Token → Spartan Token

Libraries: `@dendotdev/conch` for Xbox Live auth, `@dendotdev/grunt`'s `HaloAuthenticationClient` for Spartan tokens.

### Key Details

- **config.json** must have `clientId` (Azure Entra app registration) and `redirectUri` (default `http://localhost:8787/callback`)
- First auth opens browser for Microsoft sign-in, captures OAuth code via local HTTP server on the redirect port
- Tokens are encrypted at rest in `tokens.bin` using AES-256-GCM; encryption key is derived from `hostname() + userInfo().username` via scrypt — **machine-bound**, not portable
- Spartan tokens are cached for 1 hour (with 5-min early refresh). On expiry, the refresh token is used automatically; full re-auth only happens if refresh fails
- **XBL token** (format: `XBL3.0 x={userhash};{token}`) is stored alongside Spartan token and needed for Xbox People Hub API (gamertag lookups)
- `getOrCreateClient()` returns `{ client: HaloInfiniteClient, xuid: string, xblToken: string }`
- After creating the client, a **clearance/flight token** is fetched via `client.settings.getActiveClearance('1.13')` — required for some API endpoints to work

### Gamertag → XUID Resolution

To look up another player, resolve their gamertag to an XUID via Xbox People Hub:
```
GET https://peoplehub.xboxlive.com/users/me/people/search/decoration/detail,preferredColor?q={gamertag}&maxItems=25
Headers: Authorization: {xblToken}, x-xbl-contract-version: 3
```
Returns `{ people: [{ xuid, gamertag }] }`. Match case-insensitively on gamertag.

## Halo Infinite API — grunt Library

### Type System

The grunt library exports proper TypeScript types (`MatchStats`, `MatchHistoryResponse`, `Player`, `CoreStats`, `Medal`, `MedalMetadata`, `PlayerServiceRecord`, `CareerRank`, `RewardTrack`, etc.) and the API returns **PascalCase** field names matching these types. Use the typed interfaces directly — no need for dynamic property access.

### Known Type ↔ API Mismatches

Two fields where the grunt type definition doesn't match the actual API response:

1. **`CoreStats.HeadshotKills`** — the API actually returns `Headshots`. Use the extended type:
   ```ts
   type ApiCoreStats = CoreStats & { Headshots?: number };
   ```
   Then access: `core?.Headshots ?? core?.HeadshotKills ?? 0`

2. **`MedalMetadata.SpriteSheet`** — the type says `{ SpriteSheet?: SpriteSheet }` with `{ Path, SpriteWidth, SpriteHeight, Columns, Rows }`, but the API actually returns a nested structure:
   ```ts
   type ApiMedalMetadata = MedalMetadata & {
     Sprites?: { Small?: { Path?: string; Columns?: number; Size?: number } };
   };
   ```
   Access: `meta.Sprites?.Small?.Path`, not `meta.SpriteSheet?.Path`

### Response Checking

All grunt API calls return `HaloApiResult<T>`. Always check with `isSuccess(result)` or `isNotModified(result)` before accessing `.result`.

### DisplayString

Many CMS fields (`RankTitle`, `Medal.Name`, `Medal.Description`) are `DisplayString` objects. Access the value via `.Value` property:
```ts
rankDef.RankTitle?.Value   // → "Captain"
medal.Name?.Value          // → "Double Kill"
```

## Match Stats Data Model

### API Call Chain

1. `client.stats.getMatchHistory(xuid, 0, count, MatchType.All)` → match history
2. `client.stats.getMatchStats(matchId)` → full match details (cast result as `MatchStats`)
3. `client.gameCms.getMedalMetadata()` → medal definitions (cast as `ApiMedalMetadata`)

### Finding the Current Player

`Player.PlayerId` is `"xuid(1234567890)"` format — compare against `` `xuid(${xuid})` ``, not the bare XUID string. Bots have `PlayerId` starting with `"bid"`.

### Navigating the Stats Tree

```ts
const match = result as MatchStats;
const me = match.Players?.find(p => p.PlayerId === `xuid(${xuid})`);
const core = me?.PlayerTeamStats?.[0]?.Stats?.CoreStats as ApiCoreStats;
const medals = core?.Medals ?? [];
```

### Resolving Map/Mode/Playlist Names

`MatchInfo.MapVariant`, `.UgcGameVariant`, `.Playlist` are `GenericAsset` refs with `AssetId` and `VersionId` but `PublicName` is often empty. Resolve via UGC Discovery:
```ts
client.ugcDiscovery.getMap(assetId, versionId)              // → { PublicName }
client.ugcDiscovery.getUgcGameVariant(assetId, versionId)   // → { PublicName }
client.ugcDiscovery.getPlaylistWithoutVersion(assetId)       // → { PublicName }
```

## Career Rank Data Model

### API Call Chain

1. `client.economy.getPlayerCareerRank([xuid], 'careerRank1')` → current rank + XP
2. `client.gameCms.getCareerRanks('careerRank1')` → all 272 rank definitions

### Rank Indexing

- API returns 0-indexed rank in `RewardTracks[0].Result.CurrentProgress.Rank`
- Rank definitions use 1-based numbering (1–272)
- Rank 272 (0-indexed) = Hero (max rank). For all others, add 1 to convert: `currentRank = rawRank + 1`

### Career Rank Definition Fields

```ts
CareerRank {
  Rank: number           // 1-based (1–272)
  TierType: string       // "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond" | "Onyx" | "Hero"
  RankTitle: DisplayString  // access .Value → "Captain"
  RankGrade: number      // tier number within the title (e.g., 3 for "Captain III")
  XpRequiredForRank: number
  RankLargeIcon: string  // CMS path for rank icon image
  RankAdornmentIcon: string
}
```

### Career Progression Calculation

- **Current XP in rank**: `RewardTracks[0].Result.CurrentProgress.PartialProgress`
- **XP required for current rank**: `currentRankDef.XpRequiredForRank`
- **XP earned to date**: Sum of `XpRequiredForRank` for all ranks below current + `PartialProgress`
- **Total XP required**: Sum of all `XpRequiredForRank` across all 272 ranks
- **Title display**: `"{TierType} {RankTitle.Value} {RankGrade}"` (e.g., "Gold Captain 3"), except Hero which is just `"Hero"`
- **Next rank**: Look up rank definition for `currentRank + 1` (null if Hero)

## CMS Images (Rank Icons, Medal Sprites)

### Fetching Rank Icons

Use `client.gameCms.getImage(path)` where `path` comes from `CareerRank.RankLargeIcon`. Returns `{ result: Uint8Array }`. Convert to data URL:
```ts
const b64 = Buffer.from(result.result).toString('base64');
const dataUrl = `data:image/png;base64,${b64}`;
```

**Known CMS bug**: The path `career_rank/CelebrationMoment/219_Cadet_Onyx_III.png` is incorrect — fix it to `career_rank/CelebrationMoment/19_Cadet_Onyx_III.png`.

### Medal Sprite Sheet

Medal icons are in a single sprite sheet, not individual images. Fetch via:
```ts
const spritePath = meta.Sprites?.Small?.Path;
const spriteResult = await client.gameCms.getGenericWaypointFile(spritePath);
```
Each medal has a `SpriteIndex` (0-based). Compute position: `col = index % columns`, `row = floor(index / columns)`. Use CSS `background-position` to display.

## Service Record

### API Call

```ts
client.stats.getPlayerServiceRecordByXuid(xuid, LifecycleMode.Matchmade)
```

Returns `PlayerServiceRecord` with top-level fields (`MatchesCompleted`, `Wins`, `Losses`, `Ties`, `TimePlayed`) and `CoreStats` for aggregate combat stats.

## Medal Data Model

### API Call

`client.gameCms.getMedalMetadata()` → medal definitions (cast as `ApiMedalMetadata`)

### Medal Definition Fields

```ts
Medal {
  NameId: number           // join key with CoreStats.Medals[].NameId
  Name: DisplayString      // .Value → "Double Kill"
  Description: DisplayString
  SpriteIndex: number      // position in sprite sheet
  DifficultyIndex: number  // 0=Normal, 1=Heroic, 2=Legendary, 3=Mythic
  TypeIndex: number        // medal category
}
```

Join earned medals from match `CoreStats.Medals[].NameId` with definitions from `MedalMetadata.Medals[].NameId`.

## UI Design

The React UI (`src/mcp-app.tsx`) follows **Halo Infinite's menu design language**:
- Font: Saira Condensed (Google Fonts) — boxy, condensed, military aesthetic
- Layout: Left-aligned throughout, no centered content
- Colors: Dark navy backgrounds (`#0f1923`), semi-transparent white borders, pure white text, Halo blue accent (`#3db8f5`)
- Typography: Bold (700-800 weight), uppercase with wide letter-spacing (2-2.5px) for labels/headings
- Cards: Sharp edges (no border-radius), thin white borders, tight 2px gaps between cards
- Section titles: Small vertical accent bar before the label text
- All stat values are left-aligned with small uppercase labels above
