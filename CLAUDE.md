# CLAUDE.md

## Project

Forerunner — a Halo Infinite stat tracker MCP App. Uses `@dendotdev/grunt` (Halo Infinite API) and `@dendotdev/conch` (Xbox Live auth). React UI served as a single-file HTML bundle via MCP ext-apps SDK.

## Build

```sh
npm run build   # tsc --noEmit → vite build → tsc server declarations → esbuild server + main
npm run serve   # tsx main.ts
npm run dev     # concurrent vite watch + tsx watch
```

## Halo Infinite API Response Format

The grunt Node.js library does `JSON.parse()` on raw API responses with **no field name transformation**. All field names come back in **PascalCase** from the Halo API, even though the TypeScript type definitions in the grunt source use camelCase. Always access fields using both casings via the `pick()` helper in `server.ts`.

## Match Stats Data Model

### API Call Chain

1. `client.stats.getMatchHistory(xuid, 0, 1, MatchType.All)` → last match record
2. `client.stats.getMatchStats(matchId)` → full match details

### Match History Response

```
{
  Results: [
    {
      MatchId: "guid-string",
      MatchInfo: { ... },
      ...
    }
  ],
  Count: number,
  ResultCount: number
}
```

### Match Stats Response (`getMatchStats`)

```
{
  MatchId: "guid-string",
  MatchInfo: {
    StartTime: "ISO8601",
    EndTime: "ISO8601",
    Duration: "PT12M34S",          // ISO 8601 duration
    MapVariant: {
      AssetId: "guid",
      VersionId: "guid",
      PublicName: "Recharge",       // Display name
    },
    UgcGameVariant: {
      PublicName: "Slayer",
    },
    Playlist: {
      PublicName: "Quick Play",
    },
  },
  Players: [
    {
      PlayerId: "xuid(1234567890)",  // IMPORTANT: wrapped in xuid() format, not bare number
      PlayerType: "Human",           // or "Bot"
      Outcome: "Win" | "Loss" | "Tie" | "DidNotFinish",
      Rank: number,
      PlayerTeamStats: [
        {
          TeamId: number,
          Stats: {
            CoreStats: {
              Kills: number,
              Deaths: number,
              Assists: number,
              KDA: number,
              Score: number,
              PersonalScore: number,
              ShotsFired: number,
              ShotsHit: number,
              DamageDealt: number,
              DamageTaken: number,
              Headshots: number,
              MeleeKills: number,
              GrenadeKills: number,
              PowerWeaponKills: number,
              MaxKillingSpree: number,
              Medals: [
                { NameId: number, Count: number, TotalPersonalScoreAwarded: number }
              ]
            }
          }
        }
      ]
    }
  ],
  Teams: [ { TeamId: number, Outcome: number, Rank: number, Stats: { ... } } ]
}
```

### Finding the Current Player

`PlayerId` is `"xuid(1234567890)"` format — compare against `xuid(${xuid})`, not the bare XUID string.

Bots have `PlayerId` starting with `"bid"`.

## Career Rank Data Model

### API Call Chain

1. `client.economy.getPlayerCareerRank([xuid], 'careerRank1')` → current rank + XP
2. `client.gameCms.getCareerRanks('careerRank1')` → all 272 rank definitions

### Career Rank Response (`getPlayerCareerRank`)

```
{
  RewardTracks: [
    {
      Result: {
        CurrentProgress: {
          Rank: number,              // 0-indexed; 272 = Hero
          PartialProgress: number    // XP earned within current rank
        }
      }
    }
  ]
}
```

Rank 272 is Hero (max). For all other ranks, add 1 to get the 1-based rank number that matches rank definitions.

### Career Rank Definitions (`getCareerRanks`)

```
{
  Ranks: [
    {
      Rank: number,                  // 1-based rank number (1–272)
      TierType: "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond" | "Onyx" | "Hero",
      RankTitle: { Value: "Captain" },   // DisplayString — access .Value for the string
      RankTier: { Value: 3 },            // DisplayString — access .Value for the number
      XpRequiredForRank: number,
      RankLargeIcon: "path/to/icon.png",
      RankAdornmentIcon: "path/to/adornment.png"
    }
  ]
}
```

### Career Progression Calculation (from OpenSpartan Workshop)

- **Current XP in rank**: `RewardTracks[0].Result.CurrentProgress.PartialProgress`
- **XP required for rank**: `currentRankDef.XpRequiredForRank`
- **XP earned to date**: Sum of `XpRequiredForRank` for all ranks below current + `PartialProgress`
- **Total XP required**: Sum of all `XpRequiredForRank` across all 272 ranks
- **Title display**: `"{TierType} {RankTitle.Value} {RankTier.Value}"` (e.g., "Gold Captain 3"), except Hero which is just `"Hero"`

## Medal Data Model

### API Call

`client.gameCms.getMedalMetadata()` → medal definitions

### Medal Metadata Response

```
{
  Medals: [
    {
      NameId: number,                    // Matches CoreStats.Medals[].NameId
      Name: { Value: "Double Kill" },    // DisplayString
      Description: { Value: "..." },     // DisplayString
      SpriteIndex: number,
      Type: "Spree" | "Mode" | "Multikill" | "Proficiency" | "Skill" | "Style",
      Difficulty: "Normal" | "Heroic" | "Legendary" | "Mythic",
      PersonalScore: number,
      SortingWeight: number
    }
  ]
}
```

Join earned medals from `CoreStats.Medals[].NameId` with definitions from `MedalMetadata.Medals[].NameId`.
