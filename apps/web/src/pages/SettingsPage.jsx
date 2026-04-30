/**
 * SettingsPage — API key management interface at /settings.
 *
 * Displays a list of the user's API keys with name, scopes, created date,
 * and last-used date. Provides a form to create new keys (name + scope
 * checkboxes), a one-time secret display after creation, and delete
 * confirmation via ConfirmDialog.
 */

import { useState } from 'react';
import styled from 'styled-components';
import { Trash2, Copy, Key, Check } from 'lucide-react';
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '../api/hooks.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

// ---------------------------------------------------------------------------
// Available scopes for key creation
// ---------------------------------------------------------------------------

const AVAILABLE_SCOPES = ['notes:read', 'notes:write', 'agent:read'];

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  overflow-y: auto;
`;

const PageHeader = styled.h1`
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 24px;
  color: var(--color-text);
`;

const Section = styled.section`
  margin-bottom: 32px;
`;

const SectionTitle = styled.h3`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin: 0 0 16px;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const KeyList = styled.ul`
  list-style: none;
  margin: 0 0 24px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const KeyRow = styled.li`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-surface);
`;

const KeyInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const KeyName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 4px;
`;

const KeyMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-secondary);
`;

const ScopeBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
  font-family: monospace;
`;

const MetaSeparator = styled.span`
  color: var(--color-border);
`;

const DeleteButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.1s ease, color 0.1s ease;
  &:hover {
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    color: var(--color-danger);
  }
`;

const LoadingState = styled.div`
  padding: 32px 24px;
  font-size: 14px;
  color: var(--color-text-secondary);
  text-align: center;
`;

const ErrorState = styled.div`
  padding: 16px;
  font-size: 13px;
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  border-radius: 8px;
  margin-bottom: 16px;
`;

const EmptyState = styled.div`
  padding: 32px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-secondary);
`;

// -- Create form --

const FormCard = styled.div`
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-surface);
`;

const FormTitle = styled.h4`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 16px;
`;

const FieldGroup = styled.div`
  margin-bottom: 16px;
`;

const FieldLabel = styled.label`
  display: block;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
`;

const NameInput = styled.input`
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  &::placeholder { color: var(--color-text-muted); }
  &:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
  }
`;

const ScopeList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ScopeCheckbox = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;

  input[type='checkbox'] {
    accent-color: var(--color-primary);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
`;

const SubmitButton = styled.button`
  padding: 8px 20px;
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

// -- Secret display --

const SecretBox = styled.div`
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-surface));
  margin-bottom: 24px;
`;

const SecretHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
`;

const SecretValue = styled.code`
  display: block;
  padding: 10px 12px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  word-break: break-all;
  margin-bottom: 12px;
`;

const SecretWarning = styled.p`
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 0 0 12px;
  line-height: 1.4;
`;

const SecretActions = styled.div`
  display: flex;
  gap: 8px;
`;

const CopyButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: background-color 0.15s ease;
  &:hover { background: var(--color-bg-hover); }
