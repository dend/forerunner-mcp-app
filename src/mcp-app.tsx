/**
 * Halo Infinite Stat Tracker — React MCP App UI
 * Two-tab dashboard: Last Match + Career Progression
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

interface StatsPayload {
  match: MatchMeta | null;
  player: PlayerStats | null;
  career: CareerProgression | null;
  careerImpact: CareerImpact | null;
  spriteSheet: SpriteSheetInfo | null;
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
  // ISO 8601 duration e.g. "PT12M34.567S"
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
  if (o === 'win' || o === '2' || o === 'victory') return '#4ade80';
  if (o === 'loss' || o === 'lose' || o === '3' || o === 'defeat') return '#f87171';
  if (o === 'didnotfinish' || o === 'dnf') return '#94a3b8';
  return '#fbbf24';
}

function outcomeLabel(outcome: string): string {
  const o = outcome.toLowerCase();
  if (o === 'win' || o === '2' || o === 'victory') return 'Victory';
  if (o === 'loss' || o === 'lose' || o === '3' || o === 'defeat') return 'Defeat';
  if (o === 'draw' || o === 'tie' || o === '1') return 'Draw';
  if (o === 'didnotfinish' || o === 'dnf') return 'DNF';
  return outcome;
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
// Dashboard (two-tab)
// ---------------------------------------------------------------------------

interface DashboardProps {
  app: App;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
}

function Dashboard({ toolResult, hostContext }: DashboardProps) {
  const data = toolResult ? parsePayload(toolResult) : null;
  const isError = toolResult?.isError;

  // Build list of available tabs based on data
  const tabs: Array<{ id: string; label: string }> = [];
  if (data?.match || data?.player) tabs.push({ id: 'match', label: 'Last Match' });
  if (data?.careerImpact) tabs.push({ id: 'careerImpact', label: 'Career Impact' });
  if (data?.career) tabs.push({ id: 'career', label: 'Career' });

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
        maxWidth: 640,
        margin: '0 auto',
        padding: '10px',
        background: C.bg,
        color: C.text,
      }}
    >
      {/* Tab bar — only show if more than one tab */}
      {tabs.length > 1 && (
        <div style={styles.tabBar}>
          {tabs.map((t) => (
            <button
              key={t.id}
              style={{
                ...styles.tab,
                ...(activeTab === t.id ? styles.tabActive : {}),
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Match header */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                ...styles.badge,
                background: 'transparent',
                borderColor: outcomeColor(player.outcome),
                color: outcomeColor(player.outcome),
              }}
            >
              {outcomeLabel(player.outcome)}
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '0.5px' }}>{match.mapName}</div>
              <div style={styles.cardSubtitle}>
                {match.modeName}{match.playlistName ? ` — ${match.playlistName}` : ''}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' as const }}>
            {match.endTime && <div style={{ fontSize: 11, color: C.textDim }}>{formatDate(match.endTime)}</div>}
            {match.duration && <div style={{ fontSize: 11, color: C.textDim }}>{formatDuration(match.duration)}</div>}
          </div>
        </div>
      </div>

      {/* Stats — single card with KDA row + detail grid */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 10 }}>
          <StatCell label="Kills" value={player.kills} />
          <StatCell label="Deaths" value={player.deaths} />
          <StatCell label="Assists" value={player.assists} />
          <StatCell label="KDA" value={player.kda.toFixed(2)} />
        </div>
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <div style={styles.statGrid}>
            <StatCell label="Accuracy" value={player.accuracy !== null ? `${player.accuracy}%` : '—'} />
            <StatCell label="Score" value={formatNumber(player.score)} />
            <StatCell label="Headshots" value={player.headshots} />
            <StatCell label="Dmg Dealt" value={formatNumber(player.damageDealt)} />
            <StatCell label="Dmg Taken" value={formatNumber(player.damageTaken)} />
            <StatCell label="Max Spree" value={player.maxKillingSpree} />
          </div>
        </div>
      </div>

      {/* Medals — prominent icon grid */}
      {player.medals.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            Medals
          </div>
          <div style={styles.medalGrid}>
            {player.medals.map((m) => {
              const dc = medalDifficultyColor(m.difficulty);
              return (
                <div
                  key={String(m.nameId)}
                  style={{
                    ...styles.medalTile,
                    background: `radial-gradient(ellipse at center, ${dc}30 0%, ${C.bg} 70%)`,
                    borderColor: `${dc}50`,
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
                    <span style={styles.medalBadgeCount}>{m.count}</span>
                  )}
                  <span style={styles.medalTileLabel}>{m.name}</span>
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
  if (snap.isHero) return 'Hero';
  return `${snap.tierType} ${snap.rankTitle} ${snap.rankTier}`;
}

function RankBadge({ snap, dimmed }: { snap: RankSnapshot; dimmed?: boolean }) {
  return (
    <div
      style={{
        ...styles.rankBadge,
        background: snap.isHero
          ? 'linear-gradient(135deg, #ffd700, #ff8c00)'
          : `linear-gradient(135deg, ${tierColor(snap.tierType)}, ${tierColor(snap.tierType)}88)`,
        opacity: dimmed ? 0.5 : 1,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* XP Earned card */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span
            style={{
              ...styles.badge,
              background: 'transparent',
              borderColor: C.accent,
              color: C.accent,
            }}
          >
            +{formatNumber(xpEarned)} XP
          </span>
          {rankedUp && (
            <span
              style={{
                ...styles.badge,
                background: 'transparent',
                borderColor: C.gold,
                color: C.gold,
              }}
            >
              RANK UP!
            </span>
          )}
        </div>
      </div>

      {/* Rank comparison card */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Rank Progress</div>
        {sameRank ? (
          // Same rank: show before/after progress within the rank
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <RankBadge snap={post} />
              <div>
                <div style={{ fontWeight: 700, color: C.text, letterSpacing: '0.5px' }}>{rankLabel(post)}</div>
                <div style={styles.cardSubtitle}>Rank {post.currentRank}</div>
              </div>
            </div>
            {!post.isHero && (
              <div>
                {/* Before progress bar (dimmed) */}
                <div style={{ opacity: 0.4, marginBottom: 4 }}>
                  <ProgressBar
                    progress={pre.rankProgress}
                    color={C.accent}
                    label={`Before: ${formatNumber(pre.partialProgress)} / ${formatNumber(pre.xpRequired)} XP`}
                  />
                </div>
                {/* After progress bar */}
                <ProgressBar
                  progress={post.rankProgress}
                  color={C.accent}
                  label={`After: ${formatNumber(post.partialProgress)} / ${formatNumber(post.xpRequired)} XP (+${formatNumber(xpEarned)})`}
                />
              </div>
            )}
          </div>
        ) : (
          // Rank up: show pre → post
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <RankBadge snap={pre} dimmed />
                <div style={{ ...styles.cardSubtitle, marginTop: 4, opacity: 0.5 }}>{rankLabel(pre)}</div>
              </div>
              <span style={{ fontSize: 20, color: C.textDim }}>&rarr;</span>
              <div style={{ textAlign: 'center' }}>
                <RankBadge snap={post} />
                <div style={{ ...styles.cardSubtitle, marginTop: 4, fontWeight: 700, color: C.text }}>{rankLabel(post)}</div>
              </div>
            </div>
            {!post.isHero && (
              <div style={{ marginTop: 8 }}>
                <ProgressBar
                  progress={post.rankProgress}
                  color={C.accent}
                  label={`${formatNumber(post.partialProgress)} / ${formatNumber(post.xpRequired)} XP into new rank`}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Overall progress card */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Overall Progress</div>
        <ProgressBar
          progress={impact.overallProgressAfter}
          color={C.accent}
          label={`${(impact.overallProgressBefore * 100).toFixed(2)}% → ${(impact.overallProgressAfter * 100).toFixed(2)}%`}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Current rank */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {career.rankIconUrl ? (
            <img
              src={career.rankIconUrl}
              alt={`Rank ${career.currentRank}`}
              style={{ width: 44, height: 44, flexShrink: 0, objectFit: 'contain' }}
            />
          ) : (
            <div
              style={{
                ...styles.rankBadge,
                background: career.isHero
                  ? 'linear-gradient(135deg, #ffd700, #ff8c00)'
                  : `linear-gradient(135deg, ${tierColor(career.tierType)}, ${tierColor(career.tierType)}88)`,
              }}
            >
              {career.currentRank}
            </div>
          )}
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, letterSpacing: '0.5px', marginBottom: 4 }}>
              {career.rankTitle || `${career.tierType} ${career.rankTier}`}
            </div>
            <div style={styles.cardSubtitle}>
              {career.isHero
                ? 'Maximum rank achieved!'
                : `Rank ${career.currentRank} of ${career.totalRanks}`}
            </div>
          </div>
        </div>
      </div>

      {/* XP Progress */}
      {!career.isHero && (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Rank Progress</div>
          <ProgressBar
            progress={career.rankProgress}
            color={C.accent}
            label={`${formatNumber(career.currentXp)} / ${formatNumber(career.xpRequired)} XP`}
          />
        </div>
      )}

      {/* Overall progress to Hero */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>
          {career.isHero ? 'Journey Complete' : 'Progress to Hero'}
        </div>
        <ProgressBar
          progress={career.overallProgress}
          color={career.isHero ? C.gold : C.accent}
          label={`${formatNumber(career.xpEarnedToDate)} / ${formatNumber(career.totalXpRequired)} XP`}
        />
        <div style={{ ...styles.meta, marginTop: 8 }}>
          <span>{Math.round(career.overallProgress * 100)}% complete</span>
        </div>
      </div>

      {/* Summary stats */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Summary</div>
        <div style={styles.statGrid}>
          <StatCell label="Current Rank" value={career.currentRank} />
          <StatCell label="Total Ranks" value={career.totalRanks} />
          <StatCell label="XP Earned" value={formatNumber(career.xpEarnedToDate)} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

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
  // Scale so each sprite cell = displaySize px
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
    <div style={styles.statCell}>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
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
      <div style={styles.progressTrack}>
        <div
          style={{
            ...styles.progressFill,
            width: `${pct}%`,
            background: color,
          }}
        />
      </div>
      <div style={{ ...styles.meta, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function LoadingView() {
  return (
    <div style={styles.centered}>
      <div style={styles.spinner} />
      <span style={{ marginTop: 8, opacity: 0.7 }}>Loading Spartan data...</span>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div style={{ ...styles.centered, color: C.red, background: C.bg }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>!</div>
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ ...styles.centered, opacity: 0.6, padding: 40 }}>
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

// Halo Infinite color palette
const C = {
  bg: '#1b2028',
  cardBg: '#232a34',
  border: '#3a3f47',
  text: '#e8eaed',
  textDim: '#8b919a',
  accent: '#38bdf8',
  gold: '#d4a835',
  green: '#4ade80',
  red: '#f87171',
  amber: '#fbbf24',
  slate: '#94a3b8',
};

const styles: Record<string, React.CSSProperties> = {
  tabBar: {
    display: 'flex',
    gap: 0,
    marginBottom: 10,
    borderBottom: `1px solid ${C.border}`,
  },
  tab: {
    flex: 1,
    padding: '8px 0',
    border: 'none',
    background: 'transparent',
    color: C.textDim,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    textTransform: 'uppercase' as const,
    letterSpacing: '1.5px',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: C.accent,
    borderBottomColor: C.accent,
  },
  card: {
    background: C.cardBg,
    borderRadius: 0,
    padding: 12,
    border: `1px solid ${C.border}`,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 8,
    color: C.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: '1.5px',
  },
  cardSubtitle: {
    fontSize: 11,
    color: C.textDim,
    letterSpacing: '0.5px',
  },
  badge: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: 0,
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '1.5px',
    border: '1px solid',
  },
  meta: {
    display: 'flex',
    gap: 12,
    fontSize: 11,
    color: C.textDim,
    letterSpacing: '0.5px',
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 4,
  },
  statCell: {
    textAlign: 'center' as const,
    padding: '4px 0',
  },
  statValue: {
    fontSize: 17,
    fontWeight: 700,
    color: C.text,
    letterSpacing: '0.5px',
  },
  statLabel: {
    fontSize: 9,
    color: C.textDim,
    marginTop: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  },
  medalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
    gap: 6,
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
    width: 44,
    height: 44,
    borderRadius: 0,
    border: `1px solid ${C.border}`,
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
    borderRadius: 0,
    background: C.bg,
    overflow: 'hidden',
    border: `1px solid ${C.border}`,
  },
  progressFill: {
    height: '100%',
    borderRadius: 0,
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
  },
  spinner: {
    width: 28,
    height: 28,
    border: `2px solid ${C.border}`,
    borderTopColor: C.accent,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

// Inject keyframes for spinner
const styleSheet = document.createElement('style');
styleSheet.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(styleSheet);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HaloStatsApp />
  </StrictMode>,
);
