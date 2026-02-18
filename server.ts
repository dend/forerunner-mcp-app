/**
 * MCP Server for Halo Infinite stat tracker.
 * Registers tools: halo_authenticate, halo_match_stats, halo_career, and halo_service_record.
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
import { z } from 'zod';
import {
  MatchType,
  LifecycleMode,
  isSuccess,
  isNotModified,
} from '@dendotdev/grunt';
import type {
  CareerRank,
  CoreStats,
  MatchHistoryResponse,
  MatchStats,
  Medal,
  MedalMetadata,
  PlayerServiceRecord,
  RewardTrack,
} from '@dendotdev/grunt';

/**
 * The grunt type defines HeadshotKills but the Halo API returns Headshots.
 * Extend CoreStats to match the actual API response.
 */
type ApiCoreStats = CoreStats & { Headshots?: number };

/**
 * MedalMetadata.SpriteSheet doesn't match the actual API structure.
 * The API nests sprite info under Sprites.Small.
 */
type ApiMedalMetadata = MedalMetadata & {
  Sprites?: { Small?: { Path?: string; Columns?: number; Size?: number } };
};
import { getOrCreateClient } from './auth.js';

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith('.ts')
  ? path.join(import.meta.dirname, 'dist')
  : import.meta.dirname;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an ISO 8601 duration (e.g. "PT1H23M45S", "P3DT4H") to total seconds. */
function parseDuration(iso?: string): number {
  if (!iso) return 0;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}

