/**
 * WorkflowProgress Component
 * Displays workflow step progression
 */

'use client';

import React from 'react';
import { CheckCircle, Circle, AlertCircle } from 'lucide-react';
import styles from './WorkflowProgress.module.css';

const STEP_LABELS = {
  AUTH_VERIFY: 'Authorization Verify',
  POLICY_ACTIVATE: 'Policy Activate',
  APTC_CALCULATE: 'APTC Calculate',
  CSR_CONFIRM: 'CSR Confirm',
  BILLING_ADJUST: 'Billing Adjust',
};

export default function WorkflowProgress({
  steps = [],
  currentStep = null,
  completedSteps = [],
  failedSteps = [],
}) {
  if (!steps || steps.length === 0) {
    return null;
  }
  
  return (
    <div className={styles.container}>
      <div className={styles.timeline}>
        {steps.map((step, index) => {
          const isCompleted = completedSteps.includes(step);
          const isCurrent = step === currentStep;
          const isFailed = failedSteps.includes(step);
          const isPending = !isCompleted && !isCurrent && !isFailed;
          
          return (
            <div key={step} className={styles.stepWrapper}>
              <div
                className={`${styles.step} ${
                  isCompleted ? styles.completed : ''
                } ${isCurrent ? styles.current : ''} ${
                  isFailed ? styles.failed : ''
                } ${isPending ? styles.pending : ''}`}
              >
                <div className={styles.stepIcon}>
                  {isCompleted && <CheckCircle size={24} />}
                  {isCurrent && !isCompleted && <Circle size={24} />}
                  {isFailed && <AlertCircle size={24} />}
                  {isPending && <Circle size={24} />}
                </div>
                <div className={styles.stepContent}>
                  <p className={styles.stepLabel}>
                    {STEP_LABELS[step] || step}
                  </p>
                  {isCurrent && (
                    <p className={styles.stepStatus}>In Progress</p>
                  )}
                  {isCompleted && (
                    <p className={styles.stepStatus}>Completed</p>
                  )}
                  {isFailed && (
                    <p className={styles.stepStatus}>Failed</p>
                  )}
                  {isPending && (
                    <p className={styles.stepStatus}>Pending</p>
                  )}
                </div>
              </div>
              
              {index < steps.length - 1 && (
                <div
                  className={`${styles.connector} ${
                    isCompleted ? styles.completed : ''
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
