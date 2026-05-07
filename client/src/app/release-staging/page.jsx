'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import styles from './release-staging.module.css';
import {
  Package, X, Send, ShieldCheck, AlertCircle, CheckCircle2, ChevronRight, BarChart2,
  Cpu, Zap, TrendingUp, Clock, AlertTriangle,
  Brain, Calculator, FileCheck,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import useUIStore from '@/store/uiStore';

// ---------------------------------------------------------------------------
// Pipeline config
// ---------------------------------------------------------------------------
/** Today's date as YYYY-MM-DD */
const todayStr = () => new Date().toISOString().slice(0, 10);

/** True if a batch was completed today */
const isCompletedToday = (batch) => {
  const ts = batch.completedAt || batch.createdAt || '';
  return ts.slice(0, 10) === todayStr();
};

// Pipeline type config
const PIPELINE_CONFIG = {
  ENROLLMENT: {
    label: 'Enrollment',
    color: '#2563eb',
    bg: 'rgba(59,130,246,0.1)',
    border: 'rgba(59,130,246,0.25)',
    description: 'OEP / SEP enrollment records',
    icon: FileCheck,
    accentClass: 'accentBlue',
  },
  RENEWAL: {
    label: 'Renewal',
    color: '#16a34a',
    bg: 'rgba(34,197,94,0.1)',
    border: 'rgba(34,197,94,0.25)',
    description: 'Premium change renewal records',
    icon: TrendingUp,
    accentClass: 'accentGreen',
  },
  RETRO_COVERAGE: {
    label: 'Retro Coverage',
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.1)',
    border: 'rgba(168,85,247,0.25)',
    description: 'Retroactive enrollment records',
    icon: Clock,
    accentClass: 'accentPurple',
  },
};

