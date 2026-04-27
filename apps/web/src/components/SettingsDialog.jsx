import { useState } from 'react';
import styled from 'styled-components';
import { X, Sun, Moon, Code, LayoutGrid, User, Lock } from 'lucide-react';
import { useUIStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { apiPatch, apiPost } from '../api/client.js';
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
        </Body>
      </Dialog>
    </Overlay>
  );
}
