'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import AlertCard from '@/components/AlertCard';
import ActivityLog from '@/components/ActivityLog';
import { renewalAPI } from '@/lib/apiClient';
import styles from './detail.module.css';

export default function RenewalDetailPage() {
  const router = useRouter();
  const params = useParams();
  const caseId = params.case_id;
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch alert detail
  const { data: alert, isLoading, error } = useQuery({
    queryKey: ['renewalAlert', caseId],
    queryFn: () => renewalAPI.getAlert(caseId),
    enabled: !!caseId,
  });

  // Initialize status when alert loads
  React.useEffect(() => {
    if (alert && !status) {
      setStatus(alert.status || '');
    }
  }, [alert, status]);

  // Update alert mutation
  const updateMutation = useMutation({
    mutationFn: (data) => renewalAPI.updateAlert(caseId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['renewalAlert', caseId]);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (error) => {
      setSaveError(error.message || 'Failed to update alert');
    },
  });

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await updateMutation.mutateAsync({
        status,
        notes,
      });
    } catch (err) {
      setSaveError(err.message || 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading alert details...</p>
        </div>
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div className={styles.container}>
        <button className={styles.backButton} onClick={() => router.back()}>
          <ArrowLeft size={18} />
          Back
        </button>
        <div className={styles.error}>
          <AlertCircle size={24} />
          <p>Error loading alert. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Back Button */}
      <button className={styles.backButton} onClick={() => router.back()}>
        <ArrowLeft size={18} />
        Back to Alerts
      </button>

      {/* Alert Card */}
      <div className={styles.cardSection}>
        <AlertCard alert={alert} showDetails={true} />
      </div>

      {/* Premium Comparison */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Premium Comparison</h2>
        <div className={styles.comparisonGrid}>
          <div className={styles.comparisonItem}>
            <span className={styles.label}>Prior Gross Premium</span>
            <span className={styles.value}>
              ${alert.prior_gross_premium?.toFixed(2) || 'N/A'}
            </span>
          </div>
          <div className={styles.comparisonItem}>
            <span className={styles.label}>New Gross Premium</span>
            <span className={styles.value}>
              ${alert.new_gross_premium?.toFixed(2) || 'N/A'}
            </span>
          </div>
          <div className={styles.comparisonItem}>
            <span className={styles.label}>Prior APTC</span>
            <span className={styles.value}>
              ${alert.prior_aptc?.toFixed(2) || 'N/A'}
            </span>
          </div>
          <div className={styles.comparisonItem}>
            <span className={styles.label}>New APTC</span>
            <span className={styles.value}>
              ${alert.new_aptc?.toFixed(2) || 'N/A'}
            </span>
          </div>
          <div className={styles.comparisonItem}>
            <span className={styles.label}>Prior Net Premium</span>
            <span className={styles.value}>
              ${alert.prior_net_premium?.toFixed(2) || 'N/A'}
            </span>
          </div>
          <div className={styles.comparisonItem}>
            <span className={styles.label}>New Net Premium</span>
            <span className={styles.value}>
              ${alert.new_net_premium?.toFixed(2) || 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Coverage Details */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Coverage Details</h2>
        <div className={styles.detailsGrid}>
          <div className={styles.detailItem}>
            <span className={styles.label}>Plan Code</span>
            <span className={styles.value}>{alert.plan_code || 'N/A'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.label}>Coverage Type</span>
            <span className={styles.value}>{alert.coverage_type || 'N/A'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.label}>Coverage Start Date</span>
            <span className={styles.value}>{alert.coverage_start_date || 'N/A'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.label}>Coverage End Date</span>
            <span className={styles.value}>{alert.coverage_end_date || 'N/A'}</span>
          </div>
        </div>
      </div>

      {/* Status Update */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Update Status</h2>
        <div className={styles.formGroup}>
          <label htmlFor="status" className={styles.label}>
            Status
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={styles.select}
          >
            <option value="AWAITING_SPECIALIST">Awaiting Specialist</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
      </div>

      {/* Notes */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Notes</h2>
        <div className={styles.formGroup}>
          <label htmlFor="notes" className={styles.label}>
            Add notes about this alert
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Enter any notes or comments..."
            className={styles.textarea}
            rows={4}
          />
        </div>
      </div>

      {/* Activity Log */}
      {alert.activity_log && alert.activity_log.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Activity Log</h2>
          <ActivityLog activities={alert.activity_log} maxItems={10} />
        </div>
      )}

      {/* Messages */}
      {saveError && (
        <div className={styles.errorMessage}>
          <AlertCircle size={18} />
          <p>{saveError}</p>
        </div>
      )}

      {saveSuccess && (
        <div className={styles.successMessage}>
          <p>✓ Changes saved successfully</p>
        </div>
      )}

      {/* Save Button */}
      <div className={styles.actions}>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={styles.saveButton}
        >
          <Save size={18} />
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
