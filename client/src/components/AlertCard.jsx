/**
 * AlertCard Component
 * Displays a renewal alert with priority and status badges
 */

'use client';

import React from 'react';
import { DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import styles from './AlertCard.module.css';

const PRIORITY_COLORS = {
  HIGH: { bg: '#fee2e2', text: '#dc2626' },
  MEDIUM: { bg: '#fef3c7', text: '#d97706' },
  LOW: { bg: '#dbeafe', text: '#2563eb' },
};

const STATUS_COLORS = {
  AWAITING_SPECIALIST: { bg: '#fef3c7', text: '#d97706' },
  IN_PROGRESS: { bg: '#dbeafe', text: '#2563eb' },
  COMPLETED: { bg: '#dcfce7', text: '#16a34a' },
  FAILED: { bg: '#fee2e2', text: '#dc2626' },
};

export default function AlertCard({ alert, onClick, showDetails = false }) {
  if (!alert) return null;
  
  const priorityColor = PRIORITY_COLORS[alert.priority] || PRIORITY_COLORS.LOW;
  const statusColor = STATUS_COLORS[alert.status] || STATUS_COLORS.AWAITING_SPECIALIST;
  
  const isDeltaIncrease = alert.premium_delta > 0;
  const DeltaIcon = isDeltaIncrease ? TrendingUp : TrendingDown;
  const deltaColor = isDeltaIncrease ? '#dc2626' : '#16a34a';
  
  return (
    <div className={styles.card} onClick={onClick}>
      <div className={styles.header}>
        <div className={styles.memberInfo}>
          <h3 className={styles.memberName}>{alert.member_name}</h3>
          <p className={styles.caseId}>{alert.case_id}</p>
        </div>
        <div className={styles.badges}>
          <span
            className={styles.badge}
            style={{
              backgroundColor: priorityColor.bg,
              color: priorityColor.text,
            }}
          >
            {alert.priority}
          </span>
          <span
            className={styles.badge}
            style={{
              backgroundColor: statusColor.bg,
              color: statusColor.text,
            }}
          >
            {alert.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>
      
      <div className={styles.content}>
        <div className={styles.deltaSection}>
          <DeltaIcon size={18} color={deltaColor} />
          <div>
            <p className={styles.deltaLabel}>Premium Delta</p>
            <p className={styles.deltaValue} style={{ color: deltaColor }}>
              ${Math.abs(alert.premium_delta).toFixed(2)} {isDeltaIncrease ? '↑' : '↓'}
            </p>
          </div>
        </div>
        
        {showDetails && (
          <div className={styles.details}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Prior Gross:</span>
              <span className={styles.detailValue}>${alert.prior_gross?.toFixed(2) || 'N/A'}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>New Gross:</span>
              <span className={styles.detailValue}>${alert.new_gross?.toFixed(2) || 'N/A'}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Prior APTC:</span>
              <span className={styles.detailValue}>${alert.prior_aptc?.toFixed(2) || 'N/A'}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>New APTC:</span>
              <span className={styles.detailValue}>${alert.new_aptc?.toFixed(2) || 'N/A'}</span>
            </div>
          </div>
        )}
        
        <div className={styles.footer}>
          <p className={styles.date}>
            Created: {new Date(alert.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}
