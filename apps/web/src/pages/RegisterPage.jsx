import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { z } from 'zod';
import styled from 'styled-components';
import { apiPost } from '../api/client.js';
import MyceliumBrand from '../components/MyceliumBrand.jsx';
import {
  Card,
  Input,
  FieldGroup,
  FieldLabel as Label,
  FieldError,
  PrimaryButton as SubmitButton,
} from '../styles/shared.js';

const registerSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1, 'Display name is required'),
});

const PageWrapper = styled.div`
  max-width: 400px;
  margin: 80px auto;
  padding: 0 20px;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 24px;
  color: var(--color-text);
  text-align: center;
`;

const ServerError = styled.p`
  color: var(--color-danger);
  font-size: 14px;
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  padding: 10px 14px;
  border-radius: 6px;
  margin: 0 0 16px;
`;

const FooterText = styled.p`
  margin-top: 20px;
  font-size: 14px;
  text-align: center;
  color: var(--color-text-secondary);
`;

/**
 * Registration page with email/password/displayName form and Zod validation.
 * Calls POST /auth/register then navigates to login on success.
 */
export default function RegisterPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  /** @type {[Record<string, string>, Function]} */
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  /** @param {import('react').FormEvent} e */
  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    setServerError('');

    const result = registerSchema.safeParse({ email, password, displayName });
    if (!result.success) {
      /** @type {Record<string, string>} */
      const fieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    try {
      await apiPost('/auth/register', { email, password, displayName });
      navigate('/login');
    } catch (err) {
      setServerError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageWrapper>
      <Card style={{ padding: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}><MyceliumBrand size={52} /></div>

        {serverError && (
          <ServerError role="alert">{serverError}</ServerError>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup style={{ marginBottom: '18px' }}>
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              aria-invalid={!!errors.displayName}
              aria-describedby={errors.displayName ? 'displayName-error' : undefined}
            />
            {errors.displayName && (
              <FieldError id="displayName-error" role="alert">{errors.displayName}</FieldError>
            )}
          </FieldGroup>

          <FieldGroup style={{ marginBottom: '18px' }}>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
            {errors.email && (
              <FieldError id="email-error" role="alert">{errors.email}</FieldError>
            )}
          </FieldGroup>

          <FieldGroup style={{ marginBottom: '18px' }}>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
            />
            {errors.password && (
              <FieldError id="password-error" role="alert">{errors.password}</FieldError>
            )}
          </FieldGroup>

          <SubmitButton type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Creating account…' : 'Register'}
          </SubmitButton>
        </form>

        <FooterText>
          Already have an account? <Link to="/login">Log in</Link>
        </FooterText>
      </Card>
    </PageWrapper>
  );
}
