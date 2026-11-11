'use client';
import { useEffect } from 'react';
import { setCustomerProblemReports } from './customer-bar-store';

/**
 * Tells the customer header whether Report a Problem is offered (its module and the customer's own word removal are both
 * installed), so the Help menu links it or says Coming soon. A flag only: it draws nothing, and the pages and routes
 * still answer for themselves.
 */
export function CustomerProblemReportsFlag({ offered }: { offered: boolean }) {
  useEffect(() => {
    setCustomerProblemReports(offered);
    return () => setCustomerProblemReports(false);
  }, [offered]);
  return null;
}
