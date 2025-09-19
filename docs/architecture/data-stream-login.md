# Data Stream – Wallet Connect Login (A1)

## Flow (PoC)

```mermaid
sequenceDiagram
  participant FE as Frontend (Landing)
  participant WL as Wallet
  participant BF as BFF (optional)

  FE->>WL: Connect
  WL-->>FE: {address, publicKey, network}
  FE->>BF: GET /api/accounts/:address
  alt 200
    FE->>FE: router.push('/dashboard/{role}')
  else 404
    FE->>FE: router.push('/register')
  end

  opt Session (future)
    FE->>BF: GET /auth/nonce
    FE->>WL: Sign nonce
    WL-->>FE: Signature
    FE->>BF: POST /auth/verify
    BF-->>FE: Set-Cookie session
  end
```

## Contracts
- FE requires `NEXT_PUBLIC_APTOS_NETWORK`, `NEXT_PUBLIC_BFF_URL` and wallet adapters configured.
- Optional session endpoints for future iterations.

## Acceptance
- Connect succeeds (address visible), navigation follows registration state.
- Graceful handling of network mismatch and errors.

