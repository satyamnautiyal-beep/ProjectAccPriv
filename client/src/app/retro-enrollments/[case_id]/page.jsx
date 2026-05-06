'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import CaseCard from '@/components/CaseCard';
import WorkflowProgress from '@/components/WorkflowProgress';
import APTCTable from '@/components/APTCTable';
import DeadlineCountdown from '@/components/DeadlineCountdown';
import ActivityLog from '@/components/ActivityLog';
import { retroAPI } from '@/lib/apiClient';
import styles from './detail.module.css';

const WORKFLOW_STEPS = ['AUTH_VERIFY', 'POLICY_ACTIVATE', 'APTC_CALCULATE', 'CSR_CONFIRM', 'BILLING_ADJUST'];

export default function RetroDetailPage() {
  const router = useRouter();
  const params = useParams();
  const caseId = params.case_id;
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch case detail
  const { data: caseDetail, isLoading, error } = useQuery({
    queryKey: ['retroCase', caseId],
    queryFn: () => retroAPI.getCase(caseId),
    enabled: !!caseId,
  });

  // Initialize current step when case loads
  React.useEffect(() => {
    if (caseDetail && !currentStep) {
      setCurrentStep(caseDetail.current_step || '');
    }
  }, [caseDetail, currentStep]);

  // Update case mutation
  const updateMutation = useMutation({
    mutationFn: (data) => retroAPI.updateCase(caseId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['retroCase', caseId]);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (error) => {
      setSaveError(error.message || 'Failed to update case');
    },
  });

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await updateMutation.mutateAsync({
        current_step: currentStep,
        notes,
      });
    } catch (err) {
      setSaveError(err.message || 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdvanceStep = () => {
    const currentIndex = WORKFLOW_STEPS.indexOf(currentStep);
    if (currentIndex < WORKFLOW_STEPS.length - 1) {
      setCurrentStep(WORKFLOW_STEPS[currentIndex + 1]);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>Loading case details...</p>
        </div>
      </div>
    );
  }

  if (error || !caseDetail) {
    return (
      <div className={styles.container}>
        <button className={styles.backButton} onClick={() => router.back()}>
          <ArrowLeft size={18} />
          Back
        </button>
        <div className={styles.error}>
          <AlertCircle size={24} />
          <p>Error loading case. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Back Button */}
      <button className={styles.backButton} onClick={() => router.back()}>
        <ArrowLeft size={18} />
        Back to Cases
      </button>

      {/* Case Card */}
      <div className={styles.cardSection}>
        <CaseCard caseItem={caseDetail} showDetails={true} />
      </div>

      {/* Deadline Countdown */}
      <div className={styles.section}>
        <DeadlineCountdown deadline={caseDetail.deadline} />
      </div>

      {/* Workflow Progress */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Workflow Progress</h2>
        <WorkflowProgress
          steps={WORKFLOW_STEPS}
          currentStep={caseDetail.current_step}
          completedSteps={caseDetail.steps_completed || []}
          failedSteps={[]}
        />
      </div>

      {/* Member Information */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Member Information</h2>
        <div className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <span className={styles.label}>Member ID</span>
            <span className={styles.value}>{caseDetail.member_id}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.label}>Member Name</span>
            <span className={styles.value}>{caseDetail.member_name}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.label}>Date of Birth</span>
            <span className={styles.value}>{caseDetail.member_dob || 'N/A'}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.label}>State</span>
            <span className={styles.value}>{caseDetail.member_state || 'N/A'}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.label}>Retro Effective Date</span>
            <span className={styles.value}>{caseDetail.retro_effective_date}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.label}>Authorization Source</span>
            <span className={styles.value}>{caseDetail.auth_source}</span>
          </div>
        </div>
      </div>

      {/* APTC Table */}
      {caseDetail.aptc_table && caseDetail.aptc_table.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Retroactive APTC Breakdown</h2>
          <APTCTable
            aptcTable={caseDetail.aptc_table}
            totalLiability={caseDetail.total_liability}
          />
        </div>
      )}

      {/* Step Update */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Update Workflow Step</h2>
        <div className={styles.formGroup}>
          <label htmlFor="step" className={styles.label}>
            Current Step
          </label>
          <select
            id="step"
            value={currentStep}
            onChange={(e) => setCurrentStep(e.target.value)}
            className={styles.select}
          >
            {WORKFLOW_STEPS.map((step) => (
              <option key={step} value={step}>
                {step.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdvanceStep}
            disabled={WORKFLOW_STEPS.indexOf(currentStep) === WORKFLOW_STEPS.length - 1}
            className={styles.advanceButton}
          >
            Advance to Next Step
          </button>
        </div>
      </div>

      {/* Notes */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Notes</h2>
        <div className={styles.formGroup}>
          <label htmlFor="notes" className={styles.label}>
            Add notes about this case
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
      {caseDetail.activity_log && caseDetail.activity_log.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Activity Log</h2>
          <ActivityLog activities={caseDetail.activity_log} maxItems={10} />
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
