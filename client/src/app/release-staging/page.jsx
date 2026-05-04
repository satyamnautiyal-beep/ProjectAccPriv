'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './release-staging.module.css';
import { Package, X, Send, ShieldCheck, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// --- helpers -----------------------------------------------------------------

function statusColor(status) {
  if (status === 'Enrolled' || status === 'Enrolled (SEP)') return 'green';
  if (status === 'In Review') return 'amber';
  return 'red';
}

function BatchStatusBadge({ status }) {
  const map = {
    'Awaiting Approval': { label: 'Pending Release', cls: styles.badgePending },
    'Completed':         { label: 'Completed',        cls: styles.badgeEnrolled },
    'In Progress':       { label: 'Processing',       cls: styles.badgeProcessing },
  };
  const { label, cls } = map[status] || { label: status, cls: styles.badgeMuted };
  return <span className={`${styles.badge} ${cls}`}>{label}</span>;
}

// --- Group flat events into per-member sections ------------------------------

function groupEventsByMember(events) {
  const groups = [];
  let currentGroup = null;
  const preGroupEvents = [];

  for (const ev of events) {
    if (ev.type === 'header') {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { id: ev.id, headerMsg: ev.message, steps: [], result: null };
    } else if (ev.type === 'result') {
      if (currentGroup) { currentGroup.result = ev; }
      else preGroupEvents.push(ev);
    } else {
      if (currentGroup) currentGroup.steps.push(ev);
      else preGroupEvents.push(ev);
    }
  }
  if (currentGroup) groups.push(currentGroup);
  return { preGroupEvents, groups };
}

// --- Member card: live steps -> collapses to result card on completion -------

function MemberCard({ group, isActive, onToggle }) {
  const result = group.result;
  const isDone = !!result;
  const color = result ? statusColor(result.status) : null;

  // Collapsed result card (shown after processing completes)
  if (isDone && !isActive) {
    const badgeCls = color === 'green' ? styles.memberBadgeGreen
      : color === 'amber' ? styles.memberBadgeAmber
      : styles.memberBadgeRed;
    const dotCls = color === 'green' ? styles.dotGreen
      : color === 'amber' ? styles.dotAmber
      : styles.dotRed;
    const statusLabel = result.message?.split('->')[1]?.trim() || result.status || '';

    return (
      <div className={`${styles.memberCard} ${styles.memberCardDone}`} onClick={onToggle}>
        <span className={`${styles.memberDot} ${dotCls}`} />
        <span className={styles.memberCardName}>
          {group.headerMsg.replace('-- Starting pipeline for ', '').replace('-- ', '')}
        </span>
        <span className={`${styles.memberBadge} ${badgeCls}`}>{statusLabel}</span>
        <span className={styles.memberChevron}>
          <ChevronRight size={13} />
        </span>
      </div>
    );
  }

  // Expanded card (active processing OR manually expanded after done)
  const dotCls = isDone
    ? (color === 'green' ? styles.dotGreen : color === 'amber' ? styles.dotAmber : styles.dotRed)
    : styles.dotPulse;

  return (
    <div className={`${styles.memberCard} ${styles.memberCardExpanded} ${isDone ? styles.memberCardExpandedDone : styles.memberCardExpandedActive}`}>
      {/* Header row */}
      <div className={styles.memberCardHeader} onClick={isDone ? onToggle : undefined} style={{ cursor: isDone ? 'pointer' : 'default' }}>
        <span className={`${styles.memberDot} ${dotCls}`} />
        <span className={styles.memberCardName}>
          {group.headerMsg.replace('-- Starting pipeline for ', '').replace('-- ', '')}
        </span>
        {isDone ? (
          <>
            <span className={`${styles.memberBadge} ${color === 'green' ? styles.memberBadgeGreen : color === 'amber' ? styles.memberBadgeAmber : styles.memberBadgeRed}`}>
              {result.message?.split('->')[1]?.trim() || result.status}
            </span>
            <span className={`${styles.memberChevron} ${styles.memberChevronOpen}`}>
              <ChevronRight size={13} />
            </span>
          </>
        ) : (
          <span className={styles.memberSpinner}><span /><span /><span /></span>
        )}
      </div>

      {/* Steps */}
      <div className={styles.memberSteps}>
        {group.steps.map(ev => {
          const isStepDone = ev.message?.startsWith('  ') && !ev.message?.includes('...');
          const isWarn = ev.message?.includes('Warning') || ev.message?.includes('error');
          return (
            <div key={ev.id} className={styles.memberStep}>
              <span className={`${styles.memberStepIcon} ${isStepDone ? styles.memberStepIconDone : isWarn ? styles.memberStepIconWarn : ''}`}>
                {isStepDone ? '✓' : isWarn ? '!' : '·'}
              </span>
              <span className={`${styles.memberStepText} ${isStepDone ? styles.memberStepTextDone : isWarn ? styles.memberStepTextWarn : ''}`}>
                {ev.message}
              </span>
            </div>
          );
        })}

        {/* Result summary at bottom */}
        {isDone && (
          <div className={`${styles.memberResult} ${color === 'green' ? styles.memberResultGreen : color === 'amber' ? styles.memberResultAmber : styles.memberResultRed}`}>
            <div className={styles.memberResultTitle}>{result.message}</div>
            {result.summary && <div className={styles.memberResultSummary}>{result.summary}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Enrollment Console ------------------------------------------------------

function EnrollmentConsole({ batchId, memberCount, savedState, onStateUpdate, onClose }) {
  const [events, setEvents] = useState(savedState?.events || []);
  const [processed, setProcessed] = useState(savedState?.processed || 0);
  const [failed, setFailed] = useState(savedState?.failed || 0);
  const [phase, setPhase] = useState(savedState?.phase || 'running');
  // expandedId: which member card is expanded (null = all collapsed)
  const [expandedId, setExpandedId] = useState(null);
  const timelineEndRef = useRef(null);
  const alreadyDone = savedState?.phase === 'done';

  // Deferred state update to parent — avoids setState-during-render warning
  const pendingStateRef = useRef(null);
  const flushPendingState = useCallback(() => {
    if (pendingStateRef.current && onStateUpdate) {
      onStateUpdate(pendingStateRef.current);
      pendingStateRef.current = null;
    }
  }, [onStateUpdate]);

  useEffect(() => {
    if (alreadyDone) return;

    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${backendUrl}/api/batches/stream/${batchId}`, {
          method: 'POST',
          headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            let payload;
            try { payload = JSON.parse(raw); } catch { continue; }

            const id = Math.random().toString(36).slice(2);

            if (payload.type === 'start') {
              setEvents(prev => [...prev, {
                id, type: 'info',
                message: `Pipeline started - ${payload.memberCount} members`,
                ts: new Date().toISOString(),
              }]);
            } else if (payload.type === 'thinking') {
              const isHeader = payload.message.startsWith('--');
              const evType = isHeader ? 'header' : 'stage';
              if (isHeader) {
                // Auto-expand the new member being processed
                setExpandedId(id);
              }
              setEvents(prev => [...prev, { id, type: evType, message: payload.message, ts: new Date().toISOString() }]);
            } else if (payload.type === 'member_result') {
              const color = statusColor(payload.status);
              const ev = {
                id, type: 'result', color,
                status: payload.status,
                message: `${payload.name} (${payload.subscriber_id}) -> ${payload.status}`,
                summary: payload.summary,
                ts: new Date().toISOString(),
              };
              setEvents(prev => [...prev, ev]);
              // Collapse the just-finished member after a short delay for visual effect
              setTimeout(() => setExpandedId(null), 600);
              if (payload.status === 'Processing Failed') setFailed(f => f + 1);
              else setProcessed(p => p + 1);
            } else if (payload.type === 'done') {
              setPhase('done');
              setExpandedId(null);
              const doneEv = {
                id, type: 'done',
                message: `All done - ${payload.processed} enrolled, ${payload.failed} failed`,
                ts: new Date().toISOString(),
              };
              setEvents(prev => {
                const next = [...prev, doneEv];
                // Schedule parent state update outside render cycle
                pendingStateRef.current = {
                  events: next,
                  processed: payload.processed,
                  failed: payload.failed,
                  phase: 'done',
                };
                setTimeout(flushPendingState, 0);
                return next;
              });
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setEvents(prev => [...prev, {
            id: Math.random().toString(36).slice(2),
            type: 'error',
            message: `Error: ${err.message}`,
            ts: new Date().toISOString(),
          }]);
          setPhase('done');
        }
      }
    })();

    return () => controller.abort();
  }, [batchId, alreadyDone, flushPendingState]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const progress = memberCount > 0 ? Math.round(((processed + failed) / memberCount) * 100) : 0;
  const { preGroupEvents, groups } = groupEventsByMember(events);

  return (
    <div className={styles.consoleOverlay} onClick={e => e.target === e.currentTarget && phase === 'done' && onClose()}>
      <div className={styles.consolePanel}>

        {/* Header */}
        <div className={styles.consoleHeader}>
          <div className={styles.consoleHeaderLeft}>
            <span className={`${styles.consoleLiveDot} ${phase === 'running' ? styles.consoleLiveDotActive : styles.consoleLiveDotDone}`} />
            <div>
              <div className={styles.consoleTitle}>{phase === 'running' ? 'Enrollment Running' : 'Enrollment Complete'}</div>
              <div className={styles.consoleBatchId}>{batchId}</div>
            </div>
          </div>
          <div className={styles.consoleHeaderRight}>
            {processed > 0 && <span className={styles.consoleMiniStat} style={{ color: '#16a34a' }}>✓ {processed}</span>}
            {failed > 0 && <span className={styles.consoleMiniStat} style={{ color: '#dc2626' }}>✗ {failed}</span>}
            {phase === 'running' && <span className={styles.consoleMiniStat} style={{ color: 'var(--text-muted)' }}>{memberCount - processed - failed} left</span>}
            {phase === 'done' && (
              <button className={styles.consoleCloseBtn} onClick={onClose}><X size={16} /></button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className={styles.consoleProgressTrack}>
          <div
            className={`${styles.consoleProgressFill} ${phase === 'done' ? styles.consoleProgressFillDone : ''}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Scrollable body */}
        <div className={styles.consoleBody}>
          {/* Pre-member info */}
          {preGroupEvents.map(ev => (
            <div key={ev.id} className={styles.consoleInfoRow}>
              <span className={styles.dotBlue} />
              <span className={styles.consoleInfoText}>{ev.message}</span>
            </div>
          ))}

          {/* Member cards */}
          {groups.map(group => (
            <MemberCard
              key={group.id}
              group={group}
              isActive={expandedId === group.id}
              onToggle={() => setExpandedId(expandedId === group.id ? null : group.id)}
            />
          ))}

          {/* Live indicator */}
          {phase === 'running' && (
            <div className={styles.consoleInfoRow}>
              <span className={styles.dotPulse} />
              <span className={styles.consolePulsingDots}><span /><span /><span /></span>
            </div>
          )}
          <div ref={timelineEndRef} />
        </div>

        {/* Footer */}
        {phase === 'done' && (
          <div className={styles.consoleFooter}>
            <div className={styles.consoleFooterSummary}>
              <CheckCircle2 size={16} color="#22c55e" />
              <span>
                <strong>{processed}</strong> enrolled
                {failed > 0 && <>, <strong style={{ color: '#dc2626' }}>{failed}</strong> failed</>}
              </span>
            </div>
            <button className={styles.consoleBtnClose} onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main Page ----------------------------------------------------------------

export default function ReleaseStagingPage() {
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleBatchId, setConsoleBatchId] = useState(null);
  const [consoleMemberCount, setConsoleMemberCount] = useState(0);
  const [completedRuns, setCompletedRuns] = useState({});
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => fetch('/api/batches').then(r => r.json()).then(d =>
      [...d].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    ),
    refetchInterval: 3000,
  });

  const generateBatchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/batches', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['batches'] }),
    onError: () => alert('No Ready members to batch.'),
  });

  const activeBatch = batches.find(b => b.id === activeBatchId);

  const handleInitiate = () => {
    if (!activeBatch) return;
    setConsoleBatchId(activeBatch.id);
    setConsoleMemberCount(activeBatch.membersCount);
    setShowConfirm(false);
    setShowConsole(true);
  };

  const handleConsoleClose = () => {
    setShowConsole(false);
    queryClient.invalidateQueries({ queryKey: ['batches'] });
  };

  const handleStateUpdate = useCallback((state) => {
    setCompletedRuns(prev => ({ ...prev, [state.batchId || consoleBatchId]: state }));
  }, [consoleBatchId]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Release Staging</h1>
          <p className={styles.subtitle}>Finalize reviewed records and release batches to the enrollment pipeline.</p>
        </div>
        <button className={styles.btnPrimary} onClick={() => generateBatchMutation.mutate()} disabled={generateBatchMutation.isPending}>
          <Package size={16} />
          {generateBatchMutation.isPending ? 'Bundling...' : 'Generate Batch'}
        </button>
      </div>

      <div className={`${styles.batchGrid} ${activeBatchId ? styles.batchGridShifted : ''}`}>
        {isLoading && <div className={styles.emptyState}>Loading batches...</div>}
        {!isLoading && batches.length === 0 && (
          <div className={styles.emptyState}>
            <Package size={40} color="var(--border)" />
            <p>No batches yet. Generate one from Ready members.</p>
          </div>
        )}
        {batches.map(batch => (
          <div
            key={batch.id}
            className={`${styles.batchCard} ${activeBatchId === batch.id ? styles.batchCardActive : ''}`}
            onClick={() => setActiveBatchId(batch.id === activeBatchId ? null : batch.id)}
          >
            <div className={styles.batchCardTop}>
              <div>
                <div className={styles.batchCardId}>{batch.id}</div>
                <div className={styles.batchCardCount}>{batch.membersCount}</div>
                <div className={styles.batchCardCountLabel}>members</div>
              </div>
              <BatchStatusBadge status={batch.status} />
            </div>
            <div className={styles.batchCardMeta}>Created {new Date(batch.createdAt).toLocaleDateString()}</div>
            {batch.status === 'Completed' && (
              <div className={styles.batchCardStats}>
                <span className={styles.batchCardStatGreen}>✓ {batch.processedCount ?? batch.membersCount} enrolled</span>
                {batch.failedCount > 0 && <span className={styles.batchCardStatRed}>✗ {batch.failedCount} failed</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Detail panel */}
      <div className={`${styles.detailPanel} ${activeBatchId ? styles.detailPanelOpen : ''}`}>
        {activeBatch && (
          <>
            <div className={styles.detailHeader}>
              <div>
                <div className={styles.detailTitle}>Batch Details</div>
                <div className={styles.detailMeta}>{activeBatch.id}</div>
              </div>
              <button className={styles.detailClose} onClick={() => setActiveBatchId(null)}><X size={18} /></button>
            </div>
            <div className={styles.detailBody}>
              <div className={styles.detailSummaryCard}>
                <div className={styles.detailSummaryLabel}>Release Summary</div>
                <div className={styles.detailSummaryCount}>{activeBatch.membersCount}</div>
                <div className={styles.detailSummarySubtitle}>certified records ready for enrollment</div>
              </div>
              <div className={styles.detailStatusRow}>
                <span className={styles.detailStatusLabel}>Status</span>
                <BatchStatusBadge status={activeBatch.status} />
              </div>
              {activeBatch.status === 'Completed' ? (
                <div className={styles.detailDoneBox}>
                  <ShieldCheck size={32} color="#22c55e" />
                  <div className={styles.detailDoneTitle}>Enrollment Complete</div>
                  <div className={styles.detailDoneSub}>
                    {activeBatch.processedCount ?? activeBatch.membersCount} enrolled
                    {activeBatch.failedCount > 0 && `, ${activeBatch.failedCount} failed`}
                  </div>
                  {completedRuns[activeBatch.id] && (
                    <button className={styles.btnViewLog} onClick={() => {
                      setConsoleBatchId(activeBatch.id);
                      setConsoleMemberCount(activeBatch.membersCount);
                      setShowConsole(true);
                    }}>
                      View run log
                    </button>
                  )}
                </div>
              ) : (
                <button className={styles.btnInitiate} onClick={() => setShowConfirm(true)}>
                  <Send size={16} /> Initiate Enrollment
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Confirmation modal */}
      {showConfirm && activeBatch && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalIcon}><AlertCircle size={40} color="var(--primary)" /></div>
            <h2 className={styles.modalTitle}>Final Release Affirmation</h2>
            <p className={styles.modalBody}>
              "I agree that I have reviewed the facts and want to send this batch for enrollment.
              I certify that all data integrity warnings have been resolved or manually overridden."
            </p>
            <div className={styles.modalMeta}>
              <span>{activeBatch.membersCount} members</span>
              <span>·</span>
              <span>{activeBatch.id}</span>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className={styles.btnPrimary} onClick={handleInitiate}><Send size={14} /> I Agree &amp; Release</button>
            </div>
          </div>
        </div>
      )}

      {/* Live enrollment console */}
      {showConsole && consoleBatchId && (
        <EnrollmentConsole
          batchId={consoleBatchId}
          memberCount={consoleMemberCount}
          savedState={completedRuns[consoleBatchId] || null}
          onStateUpdate={handleStateUpdate}
          onClose={handleConsoleClose}
        />
      )}
    </div>
  );
}
