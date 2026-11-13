# Pairing Speed Measurement

Date: 2026-11-09. Measure each stage from code entry to successful pairing and identify bottlenecks.

## Measurement Method

Run a complete pairing flow once on Windows Desktop and once on Mac, recording timestamps at each stage.

### Frontend Instrumentation (`apps/web`)

Add `console.time()` and `console.timeLog()` at:

1. **Connect Computer clicked** — `pairing:start`
2. **Pairing request sent** — `pairing:request-sent`
3. **Successful pairing response received** — `pairing:response-received`
4. **Device-online SSE event received** — `pairing:device-online`

File: `apps/web/app/(main)/devices/pair/page.tsx` or equivalent.

### Backend Instrumentation (`packages/host`)

Add timestamped logs at:

1. **Pairing request received** — `Pairing: received request`
2. **Code validation started** — `Pairing: validating code`
3. **Code validation completed** — `Pairing: code validated`
4. **Trust-record write started** — `Pairing: writing trust record`
5. **Trust record written** — `Pairing: trust record written`
6. **Endpoint-record write started** — `Pairing: writing endpoint record`
7. **Endpoint record written** — `Pairing: endpoint record written`
8. **TLS handshake started** — `Pairing: starting TLS handshake`
9. **TLS handshake completed** — `Pairing: TLS handshake complete`
10. **Success response returned** — `Pairing: response sent`

File: `packages/host/src/pairing.ts` or equivalent.

### Relay Instrumentation (If Used)

For Relay pairing, also log on Relay:

1. **Enrollment request received** — `Relay: enrollment request received`
2. **Enrollment completed** — `Relay: enrollment complete`
3. **Channel establishment requested** — `Relay: channel request received`
4. **Channel established** — `Relay: channel established`

### Measurement Steps

#### Windows Desktop → Mac Pairing

1. Open Desktop on Mac and generate a pairing code.
2. Enter the code in Windows Desktop and click Connect Computer.
3. Record these times from browser console and Host logs:
   - T0: Connect Computer clicked.
   - T1: frontend request sent.
   - T2: Host request received.
   - T3: code validation completed.
   - T4: trust record written.
   - T5: endpoint record written.
   - T6: TLS handshake completed, if applicable.
   - T7: Host response sent.
   - T8: frontend response received.
   - T9: device-online SSE event received.

#### Mac Desktop → Windows Pairing (Reverse Test)

Repeat the steps, entering the Windows pairing code on Mac.

### Expected Results

| Stage | Target | Actual (Windows → Mac) | Actual (Mac → Windows) |
| --------------------- | -------- | ------------------------ | ------------------------ |
| Frontend → backend (T2-T0) | < 100ms | | |
| Validate code (T3-T2) | < 50ms | | |
| Write trust (T4-T3) | < 200ms | | |
| Write endpoint (T5-T4) | < 200ms | | |
| TLS handshake (T6-T5) | < 1s | | |
| Backend → frontend (T8-T7) | < 100ms | | |
| SSE delivery (T9-T8) | < 500ms | | |
| **Total (T9-T0)** | **≤ 3s** | | |

### Bottleneck Analysis

Use actual measurements to identify the slowest stage:

- **TLS handshake** over 1s: consider session resumption or preconnection.
- **Database writes** over 500ms: consider asynchronous writes or batch transactions.
- **SSE delivery** over 1s: consider active push instead of polling.
- **Code validation** over 100ms: simplify validation logic.

### Optimization Options (Choose Based on the Bottleneck)

1. **Slow TLS**:
   - TLS session resumption.
   - Preconnect during code entry.
   - Faster cryptographic algorithms.

2. **Slow database**:
   - Asynchronous writes, returning success before background persistence.
   - Batched transactions.
   - Improved indexes.

3. **Slow network**:
   - Fewer round trips.
   - WebSocket instead of polling.
   - Active push instead of passive retrieval.

4. **Slow validation**:
   - Simpler pairing-code validation.
   - Remove unnecessary encryption/decryption.
   - Cache validation results.

## Implementation

1. Instrument `apps/web` and `packages/host`.
2. Run pairing twice, in both directions.
3. Fill the table with timings.
4. Write an optimization prompt based on identified bottlenecks.

Append measured results to this file. I will then write the D2.4 optimization prompt.