/** Resolve a gamertag to an XUID via the Xbox People Hub search API. */
async function resolveGamertagToXuid(gamertag: string, xblToken: string): Promise<string> {
  const url = `https://peoplehub.xboxlive.com/users/me/people/search/decoration/detail,preferredColor?q=${encodeURIComponent(gamertag)}&maxItems=25`;
  const res = await fetch(url, {
    headers: {
      'Authorization': xblToken,
      'x-xbl-contract-version': '3',
      'Content-Type': 'application/json',
      'Accept-Language': 'en-us',
    },
  });
  if (!res.ok) throw new Error(`People Hub search failed (${res.status})`);
  const data = await res.json() as { people?: Array<{ xuid?: string; gamertag?: string }> };
  const match = data.people?.find(
    (p) => p.gamertag?.toLowerCase() === gamertag.toLowerCase(),
  ) ?? data.people?.[0];
  if (!match?.xuid) throw new Error(`Could not resolve gamertag "${gamertag}" to an XUID`);
  return match.xuid;
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

        const history = historyResult.result as MatchHistoryResponse;
        const results = history?.Results ?? [];

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No matches found.' }], isError: true };
        }

        const lastMatchRecord = results[0];
        const matchId = lastMatchRecord.MatchId ?? '';

        // Parallel fetches
        const [matchStatsResult, medalMetaResult] = await Promise.all([
          client.stats.getMatchStats(matchId),
          client.gameCms.getMedalMetadata(),
        ]);

        // --- Match stats ---
        let matchData: MatchStats | null = null;
        if (isSuccess(matchStatsResult) || isNotModified(matchStatsResult)) {
          matchData = matchStatsResult.result as MatchStats;
        }

        // --- Medal metadata + sprite sheet ---
        let medalDefs: Medal[] = [];
        let spriteSheet: { dataUrl: string; columns: number; size: number } | null = null;
        if (isSuccess(medalMetaResult) || isNotModified(medalMetaResult)) {
          const meta = medalMetaResult.result as ApiMedalMetadata;
          medalDefs = meta?.Medals ?? [];

          // Extract sprite sheet info (API nests under Sprites.Small, not SpriteSheet)
          const small = meta?.Sprites?.Small;
          const spritePath = small?.Path;
          const spriteColumns = small?.Columns ?? 16;
          const spriteSize = small?.Size ?? 72;

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
          const matchInfo = matchData.MatchInfo;
          const players = matchData.Players ?? [];

          // Find our player — PlayerId is "xuid(12345)" format string
          const xuidWrapped = `xuid(${xuid})`;
          const me = players.find((p) => p.PlayerId === xuidWrapped || p.PlayerId === xuid);

          if (matchInfo) {
            const mapVariantRef = matchInfo.MapVariant;
            const gameVariantRef = matchInfo.UgcGameVariant;
            const playlistRef = matchInfo.Playlist;

            // Resolve asset names via UGC Discovery
            const assetName = async (
              fetcher: () => Promise<unknown>,
              fallback: string,
            ): Promise<string> => {
              try {
                const res = await fetcher() as { result?: { PublicName?: string } } | null;
                if (res?.result) return res.result.PublicName ?? fallback;
              } catch { /* Discovery call failed — use fallback */ }
              return fallback;
            };

            const [mapName, modeName, playlistName] = await Promise.all([
              mapVariantRef?.AssetId && mapVariantRef?.VersionId
                ? assetName(() => client.ugcDiscovery.getMap(mapVariantRef.AssetId!, mapVariantRef.VersionId!), 'Unknown Map')
                : Promise.resolve('Unknown Map'),
              gameVariantRef?.AssetId && gameVariantRef?.VersionId
                ? assetName(() => client.ugcDiscovery.getUgcGameVariant(gameVariantRef.AssetId!, gameVariantRef.VersionId!), 'Unknown Mode')
                : Promise.resolve('Unknown Mode'),
              playlistRef?.AssetId
                ? assetName(() => client.ugcDiscovery.getPlaylistWithoutVersion(playlistRef.AssetId!), '')
                : Promise.resolve(''),
            ]);

            matchMeta = {
              matchId,
              mapName,
              modeName,
              playlistName,
              startTime: matchInfo.StartTime ?? '',
              endTime: matchInfo.EndTime ?? '',
              duration: matchInfo.Duration ?? '',
            };
          }

          if (me) {
            const core = me.PlayerTeamStats?.[0]?.Stats?.CoreStats as ApiCoreStats | undefined;

            if (core) {
              playerStats = {
                outcome: String(me.Outcome ?? 'Unknown'),
                kills: core.Kills ?? 0,
                deaths: core.Deaths ?? 0,
                assists: core.Assists ?? 0,
                kda: core.KDA ?? 0,
                score: core.Score ?? core.PersonalScore ?? 0,
                accuracy: core.ShotsHit != null && core.ShotsFired != null
                  ? Math.round(((core.ShotsHit / Math.max(core.ShotsFired, 1)) * 100) * 10) / 10
                  : null,
                damageDealt: core.DamageDealt ?? 0,
                damageTaken: core.DamageTaken ?? 0,
                headshots: core.Headshots ?? core.HeadshotKills ?? 0,
                meleeKills: core.MeleeKills ?? 0,
                grenadeKills: core.GrenadeKills ?? 0,
                powerWeaponKills: core.PowerWeaponKills ?? 0,
                maxKillingSpree: core.MaxKillingSpree ?? 0,
                medals: (core.Medals ?? []).map((m) => ({
                  nameId: m.NameId ?? 0,
                  count: m.Count ?? 0,
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
        'Show Halo Infinite career rank progression including current rank, XP, and progress to Hero. Defaults to the authenticated player; specify a gamertag to look up another player.',
      inputSchema: {
        gamertag: z.string().optional().describe('Xbox gamertag to look up. Omit to get your own career rank.'),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ gamertag }): Promise<CallToolResult> => {
      try {
        const { client, xuid, xblToken } = await getOrCreateClient();

        let targetXuid = xuid;
        if (gamertag) {
          if (!xblToken) throw new Error('XBL token unavailable — re-authenticate to look up other players.');
          targetXuid = await resolveGamertagToXuid(gamertag, xblToken);
        }

        const [careerRankResult, careerRanksResult] = await Promise.all([
          client.economy.getPlayerCareerRank([targetXuid], 'careerRank1'),
          client.gameCms.getCareerRanks('careerRank1'),
        ]);

        let rewardTrack: RewardTrack | null = null;
        if (isSuccess(careerRankResult) || isNotModified(careerRankResult)) {
          rewardTrack = careerRankResult.result?.RewardTracks?.[0]?.Result ?? null;
        }

        let rankDefs: CareerRank[] = [];
        if (isSuccess(careerRanksResult) || isNotModified(careerRanksResult)) {
          rankDefs = careerRanksResult.result?.Ranks ?? [];
        }

        let careerProgression: ReturnType<typeof computeCareerProgression> | null = null;
        if (rewardTrack && rankDefs.length > 0) {
          careerProgression = computeCareerProgression(rewardTrack, rankDefs);
          const [currentIcon, nextIcon] = await Promise.all([
            fetchIconAsDataUrl(client, careerProgression.currentRankIconPath),
            careerProgression.nextRank ? fetchIconAsDataUrl(client, careerProgression.nextRank.iconPath) : null,
          ]);
          careerProgression.rankIconUrl = currentIcon;
          if (careerProgression.nextRank) careerProgression.nextRank.iconUrl = nextIcon;
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
  // Tool 4: halo_service_record (app tool with UI — aggregate multiplayer stats)
  // -----------------------------------------------------------------------

  registerAppTool(
    server,
    'halo_service_record',
    {
      title: 'Halo Service Record',
      description:
        'Show a Halo Infinite multiplayer service record (lifetime matchmade stats) with career rank. Defaults to the authenticated player; specify a gamertag to look up another player.',
      inputSchema: {
        gamertag: z.string().optional().describe('Xbox gamertag to look up. Omit to get your own service record.'),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ gamertag }): Promise<CallToolResult> => {
      try {
        const { client, xuid, xblToken } = await getOrCreateClient();

        let targetXuid = xuid;
        let resolvedGamertag: string | null = null;
        if (gamertag) {
          if (!xblToken) throw new Error('XBL token unavailable — re-authenticate to look up other players.');
          targetXuid = await resolveGamertagToXuid(gamertag, xblToken);
          resolvedGamertag = gamertag;
        }

        // Parallel fetch: service record + career data
        const [srResult, careerRankResult, careerRanksResult] = await Promise.all([
          client.stats.getPlayerServiceRecordByXuid(targetXuid, LifecycleMode.Matchmade),
          client.economy.getPlayerCareerRank([targetXuid], 'careerRank1').catch(() => null),
          client.gameCms.getCareerRanks('careerRank1').catch(() => null),
        ]);

        if (!isSuccess(srResult) && !isNotModified(srResult)) {
          return {
            content: [{ type: 'text', text: `Failed to fetch service record (${srResult.response.code}).` }],
            isError: true,
          };
        }

        const sr = srResult.result as PlayerServiceRecord;
        const core = sr.CoreStats as ApiCoreStats | undefined;
        const matchesCompleted = sr.MatchesCompleted ?? 0;

        const wins = sr.Wins ?? 0;
        const losses = sr.Losses ?? 0;
        const ties = sr.Ties ?? 0;

        const kills = core?.Kills ?? 0;
        const deaths = core?.Deaths ?? 0;
        const assists = core?.Assists ?? 0;
        const kda = core?.AverageKDA ?? core?.KDA ?? 0;

        const shotsFired = core?.ShotsFired ?? 0;
        const shotsHit = core?.ShotsHit ?? 0;
        const accuracy = shotsFired > 0 ? Math.round((shotsHit / shotsFired) * 1000) / 10 : 0;

        const damageDealt = core?.DamageDealt ?? 0;
        const damageTaken = core?.DamageTaken ?? 0;
        const headshots = core?.Headshots ?? core?.HeadshotKills ?? 0;
        const meleeKills = core?.MeleeKills ?? 0;
        const grenadeKills = core?.GrenadeKills ?? 0;
        const powerWeaponKills = core?.PowerWeaponKills ?? 0;
        const maxKillingSpree = core?.MaxKillingSpree ?? 0;
        const suicides = core?.Suicides ?? 0;
        const betrayals = core?.Betrayals ?? 0;
        const vehicleDestroys = core?.VehicleDestroys ?? 0;

        const timePlayed = sr.TimePlayed ?? '';
        const timePlayedSeconds = parseDuration(timePlayed);
        const winRate = matchesCompleted > 0 ? Math.round((wins / matchesCompleted) * 1000) / 10 : 0;

        // Career progression (non-fatal)
        let careerProgression: ReturnType<typeof computeCareerProgression> | null = null;
        if (careerRankResult && careerRanksResult) {
          try {
            let rewardTrack: RewardTrack | null = null;
            if (isSuccess(careerRankResult) || isNotModified(careerRankResult)) {
              rewardTrack = careerRankResult.result?.RewardTracks?.[0]?.Result ?? null;
            }
            let rankDefs: CareerRank[] = [];
            if (isSuccess(careerRanksResult) || isNotModified(careerRanksResult)) {
              rankDefs = careerRanksResult.result?.Ranks ?? [];
            }
            if (rewardTrack && rankDefs.length > 0) {
              careerProgression = computeCareerProgression(rewardTrack, rankDefs);
              const [currentIcon, nextIcon] = await Promise.all([
                fetchIconAsDataUrl(client, careerProgression.currentRankIconPath),
                careerProgression.nextRank ? fetchIconAsDataUrl(client, careerProgression.nextRank.iconPath) : null,
              ]);
              careerProgression.rankIconUrl = currentIcon;
              if (careerProgression.nextRank) careerProgression.nextRank.iconUrl = nextIcon;
            }
          } catch { /* career processing failed — non-fatal */ }
        }

        const payload = {
          match: null,
          player: null,
          career: careerProgression,
          careerImpact: null,
          spriteSheet: null,
          serviceRecord: {
            gamertag: resolvedGamertag,
            matchesCompleted,
            wins,
            losses,
            ties,
            winRate,
            kills,
            deaths,
            assists,
            kda,
            accuracy,
            shotsFired,
            shotsHit,
            damageDealt,
            damageTaken,
            headshots,
            meleeKills,
            grenadeKills,
            powerWeaponKills,
            maxKillingSpree,
            suicides,
            betrayals,
            vehicleDestroys,
            timePlayed,
            timePlayedSeconds,
          },
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error fetching service record: ${err instanceof Error ? err.message : String(err)}` },
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
  rewardTrack: RewardTrack,
  rankDefs: CareerRank[],
) {
  const rawRank = rewardTrack.CurrentProgress?.Rank ?? 0;
  const partialProgress = rewardTrack.CurrentProgress?.PartialProgress ?? 0;

  // Hero rank = 272 (0-indexed in API, but rank definitions use 1-based)
  const isHero = rawRank === 272;
  const currentRank = isHero ? 272 : rawRank + 1;

  const currentRankDef = rankDefs.find((r) => r.Rank === currentRank);
  const nextRankDef = isHero ? null : rankDefs.find((r) => r.Rank === currentRank + 1) ?? null;

  const xpRequired = currentRankDef?.XpRequiredForRank ?? 0;

  // XP earned to date: sum all ranks below current + partial progress
  let xpEarnedToDate = partialProgress;
  for (const rd of rankDefs) {
    if ((rd.Rank ?? 0) < currentRank) xpEarnedToDate += rd.XpRequiredForRank ?? 0;
  }

  // Total XP across all ranks
  let totalXpRequired = 0;
  for (const rd of rankDefs) totalXpRequired += rd.XpRequiredForRank ?? 0;

  return {
    currentRank,
    isHero,
    tierType: currentRankDef?.TierType ?? '',
    rankTitle: currentRankDef?.RankTitle?.Value ?? '',
    rankTier: currentRankDef?.RankGrade ?? 0,
    currentXp: partialProgress,
    xpRequired,
    rankProgress: xpRequired > 0 ? partialProgress / xpRequired : isHero ? 1 : 0,
    xpEarnedToDate,
    totalXpRequired,
    overallProgress: totalXpRequired > 0 ? xpEarnedToDate / totalXpRequired : 0,
    totalRanks: rankDefs.length,
    currentRankIconPath: currentRankDef?.RankLargeIcon ?? '',
    rankIconUrl: null as string | null,
    nextRank: nextRankDef ? {
      rank: nextRankDef.Rank ?? currentRank + 1,
      tierType: nextRankDef.TierType ?? '',
      rankTitle: nextRankDef.RankTitle?.Value ?? '',
      rankTier: nextRankDef.RankGrade ?? 0,
      xpRequired: nextRankDef.XpRequiredForRank ?? 0,
      iconPath: nextRankDef.RankLargeIcon ?? '',
      iconUrl: null as string | null,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Medal enrichment
// ---------------------------------------------------------------------------

function enrichMedals(
  earned: Array<{ nameId: number | string; count: number }>,
  medalDefs: Medal[],
): Array<Record<string, unknown>> {
  return earned
    .map((m) => {
      const def = medalDefs.find((d) => d.NameId != null && String(d.NameId) === String(m.nameId));
      return {
        nameId: m.nameId,
        count: m.count,
        name: def?.Name?.Value || `Medal ${m.nameId}`,
        description: def?.Description?.Value ?? '',
        difficulty: def?.DifficultyIndex ?? 0,
        type: def?.TypeIndex ?? 0,
        spriteIndex: def?.SpriteIndex ?? -1,
      };
    })
    .sort((a, b) => b.count - a.count);
}
