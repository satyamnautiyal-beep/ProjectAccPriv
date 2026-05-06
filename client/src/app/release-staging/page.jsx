'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './release-staging.module.css';
import {
  Package, X, Send, ShieldCheck, AlertCircle, CheckCircle2, ChevronRight,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import useUIStore from '@/store/uiStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Pipeline type config
const PIPELINE_CONFIG = {
  ENROLLMENT: {
    label: 'Enrollment',
    color: '#2563eb',
    bg: 'rgba(59,130,246,0.1)',
    description: 'OEP / SEP enrollment records',
  },
  RENEWAL: {
    label: 'Renewal',
    color: '#16a34a',
    bg: 'rgba(34,197,94,0.1)',
    description: 'Premium change renewal records',
  },
  RETRO_COVERAGE: {
    label: 'Retro Coverage',
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.1)',
    description: 'Retroactive enrollment records',
  },
};

const getPipelineConfig = (type) => {
  const key = (type || '').toUpperCase().replace(/[^A-Z_]/g, '_');
  return PIPELINE_CONFIG[key] || PIPELINE_CONFIG.ENROLLMENT;
};

// ---------------------------------------------------------------------------
// Group events into per-member sections
// ---------------------------------------------------------------------------
function groupEventsByMember(events) {
  const groups = [];
  let currentGroup = null;
  for (const ev of events) {
    if (ev.type === 'header') {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { id: ev.id, headerMsg: ev.message, steps: [], result: null };
    } else if (ev.type === 'result') {
      if (currentGroup) currentGroup.result = ev;
    } else {
      if (currentGroup) currentGroup.steps.push(ev);
    }
  }
  if (currentGroup) groups.push(currentGroup);
  return { groups };
}

