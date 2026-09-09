import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleCallback } from '@/services/jiraAuth';

export default function JiraCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // StrictMode double-invokes effects in dev — the OAuth code can
    // only be exchanged once (Atlassian rejects a reused code), so
    // guard against a real double-submit rather than just double-log.
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    handleCallback(params)
      .then(returnPath => navigate(returnPath, { replace: true }))
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [navigate]);

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <h1>Jira login failed</h1>
        <p>{error}</p>
        <button onClick={() => navigate('/')}>Back to Overview</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 40 }}>
      <p>Completing Jira login…</p>
    </div>
  );
}
