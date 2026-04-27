'use client';

import React, { useRef, useState, useCallback } from 'react';
import Annotation from '@/components/Annotation';
import styles from '@/components/shared.module.css';
import fi from './file-intake.module.css';
import {
  FileText, UploadCloud, RefreshCw, AlertTriangle, Check,
  X, Users, ChevronRight, Loader2, ShieldAlert, ShieldCheck,
  Clock, Eye, Calendar, Building2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine if a file status is "corrupted / cannot be processed" */
const isCorrupt = (status = '') => {
  const s = status.toLowerCase();
  return (
    s.includes('corrupt') ||
    s.includes('broken') ||
    s.includes('cannot') ||
    s.includes('parsing failed') ||
    s.includes('structure error') ||
    s.includes('invalid')
  );
};

/** Determine if a file was uploaded recently (within last 10 minutes) */
const isNew = (file) => {
  if (!file.uploadedAt) return false;
  return Date.now() - new Date(file.uploadedAt).getTime() < 10 * 60 * 1000;
};

/**
 * Sort files: corrupted first → new → rest
 */
const sortFiles = (files = []) => {
  return [...files].sort((a, b) => {
    const aCorrupt = isCorrupt(a.status) ? 0 : 1;
    const bCorrupt = isCorrupt(b.status) ? 0 : 1;
    if (aCorrupt !== bCorrupt) return aCorrupt - bCorrupt;

    const aNew = isNew(a) ? 0 : 1;
    const bNew = isNew(b) ? 0 : 1;
    return aNew - bNew;
  });
};

/** Map raw file status → display label + style class */
const getStatusMeta = (status = '') => {
  const s = status.toLowerCase();
  if (isCorrupt(status)) {
    return { label: 'Cannot be Processed', cls: fi.statusCorrupt, icon: <ShieldAlert size={12} /> };
  }
  if (s.includes('unchecked') || s.includes('pending')) {
    return { label: 'Needs Attention', cls: fi.statusAttention, icon: <Clock size={12} /> };
  }
  if (s.includes('healthy') || s.includes('clean') || s.includes('parsed')) {
    return { label: 'Ready', cls: fi.statusReady, icon: <ShieldCheck size={12} /> };
  }
  if (s.includes('review') || s.includes('checking')) {
    return { label: 'Under Review', cls: fi.statusReview, icon: <Eye size={12} /> };
  }
  return { label: status || 'Unknown', cls: fi.statusDefault, icon: null };
};

/** Derive "Action Needed" text from status */
const getActionNeeded = (status = '') => {
  const s = status.toLowerCase();
  if (isCorrupt(status)) {
    return { text: 'Return to broker', cls: fi.actionNeededUrgent };
  }
  if (s.includes('unchecked')) {
    return { text: 'Run batch health check', cls: fi.actionNeededWarning };
  }
  if (s.includes('healthy') || s.includes('parsed') || s.includes('clean')) {
    return { text: 'Proceed to validation', cls: fi.actionNeeded };
  }
  if (s.includes('review')) {
    return { text: 'Awaiting review', cls: fi.actionNeeded };
  }
  return { text: '—', cls: fi.actionNeeded };
};

/** Format a date string nicely */
const fmtDate = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
};

/** Gender display */
const GenderPill = ({ gender }) => {
  if (!gender) return <span className={fi.actionNeeded}>—</span>;
  const g = gender.toUpperCase();
  const cls = g === 'M' ? fi.genderM : g === 'F' ? fi.genderF : fi.genderOther;
  const label = g === 'M' ? 'Male' : g === 'F' ? 'Female' : gender;
  return <span className={`${fi.genderPill} ${cls}`}>{label}</span>;
};