const getPipelineConfig = (type) => {
  const key = (type || '').toUpperCase().replace(/[^A-Z_]/g, '_');
  return PIPELINE_CONFIG[key] || PIPELINE_CONFIG.ENROLLMENT;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function BatchStatusBadge({ status }) {
  const map = {
    'Awaiting Approval': { label: 'Pending Release', cls: styles.badgePending },
    'Completed':         { label: 'Completed',        cls: styles.badgeEnrolled },
    'In Progress':       { label: 'Processing',       cls: styles.badgeProcessing },
  };
  const { label, cls } = map[status] || { label: status, cls: styles.badgeMuted };
  return <span className={`${styles.badge} ${cls}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// Classify SSE event into a visual node type
// ---------------------------------------------------------------------------
function classifyEvent(ev) {
  const msg = ev.message || '';
  if (ev.type === 'agent_call') return 'agent_call';
  if (/anomaly|warning|⚠/i.test(msg))                                          return 'anomaly';
  if (/override|llm confirmed|llm override|reasoning/i.test(msg))               return 'llm_reasoning';
  if (/specialist note/i.test(msg))                                              return 'specialist';
  if (/compliance|regulatory|mandate/i.test(msg))                               return 'compliance';
  if (/calculat|comput|delta|liability|premium change|aptc|subsidy/i.test(msg)) return 'calculation';
  if (/priority.*high|high.*priority|flagging.*review|in review/i.test(msg))    return 'flag';
  if (/approved|approving|enrolled|all.*passed|no.*liability/i.test(msg))       return 'approved';
  if (/error|failed|no coverage/i.test(msg))                                    return 'error';
  if (/connecting|starting.*pipeline|initializ/i.test(msg))                     return 'system';
  return 'thinking';
}

const NODE_DOT = {
  agent_call:    styles.dotAgent,
  calculation:   styles.dotCalc,
  llm_reasoning: styles.dotLlm,
  anomaly:       styles.dotAnomaly,
  specialist:    styles.dotSpecialist,
  compliance:    styles.dotCompliance,
  flag:          styles.dotFlag,
  approved:      styles.dotApproved,
  error:         styles.dotError,
  system:        styles.dotSystem,
  thinking:      styles.dotThinking,
};

function NodeIcon({ nodeType, size = 11 }) {
  const map = {
    agent_call:    <Cpu size={size} />,
    calculation:   <Calculator size={size} />,
    llm_reasoning: <Brain size={size} />,
    anomaly:       <AlertTriangle size={size} />,
    flag:          <AlertCircle size={size} />,
    approved:      <CheckCircle2 size={size} />,
    specialist:    <Zap size={size} />,
  };
  return map[nodeType] || null;
}

function cleanMessage(msg) {
  return (msg || '').replace(/^--\s*Starting pipeline for\s*/i, '').replace(/^\s+/, '').trim();
}

// ---------------------------------------------------------------------------
// Single live log node (current member only)
// ---------------------------------------------------------------------------
function LiveNode({ ev, isLast }) {
  const nodeType = ev.nodeType || 'thinking';
  const dotCls   = NODE_DOT[nodeType] || styles.dotThinking;
  const icon     = <NodeIcon nodeType={nodeType} />;

  if (nodeType === 'agent_call') {
    return (
      <div className={styles.feedAgentCall}>
        <div className={styles.feedAgentDot} style={{ background: '#0ea5e9', borderColor: '#0ea5e9' }} />
        {!isLast && <div className={styles.feedNodeLine} />}
        <div className={styles.feedAgentContent}>
          <span className={styles.feedAgentChip}
            style={{ color: '#0369a1', background: 'rgba(14,165,233,0.1)', borderColor: 'rgba(14,165,233,0.25)' }}>
            <Cpu size={10} /> {ev.agent || ev.message}
          </span>
          {ev.agent && ev.message !== ev.agent && (
            <span className={styles.feedAgentDesc}>{ev.message}</span>
          )}
        </div>
      </div>
    );
  }

  const isHighlight = ['calculation','llm_reasoning','anomaly','flag','approved','specialist','compliance','error'].includes(nodeType);

  return (
    <div className={`${styles.feedNode} ${isHighlight ? styles.feedNodeHighlight : ''} ${styles[`feedNode_${nodeType}`] || ''}`}>
      <div className={`${styles.feedDot} ${dotCls}`}>
        {icon && <span className={styles.feedDotIcon}>{icon}</span>}
      </div>
      {!isLast && <div className={styles.feedNodeLine} />}
      <div className={styles.feedNodeContent}>
        <span className={styles.feedNodeText}>{cleanMessage(ev.message)}</span>
        <span className={styles.feedNodeTime}>
          {ev.ts ? new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''}
        </span>
      </div>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Pipeline Reasoning Panel — focused single-member live feed
// ---------------------------------------------------------------------------
function PipelineReasoningPanel({ batchId, memberCount, pipelineType, onClose, reconnect }) {
  const [currentLogs, setCurrentLogs]             = useState([]);
  const [currentMemberName, setCurrentMemberName] = useState(null);
  const [processed, setProcessed]   = useState(0);
  const [failed, setFailed]         = useState(0);
  const [phase, setPhase]           = useState('running');
  const [initPhase, setInitPhase]   = useState('connecting');

  const feedEndRef   = useRef(null);
  const pipelineCfg  = getPipelineConfig(pipelineType);
  const totalDone    = processed + failed;
  const progress     = memberCount > 0 ? Math.round((totalDone / memberCount) * 100) : 0;

  // Auto-scroll to bottom of live feed whenever new logs arrive
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentLogs]);

  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    const controller = new AbortController();

    async function processStream(response) {
      const reader  = response.body.getReader();
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
            if (isHeader) {
              const name = payload.message
                .replace(/^--\s*Starting pipeline for\s*/i, '')
                .replace(/^--\s*/, '')
                .trim();
              setCurrentMemberName(name);
              setCurrentLogs([]);
            } else {
              const nodeType = classifyEvent({ type: 'thinking', message: payload.message });
              setCurrentLogs(prev => [...prev, { id, message: payload.message, nodeType, ts: new Date().toISOString() }]);
            }
          } else if (payload.type === 'agent_call') {
            setInitPhase('active');
            setCurrentLogs(prev => [...prev, {
              id, type: 'agent_call', nodeType: 'agent_call',
              agent: payload.agent, message: payload.message || payload.agent,
              ts: new Date().toISOString(),
            }]);
          } else if (payload.type === 'member_result') {
            setInitPhase('active');
            if (payload.status === 'Processing Failed') setFailed(f => f + 1);
            else setProcessed(p => p + 1);
            setCurrentLogs([]);
            setCurrentMemberName(null);
          } else if (payload.type === 'done') {
            setPhase('done');
            setCurrentLogs([]);
            setCurrentMemberName(null);
          }
        }
      }
    }

    (async () => {
      try {
        // Try POST to start, fall back to GET if already running (409 = StrictMode double-mount or reconnect)
        let method = reconnect ? 'GET' : 'POST';
        let res = await fetch(`${backendUrl}/api/batches/stream/${batchId}`, {
          method,
          headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
          signal: controller.signal,
        });

        if (res.status === 409) {
          // Batch already running — reconnect via GET
          res = await fetch(`${backendUrl}/api/batches/stream/${batchId}`, {
            method: 'GET',
            headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
            signal: controller.signal,
          });
        }

        if (!res.ok) throw new Error(`Server error ${res.status}`);
        await processStream(res);

        // Stream ended cleanly
        if (reconnect) {
          setPhase('done');
          setInitPhase(prev => prev === 'connecting' ? 'no_log' : prev);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (reconnect) {
          setPhase('done');
          setInitPhase('active');
        } else {
          setCurrentLogs(prev => [...prev, {
            id: Math.random().toString(36).slice(2),
            nodeType: 'error',
            message: `Error: ${err.message}`,
            ts: new Date().toISOString(),
          }]);
          setPhase('done');
        }
      }
    })();

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  return (
    <div className={`${styles.reasoningPanel} ${styles[pipelineCfg.accentClass]}`}>
      {/* Header */}
      <div className={styles.reasoningHeader}>
        <div className={styles.reasoningHeaderLeft}>
          <span className={`${styles.reasoningLiveDot} ${phase === 'running' ? styles.reasoningLiveDotActive : styles.reasoningLiveDotDone}`} />
          <div>
            <div className={styles.reasoningTitle}>
              <span
                className={styles.reasoningPipelineBadge}
                style={{ color: pipelineCfg.color, background: pipelineCfg.bg, borderColor: pipelineCfg.border }}
              >
                {pipelineCfg.label}
              </span>
              {phase === 'running' ? 'Pipeline Running' : 'Pipeline Complete'}
            </div>
            <div className={styles.reasoningBatchId}>{batchId}</div>
          </div>
        </div>
        <div className={styles.reasoningHeaderRight}>
          {processed > 0 && (
            <span className={styles.reasoningStat} style={{ color: '#16a34a' }}>✓ {processed}</span>
          )}
          {failed > 0 && (
            <span className={styles.reasoningStat} style={{ color: '#dc2626' }}>✗ {failed}</span>
          )}
          {phase === 'running' && memberCount > 0 && (
            <span className={styles.reasoningStat} style={{ color: 'var(--text-muted)' }}>
              {memberCount - totalDone} left
            </span>
          )}
          <button className={styles.reasoningCloseBtn} onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className={styles.reasoningProgressTrack}>
        <div
          className={`${styles.reasoningProgressFill} ${phase === 'done' ? styles.reasoningProgressDone : ''}`}
          style={{ width: `${progress}%`, background: pipelineCfg.color }}
        />
      </div>

      {/* Body */}
      <div className={styles.reasoningBody}>
        {/* Connecting state */}
        {initPhase === 'connecting' && (
          <div className={styles.reasoningConnecting}>
            <div className={styles.connectingSpinner}>
              <span /><span /><span /><span />
            </div>
            <div>
              <div className={styles.connectingTitle}>Starting {pipelineCfg.label} pipeline</div>
              <div className={styles.connectingSubtitle}>
                Connecting · {memberCount} member{memberCount !== 1 ? 's' : ''} queued
              </div>
            </div>
          </div>
        )}

        {/* No log state */}
        {initPhase === 'no_log' && (
          <div className={styles.reasoningNoLog}>
            <div className={styles.noLogTitle}>Log not available</div>
            <div className={styles.noLogSub}>
              The run log for this batch was not retained. This can happen if the server
              was restarted after the pipeline completed.
            </div>
          </div>
        )}

        {/* Current member live feed */}
        {initPhase === 'active' && phase === 'running' && (
          <div className={styles.currentMemberSection}>
            {/* "Processing X of Y — Name" sticky header */}
            <div className={styles.currentMemberHeader}>
              <span className={styles.currentMemberPulse} />
              <span className={styles.currentMemberLabel}>
                Processing {totalDone + 1} of {memberCount}
              </span>
              {currentMemberName && (
                <span className={styles.currentMemberName}>{currentMemberName}</span>
              )}
            </div>

            {/* Live log nodes */}
            <div className={styles.reasoningFeed}>
              {currentLogs.map((ev, i) => (
                <LiveNode key={ev.id} ev={ev} isLast={i === currentLogs.length - 1} />
              ))}
              <div className={styles.feedLiveIndicator}>
                <span className={styles.feedLiveDot} style={{ background: pipelineCfg.color }} />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>live</span>
              </div>
              <div ref={feedEndRef} />
            </div>
          </div>
        )}

        {/* Done state */}
        {phase === 'done' && initPhase !== 'connecting' && initPhase !== 'no_log' && (
          <div style={{ padding: '16px 16px 8px' }}>
            <div className={styles.detailDoneBox}>
              <ShieldCheck size={28} color="#22c55e" />
              <div className={styles.detailDoneTitle}>All members processed</div>
              <div className={styles.detailDoneSub}>
                {processed} processed{failed > 0 && `, ${failed} failed`}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={styles.reasoningFooter}>
        {phase === 'running' ? (
          <span className={styles.reasoningFooterRunning}>
            Pipeline running in background — safe to close
          </span>
        ) : (
          <div className={styles.reasoningFooterSummary}>
            <CheckCircle2 size={14} color="#22c55e" />
            <span>
              <strong>{processed}</strong> processed
              {failed > 0 && <>, <strong style={{ color: '#dc2626' }}>{failed}</strong> failed</>}
            </span>
          </div>
        )}
        <button
          className={styles.reasoningCloseFooterBtn}
          style={{ background: pipelineCfg.color }}
          onClick={onClose}
        >
          {phase === 'running' ? 'Close & Continue' : 'Close'}
        </button>
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

  // Split into pending (non-completed) and completed
  const pendingBatches = typeBatches
    .filter(b => b.status !== 'Completed')
    // LIFO: newest uploaded first
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Completed batches: only show today's; for RETRO_COVERAGE sort by completedAt desc
  const completedBatches = typeBatches
    .filter(b => b.status === 'Completed' && isCompletedToday(b))
    .sort((a, b) => {
      const tsA = a.completedAt || a.createdAt || '';
      const tsB = b.completedAt || b.createdAt || '';
      return tsB.localeCompare(tsA); // newest first for all types
    });

  // Final display order: pending (LIFO) → completed today
  const displayBatches = [...pendingBatches, ...completedBatches];

  if (isLoading) return <div className={styles.emptyState}>Loading batches...</div>;

  if (displayBatches.length === 0) {
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
      {displayBatches.map(batch => {
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
                <span className={styles.batchCardStatGreen}>✓ {batch.processedCount ?? batch.membersCount} processed</span>
                {batch.failedCount > 0 && <span className={styles.batchCardStatRed}>✗ {batch.failedCount} failed</span>}
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
  const router = useRouter();
  const [activeBatchId, setActiveBatchId]         = useState(null);
  const [showConfirm, setShowConfirm]             = useState(false);
  const [showPanel, setShowPanel]                 = useState(false);
  const [panelBatchId, setPanelBatchId]           = useState(null);
  const [panelMemberCount, setPanelMemberCount]   = useState(0);
  const [panelPipelineType, setPanelPipelineType] = useState('ENROLLMENT');
  const [panelReconnect, setPanelReconnect]       = useState(false);
  const [activeTab, setActiveTab]                 = useState('ENROLLMENT');

  const {
    runningBatchIds, addRunningBatch, removeRunningBatch,
    saveProcessedBatch,
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
    // Also persist any completed batches from the API that aren't in the store yet
    batches
      .filter(b => b.status === 'Completed')
      .forEach(b => {
        saveProcessedBatch({
          batchId: b.id,
          pipelineType: b.pipelineType || b.pipeline_type || 'ENROLLMENT',
          membersCount: b.membersCount || 0,
          processedCount: b.processedCount ?? b.membersCount ?? 0,
          failedCount: b.failedCount || 0,
          completedAt: b.completedAt || b.createdAt || new Date().toISOString(),
          createdAt: b.createdAt || new Date().toISOString(),
        });
      });
  }, [batches, runningBatchIds, removeRunningBatch, saveProcessedBatch]);

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

  const openPanel = useCallback((batch, isReconnect = false) => {
    setPanelBatchId(batch.id);
    setPanelMemberCount(batch.membersCount);
    setPanelPipelineType(batch.pipelineType || batch.pipeline_type || 'ENROLLMENT');
    setPanelReconnect(isReconnect);
    setShowPanel(true);
  }, []);

  const handleInitiate = () => {
    if (!activeBatch) return;
    addRunningBatch(activeBatch.id);
    setShowConfirm(false);
    openPanel(activeBatch, false);
  };

  const handlePanelClose = () => {
    setShowPanel(false);
    queryClient.invalidateQueries({ queryKey: ['batches'] });
  };

  const handleStateUpdate = useCallback((state) => {
    if (state.phase === 'done') {
      removeRunningBatch(state.batchId);
      // Persist to processedBatches for Insights page
      const batch = batches.find(b => b.id === state.batchId);
      saveProcessedBatch({
        batchId: state.batchId,
        pipelineType: state.pipelineType || 'ENROLLMENT',
        membersCount: state.memberCount || panelMemberCount,
        processedCount: state.processed || 0,
        failedCount: state.failed || 0,
        completedAt: new Date().toISOString(),
        createdAt: batch?.createdAt || new Date().toISOString(),
      });
    }
  }, [removeRunningBatch, saveProcessedBatch, batches, panelMemberCount]);
  const counts = {
    ENROLLMENT:    batches.filter(b => (b.pipelineType || 'ENROLLMENT').toUpperCase() === 'ENROLLMENT').length,
    RENEWAL:       batches.filter(b => (b.pipelineType || '').toUpperCase() === 'RENEWAL').length,
    RETRO_COVERAGE: batches.filter(b => (b.pipelineType || '').toUpperCase() === 'RETRO_COVERAGE').length,
  };

  const tabs = [
    { key: 'ENROLLMENT',    label: 'Enrollment',    count: counts.ENROLLMENT },
    { key: 'RENEWAL',       label: 'Renewal',       count: counts.RENEWAL },
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
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className={styles.btnSecondary}
            onClick={() => router.push('/insights')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <BarChart2 size={16} />
            View Processed Batch
          </button>
          <button
            className={styles.btnPrimary}
            onClick={() => generateBatchMutation.mutate()}
            disabled={generateBatchMutation.isPending}
          >
            <Package size={16} />
            {generateBatchMutation.isPending ? 'Bundling...' : 'Generate Batch'}
          </button>
        </div>
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
          const isRunning  = runningBatchIds.includes(activeBatch.id) || activeBatch.status === 'In Progress';
          const isCompleted = activeBatch.status === 'Completed';

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

                {/* Completed */}
                {isCompleted && (
                  <div className={styles.detailDoneBox}>
                    <ShieldCheck size={32} color="#22c55e" />
                    <div className={styles.detailDoneTitle}>Pipeline Complete</div>
                    <div className={styles.detailDoneSub}>
                      {activeBatch.processedCount ?? activeBatch.membersCount} processed
                      {activeBatch.failedCount > 0 && `, ${activeBatch.failedCount} failed`}
                    </div>
                    <button className={styles.btnViewLog} onClick={() => openPanel(activeBatch, true)}>
                      View run log
                    </button>
                  </div>
                )}

                {/* Running */}
                {isRunning && !isCompleted && (
                  <div className={styles.detailRunningBox}>
                    <div className={styles.detailRunningDot} style={{ background: cfg.color }} />
                    <div className={styles.detailRunningTitle}>Pipeline Running</div>
                    <div className={styles.detailRunningSub}>
                      Processing {activeBatch.membersCount} member{activeBatch.membersCount !== 1 ? 's' : ''} in the background
                    </div>
                    <button
                      className={styles.btnViewLive}
                      style={{ borderColor: cfg.color, color: cfg.color }}
                      onClick={() => openPanel(activeBatch, true)}
                    >
                      View live logs
                    </button>
                  </div>
                )}

                {/* Awaiting Approval */}
                {!isRunning && !isCompleted && (
                  <button
                    className={styles.btnInitiate}
                    style={{ background: cfg.color }}
                    onClick={() => setShowConfirm(true)}
                  >
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
                <strong>{cfg.label}</strong> pipeline. All compliance flags and anomalies
                have been resolved or manually overridden.
              </p>
              <div className={styles.modalMeta}>
                <span>{activeBatch.membersCount} members</span>
                <span>·</span>
                <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                <span>·</span>
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

      {/* Live pipeline reasoning panel */}
      {showPanel && panelBatchId && (
        <PipelineReasoningPanel
          batchId={panelBatchId}
          memberCount={panelMemberCount}
          pipelineType={panelPipelineType}
          onClose={handlePanelClose}
          reconnect={panelReconnect}
        />
      )}
    </div>
  );
}
