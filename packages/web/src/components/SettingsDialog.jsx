import { useState } from 'react';
import styled from 'styled-components';
import { X, Sun, Moon, Code, LayoutGrid, User, Lock, Key, Trash2, Copy, Check } from 'lucide-react';
import { useUIStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { apiPatch, apiPost } from '../api/client.js';
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '../api/hooks.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import {
  Overlay,
  Input,
  FieldGroup,
  FieldLabel,
  PrimaryButton as SaveBtn,
  ToggleGroup,
  ToggleBtn,
} from '../styles/shared.js';

const Dialog = styled.div`
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px var(--color-shadow);
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
`;

const Title = styled.h2`
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
`;

const CloseBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  &:hover { background: var(--color-bg-hover); color: var(--color-text); }
`;

const Body = styled.div`
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const Section = styled.div``;

const SectionTitle = styled.h3`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin: 0 0 12px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
`;

const RowLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text);
`;

const RowIcon = styled.span`
  color: var(--color-text-secondary);
  display: flex;
`;

const Message = styled.div`
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  background: ${(p) => (p.$error ? 'color-mix(in srgb, var(--color-danger) 10%, transparent)' : 'color-mix(in srgb, #22c55e 10%, transparent)')};
  color: ${(p) => (p.$error ? 'var(--color-danger)' : '#22c55e')};
`;

// -- API Key styles --

const KeyList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
`;

const KeyRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
`;

const KeyInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const KeyName = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 2px;
`;

const KeyMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--color-text-secondary);
`;

const ScopeBadge = styled.span`
  display: inline-flex;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 500;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
  font-family: monospace;
`;

const DeleteBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  &:hover { background: color-mix(in srgb, var(--color-danger) 12%, transparent); color: var(--color-danger); }
`;

const EmptyText = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  padding: 8px 0;
`;

const ScopeList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
`;

const ScopeCheckbox = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text);
  cursor: pointer;
  input[type='checkbox'] {
    accent-color: var(--color-primary);
    width: 14px;
    height: 14px;
    cursor: pointer;
  }
`;

const SecretBox = styled.div`
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg));
  margin-bottom: 12px;
`;

const SecretValue = styled.code`
  display: block;
  padding: 8px 10px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  word-break: break-all;
  margin-bottom: 8px;
`;

const SecretWarning = styled.p`
  font-size: 11px;
  color: var(--color-text-secondary);
  margin: 0 0 8px;
`;

const SecretActions = styled.div`
  display: flex;
  gap: 6px;
`;

const SmallBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  &:hover { background: var(--color-bg-hover); }
`;

const SmallPrimaryBtn = styled(SmallBtn)`
  border: none;
  background: var(--color-primary);
  color: #fff;
  &:hover { background: var(--color-primary-hover); }
`;

const AVAILABLE_SCOPES = ['notes:read', 'notes:write', 'agent:read', 'activity-log:read'];

/**
 * Settings dialog with appearance, profile, and password sections.
 * @param {{ onClose: () => void }} props
 */
