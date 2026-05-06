/**
 * DeadlineCountdown Component
 * Displays deadline countdown with urgency indicator
 */

'use client';

import React from 'react';
import { Clock, AlertCircle, CheckCircle } from 'lucide-react';
import { useDeadline } from '@/hooks/useDeadline';
import styles from './DeadlineCountdown.module.css';

export default function DeadlineCountdown({ deadline, onExpired }) {
  const {
    timeRemaining,
    urgencyLevel,
    isExpired,
    formatTimeRemaining,
    getUrgencyColor,
    getUrgencyBgColor,
  } = useDeadline(deadline);
  
  React.useEffect(() => {
    if (isExpired && onExpired) {
      onExpired();
    }
  }, [isExpired, onExpired]);
  
  const getIcon = () => {
    if (isExpired) {
      return <AlertCircle size={24} />;
    }
    if (urgencyLevel === 'critical' || urgencyLevel === 'urgent') {
      return <AlertCircle size={24} />;
    }
    return <Clock size={24} />;
  };
  
  return (
    <div
      className={styles.container}
      style={{
        backgroundColor: getUrgencyBgColor(),
        borderColor: getUrgencyColor(),
      }}
    >
      <div className={styles.icon} style={{ color: getUrgencyColor() }}>
        {getIcon()}
      </div>
      
      <div className={styles.content}>
        <p className={styles.label}>Deadline</p>
        <p className={styles.time} style={{ color: getUrgencyColor() }}>
          {formatTimeRemaining()}
        </p>
        <p className={styles.date}>
          {new Date(deadline).toLocaleString()}
        </p>
      </div>
      
      {isExpired && (
        <div className={styles.badge} style={{ backgroundColor: getUrgencyColor() }}>
          EXPIRED
        </div>
      )}
      
      {!isExpired && urgencyLevel === 'critical' && (
        <div className={styles.badge} style={{ backgroundColor: getUrgencyColor() }}>
          CRITICAL
        </div>
      )}
      
      {!isExpired && urgencyLevel === 'urgent' && (
        <div className={styles.badge} style={{ backgroundColor: getUrgencyColor() }}>
          URGENT
        </div>
      )}
    </div>
  );
}
