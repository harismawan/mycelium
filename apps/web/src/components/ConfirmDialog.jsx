import styled from 'styled-components';
import { AlertTriangle } from 'lucide-react';
import { Overlay, PrimaryButton, GhostButton } from '../styles/shared.js';

const Dialog = styled.div`
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  width: 380px;
  max-width: 90vw;
  padding: 24px;
  box-shadow: 0 16px 48px var(--color-shadow);
`;

const IconRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
`;

const IconCircle = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Title = styled.h3`
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 6px;
  text-align: center;
  color: var(--color-text);
`;

const Message = styled.p`
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0 0 20px;
  text-align: center;
  line-height: 1.5;
`;

const Buttons = styled.div`
  display: flex;
  gap: 8px;
  justify-content: center;
`;

const ConfirmBtn = styled(PrimaryButton)`
  background: var(--color-danger);
  &:hover:not(:disabled) { opacity: 0.9; background: var(--color-danger); }
`;

/**
 * @param {{ title: string, message: string, confirmLabel?: string, onConfirm: () => void, onCancel: () => void }} props
 */
export default function ConfirmDialog({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  return (
    <Overlay onClick={onCancel}>
      <Dialog onClick={(e) => e.stopPropagation()}>
        <IconRow>
          <IconCircle><AlertTriangle size={20} /></IconCircle>
        </IconRow>
        <Title>{title}</Title>
        <Message>{message}</Message>
        <Buttons>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
          <ConfirmBtn onClick={onConfirm}>{confirmLabel}</ConfirmBtn>
        </Buttons>
      </Dialog>
    </Overlay>
  );
}
