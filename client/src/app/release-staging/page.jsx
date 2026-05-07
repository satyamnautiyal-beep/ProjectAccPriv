'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './release-staging.module.css';
import {
  Package, X, Send, ShieldCheck, AlertCircle, CheckCircle2,
  Cpu, Zap, TrendingUp, Clock, AlertTriangle,
  ArrowRight, Activity, Brain, Calculator, FileCheck,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import useUIStore from '@/store/uiStore';

// ---------------------------------------------------------------------------
// Pipeline config
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Classify SSE event into a visual node type
// ---------------------------------------------------------------------------
function classifyEvent(ev, pipelineType) {
  const msg = ev.message || '';
  if (ev.type === 'agent_call') return 'agent_call';
  if (/anomaly|warning|⚠/i.test(msg))                                         return 'anomaly';
  if (/override|llm confirmed|llm override|reasoning/i.test(msg))              return 'llm_reasoning';
  if (/specialist note/i.test(msg))                                             return 'specialist';
  if (/compliance|regulatory|mandate/i.test(msg))                              return 'compliance';
  if (/calculat|comput|delta|liability|premium change|aptc|subsidy/i.test(msg)) return 'calculation';
  if (/priority.*high|high.*priority|flagging.*review|in review/i.test(msg))   return 'flag';
  if (/approved|approving|enrolled|all.*passed|no.*liability/i.test(msg))      return 'approved';
  if (/error|failed|no coverage/i.test(msg))                                   return 'error';
  if (/connecting|starting.*pipeline|initializ/i.test(msg))                    return 'system';
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
// Compact completed-member row shown in the trail above the live feed
// ---------------------------------------------------------------------------
function CompletedMemberRow({ member, cfg }) {
  const color = statusColor(member.status);
  const dotColor = color === 'green' ? '#22c55e' : color === 'amber' ? '#f59e0b' : '#ef4444';
  const textColor = color === 'green' ? '#16a34a' : color === 'amber' ? '#d97706' : '#dc2626';
  const icon = color === 'green' ? <CheckCircle2 size={12} /> : color === 'amber' ? <AlertCircle size={12} /> : <X size={12} />;
  return (
    <div className={styles.completedRow}>
      <span className={styles.completedRowIcon} style={{ color: dotColor }}>{icon}</span>
      <span className={styles.completedRowName}>{member.name}</span>
      <span className={styles.completedRowStatus} style={{ color: textColor }}>{member.status}</span>
    </div>
  );
}