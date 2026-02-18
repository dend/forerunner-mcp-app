/**
 * Halo Infinite Stat Tracker — React MCP App UI
 * Design language aligned with Halo Infinite's menu UI.
 */
import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

// ---------------------------------------------------------------------------
// Types for the data returned by the halo-stats tool
// ---------------------------------------------------------------------------

interface MatchMeta {
  matchId: string;
  mapName: string;
  modeName: string;
  playlistName: string;
  startTime: string;
  endTime: string;
  duration: string;
}

interface MedalEarned {
  nameId: number | string;
  count: number;
  name: string;
  description: string;
  difficulty: number;
  type: number;
  spriteIndex: number;
}

interface SpriteSheetInfo {
  dataUrl: string;
  columns: number;
  size: number;
}

interface PlayerStats {
  outcome: string;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  score: number;
  accuracy: number | null;
  damageDealt: number;
  damageTaken: number;
  headshots: number;
  meleeKills: number;
  grenadeKills: number;
  powerWeaponKills: number;
  maxKillingSpree: number;
  medals: MedalEarned[];
}

interface NextRankInfo {
  rank: number;
  tierType: string;
  rankTitle: string;
  rankTier: number;
  xpRequired: number;
  iconUrl: string | null;
}

interface CareerProgression {
  currentRank: number;
  isHero: boolean;
  tierType: string;
  rankTitle: string;
  rankTier: number;
  currentXp: number;
  xpRequired: number;
  rankProgress: number;
  xpEarnedToDate: number;
  totalXpRequired: number;
  overallProgress: number;
  totalRanks: number;
  rankIconUrl: string | null;
  nextRank: NextRankInfo | null;
}

interface RankSnapshot {
  currentRank: number;
  isHero: boolean;
  tierType: string;
  rankTitle: string;
  rankTier: number;
  partialProgress: number;
  xpRequired: number;
  rankProgress: number;
}

interface CareerImpact {
  pre: RankSnapshot;
  post: RankSnapshot;
  xpEarned: number;
  rankedUp: boolean;
  overallProgressBefore: number;
  overallProgressAfter: number;
  totalXpRequired: number;
}

interface ServiceRecordData {
  gamertag: string | null;
  matchesCompleted: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  accuracy: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  damageTaken: number;
  headshots: number;
  meleeKills: number;
  grenadeKills: number;
  powerWeaponKills: number;
  maxKillingSpree: number;
  suicides: number;
  betrayals: number;
  vehicleDestroys: number;
  timePlayed: string;
  timePlayedSeconds: number;
}

interface StatsPayload {
  match: MatchMeta | null;
  player: PlayerStats | null;
  career: CareerProgression | null;
  careerImpact: CareerImpact | null;
  spriteSheet: SpriteSheetInfo | null;
  serviceRecord?: ServiceRecordData | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePayload(result: CallToolResult): StatsPayload | null {
  const textContent = result.content?.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') return null;
  try {
    return JSON.parse(textContent.text) as StatsPayload;
  } catch {
    return null;
  }
}

function formatDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!match) return iso;
  const h = match[1] ? `${match[1]}h ` : '';
  const m = match[2] ? `${match[2]}m ` : '';
  const s = match[3] ? `${Math.round(parseFloat(match[3]))}s` : '';
  return `${h}${m}${s}`.trim() || '0s';
}

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function outcomeColor(outcome: string): string {
  const o = outcome.toLowerCase();
  if (o === 'win' || o === '2' || o === 'victory') return C.blue;
  if (o === 'loss' || o === 'lose' || o === '3' || o === 'defeat') return C.red;
  if (o === 'didnotfinish' || o === 'dnf') return C.textDim;
  return C.amber;
}

function outcomeLabel(outcome: string): string {
  const o = outcome.toLowerCase();
  if (o === 'win' || o === '2' || o === 'victory') return 'VICTORY';
  if (o === 'loss' || o === 'lose' || o === '3' || o === 'defeat') return 'DEFEAT';
  if (o === 'draw' || o === 'tie' || o === '1') return 'DRAW';
  if (o === 'didnotfinish' || o === 'dnf') return 'DNF';
  return outcome.toUpperCase();
}

