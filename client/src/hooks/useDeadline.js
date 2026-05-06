/**
 * useDeadline Hook
 * Manages deadline countdown and urgency tracking
 */

import { useState, useEffect, useCallback } from 'react';

export function useDeadline(deadline) {
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [urgencyLevel, setUrgencyLevel] = useState('normal');
  const [isExpired, setIsExpired] = useState(false);
  
  // Calculate time remaining and urgency
  useEffect(() => {
    if (!deadline) return;
    
    const updateDeadline = () => {
      const now = new Date();
      const deadlineDate = new Date(deadline);
      const diff = deadlineDate - now;
      
      if (diff <= 0) {
        setTimeRemaining(null);
        setUrgencyLevel('expired');
        setIsExpired(true);
        return;
      }
      
      // Calculate hours and minutes remaining
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      setTimeRemaining({ hours, minutes, diff });
      
      // Determine urgency level
      if (hours < 1) {
        setUrgencyLevel('critical');
      } else if (hours < 12) {
        setUrgencyLevel('urgent');
      } else if (hours < 24) {
        setUrgencyLevel('warning');
      } else {
        setUrgencyLevel('normal');
      }
      
      setIsExpired(false);
    };
    
    // Update immediately
    updateDeadline();
    
    // Update every minute
    const interval = setInterval(updateDeadline, 60000);
    
    return () => clearInterval(interval);
  }, [deadline]);
  
  // Format time remaining as string
  const formatTimeRemaining = useCallback(() => {
    if (!timeRemaining) {
      return isExpired ? 'Expired' : 'Loading...';
    }
    
    const { hours, minutes } = timeRemaining;
    
    if (hours === 0) {
      return `${minutes}m left`;
    }
    
    if (minutes === 0) {
      return `${hours}h left`;
    }
    
    return `${hours}h ${minutes}m left`;
  }, [timeRemaining, isExpired]);
  
  // Get urgency color
  const getUrgencyColor = useCallback(() => {
    switch (urgencyLevel) {
      case 'critical':
        return '#dc2626'; // Red
      case 'urgent':
        return '#ea580c'; // Orange-red
      case 'warning':
        return '#f59e0b'; // Amber
      case 'normal':
        return '#22c55e'; // Green
      case 'expired':
        return '#6b7280'; // Gray
      default:
        return '#6b7280';
    }
  }, [urgencyLevel]);
  
  // Get urgency background color
  const getUrgencyBgColor = useCallback(() => {
    switch (urgencyLevel) {
      case 'critical':
        return '#fee2e2'; // Red light
      case 'urgent':
        return '#fed7aa'; // Orange light
      case 'warning':
        return '#fef3c7'; // Amber light
      case 'normal':
        return '#dcfce7'; // Green light
      case 'expired':
        return '#f3f4f6'; // Gray light
      default:
        return '#f3f4f6';
    }
  }, [urgencyLevel]);
  
  return {
    timeRemaining,
    urgencyLevel,
    isExpired,
    formatTimeRemaining,
    getUrgencyColor,
    getUrgencyBgColor,
  };
}
