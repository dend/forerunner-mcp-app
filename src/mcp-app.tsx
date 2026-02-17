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

interface RankLadderEntry {
  tier: string;
  count: number;
  isCurrent: boolean;
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
  rankLadder: RankLadderEntry[];
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
        padding: '16px',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Match header */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span
            style={{
              ...styles.badge,
              background: outcomeColor(player.outcome),
              color: '#000',
            }}
          >
            {outcomeLabel(player.outcome)}
          </span>
          <div>
            <div style={styles.cardTitle}>{match.mapName}</div>
            <div style={styles.cardSubtitle}>
              {match.modeName}
              {match.playlistName ? ` — ${match.playlistName}` : ''}
            </div>
          </div>
        </div>
        <div style={{ ...styles.meta, marginTop: 8 }}>
          {match.endTime && <span>{formatDate(match.endTime)}</span>}
          {match.duration && <span>{formatDuration(match.duration)}</span>}
        </div>
      </div>

      {/* Performance grid */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Performance</div>
        <div style={styles.statGrid}>
          <StatCell label="Kills" value={player.kills} />
          <StatCell label="Deaths" value={player.deaths} />
          <StatCell label="Assists" value={player.assists} />
          <StatCell label="KDA" value={player.kda.toFixed(2)} />
          <StatCell label="Accuracy" value={player.accuracy !== null ? `${player.accuracy}%` : '—'} />
          <StatCell label="Score" value={formatNumber(player.score)} />
        </div>
      </div>

      {/* Detailed stats */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Details</div>
        <div style={styles.statGrid}>
          <StatCell label="Damage Dealt" value={formatNumber(player.damageDealt)} />
          <StatCell label="Damage Taken" value={formatNumber(player.damageTaken)} />
          <StatCell label="Headshots" value={player.headshots} />
          <StatCell label="Melee Kills" value={player.meleeKills} />
          <StatCell label="Grenade Kills" value={player.grenadeKills} />
          <StatCell label="Power Weapons" value={player.powerWeaponKills} />
          <StatCell label="Max Spree" value={player.maxKillingSpree} />
        </div>
      </div>

      {/* Medals */}
      {player.medals.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            Medals <span style={styles.cardSubtitle}>({player.medals.length})</span>
          </div>
          <div style={styles.medalGrid}>
            {player.medals.map((m) => (
              <div
                key={String(m.nameId)}
                style={{
                  ...styles.medalChip,
                  borderLeft: `3px solid ${medalDifficultyColor(m.difficulty)}`,
                }}
                title={m.description}
              >
                {spriteSheet && m.spriteIndex >= 0 ? (
                  <MedalSprite
                    spriteSheet={spriteSheet}
                    spriteIndex={m.spriteIndex}
                    displaySize={24}
                  />
                ) : null}
                <span style={styles.medalName}>{m.name}</span>
                <span style={styles.medalCount}>x{m.count}</span>
              </div>
            ))}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* XP Earned card */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span
            style={{
              ...styles.badge,
              background: '#38bdf8',
              color: '#000',
            }}
          >
            +{formatNumber(xpEarned)} XP
          </span>
          {rankedUp && (
            <span
              style={{
                ...styles.badge,
                background: '#fbbf24',
                color: '#000',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <RankBadge snap={post} />
              <div>
                <div style={{ fontWeight: 600 }}>{rankLabel(post)}</div>
                <div style={styles.cardSubtitle}>Rank {post.currentRank}</div>
              </div>
            </div>
            {!post.isHero && (
              <div>
                {/* Before progress bar (dimmed) */}
                <div style={{ opacity: 0.4, marginBottom: 4 }}>
                  <ProgressBar
                    progress={pre.rankProgress}
                    color="#38bdf8"
                    label={`Before: ${formatNumber(pre.partialProgress)} / ${formatNumber(pre.xpRequired)} XP`}
                  />
                </div>
                {/* After progress bar */}
                <ProgressBar
                  progress={post.rankProgress}
                  color="#38bdf8"
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
                <div style={{ ...styles.cardSubtitle, marginTop: 4 }}>{rankLabel(pre)}</div>
              </div>
              <span style={{ fontSize: 20, opacity: 0.5 }}>&rarr;</span>
              <div style={{ textAlign: 'center' }}>
                <RankBadge snap={post} />
                <div style={{ ...styles.cardSubtitle, marginTop: 4, fontWeight: 600 }}>{rankLabel(post)}</div>
              </div>
            </div>
            {!post.isHero && (
              <div style={{ marginTop: 12 }}>
                <ProgressBar
                  progress={post.rankProgress}
                  color="#38bdf8"
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
          color="#38bdf8"
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Current rank */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {career.rankIconUrl ? (
            <img
              src={career.rankIconUrl}
              alt={`Rank ${career.currentRank}`}
              style={{ width: 52, height: 52, flexShrink: 0, objectFit: 'contain' }}
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
            <div style={styles.cardTitle}>
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
            color="#38bdf8"
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
          color={career.isHero ? '#ffd700' : '#38bdf8'}
          label={`${formatNumber(career.xpEarnedToDate)} / ${formatNumber(career.totalXpRequired)} XP`}
        />
        <div style={{ ...styles.meta, marginTop: 8 }}>
          <span>{Math.round(career.overallProgress * 100)}% complete</span>
        </div>
      </div>

      {/* Rank ladder */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Rank Tiers</div>
        <div style={styles.rankLadder}>
          {career.rankLadder
            .filter((entry) => entry.count > 0)
            .map((entry) => (
              <div
                key={entry.tier}
                style={{
                  ...styles.ladderItem,
                  ...(entry.isCurrent ? styles.ladderItemCurrent : {}),
                  borderLeft: `3px solid ${tierColor(entry.tier)}`,
                }}
              >
                <span style={{ fontWeight: entry.isCurrent ? 700 : 400 }}>
                  {entry.tier}
                </span>
                <span style={styles.ladderCount}>
                  {entry.count} rank{entry.count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
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
      <span style={{ marginTop: 12, opacity: 0.7 }}>Loading Spartan data...</span>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div style={{ ...styles.centered, color: '#f87171' }}>
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

const styles: Record<string, React.CSSProperties> = {
  tabBar: {
    display: 'flex',
    gap: 4,
    marginBottom: 16,
    borderBottom: '1px solid var(--color-border-primary, light-dark(#ddd, #333))',
  },
  tab: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'transparent',
    color: 'var(--color-text-secondary, light-dark(#666, #aaa))',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: '#38bdf8',
    borderBottomColor: '#38bdf8',
    fontWeight: 600,
  },
  card: {
    background: 'var(--color-background-secondary, light-dark(#fff, #161b22))',
    borderRadius: 10,
    padding: 16,
    border: '1px solid var(--color-border-primary, light-dark(#e0e0e0, #30363d))',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 8,
    color: 'var(--color-text-primary, inherit)',
  },
  cardSubtitle: {
    fontSize: 13,
    color: 'var(--color-text-secondary, light-dark(#666, #8b949e))',
  },
  badge: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  meta: {
    display: 'flex',
    gap: 16,
    fontSize: 12,
    color: 'var(--color-text-secondary, light-dark(#888, #8b949e))',
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  statCell: {
    textAlign: 'center' as const,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--color-text-primary, inherit)',
  },
  statLabel: {
    fontSize: 11,
    color: 'var(--color-text-secondary, light-dark(#888, #8b949e))',
    marginTop: 2,
  },
  medalGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  medalChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 6,
    background: 'var(--color-background-primary, light-dark(#f0f0f0, #0d1117))',
    fontSize: 12,
  },
  medalName: {
    fontWeight: 500,
  },
  medalCount: {
    opacity: 0.7,
    fontSize: 11,
  },
  rankBadge: {
    width: 52,
    height: 52,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 800,
    color: '#000',
    flexShrink: 0,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    background: 'var(--color-background-primary, light-dark(#e0e0e0, #21262d))',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.4s ease',
  },
  rankLadder: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  ladderItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 10px',
    borderRadius: 6,
    fontSize: 13,
    background: 'transparent',
  },
  ladderItemCurrent: {
    background: 'var(--color-background-primary, light-dark(#f0f0f0, #0d1117))',
  },
  ladderCount: {
    fontSize: 12,
    opacity: 0.6,
  },
  centered: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
    textAlign: 'center' as const,
  },
  spinner: {
    width: 28,
    height: 28,
    border: '3px solid var(--color-border-primary, #333)',
    borderTopColor: '#38bdf8',
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
