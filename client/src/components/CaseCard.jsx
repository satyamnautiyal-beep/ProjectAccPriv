/**
 * CaseCard Component
 * Displays a retro enrollment case with deadline and workflow status
 */

'use client';

import React from 'react';
import { Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { useDeadline } from '@/hooks/useDeadline';
import styles from './CaseCard.module.css';

const STATUS_COLORS = {
  IN_PROGRESS: { bg: '#dbeafe', text: '#2563eb' },
  COMPLETED: { bg: '#dcfce7', text: '#16a34a' },
  FAILED: { bg: '#fee2e2', text: '#dc2626' },
};

const STEP_LABELS = {
  AUTH_VERIFY: 'Authorization Verify',
  POLICY_ACTIVATE: 'Policy Activate',
  APTC_CALCULATE: 'APTC Calculate',
  CSR_CONFIRM: 'CSR Confirm',
  BILLING_ADJUST: 'Billing Adjust',
};

export default function CaseCard({ caseItem, onClick, showDetails = false }) {
  if (!caseItem) return null;
  
  const statusColor = STATUS_COLORS[caseItem.status] || STATUS_COLORS.IN_PROGRESS;
  const { formatTimeRemaining, getUrgencyColor, getUrgencyBgColor, urgencyLevel } = useDeadline(caseItem.deadline);
  
  const isUrgent = urgencyLevel === 'urgent' || urgencyLevel === 'critical';
  const isExpired = urgencyLevel === 'expired';
  
  return (
    <div className={`${styles.card} ${isUrgent ? styles.urgent : ''}`} onClick={onClick}>
      <div className={styles.header}>
        <div className={styles.memberInfo}>
          <h3 className={styles.memberName}>{caseItem.member_name}</h3>
          <p className={styles.caseId}>{caseItem.case_id}</p>
        </div>
        <div className={styles.badges}>
          <span
            className={styles.badge}
            style={{
              backgroundColor: statusColor.bg,
              color: statusColor.text,
            }}
          >
            {caseItem.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>
      
      <div className={styles.content}>
        <div className={styles.infoRow}>
          <span className={styles.label}>Effective Date:</span>
          <span className={styles.value}>{caseItem.retro_effective_date}</span>
        </div>
        
        <div className={styles.infoRow}>
          <span className={styles.label}>Current Step:</span>
          <span className={styles.value}>
            {STEP_LABELS[caseItem.current_step] || caseItem.current_step}
          </span>
        </div>
        
        <div
          className={styles.deadlineSection}
          style={{
            backgroundColor: getUrgencyBgColor(),
            borderColor: getUrgencyColor(),
          }}
        >
          <Clock size={16} color={getUrgencyColor()} />
          <div>
            <p className={styles.deadlineLabel}>Deadline</p>
            <p
              className={styles.deadlineValue}
              style={{ color: getUrgencyColor() }}
            >
              {formatTimeRemaining()}
            </p>
          </div>
          {isExpired && <AlertCircle size={16} color={getUrgencyColor()} />}
          {!isExpired && caseItem.status === 'COMPLETED' && (
            <CheckCircle size={16} color={getUrgencyColor()} />
          )}
        </div>
        
        {showDetails && (
          <div className={styles.details}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Member ID:</span>
              <span className={styles.detailValue}>{caseItem.member_id}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Auth Source:</span>
              <span className={styles.detailValue}>{caseItem.auth_source}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Created:</span>
              <span className={styles.detailValue}>
                {new Date(caseItem.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        )}
        
        <div className={styles.footer}>
          <p className={styles.date}>
            Created: {new Date(caseItem.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}