`;

const DismissButton = styled.button`
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  transition: background-color 0.15s ease;
  &:hover { background: var(--color-primary-hover); }
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  // -- API key list --
  const { data, isLoading, error } = useApiKeys();
  const keys = data?.keys ?? [];

  // -- Create form state --
  const [keyName, setKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState([]);
  const createMutation = useCreateApiKey();

  // -- One-time secret display --
  const [createdKeySecret, setCreatedKeySecret] = useState(null);
  const [copied, setCopied] = useState(false);

  // -- Delete confirmation --
  const [deletingKeyId, setDeletingKeyId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const deleteMutation = useDeleteApiKey();

  // -- Handlers --

  const handleScopeToggle = (scope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleCreate = () => {
    createMutation.mutate(
      { name: keyName.trim(), scopes: selectedScopes },
      {
        onSuccess: (response) => {
          setCreatedKeySecret(response.key);
          setKeyName('');
          setSelectedScopes([]);
          setCopied(false);
        },
      }
    );
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(createdKeySecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: user can manually select and copy
    }
  };

  const handleDismissSecret = () => {
    setCreatedKeySecret(null);
    setCopied(false);
  };

  const handleDeleteClick = (id) => {
    setDeletingKeyId(id);
    setDeleteError(null);
  };

  const handleDeleteConfirm = () => {
    if (!deletingKeyId) return;
    deleteMutation.mutate(deletingKeyId, {
      onSuccess: () => {
        setDeletingKeyId(null);
        setDeleteError(null);
      },
      onError: (err) => {
        setDeleteError(err.message || 'Failed to delete API key');
        setDeletingKeyId(null);
      },
    });
  };

  const handleDeleteCancel = () => {
    setDeletingKeyId(null);
  };

  const isSubmitDisabled =
    !keyName.trim() || selectedScopes.length === 0 || createMutation.isPending;

  return (
    <Container>
      <PageHeader>Settings</PageHeader>

      <Section>
        <SectionTitle>
          <Key size={14} />
          API Keys
        </SectionTitle>

        {/* One-time secret display */}
        {createdKeySecret && (
          <SecretBox>
            <SecretHeader>
              <Key size={16} />
              Your new API key
            </SecretHeader>
            <SecretValue>{createdKeySecret}</SecretValue>
            <SecretWarning>
              Make sure to copy this key now. You won't be able to see it again.
            </SecretWarning>
            <SecretActions>
              <CopyButton onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </CopyButton>
              <DismissButton onClick={handleDismissSecret}>
                I've saved this key
              </DismissButton>
            </SecretActions>
          </SecretBox>
        )}

        {/* Delete error */}
        {deleteError && <ErrorState>{deleteError}</ErrorState>}

        {/* API key list */}
        {isLoading && <LoadingState>Loading API keys…</LoadingState>}

        {error && !isLoading && (
          <ErrorState>Failed to load API keys: {error.message}</ErrorState>
        )}

        {!isLoading && !error && keys.length === 0 && (
          <EmptyState>No API keys yet. Create one below to get started.</EmptyState>
        )}

        {keys.length > 0 && (
          <KeyList>
            {keys.map((apiKey) => (
              <KeyRow key={apiKey.id}>
                <KeyInfo>
                  <KeyName>{apiKey.name}</KeyName>
                  <KeyMeta>
                    {apiKey.scopes.map((scope) => (
                      <ScopeBadge key={scope}>{scope}</ScopeBadge>
                    ))}
                    <MetaSeparator>·</MetaSeparator>
                    Created {new Date(apiKey.createdAt).toLocaleDateString()}
                    <MetaSeparator>·</MetaSeparator>
                    Last used{' '}
                    {apiKey.lastUsedAt
                      ? new Date(apiKey.lastUsedAt).toLocaleDateString()
                      : 'Never'}
                  </KeyMeta>
                </KeyInfo>
                <DeleteButton
                  onClick={() => handleDeleteClick(apiKey.id)}
                  title="Delete API key"
                >
                  <Trash2 size={16} />
                </DeleteButton>
              </KeyRow>
            ))}
          </KeyList>
        )}

        {/* Create form */}
        <FormCard>
          <FormTitle>Create a new API key</FormTitle>

          <FieldGroup>
            <FieldLabel htmlFor="api-key-name">Key name</FieldLabel>
            <NameInput
              id="api-key-name"
              type="text"
              placeholder="e.g. My integration"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </FieldGroup>

          <FieldGroup>
            <FieldLabel>Scopes</FieldLabel>
            <ScopeList>
              {AVAILABLE_SCOPES.map((scope) => (
                <ScopeCheckbox key={scope}>
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={() => handleScopeToggle(scope)}
                  />
                  {scope}
                </ScopeCheckbox>
              ))}
            </ScopeList>
          </FieldGroup>

          {createMutation.isError && (
            <ErrorState>{createMutation.error.message}</ErrorState>
          )}

          <SubmitButton disabled={isSubmitDisabled} onClick={handleCreate}>
            {createMutation.isPending ? 'Creating…' : 'Create API Key'}
          </SubmitButton>
        </FormCard>
      </Section>

      {/* Delete confirmation dialog */}
      {deletingKeyId && (
        <ConfirmDialog
          title="Delete API Key"
          message="This will permanently revoke this key. Any integrations using it will stop working."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </Container>
  );
}