export default function SettingsDialog({ onClose }) {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const defaultView = useUIStore((s) => s.defaultView);
  const setDefaultView = useUIStore((s) => s.setDefaultView);
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [profileMsg, setProfileMsg] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [pwSaving, setPwSaving] = useState(false);

  // API key state
  const { data: apiKeysData, isLoading: keysLoading, error: keysError } = useApiKeys();
  const keys = apiKeysData?.keys ?? [];
  const createKeyMutation = useCreateApiKey();
  const deleteKeyMutation = useDeleteApiKey();
  const [keyName, setKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState([]);
  const [createdSecret, setCreatedSecret] = useState(null);
  const [copied, setCopied] = useState(false);
  const [deletingKeyId, setDeletingKeyId] = useState(null);

  const handleProfileSave = async () => {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const res = await apiPatch('/auth/me', { displayName });
      login(res.user ?? res);
      setProfileMsg({ text: 'Profile updated', error: false });
    } catch (err) {
      setProfileMsg({ text: err.message || 'Failed to update', error: true });
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordSave = async () => {
    if (newPw.length < 8) {
      setPwMsg({ text: 'Password must be at least 8 characters', error: true });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    try {
      await apiPost('/auth/change-password', { currentPassword: currentPw, newPassword: newPw });
      setPwMsg({ text: 'Password changed', error: false });
      setCurrentPw('');
      setNewPw('');
    } catch (err) {
      setPwMsg({ text: err.message || 'Failed to change password', error: true });
    } finally {
      setPwSaving(false);
    }
  };

  const handleScopeToggle = (scope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleCreateKey = () => {
    createKeyMutation.mutate(
      { name: keyName.trim(), scopes: selectedScopes },
      {
        onSuccess: (res) => {
          setCreatedSecret(res.key);
          setKeyName('');
          setSelectedScopes([]);
          setCopied(false);
        },
      }
    );
  };

  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(createdSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback: user can manually select */ }
  };

  const handleDeleteConfirm = () => {
    if (!deletingKeyId) return;
    deleteKeyMutation.mutate(deletingKeyId, {
      onSuccess: () => setDeletingKeyId(null),
      onError: () => setDeletingKeyId(null),
    });
  };

  return (
    <Overlay onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>Settings</Title>
          <CloseBtn onClick={onClose}><X size={16} /></CloseBtn>
        </Header>
        <Body>
          <Section>
            <SectionTitle>Appearance</SectionTitle>
            <Row>
              <RowLabel><RowIcon>{theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}</RowIcon>Theme</RowLabel>
              <ToggleGroup>
                <ToggleBtn $active={theme === 'light'} onClick={() => setTheme('light')}>Light</ToggleBtn>
                <ToggleBtn $active={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</ToggleBtn>
              </ToggleGroup>
            </Row>
            <Row>
              <RowLabel><RowIcon><LayoutGrid size={14} /></RowIcon>Default editor view</RowLabel>
              <ToggleGroup>
                <ToggleBtn $active={defaultView === 'blocks'} onClick={() => setDefaultView('blocks')}>Blocks</ToggleBtn>
                <ToggleBtn $active={defaultView === 'code'} onClick={() => setDefaultView('code')}>Code</ToggleBtn>
              </ToggleGroup>
            </Row>
          </Section>

          <Section>
            <SectionTitle>Profile</SectionTitle>
            <FieldGroup>
              <FieldLabel>Email</FieldLabel>
              <Input value={user?.email ?? ''} disabled style={{ opacity: 0.6 }} />
            </FieldGroup>
            <FieldGroup>
              <FieldLabel>Display name</FieldLabel>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
            </FieldGroup>
            {profileMsg && <Message $error={profileMsg.error}>{profileMsg.text}</Message>}
            <SaveBtn onClick={handleProfileSave} disabled={profileSaving}>
              {profileSaving ? 'Saving…' : 'Update profile'}
            </SaveBtn>
          </Section>

          <Section>
            <SectionTitle>Change password</SectionTitle>
            <FieldGroup>
              <FieldLabel>Current password</FieldLabel>
              <Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password" />
            </FieldGroup>
            <FieldGroup>
              <FieldLabel>New password</FieldLabel>
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (min 8 chars)" />
            </FieldGroup>
            {pwMsg && <Message $error={pwMsg.error}>{pwMsg.text}</Message>}
            <SaveBtn onClick={handlePasswordSave} disabled={pwSaving || !currentPw || !newPw}>
              {pwSaving ? 'Changing…' : 'Change password'}
            </SaveBtn>
          </Section>

          <Section>
            <SectionTitle>API Keys</SectionTitle>

            {/* One-time secret display */}
            {createdSecret && (
              <SecretBox>
                <KeyMeta style={{ marginBottom: 6, fontSize: 12, color: 'var(--color-text)' }}>
                  <Key size={13} /> Your new API key
                </KeyMeta>
                <SecretValue>{createdSecret}</SecretValue>
                <SecretWarning>Copy this key now. It won't be shown again.</SecretWarning>
                <SecretActions>
                  <SmallBtn onClick={handleCopySecret}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                  </SmallBtn>
                  <SmallPrimaryBtn onClick={() => { setCreatedSecret(null); setCopied(false); }}>
                    Done
                  </SmallPrimaryBtn>
                </SecretActions>
              </SecretBox>
            )}

            {/* Key list */}
            {keysLoading && <EmptyText>Loading…</EmptyText>}
            {keysError && <Message $error>Failed to load API keys</Message>}
            {!keysLoading && !keysError && keys.length === 0 && (
              <EmptyText>No API keys yet.</EmptyText>
            )}
            {keys.length > 0 && (
              <KeyList>
                {keys.map((k) => (
                  <KeyRow key={k.id}>
                    <KeyInfo>
                      <KeyName>{k.name}</KeyName>
                      <KeyMeta>
                        {k.scopes.map((s) => <ScopeBadge key={s}>{s}</ScopeBadge>)}
                        <span>·</span>
                        Created {new Date(k.createdAt).toLocaleDateString()}
                        <span>·</span>
                        Used {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
                      </KeyMeta>
                    </KeyInfo>
                    <DeleteBtn onClick={() => setDeletingKeyId(k.id)} title="Delete key">
                      <Trash2 size={14} />
                    </DeleteBtn>
                  </KeyRow>
                ))}
              </KeyList>
            )}

            {/* Create form */}
            <FieldGroup>
              <FieldLabel>Key name</FieldLabel>
              <Input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. My integration"
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
            {createKeyMutation.isError && (
              <Message $error>{createKeyMutation.error.message}</Message>
            )}
            <SaveBtn
              onClick={handleCreateKey}
              disabled={!keyName.trim() || selectedScopes.length === 0 || createKeyMutation.isPending}
            >
              {createKeyMutation.isPending ? 'Creating…' : 'Create API key'}
            </SaveBtn>
          </Section>
        </Body>
      </Dialog>

      {deletingKeyId && (
        <ConfirmDialog
          title="Delete API Key"
          message="This will permanently revoke this key. Any integrations using it will stop working."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingKeyId(null)}
        />
      )}
    </Overlay>
  );
}