// ---------------------------------------------------------------------------
// Member Card
// ---------------------------------------------------------------------------
function MemberCard({ group, isExpanded, onToggle }) {
  const result = group.result;
  const isDone = !!result;
  const color = isDone ? statusColor(result.status) : null;

  const dotCls = !isDone ? styles.dotPulse
    : color === 'green' ? styles.dotGreen
    : color === 'amber' ? styles.dotAmber
    : styles.dotRed;

  const badgeCls = color === 'green' ? styles.memberBadgeGreen
    : color === 'amber' ? styles.memberBadgeAmber
    : styles.memberBadgeRed;

  const memberName = group.headerMsg.replace('-- Starting pipeline for ', '').replace('-- ', '');
  const statusLabel = result?.message?.split('->')[1]?.trim() || result?.status || '';

  return (
    <div className={`${styles.memberCard} ${isDone ? styles.memberCardDone : styles.memberCardPending} ${isExpanded ? styles.memberCardExpanded : ''}`}>
      <div
        className={styles.memberCardHeader}
        onClick={isDone ? onToggle : undefined}
        style={{ cursor: isDone ? 'pointer' : 'default' }}
      >
        <span className={`${styles.memberDot} ${dotCls}`} />
        <span className={styles.memberCardName}>{memberName}</span>
        {isDone ? (
          <>
            <span className={`${styles.memberBadge} ${badgeCls}`}>{statusLabel}</span>
            <span className={`${styles.memberChevron} ${isExpanded ? styles.memberChevronOpen : ''}`}>
              <ChevronRight size={13} />
            </span>
          </>
        ) : (
          <span className={styles.memberSpinner}><span /><span /><span /></span>
        )}
      </div>
      {isDone && isExpanded && (
        <div className={styles.memberSteps}>
          {group.steps.map(ev => {
            const msg = ev.message?.trim() || '';
            const isWarn = /warning|error|failed|not strong/i.test(msg);
            return (
              <div key={ev.id} className={styles.memberStep}>
                <span className={`${styles.memberStepIcon} ${isWarn ? styles.memberStepIconWarn : styles.memberStepIconDone}`}>
                  {isWarn ? '!' : 'v'}
                </span>
                <span className={`${styles.memberStepText} ${isWarn ? styles.memberStepTextWarn : ''}`}>{msg}</span>
              </div>
            );
          })}
          {result.summary && (
            <div className={`${styles.memberResult} ${color === 'green' ? styles.memberResultGreen : color === 'amber' ? styles.memberResultAmber : styles.memberResultRed}`}>
              <div className={styles.memberResultSummary}>{result.summary}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Console
// ---------------------------------------------------------------------------
function PipelineConsole({ batchId, memberCount, pipelineType, savedState, onStateUpdate, onClose, reconnect }) {
  const [events, setEvents] = useState(savedState?.events || []);
  const [processed, setProcessed] = useState(savedState?.processed || 0);
  const [failed, setFailed] = useState(savedState?.failed || 0);
  const [phase, setPhase] = useState(savedState?.phase || 'running');
  const [initPhase, setInitPhase] = useState(savedState ? 'active' : 'connecting');
  const [expandedId, setExpandedId] = useState(null);
  const timelineEndRef = useRef(null);
  const alreadyDone = savedState?.phase === 'done';
  const pendingStateRef = useRef(null);
  // Capture reconnect at mount time — must not change during the session
  const reconnectRef = useRef(reconnect);
  const pipelineCfg = getPipelineConfig(pipelineType);

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
    // Use the ref — stable, won't cause re-runs
    const method = reconnectRef.current ? 'GET' : 'POST';
    (async () => {
      try {
        const res = await fetch(`${backendUrl}/api/batches/stream/${batchId}`, {
          method,
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
            if (payload.type === 'thinking') {
              setInitPhase('active');
              const isHeader = payload.message.startsWith('--');
              setEvents(prev => [...prev, { id, type: isHeader ? 'header' : 'stage', message: payload.message, ts: new Date().toISOString() }]);
            } else if (payload.type === 'member_result') {
              setInitPhase('active');
              const ev = {
                id, type: 'result', status: payload.status,
                message: `${payload.name} (${payload.subscriber_id}) -> ${payload.status}`,
                summary: payload.summary, ts: new Date().toISOString(),
              };
              setEvents(prev => [...prev, ev]);
              if (payload.status === 'Processing Failed') setFailed(f => f + 1);
              else setProcessed(p => p + 1);
            } else if (payload.type === 'done') {
              setPhase('done');
              setEvents(prev => {
                pendingStateRef.current = { batchId, events: prev, processed: payload.processed, failed: payload.failed, phase: 'done', pipelineType };
                setTimeout(flushPendingState, 0);
                return prev;
              });
            }
          }
        }
        // Stream closed cleanly — if we were reconnecting and got no events,
        // the batch completed but the log wasn't available. Mark as done.
        if (reconnect) {
          setPhase('done');
          setInitPhase(prev => prev === 'connecting' ? 'no_log' : prev);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          // If reconnecting to a completed batch and we got no events,
          // the log wasn't persisted (server restarted before completion).
          // Show a graceful message rather than an error.
          if (reconnect) {
            setPhase('done');
            setInitPhase('active');
          } else {
            setEvents(prev => [...prev, { id: Math.random().toString(36).slice(2), type: 'error', message: `Error: ${err.message}`, ts: new Date().toISOString() }]);
            setPhase('done');
          }
        }
      }
    })();
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, alreadyDone, flushPendingState, pipelineType]);
  // NOTE: reconnect intentionally excluded — captured via ref at mount, must not re-trigger

  const prevProcessedRef = useRef(processed);
  useEffect(() => {
    if (processed !== prevProcessedRef.current || phase === 'done') {
      timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      prevProcessedRef.current = processed;
    }
  }, [processed, phase]);

  const progress = memberCount > 0 ? Math.round(((processed + failed) / memberCount) * 100) : 0;
  const { groups } = groupEventsByMember(events);
  const doneGroups = groups.filter(g => !!g.result);
  const activeGroup = groups.find(g => !g.result) || null;

  return (
    <div className={styles.consoleOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.consolePanel}>
        <div className={styles.consoleHeader}>
          <div className={styles.consoleHeaderLeft}>
            <span className={`${styles.consoleLiveDot} ${phase === 'running' ? styles.consoleLiveDotActive : styles.consoleLiveDotDone}`} />
            <div>
              <div className={styles.consoleTitle} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 700, backgroundColor: pipelineCfg.bg, color: pipelineCfg.color }}>
                  {pipelineCfg.label}
                </span>
                {phase === 'running' ? 'Pipeline Running' : 'Pipeline Complete'}
              </div>
              <div className={styles.consoleBatchId}>{batchId}</div>
            </div>
          </div>
          <div className={styles.consoleHeaderRight}>
            {processed > 0 && <span className={styles.consoleMiniStat} style={{ color: '#16a34a' }}>v {processed}</span>}
            {failed > 0 && <span className={styles.consoleMiniStat} style={{ color: '#dc2626' }}>x {failed}</span>}
            {phase === 'running' && <span className={styles.consoleMiniStat} style={{ color: 'var(--text-muted)' }}>{memberCount - processed - failed} left</span>}
            <button className={styles.consoleCloseBtn} onClick={onClose} title={phase === 'running' ? 'Close (pipeline continues in background)' : 'Close'}><X size={16} /></button>
          </div>
        </div>
        <div className={styles.consoleProgressTrack}>
          <div className={`${styles.consoleProgressFill} ${phase === 'done' ? styles.consoleProgressFillDone : ''}`} style={{ width: `${progress}%` }} />
        </div>
        <div className={styles.consoleBody}>
          {initPhase === 'connecting' && (
            <div className={styles.initState}>
              <div className={styles.initSpinner}><span /><span /><span /><span /></div>
              <div className={styles.initText}>
                <span className={styles.initTitle}>Starting {pipelineCfg.label} pipeline</span>
                <span className={styles.initSub}>Connecting to AI Refinery and loading {memberCount} member{memberCount !== 1 ? 's' : ''}...</span>
              </div>
            </div>
          )}
          {initPhase === 'no_log' && (
            <div className={styles.initState}>
              <div className={styles.initText}>
                <span className={styles.initTitle}>Log not available</span>
                <span className={styles.initSub}>The run log for this batch was not retained. This can happen if the server was restarted after the pipeline completed.</span>
              </div>
            </div>
          )}
          {doneGroups.map(group => (
            <MemberCard key={group.id} group={group} isExpanded={expandedId === group.id} onToggle={() => setExpandedId(expandedId === group.id ? null : group.id)} />
          ))}
          {activeGroup && <MemberCard key={activeGroup.id} group={activeGroup} isExpanded={false} onToggle={() => {}} />}
          <div ref={timelineEndRef} />
        </div>
        {phase === 'done' && (
          <div className={styles.consoleFooter}>
            <div className={styles.consoleFooterSummary}>
              <CheckCircle2 size={16} color="#22c55e" />
              <span><strong>{processed}</strong> processed{failed > 0 && <>, <strong style={{ color: '#dc2626' }}>{failed}</strong> failed</>}</span>
            </div>
            <button className={styles.consoleBtnClose} onClick={onClose}>Close</button>
          </div>
        )}
        {phase === 'running' && (
          <div className={styles.consoleFooter}>
            <div className={styles.consoleFooterSummary}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Processing in background...</span>
            </div>
            <button className={styles.consoleBtnClose} onClick={onClose}>Close & Continue</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Tab content
// ---------------------------------------------------------------------------
function PipelineTab({ pipelineType, batches, isLoading, onSelectBatch, activeBatchId, runningBatchIds }) {
  const cfg = getPipelineConfig(pipelineType);
  const typeBatches = batches.filter(b => (b.pipelineType || 'ENROLLMENT').toUpperCase() === pipelineType);

  if (isLoading) return <div className={styles.emptyState}>Loading batches...</div>;

  if (typeBatches.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Package size={40} color="var(--border)" />
        <p>No {cfg.label} batches yet.</p>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{cfg.description}</p>
      </div>
    );
  }

  return (
    <div className={styles.batchGrid} style={{ paddingRight: activeBatchId ? '420px' : 0 }}>
      {typeBatches.map(batch => {
        const isRunning = runningBatchIds?.includes(batch.id);
        return (
          <div
            key={batch.id}
            className={`${styles.batchCard} ${activeBatchId === batch.id ? styles.batchCardActive : ''} ${isRunning ? styles.batchCardRunning : ''}`}
            onClick={() => onSelectBatch(batch.id === activeBatchId ? null : batch.id)}
            style={{ borderTop: `3px solid ${cfg.color}` }}
          >
            <div className={styles.batchCardTop}>
              <div>
                <div className={styles.batchCardId}>{batch.id}</div>
                <div className={styles.batchCardCount} style={{ color: cfg.color }}>{batch.membersCount}</div>
                <div className={styles.batchCardCountLabel}>members</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <BatchStatusBadge status={batch.status} />
                {isRunning && (
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#22c55e', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', animation: 'livePulse 1.2s ease-in-out infinite' }} />
                    LIVE
                  </span>
                )}
              </div>
            </div>
            <div className={styles.batchCardMeta}>Created {new Date(batch.createdAt).toLocaleDateString()}</div>
            {batch.status === 'Completed' && (
              <div className={styles.batchCardStats}>
                <span className={styles.batchCardStatGreen}>v {batch.processedCount ?? batch.membersCount} processed</span>
                {batch.failedCount > 0 && <span className={styles.batchCardStatRed}>x {batch.failedCount} failed</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function ReleaseStagingPage() {
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleBatchId, setConsoleBatchId] = useState(null);
  const [consoleMemberCount, setConsoleMemberCount] = useState(0);
  const [consolePipelineType, setConsolePipelineType] = useState('ENROLLMENT');
  const [consoleReconnect, setConsoleReconnect] = useState(false);
  const [activeTab, setActiveTab] = useState('ENROLLMENT');

  const {
    completedRuns, saveCompletedRun,
    runningBatchIds, addRunningBatch, removeRunningBatch,
  } = useUIStore();
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => fetch('/api/batches').then(r => r.json()).then(d =>
      [...d].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    ),
    refetchInterval: 3000,
  });

  // Sync: if a batch we thought was running is now Completed in the DB,
  // remove it from runningBatchIds so the LIVE indicator clears.
  useEffect(() => {
    if (!batches.length) return;
    runningBatchIds.forEach(id => {
      const batch = batches.find(b => b.id === id);
      if (batch && batch.status === 'Completed') {
        removeRunningBatch(id);
      }
    });
  }, [batches, runningBatchIds, removeRunningBatch]);

  const generateBatchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/batches', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      const batchCount = data.batches?.length || 1;
      const pipelineNames = data.batches?.map(b => b.pipeline_type).join(', ') || 'Enrollment';
      alert(`Created ${batchCount} batch(es): ${pipelineNames}`);
    },
    onError: () => alert('No classified members to batch. Please run classification first.'),
  });

  const activeBatch = batches.find(b => b.id === activeBatchId);

  // Open the console for a batch — either to start it or to reconnect to a live/completed run
  const openConsole = useCallback((batch, isReconnect = false) => {
    setConsoleBatchId(batch.id);
    setConsoleMemberCount(batch.membersCount);
    setConsolePipelineType(batch.pipelineType || batch.pipeline_type || 'ENROLLMENT');
    setConsoleReconnect(isReconnect);
    setShowConsole(true);
  }, []);

  const handleInitiate = () => {
    if (!activeBatch) return;
    addRunningBatch(activeBatch.id);
    setShowConfirm(false);
    openConsole(activeBatch, false); // POST — start new run
  };

  const handleConsoleClose = () => {
    setShowConsole(false);
    queryClient.invalidateQueries({ queryKey: ['batches'] });
  };

  const handleStateUpdate = useCallback((state) => {
    saveCompletedRun(state);
    if (state.phase === 'done') {
      removeRunningBatch(state.batchId);
    }
  }, [saveCompletedRun, removeRunningBatch]);

  const counts = {
    ENROLLMENT: batches.filter(b => (b.pipelineType || 'ENROLLMENT').toUpperCase() === 'ENROLLMENT').length,
    RENEWAL: batches.filter(b => (b.pipelineType || '').toUpperCase() === 'RENEWAL').length,
    RETRO_COVERAGE: batches.filter(b => (b.pipelineType || '').toUpperCase() === 'RETRO_COVERAGE').length,
  };

  const tabs = [
    { key: 'ENROLLMENT', label: 'Enrollment', count: counts.ENROLLMENT },
    { key: 'RENEWAL', label: 'Renewal', count: counts.RENEWAL },
    { key: 'RETRO_COVERAGE', label: 'Retro Coverage', count: counts.RETRO_COVERAGE },
  ];

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Release Staging</h1>
          <p className={styles.subtitle}>
            Finalize reviewed records and release batches to the appropriate enrollment pipeline.
          </p>
        </div>
        <button
          className={styles.btnPrimary}
          onClick={() => generateBatchMutation.mutate()}
          disabled={generateBatchMutation.isPending}
        >
          <Package size={16} />
          {generateBatchMutation.isPending ? 'Bundling...' : 'Generate Batch'}
        </button>
      </div>

      {/* Pipeline Tabs */}
      <div style={{
        display: 'flex', gap: '4px', marginBottom: '24px',
        borderBottom: '1px solid var(--border)',
      }}>
        {tabs.map(tab => {
          const cfg = getPipelineConfig(tab.key);
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setActiveBatchId(null); }}
              style={{
                padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? cfg.color : 'var(--text-muted)',
                borderBottom: isActive ? `2px solid ${cfg.color}` : '2px solid transparent',
                fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px',
                transition: 'color 0.15s', marginBottom: '-1px',
              }}
            >
              <span style={{
                padding: '2px 8px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700,
                backgroundColor: isActive ? cfg.bg : 'var(--bg-root)',
                color: isActive ? cfg.color : 'var(--text-muted)',
              }}>
                {tab.count}
              </span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Batch grid for active tab */}
      <PipelineTab
        pipelineType={activeTab}
        batches={batches}
        isLoading={isLoading}
        onSelectBatch={setActiveBatchId}
        activeBatchId={activeBatchId}
        runningBatchIds={runningBatchIds}
      />

      {/* Detail panel */}
      <div className={`${styles.detailPanel} ${activeBatchId ? styles.detailPanelOpen : ''}`}>
        {activeBatch && (() => {
          const cfg = getPipelineConfig(activeBatch.pipelineType || activeTab);
          const isRunning = runningBatchIds.includes(activeBatch.id) || activeBatch.status === 'In Progress';
          const isCompleted = activeBatch.status === 'Completed';
          const hasSavedLog = !!completedRuns[activeBatch.id];

          return (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 700, backgroundColor: cfg.bg, color: cfg.color }}>
                      {cfg.label}
                    </span>
                    <div className={styles.detailTitle}>Batch Details</div>
                  </div>
                  <div className={styles.detailMeta}>{activeBatch.id}</div>
                </div>
                <button className={styles.detailClose} onClick={() => setActiveBatchId(null)}><X size={18} /></button>
              </div>
              <div className={styles.detailBody}>
                <div className={styles.detailSummaryCard}>
                  <div className={styles.detailSummaryLabel}>Release Summary</div>
                  <div className={styles.detailSummaryCount} style={{ color: cfg.color }}>{activeBatch.membersCount}</div>
                  <div className={styles.detailSummarySubtitle}>certified records ready for {cfg.label.toLowerCase()} pipeline</div>
                </div>
                <div className={styles.detailStatusRow}>
                  <span className={styles.detailStatusLabel}>Status</span>
                  <BatchStatusBadge status={activeBatch.status} />
                </div>
                <div className={styles.detailStatusRow}>
                  <span className={styles.detailStatusLabel}>Pipeline</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
                </div>
                <div className={styles.detailStatusRow}>
                  <span className={styles.detailStatusLabel}>Created</span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{new Date(activeBatch.createdAt).toLocaleDateString()}</span>
                </div>

                {/* ── Completed ── */}
                {isCompleted && (
                  <div className={styles.detailDoneBox}>
                    <ShieldCheck size={32} color="#22c55e" />
                    <div className={styles.detailDoneTitle}>Pipeline Complete</div>
                    <div className={styles.detailDoneSub}>
                      {activeBatch.processedCount ?? activeBatch.membersCount} processed
                      {activeBatch.failedCount > 0 && `, ${activeBatch.failedCount} failed`}
                    </div>
                    {/* Always show view log — GET replay works even after server restart */}
                    <button className={styles.btnViewLog} onClick={() => openConsole(activeBatch, true)}>
                      View run log
                    </button>
                  </div>
                )}

                {/* ── Running (In Progress) ── */}
                {isRunning && !isCompleted && (
                  <div className={styles.detailRunningBox}>
                    <div className={styles.detailRunningDot} />
                    <div className={styles.detailRunningTitle}>Pipeline Running</div>
                    <div className={styles.detailRunningSub}>
                      Processing {activeBatch.membersCount} member{activeBatch.membersCount !== 1 ? 's' : ''} in the background
                    </div>
                    <button
                      className={styles.btnViewLive}
                      style={{ borderColor: cfg.color, color: cfg.color }}
                      onClick={() => openConsole(activeBatch, true)}  // GET — reconnect
                    >
                      View live logs
                    </button>
                  </div>
                )}

                {/* ── Awaiting Approval (not yet started) ── */}
                {!isRunning && !isCompleted && (
                  <button className={styles.btnInitiate} onClick={() => setShowConfirm(true)}>
                    <Send size={16} /> Initiate {cfg.label} Pipeline
                  </button>
                )}
              </div>
            </>
          );
        })()}
      </div>

      {/* Confirmation modal */}
      {showConfirm && activeBatch && (() => {
        const cfg = getPipelineConfig(activeBatch.pipelineType || activeTab);
        return (
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <div className={styles.modalIcon}><AlertCircle size={40} color={cfg.color} /></div>
              <h2 className={styles.modalTitle}>Final Release Affirmation</h2>
              <p className={styles.modalBody}>
                I agree that I have reviewed the facts and want to send this batch to the{' '}
                <strong>{cfg.label}</strong> pipeline. I certify that all data integrity warnings
                have been resolved or manually overridden.
              </p>
              <div className={styles.modalMeta}>
                <span>{activeBatch.membersCount} members</span>
                <span>.</span>
                <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                <span>.</span>
                <span>{activeBatch.id}</span>
              </div>
              <div className={styles.modalActions}>
                <button className={styles.btnSecondary} onClick={() => setShowConfirm(false)}>Cancel</button>
                <button className={styles.btnPrimary} style={{ backgroundColor: cfg.color }} onClick={handleInitiate}>
                  <Send size={14} /> I Agree and Release
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Live pipeline console */}
      {showConsole && consoleBatchId && (
        <PipelineConsole
          batchId={consoleBatchId}
          memberCount={consoleMemberCount}
          pipelineType={consolePipelineType}
          savedState={completedRuns[consoleBatchId] || null}
          onStateUpdate={handleStateUpdate}
          onClose={handleConsoleClose}
          reconnect={consoleReconnect}
        />
      )}
    </div>
  );
}
