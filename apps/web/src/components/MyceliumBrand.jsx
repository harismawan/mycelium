import styled from 'styled-components';
import MyceliumLogo from './MyceliumLogo.jsx';

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.$gap ?? '12px'};
`;

const TextBlock = styled.div`
  display: flex;
  flex-direction: column;
`;

const Name = styled.span`
  font-size: ${(p) => p.$fontSize ?? '22px'};
  font-weight: 300;
  letter-spacing: 0.04em;
  color: var(--color-text);
  line-height: 1.1;
`;

const Tagline = styled.span`
  font-size: ${(p) => p.$tagSize ?? '9px'};
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  margin-top: 2px;
`;

/**
 * Horizontal brand lockup: logo icon + "mycelium" + "A KNOWLEDGE NETWORK"
 * @param {{ size?: number, showTagline?: boolean }} props
 */
export default function MyceliumBrand({ size = 40, showTagline = true }) {
  const fontSize = `${Math.round(size * 0.55)}px`;
  const tagSize = `${Math.max(Math.round(size * 0.2), 8)}px`;
  const gap = `${Math.round(size * 0.3)}px`;

  return (
    <Wrapper $gap={gap}>
      <MyceliumLogo size={size} />
      <TextBlock>
        <Name $fontSize={fontSize}>mycelium</Name>
        {showTagline && <Tagline $tagSize={tagSize}>A Knowledge Network</Tagline>}
      </TextBlock>
    </Wrapper>
  );
}
