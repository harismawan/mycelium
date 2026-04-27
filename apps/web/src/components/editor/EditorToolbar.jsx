import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { useEditorStore } from '../../stores/editorStore.js';

/**
 * @typedef {object} EditorToolbarProps
 * @property {string} status - Current note status (DRAFT | PUBLISHED | ARCHIVED)
 * @property {string[]} tags - Current note tags
 * @property {boolean} saving - Whether a save is in progress
 * @property {(data: { status?: string, tags?: string[], content?: string }) => void} onSave
 * @property {(status: string) => void} onStatusChange
 * @property {(tags: string[]) => void} onTagsChange
 */

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 16px;
  flex-wrap: wrap;
`;

const SaveButton = styled.button`
  padding: 7px 18px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, opacity 0.15s ease;
  background: ${(props) => (props.disabled ? 'var(--color-border)' : 'var(--color-primary)')};
  color: ${(props) => (props.disabled ? 'var(--color-text-secondary)' : '#fff')};
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};

  &:not(:disabled):hover {
    background: var(--color-primary-hover);
  }
`;

const DirtyIndicator = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #f59e0b;
`;

const DirtyDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
`;

const FieldLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
`;

const Select = styled.select`
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s ease;

  &:focus {
    border-color: var(--color-primary);
  }
`;

const Input = styled.input`
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  min-width: 180px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &::placeholder {
    color: var(--color-text-secondary);
  }

  &:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
  }
`;

const STATUS_OPTIONS = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

/**
 * Toolbar for the note editor with save button, status selector,
 * tag input, and unsaved changes indicator.
 *
 * @param {EditorToolbarProps} props
 * @returns {React.JSX.Element}
 */
export default function EditorToolbar({ status, tags, saving, onSave, onStatusChange, onTagsChange }) {
  const isDirty = useEditorStore((s) => s.isDirty);
  const [tagInput, setTagInput] = useState(tags.join(', '));

  /** Commit tag changes when the input loses focus or Enter is pressed. */
  const commitTags = useCallback(() => {
    const parsed = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    onTagsChange(parsed);
  }, [tagInput, onTagsChange]);

  /** @param {React.KeyboardEvent<HTMLInputElement>} e */
  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTags();
    }
  };

  // Keep local tag input in sync when parent tags change
  React.useEffect(() => {
    setTagInput(tags.join(', '));
  }, [tags]);

  return (
    <Toolbar role="toolbar" aria-label="Editor toolbar">
      <SaveButton
        disabled={!isDirty || saving}
        onClick={onSave}
        aria-label="Save note"
      >
        {saving ? 'Saving…' : 'Save'}
      </SaveButton>

      {isDirty && (
        <DirtyIndicator>
          <DirtyDot aria-hidden="true" />
          Unsaved changes
        </DirtyIndicator>
      )}

      <FieldLabel>
        Status:
        <Select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          aria-label="Note status"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </FieldLabel>

      <FieldLabel>
        Tags:
        <Input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onBlur={commitTags}
          onKeyDown={handleTagKeyDown}
          placeholder="tag1, tag2, tag3"
          aria-label="Note tags (comma-separated)"
        />
      </FieldLabel>
    </Toolbar>
  );
}
