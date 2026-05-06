/**
 * ActivityLog Component
 * Displays activity log timeline
 */

'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './ActivityLog.module.css';

export default function ActivityLog({ activities = [], maxItems = 10 }) {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [showAll, setShowAll] = useState(false);
  
  if (!activities || activities.length === 0) {
    return (
      <div className={styles.container}>
        <p className={styles.empty}>No activity yet</p>
      </div>
    );
  }
  
  const displayedActivities = showAll ? activities : activities.slice(0, maxItems);
  const hasMore = activities.length > maxItems && !showAll;
  
  const getActionColor = (action) => {
    if (action.includes('CREATED')) return '#3b82f6';
    if (action.includes('COMPLETED')) return '#22c55e';
    if (action.includes('FAILED')) return '#ef4444';
    if (action.includes('UPDATED')) return '#f59e0b';
    return '#6b7280';
  };
  
  return (
    <div className={styles.container}>
      <div className={styles.timeline}>
        {displayedActivities.map((activity, index) => (
          <div key={index} className={styles.entry}>
            <div
              className={styles.dot}
              style={{ backgroundColor: getActionColor(activity.action) }}
            />
            
            <div className={styles.content}>
              <div className={styles.header}>
                <h4 className={styles.action}>{activity.action}</h4>
                <span className={styles.timestamp}>
                  {new Date(activity.timestamp).toLocaleString()}
                </span>
              </div>
              
              <p className={styles.actor}>by {activity.actor}</p>
              
              {activity.details && (
                <div className={styles.details}>
                  <p className={styles.detailsText}>{activity.details}</p>
                </div>
              )}
              
              {activity.status && (
                <div className={styles.status}>
                  <span
                    className={styles.statusBadge}
                    style={{
                      backgroundColor: getActionColor(activity.status),
                      opacity: 0.2,
                      color: getActionColor(activity.status),
                    }}
                  >
                    {activity.status}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {hasMore && (
        <button
          onClick={() => setShowAll(true)}
          className={styles.showMore}
        >
          <ChevronDown size={16} />
          Show {activities.length - maxItems} more activities
        </button>
      )}
    </div>
  );
}
