/**
 * Centralized styled-components for consistent styling across the app.
 * Import these in component files instead of redefining common patterns.
 */
import styled, { css } from 'styled-components';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const SectionTitle = styled.h4`
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
`;

export const MutedText = styled.p`
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0;
`;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export const PrimaryButton = styled.button`
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  transition: background-color 0.15s ease;
  &:hover:not(:disabled) { background: var(--color-primary-hover); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

export const GhostButton = styled.button`
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: background-color 0.15s ease;
  &:hover { background: var(--color-bg-hover); }
`;

export const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: ${(p) => (p.$active ? 'var(--color-bg-active)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--color-text)' : 'var(--color-text-secondary)')};
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease;
  flex-shrink: 0;
  &:hover { background: var(--color-bg-hover); color: var(--color-text); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

// ---------------------------------------------------------------------------
// Form elements
// ---------------------------------------------------------------------------

export const Input = styled.input`
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  &::placeholder { color: var(--color-text-muted); }
  &:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
  }
  &:disabled { opacity: 0.6; }
`;

export const Select = styled.select`
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s ease;
  &:focus { border-color: var(--color-primary); }
`;

export const FieldGroup = styled.div`
  margin-bottom: 10px;
`;

export const FieldLabel = styled.label`
  display: block;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
`;

export const FieldError = styled.p`
  color: var(--color-danger);
  font-size: 13px;
  margin: 4px 0 0;
`;

// ---------------------------------------------------------------------------
// Cards & Sections
// ---------------------------------------------------------------------------

export const Card = styled.div`
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 24px var(--color-shadow);
`;

export const PaneSection = styled.section`
  margin-bottom: 8px;
  padding: 12px;
  background: var(--color-bg);
  border-radius: 8px;
  border: 1px solid var(--color-border);
`;

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  background: var(--color-badge-bg);
  color: var(--color-badge-text);
`;

/** Status-aware badge with color based on $status prop */
export const StatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  background: ${(p) => {
    switch (p.$status) {
      case 'PUBLISHED': return 'color-mix(in srgb, #22c55e 15%, transparent)';
      case 'DRAFT': return 'color-mix(in srgb, #f59e0b 15%, transparent)';
      case 'ARCHIVED': return 'color-mix(in srgb, #9ca3af 15%, transparent)';
      default: return 'var(--color-bg-hover)';
    }
  }};
  color: ${(p) => {
    switch (p.$status) {
      case 'PUBLISHED': return '#16a34a';
      case 'DRAFT': return '#d97706';
      case 'ARCHIVED': return '#6b7280';
      default: return 'var(--color-text-secondary)';
    }
  }};
`;

export const StatusDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${(p) => {
    switch (p.$status) {
      case 'PUBLISHED': return '#22c55e';
      case 'DRAFT': return '#f59e0b';
      case 'ARCHIVED': return '#9ca3af';
      default: return '#6b7280';
    }
  }};
`;

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export const StyledLink = styled(Link)`
  display: block;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--color-primary);
  text-decoration: none;
  transition: background-color 0.1s ease, color 0.15s ease;
  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-primary-hover);
  }
`;

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 12px;
`;

export const PropLabel = styled.span`
  color: var(--color-text-secondary);
`;

export const PropValue = styled.span`
  color: var(--color-text);
  font-weight: 500;
`;

// ---------------------------------------------------------------------------
// Overlay / Dialog
// ---------------------------------------------------------------------------

export const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
`;

export const DialogBox = styled.div`
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 16px 48px var(--color-shadow);
  overflow: hidden;
`;

// ---------------------------------------------------------------------------
// Toggle group
// ---------------------------------------------------------------------------

export const ToggleGroup = styled.div`
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
`;

export const ToggleBtn = styled.button`
  padding: 5px 12px;
  font-size: 12px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  background: ${(p) => (p.$active ? 'var(--color-primary)' : 'transparent')};
  color: ${(p) => (p.$active ? '#fff' : 'var(--color-text-secondary)')};
  &:hover:not([disabled]) {
    background: ${(p) => (p.$active ? 'var(--color-primary)' : 'var(--color-bg-hover)')};
  }
`;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const SuccessMessage = styled.div`
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  background: color-mix(in srgb, #22c55e 10%, transparent);
  color: #22c55e;
`;

export const ErrorMessage = styled.div`
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
`;

// ---------------------------------------------------------------------------
// Loading / Empty states
// ---------------------------------------------------------------------------

export const LoadingState = styled.div`
  padding: 32px 24px;
  font-size: 14px;
  color: var(--color-text-secondary);
  text-align: center;
`;

export const ErrorState = styled.div`
  padding: 32px 24px;
  color: var(--color-danger);
  font-size: 14px;
  text-align: center;
`;

export const EmptyState = styled.div`
  padding: 24px 14px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-secondary);
`;