// ---------------------------------------------------------------------------
// Dependents Panel
// ---------------------------------------------------------------------------
function DependentsPanel({ file, members, isLoadingMembers, onClose }) {
  // Find the member record that matches this file
  // Members are stored per-subscriber; a file can contain multiple subscribers.
  // We match by fileName prefix or show all members if we can't narrow it down.
  const fileBase = file.fileName?.replace(/\.edi$/i, '').toLowerCase();

  // Try to find members whose subscriber_id or file_name matches
  const relatedMembers = members.filter((m) => {
    if (m.file_name && m.file_name.toLowerCase().includes(fileBase)) return true;
    // Fallback: show all members (file → members relationship is 1:many via EDI)
    return true;
  });

  // For the panel we show the first subscriber as the "primary" and their dependents
  // If multiple subscribers exist, show them all with their dependents
  const primaryMember = relatedMembers[0];

  return (
    <>
      {/* Overlay */}
      <div className={fi.panelOverlay} onClick={onClose} aria-hidden="true" />

      {/* Slide-in panel */}
      <aside className={fi.panel} role="dialog" aria-label="Dependents panel">
        {/* Header */}
        <div className={fi.panelHeader}>
          <div className={fi.panelHeaderLeft}>
            <div className={fi.panelTitle}>
              <Users size={18} color="var(--primary)" />
              Dependents
            </div>
            <div className={fi.panelSubtitle}>
              {file.fileName}
            </div>
          </div>
          <button className={fi.panelCloseBtn} onClick={onClose} aria-label="Close panel">
            <X size={16} />
          </button>
        </div>

        {/* Subscriber info strip */}
        {primaryMember && (
          <div className={fi.subscriberStrip}>
            <div className={fi.subscriberField}>
              <span className={fi.subscriberFieldLabel}>Member ID</span>
              <span className={fi.subscriberFieldValue}>
                {primaryMember.subscriber_id || '—'}
              </span>
            </div>
            <div className={fi.subscriberField}>
              <span className={fi.subscriberFieldLabel}>Subscriber</span>
              <span className={fi.subscriberFieldValue}>
                {[primaryMember.member_info?.first_name, primaryMember.member_info?.last_name]
                  .filter(Boolean).join(' ') || '—'}
              </span>
            </div>
            <div className={fi.subscriberField}>
              <span className={fi.subscriberFieldLabel}>Payer / Sponsor</span>
              <span className={fi.subscriberFieldValue}>
                {primaryMember.member_info?.insurer_name ||
                  primaryMember.member_info?.employer_name || '—'}
              </span>
            </div>
            <div className={fi.subscriberField}>
              <span className={fi.subscriberFieldLabel}>Coverage Start</span>
              <span className={fi.subscriberFieldValue}>
                {fmtDate(primaryMember.coverages?.[0]?.coverage_start_date)}
              </span>
            </div>
          </div>
        )}

        {/* Body */}
        <div className={fi.panelBody}>
          {isLoadingMembers ? (
            <div className={fi.panelLoader}>
              <Loader2 size={28} className={fi.spin} color="var(--primary)" />
              Loading member data…
            </div>
          ) : relatedMembers.length === 0 ? (
            <div className={fi.emptyState}>
              <Users size={32} color="var(--border)" />
              <span>No member records found for this file.</span>
              <span style={{ fontSize: '0.8rem' }}>
                Run "Check Batch Health" to ingest members from this file.
              </span>
            </div>
          ) : (
            <Annotation
              title="Dependents Table"
              what="Structured dependent-level data per subscriber"
              why="Gives case workers visibility into family coverage without opening raw EDI"
              how="Mapped from parsed EDI 834 member records — dependents nested under each subscriber"
            >
              {relatedMembers.map((member, mIdx) => {
                const info = member.member_info || {};
                const dependents = member.dependents || [];
                const subscriberName =
                  [info.first_name, info.last_name].filter(Boolean).join(' ') ||
                  member.subscriber_id ||
                  `Subscriber ${mIdx + 1}`;

                return (
                  <div key={member.subscriber_id || mIdx} className={fi.dependentsSection}>
                    {/* Subscriber row label */}
                    <div className={fi.dependentsSectionTitle}>
                      <span>Subscriber — {subscriberName}</span>
                      <span className={fi.dependentsCount}>
                        {dependents.length} dependent{dependents.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {dependents.length === 0 ? (
                      <div className={fi.noDependents}>
                        No dependents on record for this subscriber.
                      </div>
                    ) : (
                      <table className={fi.dependentsTable}>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Date of Birth</th>
                            <th>Gender</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dependents.map((dep, dIdx) => {
                            const di = dep.member_info || {};
                            const name =
                              [di.first_name, di.last_name].filter(Boolean).join(' ') ||
                              `Dependent ${dIdx + 1}`;
                            return (
                              <tr key={dIdx}>
                                <td style={{ fontWeight: 500 }}>{name}</td>
                                <td>{fmtDate(di.dob)}</td>
                                <td><GenderPill gender={di.gender} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </Annotation>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function FileIntakePage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null); // file row clicked

  // ---- Data fetching ----
  const { data: rawFiles = [], isLoading } = useQuery({
    queryKey: ['files'],
    queryFn: () => fetch('/api/files').then((r) => r.json()),
    refetchInterval: 2000,
  });

  const { data: members = [], isLoading: isLoadingMembers } = useQuery({
    queryKey: ['members'],
    queryFn: () => fetch('/api/members').then((r) => r.json()),
    refetchInterval: 5000,
  });

  // Sort files: corrupted → new → rest
  const files = sortFiles(rawFiles);
  const corruptCount = files.filter((f) => isCorrupt(f.status)).length;

  // ---- Actions ----
  const handleCheckStructure = async () => {
    setIsChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch('/api/check-structure', { method: 'POST' });
      const data = await res.json();
      setCheckResult({ healthy: data.healthy, issues: data.issues });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
    } catch (err) {
      console.error(err);
    } finally {
      setIsChecking(false);
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async (fileList) => {
      setUploadState('uploading');
      for (let i = 0; i < fileList.length; i++) {
        const formData = new FormData();
        formData.append('file', fileList[i]);
        try {
          await fetch('/api/upload', { method: 'POST', body: formData });
        } catch {}
      }
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      setUploadState('success');
      setTimeout(() => setUploadState(''), 2000);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reject-corrupt', { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      setCheckResult((prev) => (prev ? { ...prev, issues: 0 } : null));
    },
  });

  const handleFileUpload = (e) => {
    if (e.target.files?.length > 0) uploadMutation.mutate(e.target.files);
  };

  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length > 0) uploadMutation.mutate(e.dataTransfer.files);
  };

  const handleRowClick = useCallback((file) => {
    setSelectedFile(file);
  }, []);

  // ---- Render helpers ----
  const renderFileRow = (file) => {
    const corrupt = isCorrupt(file.status);
    const newFile = isNew(file);
    const { label, cls, icon } = getStatusMeta(file.status);
    const action = getActionNeeded(file.status);
    const isSelected = selectedFile?.id === file.id;

    const rowClass = [
      fi.fileRowClickable,
      corrupt ? fi.fileRowCorrupt : newFile ? fi.fileRowNew : '',
      isSelected ? fi.fileRowSelected : '',
    ].filter(Boolean).join(' ');

    // Derive display fields from members data
    const relatedMember = members.find((m) => {
      if (m.file_name) return m.file_name.toLowerCase().includes(
        file.fileName?.replace(/\.edi$/i, '').toLowerCase()
      );
      return false;
    });
    const info = relatedMember?.member_info || {};
    const memberName = [info.first_name, info.last_name].filter(Boolean).join(' ') || '—';
    const payer = info.insurer_name || info.employer_name || '—';
    const coverageDate = fmtDate(relatedMember?.coverages?.[0]?.coverage_start_date);
    const memberId = relatedMember?.subscriber_id || file.id || '—';

    return (
      <tr
        key={file.id}
        className={rowClass}
        onClick={() => handleRowClick(file)}
        title="Click to view dependents"
      >
        {/* Member Identifier */}
        <td className={fi.colIdentifier}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText
              size={14}
              color={corrupt ? 'var(--danger)' : 'var(--primary)'}
              style={{ flexShrink: 0 }}
            />
            <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 600 }}>
              {memberId}
            </span>
          </div>
        </td>

        {/* Member Name */}
        <td className={fi.colName}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 500, fontSize: '0.88rem' }}>
              {memberName}
              {newFile && (
                <span className={`${fi.priorityBadge} ${fi.priorityBadgeNew}`}>New</span>
              )}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {file.fileName?.endsWith('.edi') ? file.fileName : `${file.fileName?.split('.')[0] || file.fileName}.edi`}
            </span>
          </div>
        </td>

        {/* Payer / Sponsor */}
        <td className={fi.colPayer}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Building2 size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.88rem' }}>{payer}</span>
          </div>
        </td>

        {/* Coverage Effective Date */}
        <td className={fi.colCoverage}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Calendar size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.88rem' }}>{coverageDate}</span>
          </div>
        </td>

        {/* Status */}
        <td className={fi.colStatus}>
          <span className={`${fi.statusBadge} ${cls}`}>
            {icon}
            {label}
          </span>
        </td>

        {/* Action Needed */}
        <td className={fi.colAction}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className={action.cls}>{action.text}</span>
            <span className={fi.clickHint}>
              <ChevronRight size={12} />
              View
            </span>
          </div>
        </td>
      </tr>
    );
  };

  // Split sorted files into groups for section dividers
  const corruptFiles = files.filter((f) => isCorrupt(f.status));
  const newFiles = files.filter((f) => !isCorrupt(f.status) && isNew(f));
  const otherFiles = files.filter((f) => !isCorrupt(f.status) && !isNew(f));

  return (
    <div className={styles.container}>
      {/* ---- Header ---- */}
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>Subscriber Onboard</h1>
          <p className={styles.subtitle}>
            Upload and validate EDI 834 files. Corrupted files are automatically surfaced for action.
          </p>
        </div>
        <button
          onClick={handleCheckStructure}
          disabled={isChecking}
          style={{
            backgroundColor: 'var(--primary)', color: '#fff', border: 'none',
            padding: '8px 18px', borderRadius: '8px',
            cursor: isChecking ? 'not-allowed' : 'pointer',
            opacity: isChecking ? 0.7 : 1,
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '0.9rem',
          }}
        >
          {isChecking
            ? <><RefreshCw size={16} className="animate-spin" /> Checking…</>
            : <><RefreshCw size={16} /> Check Batch Health</>}
        </button>
      </div>

      {/* ---- Check result banner ---- */}
      {checkResult && (
        <div style={{
          padding: 'var(--space-4)', borderRadius: 'var(--radius-md)',
          backgroundColor: checkResult.issues > 0 ? 'var(--danger-light)' : 'var(--success-light)',
          color: checkResult.issues > 0 ? 'var(--danger-dark)' : 'var(--success-dark)',
          fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {checkResult.issues > 0 ? <AlertTriangle size={20} /> : <Check size={20} />}
            <span>
              Validation complete — {checkResult.healthy} healthy, {checkResult.issues} with issues.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {checkResult.issues > 0 && (
              <button
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                style={{
                  backgroundColor: 'var(--danger)', color: 'white', border: 'none',
                  padding: '6px 14px', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '0.85rem', fontWeight: 600,
                }}
              >
                {rejectMutation.isPending ? 'Sending…' : 'Return to broker'}
              </button>
            )}
            <button
              onClick={() => setCheckResult(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ---- Upload zone ---- */}
      <Annotation
        title="File Upload"
        what="Entry point for EDI 834 batch files"
        why="Secure ingestion of raw enrollment data from brokers"
        how="Accepts .edi files via drag-and-drop or file picker; triggers immediate structural validation"
      >
        <div
          className={styles.sectionCard}
          style={{
            padding: 'var(--space-8)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            border: isDragging ? '2px dashed var(--primary)' : '2px dashed var(--border)',
            backgroundColor: isDragging ? 'var(--primary-light)' : 'var(--bg-root)',
            cursor: 'pointer', transition: 'all 0.2s ease',
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            accept=".csv,.xlsx,.xls,.edi"
            multiple
          />
          {uploadState === 'uploading'
            ? <RefreshCw size={44} className="animate-spin" color="var(--primary)" style={{ marginBottom: 'var(--space-4)' }} />
            : <UploadCloud size={44} color="var(--primary)" style={{ marginBottom: 'var(--space-4)' }} />}
          <h3 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: 'var(--space-2)' }}>
            {uploadState === 'uploading' ? 'Uploading…' : 'Upload .EDI files'}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Drag & drop files here, or click to browse
          </p>
        </div>
      </Annotation>

      {/* ---- File table ---- */}
      <Annotation
        title="Corrupted File Prioritization"
        what="Corrupted files automatically surfaced at the top of the list"
        why="Ensures case workers immediately see files that need urgent action before processing downstream"
        how="Frontend sorts by status — corrupt files rise to top, new uploads follow, rest below"
      >
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recent Uploads</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {corruptCount > 0 && (
                <span className={`${fi.statusBadge} ${fi.statusCorrupt}`} style={{ fontSize: '0.72rem' }}>
                  <ShieldAlert size={11} />
                  {corruptCount} file{corruptCount > 1 ? 's' : ''} need action
                </span>
              )}
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Click a row to view dependents
              </span>
            </div>
          </div>

          <table className={styles.table} style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className={fi.colIdentifier}>Member Identifier</th>
                <th className={fi.colName}>Member Name</th>
                <th className={fi.colPayer}>Payer / Sponsor</th>
                <th className={fi.colCoverage}>Coverage Effective Date</th>
                <th className={fi.colStatus}>Status</th>
                <th className={fi.colAction}>Action Needed</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
                    <Loader2 size={20} className={fi.spin} style={{ display: 'inline-block', marginRight: 8 }} />
                    Loading files…
                  </td>
                </tr>
              )}

              {!isLoading && files.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
                    No files uploaded yet. Drag and drop .EDI files above to get started.
                  </td>
                </tr>
              )}

              {/* Corrupted files section */}
              {corruptFiles.length > 0 && (
                <>
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <div className={`${fi.sectionDivider} ${fi.sectionDividerCorrupt}`}>
                        <span className={fi.sectionDividerDot} />
                        Requires Immediate Action — {corruptFiles.length} corrupted file{corruptFiles.length > 1 ? 's' : ''}
                      </div>
                    </td>
                  </tr>
                  {corruptFiles.map(renderFileRow)}
                </>
              )}

              {/* New files section */}
              {newFiles.length > 0 && (
                <>
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <div className={fi.sectionDivider}>
                        <span className={fi.sectionDividerDot} />
                        Recently Uploaded
                      </div>
                    </td>
                  </tr>
                  {newFiles.map(renderFileRow)}
                </>
              )}

              {/* Remaining files */}
              {otherFiles.length > 0 && (
                <>
                  {(corruptFiles.length > 0 || newFiles.length > 0) && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <div className={fi.sectionDivider}>
                          <span className={fi.sectionDividerDot} />
                          All Files
                        </div>
                      </td>
                    </tr>
                  )}
                  {otherFiles.map(renderFileRow)}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Annotation>

      {/* ---- Dependents panel ---- */}
      {selectedFile && (
        <Annotation
          title="Click-to-Drill-Down"
          what="File row click opens dependent-level detail panel"
          why="Gives case workers structured visibility into family coverage without raw EDI access"
          how="Right-side panel slides in with subscriber info and dependents table mapped from parsed EDI data"
        >
          <DependentsPanel
            file={selectedFile}
            members={members}
            isLoadingMembers={isLoadingMembers}
            onClose={() => setSelectedFile(null)}
          />
        </Annotation>
      )}
    </div>
  );
}
