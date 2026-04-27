import styled from 'styled-components';
import MyceliumLogo from '../components/MyceliumLogo.jsx';
import { useAuthStore } from '../stores/authStore.js';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px 24px;
  text-align: center;
`;

const Logo = styled.div`
  font-size: 48px;
`;

const Greeting = styled.h1`
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 8px;
  color: var(--color-text);
`;

const Subtitle = styled.p`
  font-size: 14px;
  color: var(--color-text-secondary);
  margin: 0 0 24px;
  max-width: 360px;
  line-height: 1.5;
`;

const Hint = styled.p`
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0;
`;

const Kbd = styled.kbd`
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-family: inherit;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
`;

/**
 * Welcome dashboard shown when no note is selected.
 * The note list is always visible in column 2, so this is just a landing view.
 */
export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <Container>
      <Logo><MyceliumLogo size={80} /></Logo>
      <Greeting>
        Welcome{user?.displayName ? `, ${user.displayName}` : ''}
      </Greeting>
      <Subtitle>
        Select a note from the list to start editing, or create a new one.
      </Subtitle>
      <Hint>
        Press <Kbd>⌘</Kbd> + <Kbd>K</Kbd> to open the command palette
      </Hint>
    </Container>
  );
}
