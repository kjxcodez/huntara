import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import {
  EmailLogsFilters,
  STATUS_OPTIONS,
  DIRECTION_OPTIONS,
  RECONCILIATION_OPTIONS,
  type EmailLogsFiltersProps
} from './EmailLogsFilters';
import { EmailLogsList } from './EmailLogsList';

describe('Phase 12 — Email Logs Filter UX', () => {
  // ---------------------------------------------------------------------------
  // 1. Options & Constants Integrity
  // ---------------------------------------------------------------------------
  describe('Options & Constants Integrity', () => {
    it('defines all 3 Direction options with correct values and labels', () => {
      expect(DIRECTION_OPTIONS).toHaveLength(3);
      const values = DIRECTION_OPTIONS.map((o) => o.value);
      expect(values).toEqual(['all', 'OUTBOUND', 'INBOUND']);

      const labels = DIRECTION_OPTIONS.map((o) => o.label);
      expect(labels).toContain('All Directions');
      expect(labels).toContain('Outbound');
      expect(labels).toContain('Inbound Replies');
    });

    it('defines all 7 Status options with correct values and labels', () => {
      expect(STATUS_OPTIONS).toHaveLength(7);
      const values = STATUS_OPTIONS.map((o) => o.value);
      expect(values).toEqual(['all', 'SENT', 'RECEIVED', 'AMBIGUOUS', 'FAILED', 'SENDING', 'QUEUED']);

      const labels = STATUS_OPTIONS.map((o) => o.label);
      expect(labels).toContain('All Statuses');
      expect(labels).toContain('Sent (Accepted)');
      expect(labels).toContain('Received');
      expect(labels).toContain('Ambiguous');
      expect(labels).toContain('Failed');
      expect(labels).toContain('Sending / Retrying');
      expect(labels).toContain('Queued');
    });

    it('defines all 4 Inbound Reconciliation options with correct values and labels', () => {
      expect(RECONCILIATION_OPTIONS).toHaveLength(4);
      const values = RECONCILIATION_OPTIONS.map((o) => o.value);
      expect(values).toEqual(['all', 'CORRELATION_PENDING', 'MATCHED', 'UNMATCHED']);

      const labels = RECONCILIATION_OPTIONS.map((o) => o.label);
      expect(labels).toContain('All Reconciliation');
      expect(labels).toContain('Awaiting Correlation');
      expect(labels).toContain('Matched');
      expect(labels).toContain('Unmatched');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Discoverability & Default Rendering
  // ---------------------------------------------------------------------------
  describe('Discoverability & Default Rendering', () => {
    it('renders all Direction and Status options without clipping or hiding', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'all',
          directionFilter: 'all',
          processingStatusFilter: 'all'
        })
      );

      // Section titles
      expect(html).toContain('Direction');
      expect(html).toContain('Status');

      // Direction options are visibly present
      expect(html).toContain('All Directions');
      expect(html).toContain('Outbound');
      expect(html).toContain('Inbound Replies');

      // All Status options are visibly present (including FAILED, SENDING, QUEUED previously clipped)
      expect(html).toContain('All Statuses');
      expect(html).toContain('Sent (Accepted)');
      expect(html).toContain('Received');
      expect(html).toContain('Ambiguous');
      expect(html).toContain('Failed');
      expect(html).toContain('Sending / Retrying');
      expect(html).toContain('Queued');
    });

    it('does not display Inbound Reconciliation section when direction is "all" and processing status is "all"', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'all',
          directionFilter: 'all',
          processingStatusFilter: 'all'
        })
      );

      expect(html).not.toContain('Inbound Reconciliation');
      expect(html).not.toContain('data-testid="reconciliation-filter-group"');
    });

    it('conditionally displays Inbound Reconciliation when direction is INBOUND', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'all',
          directionFilter: 'INBOUND',
          processingStatusFilter: 'all'
        })
      );

      expect(html).toContain('Inbound Reconciliation');
      expect(html).toContain('data-testid="reconciliation-filter-group"');
      expect(html).toContain('All Reconciliation');
      expect(html).toContain('Awaiting Correlation');
      expect(html).toContain('Matched');
      expect(html).toContain('Unmatched');
    });

    it('conditionally displays Inbound Reconciliation when processingStatus is non-default', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'all',
          directionFilter: 'all',
          processingStatusFilter: 'MATCHED'
        })
      );

      expect(html).toContain('Inbound Reconciliation');
      expect(html).toContain('Matched');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Responsive Wrapping & Layout Constraints
  // ---------------------------------------------------------------------------
  describe('Responsive Wrapping & Layout Constraints', () => {
    it('uses flex-wrap on all filter pill groups to prevent horizontal overflow in 320-380px pane', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'all',
          directionFilter: 'INBOUND',
          processingStatusFilter: 'all'
        })
      );

      // Check for flex flex-wrap gap-1 in the groups
      expect(html).toContain('data-testid="direction-filter-group" class="flex flex-wrap gap-1"');
      expect(html).toContain('data-testid="status-filter-group" class="flex flex-wrap gap-1"');
      expect(html).toContain('data-testid="reconciliation-filter-group" class="flex flex-wrap gap-1"');

      // Must NOT contain hidden scrollbar hacks
      expect(html).not.toContain('no-scrollbar');
      expect(html).not.toContain('overflow-x-auto');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Accessibility & Semantics
  // ---------------------------------------------------------------------------
  describe('Accessibility & Semantics', () => {
    it('provides accessible role="group" and aria-label attributes for each filter group', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'all',
          directionFilter: 'INBOUND',
          processingStatusFilter: 'all'
        })
      );

      expect(html).toContain('role="group" aria-label="Filter by email direction"');
      expect(html).toContain('role="group" aria-label="Filter by delivery status"');
      expect(html).toContain('role="group" aria-label="Filter by inbound reply reconciliation status"');
    });

    it('sets aria-pressed="true" on selected options and "false" on unselected options', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'FAILED',
          directionFilter: 'OUTBOUND',
          processingStatusFilter: 'all'
        })
      );

      // Outbound selected
      expect(html).toContain('data-testid="direction-pill-OUTBOUND" aria-pressed="true"');
      expect(html).toContain('data-testid="direction-pill-all" aria-pressed="false"');
      expect(html).toContain('data-testid="direction-pill-INBOUND" aria-pressed="false"');

      // Failed selected
      expect(html).toContain('data-testid="status-pill-FAILED" aria-pressed="true"');
      expect(html).toContain('data-testid="status-pill-all" aria-pressed="false"');
      expect(html).toContain('data-testid="status-pill-SENT" aria-pressed="false"');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Active State Visual Differentiation
  // ---------------------------------------------------------------------------
  describe('Active State Visual Differentiation', () => {
    it('applies semantic high-contrast styling for critical active statuses', () => {
      // Test FAILED status active
      const htmlFailed = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'FAILED',
          directionFilter: 'all',
          processingStatusFilter: 'all'
        })
      );
      expect(htmlFailed).toContain('bg-rose-600');

      // Test AMBIGUOUS status active
      const htmlAmbiguous = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'AMBIGUOUS',
          directionFilter: 'all',
          processingStatusFilter: 'all'
        })
      );
      expect(htmlAmbiguous).toContain('bg-amber-500');

      // Test SENT status active
      const htmlSent = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'SENT',
          directionFilter: 'all',
          processingStatusFilter: 'all'
        })
      );
      expect(htmlSent).toContain('bg-emerald-600');

      // Test RECEIVED status active
      const htmlReceived = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'RECEIVED',
          directionFilter: 'all',
          processingStatusFilter: 'all'
        })
      );
      expect(htmlReceived).toContain('bg-sky-600');
    });

    it('shows active filter count badge only when filters are active', () => {
      // Default: no active filters
      const htmlDefault = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'all',
          directionFilter: 'all',
          processingStatusFilter: 'all'
        })
      );
      expect(htmlDefault).not.toContain('data-testid="active-filter-badge"');

      // 1 active filter
      const htmlOne = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'FAILED',
          directionFilter: 'all',
          processingStatusFilter: 'all'
        })
      );
      expect(htmlOne).toContain('data-testid="active-filter-badge"');
      expect(htmlOne).toContain('1 active');

      // 2 active filters
      const htmlTwo = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'SENT',
          directionFilter: 'OUTBOUND',
          processingStatusFilter: 'all'
        })
      );
      expect(htmlTwo).toContain('2 active');

      // 3 active filters
      const htmlThree = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'RECEIVED',
          directionFilter: 'INBOUND',
          processingStatusFilter: 'MATCHED'
        })
      );
      expect(htmlThree).toContain('3 active');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Reset Filters Action
  // ---------------------------------------------------------------------------
  describe('Reset Filters Action', () => {
    it('renders "Reset filters" button only when active filters exist and onResetFilters is provided', () => {
      const onReset = vi.fn();

      // Inactive: should not render reset button
      const htmlInactive = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'all',
          directionFilter: 'all',
          processingStatusFilter: 'all',
          onResetFilters: onReset
        })
      );
      expect(htmlInactive).not.toContain('data-testid="reset-filters-btn"');
      expect(htmlInactive).not.toContain('Reset filters');

      // Active: should render reset button
      const htmlActive = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'FAILED',
          directionFilter: 'all',
          processingStatusFilter: 'all',
          onResetFilters: onReset
        })
      );
      expect(htmlActive).toContain('data-testid="reset-filters-btn"');
      expect(htmlActive).toContain('Reset filters');
    });

    it('does not render "Reset filters" button if onResetFilters is not provided', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(EmailLogsFilters, {
          statusFilter: 'FAILED',
          directionFilter: 'OUTBOUND',
          processingStatusFilter: 'all'
        })
      );
      expect(html).not.toContain('data-testid="reset-filters-btn"');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Component Callback Invocations
  // ---------------------------------------------------------------------------
  describe('Component Callback Invocations', () => {
    it('properly triggers onDirectionChange when option is clicked', () => {
      const onDirectionChange = vi.fn();
      const element = EmailLogsFilters({
        statusFilter: 'all',
        directionFilter: 'all',
        processingStatusFilter: 'all',
        onDirectionChange
      });

      // Find the direction pills group
      const directionGroup = (element as any).props.children[1].props.children[1];
      const outboundPill = directionGroup.props.children[1]; // OUTBOUND
      expect(outboundPill.props['data-testid']).toBe('direction-pill-OUTBOUND');

      // Simulate click
      outboundPill.props.onClick();
      expect(onDirectionChange).toHaveBeenCalledTimes(1);
      expect(onDirectionChange).toHaveBeenCalledWith('OUTBOUND');
    });

    it('properly triggers onStatusChange when option is clicked', () => {
      const onStatusChange = vi.fn();
      const element = EmailLogsFilters({
        statusFilter: 'all',
        directionFilter: 'all',
        processingStatusFilter: 'all',
        onStatusChange
      });

      // Find status pills group
      const statusGroup = (element as any).props.children[2].props.children[1];
      const failedPill = statusGroup.props.children.find(
        (c: any) => c.props['data-testid'] === 'status-pill-FAILED'
      );
      expect(failedPill).toBeDefined();

      failedPill.props.onClick();
      expect(onStatusChange).toHaveBeenCalledTimes(1);
      expect(onStatusChange).toHaveBeenCalledWith('FAILED');
    });

    it('properly triggers onProcessingStatusChange when reconciliation option is clicked', () => {
      const onProcessingStatusChange = vi.fn();
      const element = EmailLogsFilters({
        statusFilter: 'all',
        directionFilter: 'INBOUND',
        processingStatusFilter: 'all',
        onProcessingStatusChange
      });

      // Find reconciliation pills group
      const reconciliationGroup = (element as any).props.children[3].props.children[1];
      const matchedPill = reconciliationGroup.props.children.find(
        (c: any) => c.props['data-testid'] === 'reconciliation-pill-MATCHED'
      );
      expect(matchedPill).toBeDefined();

      matchedPill.props.onClick();
      expect(onProcessingStatusChange).toHaveBeenCalledTimes(1);
      expect(onProcessingStatusChange).toHaveBeenCalledWith('MATCHED');
    });

    it('properly triggers onResetFilters when reset button is clicked', () => {
      const onResetFilters = vi.fn();
      const element = EmailLogsFilters({
        statusFilter: 'FAILED',
        directionFilter: 'all',
        processingStatusFilter: 'all',
        onResetFilters
      });

      const header = (element as any).props.children[0];
      const resetBtn = header.props.children[1];
      expect(resetBtn.props['data-testid']).toBe('reset-filters-btn');

      resetBtn.props.onClick();
      expect(onResetFilters).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. EmailLogsList Integration
  // ---------------------------------------------------------------------------
  describe('EmailLogsList Integration', () => {
    it('renders EmailLogsList with EmailLogsFilters embedded and no overflow-x-auto no-scrollbar pills row', () => {
      const html = ReactDOMServer.renderToString(
        React.createElement(EmailLogsList, {
          deliveries: [],
          onSelectDelivery: vi.fn(),
          statusFilter: 'all',
          directionFilter: 'all',
          processingStatusFilter: 'all'
        })
      );

      // Filter component should be rendered
      expect(html).toContain('data-testid="email-logs-filters"');
      expect(html).toContain('data-testid="direction-filter-group"');
      expect(html).toContain('data-testid="status-filter-group"');

      // The old clipped pill row was: flex items-center justify-between gap-2 overflow-x-auto text-xs py-0.5 no-scrollbar
      expect(html).not.toContain('no-scrollbar min-w-0');
    });
  });
});
