'use client';

import React, { useState, useRef, useEffect } from 'react';
import styles from './release-staging.module.css';
import { Package, X, Send, ShieldCheck, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

// ─── helpers ────────────────────────────────────────────────────────────────

function statusColor(status) {
  if (status === 'Enrolled' || status === 'Enrolled (SEP)') return 'green';
  if (status === 'In Review') return 'amber';
  if (status === 'Processing Failed') return 'red';
  return 'muted';
}

function BatchStatusBadge({ status }) {
  const map = {
    'Awaiting Approval': { label: 'Pending Release', cls: styles.badgePending },
    'Completed':         { label: 'Enrolled',         cls: styles.badgeEnrolled },
    'In Progress':       { label: 'Processing',       cls: styles.badgeProcessing },
  };
  const { label, cls } = map[status] || { label: status, cls: styles.badgeMuted };
  return <span className={`${styles.badge} ${cls}`}>{label}</span>;
}

// ─── Live Enrollment Console ─────────────────────────────────────────────────

function statusDotClass(status, styles) {
  if (status === 'Enrolled' || status === 'Enrolled (SEP)') return styles.consoleDotGreen;
  if (status === 'In Review') return styles.consoleDotAmber;
  return styles.consoleDotRed;
}

function MemberGroup({ group, isActive, onToggle, styles }) {
  const { name, subscriberId, steps, result, expanded } = group;
  const isOpen = expanded;
  const color = result ? statusColor(result.status) : null;

  return (
    <div className={styles.memberGroup}>
      {/* Member header row — always visible, clickable to expand/collapse */}
      <button
        className={`${styles.memberGroupHeader} ${isActive ? styles.memberGroupHeaderActive : ''} ${result ? styles.memberGroupHeaderDone : ''}`}
        onClick={onToggle}
      >
        {/* Status dot */}
        <div className={`${styles.memberGroupDot}
          ${!result ? (isActive ? styles.memberGroupDotActive : '') : ''}
          ${result && color === 'green' ? styles.memberGroupDotGreen : ''}
          ${result && color === 'amber' ? styles.memberGroupDotAmber : ''}
          ${result && color === 'red' ? styles.memberGroupDotRed : ''}
        `} />

        {/* Name + subscriber ID */}
        <div className={styles.memberGroupInfo}>
          <span className={styles.memberGroupName}>{name}</span>
          <span className={styles.memberGroupSub}>{subscriberId}</span>
        </div>

        {/* Result badge or "processing" indicator */}
        <div className={styles.memberGroupRight}>
          {result ? (
            <span className={`${styles.memberGroupStatus}
              ${color === 'green' ? styles.memberGroupStatusGreen : ''}
              ${color === 'amber' ? styles.memberGroupStatusAmber : ''}
              ${color === 'red' ? styles.memberGroupStatusRed : ''}
            `}>
              {result.status}
            </span>
          ) : isActive ? (
            <span className={styles.memberGroupProcessing}>
              <span /><span /><span />
            </span>
          ) : null}
          {/* Chevron */}
          <span className={`${styles.memberGroupChevron} ${isOpen ? styles.memberGroupChevronOpen : ''}`}>
            ›
          </span>
        </div>
      </button>

      {/* Collapsible steps */}
      {isOpen && (
        <div className={styles.memberGroupSteps}>
          {steps.map((step, i) => {
            const isDone = step.type === 'stage_done';
            const isWarn = step.type === 'warning';
            return (
              <div key={i} className={styles.memberGroupStep}>
                <span className={`${styles.memberGroupStepText}
                  ${isDone ? styles.memberGroupStepTextGreen : ''}
                  ${isWarn ? styles.memberGroupStepTextRed : ''}
                `}>
                  {step.message.trim()}
                </span>
              </div>
            );
          })}
          {result?.summary && (
            <div className={styles.memberGroupSummary}>{result.summary}</div>
          )}
        </div>
      )}
    </div>
  );
}

function EnrollmentConsole({ batchId, memberCount, onClose, onComplete, replayLog }) {
  // members: [{ id, name, subscriberId, steps[], result, expanded }]
  const [members, setMembers] = useState([]);
  const [preamble, setPreamble] = useState(null);
  const [doneEvent, setDoneEvent] = useState(null);
  const [processed, setProcessed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [phase, setPhase] = useState('running');
  const timelineEndRef = useRef(null);
  const abortRef = useRef(null);

  // Shared event processor — used by both live stream and log replay
  const processEvent = (payload, setMembersRef, setPreambleRef, setDoneEventRef, setProcessedRef, setFailedRef, setPhaseRef, addStepRef) => {
    if (payload.type === 'start') {
      setPreambleRef(`Starting enrollment pipeline for ${payload.memberCount} member${payload.memberCount !== 1 ? 's' : ''}...`);
    } else if (payload.type === 'thinking') {
      const isHeader = payload.message.startsWith('──');
      if (isHeader) {
        const match = payload.message.match(/Starting pipeline for (.+?) \((.+?)\)/);
        const name = match ? match[1] : 'Member';
        const subscriberId = match ? match[2] : '';
        setMembersRef(prev => {
          const updated = prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, expanded: false } : m
          );
          return [...updated, {
            id: Math.random().toString(36).slice(2),
            name, subscriberId, steps: [], result: null, expanded: false,
          }];
        });
      } else {
        const isDone = payload.message.includes('✓');
        const isWarning = payload.message.includes('⚠');
        if (isDone || isWarning) {
          addStepRef({ type: isDone ? 'stage_done' : 'warning', message: payload.message });
        }
      }
    } else if (payload.type === 'member_result') {
      setMembersRef(prev => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const last = { ...updated[updated.length - 1] };
        last.result = payload;
        last.expanded = false;
        updated[updated.length - 1] = last;
        return updated;
      });
      if (payload.status === 'Processing Failed') {
        setFailedRef(f => f + 1);
      } else {
        setProcessedRef(p => p + 1);
      }
    } else if (payload.type === 'done') {
      setPhaseRef('done');
      setDoneEventRef(payload);
      onComplete?.({ processed: payload.processed, failed: payload.failed });
    }
  };

  const addStep = (step) => {
    setMembers(prev => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const last = { ...updated[updated.length - 1] };
      last.steps = [...last.steps, step];
      updated[updated.length - 1] = last;
      return updated;
    });
  };

  useEffect(() => {
    // Replay mode — process the persisted log instantly
    if (replayLog && replayLog.length > 0) {
      replayLog.forEach(payload => {
        processEvent(payload, setMembers, setPreamble, setDoneEvent, setProcessed, setFailed, setPhase, addStep);
      });
      return;
    }

    // Live stream mode
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    const controller = new AbortController();
    abortRef.current = controller;

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
            processEvent(payload, setMembers, setPreamble, setDoneEvent, setProcessed, setFailed, setPhase, addStep);
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setPhase('done');
        }
      }
    })();

    return () => controller.abort();
  }, [batchId, replayLog]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [members, phase]);

  const toggleMember = (id) => {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, expanded: !m.expanded } : m));
  };

  const isReplay = !!replayLog;
  const progress = memberCount > 0 ? Math.round(((processed + failed) / memberCount) * 100) : 0;
  const activeMemberId = !isReplay ? (members.find(m => !m.result)?.id ?? null) : null;

  return (
    <div className={styles.consoleOverlay}>
      <div className={styles.consolePanel}>
        {/* Header */}
        <div className={styles.consoleHeader}>
          <div className={styles.consoleHeaderLeft}>
            <div className={`${styles.consoleLiveDot} ${phase === 'running' && !isReplay ? styles.consoleLiveDotActive : styles.consoleLiveDotDone}`} />
            <div>
              <div className={styles.consoleTitle}>
                {isReplay ? 'Enrollment Log' : phase === 'running' ? 'Enrollment Pipeline Running' : 'Enrollment Complete'}
              </div>
              <div className={styles.consoleMeta}>{batchId}</div>
            </div>
          </div>
          <button className={styles.consoleCloseBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className={styles.consoleProgressTrack}>
          <div
            className={`${styles.consoleProgressBar} ${phase === 'done' ? styles.consoleProgressBarDone : ''}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className={styles.consoleProgressLabel}>
          <span>{processed + failed} / {memberCount} members processed</span>
          <span>{progress}%</span>
        </div>

        {/* Stats row */}
        {(processed > 0 || failed > 0) && (
          <div className={styles.consoleStats}>
            <div className={styles.consoleStat}>
              <CheckCircle2 size={14} color="#22c55e" />
              <span className={styles.consoleStatGreen}>{processed} enrolled</span>
            </div>
            {failed > 0 && (
              <div className={styles.consoleStat}>
                <XCircle size={14} color="#ef4444" />
                <span className={styles.consoleStatRed}>{failed} failed</span>
              </div>
            )}
            {phase === 'running' && (
              <div className={styles.consoleStat}>
                <Clock size={14} color="var(--text-muted)" />
                <span className={styles.consoleStatMuted}>{memberCount - processed - failed} remaining</span>
              </div>
            )}
          </div>
        )}

        {/* Member groups */}
        <div className={styles.consoleTimeline}>
          {preamble && (
            <div className={styles.consolePreamble}>{preamble}</div>
          )}
          {members.map((group) => (
            <MemberGroup
              key={group.id}
              group={group}
              isActive={group.id === activeMemberId}
              onToggle={() => toggleMember(group.id)}
              styles={styles}
            />
          ))}
          {phase === 'done' && doneEvent && (
            <div className={styles.consoleDoneRow}>
              <div className={styles.consoleDotPurple + ' ' + styles.consoleTimelineDot} />
              <span className={styles.consoleTimelineMsgDone}>
                Pipeline complete — {doneEvent.processed} enrolled, {doneEvent.failed} failed
              </span>
            </div>
          )}
          <div ref={timelineEndRef} />
        </div>

        {/* Done footer — only in live mode */}
        {phase === 'done' && !isReplay && (
          <div className={styles.consoleDoneFooter}>
            <div className={styles.consoleDoneSummary}>
              <CheckCircle2 size={20} color="#22c55e" />
              <span>
                <strong>{processed}</strong> member{processed !== 1 ? 's' : ''} enrolled
                {failed > 0 && <>, <strong className={styles.consoleDoneRed}>{failed}</strong> failed</>}
              </span>
            </div>
            <button className={styles.consoleDoneBtn} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ReleaseStagingPage() {
  const router = useRouter();
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleBatchId, setConsoleBatchId] = useState(null);
  const [consoleMemberCount, setConsoleMemberCount] = useState(0);
  const [replayLog, setReplayLog] = useState(null); // null = live, array = replay
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => fetch('/api/batches').then(res => res.json()).then(data =>
      // Sort newest first by createdAt
      [...data].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
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
    onError: () => alert("No Ready members to batch."),
  });

  const activeBatch = batches.find(b => b.id === activeBatchId);

  const handleInitiate = () => {
    if (!activeBatch) return;
    setConsoleBatchId(activeBatch.id);
    setConsoleMemberCount(activeBatch.membersCount);
    setReplayLog(null); // live mode
    setShowConfirm(false);
    setShowConsole(true);
  };

  const handleViewLog = async (batch) => {
    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
      const res = await fetch(`${backendUrl}/api/batches/log/${batch.id}`);
      if (!res.ok) throw new Error('Log not found');
      const data = await res.json();
      setConsoleBatchId(batch.id);
      setConsoleMemberCount(batch.membersCount);
      setReplayLog(data.log || []);
      setShowConsole(true);
    } catch {
      // Log not available yet — shouldn't happen for completed batches
      alert('Enrollment log not available for this batch.');
    }
  };

  const handleConsoleClose = () => {
    setShowConsole(false);
    setConsoleBatchId(null);
    setReplayLog(null);
    setActiveBatchId(null);
    queryClient.invalidateQueries({ queryKey: ['batches'] });
  };

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Release Staging</h1>
          <p className={styles.subtitle}>Finalize reviewed records and release batches to the enrollment pipeline.</p>
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

      {/* Batch grid */}
      <div className={`${styles.batchGrid} ${activeBatchId ? styles.batchGridShifted : ''}`}>
        {isLoading && (
          <div className={styles.emptyState}>Loading batches...</div>
        )}
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
            <div className={styles.batchCardMeta}>
              Created {new Date(batch.createdAt).toLocaleDateString()}
            </div>
            {batch.status === 'Completed' && (
              <div className={styles.batchCardStats}>
                <span className={styles.batchCardStatGreen}>✓ {batch.processedCount ?? batch.membersCount} enrolled</span>
                {batch.failedCount > 0 && (
                  <span className={styles.batchCardStatRed}>✗ {batch.failedCount} failed</span>
                )}
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
              <button className={styles.detailClose} onClick={() => setActiveBatchId(null)}>
                <X size={18} />
              </button>
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
                <>
                  <div className={styles.detailDoneBox}>
                    <ShieldCheck size={32} color="#22c55e" />
                    <div className={styles.detailDoneTitle}>Enrollment Complete</div>
                    <div className={styles.detailDoneSub}>
                      {activeBatch.processedCount ?? activeBatch.membersCount} enrolled
                      {activeBatch.failedCount > 0 && `, ${activeBatch.failedCount} failed`}
                    </div>
                  </div>
                  <button
                    className={styles.btnViewLog}
                    onClick={() => handleViewLog(activeBatch)}
                  >
                    View Enrollment Log
                  </button>
                </>
              ) : (
                <button
                  className={styles.btnInitiate}
                  onClick={() => setShowConfirm(true)}
                >
                  <Send size={16} />
                  Initiate Enrollment
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
            <div className={styles.modalIcon}>
              <AlertCircle size={40} color="var(--primary)" />
            </div>
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
              <button className={styles.btnSecondary} onClick={() => setShowConfirm(false)}>
                Cancel
              </button>
              <button className={styles.btnPrimary} onClick={handleInitiate}>
                <Send size={14} />
                I Agree &amp; Release
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live enrollment console */}
      {showConsole && consoleBatchId && (
        <EnrollmentConsole
          batchId={consoleBatchId}
          memberCount={consoleMemberCount}
          onClose={handleConsoleClose}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ['batches'] })}
          replayLog={replayLog}
        />
      )}
    </div>
  );
}
