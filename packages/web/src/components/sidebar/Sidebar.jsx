import { FileText, Archive, GitBranch, Activity, Pin, Sun, Moon, LogOut, User, Settings } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useNoteCounts, useTags } from '../../api/hooks.js';
import { useNotesStore } from '../../stores/notesStore.js';
import { useUIStore } from '../../stores/uiStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { apiPost } from '../../api/client.js';
import MyceliumLogo from '../MyceliumLogo.jsx';
import SettingsDialog from '../SettingsDialog.jsx';
import { useTheme } from '../../hooks/useTheme.js';

const Nav = styled.nav`
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 8px;
  gap: 2px;
  overflow-y: auto;
`;

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 12px;
  font-weight: 700;
  font-size: 14px;
  color: var(--color-text);
  letter-spacing: -0.3px;
`;

const NavItem = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: ${(props) => (props.$active ? 'var(--color-bg-active)' : 'transparent')};
  color: ${(props) => (props.$active ? 'var(--color-text)' : 'var(--color-text-secondary)')};
  font-size: 13px;
  font-weight: ${(props) => (props.$active ? '600' : '400')};
  cursor: pointer;
  text-align: left;
  transition: background-color 0.1s ease;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

const NavIcon = styled.span`
  font-size: 14px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
`;

const NavLabel = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CountBadge = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--color-bg-hover);
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
`;

const Spacer = styled.div`
  flex: 1;
`;

const BottomSection = styled.div`
  padding: 8px 0 4px;
  border-top: 1px solid var(--color-border);
`;

const ProfileRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 8px;
`;

const Avatar = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-bg-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  flex-shrink: 0;
`;

const ProfileName = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PinnedItem = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.1s ease;
  overflow: hidden;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

/**
 * Narrow navigation sidebar matching Tolaria's layout.
 * Shows nav items with icons/counts, tags section, pinned notes, and theme toggle.
 */
export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const pinnedSlugs = useNotesStore((s) => s.pinnedSlugs);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = async () => {
    try { await apiPost('/auth/logout', {}); } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeSection = useUIStore((s) => s.activeSection);
  const setActiveSection = useUIStore((s) => s.setActiveSection);

  const { data: counts } = useNoteCounts();
  const { data: tagsData } = useTags();

  const totalNotes = counts?.total ?? 0;
  const archivedCount = counts?.archived ?? 0;
  const tags = tagsData?.tags ?? tagsData ?? [];

  // Sync activeSection when navigating to graph
  const isGraph = location.pathname === '/graph';

  return (
    <Nav>
      <BrandRow><MyceliumLogo size={20} /> Mycelium</BrandRow>

      <NavItem $active={activeSection === 'all'} onClick={() => { setActiveSection('all'); navigate('/'); }}>
        <NavIcon><FileText size={15} /></NavIcon>
        <NavLabel>All Notes</NavLabel>
        {totalNotes > 0 && <CountBadge>{totalNotes}</CountBadge>}
      </NavItem>

      <NavItem $active={activeSection === 'archive'} onClick={() => { setActiveSection('archive'); navigate('/?status=ARCHIVED'); }}>
        <NavIcon><Archive size={15} /></NavIcon>
        <NavLabel>Archive</NavLabel>
        {archivedCount > 0 && <CountBadge>{archivedCount}</CountBadge>}
      </NavItem>

      <NavItem $active={activeSection === 'graph' || isGraph} onClick={() => { setActiveSection('graph'); navigate('/graph'); }}>
        <NavIcon><GitBranch size={15} /></NavIcon>
        <NavLabel>Graph</NavLabel>
      </NavItem>

      <NavItem $active={activeSection === 'activity' || location.pathname === '/activity'} onClick={() => { setActiveSection('activity'); navigate('/activity'); }}>
        <NavIcon><Activity size={15} /></NavIcon>
        <NavLabel>Agent Activity</NavLabel>
      </NavItem>

      {tags.length > 0 && (
        <>
          <SectionHeader>
            <span>Tags</span>
          </SectionHeader>
          {tags.map((tag) => {
            const count = tag._count?.notes ?? tag.noteCount ?? 0;
            return (
              <NavItem
                key={tag.id ?? tag.name}
                $active={activeSection === `tag:${tag.name}`}
                onClick={() => { setActiveSection(`tag:${tag.name}`); navigate(`/?tag=${encodeURIComponent(tag.name)}`); }}
              >
                <NavIcon>#</NavIcon>
                <NavLabel>{tag.name}</NavLabel>
                {count > 0 && <CountBadge>{count}</CountBadge>}
              </NavItem>
            );
          })}
        </>
      )}

      {pinnedSlugs.length > 0 && (
        <>
          <SectionHeader>
            <span>Pinned</span>
          </SectionHeader>
          {pinnedSlugs.map((slug) => (
            <PinnedItem key={slug} onClick={() => navigate(`/notes/${slug}`)}>
              <Pin size={12} style={{ flexShrink: 0 }} /> {slug}
            </PinnedItem>
          ))}
        </>
      )}

      <Spacer />

      <BottomSection>
        <ProfileRow>
          <Avatar>
            <User size={14} />
          </Avatar>
          <ProfileName>{user?.displayName ?? user?.email ?? 'User'}</ProfileName>
        </ProfileRow>
        <NavItem $active={false} onClick={() => setSettingsOpen(true)}>
          <NavIcon><Settings size={15} /></NavIcon>
          <NavLabel>Settings</NavLabel>
        </NavItem>
        <NavItem
          $active={false}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <NavIcon>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</NavIcon>
          <NavLabel>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</NavLabel>
        </NavItem>
        <NavItem $active={false} onClick={handleLogout}>
          <NavIcon><LogOut size={15} /></NavIcon>
          <NavLabel>Log out</NavLabel>
        </NavItem>
      </BottomSection>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </Nav>
  );
}
