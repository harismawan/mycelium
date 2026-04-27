import React, { useState, useRef } from 'react';
import styled from 'styled-components';
import { X, Plus, Hash } from 'lucide-react';
import { useUpdateNote } from '../../api/hooks.js';
import { useNotesStore } from '../../stores/notesStore.js';
import { PaneSection, SectionTitle } from '../../styles/shared.js';

const TagContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 6px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
  transition: background-color 0.15s ease;
  line-height: 1;

  &:hover {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
  }
`;

const HashIcon = styled(Hash)`
  flex-shrink: 0;
  opacity: 0.6;
`;

const RemoveButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.1s ease, background-color 0.1s ease;
  flex-shrink: 0;

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--color-primary) 20%, transparent);
  }
`;

const AddButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  font-size: 12px;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 5%, transparent);
  }
`;

const InputWrapper = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-primary) 5%, transparent);
`;

const TagInput = styled.input`
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font-size: 12px;
  width: 80px;
  padding: 2px 0;

  &::placeholder {
    color: var(--color-text-muted);
  }
`;

/**
 * Interactive tag list with add/remove capabilities.
 * Tags are displayed as removable badges with an inline add input.
 *
 * @param {{ tags: (string | { name: string })[], slug?: string }} props
 */
export default function TagList({ tags, slug: slugProp }) {
  const selectedSlug = useNotesStore((s) => s.selectedSlug);
  const slug = slugProp ?? selectedSlug;
  const updateNote = useUpdateNote(slug ?? '');

  const names = (tags ?? []).map((t) => (typeof t === 'string' ? t : t.name));
  const [adding, setAdding] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  /** Save updated tags to the API */
  const saveTags = (newTags) => {
    if (!slug) return;
    updateNote.mutate({ tags: newTags });
  };

  /** Remove a tag */
  const handleRemove = (tagName) => {
    const updated = names.filter((n) => n !== tagName);
    saveTags(updated);
  };

  /** Add a new tag from the input */
  const handleAdd = () => {
    const trimmed = inputValue.trim().toLowerCase();
    if (trimmed && !names.includes(trimmed)) {
      saveTags([...names, trimmed]);
    }
    setInputValue('');
    setAdding(false);
  };

  /** Handle Enter/Escape in the input */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    } else if (e.key === 'Escape') {
      setInputValue('');
      setAdding(false);
    }
  };

  /** Open the add input and focus it */
  const startAdding = () => {
    setAdding(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <PaneSection>
      <SectionTitle>Tags</SectionTitle>
      <TagContainer>
        {names.map((name) => (
          <Badge key={name}>
            <HashIcon size={10} />
            {name}
            <RemoveButton
              onClick={() => handleRemove(name)}
              aria-label={`Remove tag ${name}`}
              title={`Remove ${name}`}
            >
              <X size={10} />
            </RemoveButton>
          </Badge>
        ))}

        {adding ? (
          <InputWrapper>
            <HashIcon size={10} style={{ color: 'var(--color-primary)' }} />
            <TagInput
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleAdd}
              placeholder="tag name"
              aria-label="New tag name"
            />
          </InputWrapper>
        ) : (
          <AddButton onClick={startAdding} aria-label="Add tag">
            <Plus size={12} />
            Add
          </AddButton>
        )}
      </TagContainer>
    </PaneSection>
  );
}
