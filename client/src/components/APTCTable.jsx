/**
 * APTCTable Component
 * Displays APTC month-by-month breakdown
 */

'use client';

import React from 'react';
import styles from './APTCTable.module.css';

export default function APTCTable({ aptcTable = [], totalLiability = {} }) {
  if (!aptcTable || aptcTable.length === 0) {
    return (
      <div className={styles.container}>
        <p className={styles.empty}>No APTC data available</p>
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Month</th>
              <th className={styles.numeric}>Gross Premium</th>
              <th className={styles.numeric}>APTC</th>
              <th className={styles.numeric}>Net Premium</th>
              <th className={styles.numeric}>Paid to Date</th>
              <th className={styles.numeric}>Owed</th>
            </tr>
          </thead>
          <tbody>
            {aptcTable.map((row, index) => (
              <tr key={index}>
                <td>{row.month}</td>
                <td className={styles.numeric}>
                  ${row.gross_premium?.toFixed(2) || '0.00'}
                </td>
                <td className={styles.numeric}>
                  ${row.aptc?.toFixed(2) || '0.00'}
                </td>
                <td className={styles.numeric}>
                  ${row.net_premium?.toFixed(2) || '0.00'}
                </td>
                <td className={styles.numeric}>
                  ${row.paid_to_date?.toFixed(2) || '0.00'}
                </td>
                <td className={styles.numeric}>
                  ${(row.net_premium - row.paid_to_date)?.toFixed(2) || '0.00'}
                </td>
              </tr>
            ))}
          </tbody>
          {totalLiability && Object.keys(totalLiability).length > 0 && (
            <tfoot>
              <tr className={styles.totalRow}>
                <td>
                  <strong>Total</strong>
                </td>
                <td className={styles.numeric}>
                  <strong>
                    ${totalLiability.total_gross?.toFixed(2) || '0.00'}
                  </strong>
                </td>
                <td className={styles.numeric}>
                  <strong>
                    ${totalLiability.total_aptc?.toFixed(2) || '0.00'}
                  </strong>
                </td>
                <td className={styles.numeric}>
                  <strong>
                    ${totalLiability.total_net?.toFixed(2) || '0.00'}
                  </strong>
                </td>
                <td className={styles.numeric}>
                  <strong>
                    ${totalLiability.total_paid?.toFixed(2) || '0.00'}
                  </strong>
                </td>
                <td className={styles.numeric}>
                  <strong style={{ color: '#dc2626' }}>
                    ${totalLiability.total_owed?.toFixed(2) || '0.00'}
                  </strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