function medalDifficultyColor(d: number): string {
  switch (d) {
    case 0: return '#7c9a72';
    case 1: return '#5b8ab5';
    case 2: return '#9b6dba';
    case 3: return '#c0392b';
    default: return '#888';
  }
}

function tierColor(tier: string): string {
  switch (tier.toLowerCase()) {
    case 'bronze': return '#cd7f32';
    case 'silver': return '#c0c0c0';
    case 'gold': return '#ffd700';
    case 'platinum': return '#7be3e0';
    case 'diamond': return '#b9f2ff';
    case 'onyx': return '#353839';
    case 'hero': return '#ffd700';
    default: return '#888';
  }
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

function HaloStatsApp() {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: 'Halo Infinite Stats', version: '1.0.0' },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = async (result) => {
        setToolResult(result);
      };
      app.ontoolinput = async () => {};
      app.ontoolcancelled = () => {};
      app.onerror = console.error;
      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  if (error) return <ErrorView message={error.message} />;
  if (!app) return <LoadingView />;

  return (
    <Dashboard
      app={app}
      toolResult={toolResult}
      hostContext={hostContext}
    />
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

interface DashboardProps {
  app: App;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
}

function Dashboard({ toolResult, hostContext }: DashboardProps) {
  const data = toolResult ? parsePayload(toolResult) : null;
  const isError = toolResult?.isError;

  const tabs: Array<{ id: string; label: string }> = [];
  if (data?.match || data?.player) tabs.push({ id: 'match', label: 'LAST MATCH' });
  if (data?.careerImpact) tabs.push({ id: 'careerImpact', label: 'CAREER IMPACT' });
  if (data?.serviceRecord) tabs.push({ id: 'serviceRecord', label: 'SERVICE RECORD' });
  if (data?.career && !data?.serviceRecord) tabs.push({ id: 'career', label: 'CAREER' });

  const [tab, setTab] = useState<string>('');
  const activeTab = tabs.find((t) => t.id === tab) ? tab : tabs[0]?.id ?? '';

  if (isError) {
    const msg = toolResult?.content?.find((c) => c.type === 'text');
    return <ErrorView message={msg && msg.type === 'text' ? msg.text : 'Unknown error'} />;
  }

  if (!data) return <LoadingView />;

  return (
    <main
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
        padding: 16,
        background: C.bg,
        color: C.text,
        fontFamily: FONT,
        minHeight: '100vh',
      }}
    >
      {tabs.length > 1 && (
        <div style={S.tabBar}>
          {tabs.map((t) => (
            <button
              key={t.id}
              style={{
                ...S.tab,
                ...(activeTab === t.id ? S.tabActive : {}),
              }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'match' && (
        <MatchTab match={data.match} player={data.player} spriteSheet={data.spriteSheet} />
      )}
      {activeTab === 'careerImpact' && data.careerImpact && (
        <CareerImpactTab impact={data.careerImpact} />
      )}
      {activeTab === 'career' && (
        <CareerTab career={data.career} />
      )}
      {activeTab === 'serviceRecord' && data.serviceRecord && (
        <ServiceRecordTab serviceRecord={data.serviceRecord} career={data.career} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Match Tab
// ---------------------------------------------------------------------------

function MatchTab({ match, player, spriteSheet }: { match: MatchMeta | null; player: PlayerStats | null; spriteSheet: SpriteSheetInfo | null }) {
  if (!match || !player) {
    return <EmptyState text="No match data available." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Match header */}
      <div style={S.card}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: outcomeColor(player.outcome),
            letterSpacing: '3px',
            marginBottom: 8,
          }}
        >
          {outcomeLabel(player.outcome)}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: '1px', textTransform: 'uppercase' as const }}>
          {match.mapName}
        </div>
        <div style={{ fontSize: 12, color: C.textDim, letterSpacing: '0.5px', marginTop: 2 }}>
          {match.modeName}{match.playlistName ? ` \u2014 ${match.playlistName}` : ''}
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, letterSpacing: '0.5px' }}>
          {match.endTime && formatDate(match.endTime)}
          {match.endTime && match.duration && ' \u00b7 '}
          {match.duration && formatDuration(match.duration)}
        </div>
      </div>

      {/* Primary KDA */}
      <div style={S.card}>
        <div style={{ display: 'flex', gap: 24 }}>
          <StatCell label="KILLS" value={player.kills} />
          <StatCell label="DEATHS" value={player.deaths} />
          <StatCell label="ASSISTS" value={player.assists} />
          <StatCell label="KDA" value={player.kda.toFixed(2)} />
        </div>
        <Divider />
        <div style={S.statGrid}>
          <StatCell label="ACCURACY" value={player.accuracy !== null ? `${player.accuracy}%` : '\u2014'} />
          <StatCell label="SCORE" value={formatNumber(player.score)} />
          <StatCell label="HEADSHOTS" value={player.headshots} />
          <StatCell label="DMG DEALT" value={formatNumber(player.damageDealt)} />
          <StatCell label="DMG TAKEN" value={formatNumber(player.damageTaken)} />
          <StatCell label="MAX SPREE" value={player.maxKillingSpree} />
        </div>
      </div>

      {/* Medals */}
      {player.medals.length > 0 && (
        <div style={S.card}>
          <SectionTitle>MEDALS</SectionTitle>
          <div style={S.medalGrid}>
            {player.medals.map((m) => {
              const dc = medalDifficultyColor(m.difficulty);
              return (
                <div
                  key={String(m.nameId)}
                  style={{
                    ...S.medalTile,
                    background: `radial-gradient(ellipse at center, ${dc}25 0%, ${C.bg} 70%)`,
                    borderColor: `${dc}40`,
                  }}
                  title={`${m.name}: ${m.description}`}
                >
                  {spriteSheet && m.spriteIndex >= 0 ? (
                    <MedalSprite
                      spriteSheet={spriteSheet}
                      spriteIndex={m.spriteIndex}
                      displaySize={40}
                    />
                  ) : (
                    <div style={{ width: 40, height: 40, background: C.border }} />
                  )}
                  {m.count > 1 && (
                    <span style={S.medalBadgeCount}>{m.count}</span>
                  )}
                  <span style={S.medalTileLabel}>{m.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Career Impact Tab
// ---------------------------------------------------------------------------

function rankLabel(snap: RankSnapshot): string {
  if (snap.isHero) return 'HERO';
  return `${snap.tierType} ${snap.rankTitle} ${snap.rankTier}`.toUpperCase();
}

function RankBadge({ snap, dimmed }: { snap: RankSnapshot; dimmed?: boolean }) {
  return (
    <div
      style={{
        ...S.rankBadge,
        background: snap.isHero
          ? 'linear-gradient(135deg, #ffd700, #ff8c00)'
          : `linear-gradient(135deg, ${tierColor(snap.tierType)}, ${tierColor(snap.tierType)}88)`,
        opacity: dimmed ? 0.4 : 1,
      }}
    >
      {snap.currentRank}
    </div>
  );
}

function CareerImpactTab({ impact }: { impact: CareerImpact }) {
  const { pre, post, xpEarned, rankedUp } = impact;
  const sameRank = !rankedUp;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* XP Earned */}
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ ...S.badge, borderColor: C.blue, color: C.blue }}>
            +{formatNumber(xpEarned)} XP
          </span>
          {rankedUp && (
            <span style={{ ...S.badge, borderColor: C.gold, color: C.gold }}>
              RANK UP
            </span>
          )}
        </div>
      </div>

      {/* Rank comparison */}
      <div style={S.card}>
        <SectionTitle>RANK PROGRESS</SectionTitle>
        {sameRank ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <RankBadge snap={post} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text, letterSpacing: '1px' }}>{rankLabel(post)}</div>
                <div style={{ fontSize: 11, color: C.textDim, letterSpacing: '0.5px' }}>Rank {post.currentRank}</div>
              </div>
            </div>
            {!post.isHero && (
              <div>
                <div style={{ opacity: 0.35, marginBottom: 6 }}>
                  <ProgressBar
                    progress={pre.rankProgress}
                    color={C.blue}
                    label={`BEFORE: ${formatNumber(pre.partialProgress)} / ${formatNumber(pre.xpRequired)} XP`}
                  />
                </div>
                <ProgressBar
                  progress={post.rankProgress}
                  color={C.blue}
                  label={`AFTER: ${formatNumber(post.partialProgress)} / ${formatNumber(post.xpRequired)} XP (+${formatNumber(xpEarned)})`}
                />
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div>
                <RankBadge snap={pre} dimmed />
                <div style={{ fontSize: 10, color: C.textDim, marginTop: 4, letterSpacing: '0.5px', opacity: 0.5 }}>{rankLabel(pre)}</div>
              </div>
              <span style={{ fontSize: 20, color: C.textDim, fontWeight: 300 }}>&rarr;</span>
              <div>
                <RankBadge snap={post} />
                <div style={{ fontSize: 10, color: C.text, fontWeight: 700, marginTop: 4, letterSpacing: '0.5px' }}>{rankLabel(post)}</div>
              </div>
            </div>
            {!post.isHero && (
              <div style={{ marginTop: 10 }}>
                <ProgressBar
                  progress={post.rankProgress}
                  color={C.blue}
                  label={`${formatNumber(post.partialProgress)} / ${formatNumber(post.xpRequired)} XP`}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Overall progress */}
      <div style={S.card}>
        <SectionTitle>OVERALL PROGRESS</SectionTitle>
        <ProgressBar
          progress={impact.overallProgressAfter}
          color={C.blue}
          label={`${(impact.overallProgressBefore * 100).toFixed(2)}% \u2192 ${(impact.overallProgressAfter * 100).toFixed(2)}%`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Career Tab
// ---------------------------------------------------------------------------

function CareerTab({ career }: { career: CareerProgression | null }) {
  if (!career) {
    return <EmptyState text="No career data available." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Current rank */}
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {career.rankIconUrl ? (
            <img
              src={career.rankIconUrl}
              alt={`Rank ${career.currentRank}`}
              style={{ width: 48, height: 48, flexShrink: 0, objectFit: 'contain' }}
            />
          ) : (
            <div
              style={{
                ...S.rankBadge,
                background: career.isHero
                  ? 'linear-gradient(135deg, #ffd700, #ff8c00)'
                  : `linear-gradient(135deg, ${tierColor(career.tierType)}, ${tierColor(career.tierType)}88)`,
              }}
            >
              {career.currentRank}
            </div>
          )}
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: '2px', textTransform: 'uppercase' as const }}>
              {career.rankTitle || `${career.tierType} ${career.rankTier}`}
            </div>
            <div style={{ fontSize: 11, color: C.textDim, letterSpacing: '0.5px', marginTop: 2 }}>
              {career.isHero
                ? 'Maximum rank achieved'
                : `Rank ${career.currentRank} of ${career.totalRanks}`}
            </div>
          </div>
        </div>
      </div>

      {/* XP Progress + Next Rank */}
      {!career.isHero && (
        <div style={S.card}>
          <SectionTitle>RANK PROGRESS</SectionTitle>
          <ProgressBar
            progress={career.rankProgress}
            color={C.blue}
            label={`${formatNumber(career.currentXp)} / ${formatNumber(career.xpRequired)} XP`}
          />
          {career.nextRank && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: C.textDim, letterSpacing: '1.5px', marginBottom: 6 }}>
                NEXT RANK
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {career.nextRank.iconUrl ? (
                  <img
                    src={career.nextRank.iconUrl}
                    alt={`Rank ${career.nextRank.rank}`}
                    style={{ width: 40, height: 40, flexShrink: 0, objectFit: 'contain', opacity: 0.6 }}
                  />
                ) : (
                  <div
                    style={{
                      ...S.rankBadge,
                      width: 40,
                      height: 40,
                      fontSize: 14,
                      opacity: 0.6,
                      background: `linear-gradient(135deg, ${tierColor(career.nextRank.tierType)}, ${tierColor(career.nextRank.tierType)}88)`,
                    }}
                  >
                    {career.nextRank.rank}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: '1px', textTransform: 'uppercase' as const, opacity: 0.7 }}>
                    {career.nextRank.rankTitle || `${career.nextRank.tierType} ${career.nextRank.rankTier}`}
                  </div>
                  <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '0.5px', marginTop: 1 }}>
                    {formatNumber(career.xpRequired - career.currentXp)} XP remaining
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Overall progress to Hero */}
      <div style={S.card}>
        <SectionTitle>{career.isHero ? 'JOURNEY COMPLETE' : 'PROGRESS TO HERO'}</SectionTitle>
        <ProgressBar
          progress={career.overallProgress}
          color={career.isHero ? C.gold : C.blue}
          label={`${formatNumber(career.xpEarnedToDate)} / ${formatNumber(career.totalXpRequired)} XP`}
        />
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, letterSpacing: '0.5px' }}>
          {Math.round(career.overallProgress * 100)}% complete
        </div>
      </div>

      {/* Summary stats */}
      <div style={S.card}>
        <SectionTitle>SUMMARY</SectionTitle>
        <div style={{ display: 'flex', gap: 24 }}>
          <StatCell label="CURRENT RANK" value={career.currentRank} />
          <StatCell label="TOTAL RANKS" value={career.totalRanks} />
          <StatCell label="XP EARNED" value={formatNumber(career.xpEarnedToDate)} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service Record Tab
// ---------------------------------------------------------------------------

function formatTimePlayed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ServiceRecordTab({
  serviceRecord: sr,
  career,
}: {
  serviceRecord: ServiceRecordData;
  career: CareerProgression | null;
}) {
  const kd = sr.deaths > 0 ? (sr.kills / sr.deaths).toFixed(2) : sr.kills.toFixed(2);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Gamertag header */}
      {sr.gamertag && (
        <div style={S.card}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: '2px', textTransform: 'uppercase' as const }}>
            {sr.gamertag}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, letterSpacing: '1px', marginTop: 2 }}>MATCHMADE SERVICE RECORD</div>
        </div>
      )}

      {/* Career rank (compact) */}
      {career && (
        <div style={S.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {career.rankIconUrl ? (
              <img
                src={career.rankIconUrl}
                alt={`Rank ${career.currentRank}`}
                style={{ width: 48, height: 48, flexShrink: 0, objectFit: 'contain' }}
              />
            ) : (
              <div
                style={{
                  ...S.rankBadge,
                  background: career.isHero
                    ? 'linear-gradient(135deg, #ffd700, #ff8c00)'
                    : `linear-gradient(135deg, ${tierColor(career.tierType)}, ${tierColor(career.tierType)}88)`,
                }}
              >
                {career.currentRank}
              </div>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '1.5px', textTransform: 'uppercase' as const }}>
                {career.isHero
                  ? 'Hero'
                  : `${career.tierType} ${career.rankTitle} ${career.rankTier}`}
              </div>
              {!career.isHero && (
                <div style={{ marginTop: 6 }}>
                  <ProgressBar
                    progress={career.rankProgress}
                    color={C.blue}
                    label={`${formatNumber(career.currentXp)} / ${formatNumber(career.xpRequired)} XP`}
                  />
                </div>
              )}
              {career.isHero && (
                <div style={{ fontSize: 11, color: C.textDim, letterSpacing: '0.5px', marginTop: 2 }}>Maximum rank achieved</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Matches */}
      <div style={S.card}>
        <SectionTitle>MATCHES</SectionTitle>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <StatCell label="PLAYED" value={formatNumber(sr.matchesCompleted)} />
          <StatCell label="WINS" value={formatNumber(sr.wins)} />
          <StatCell label="LOSSES" value={formatNumber(sr.losses)} />
          <StatCell label="WIN RATE" value={`${sr.winRate}%`} />
          {sr.ties > 0 && <StatCell label="TIES" value={formatNumber(sr.ties)} />}
        </div>
      </div>

      {/* Combat */}
      <div style={S.card}>
        <SectionTitle>COMBAT</SectionTitle>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <StatCell label="KILLS" value={formatNumber(sr.kills)} />
          <StatCell label="DEATHS" value={formatNumber(sr.deaths)} />
          <StatCell label="ASSISTS" value={formatNumber(sr.assists)} />
          <StatCell label="KDA" value={sr.kda.toFixed(2)} />
        </div>
        <Divider />
        <div style={S.statGrid}>
          <StatCell label="K/D" value={kd} />
          <StatCell label="HEADSHOTS" value={formatNumber(sr.headshots)} />
          <StatCell label="MAX SPREE" value={formatNumber(sr.maxKillingSpree)} />
        </div>
      </div>

      {/* Accuracy & Damage */}
      <div style={S.card}>
        <SectionTitle>ACCURACY &amp; DAMAGE</SectionTitle>
        <div style={S.statGrid}>
          <StatCell label="ACCURACY" value={`${sr.accuracy}%`} />
          <StatCell label="SHOTS HIT" value={formatNumber(sr.shotsHit)} />
          <StatCell label="SHOTS FIRED" value={formatNumber(sr.shotsFired)} />
          <StatCell label="DMG DEALT" value={formatNumber(sr.damageDealt)} />
          <StatCell label="DMG TAKEN" value={formatNumber(sr.damageTaken)} />
          <StatCell label="MELEE KILLS" value={formatNumber(sr.meleeKills)} />
        </div>
      </div>

      {/* Miscellaneous */}
      <div style={S.card}>
        <SectionTitle>MISCELLANEOUS</SectionTitle>
        <div style={S.statGrid}>
          <StatCell label="GRENADE KILLS" value={formatNumber(sr.grenadeKills)} />
          <StatCell label="POWER WPN KILLS" value={formatNumber(sr.powerWeaponKills)} />
          <StatCell label="VEHICLE DESTROYS" value={formatNumber(sr.vehicleDestroys)} />
          <StatCell label="SUICIDES" value={formatNumber(sr.suicides)} />
          <StatCell label="BETRAYALS" value={formatNumber(sr.betrayals)} />
          <StatCell label="TIME PLAYED" value={formatTimePlayed(sr.timePlayedSeconds)} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={S.sectionTitle}>
      <span style={S.sectionTitleLine} />
      <span>{children}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: `1px solid ${C.border}`, margin: '10px 0' }} />;
}

function MedalSprite({
  spriteSheet,
  spriteIndex,
  displaySize,
}: {
  spriteSheet: SpriteSheetInfo;
  spriteIndex: number;
  displaySize: number;
}) {
  const col = spriteIndex % spriteSheet.columns;
  const row = Math.floor(spriteIndex / spriteSheet.columns);
  const bgWidth = spriteSheet.columns * displaySize;

  return (
    <div
      style={{
        width: displaySize,
        height: displaySize,
        flexShrink: 0,
        backgroundImage: `url(${spriteSheet.dataUrl})`,
        backgroundPosition: `-${col * displaySize}px -${row * displaySize}px`,
        backgroundSize: `${bgWidth}px auto`,
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={S.statCell}>
      <div style={S.statLabel}>{label}</div>
      <div style={S.statValue}>{value}</div>
    </div>
  );
}

function ProgressBar({
  progress,
  color,
  label,
}: {
  progress: number;
  color: string;
  label: string;
}) {
  const pct = Math.min(Math.max(progress, 0), 1) * 100;
  return (
    <div>
      <div style={S.progressTrack}>
        <div
          style={{
            ...S.progressFill,
            width: `${pct}%`,
            background: color,
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: C.textDim, marginTop: 4, letterSpacing: '0.5px' }}>{label}</div>
    </div>
  );
}

function LoadingView() {
  return (
    <div style={{ ...S.centered, fontFamily: FONT }}>
      <div style={S.spinner} />
      <span style={{ marginTop: 10, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase' as const, color: C.textDim }}>
        Loading Spartan data
      </span>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div style={{ ...S.centered, color: C.red, background: C.bg, fontFamily: FONT }}>
      <div style={{ fontSize: 28, marginBottom: 8, fontWeight: 700 }}>!</div>
      <span style={{ fontSize: 12, letterSpacing: '0.5px' }}>{message}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ ...S.centered, opacity: 0.5, padding: 40, fontSize: 12, letterSpacing: '1px' }}>
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Design system — Halo Infinite inspired
// ---------------------------------------------------------------------------

const FONT = "'Saira Condensed', 'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

const C = {
  bg: '#0f1923',
  cardBg: '#162029',
  border: 'rgba(255, 255, 255, 0.12)',
  borderBright: 'rgba(255, 255, 255, 0.35)',
  text: '#ffffff',
  textDim: 'rgba(255, 255, 255, 0.42)',
  blue: '#3db8f5',
  gold: '#d4a835',
  green: '#4ade80',
  red: '#f87171',
  amber: '#fbbf24',
};

const S: Record<string, React.CSSProperties> = {
  tabBar: {
    display: 'flex',
    gap: 2,
    marginBottom: 2,
  },
  tab: {
    flex: 1,
    padding: '10px 12px',
    border: `1px solid ${C.border}`,
    background: 'transparent',
    color: C.textDim,
    fontSize: 11,
    fontWeight: 700,
    fontFamily: FONT,
    cursor: 'pointer',
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    transition: 'color 0.15s, border-color 0.15s, background 0.15s',
    textAlign: 'left' as const,
  },
  tabActive: {
    color: C.text,
    borderColor: C.borderBright,
    background: 'rgba(255, 255, 255, 0.06)',
  },
  card: {
    background: C.cardBg,
    padding: '14px 16px',
    border: `1px solid ${C.border}`,
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    fontWeight: 700,
    color: C.textDim,
    letterSpacing: '2.5px',
    marginBottom: 10,
  },
  sectionTitleLine: {
    width: 3,
    height: 12,
    background: C.borderBright,
    flexShrink: 0,
  },
  badge: {
    display: 'inline-block',
    padding: '5px 14px',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: FONT,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    border: '1px solid',
    background: 'transparent',
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px 20px',
  },
  statCell: {
    textAlign: 'left' as const,
    padding: '2px 0',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: 600,
    color: C.textDim,
    letterSpacing: '1.5px',
    marginBottom: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: C.text,
    letterSpacing: '0.5px',
    lineHeight: '1.1',
  },
  medalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
    gap: 4,
  },
  medalTile: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    padding: '8px 4px',
    background: C.bg,
    border: `1px solid ${C.border}`,
    position: 'relative' as const,
  },
  medalBadgeCount: {
    position: 'absolute' as const,
    top: 4,
    right: 4,
    fontSize: 10,
    fontWeight: 700,
    color: C.gold,
    letterSpacing: '0.5px',
  },
  medalTileLabel: {
    fontSize: 9,
    color: C.textDim,
    textAlign: 'center' as const,
    lineHeight: '1.2',
    letterSpacing: '0.3px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: '100%',
  },
  rankBadge: {
    width: 48,
    height: 48,
    border: `1px solid ${C.borderBright}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 800,
    color: '#000',
    flexShrink: 0,
  },
  progressTrack: {
    height: 4,
    background: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    border: `1px solid ${C.border}`,
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.4s ease',
  },
  centered: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
    textAlign: 'center' as const,
    color: C.textDim,
    background: C.bg,
  },
  spinner: {
    width: 28,
    height: 28,
    border: `2px solid ${C.border}`,
    borderTopColor: C.blue,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

// Inject keyframes + Google Fonts
const styleSheet = document.createElement('style');
styleSheet.textContent = [
  "@import url('https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@400;600;700;800&display=swap');",
  '@keyframes spin { to { transform: rotate(360deg); } }',
  `* { box-sizing: border-box; margin: 0; padding: 0; }`,
  `body { background: ${C.bg}; margin: 0; }`,
].join('\n');
document.head.appendChild(styleSheet);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HaloStatsApp />
  </StrictMode>,
);
