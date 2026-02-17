/**
 * MCP Server for Halo Infinite stat tracker.
 * Registers three tools: halo-authenticate, halo_match_stats, and halo_career.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MatchType,
  isSuccess,
  isNotModified,
} from '@dendotdev/grunt';
import type {
  CareerRank,
  Medal,
} from '@dendotdev/grunt';
import { getOrCreateClient } from './auth.js';

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith('.ts')
  ? path.join(import.meta.dirname, 'dist')
  : import.meta.dirname;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely access a property with inconsistent casing from the Halo API. */
function pick<T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k] as T;
  }
  return undefined;
}

/** Resolve a DisplayString (object with .value/.Value) or plain string. */
function resolveString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return (obj.value ?? obj.Value ?? '') as string;
  }
  return '';
}

/** Fetch a CMS image via gameCms.getImage() and return it as a data:image/png;base64 URL. */
async function fetchIconAsDataUrl(
  client: { gameCms: { getImage: (path: string) => Promise<unknown> } },
  iconPath: string,
): Promise<string | null> {
  if (!iconPath) return null;
  // Known CMS bug: incorrect path for one rank icon
  let fixedPath = iconPath;
  if (fixedPath === 'career_rank/CelebrationMoment/219_Cadet_Onyx_III.png') {
    fixedPath = 'career_rank/CelebrationMoment/19_Cadet_Onyx_III.png';
  }
  try {
    const result = await client.gameCms.getImage(fixedPath) as {
      response?: { code?: number };
      result?: Uint8Array;
    };
    if (isSuccess(result as never) && result?.result) {
      const b64 = Buffer.from(result.result).toString('base64');
      return `data:image/png;base64,${b64}`;
    }
  } catch { /* icon fetch failed — will fall back to gradient badge */ }
  return null;
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'Halo Infinite Stat Tracker',
    version: '1.0.0',
  });

  // -----------------------------------------------------------------------
  // Tool 1: halo-authenticate (regular tool, no UI)
  // -----------------------------------------------------------------------

  server.tool(
    'halo_authenticate',
    'Authenticate with Xbox Live / Halo Infinite. Opens a browser sign-in flow if needed and waits for completion.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        await getOrCreateClient((msg) => console.error(`[auth] ${msg}`));
        return { content: [{ type: 'text', text: 'Successfully authenticated with Halo Infinite.' }] };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Authentication error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Tool 2: halo_match_stats (app tool with UI — last match)
  // -----------------------------------------------------------------------

  const resourceUri = 'ui://halo-stats/mcp-app.html';

  registerAppTool(
    server,
    'halo_match_stats',
    {
      title: 'Halo Match Stats',
      description:
        'Show your last Halo Infinite match stats including K/D/A, accuracy, damage, and medals.',
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      try {
        const { client, xuid } = await getOrCreateClient();

        // Fetch match history (last 1 match)
        const historyResult = await client.stats.getMatchHistory(xuid, 0, 1, MatchType.All);
        if (!isSuccess(historyResult) && !isNotModified(historyResult)) {
          return {
            content: [{ type: 'text', text: `Failed to fetch match history (${historyResult.response.code}).` }],
            isError: true,
          };
        }

        const historyObj = historyResult.result as Record<string, unknown>;
        const results = (pick<unknown[]>(historyObj, 'Results', 'results') ?? []) as Record<string, unknown>[];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No matches found.' }], isError: true };
        }

        const lastMatchRecord = results[0];
        const matchId = pick<string>(lastMatchRecord, 'MatchId', 'matchId') ?? '';

        // Parallel fetches
        const [matchStatsResult, medalMetaResult] = await Promise.all([
          client.stats.getMatchStats(matchId),
          client.gameCms.getMedalMetadata(),
        ]);

        // --- Match stats ---
        let matchData: Record<string, unknown> | null = null;
        if (isSuccess(matchStatsResult) || isNotModified(matchStatsResult)) {
          matchData = matchStatsResult.result as unknown as Record<string, unknown>;
        }

        // --- Medal metadata + sprite sheet ---
        let medalDefs: Medal[] = [];
        let spriteSheet: { dataUrl: string; columns: number; size: number } | null = null;
        if (isSuccess(medalMetaResult) || isNotModified(medalMetaResult)) {
          const meta = medalMetaResult.result as unknown as Record<string, unknown>;
          medalDefs = (pick<Medal[]>(meta, 'Medals', 'medals') ?? []);

          // Extract sprite sheet info
          const sprites = pick<Record<string, unknown>>(meta, 'Sprites', 'sprites');
          const small = sprites
            ? pick<Record<string, unknown>>(sprites, 'Small', 'small')
            : undefined;
          const spritePath = small ? pick<string>(small, 'Path', 'path') : undefined;
          const spriteColumns = small ? pick<number>(small, 'Columns', 'columns') ?? 16 : 16;
          const spriteSize = small ? pick<number>(small, 'Size', 'size') ?? 72 : 72;

          if (spritePath) {
            try {
              const spriteResult = await client.gameCms.getGenericWaypointFile(spritePath);
              if (isSuccess(spriteResult) && spriteResult.result) {
                const b64 = Buffer.from(spriteResult.result).toString('base64');
                spriteSheet = {
                  dataUrl: `data:image/png;base64,${b64}`,
                  columns: spriteColumns,
                  size: spriteSize,
                };
              }
            } catch {
              // Sprite sheet download failed — medals will render without images
            }
          }
        }

        // --- Extract player stats from match ---
        let playerStats: Record<string, unknown> | null = null;
        let matchMeta: Record<string, unknown> | null = null;
        if (matchData) {
          const matchInfo = pick<Record<string, unknown>>(matchData, 'MatchInfo', 'matchInfo');
          const players = pick<Record<string, unknown>[]>(matchData, 'Players', 'players') ?? [];

          // Find our player — PlayerId is "xuid(12345)" format string
          const xuidWrapped = `xuid(${xuid})`;
          const me = players.find((p) => {
            const playerId = pick<string>(p, 'PlayerId', 'playerId');
            return playerId === xuidWrapped || playerId === xuid;
          });

          if (matchInfo) {
            const mapVariantRef = pick<Record<string, unknown>>(matchInfo, 'MapVariant', 'mapVariant');
            const gameVariantRef = pick<Record<string, unknown>>(matchInfo, 'UgcGameVariant', 'ugcGameVariant');
            const playlistRef = pick<Record<string, unknown>>(matchInfo, 'Playlist', 'playlist');
            const startTime = pick<string>(matchInfo, 'StartTime', 'startTime');
            const endTime = pick<string>(matchInfo, 'EndTime', 'endTime');
            const duration = pick<string>(matchInfo, 'Duration', 'duration');

            // Resolve asset names via UGC Discovery
            const mapAssetId = mapVariantRef ? pick<string>(mapVariantRef, 'AssetId', 'assetId') : undefined;
            const mapVersionId = mapVariantRef ? pick<string>(mapVariantRef, 'VersionId', 'versionId') : undefined;
            const modeAssetId = gameVariantRef ? pick<string>(gameVariantRef, 'AssetId', 'assetId') : undefined;
            const modeVersionId = gameVariantRef ? pick<string>(gameVariantRef, 'VersionId', 'versionId') : undefined;
            const playlistAssetId = playlistRef ? pick<string>(playlistRef, 'AssetId', 'assetId') : undefined;

            const assetName = async (
              fetcher: () => Promise<unknown>,
              fallback: string,
            ): Promise<string> => {
              try {
                const res = await fetcher() as { result?: Record<string, unknown> } | null;
                if (res?.result) {
                  return pick<string>(res.result, 'PublicName', 'publicName')
                    ?? pick<string>(res.result, 'Name', 'name')
                    ?? fallback;
                }
              } catch { /* Discovery call failed — use fallback */ }
              return fallback;
            };

            const [mapName, modeName, playlistName] = await Promise.all([
              mapAssetId && mapVersionId
                ? assetName(() => client.ugcDiscovery.getMap(mapAssetId, mapVersionId), 'Unknown Map')
                : Promise.resolve('Unknown Map'),
              modeAssetId && modeVersionId
                ? assetName(() => client.ugcDiscovery.getUgcGameVariant(modeAssetId, modeVersionId), 'Unknown Mode')
                : Promise.resolve('Unknown Mode'),
              playlistAssetId
                ? assetName(() => client.ugcDiscovery.getPlaylistWithoutVersion(playlistAssetId), '')
                : Promise.resolve(''),
            ]);

            matchMeta = {
              matchId,
              mapName,
              modeName,
              playlistName,
              startTime: startTime ?? '',
              endTime: endTime ?? '',
              duration: duration ?? '',
            };
          }

          if (me) {
            const outcome = pick<string>(me, 'Outcome', 'outcome') ??
                            pick<number>(me, 'Outcome', 'outcome')?.toString() ??
                            'Unknown';
            const playerTeamStats = pick<Record<string, unknown>[]>(me, 'PlayerTeamStats', 'playerTeamStats') ?? [];
            const firstTeam = playerTeamStats[0];
            const stats = firstTeam
              ? pick<Record<string, unknown>>(firstTeam, 'Stats', 'stats')
              : undefined;

            if (stats) {
              const coreStats = pick<Record<string, unknown>>(stats, 'CoreStats', 'coreStats');
              const medals = coreStats
                ? pick<Record<string, unknown>[]>(coreStats, 'Medals', 'medals') ?? []
                : [];

              playerStats = {
                outcome: String(outcome),
                kills: pick<number>(coreStats ?? {}, 'Kills', 'kills') ?? 0,
                deaths: pick<number>(coreStats ?? {}, 'Deaths', 'deaths') ?? 0,
                assists: pick<number>(coreStats ?? {}, 'Assists', 'assists') ?? 0,
                kda: pick<number>(coreStats ?? {}, 'KDA', 'kda') ?? 0,
                score: pick<number>(coreStats ?? {}, 'Score', 'score') ??
                       pick<number>(coreStats ?? {}, 'PersonalScore', 'personalScore') ?? 0,
                accuracy: pick<number>(coreStats ?? {}, 'ShotsHit', 'shotsHit') !== undefined &&
                          pick<number>(coreStats ?? {}, 'ShotsFired', 'shotsFired') !== undefined
                  ? Math.round(
                      ((pick<number>(coreStats!, 'ShotsHit', 'shotsHit')! /
                        Math.max(pick<number>(coreStats!, 'ShotsFired', 'shotsFired')!, 1)) *
                        100) *
                        10,
                    ) / 10
                  : null,
                damageDealt: pick<number>(coreStats ?? {}, 'DamageDealt', 'damageDealt') ?? 0,
                damageTaken: pick<number>(coreStats ?? {}, 'DamageTaken', 'damageTaken') ?? 0,
                headshots: pick<number>(coreStats ?? {}, 'Headshots', 'headshots') ?? 0,
                meleeKills: pick<number>(coreStats ?? {}, 'MeleeKills', 'meleeKills') ?? 0,
                grenadeKills: pick<number>(coreStats ?? {}, 'GrenadeKills', 'grenadeKills') ?? 0,
                powerWeaponKills: pick<number>(coreStats ?? {}, 'PowerWeaponKills', 'powerWeaponKills') ?? 0,
                maxKillingSpree: pick<number>(coreStats ?? {}, 'MaxKillingSpree', 'maxKillingSpree') ?? 0,
                medals: medals.map((m) => ({
                  nameId: pick<number>(m, 'NameId', 'nameId') ?? pick<string>(m, 'NameId', 'nameId') ?? 0,
                  count: pick<number>(m, 'Count', 'count') ?? 0,
                })),
              };
            }
          }
        }

        // Enrich medals with metadata
        const enrichedMedals = enrichMedals(
          (playerStats?.medals as Array<{ nameId: number | string; count: number }>) ?? [],
          medalDefs,
        );

        const payload = {
          match: matchMeta,
          player: playerStats ? { ...playerStats, medals: enrichedMedals } : null,
          career: null,
          spriteSheet,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching match stats: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Tool 3: halo_career (app tool with UI — career rank progression)
  // -----------------------------------------------------------------------

  registerAppTool(
    server,
    'halo_career',
    {
      title: 'Halo Career Rank',
      description:
        'Show your Halo Infinite career rank progression including current rank, XP, and progress to Hero.',
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      try {
        const { client, xuid } = await getOrCreateClient();

        const [careerRankResult, careerRanksResult] = await Promise.all([
          client.economy.getPlayerCareerRank(xuid, 'careerRank1'),
          client.gameCms.getCareerRanks('careerRank1'),
        ]);

        let careerData: Record<string, unknown> | null = null;
        if (isSuccess(careerRankResult) || isNotModified(careerRankResult)) {
          careerData = careerRankResult.result as unknown as Record<string, unknown>;
        }

        let rankDefs: CareerRank[] = [];
        if (isSuccess(careerRanksResult) || isNotModified(careerRanksResult)) {
          const container = careerRanksResult.result as unknown as Record<string, unknown>;
          rankDefs = (pick<CareerRank[]>(container, 'Ranks', 'ranks') ?? []);
        }

        let careerProgression: Record<string, unknown> | null = null;
        if (careerData && rankDefs.length > 0) {
          careerProgression = computeCareerProgression(careerData, rankDefs);

          // Fetch current rank icon
          const currentIconPath = careerProgression.currentRankIconPath as string;
          careerProgression.rankIconUrl = await fetchIconAsDataUrl(client, currentIconPath);
        }

        const payload = {
          match: null,
          player: null,
          career: careerProgression,
          spriteSheet: null,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching career rank: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Resource: serves the bundled React UI
  // -----------------------------------------------------------------------

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, 'mcp-app.html'), 'utf-8');
      return {
        contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Career progression computation (adapted from OpenSpartan Workshop)
// ---------------------------------------------------------------------------

function computeCareerProgression(
  careerData: Record<string, unknown>,
  rankDefs: CareerRank[],
): Record<string, unknown> {
  // The API returns: { CurrentProgress: { Rank, PartialProgress, HasReachedMaxRank } }
  let rawRank = 0;
  let partialProgress = 0;

  const currentProgress = pick<Record<string, unknown>>(careerData, 'CurrentProgress', 'currentProgress');
  if (currentProgress) {
    rawRank = pick<number>(currentProgress, 'Rank', 'rank') ?? 0;
    partialProgress = pick<number>(currentProgress, 'PartialProgress', 'partialProgress') ?? 0;
  }

  // Hero rank = 272 (0-indexed in API, but rank definitions use 1-based)
  const isHero = rawRank === 272;
  const currentRank = isHero ? 272 : rawRank + 1;

  // Helper to read rank def fields (handles both PascalCase API and camelCase grunt model)
  const rdRank = (rd: CareerRank) => {
    const o = rd as unknown as Record<string, unknown>;
    return pick<number>(o, 'Rank', 'rank') ?? 0;
  };
  const rdXp = (rd: CareerRank) => {
    const o = rd as unknown as Record<string, unknown>;
    return pick<number>(o, 'XpRequiredForRank', 'xpRequiredForRank', 'XpRequired', 'xpRequired') ?? 0;
  };
  const rdTitle = (rd: CareerRank) => {
    const o = rd as unknown as Record<string, unknown>;
    const raw = pick<unknown>(o, 'RankTitle', 'rankTitle', 'Title', 'title');
    return resolveString(raw);
  };
  const rdTierType = (rd: CareerRank) => {
    const o = rd as unknown as Record<string, unknown>;
    return pick<string>(o, 'TierType', 'tierType') ?? '';
  };
  const rdIcon = (rd: CareerRank) => {
    const o = rd as unknown as Record<string, unknown>;
    return pick<string>(o, 'LargeIconPath', 'RankLargeIcon', 'SmallIconPath', 'RankSmallIcon') ?? '';
  };
  const rdGrade = (rd: CareerRank) => {
    const o = rd as unknown as Record<string, unknown>;
    // RankTier may be a {Value: N} object or a plain number
    const raw = pick<unknown>(o, 'RankTier', 'rankTier', 'Grade', 'grade', 'Tier', 'tier');
    if (typeof raw === 'number') return raw;
    if (raw && typeof raw === 'object') {
      const v = (raw as Record<string, unknown>).Value ?? (raw as Record<string, unknown>).value;
      return typeof v === 'number' ? v : 0;
    }
    return 0;
  };

  // Find current rank definition
  const currentRankDef = rankDefs.find((r) => rdRank(r) === currentRank);

  const xpRequired = currentRankDef ? rdXp(currentRankDef) : 0;

  // XP earned to date: sum all ranks below current + partial progress
  let xpEarnedToDate = partialProgress;
  for (const rd of rankDefs) {
    if (rdRank(rd) < currentRank) xpEarnedToDate += rdXp(rd);
  }

  // Total XP across all ranks
  let totalXpRequired = 0;
  for (const rd of rankDefs) totalXpRequired += rdXp(rd);

  // Rank tier info
  const tierType = currentRankDef ? rdTierType(currentRankDef) : '';
  const rankTitle = currentRankDef ? rdTitle(currentRankDef) : '';
  const rankTier = currentRankDef ? rdGrade(currentRankDef) : 0;

  return {
    currentRank,
    isHero,
    tierType,
    rankTitle,
    rankTier,
    currentXp: partialProgress,
    xpRequired,
    rankProgress: xpRequired > 0 ? partialProgress / xpRequired : isHero ? 1 : 0,
    xpEarnedToDate,
    totalXpRequired,
    overallProgress: totalXpRequired > 0 ? xpEarnedToDate / totalXpRequired : 0,
    totalRanks: rankDefs.length,
    currentRankIconPath: currentRankDef ? rdIcon(currentRankDef) : '',
  };
}

// ---------------------------------------------------------------------------
// Medal enrichment
// ---------------------------------------------------------------------------

function enrichMedals(
  earned: Array<{ nameId: number | string; count: number }>,
  medalDefs: Medal[],
): Array<Record<string, unknown>> {
  console.error(`[enrichMedals] Enriching ${earned.length} medals against ${medalDefs.length} definitions`);
  if (earned.length > 0) {
    console.error(`[enrichMedals] First earned medal nameId: ${earned[0].nameId} (type: ${typeof earned[0].nameId})`);
  }
  return earned
    .map((m) => {
      const def = medalDefs.find((d) => {
        const dObj = d as unknown as Record<string, unknown>;
        const id = pick<number | string>(dObj, 'NameId', 'nameId');
        return id !== undefined && String(id) === String(m.nameId);
      });
      const dObj = def ? (def as unknown as Record<string, unknown>) : null;
      // Medal name/description may be a DisplayString object ({value: "..."}) or a plain string
      const rawName = dObj ? pick<unknown>(dObj, 'Name', 'name') : null;
      const rawDesc = dObj ? pick<unknown>(dObj, 'Description', 'description') : null;
      // Difficulty/type may be string labels or numeric indices
      const rawDiff = dObj ? pick<unknown>(dObj, 'DifficultyIndex', 'difficultyIndex', 'Difficulty', 'difficulty') : null;
      const rawType = dObj ? pick<unknown>(dObj, 'TypeIndex', 'typeIndex', 'Type', 'type') : null;
      const rawSpriteIndex = dObj ? pick<number>(dObj, 'SpriteIndex', 'spriteIndex') : undefined;
      return {
        nameId: m.nameId,
        count: m.count,
        name: resolveString(rawName) || `Medal ${m.nameId}`,
        description: resolveString(rawDesc),
        difficulty: typeof rawDiff === 'number' ? rawDiff : difficultyStringToIndex(String(rawDiff ?? '')),
        type: typeof rawType === 'number' ? rawType : 0,
        spriteIndex: rawSpriteIndex ?? -1,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function difficultyStringToIndex(s: string): number {
  switch (s.toLowerCase()) {
    case 'normal': return 0;
    case 'heroic': return 1;
    case 'legendary': return 2;
    case 'mythic': return 3;
    default: return 0;
  }
}
