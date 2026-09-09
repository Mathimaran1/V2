import os

import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter()

TOKEN_URL = "https://auth.atlassian.com/oauth/token"


@router.post("/api/jira/token")
async def exchange_jira_token(payload: dict):
    """
    Real Atlassian OAuth 2.0 (3LO) authorization-code-for-token exchange,
    done server-side ONLY for this one call.

    The frontend (services/jiraAuth.ts) does everything else itself —
    generates the PKCE verifier/challenge, redirects to Atlassian, holds
    the consent flow, stores the resulting token in sessionStorage. This
    route exists because Atlassian's token endpoint requires
    client_secret on every exchange, even when a valid PKCE code_verifier
    is also sent — confirmed against Atlassian's own docs and developer
    community: their identity server's token_endpoint_auth_methods_supported
    is [client_secret_basic, client_secret_post], never "none", so there
    is no public-client PKCE option for 3LO apps (tracked as an open
    Atlassian feature request, ECO-283, not implemented). A client secret
    can never safely live in the frontend bundle, so this one call moves
    here — everything else about the flow stays frontend-only as planned.

    Real errors from Atlassian (bad/expired code, wrong redirect_uri,
    misconfigured secret) are passed through with Atlassian's own status
    code and body, not swallowed into a generic 500.
    """
    code = payload.get("code")
    code_verifier = payload.get("code_verifier")
    redirect_uri = payload.get("redirect_uri")
    if not code or not code_verifier or not redirect_uri:
        raise HTTPException(status_code=400, detail="code, code_verifier, and redirect_uri are all required")

    client_id = os.environ.get("JIRA_CLIENT_ID")
    client_secret = os.environ.get("JIRA_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="JIRA_CLIENT_ID / JIRA_CLIENT_SECRET not configured in backend/.env")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                TOKEN_URL,
                json={
                    "grant_type": "authorization_code",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                },
            )
    except httpx.RequestError as exc:
        # Atlassian unreachable/timed out/connection reset — not an
        # error *from* Atlassian, so there's no response to pass
        # through. Surface it as a clear 502 rather than letting it
        # bubble up as an unhandled exception (generic 500).
        raise HTTPException(status_code=502, detail=f"Could not reach Atlassian's token endpoint: {exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    return resp.json()
